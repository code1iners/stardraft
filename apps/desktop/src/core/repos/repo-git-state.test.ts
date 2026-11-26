import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readRepoGitState } from './repo-git-state';

/** 시험이 만든 임시 폴더. */
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더를 만든다. */
function makeDir(): string {
  /** 만든 폴더. */
  const dir = mkdtempSync(join(tmpdir(), 'repo-git-state-'));
  tempDirs.push(dir);
  return dir;
}

/** 가짜 커밋 해시. */
const HASH_A = 'a'.repeat(40);
const HASH_B = 'b'.repeat(40);

describe('저장소 git 상태', () => {
  it('브랜치 ref 파일에서 HEAD 해시를 읽고, 상태 출력이 있으면 커밋하지 않은 변경이 있다', async () => {
    const repo = makeDir();
    mkdirSync(join(repo, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(join(repo, '.git', 'refs', 'heads', 'main'), `${HASH_A}\n`);

    expect(await readRepoGitState(repo, async () => ' M src/a.ts\n')).toEqual({ headCommit: HASH_A, uncommittedChanges: true });
    expect(await readRepoGitState(repo, async () => '')).toEqual({ headCommit: HASH_A, uncommittedChanges: false });
  });

  it('묶인 ref와 떨어진 HEAD도 읽는다', async () => {
    const packed = makeDir();
    mkdirSync(join(packed, '.git'));
    writeFileSync(join(packed, '.git', 'HEAD'), 'ref: refs/heads/dev\n');
    writeFileSync(join(packed, '.git', 'packed-refs'), `# pack-refs with: peeled\n${HASH_A} refs/heads/main\n${HASH_B} refs/heads/dev\n`);
    const detached = makeDir();
    mkdirSync(join(detached, '.git'));
    writeFileSync(join(detached, '.git', 'HEAD'), `${HASH_B}\n`);

    expect((await readRepoGitState(packed, async () => null)).headCommit).toBe(HASH_B);
    expect((await readRepoGitState(detached, async () => null)).headCommit).toBe(HASH_B);
  });

  it('worktree의 .git 파일을 따라가 공통 폴더의 ref를 읽는다', async () => {
    const main = makeDir();
    mkdirSync(join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    mkdirSync(join(main, '.git', 'refs', 'heads'), { recursive: true });
    writeFileSync(join(main, '.git', 'refs', 'heads', 'topic'), `${HASH_A}\n`);
    writeFileSync(join(main, '.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/topic\n');
    writeFileSync(join(main, '.git', 'worktrees', 'wt', 'commondir'), '../..\n');
    const worktree = makeDir();
    writeFileSync(join(worktree, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n`);

    expect((await readRepoGitState(worktree, async () => null)).headCommit).toBe(HASH_A);
  });

  it('git 저장소가 아니거나 git을 부를 수 없으면 모름이다', async () => {
    expect(await readRepoGitState(makeDir(), async () => null)).toEqual({ headCommit: null, uncommittedChanges: null });
  });
});
