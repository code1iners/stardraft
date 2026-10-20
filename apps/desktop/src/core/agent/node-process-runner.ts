import { spawn } from 'node:child_process';
import type { ProcessRequest, ProcessResult, ProcessRunner } from './process-runner';

/** 출력 하나(stdout, stderr)에 담는 최대 글자 수. 넘는 출력은 버린다. */
const OUTPUT_MAX_LENGTH = 64 * 1024;

/**
 * 프로세스가 끝난 뒤 출력이 닫히기를 기다리는 시간(밀리초).
 * rc 파일이 띄운 백그라운드 프로세스가 출력을 물고 있으면 닫히지 않으므로 이만큼만 기다린다.
 */
const CLOSE_GRACE_MS = 500;

/** Node `child_process`로 프로세스를 띄우는 실행기. 제한 시간을 넘기면 프로세스 트리를 끝낸다. */
export class NodeProcessRunner implements ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult> {
    return new Promise((resolve) => {
      /** Windows인지 여부. */
      const isWindows = process.platform === 'win32';
      // Windows의 `.cmd`·`.bat` 래퍼(npm 설치본)는 cmd.exe를 거쳐야 띄울 수 있다. 인수는 앱이 정한 고정 값만 넘긴다.
      /** cmd.exe를 거쳐야 하는지 여부. */
      const viaCmd = isWindows && /\.(cmd|bat)$/i.test(request.command);

      // cmd.exe를 거칠 때는 명령 한 줄로 넘긴다. 인수를 따로 넘기면 Node 24가 셸 인수 이스케이프 경고(DEP0190)를 낸다.
      /** 띄운 프로세스. POSIX는 새 프로세스 그룹으로 띄워 그룹째 끝낼 수 있게 한다. */
      const child = spawn(viaCmd ? [`"${request.command}"`, ...request.args].join(' ') : request.command, viaCmd ? [] : request.args, {
        cwd: request.cwd,
        env: request.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: !isWindows,
        windowsHide: true,
        shell: viaCmd,
      });

      /** 받은 표준 출력. */
      let stdout = '';
      /** 받은 표준 오류. */
      let stderr = '';
      /** 이미 결과를 돌려줬는지 여부. */
      let settled = false;
      /** 끝난 뒤 출력이 닫히기를 기다리는 타이머. */
      let graceTimer: NodeJS.Timeout | null = null;

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdout = appendCapped(stdout, chunk);
      });
      child.stderr.on('data', (chunk: string) => {
        stderr = appendCapped(stderr, chunk);
      });

      /** 결과를 한 번만 돌려주고 타이머와 출력을 정리한다. */
      const settle = (result: ProcessResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutTimer);
        if (graceTimer) clearTimeout(graceTimer);
        child.stdout.destroy();
        child.stderr.destroy();
        resolve(result);
      };

      /** 제한 시간 타이머. 넘기면 프로세스 트리를 끝낸다. */
      const timeoutTimer = setTimeout(() => {
        killTree(child.pid);
        settle({ kind: 'timed-out', stdout, stderr });
      }, request.timeoutMs);

      child.on('error', (error) => settle({ kind: 'spawn-failed', message: error.message }));
      child.on('exit', (code) => {
        graceTimer = setTimeout(() => settle({ kind: 'exited', exitCode: code, stdout, stderr }), CLOSE_GRACE_MS);
      });
      child.on('close', (code) => settle({ kind: 'exited', exitCode: code, stdout, stderr }));
    });
  }
}

/** 상한을 넘지 않게 출력을 이어 붙인다. */
function appendCapped(current: string, chunk: string): string {
  if (current.length >= OUTPUT_MAX_LENGTH) return current;
  return (current + chunk).slice(0, OUTPUT_MAX_LENGTH);
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
