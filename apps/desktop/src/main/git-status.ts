import { execFile } from 'node:child_process';
import type { GitStatusReader } from '../core/repos/repo-git-state';

/** git 상태를 읽을 때 기다리는 최대 시간(밀리초). 큰 저장소에서도 진단 시작을 오래 막지 않는다. */
const GIT_STATUS_TIMEOUT_MS = 10_000;
/** `git status` 출력의 최대 크기(바이트). 변경 유무만 보므로 넘으면 그때까지 받은 출력(변경 있음)으로 판정한다. */
const GIT_STATUS_MAX_BUFFER = 1024 * 1024;

/**
 * `git status --porcelain`으로 커밋하지 않은 변경을 읽는 함수를 만든다. 실패하면 `null`(모름)이다.
 * macOS에서는 Command Line Tools가 없을 때 `/usr/bin/git`이 설치 창을 띄우므로, `xcode-select -p`로 개발 도구가 있을 때만 부른다.
 */
export function gitStatusReader(platform: NodeJS.Platform): GitStatusReader {
  /** macOS에서 개발 도구가 있는지. 한 번만 확인한다. */
  let toolsReady: Promise<boolean> | null = null;
  return async (repository) => {
    if (platform === 'darwin') {
      toolsReady ??= run('/usr/bin/xcode-select', ['-p'], '/').then((output) => output !== null);
      if (!(await toolsReady)) return null;
    }
    return run(platform === 'darwin' ? '/usr/bin/git' : 'git', ['-C', repository, 'status', '--porcelain', '--untracked-files=normal'], repository);
  };
}

/** 명령을 셸 없이 실행해 표준 출력을 돌려준다. 실패하면 `null`. */
function run(command: string, args: string[], cwd: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, timeout: GIT_STATUS_TIMEOUT_MS, maxBuffer: GIT_STATUS_MAX_BUFFER, windowsHide: true }, (error, stdout) => {
      // 출력이 상한을 넘었으면 변경이 아주 많은 것이므로 받은 출력을 그대로 쓴다.
      if (error && (error as NodeJS.ErrnoException).code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') resolve(null);
      else resolve(stdout);
    });
  });
}
