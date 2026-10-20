import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findRepoCandidates, rejectedFolderReason } from './repo-candidates';

/** 테스트마다 만드는 임시 폴더. */
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stardraft-repos-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** `root` 아래 상대 경로에 `.git` 디렉터리가 있는 가짜 저장소를 만든다. */
async function repo(relative: string): Promise<string> {
  const dir = join(root, relative);
  await mkdir(join(dir, '.git'), { recursive: true });
  return dir;
}

/** `root` 아래 상대 경로에 `.git` 파일만 있는 가짜 worktree를 만든다. */
async function worktree(relative: string): Promise<string> {
  const dir = join(root, relative);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, '.git'), 'gitdir: /somewhere/.git/worktrees/feature\n');
  return dir;
}

describe('후보 찾기', () => {
  it('3단계 깊이까지의 저장소를 찾고, 그보다 깊은 저장소는 찾지 않는다', async () => {
    const one = await repo('api');
    const two = await repo('team/web');
    const three = await repo('org/team/mobile');
    await repo('a/b/c/too-deep');

    expect(await findRepoCandidates(root)).toEqual({
      status: 'found',
      repos: [
        { name: 'api', path: one },
        { name: 'org/team/mobile', path: three },
        { name: 'team/web', path: two },
      ],
    });
  });

  it('worktree의 .git 파일도 저장소로 센다', async () => {
    const dir = await worktree('feature-wt');

    expect(await findRepoCandidates(root)).toEqual({ status: 'found', repos: [{ name: 'feature-wt', path: dir }] });
  });

  it('저장소 안으로는 내려가지 않는다', async () => {
    const outer = await repo('outer');
    await repo('outer/packages/inner');

    expect(await findRepoCandidates(root)).toEqual({ status: 'found', repos: [{ name: 'outer', path: outer }] });
  });

  it('숨김 폴더와 node_modules는 건너뛴다', async () => {
    await repo('.cache/hidden');
    await repo('node_modules/dep');
    await repo('app/node_modules/dep');
    const kept = await repo('kept');

    expect(await findRepoCandidates(root)).toEqual({ status: 'found', repos: [{ name: 'kept', path: kept }] });
  });

  it('고른 폴더 자체가 저장소면 그 하나만 센다', async () => {
    const self = await repo('self');
    await repo('self/vendor/nested');

    expect(await findRepoCandidates(self)).toEqual({ status: 'found', repos: [{ name: 'self', path: self }] });
  });

  it('저장소가 없으면 빈 목록이다', async () => {
    await mkdir(join(root, 'docs/notes'), { recursive: true });

    expect(await findRepoCandidates(root)).toEqual({ status: 'found', repos: [] });
  });

  it('폴더가 없으면 찾을 수 없다고 알린다', async () => {
    expect(await findRepoCandidates(join(root, 'gone'))).toEqual({ status: 'missing' });
  });
});

describe('받지 않는 작업 폴더', () => {
  it('네트워크 경로는 받지 않는다', () => {
    expect(rejectedFolderReason('\\\\server\\share\\code')).toBe('network');
    expect(rejectedFolderReason('\\\\?\\UNC\\server\\share')).toBe('network');
  });

  it('WSL 경로는 받지 않는다', () => {
    expect(rejectedFolderReason('\\\\wsl.localhost\\Ubuntu\\home\\me')).toBe('wsl');
    expect(rejectedFolderReason('\\\\wsl$\\Ubuntu\\home\\me')).toBe('wsl');
  });

  it('로컬 절대 경로는 받는다', () => {
    expect(rejectedFolderReason('C:\\Users\\me\\workspace')).toBeNull();
    expect(rejectedFolderReason('\\\\?\\C:\\Users\\me\\workspace')).toBeNull();
    expect(rejectedFolderReason('/Users/me/workspace')).toBeNull();
  });
});
