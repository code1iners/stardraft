import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeSentryApi } from '../fakes/fake-sentry-api';
import { MemorySentryTokenStore } from '../fakes/memory-sentry-token-store';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger } from '../logging/logger';
import type { SentryOrganization } from '../ports/sentry-api';
import type { SentryProjectRegistration } from '../ports/settings-store';
import { GlobalProblems } from '../problems/global-problems';
import { openStateDatabase, STATE_MIGRATIONS } from '../storage/state-database';
import { SqliteSentryStore } from '../storage/sqlite-sentry-store';
import { SentryConnection } from './sentry-connection';
import { SENTRY_CATCH_UP_MS, SENTRY_OVERLAP_MS, SENTRY_POLL_INTERVAL_MS, SentryDetection } from './sentry-detection';
import { SentryDiagnoses } from './sentry-diagnoses';
import { SentryProjects } from './sentry-projects';

/** 시험용 토큰. 실제 값이 아니다. */
const TOKEN = 'fake-sentry-token';
/** 시험용 조직. */
const ORG: SentryOrganization = { id: '1', slug: 'org-a', name: '가짜 조직', regionUrl: 'https://us.sentry.io' };
/** 지금(2026-11-26 12:00 UTC). */
const NOW = Date.UTC(2026, 10, 26, 12);
/** 1분. */
const MINUTE = 60_000;
/** 프로젝트를 등록한 시각(기준 시각). 지금보다 1시간 앞이다. */
const REGISTERED_AT = NOW - 60 * MINUTE;

/** 등록한 프로젝트. */
function registration(projectId: string, overrides: Partial<SentryProjectRegistration> = {}): SentryProjectRegistration {
  return {
    projectId,
    organizationId: ORG.id,
    organizationSlug: ORG.slug,
    organizationName: ORG.name,
    projectSlug: `p-${projectId}`,
    projectName: `프로젝트 ${projectId}`,
    environment: 'production',
    levels: ['fatal', 'error'],
    registeredAt: new Date(REGISTERED_AT).toISOString(),
    ...overrides,
  };
}

/** 시험이 만든 임시 폴더. */
const tempDirs: string[] = [];
/** 시험이 연 DB. */
const openDbs: { close(): void }[] = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더를 만든다. */
function makeDir(): string {
  /** 만든 폴더. */
  const dir = mkdtempSync(join(tmpdir(), 'sentry-detection-'));
  tempDirs.push(dir);
  return dir;
}

/** 저장소 매핑의 모양. 있는 폴더, 없는 폴더, 매핑 없음이다. */
type RepoSetup = 'found' | 'missing' | 'none';

/**
 * 토큰을 연결하고 프로젝트를 등록한 감지를 만든다. Sentry API만 가짜이고, Sentry 연결·프로젝트 등록·진단 저장소(SQLite)는 실제 모듈이다.
 * `repos`는 프로젝트 ID마다의 저장소 매핑이고, 없으면 있는 폴더다.
 */
async function setup({ projectIds = ['11'], repos = {} as Record<string, RepoSetup> } = {}) {
  const clock = new FakeClock(NOW);
  /** 로그 줄. 개수 로그를 본다. */
  const logged: string[] = [];
  const logger = createLogger([{ write: (line) => logged.push(line) }], clock);
  const api = new FakeSentryApi();
  api.token = TOKEN;
  api.organizations = [ORG];
  /** 매핑. */
  const mappings: Record<string, string[]> = {};
  /** 매핑된 폴더의 경로. */
  const repoPaths: Record<string, string> = {};
  for (const projectId of projectIds) {
    /** 이 프로젝트의 저장소 모양. */
    const repo = repos[projectId] ?? 'found';
    if (repo === 'none') continue;
    repoPaths[projectId] = repo === 'found' ? makeDir() : join(makeDir(), 'gone');
    mappings[projectId] = [repoPaths[projectId]];
  }
  const settingsStore = new MemorySettingsStore({
    sentryOrganizations: [ORG],
    sentryProjects: Object.fromEntries(projectIds.map((projectId) => [projectId, registration(projectId)])),
    sentryRepoMappings: mappings,
  });
  const tokenStore = new MemorySentryTokenStore();
  tokenStore.token = TOKEN;
  const problems = new GlobalProblems({ notifier: new RecordingNotifier(), clock, logger, notificationFor: () => ({ title: 't', body: 'b' }) });
  const connection = new SentryConnection({ connectSentry: api.connect, tokenStore, settingsStore, logger, problems });
  await connection.load();
  await connection.checkStoredToken();
  const db = openStateDatabase(join(makeDir(), 'state.db'), STATE_MIGRATIONS, '0.1.0');
  openDbs.push(db);
  const store = new SqliteSentryStore(db);
  const notifier = new RecordingNotifier();
  /** 프로젝트 등록. 등록 해제가 진단을 함께 치우도록 진단에 잇는다. */
  let diagnoses: SentryDiagnoses | null = null;
  const projects = new SentryProjects({
    connectSentry: api.connect,
    connection,
    settingsStore,
    clock,
    logger,
    onUnregistered: (projectId) => diagnoses!.removeProject(projectId),
  });
  await projects.load();
  diagnoses = new SentryDiagnoses({
    store,
    notifier,
    logger,
    resolveRepo: (projectId) => projects.resolveRepo(projectId),
    isRegistered: (item) => projects.isRegistered(item),
  });
  await diagnoses.load();
  const detection = new SentryDetection({ connectSentry: api.connect, connection, projects, diagnoses, clock, logger });
  return { clock, api, logged, connection, problems, projects, diagnoses, store, notifier, detection, repoPaths, settingsStore };
}

/** 감지한 진단을 `오류 이슈 ID:갈래:상태`로 줄여 본다. */
function summary(diagnoses: SentryDiagnoses): string[] {
  return diagnoses.list().map((item) => `${item.issueId}:${item.origin}:${item.status}${item.repoCheck ? `(${item.repoCheck.kind})` : ''}`);
}

describe('Sentry 감지: 신규', () => {
  it('기준 시각 뒤에 처음 보인 신규 오류 이슈는 처음 보인 순서대로 대기 진단이 되고, 오류 이슈 정보를 담는다', async () => {
    const { api, detection, diagnoses } = await setup();
    api.addIssue({ id: '102', projectId: '11', firstSeen: NOW - 10 * MINUTE });
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - 20 * MINUTE });

    await detection.start();

    expect(summary(diagnoses)).toEqual(['101:new:queued', '102:new:queued']);
    expect(diagnoses.list()[0]).toMatchObject({
      projectId: '11',
      regressionEventId: null,
      detectedAt: NOW,
      issue: { title: '시험 오류 101', shortId: 'FAKE-101', environment: 'production', firstSeen: NOW - 20 * MINUTE, projectName: '프로젝트 11', organizationName: '가짜 조직' },
    });
  });

  it('저장소 매핑이 없으면 저장소 매핑 필요, 매핑된 폴더가 없으면 저장소 확인 필요로 남는다', async () => {
    const { api, detection, diagnoses } = await setup({ projectIds: ['11', '12'], repos: { '11': 'none', '12': 'missing' } });
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - 10 * MINUTE });
    api.addIssue({ id: '201', projectId: '12', firstSeen: NOW - 10 * MINUTE });

    await detection.start();

    expect(summary(diagnoses)).toEqual(['101:new:repo-check-needed(unmapped)', '201:new:repo-check-needed(missing-folder)']);
  });

  it('기준 시각보다 앞서 처음 보인 신규는 건너뛴다', async () => {
    const { api, detection, diagnoses } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: REGISTERED_AT - MINUTE });
    api.addIssue({ id: '102', projectId: '11', firstSeen: REGISTERED_AT + MINUTE });

    await detection.start();

    expect(summary(diagnoses)).toEqual(['102:new:queued']);
  });

  it('다른 환경에서 먼저 생긴 오류 이슈도 등록한 환경에 처음 나타나면 신규다', async () => {
    const { api, detection, diagnoses } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeenByEnvironment: { staging: REGISTERED_AT - 600 * MINUTE, production: NOW - 5 * MINUTE } });

    await detection.start();

    expect(summary(diagnoses)).toEqual(['101:new:queued']);
  });

  it('최근 7일보다 앞서 처음 보인 신규는 진단하지 않고 체크포인트만 옮기며 로그에 개수만 적는다', async () => {
    const { api, clock, detection, diagnoses, store, logged } = await setup();
    // 등록한 뒤 앱이 열흘 꺼져 있었다.
    clock.sleep(10 * 24 * 60 * MINUTE);
    const now = clock.now();
    api.addIssue({ id: '101', projectId: '11', firstSeen: now - SENTRY_CATCH_UP_MS - MINUTE });
    api.addIssue({ id: '102', projectId: '11', firstSeen: now - SENTRY_CATCH_UP_MS - 2 * MINUTE });
    api.addIssue({ id: '103', projectId: '11', firstSeen: now - SENTRY_CATCH_UP_MS + MINUTE });

    await detection.start();

    expect(summary(diagnoses)).toEqual(['103:new:queued']);
    expect(await store.getCheckpoint('11')).toBe(now);
    expect(logged.some((line) => line.includes('sentry-detection.catch-up-skipped') && line.includes('"count":2'))).toBe(true);
  });

  it('체크포인트는 조회를 시작한 시각으로 옮기고, 다음 조회는 10분 앞에서 겹쳐 부르며 겹친 것은 다시 진단하지 않는다', async () => {
    const { api, clock, detection, diagnoses } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - MINUTE });
    await detection.start();

    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await settle();

    /** 신규 조회의 기준 시각들. */
    const after = api.calls.filter((call) => call.method === 'listNewErrorIssues').map((call) => call.firstSeenAfter);
    expect(after).toEqual([REGISTERED_AT - SENTRY_OVERLAP_MS, NOW - SENTRY_OVERLAP_MS]);
    expect(summary(diagnoses)).toEqual(['101:new:queued']);
  });
});

describe('Sentry 감지: 재발', () => {
  it('기준 시각 뒤의 재발은 진단이 되고 재발을 일으킨 이벤트 ID를 담는다. 같은 재발은 다시 조회해도 한 번만 진단 대상이다', async () => {
    const { api, clock, detection, diagnoses } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: REGISTERED_AT - 600 * MINUTE, status: 'resolved', substatus: null });
    api.regress('101', 'e1'.repeat(16), NOW - 5 * MINUTE);

    await detection.start();
    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await settle();

    expect(summary(diagnoses)).toEqual(['101:regression:queued']);
    expect(diagnoses.list()[0]?.regressionEventId).toBe('e1'.repeat(16));
  });

  it('기준 시각보다 앞선 재발은 건너뛴다', async () => {
    const { api, detection, diagnoses } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: REGISTERED_AT - 600 * MINUTE, status: 'resolved', substatus: null });
    api.regress('101', 'e1'.repeat(16), REGISTERED_AT - MINUTE);

    await detection.start();

    expect(summary(diagnoses)).toEqual([]);
  });

  it('대기 중인 진단이 있는 오류 이슈가 또 재발하면 새 진단을 만들지 않고 재발 키만 기록한다', async () => {
    const { api, clock, detection, diagnoses, store } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: REGISTERED_AT - 600 * MINUTE, status: 'resolved', substatus: null });
    api.regress('101', 'e1'.repeat(16), NOW - 5 * MINUTE);
    await detection.start();

    api.regress('101', 'e2'.repeat(16), NOW + MINUTE);
    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await settle();

    expect(summary(diagnoses)).toEqual(['101:regression:queued']);
    expect(await store.hasDetectionKey({ issueId: '101', eventId: 'e2'.repeat(16) })).toBe(true);
  });

  it('신규로 잡힌 오류 이슈가 곧바로 재발해 두 조회에 모두 나와도 진단은 하나이고 재발 키는 기록된다', async () => {
    const { api, detection, diagnoses, store } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - 10 * MINUTE });
    api.regress('101', 'e1'.repeat(16), NOW - 5 * MINUTE);

    await detection.start();

    expect(summary(diagnoses)).toEqual(['101:new:queued']);
    expect(await store.hasDetectionKey({ issueId: '101', eventId: 'e1'.repeat(16) })).toBe(true);
  });

  it('진단이 목록에서 빠진 뒤에도(완료 등) 이미 기록한 중복 억제 키의 신규와 재발은 다시 진단하지 않는다. 같은 오류 이슈의 다른 재발은 새 진단이다', async () => {
    const { api, detection, diagnoses, store } = await setup();
    // 앞서 감지해 진단을 끝낸 키만 남은 상태를 만든다.
    await store.recordDetection({
      projectId: '11',
      checkpoint: REGISTERED_AT,
      keys: [
        { issueId: '101', eventId: null },
        { issueId: '102', eventId: 'e1'.repeat(16) },
      ],
      diagnoses: [],
    });
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - 10 * MINUTE });
    api.addIssue({ id: '102', projectId: '11', firstSeen: REGISTERED_AT - 600 * MINUTE, status: 'resolved', substatus: null });
    api.regress('102', 'e1'.repeat(16), NOW - 5 * MINUTE);
    api.addIssue({ id: '103', projectId: '11', firstSeen: REGISTERED_AT - 600 * MINUTE, status: 'resolved', substatus: null });
    api.regress('103', 'e3'.repeat(16), NOW - 5 * MINUTE);

    await detection.start();

    expect(summary(diagnoses)).toEqual(['103:regression:queued']);
  });

  it('보관했다가 다시 늘어난(escalating) 오류 이슈는 진단하지 않는다', async () => {
    const { api, detection, diagnoses } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: REGISTERED_AT - 600 * MINUTE, substatus: 'escalating' });

    await detection.start();

    expect(summary(diagnoses)).toEqual([]);
    expect(api.calls.some((call) => call.method === 'latestRegression')).toBe(false);
  });

  it('재발 목록에 있던 오류 이슈가 그사이 삭제됐으면(상세 404) 그 오류 이슈만 건너뛰고 체크포인트는 옮긴다', async () => {
    const { api, detection, diagnoses, store } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: REGISTERED_AT - 600 * MINUTE, status: 'resolved', substatus: null });
    api.regress('101', 'e1'.repeat(16), NOW - 5 * MINUTE);
    api.failNext('latestRegression', { kind: 'not-found' }, '101');

    await detection.start();

    expect(summary(diagnoses)).toEqual([]);
    expect(await store.getCheckpoint('11')).toBe(NOW);
  });
});

describe('Sentry 감지: 주기와 실패', () => {
  it('시작할 때 바로 조회하고 그 뒤 5분마다 조회한다. 절전에서 깨면 바로 조회한다', async () => {
    const { api, clock, detection } = await setup();
    /** 신규 조회 횟수. */
    const polls = () => api.calls.filter((call) => call.method === 'listNewErrorIssues').length;

    await detection.start();
    expect(polls()).toBe(1);
    clock.advance(SENTRY_POLL_INTERVAL_MS - 1);
    await settle();
    expect(polls()).toBe(1);
    clock.advance(1);
    await settle();
    expect(polls()).toBe(2);

    clock.sleep(60 * MINUTE);
    await detection.checkNow();
    expect(polls()).toBe(3);
  });

  it('한 프로젝트의 실패가 다른 프로젝트를 막지 않고, 실패한 프로젝트의 체크포인트는 옮기지 않는다', async () => {
    const { api, clock, detection, diagnoses, store } = await setup({ projectIds: ['11', '12'] });
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - 10 * MINUTE });
    api.addIssue({ id: '201', projectId: '12', firstSeen: NOW - 10 * MINUTE });
    api.failNext('listNewErrorIssues', { kind: 'network' }, '11');

    await detection.start();

    expect(summary(diagnoses)).toEqual(['201:new:queued']);
    expect(await store.getCheckpoint('11')).toBeNull();
    expect(await store.getCheckpoint('12')).toBe(NOW);

    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await settle();
    expect(summary(diagnoses)).toEqual(['201:new:queued', '101:new:queued']);
  });

  it('재발 조회나 재발 활동 읽기가 실패해도 그 프로젝트의 체크포인트는 옮기지 않는다', async () => {
    const { api, detection, store } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: REGISTERED_AT - 600 * MINUTE, status: 'resolved', substatus: null });
    api.regress('101', 'e1'.repeat(16), NOW - 5 * MINUTE);
    api.failNext('latestRegression', { kind: 'http', status: 502 }, '101');

    await detection.start();

    expect(await store.getCheckpoint('11')).toBeNull();
  });

  it.each([
    ['404', { kind: 'not-found' } as const],
    ['접근 거부', { kind: 'forbidden' } as const],
  ])('%s면 그 프로젝트만 접근 불가가 되고 다른 프로젝트는 감지하며, 다시 읽히면 풀린다', async (_name, failure) => {
    const { api, clock, detection, projects, diagnoses, problems } = await setup({ projectIds: ['11', '12'] });
    api.addIssue({ id: '201', projectId: '12', firstSeen: NOW - 10 * MINUTE });
    api.failNext('listNewErrorIssues', failure, '11');

    await detection.start();

    /** 프로젝트마다 닿는지. */
    const access = () => Object.fromEntries(projects.state().projects.map((project) => [project.registration.projectId, project.access]));
    expect(access()).toEqual({ '11': 'inaccessible', '12': 'ok' });
    expect(summary(diagnoses)).toEqual(['201:new:queued']);
    expect(problems.has('sentry-token')).toBe(false);

    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await settle();
    expect(access()).toEqual({ '11': 'ok', '12': 'ok' });
  });

  it('401이면 "토큰 확인 필요"를 올리고 Sentry 감지를 멈춘다. 새 토큰이 확인되면 다시 조회한다', async () => {
    const { api, clock, detection, connection, problems } = await setup({ projectIds: ['11', '12'] });
    api.failNext('listNewErrorIssues', { kind: 'unauthorized' }, '11');

    await detection.start();

    expect(problems.has('sentry-token')).toBe(true);
    // 토큰 문제가 있는 프로젝트 뒤로는 부르지 않는다.
    expect(api.calls.filter((call) => call.method === 'listNewErrorIssues').map((call) => call.target)).toEqual(['11']);
    /** 지금까지의 호출 수. */
    const before = api.calls.length;
    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await settle();
    expect(api.calls.length).toBe(before);

    await connection.checkToken(TOKEN);
    await detection.start();
    expect(api.calls.filter((call) => call.method === 'listNewErrorIssues').length).toBe(3);
  });

  it('429면 한도 초기화 시각까지 Sentry 감지 전체를 미룬다', async () => {
    const { api, clock, detection } = await setup({ projectIds: ['11', '12'] });
    api.failNext('listNewErrorIssues', { kind: 'rate-limited', resetAt: NOW + 12 * MINUTE }, '11');
    /** 신규 조회 횟수. */
    const polls = () => api.calls.filter((call) => call.method === 'listNewErrorIssues').length;

    await detection.start();
    expect(polls()).toBe(1);

    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await detection.checkNow();
    expect(polls()).toBe(1);

    clock.advance(7 * MINUTE);
    await settle();
    expect(polls()).toBe(3);
  });

  it('429에 한도 초기화 시각이 없으면 다음 주기까지 미룬다', async () => {
    const { api, clock, detection } = await setup();
    api.failNext('listNewErrorIssues', { kind: 'rate-limited' }, '11');
    /** 신규 조회 횟수. */
    const polls = () => api.calls.filter((call) => call.method === 'listNewErrorIssues').length;

    await detection.start();
    await detection.checkNow();
    expect(polls()).toBe(1);

    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await settle();
    expect(polls()).toBe(2);
  });
});

describe('Sentry 진단: 저장소 대기와 등록 해제', () => {
  it('저장소 대기는 프로젝트가 그 상태가 될 때 한 번만 알린다. 풀리기 전에 또 오면 알리지 않고, 풀린 뒤 다시 되면 다시 알린다', async () => {
    const { api, clock, detection, diagnoses, notifier, projects, repoPaths } = await setup({ repos: { '11': 'none' } });
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - 10 * MINUTE });
    api.addIssue({ id: '102', projectId: '11', firstSeen: NOW - 9 * MINUTE });
    await detection.start();

    expect(notifier.sent).toEqual([
      {
        title: '저장소 매핑 필요',
        body: '프로젝트 11에 연결한 저장소가 없습니다. 매핑하면 기다리는 오류를 진단합니다.',
        target: { kind: 'diagnosis', id: diagnoses.list()[0]!.id },
      },
    ]);

    api.addIssue({ id: '103', projectId: '11', firstSeen: NOW + MINUTE });
    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await settle();
    expect(notifier.sent).toHaveLength(1);
    expect(diagnoses.reviewCount()).toBe(1);
    expect(diagnoses.waitingForMapping('11')).toBe(3);

    // 매핑을 저장하면 기다리던 진단이 모두 대기가 된다.
    await projects.setRepo('11', makeDir());
    await diagnoses.resumeRepoWaiting();
    expect(summary(diagnoses)).toEqual(['101:new:queued', '102:new:queued', '103:new:queued']);
    expect(diagnoses.reviewCount()).toBe(0);

    await projects.update('11', { environment: 'production', levels: ['error'], repoPath: null });
    api.addIssue({ id: '104', projectId: '11', firstSeen: NOW + 6 * MINUTE });
    clock.advance(SENTRY_POLL_INTERVAL_MS);
    await settle();
    expect(notifier.sent.map((item) => item.title)).toEqual(['저장소 매핑 필요', '저장소 매핑 필요']);
    expect(repoPaths).toBeDefined();
  });

  it('매핑된 폴더가 없어 저장소 확인 필요였던 진단은 폴더가 돌아오면 대기가 된다', async () => {
    const { api, detection, diagnoses, notifier, repoPaths } = await setup({ repos: { '11': 'missing' } });
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - 10 * MINUTE });
    await detection.start();
    expect(notifier.sent[0]).toMatchObject({ title: '저장소 확인 필요', body: '프로젝트 11에 연결한 저장소 폴더를 찾을 수 없습니다. 폴더가 돌아오거나 매핑을 고치면 이어 갑니다.' });
    expect(diagnoses.hasMissingFolderWaiting()).toBe(true);

    const { mkdirSync } = await import('node:fs');
    mkdirSync(repoPaths['11']!, { recursive: true });
    expect(await diagnoses.resumeRepoWaiting()).toBe(1);

    expect(summary(diagnoses)).toEqual(['101:new:queued']);
    expect(diagnoses.hasMissingFolderWaiting()).toBe(false);
  });

  it('프로젝트 등록을 풀면 그 프로젝트의 체크포인트와 중복 억제 기록이 지워지고 기다리던 진단이 목록에서 빠진다', async () => {
    const { api, detection, diagnoses, projects, store } = await setup({ projectIds: ['11', '12'], repos: { '12': 'none' } });
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - 10 * MINUTE });
    api.addIssue({ id: '201', projectId: '12', firstSeen: NOW - 10 * MINUTE });
    await detection.start();

    expect(await projects.unregister('12')).toBe(true);

    expect(summary(diagnoses)).toEqual(['101:new:queued']);
    expect(await store.getCheckpoint('12')).toBeNull();
    expect(await store.hasDetectionKey({ issueId: '201', eventId: null })).toBe(false);
    expect(diagnoses.reviewCount()).toBe(0);
  });

  it('조회하는 사이에 등록이 풀린 프로젝트의 결과는 저장하지 않는다', async () => {
    const { api, detection, diagnoses, projects, store } = await setup();
    api.addIssue({ id: '101', projectId: '11', firstSeen: NOW - 10 * MINUTE });
    // 재발 조회에 답하기 전에 등록을 푼다.
    api.beforeAnswer = async (call) => {
      if (call.method === 'listRegressedErrorIssues') await projects.unregister('11');
    };

    await detection.start();

    expect(summary(diagnoses)).toEqual([]);
    expect(await store.getCheckpoint('11')).toBeNull();
  });
});

/** 가짜 시계가 부른 조회가 끝나기를 기다린다. 조회 안의 비동기 단계가 모두 지나가도록 몇 번 양보한다. */
async function settle(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await new Promise((resolve) => setImmediate(resolve));
}
