import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { createLogger } from '../logging/logger';
import type { Settings } from '../ports/settings-store';
import { WorkFolders } from './work-folders';

/** 테스트마다 만드는 가짜 홈 폴더. */
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'stardraft-home-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** 홈 아래 상대 경로에 가짜 저장소를 만든다. */
async function repo(relative: string): Promise<string> {
  const dir = join(home, relative);
  await mkdir(join(dir, '.git'), { recursive: true });
  return dir;
}

/** 홈 아래에 빈 폴더를 만든다. */
async function folder(relative: string): Promise<string> {
  const dir = join(home, relative);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** 설정으로 작업 폴더를 만들고 저장된 작업 폴더를 읽어 둔다. */
async function setup(settings: Partial<Settings> = {}) {
  const settingsStore = new MemorySettingsStore(settings);
  const workFolders = new WorkFolders({ settingsStore, logger: createLogger([], new FakeClock()), homeDir: home });
  await workFolders.load();
  /** 상태가 바뀐 횟수. */
  const changes = { count: 0 };
  workFolders.onChange(() => (changes.count += 1));
  return { settingsStore, workFolders, changes };
}

describe('작업 폴더 추가', () => {
  it('고른 폴더 여러 개를 절대 경로로 저장하고 바로 훑어 저장소를 보인다', async () => {
    const work = await folder('work');
    const api = await repo('work/api');
    const web = await repo('work/team/web');
    const solo = await repo('solo');
    const { settingsStore, workFolders, changes } = await setup();

    await workFolders.add([work, join(solo, '..', 'solo')]);

    expect(settingsStore.settings.workFolders).toEqual([work, solo]);
    expect(workFolders.state().folders).toEqual([
      {
        path: work,
        scan: {
          status: 'found',
          repos: [
            { name: 'api', path: api },
            { name: 'team/web', path: web },
          ],
        },
      },
      { path: solo, scan: { status: 'found', repos: [{ name: 'solo', path: solo }] } },
    ]);
    expect(changes.count).toBeGreaterThan(0);
  });

  it('저장소가 0개인 폴더도 추가한다', async () => {
    const empty = await folder('empty');
    const { settingsStore, workFolders } = await setup();

    await workFolders.add([empty]);

    expect(settingsStore.settings.workFolders).toEqual([empty]);
    expect(workFolders.state().folders).toEqual([{ path: empty, scan: { status: 'found', repos: [] } }]);
  });

  it('이미 있는 폴더는 다시 더하지 않는다', async () => {
    const work = await folder('work');
    const { settingsStore, workFolders } = await setup({ workFolders: [work] });

    await workFolders.add([work, work]);

    expect(settingsStore.settings.workFolders).toEqual([work]);
  });

  it('네트워크·WSL 경로는 이유를 남기고 받지 않으며, 함께 고른 다른 폴더는 받는다', async () => {
    const work = await folder('work');
    const { settingsStore, workFolders } = await setup();

    await workFolders.add(['\\\\server\\share', '\\\\wsl.localhost\\Ubuntu\\home\\me', work]);

    expect(settingsStore.settings.workFolders).toEqual([work]);
    expect(workFolders.state().rejected).toEqual([
      { path: '\\\\server\\share', reason: 'network' },
      { path: '\\\\wsl.localhost\\Ubuntu\\home\\me', reason: 'wsl' },
    ]);

    await workFolders.add([await folder('next')]);

    expect(workFolders.state().rejected).toEqual([]);
  });
});

describe('작업 폴더 지우기', () => {
  it('목록에서만 지우고 그 안을 가리키는 매핑은 그대로 둔다', async () => {
    const work = await folder('work');
    const api = await repo('work/api');
    const { settingsStore, workFolders } = await setup({ workFolders: [work], repoMappings: { '42': [api] } });

    await workFolders.remove(work);

    expect(settingsStore.settings.workFolders).toEqual([]);
    expect(settingsStore.settings.repoMappings).toEqual({ '42': [api] });
    expect(workFolders.state().folders).toEqual([]);
  });
});

describe('저장된 작업 폴더', () => {
  it('읽을 때 훑고, 사라진 폴더는 찾을 수 없다고 보인다', async () => {
    const api = await repo('work/api');
    const gone = join(home, 'gone');
    const { workFolders } = await setup({ workFolders: [join(home, 'work'), gone] });

    expect(workFolders.state().folders).toEqual([
      { path: join(home, 'work'), scan: { status: 'found', repos: [{ name: 'api', path: api }] } },
      { path: gone, scan: { status: 'missing' } },
    ]);
  });

  it('다시 훑으면 새로 생긴 저장소가 보인다', async () => {
    const work = await folder('work');
    const { workFolders } = await setup({ workFolders: [work] });
    const api = await repo('work/api');

    await workFolders.refresh();

    expect(workFolders.state().folders[0]?.scan).toEqual({ status: 'found', repos: [{ name: 'api', path: api }] });
  });
});

describe('이 PC에서 찾은 폴더', () => {
  it('홈 아래 흔한 이름의 폴더 가운데 저장소가 든 폴더를 저장소 수와 함께 제안한다', async () => {
    await repo('workspace/a');
    await repo('workspace/b');
    await repo('IdeaProjects/c');
    await folder('projects/notes');
    await repo('random/d');
    const { workFolders } = await setup();

    expect(workFolders.state().suggestions).toEqual([
      { path: join(home, 'workspace'), repoCount: 2 },
      { path: join(home, 'IdeaProjects'), repoCount: 1 },
    ]);
  });

  it('이미 작업 폴더인 곳은 제안하지 않는다', async () => {
    await repo('workspace/a');
    await repo('code/b');
    const { workFolders } = await setup({ workFolders: [join(home, 'workspace')] });

    expect(workFolders.state().suggestions).toEqual([{ path: join(home, 'code'), repoCount: 1 }]);
  });

  it('[추가]를 누르면 작업 폴더가 되고 제안에서 빠진다', async () => {
    const dev = join(home, 'dev');
    await repo('dev/a');
    const { settingsStore, workFolders } = await setup();

    await workFolders.addSuggestion(dev);

    expect(settingsStore.settings.workFolders).toEqual([dev]);
    expect(workFolders.state().suggestions).toEqual([]);
  });

  it('제안에 없는 경로는 [추가]로 받지 않는다', async () => {
    const other = await repo('random/d');
    const { settingsStore, workFolders } = await setup();

    await workFolders.addSuggestion(other);

    expect(settingsStore.settings.workFolders).toEqual([]);
  });
});
