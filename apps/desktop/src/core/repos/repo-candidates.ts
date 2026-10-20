import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';

/** 작업 폴더에서 저장소를 찾는 깊이. 고른 폴더 바로 아래가 1단계다. */
export const REPO_SCAN_DEPTH = 3;

/** 작업 폴더에서 찾은 저장소 하나. */
export interface RepoCandidate {
  /** 화면에 보일 이름. 작업 폴더에서의 상대 경로이고, 작업 폴더 자체가 저장소면 폴더 이름이다. */
  name: string;
  /** 저장소의 절대 경로. */
  path: string;
}

/** 작업 폴더 하나를 훑은 결과. */
export type RepoScanResult =
  /** 훑기를 마쳤다. 저장소가 없으면 빈 목록이다. */
  | { status: 'found'; repos: RepoCandidate[] }
  /** 작업 폴더가 없거나 읽을 수 없다. */
  | { status: 'missing' };

/** 작업 폴더로 받지 않는 경로의 이유. `network`는 네트워크 경로, `wsl`은 WSL 경로다. */
export type RejectedFolderReason = 'network' | 'wsl';

/**
 * 작업 폴더에서 저장소 후보를 찾는다.
 * `.git` 디렉터리나 worktree의 `.git` 파일이 있으면 저장소로 보고 그 안으로는 내려가지 않는다.
 * 숨김 폴더와 `node_modules`는 건너뛴다. 폴더를 가리키는 심볼릭 링크는 그 자체가 저장소일 때만 세고, 순환을 막으려고 그 안으로는 내려가지 않는다.
 */
export async function findRepoCandidates(folder: string): Promise<RepoScanResult> {
  /** 작업 폴더 바로 아래 항목. */
  let entries: Dirent[];
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return { status: 'missing' };
  }
  if (await hasGitEntry(folder, entries)) return { status: 'found', repos: [{ name: basename(folder), path: folder }] };

  /** 찾은 저장소의 절대 경로. */
  const found: string[] = [];
  await collectRepos(folder, entries, 1, found);
  return {
    status: 'found',
    repos: found.map((path) => ({ name: relative(folder, path), path })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** `entries`의 하위 폴더 가운데 `depth`단계에 있는 저장소를 `found`에 모으고, 저장소가 아니면 깊이 제한까지 내려간다. */
async function collectRepos(dir: string, entries: readonly Dirent[], depth: number, found: string[]): Promise<void> {
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    /** 하위 폴더 경로. */
    const child = join(dir, entry.name);
    /** 심볼릭 링크인지 여부. */
    const linked = entry.isSymbolicLink();
    if (!entry.isDirectory() && !(linked && (await isDirectory(child)))) continue;
    /** 하위 폴더의 항목. */
    let childEntries: Dirent[];
    try {
      childEntries = await readdir(child, { withFileTypes: true });
    } catch {
      // 권한이 없는 폴더는 건너뛴다.
      continue;
    }
    if (await hasGitEntry(child, childEntries)) found.push(child);
    else if (!linked && depth < REPO_SCAN_DEPTH) await collectRepos(child, childEntries, depth + 1, found);
  }
}

/** 경로가 (링크를 따라가서) 폴더인지 본다. 깨진 링크는 폴더가 아니다. */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** 폴더에 `.git` 디렉터리나 `gitdir:`로 시작하는 `.git` 파일(worktree, 서브모듈)이 있는지 본다. */
async function hasGitEntry(dir: string, entries: readonly Dirent[]): Promise<boolean> {
  /** `.git` 항목. */
  const git = entries.find((entry) => entry.name === '.git');
  if (!git) return false;
  if (git.isDirectory()) return true;
  if (!git.isFile()) return false;
  try {
    return (await readFile(join(dir, '.git'), 'utf8')).startsWith('gitdir:');
  } catch {
    return false;
  }
}

/**
 * 작업 폴더로 받지 않는 경로인지 본다. 받으면 `null`이다.
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
