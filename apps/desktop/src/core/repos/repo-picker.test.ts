import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MentionBundle } from '../bundles/mention-bundle';
import type { Draft } from '../drafts/draft';
import { FakeClock } from '../fakes/fake-clock';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { createLogger } from '../logging/logger';
import type { RepoCandidate } from './repo-candidates';
import { RepoMappings } from './repo-mappings';
import { RepoPicker } from './repo-picker';

/** 멘션이 온 Flow 프로젝트. */
const PROJECT_ID = '900001';
/** 다른 Flow 프로젝트. */
const OTHER_PROJECT_ID = '900002';

/** 테스트마다 만드는 임시 폴더. 가짜 저장소를 둔다. */
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'stardraft-picker-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** 임시 폴더 아래에 가짜 저장소 폴더를 만들고 절대 경로를 돌려준다. */
async function repo(relative: string): Promise<string> {
  const dir = join(root, relative);
  await mkdir(dir, { recursive: true });
  return dir;
}

/** 저장소 둘을 읽어 만든 가짜 초안. */
function draft(repositories: string[]): Draft {
  return {
    requirement: { text: '재시도 횟수를 알고 싶다.', summary: '재시도 횟수' },
    paragraphs: [{ sentences: [{ text: '다섯 번 다시 시도합니다.', evidence: [] }] }],
    evidence: [],
    repositories,
    autoSelection: null,
    createdAt: 1_000,
  };
}

/** 가짜 멘션 묶음. 기본은 초안이 없는 저장소 확인 필요 묶음이다. */
function bundle(overrides: Partial<MentionBundle> = {}): MentionBundle {
  return {
    id: 7,
    postId: '90000011',
    remarkId: '700',
    projectId: PROJECT_ID,
    status: 'repo-check-needed',
    postTitle: '가짜 게시물',
    connectUrl: null,
    mentions: [],
    answers: [],
    newMentionCount: 0,
    createdAt: 1_000,
    processedAt: null,
    context: null,
    repoCheck: null,
    userRepos: null,
    draft: null,
    editedText: null,
    removedRecipients: [],
    instructions: [],
    fixedRequirement: null,
    regeneration: null,
    failure: null,
    runs: [],
    ...overrides,
  };
}

/** 가짜 설정 저장소 위의 저장소 매핑과 저장소 선택 창을 만든다. 작업 폴더의 후보와 묶음은 테스트가 준다. */
async function setup(options: { bundle: MentionBundle; workFolderRepos?: RepoCandidate[]; repoMappings?: Record<string, string[]> }) {
  const settingsStore = new MemorySettingsStore({ repoMappings: options.repoMappings ?? {} });
  const mappings = new RepoMappings({ settingsStore, logger: createLogger([], new FakeClock()), connectFlow: () => null });
  await mappings.load();
  await mappings.refresh();
  /** 지금 묶음. 테스트가 바꿀 수 있다. */
  const current = { bundle: options.bundle };
  /** 다시 만들기를 요청한 구성. */
  const regenerated: { bundleId: number; repos: string[] }[] = [];
  const picker = new RepoPicker({
    bundle: (bundleId) => (current.bundle.id === bundleId ? current.bundle : null),
    mappings,
    findWorkFolderRepos: async () => options.workFolderRepos ?? [],
    regenerate: async (bundleId, repos) => {
      regenerated.push({ bundleId, repos: [...repos] });
    },
  });
  return { settingsStore, mappings, picker, current, regenerated };
}

describe('저장소 선택 창의 후보', () => {
  it('준비됨 묶음은 지금 쓰는 저장소를 체크해 맨 앞에 두고, 작업 폴더에서 찾은 저장소와 매핑에 쓰인 저장소를 체크하지 않은 후보로 보인다', async () => {
    const [api, web, batch, other] = [await repo('work/api'), await repo('work/web'), await repo('work/batch'), await repo('other/tool')];
    const { picker } = await setup({
      bundle: bundle({ status: 'ready', draft: draft([web, api]) }),
      workFolderRepos: [
        { name: 'api', path: api },
        { name: 'batch', path: batch },
        { name: 'web', path: web },
      ],
      repoMappings: { [OTHER_PROJECT_ID]: [other, batch] },
    });

    await picker.open(7);

    expect(picker.state()).toEqual({
      bundleId: 7,
      status: 'ready',
      choices: [
        { name: 'web', path: web, group: 'current', checked: true },
        { name: 'api', path: api, group: 'current', checked: true },
        { name: 'batch', path: batch, group: 'work-folder', checked: false },
        { name: 'tool', path: other, group: 'mapping', checked: false },
      ],
      mapping: 'unmapped',
    });
  });

  it('저장소 확인 필요 묶음은 에이전트가 짚은 후보를 지금 쓰는 저장소로 체크한다. 짚은 것이 없으면 아무것도 체크하지 않는다', async () => {
    const [api, web] = [await repo('work/api'), await repo('work/web')];
    /** 작업 폴더의 후보. */
    const candidates = [
      { name: 'api', path: api },
      { name: 'web', path: web },
    ];
    const { picker, current } = await setup({
      bundle: bundle({ repoCheck: { kind: 'unsure', reason: '알 수 없습니다.', candidates, picked: [web] } }),
      workFolderRepos: candidates,
    });

    await picker.open(7);
    expect(picker.state()).toMatchObject({
      choices: [
        { name: 'web', path: web, group: 'current', checked: true },
        { name: 'api', path: api, group: 'work-folder', checked: false },
      ],
    });

    current.bundle = bundle({ repoCheck: { kind: 'no-candidates' } });
    await picker.open(7);
    expect(picker.state()).toMatchObject({
      choices: [
        { path: api, group: 'work-folder', checked: false },
        { path: web, group: 'work-folder', checked: false },
      ],
      mapping: 'unmapped',
    });
  });

  it('연결된 폴더가 사라진 묶음은 남은 매핑 저장소를 체크하고, 사라진 폴더는 후보에 넣지 않는다', async () => {
    const api = await repo('work/api');
    /** 사라진 폴더. */
    const gone = join(root, 'work/gone');
    const { picker } = await setup({
      bundle: bundle({ repoCheck: { kind: 'missing-folders', paths: [gone] } }),
      repoMappings: { [PROJECT_ID]: [gone, api] },
    });

    await picker.open(7);

    expect(picker.state()).toMatchObject({ choices: [{ name: 'api', path: api, group: 'current', checked: true }], mapping: 'different' });
  });

  it('"다른 매핑에 쓰인 저장소"에는 다른 Flow 프로젝트의 매핑만 넣는다', async () => {
    const [api, own, other] = [await repo('work/api'), await repo('work/own'), await repo('other/tool')];
    const { picker } = await setup({
      bundle: bundle({ status: 'ready', draft: draft([api]) }),
      repoMappings: { [PROJECT_ID]: [own], [OTHER_PROJECT_ID]: [other] },
    });

    await picker.open(7);

    expect(picker.state()).toMatchObject({
      choices: [
        { path: api, group: 'current' },
        { path: other, group: 'mapping' },
      ],
    });
  });

  it('생성 중이거나 처리됨 묶음은 열지 않는다', async () => {
    const { picker, current } = await setup({ bundle: bundle({ status: 'generating' }) });

    await picker.open(7);
    expect(picker.state()).toBeNull();

    current.bundle = bundle({ status: 'ignored' });
    await picker.open(7);
    expect(picker.state()).toBeNull();
  });
});

describe('저장소 선택 창에서 고르기', () => {
  it('여러 개를 고르고 뺄 수 있고, 후보에 없는 경로는 받지 않는다', async () => {
    const [api, web] = [await repo('work/api'), await repo('work/web')];
    const { picker } = await setup({
      bundle: bundle({ status: 'ready', draft: draft([api]) }),
      workFolderRepos: [
        { name: 'api', path: api },
        { name: 'web', path: web },
      ],
    });
    await picker.open(7);

    picker.setChecked(web, true);
    picker.setChecked(api, false);
    picker.setChecked(join(root, 'not-a-choice'), true);

    expect(picker.state()).toMatchObject({
      choices: [
        { path: api, checked: false },
        { path: web, checked: true },
      ],
    });
  });

  it('"폴더 직접 고르기"로 고른 폴더는 체크한 채 후보 끝에 더한다. 이미 후보면 체크만 한다', async () => {
    const [api, extra] = [await repo('work/api'), await repo('elsewhere/extra')];
    const { picker } = await setup({ bundle: bundle({ repoCheck: { kind: 'no-candidates' } }), workFolderRepos: [{ name: 'api', path: api }] });
    await picker.open(7);

    picker.addFolders([extra, api]);

    expect(picker.state()).toMatchObject({
      choices: [
        { name: 'api', path: api, group: 'work-folder', checked: true },
        { name: 'extra', path: extra, group: 'added', checked: true },
      ],
    });
  });

  it('고른 구성으로 만들면 체크한 저장소를 후보 순서대로 넘겨 다시 만들고 창을 닫는다. 고른 것이 없으면 만들지 않는다', async () => {
    const [api, web, batch] = [await repo('work/api'), await repo('work/web'), await repo('work/batch')];
    const { picker, regenerated } = await setup({
      bundle: bundle({ status: 'ready', draft: draft([web]) }),
      workFolderRepos: [
        { name: 'api', path: api },
        { name: 'batch', path: batch },
      ],
    });
    await picker.open(7);
    picker.setChecked(web, false);

    await picker.generate();
    expect(regenerated).toEqual([]);

    picker.setChecked(batch, true);
    picker.setChecked(web, true);
    await picker.generate();

    expect(regenerated).toEqual([{ bundleId: 7, repos: [web, batch] }]);
    expect(picker.state()).toBeNull();
  });
});

describe('저장소 선택 창의 연결 버튼', () => {
  it('고른 구성으로 저장소 매핑을 덮어쓰고 창은 그대로 둔다. 연결한 뒤에는 매핑과 같은 구성으로 보인다', async () => {
    const [api, web, old] = [await repo('work/api'), await repo('work/web'), await repo('work/old')];
    const { picker, settingsStore } = await setup({
      bundle: bundle({ status: 'ready', draft: draft([api]) }),
      workFolderRepos: [{ name: 'web', path: web }],
      repoMappings: { [PROJECT_ID]: [old] },
    });
    await picker.open(7);
    picker.setChecked(web, true);
    expect(picker.state()).toMatchObject({ mapping: 'different' });

    await picker.link();

    expect(settingsStore.settings.repoMappings).toEqual({ [PROJECT_ID]: [api, web] });
    expect(picker.state()).toMatchObject({ status: 'ready', mapping: 'same' });
  });

  it('고른 것이 없으면 연결하지 않는다', async () => {
    const api = await repo('work/api');
    const { picker, settingsStore } = await setup({ bundle: bundle({ repoCheck: { kind: 'no-candidates' } }), repoMappings: { [PROJECT_ID]: [api] } });
    await picker.open(7);

    await picker.link();

    expect(settingsStore.settings.repoMappings).toEqual({ [PROJECT_ID]: [api] });
  });
});

describe('저장소 영역의 연결 버튼', () => {
  it('준비됨 묶음의 초안을 만든 구성으로 저장소 매핑을 덮어쓴다. 초안이 없으면 아무것도 하지 않는다', async () => {
    const [api, web, old] = [await repo('work/api'), await repo('work/web'), await repo('work/old')];
    const { picker, settingsStore, current } = await setup({
      bundle: bundle({ status: 'ready', draft: draft([web, api]) }),
      repoMappings: { [PROJECT_ID]: [old], [OTHER_PROJECT_ID]: [old] },
    });

    await picker.linkBundle(7);
    expect(settingsStore.settings.repoMappings).toEqual({ [PROJECT_ID]: [web, api], [OTHER_PROJECT_ID]: [old] });

    current.bundle = bundle({ repoCheck: { kind: 'no-candidates' } });
    await picker.linkBundle(7);
    expect(settingsStore.settings.repoMappings).toEqual({ [PROJECT_ID]: [web, api], [OTHER_PROJECT_ID]: [old] });
  });
});

describe('저장소 선택 창 닫기', () => {
  it('닫으면 상태가 없어지고, 묶음이 더는 고를 수 없는 상태가 되면 저절로 닫힌다', async () => {
    const api = await repo('work/api');
    const { picker, current } = await setup({ bundle: bundle({ status: 'ready', draft: draft([api]) }) });
    await picker.open(7);
    picker.close();
    expect(picker.state()).toBeNull();

    await picker.open(7);
    current.bundle = bundle({ status: 'ignored', draft: draft([api]) });
    picker.bundlesChanged();
    expect(picker.state()).toBeNull();
  });
});
