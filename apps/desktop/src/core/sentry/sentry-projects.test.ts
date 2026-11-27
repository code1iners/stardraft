import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeSentryServer } from '../fakes/fake-sentry-server';
import { MemorySentryTokenStore } from '../fakes/memory-sentry-token-store';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger, type LogSink } from '../logging/logger';
import type { SentryOrganization, SentryProject } from '../ports/sentry-api';
import { GlobalProblems } from '../problems/global-problems';
import { HttpSentryApi } from './http-sentry-api';
import { SentryConnection } from './sentry-connection';
import { SentryProjects, type SentryProjectInput } from './sentry-projects';

/** 시험용 토큰. 실제 값이 아니다. */
const TOKEN = 'fake-sentry-token-1';
/** 시험용 조직 둘. 둘째는 다른 지역이다. */
const ORGS: SentryOrganization[] = [
  { id: '1', slug: 'org-a', name: '조직 A', regionUrl: 'https://us.sentry.io' },
  { id: '2', slug: 'org-b', name: '조직 B', regionUrl: 'https://de.sentry.io' },
];
/** 조직 A의 프로젝트. 둘째는 `production`이 없다. */
const PROJECTS_A: SentryProject[] = [
  { id: '11', slug: 'web', name: '웹', environments: ['development', 'production'] },
  { id: '12', slug: 'batch', name: '배치', environments: ['staging'] },
];
/** 조직 B의 프로젝트. */
const PROJECTS_B: SentryProject[] = [{ id: '21', slug: 'api', name: 'API', environments: [] }];
/** 기본 입력. 환경은 `production`, 레벨은 기본값, 저장소는 없다. */
const DEFAULT_INPUT: SentryProjectInput = { environment: 'production', levels: ['error', 'fatal'], repoPath: null };

/** 시험이 만든 임시 폴더. 끝나면 지운다. */
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 있는 폴더를 하나 만든다. */
async function makeFolder(): Promise<string> {
  /** 만든 폴더. */
  const dir = await mkdtemp(join(tmpdir(), 'sentry-projects-'));
  tempDirs.push(dir);
  return dir;
}

/** 토큰을 연결한 Sentry 연결과 프로젝트 등록을 가짜 서버로 만든다. */
async function setup() {
  const clock = new FakeClock(Date.UTC(2026, 10, 26, 9, 0, 0));
  const server = new FakeSentryServer();
  server.addToken(TOKEN, ORGS);
  server.addProjects(TOKEN, 'org-a', PROJECTS_A);
  server.addProjects(TOKEN, 'org-b', PROJECTS_B);
  const settingsStore = new MemorySettingsStore();
  /** 로그에 남은 줄. 토큰이 새는지 본다. */
  const logged: string[] = [];
  const sink: LogSink = { write: (line) => logged.push(line) };
  const logger = createLogger([sink], clock);
  const problems = new GlobalProblems({
    notifier: new RecordingNotifier(),
    clock,
    logger,
    notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }),
  });
  /** 어댑터가 쓰는 fetch. */
  const connectSentry = (token: string) => new HttpSentryApi({ token, fetch: server.fetch, clock });
  const connection = new SentryConnection({ connectSentry, tokenStore: new MemorySentryTokenStore(), settingsStore, logger, problems });
  await connection.checkToken(TOKEN);
  const projects = new SentryProjects({ connectSentry, connection, settingsStore, clock, logger });
  await projects.load();
  return { projects, connection, server, settingsStore, clock, logged };
}

/** 등록할 수 있는 프로젝트 목록까지 받아 둔 상태. */
async function setupLoaded() {
  const context = await setup();
  await context.projects.loadCandidates();
  return context;
}

describe('Sentry 프로젝트 등록: 등록할 프로젝트 목록', () => {
  it('토큰으로 보이는 모든 조직의 프로젝트를 조직 이름과 환경 목록과 함께 받는다', async () => {
    const { projects } = await setup();

    await projects.loadCandidates();

    expect(projects.state().candidates).toEqual({
      status: 'loaded',
      incomplete: false,
      projects: [
        { projectId: '11', projectSlug: 'web', projectName: '웹', organizationId: '1', organizationSlug: 'org-a', organizationName: '조직 A', environments: ['development', 'production'] },
        { projectId: '12', projectSlug: 'batch', projectName: '배치', organizationId: '1', organizationSlug: 'org-a', organizationName: '조직 A', environments: ['staging'] },
        { projectId: '21', projectSlug: 'api', projectName: 'API', organizationId: '2', organizationSlug: 'org-b', organizationName: '조직 B', environments: [] },
      ],
    });
  });

  it('조직마다 그 조직의 지역 주소로 부른다', async () => {
    const { projects, server } = await setup();

    await projects.loadCandidates();

    expect(server.requests.filter((request) => request.url.includes('/projects/')).map((request) => new URL(request.url).origin)).toEqual([
      'https://us.sentry.io',
      'https://de.sentry.io',
    ]);
  });

  it('조직 하나의 목록을 받지 못해도 나머지는 보이고 일부가 빠졌다고 알린다', async () => {
    const { projects, server } = await setup();
    // 조직 B의 프로젝트 목록을 `404`로 만든다: 이 토큰으로 볼 수 없는 조직을 흉내 낸다.
    server.addProjects(TOKEN, 'org-b-other', []);

    await projects.loadCandidates();

    expect(projects.state().candidates).toMatchObject({ status: 'loaded', incomplete: false });
    server.replyNext({ status: 200, body: [] }, { status: 500 });
    await projects.loadCandidates();
    expect(projects.state().candidates).toEqual({ status: 'loaded', incomplete: true, projects: [] });
  });

  it('모든 조직의 목록을 받지 못하면 실패 이유를 알린다', async () => {
    const { projects, server } = await setup();
    server.replyNext({ network: 'error' }, { network: 'error' });

    await projects.loadCandidates();

    expect(projects.state().candidates).toEqual({ status: 'failed', reason: 'network' });
  });

  it('토큰 확인 필요이면 부르지 않고 실패로 둔다', async () => {
    const { projects, connection, server } = await setup();
    connection.reportApiFailure(TOKEN, { kind: 'unauthorized' });
    server.requests.length = 0;

    await projects.loadCandidates();

    expect(projects.state().candidates).toEqual({ status: 'failed', reason: 'no-token' });
    expect(server.requests).toEqual([]);
  });
});

describe('Sentry 프로젝트 등록: 등록', () => {
  it('오류 이슈 목록을 한 건 불러 event:read를 확인한 뒤, 프로젝트 id를 키로 설정에 저장하고 등록한 시각을 기준 시각으로 둔다', async () => {
    const { projects, server, settingsStore, clock } = await setupLoaded();
    server.requests.length = 0;

    const outcome = await projects.register('11', DEFAULT_INPUT);

    expect(outcome).toEqual({ kind: 'registered', rejected: null });
    expect(server.requests.map((request) => request.url)).toEqual([
      'https://us.sentry.io/api/0/organizations/org-a/issues/?project=11&limit=1',
    ]);
    expect(settingsStore.settings.sentryProjects).toEqual({
      '11': {
        projectId: '11',
        organizationId: '1',
        organizationSlug: 'org-a',
        organizationName: '조직 A',
        projectSlug: 'web',
        projectName: '웹',
        environment: 'production',
        levels: ['fatal', 'error'],
        registeredAt: new Date(clock.now()).toISOString(),
      },
    });
    expect(projects.state().projects[0]?.access).toBe('ok');
  });

  it('환경 필터를 조직의 환경 목록에서 골라야 한다. 없는 환경이면 등록하지 않는다', async () => {
    const { projects, server, settingsStore } = await setupLoaded();
    server.requests.length = 0;

    const outcome = await projects.register('12', { ...DEFAULT_INPUT, environment: 'production' });

    expect(outcome).toEqual({ kind: 'failed', reason: 'invalid-filter' });
    expect(server.requests).toEqual([]);
    expect(settingsStore.settings.sentryProjects).toEqual({});
  });

  it('모든 환경(null)으로도 등록할 수 있다. 환경 목록이 비어 있는 프로젝트가 그렇다', async () => {
    const { projects } = await setupLoaded();

    expect(await projects.register('21', { ...DEFAULT_INPUT, environment: null })).toEqual({ kind: 'registered', rejected: null });
    expect(projects.state().projects[0]?.registration.environment).toBeNull();
  });

  it.each<[string, Partial<SentryProjectInput>]>([
    ['레벨이 비어 있다', { levels: [] }],
    ['모르는 레벨이 있다', { levels: ['error', 'critical' as never] }],
    ['빈 환경 이름이다', { environment: '' }],
  ])('필터가 맞지 않으면(%s) 등록하지 않는다', async (_name, patch) => {
    const { projects } = await setupLoaded();

    expect(await projects.register('11', { ...DEFAULT_INPUT, ...patch })).toEqual({ kind: 'failed', reason: 'invalid-filter' });
    expect(projects.state().projects).toEqual([]);
  });

  it('레벨은 심각한 순서로 정리하고 겹침을 없앤다', async () => {
    const { projects } = await setupLoaded();

    await projects.register('11', { ...DEFAULT_INPUT, levels: ['debug', 'fatal', 'error', 'fatal'] });

    expect(projects.state().projects[0]?.registration.levels).toEqual(['fatal', 'error', 'debug']);
  });

  it('event:read가 없으면(403) 빠진 scope를 짚어 알리고 아무것도 저장하지 않으며 "토큰 확인 필요"를 올린다', async () => {
    const { projects, server, settingsStore, connection } = await setupLoaded();
    server.denyEventRead(TOKEN);

    const outcome = await projects.register('11', DEFAULT_INPUT);

    expect(outcome).toEqual({ kind: 'failed', reason: 'scope-missing' });
    expect(settingsStore.settings.sentryProjects).toEqual({});
    expect(connection.state().problem).toBe('scope-missing');
  });

  it('프로젝트가 404이면 프로젝트를 찾을 수 없다고 알리고 토큰 문제로 올리지 않는다', async () => {
    const { projects, server, connection } = await setupLoaded();
    server.setIssueStatus('11', 404);

    expect(await projects.register('11', DEFAULT_INPUT)).toEqual({ kind: 'failed', reason: 'project-unavailable' });
    expect(connection.state().problem).toBeNull();
  });

  it.each([
    [{ network: 'error' as const }, 'network'],
    [{ status: 429 }, 'rate-limited'],
    [{ status: 500 }, 'unexpected'],
  ])('확인 호출이 실패하면(%j) 등록하지 않고 이유를 구분한다', async (reply, reason) => {
    const { projects, server, settingsStore } = await setupLoaded();
    server.replyNext(reply);

    expect(await projects.register('11', DEFAULT_INPUT)).toEqual({ kind: 'failed', reason });
    expect(settingsStore.settings.sentryProjects).toEqual({});
  });

  it('토큰 확인 필요이면 등록하지 않는다', async () => {
    const { projects, connection } = await setupLoaded();
    connection.reportApiFailure(TOKEN, { kind: 'forbidden' });

    expect(await projects.register('11', DEFAULT_INPUT)).toEqual({ kind: 'failed', reason: 'token-problem' });
  });

  it('받아 둔 목록에 없는 프로젝트는 등록하지 않는다', async () => {
    const { projects } = await setupLoaded();

    expect(await projects.register('999', DEFAULT_INPUT)).toEqual({ kind: 'failed', reason: 'unknown-project' });
  });

  it('이미 등록한 프로젝트는 다시 등록하지 않아 기준 시각이 그대로다', async () => {
    const { projects, clock } = await setupLoaded();
    await projects.register('11', DEFAULT_INPUT);
    /** 처음 등록한 시각. */
    const first = projects.state().projects[0]?.registration.registeredAt;
    clock.advance(60_000);

    expect(await projects.register('11', DEFAULT_INPUT)).toEqual({ kind: 'failed', reason: 'already-registered' });
    expect(projects.state().projects[0]?.registration.registeredAt).toBe(first);
  });

  it('저장소는 등록할 때 정하지 않아도 된다. 정하면 같은 폴더를 여러 프로젝트에 매핑할 수 있다', async () => {
    const { projects, settingsStore } = await setupLoaded();
    /** 저장소 폴더. */
    const repo = await makeFolder();

    await projects.register('11', DEFAULT_INPUT);
    await projects.register('12', { ...DEFAULT_INPUT, environment: 'staging', repoPath: repo });
    await projects.setRepo('11', repo);

    expect(settingsStore.settings.sentryRepoMappings).toEqual({ '11': [repo], '12': [repo] });
    expect(projects.state().projects.map((project) => project.repo?.path)).toEqual([repo, repo]);
  });

  it('네트워크 폴더는 저장소로 받지 않고 저장소 없이 등록한 뒤 받지 않은 폴더를 돌려준다', async () => {
    const { projects, settingsStore } = await setupLoaded();

    const outcome = await projects.register('11', { ...DEFAULT_INPUT, repoPath: '\\\\server\\share\\repo' });

    expect(outcome).toEqual({ kind: 'registered', rejected: { path: '\\\\server\\share\\repo', reason: 'network' } });
    expect(settingsStore.settings.sentryRepoMappings).toEqual({});
  });

  it('Flow 저장소 매핑과 다른 필드에 저장한다. 같은 ID여도 겹치지 않는다', async () => {
    const { projects, settingsStore } = await setupLoaded();
    settingsStore.settings.repoMappings = { '11': ['/fake/flow-repo'] };
    /** 저장소 폴더. */
    const repo = await makeFolder();

    await projects.register('11', { ...DEFAULT_INPUT, repoPath: repo });

    expect(settingsStore.settings.repoMappings).toEqual({ '11': ['/fake/flow-repo'] });
    expect(settingsStore.settings.sentryRepoMappings).toEqual({ '11': [repo] });
  });

  it('토큰은 로그에 남지 않는다', async () => {
    const { projects, server, logged } = await setupLoaded();
    server.denyEventRead(TOKEN);

    await projects.register('11', DEFAULT_INPUT);

    expect(logged.join('\n')).not.toContain(TOKEN);
  });
});

describe('Sentry 프로젝트 등록: 편집과 등록 해제', () => {
  it('필터와 저장소를 바꿔도 기준 시각은 그대로다', async () => {
    const { projects, clock } = await setupLoaded();
    await projects.register('11', DEFAULT_INPUT);
    /** 등록한 시각. */
    const registeredAt = projects.state().projects[0]?.registration.registeredAt;
    clock.advance(3_600_000);
    /** 저장소 폴더. */
    const repo = await makeFolder();

    const outcome = await projects.update('11', { environment: null, levels: ['warning'], repoPath: repo });

    expect(outcome).toEqual({ kind: 'updated', rejected: null });
    expect(projects.state().projects[0]?.registration).toMatchObject({ environment: null, levels: ['warning'], registeredAt });
    expect(projects.state().projects[0]?.repo?.path).toBe(repo);
  });

  it('저장소를 null로 저장하면 매핑을 지운다', async () => {
    const { projects, settingsStore } = await setupLoaded();
    /** 저장소 폴더. */
    const repo = await makeFolder();
    await projects.register('11', { ...DEFAULT_INPUT, repoPath: repo });

    await projects.update('11', DEFAULT_INPUT);

    expect(settingsStore.settings.sentryRepoMappings).toEqual({});
    expect(projects.state().projects[0]?.repo).toBeNull();
  });

  it('받지 않는 폴더로 바꾸려 하면 저장소는 그대로 두고 필터만 저장한다', async () => {
    const { projects } = await setupLoaded();
    /** 저장소 폴더. */
    const repo = await makeFolder();
    await projects.register('11', { ...DEFAULT_INPUT, repoPath: repo });

    const outcome = await projects.update('11', { ...DEFAULT_INPUT, levels: ['fatal'], repoPath: '\\\\wsl.localhost\\Ubuntu\\repo' });

    expect(outcome).toEqual({ kind: 'updated', rejected: { path: '\\\\wsl.localhost\\Ubuntu\\repo', reason: 'wsl' } });
    expect(projects.state().projects[0]?.repo?.path).toBe(repo);
    expect(projects.state().projects[0]?.registration.levels).toEqual(['fatal']);
  });

  it('등록하지 않은 프로젝트는 편집할 수 없다', async () => {
    const { projects } = await setupLoaded();

    expect(await projects.update('11', DEFAULT_INPUT)).toEqual({ kind: 'failed', reason: 'not-registered' });
  });

  it('등록을 풀면 등록과 저장소 매핑이 지워지고, 다시 등록하면 기준 시각을 새로 잡는다', async () => {
    const { projects, settingsStore, clock } = await setupLoaded();
    /** 저장소 폴더. */
    const repo = await makeFolder();
    await projects.register('11', { ...DEFAULT_INPUT, repoPath: repo });
    /** 처음 등록한 시각. */
    const first = projects.state().projects[0]?.registration.registeredAt;

    expect(await projects.unregister('11')).toBe(true);

    expect(settingsStore.settings.sentryProjects).toEqual({});
    expect(settingsStore.settings.sentryRepoMappings).toEqual({});
    expect(projects.state().projects).toEqual([]);

    clock.advance(86_400_000);
    await projects.register('11', DEFAULT_INPUT);
    expect(projects.state().projects[0]?.registration.registeredAt).not.toBe(first);
    expect(projects.state().projects[0]?.registration.registeredAt).toBe(new Date(clock.now()).toISOString());
  });

  it('다른 프로젝트의 등록과 매핑은 건드리지 않는다', async () => {
    const { projects } = await setupLoaded();
    /** 저장소 폴더. */
    const repo = await makeFolder();
    await projects.register('11', { ...DEFAULT_INPUT, repoPath: repo });
    await projects.register('12', { ...DEFAULT_INPUT, environment: 'staging', repoPath: repo });

    await projects.unregister('11');

    expect(projects.state().projects.map((project) => [project.registration.projectId, project.repo?.path])).toEqual([['12', repo]]);
  });

  it('토큰 연결을 끊어도 등록은 남는다', async () => {
    const { projects, connection } = await setupLoaded();
    await projects.register('11', DEFAULT_INPUT);

    await connection.disconnect();
    await projects.load();

    expect(projects.state().projects).toHaveLength(1);
  });
});

describe('Sentry 프로젝트 등록: 접근 확인과 저장소 폴더', () => {
  it('등록한 프로젝트가 404이면 그 프로젝트만 "접근 불가"가 된다', async () => {
    const { projects, server } = await setupLoaded();
    await projects.register('11', DEFAULT_INPUT);
    await projects.register('12', { ...DEFAULT_INPUT, environment: 'staging' });
    server.setIssueStatus('11', 404);

    await projects.refresh();

    expect(projects.state().projects.map((project) => [project.registration.projectId, project.access])).toEqual([
      ['11', 'inaccessible'],
      ['12', 'ok'],
    ]);
  });

  it('접근이 거부돼도(403) 그 프로젝트만 "접근 불가"이고 토큰 문제는 올리지 않는다', async () => {
    const { projects, server, connection } = await setupLoaded();
    await projects.register('11', DEFAULT_INPUT);
    server.setIssueStatus('11', 403);

    await projects.refresh();

    expect(projects.state().projects[0]?.access).toBe('inaccessible');
    expect(connection.state().problem).toBeNull();
  });

  it('접근 불가였던 프로젝트가 다시 읽히면 풀린다', async () => {
    const { projects, server } = await setupLoaded();
    await projects.register('11', DEFAULT_INPUT);
    server.setIssueStatus('11', 404);
    await projects.refresh();

    server.setIssueStatus('11', 200);
    await projects.refresh();

    expect(projects.state().projects[0]?.access).toBe('ok');
  });

  it('네트워크 오류는 접근 상태를 바꾸지 않는다', async () => {
    const { projects, server } = await setupLoaded();
    await projects.register('11', DEFAULT_INPUT);
    server.replyNext({ network: 'error' });

    await projects.refresh();

    expect(projects.state().projects[0]?.access).toBe('ok');
  });

  it('토큰이 거부되면(401) "토큰 확인 필요"를 올린다', async () => {
    const { projects, server, connection } = await setupLoaded();
    await projects.register('11', DEFAULT_INPUT);
    server.replyNext({ status: 401 });

    await projects.refresh();

    expect(connection.state().problem).toBe('rejected');
  });

  it('토큰 확인 필요이면 확인 호출을 하지 않는다', async () => {
    const { projects, connection, server } = await setupLoaded();
    await projects.register('11', DEFAULT_INPUT);
    connection.reportApiFailure(TOKEN, { kind: 'unauthorized' });
    server.requests.length = 0;

    await projects.refresh();

    expect(server.requests).toEqual([]);
  });

  it('매핑된 폴더가 없으면 저장소 줄이 missing이 되고, 폴더가 생기면 found가 된다', async () => {
    const { projects } = await setupLoaded();
    /** 저장소 폴더. */
    const repo = await makeFolder();
    await projects.register('11', { ...DEFAULT_INPUT, repoPath: repo });
    expect(projects.state().projects[0]?.repo?.status).toBe('found');

    await rm(repo, { recursive: true });
    await projects.refresh();
    expect(projects.state().projects[0]?.repo?.status).toBe('missing');
  });

  it('상태가 바뀔 때마다 듣는 쪽에 알린다', async () => {
    const { projects } = await setup();
    /** 받은 알림 수. */
    let notified = 0;
    projects.onChange(() => (notified += 1));

    await projects.loadCandidates();

    expect(notified).toBeGreaterThanOrEqual(2);
  });
});

describe('Sentry 프로젝트 등록: 설정 읽기', () => {
  it('이 값이 없던 옛 설정은 빈 등록으로 읽는다', async () => {
    const { projects } = await setup();

    expect(projects.state().projects).toEqual([]);
  });

  it('형식이 맞지 않는 등록과 등록이 없는 프로젝트의 매핑은 건너뛴다', async () => {
    const { projects, settingsStore } = await setup();
    settingsStore.settings.sentryProjects = {
      '11': {
        projectId: '11',
        organizationId: '1',
        organizationSlug: 'org-a',
        organizationName: '조직 A',
        projectSlug: 'web',
        projectName: '웹',
        environment: null,
        levels: ['error'],
        registeredAt: '2026-11-26T00:00:00.000Z',
      },
      '12': { projectId: '12' } as never,
      '13': 'broken' as never,
    };
    settingsStore.settings.sentryRepoMappings = { '11': ['/fake/repo'], '99': ['/fake/other'] };

    await projects.load();

    expect(projects.state().projects.map((project) => [project.registration.projectId, project.repo?.path])).toEqual([['11', '/fake/repo']]);
  });
});
