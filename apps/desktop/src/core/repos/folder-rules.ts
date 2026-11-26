/** 저장소 폴더로 받지 않는 경로의 이유. `network`는 네트워크 경로, `wsl`은 WSL 경로다. */
export type RejectedFolderReason = 'network' | 'wsl';

/** 받지 않은 폴더 하나. */
export interface RejectedFolder {
  /** 고른 경로. */
  path: string;
  /** 받지 않은 이유. */
  reason: RejectedFolderReason;
}

/**
 * 저장소 폴더로 받지 않는 경로인지 본다. 받으면 `null`이다.
 * `\\wsl.localhost\…`, `\\wsl$\…`는 WSL 경로, 그 밖의 `\\server\share`와 `\\?\UNC\…`는 네트워크 경로다.
 * `\\?\C:\…`처럼 드라이브를 가리키는 긴 경로는 로컬이다.
 * 폴더 선택 창은 Windows 경로를 `\`로 돌려주므로 `\\`로 시작할 때만 본다. POSIX의 `//foo`는 로컬 경로다.
 */
export function rejectedFolderReason(path: string): RejectedFolderReason | null {
  if (!path.startsWith('\\\\')) return null;
  /** 구분자를 `/`로 맞춘 경로. */
  const unified = path.replaceAll('\\', '/');
  /** `//` 뒤의 경로. 장치 경로 접두어(`?/`, `./`)는 떼고 본다. */
  let rest = unified.slice(2);
  if (/^[?.]\//.test(rest)) {
    rest = rest.slice(2);
    if (/^[a-z]:/i.test(rest)) return null;
    if (/^unc\//i.test(rest)) rest = rest.slice(4);
  }
  return /^wsl(\.localhost|\$)\//i.test(rest) ? 'wsl' : 'network';
}

/** 고른 폴더를 받을 것과 받지 않을 것으로 나눈다. */
export function splitRejectedFolders(paths: readonly string[]): { accepted: string[]; rejected: RejectedFolder[] } {
  /** 받을 폴더. */
  const accepted: string[] = [];
  /** 받지 않은 폴더. */
  const rejected: RejectedFolder[] = [];
  for (const path of paths) {
    /** 받지 않는 이유. */
    const reason = rejectedFolderReason(path);
    if (reason) rejected.push({ path, reason });
    else accepted.push(path);
  }
  return { accepted, rejected };
}
