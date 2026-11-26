import { readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** 진단 보고서의 실행 정보에 적는 저장소의 git 상태. */
export interface RepoGitState {
  /** HEAD 커밋 해시. git 저장소가 아니거나 읽지 못하면 `null`. */
  headCommit: string | null;
  /** 커밋하지 않은 변경이 있는지. 모르면(git을 부를 수 없음 등) `null`. */
  uncommittedChanges: boolean | null;
}

/** `git status --porcelain`의 출력을 돌려주는 함수. git을 부를 수 없거나 실패하면 `null`. */
export type GitStatusReader = (repository: string) => Promise<string | null>;

/** 커밋 해시 모양. SHA-1(40자)과 SHA-256(64자) 저장소를 모두 받는다. */
const COMMIT_HASH = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/**
 * 저장소의 HEAD 커밋 해시와 커밋하지 않은 변경 유무를 읽는다. HEAD는 git을 부르지 않고 `.git` 파일을 직접 읽어
 * (worktree의 `.git` 파일과 `packed-refs` 포함) git이 없는 PC에서도 적는다. 변경 유무는 `readStatus`에 맡긴다.
 */
export async function readRepoGitState(repository: string, readStatus: GitStatusReader): Promise<RepoGitState> {
  /** HEAD 해시와 상태 출력. 서로 기다리지 않는다. */
  const [headCommit, status] = await Promise.all([readHeadCommit(repository).catch(() => null), readStatus(repository).catch(() => null)]);
  return { headCommit, uncommittedChanges: status === null ? null : status.trim() !== '' };
}

/** `.git`을 따라 HEAD 커밋 해시를 읽는다. 저장소 루트의 `.git`만 본다(위 폴더로 올라가지 않는다). */
async function readHeadCommit(repository: string): Promise<string | null> {
  /** git 폴더. worktree면 `.git` 파일이 가리키는 폴더다. */
  const gitDir = await gitDirOf(repository);
  if (gitDir === null) return null;
  /** 공통 폴더. worktree는 refs와 packed-refs를 여기에 둔다. */
  const commonDir = await readText(join(gitDir, 'commondir')).then((text) => (text === null ? gitDir : resolve(gitDir, text.trim())));
  /** HEAD 내용. */
  const head = (await readText(join(gitDir, 'HEAD')))?.trim();
  if (!head) return null;
  if (COMMIT_HASH.test(head)) return head;
  /** HEAD가 가리키는 ref. */
  const ref = /^ref: (refs\/\S+)$/.exec(head)?.[1];
  if (!ref) return null;
  for (const dir of [gitDir, commonDir]) {
    /** 느슨한 ref 파일의 해시. */
    const loose = (await readText(join(dir, ref)))?.trim();
    if (loose && COMMIT_HASH.test(loose)) return loose;
  }
  /** 묶인 ref 목록. */
  const packed = await readText(join(commonDir, 'packed-refs'));
  for (const line of packed?.split('\n') ?? []) {
    /** `해시 ref` 한 줄. */
    const [hash, name] = line.trim().split(' ');
    if (name === ref && hash && COMMIT_HASH.test(hash)) return hash;
  }
  return null;
}

/** 저장소의 git 폴더. `.git`이 폴더면 그것, `gitdir:` 파일이면 그 경로다. 없으면 `null`. */
async function gitDirOf(repository: string): Promise<string | null> {
  /** `.git`의 경로. */
  const dotGit = join(repository, '.git');
  /** `.git`의 종류. */
  const info = await stat(dotGit).catch(() => null);
  if (!info) return null;
  if (info.isDirectory()) return dotGit;
  /** `gitdir: <경로>` 한 줄. */
  const pointer = /^gitdir: (.+)$/m.exec((await readText(dotGit)) ?? '')?.[1]?.trim();
  if (!pointer) return null;
  return isAbsolute(pointer) ? pointer : resolve(dirname(dotGit), pointer);
}

/** 파일을 글로 읽는다. 없거나 읽지 못하면 `null`. */
async function readText(path: string): Promise<string | null> {
  return readFile(path, 'utf8').catch(() => null);
}
