import { spawn } from 'node:child_process';
import type { ProcessRequest, ProcessResult, ProcessRunner } from './process-runner';

/** 출력 하나(stdout, stderr)에 담는 최대 글자 수. 넘는 출력은 버린다. */
const OUTPUT_MAX_LENGTH = 64 * 1024;

/**
 * 프로세스가 끝난 뒤 출력이 닫히기를 기다리는 시간(밀리초).
 * rc 파일이 띄운 백그라운드 프로세스가 출력을 물고 있으면 닫히지 않으므로 이만큼만 기다린다.
 */
const CLOSE_GRACE_MS = 500;

/** 끝낸 프로세스가 실제로 끝나기를 기다리는 최대 시간(밀리초). */
const KILL_WAIT_MS = 2_000;

/** Node `child_process`로 프로세스를 띄우는 실행기. 제한 시간을 넘기거나 중단 신호가 오면 프로세스 트리를 끝낸다. */
export class NodeProcessRunner implements ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult> {
    return new Promise((resolve) => {
      if (request.signal?.aborted) {
        resolve({ kind: 'aborted', stdout: '', stderr: '' });
        return;
      }

      /** Windows인지 여부. */
      const isWindows = process.platform === 'win32';
      // Windows의 `.cmd`·`.bat` 래퍼(npm 설치본)는 cmd.exe를 거쳐야 띄울 수 있다.
      /** cmd.exe를 거쳐야 하는지 여부. */
      const viaCmd = isWindows && /\.(cmd|bat)$/i.test(request.command);

      // cmd.exe를 거칠 때는 명령 한 줄로 넘긴다. 인수를 따로 넘기면 Node 24가 셸 인수 이스케이프 경고(DEP0190)를 낸다.
      /** 띄운 프로세스. POSIX는 새 프로세스 그룹으로 띄워 그룹째 끝낼 수 있게 한다. */
      const child = spawn(viaCmd ? cmdShimCommandLine(request.command, request.args) : request.command, viaCmd ? [] : request.args, {
        cwd: request.cwd,
        env: request.env,
        stdio: 'pipe',
        detached: !isWindows,
        windowsHide: true,
        shell: viaCmd,
      });

      /** 받은 표준 출력. */
      let stdout = '';
      /** 받은 표준 오류. */
      let stderr = '';
      /** 아직 줄바꿈을 받지 못한 표준 출력 조각. 줄 단위로 넘길 때만 쓴다. */
      let partialLine = '';
      /** 이미 결과를 돌려줬는지 여부. */
      let settled = false;
      /** 끝난 뒤 출력이 닫히기를 기다리는 타이머. */
      let graceTimer: NodeJS.Timeout | null = null;
      /** 제한 시간이나 중단 신호로 끝내는 중이면 그 이유. */
      let terminating: 'timed-out' | 'aborted' | null = null;
      /** 끝낸 프로세스가 실제로 끝나기를 기다리는 타이머. */
      let killWaitTimer: NodeJS.Timeout | null = null;

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout = appendCapped(stdout, chunk);
        if (!request.onStdoutLine) return;
        // 받은 조각을 줄로 나누고, 줄바꿈 뒤에 남은 조각은 다음 조각과 이어 붙인다.
        /** 앞 조각에 이어 붙여 나눈 줄. 마지막 칸은 아직 끝나지 않은 줄이다. */
        const lines = (partialLine + chunk).split('\n');
        partialLine = lines.pop() ?? '';
        for (const line of lines) request.onStdoutLine(stripCarriageReturn(line));
      });
      child.stderr.on('data', (chunk: string) => {
        stderr = appendCapped(stderr, chunk);
      });

      // 넘길 내용이 없으면 표준 입력을 바로 닫아 자식이 입력을 기다리지 않게 한다.
      // 자식이 표준 입력을 다 읽기 전에 끝나면 EPIPE가 난다. 결과는 종료 코드로 알 수 있으므로 무시한다.
      child.stdin.on('error', () => {});
      child.stdin.end(request.stdin ?? '');

      /** 결과를 한 번만 돌려주고 타이머, 중단 신호 구독, 출력을 정리한다. */
      const settle = (result: ProcessResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (graceTimer) clearTimeout(graceTimer);
        if (killWaitTimer) clearTimeout(killWaitTimer);
        request.signal?.removeEventListener('abort', handleAbort);
        // 줄바꿈 없이 끝난 마지막 조각도 한 줄로 넘긴다.
        if (request.onStdoutLine && partialLine !== '') request.onStdoutLine(stripCarriageReturn(partialLine));
        partialLine = '';
        child.stdout.destroy();
        child.stderr.destroy();
        resolve(result);
      };

      /**
       * 프로세스 트리를 끝내고, 프로세스가 실제로 끝나면 `kind`로 돌려준다.
       * 끝나지 않아도 `KILL_WAIT_MS` 뒤에는 돌려준다.
       */
      const terminate = (kind: 'timed-out' | 'aborted') => {
        if (settled || terminating) return;
        terminating = kind;
        killTree(child.pid);
        killWaitTimer = setTimeout(() => settle({ kind, stdout, stderr }), KILL_WAIT_MS);
      };

      /** 중단 신호를 받으면 프로세스 트리를 끝낸다. */
      const handleAbort = () => terminate('aborted');
      request.signal?.addEventListener('abort', handleAbort, { once: true });

      /** 제한 시간 타이머. 넘기면 프로세스 트리를 끝낸다. */
      const timeoutTimer = setTimeout(() => terminate('timed-out'), request.timeoutMs);

      child.on('error', (error) => settle({ kind: 'spawn-failed', message: error.message }));
      child.on('exit', (code) => {
        if (terminating) {
          // 끝내라는 신호가 자식을 띄우는 순간과 겹치면 막 생긴 자식이 그룹 신호를 놓친다. 그 자식은 그룹에 남아 있으므로 한 번 더 보낸다.
          if (!isWindows) killTree(child.pid);
          settle({ kind: terminating, stdout, stderr });
          return;
        }
        graceTimer = setTimeout(() => settle({ kind: 'exited', exitCode: code, stdout, stderr }), CLOSE_GRACE_MS);
      });
      child.on('close', (code) => settle(terminating ? { kind: terminating, stdout, stderr } : { kind: 'exited', exitCode: code, stdout, stderr }));
    });
  }
}

/** 상한을 넘지 않게 출력을 이어 붙인다. */
function appendCapped(current: string, chunk: string): string {
  if (current.length >= OUTPUT_MAX_LENGTH) return current;
  return (current + chunk).slice(0, OUTPUT_MAX_LENGTH);
}

/** Windows 줄 끝(`\r\n`)의 `\r`을 뗀다. */
function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** 프로세스와 그 자식들을 끝낸다. 이미 끝났으면 아무 일도 하지 않는다. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {});
    } else {
      // 음수 PID는 프로세스 그룹 전체다. rc 파일이 띄운 sleep 같은 자식까지 끝낸다.
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    // 이미 끝난 프로세스다.
  }
}

/** cmd.exe가 특별히 다루는 문자. 따옴표 안팎과 상관없이 `^`로 막는다. */
const CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

/**
 * `.cmd`·`.bat` 래퍼를 cmd.exe로 띄울 명령 한 줄. 인수에 JSON, 공백, 한글 경로가 들어가도 그대로 전달되게 막는다.
 * npm 래퍼는 받은 인수를 `%*`로 node에 다시 넘기며 cmd가 한 번 더 해석하므로, 특수 문자를 두 번 막는다(cross-spawn과 같은 방식).
 */
export function cmdShimCommandLine(command: string, args: readonly string[]): string {
  return [`"${command}"`, ...args.map(escapeCmdShimArgument)].join(' ');
}

/** 인수 하나를 Windows 명령줄 규칙으로 따옴표에 넣고, cmd.exe 특수 문자를 두 번 막는다. */
function escapeCmdShimArgument(arg: string): string {
  // 따옴표 앞의 역슬래시는 두 배로 늘리고 따옴표는 \"로 바꾼다.
  /** 따옴표를 막은 인수. */
  const quotedInside = arg.replace(/(\\*)"/g, '$1$1\\"');
  // 끝의 역슬래시가 닫는 따옴표를 막지 않게 두 배로 늘린다.
  /** 따옴표로 감싼 인수. */
  const quoted = `"${quotedInside.replace(/(\\*)$/, '$1$1')}"`;
  return quoted.replace(CMD_META_CHARS, '^$1').replace(CMD_META_CHARS, '^$1');
}
