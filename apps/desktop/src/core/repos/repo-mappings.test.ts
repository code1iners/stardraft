import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeFlowApi } from '../fakes/fake-flow-api';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { createLogger } from '../logging/logger';
import type { FlowProject } from '../ports/flow-api';
import type { Settings } from '../ports/settings-store';
import { RepoMappings, type FlowConnection } from './repo-mappings';
import { WorkFolders } from './work-folders';

/** 테스트마다 만드는 가짜 홈 폴더. */
let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'stardraft-mapping-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

/** 홈 아래에 폴더를 만든다. */
async function folder(relative: string): Promise<string> {
  const dir = join(home, relative);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** 가짜 참여 Flow 프로젝트. 실제 회사 데이터가 아니다. */
const PROJECT_A: FlowProject = { projectId: '101', title: '가짜 프로젝트 A', projectUrl: 'https://flow.example.test/p/101' };
const PROJECT_B: FlowProject = { projectId: '102', title: '가짜 프로젝트 B', projectUrl: null };

/** 설정과 가짜 Flow로 저장소 매핑을 만들고 저장된 매핑을 읽어 둔다. `flow`가 `null`이면 키가 없는 상태다. */
async function setup(settings: Partial<Settings> = {}, flow: FakeFlowApi | null = withProjects([PROJECT_A, PROJECT_B])) {
  const settingsStore = new MemorySettingsStore(settings);
  /** Flow가 키를 거부했다고 알린 횟수. */
  const rejected = { count: 0 };
  /** 지금 키로 부르는 Flow. */
  const connection: FlowConnection | null = flow && { api: flow, reportKeyRejected: () => (rejected.count += 1) };
  const mappings = new RepoMappings({ settingsStore, logger: createLogger([], new FakeClock()), connectFlow: () => connection });
  await mappings.load();
  return { settingsStore, mappings, rejected, flow };
}

/** 참여 프로젝트로 이 목록을 돌려주는 가짜 Flow. */
function withProjects(projects: FlowProject[]): FakeFlowApi {
  const flow = new FakeFlowApi();
  flow.respondToListParticipantProjects({ ok: true, value: projects });
  return flow;
}

describe('참여 Flow 프로젝트 목록', () => {
  it('GET /user/projects/participants로 받은 프로젝트를 고를 목록으로 보이고, 매핑에 이름과 주소를 붙인다', async () => {
    const api = await folder('api');
    const { mappings, flow } = await setup({ repoMappings: { '101': [api] } });

    await mappings.refresh();

    expect(flow?.requests).toEqual(['GET /user/projects/participants']);
    expect(mappings.state().projects).toEqual({ status: 'loaded', projects: [PROJECT_A, PROJECT_B] });
    expect(mappings.state().mappings).toEqual([
      {
        projectId: '101',
        title: '가짜 프로젝트 A',
        projectUrl: 'https://flow.example.test/p/101',
        repos: [{ path: api, status: 'found' }],
        missing: false,
      },
    ]);
  });

  it('키가 없으면 부르지 않고 키가 없다고 보인다', async () => {
    const { mappings } = await setup({}, null);

    await mappings.refresh();

    expect(mappings.state().projects).toEqual({ status: 'failed', reason: 'no-key' });
  });

  it('Flow가 키를 거부하면 실패를 보이고 키 확인 필요를 알린다', async () => {
    const flow = new FakeFlowApi();
    flow.respondToListParticipantProjects({ ok: false, failure: { kind: 'unauthorized' } });
    const { mappings, rejected } = await setup({}, flow);

    await mappings.refresh();

    expect(mappings.state().projects).toEqual({ status: 'failed', reason: 'unauthorized' });
    expect(rejected.count).toBe(1);
  });

  it('연결 실패는 실패 이유만 보이고 저장된 매핑은 그대로 보인다', async () => {
    const api = await folder('api');
    const flow = new FakeFlowApi();
    flow.respondToListParticipantProjects({ ok: false, failure: { kind: 'network' } });
    const { mappings } = await setup({ repoMappings: { '101': [api] } }, flow);

    await mappings.refresh();

    expect(mappings.state().projects).toEqual({ status: 'failed', reason: 'network' });
    expect(mappings.state().mappings).toEqual([
      { projectId: '101', title: null, projectUrl: null, repos: [{ path: api, status: 'found' }], missing: false },
    ]);
  });
});

describe('저장소 연결', () => {
  it('Flow 프로젝트 하나에 저장소를 여러 개 연결하고 projectId를 키로 절대 경로를 저장한다', async () => {
    const api = await folder('work/api');
    const web = await folder('work/web');
    const { settingsStore, mappings } = await setup();
    await mappings.refresh();

    await mappings.addRepos('101', [api, join(web, '..', 'web')]);
    await mappings.addRepos('101', [api]);

    expect(settingsStore.settings.repoMappings).toEqual({ '101': [api, web] });
    expect(mappings.state().mappings[0]?.repos).toEqual([
      { path: api, status: 'found' },
      { path: web, status: 'found' },
    ]);
  });

  it('git 저장소가 아닌 코드 폴더도 연결한다', async () => {
    const plain = await folder('plain-code');
    await writeFile(join(plain, 'main.ts'), '');
    const { settingsStore, mappings } = await setup();
    await mappings.refresh();

    await mappings.addRepos('102', [plain]);

    expect(settingsStore.settings.repoMappings).toEqual({ '102': [plain] });
  });

  it('참여 목록에도 저장된 매핑에도 없는 Flow 프로젝트에는 연결하지 않는다', async () => {
    const api = await folder('api');
    const { settingsStore, mappings } = await setup();
    await mappings.refresh();

    await mappings.addRepos('999', [api]);

    expect(settingsStore.settings.repoMappings).toEqual({});
  });

  it('저장소 하나를 지우고, 마지막 저장소를 지우면 매핑도 없앤다', async () => {
    const api = await folder('api');
    const web = await folder('web');
    const { settingsStore, mappings } = await setup({ repoMappings: { '101': [api, web], '102': [web] } });

    await mappings.removeRepo('101', api);
    expect(settingsStore.settings.repoMappings).toEqual({ '101': [web], '102': [web] });

    await mappings.removeRepo('101', web);
    expect(settingsStore.settings.repoMappings).toEqual({ '102': [web] });
  });

  it('매핑을 통째로 지운다', async () => {
    const api = await folder('api');
    const { settingsStore, mappings } = await setup({ repoMappings: { '101': [api], '102': [api] } });

    await mappings.removeMapping('101');

    expect(settingsStore.settings.repoMappings).toEqual({ '102': [api] });
    expect(mappings.state().mappings.map((mapping) => mapping.projectId)).toEqual(['102']);
  });

  it('저장 직전에 설정을 다시 읽어 다른 칸의 변경을 덮지 않는다', async () => {
    const api = await folder('api');
    const { settingsStore, mappings } = await setup();
    await mappings.refresh();
    settingsStore.settings.workFolders = [home];

    await mappings.addRepos('101', [api]);

    expect(settingsStore.settings.workFolders).toEqual([home]);
  });
});

describe('사라진 폴더', () => {
  it('연결된 폴더 중 하나라도 없으면 그 저장소와 매핑을 폴더를 찾을 수 없음으로 보인다', async () => {
    const api = await folder('api');
    const gone = join(home, 'gone');
    const { mappings } = await setup({ repoMappings: { '101': [api, gone] } });

    await mappings.refresh();

    expect(mappings.state().mappings[0]).toEqual(
      expect.objectContaining({
        repos: [
          { path: api, status: 'found' },
          { path: gone, status: 'missing' },
        ],
        missing: true,
      }),
    );
  });

  it('폴더 대신 파일이 있으면 없는 것으로 본다', async () => {
    const file = join(home, 'not-a-folder');
    await writeFile(file, '');
    const { mappings } = await setup({ repoMappings: { '101': [file] } });

    await mappings.refresh();

    expect(mappings.state().mappings[0]?.missing).toBe(true);
  });

  it('다시 훑으면 지워진 폴더를 찾을 수 없음으로 바꾼다', async () => {
    const api = await folder('api');
    const { mappings } = await setup({ repoMappings: { '101': [api] } });
    await mappings.refresh();
    expect(mappings.state().mappings[0]?.missing).toBe(false);

    await rm(api, { recursive: true });
    await mappings.refresh();

    expect(mappings.state().mappings[0]?.repos).toEqual([{ path: api, status: 'missing' }]);
  });

  it('작업 폴더를 지워도 그 안을 가리키는 매핑은 그대로 남는다', async () => {
    const work = await folder('work');
    const api = await folder('work/api');
    const settingsStore = new MemorySettingsStore({ workFolders: [work], repoMappings: { '101': [api] } });
    const logger = createLogger([], new FakeClock());
    const workFolders = new WorkFolders({ settingsStore, logger, homeDir: home });
    const mappings = new RepoMappings({ settingsStore, logger, connectFlow: () => null });
    await Promise.all([workFolders.load(), mappings.load()]);

    await workFolders.remove(work);
    await mappings.refresh();

    expect(settingsStore.settings.repoMappings).toEqual({ '101': [api] });
    expect(mappings.state().mappings[0]?.repos).toEqual([{ path: api, status: 'found' }]);
  });
});

describe('저장된 매핑 읽기', () => {
  it('형식이 맞지 않는 값은 건너뛴다', async () => {
    const api = await folder('api');
    const broken = { '101': [api, 3, ''], '102': 'not-a-list', '103': [] } as unknown as Settings['repoMappings'];
    const { mappings } = await setup({ repoMappings: broken }, null);

    expect(mappings.state().mappings).toEqual([
      { projectId: '101', title: null, projectUrl: null, repos: [{ path: api, status: 'checking' }], missing: false },
    ]);
  });
});
