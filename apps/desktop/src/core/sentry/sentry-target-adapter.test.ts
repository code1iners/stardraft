import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeExecutor } from '../fakes/fake-executor';
import { FakeSentryApi } from '../fakes/fake-sentry-api';
import { MemorySentryTokenStore } from '../fakes/memory-sentry-token-store';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import type { QueuedTarget } from '../generation/generation-run';
import { GenerationQueue } from '../generation/generation-queue';
import type { TargetAdapter } from '../generation/target-adapter';
import { createLogger } from '../logging/logger';
import type { ExecutorOutcome } from '../ports/executor';
import type { GenerationQueueStore } from '../ports/generation-queue-store';
import type { SentryErrorIssue, SentryOrganization } from '../ports/sentry-api';
import type { SentryProjectRegistration } from '../ports/settings-store';
import { GlobalProblems } from '../problems/global-problems';
import { openStateDatabase, STATE_MIGRATIONS } from '../storage/state-database';
import { SqliteSentryStore } from '../storage/sqlite-sentry-store';
import { DIAGNOSIS_TIMEOUT_MS } from './diagnosis-run';
import { SentryConnection } from './sentry-connection';
import { SentryDiagnoses } from './sentry-diagnoses';
import { SentryProjects } from './sentry-projects';
import { SENTRY_TARGET_KIND, SentryTargetAdapter } from './sentry-target-adapter';

/** 시험용 토큰. 실제 값이 아니다. */
const TOKEN = 'fake-sentry-token';
/** 시험용 조직. */
const ORG: SentryOrganization = { id: '1', slug: 'org-a', name: '가짜 조직', regionUrl: 'https://us.sentry.io' };
/** 지금(2026-11-26 12:00 UTC). */
const NOW = Date.UTC(2026, 10, 26, 12);
/** 1분. */
const MINUTE = 60_000;
/** 설정의 사용자 추가 지침. 진단 지침에 붙으면 안 된다. */
const EXTRA_INSTRUCTIONS = '초안에만 붙는 사용자 지침';
/** 가짜 HEAD 해시. */
const HEAD = 'a'.repeat(40);

/** 등록한 프로젝트. */
function registration(): SentryProjectRegistration {
  return {
    projectId: '11',
    organizationId: ORG.id,
    organizationSlug: ORG.slug,
    organizationName: ORG.name,
    projectSlug: 'p-11',
    projectName: '프로젝트 11',
    environment: 'production',
    levels: ['fatal', 'error'],
    registeredAt: new Date(NOW - 60 * MINUTE).toISOString(),
  };
}

/** 목록에서 읽은 오류 이슈. */
function listed(id: string): SentryErrorIssue {
  return {
    id,
    shortId: `FAKE-${id}`,
    title: `시험 오류 ${id}`,
    culprit: 'src/fake.ts',
    level: 'error',
    firstSeen: NOW - 5 * MINUTE,
    lastSeen: NOW - MINUTE,
    count: 3,
    userCount: 1,
    permalink: null,
    platform: 'javascript',
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
  const dir = mkdtempSync(join(tmpdir(), 'sentry-adapter-'));
  tempDirs.push(dir);
  return dir;
}

/** 메모리 안의 대기열 저장소. */
class MemoryQueueStore implements GenerationQueueStore {
  /** 남긴 대기열. */
  queue: QueuedTarget[] = [];

  async getGenerationQueue(): Promise<QueuedTarget[]> {
    return [...this.queue];
  }

  async setGenerationQueue(queue: readonly QueuedTarget[]): Promise<void> {
    this.queue = [...queue];
  }
}

/** 실행 없이 바로 저장하는 가짜 Flow 어댑터. Sentry 어댑터가 멈춘 동안 Flow 초안이 지나가는지 본다. */
class PassingFlowAdapter implements TargetAdapter {
  readonly kind = 'flow';
  readonly preparingStep = '준비 중';
  /** 생성 중 대상. */
  readonly generating: number[] = [];
  /** 저장한 대상. */
  readonly saved: number[] = [];
  /** 대상이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  /** 생성 중 대상을 더한다. */
  add(id: number): void {
    this.generating.push(id);
    for (const listener of this.listeners) listener();
  }

  generatingTargets(): number[] {
    return [...this.generating];
  }
  requestedByUser(): boolean {
    return false;
  }
  onTargetsChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  connectionUsable(): boolean {
    return true;
  }
  onConnectionChange(): () => void {
    return () => {};
  }
  begin(id: number): number | null {
    return this.generating.includes(id) ? id : null;
  }
  isGenerating(id: number): boolean {
    return this.generating.includes(id);
  }
  async prepare() {
    return { kind: 'ready' as const, next: { kind: 'save' as const, result: null } };
  }
  async save(id: number): Promise<boolean> {
    this.generating.splice(this.generating.indexOf(id), 1);
    this.saved.push(id);
    for (const listener of this.listeners) listener();
    return true;
  }
  async fail(): Promise<boolean> {
    return true;
  }
  async needsRepoCheck(): Promise<boolean> {
    return true;
  }
  async addRuns(): Promise<void> {}
}

/** 가짜 시계와 포트의 응답이 모두 끝나도록 대기 중인 비동기 일을 돌린다. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 80; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** 읽기 전용 진단의 올바른 출력. 근거는 저장소의 `src/fake.ts` 1~2줄이다. */
function reportOutput(repository: string, evidencePath = 'src/fake.ts') {
  return {
    summary: '주문 목록이 비었을 때 첫 항목을 읽어 오류가 납니다.',
    cause: { text: '빈 배열의 첫 항목을 확인 없이 읽습니다. [근거 1]', confidence: 'medium' },
    improvements: ['빈 목록을 먼저 확인합니다.'],
    open_questions: ['빈 목록이 언제 오는지 확인하지 못했습니다.'],
    evidence: [{ id: 1, explanation: '첫 항목을 바로 읽는 자리', repository, path: evidencePath, start_line: 1, end_line: 2 }],
  };
}

/**
 * 토큰을 연결하고 프로젝트를 등록한 Sentry 어댑터와 생성 대기열을 만든다. Sentry API와 실행기만 가짜이고,
 * Sentry 연결·프로젝트 등록·진단 목록·진단 저장소(SQLite)는 실제 모듈이다. 저장소에는 `src/fake.ts`와 `.env`가 있다.
 */
async function setup({ mapped = true } = {}) {
  const clock = new FakeClock(NOW);
  /** 로그 줄. */
  const logged: string[] = [];
  const logger = createLogger([{ write: (line) => logged.push(line) }], clock);
  const api = new FakeSentryApi();
  api.token = TOKEN;
  api.organizations = [ORG];
  /** 매핑된 저장소. */
  const repo = makeDir();
  mkdirSync(join(repo, 'src'));
  writeFileSync(join(repo, 'src', 'fake.ts'), 'export function fakeHandler() {\n  throw new TypeError();\n}\n');
  writeFileSync(join(repo, '.env'), 'FAKE=1\n');
  const settingsStore = new MemorySettingsStore({
    sentryOrganizations: [ORG],
    sentryProjects: { '11': registration() },
    sentryRepoMappings: mapped ? { '11': [repo] } : {},
    extraInstructions: EXTRA_INSTRUCTIONS,
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
    clock,
    resolveRepo: (projectId) => projects.resolveRepo(projectId),
    isRegistered: (item) => projects.isRegistered(item),
  });
  await diagnoses.load();
  const executor = new FakeExecutor('claude-code');
  const adapter = new SentryTargetAdapter({
    diagnoses,
    projects,
    connection,
    connectSentry: api.connect,
    settingsStore,
    repoState: async () => ({ headCommit: HEAD, uncommittedChanges: true }),
    clock,
    logger,
  });
  const flow = new PassingFlowAdapter();
  const queue = new GenerationQueue({
    adapters: [flow, adapter],
    agent: () => ({ executor, model: null, confirmForRun: async () => true }),
    onAgentChange: () => () => {},
    parallelWork: { count: () => 1, onChange: () => () => {} },
    store: new MemoryQueueStore(),
    clock,
    logger,
  });
  /** 오류 이슈를 신규로 감지해 진단을 만든다. */
  const detect = async (...ids: string[]) => {
    for (const id of ids) api.addIssue({ id, projectId: '11', firstSeen: NOW - 5 * MINUTE });
    await diagnoses.record({
      registration: registration(),
      checkpoint: NOW,
      detectedAt: NOW,
      detected: ids.map((id) => ({ origin: 'new' as const, issue: listed(id), eventId: null })),
    });
  };
  /** 진단 하나를 오류 이슈 ID로 찾는다. */
  const byIssue = (issueId: string) => diagnoses.list().find((item) => item.issueId === issueId);
  return { clock, api, logged, connection, projects, diagnoses, store, executor, queue, flow, repo, detect, byIssue, settingsStore };
}

describe('Sentry 어댑터: 읽기 전용 진단', () => {
  it('감지된 진단은 읽기 전용 경계로 진단되어 보고서가 저장되고, 재현 칸과 실행 정보는 앱이 채운다', async () => {
    const env = await setup();
    await env.detect('101');
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) }, report: { cliVersion: '2.1.300' } });

    await env.queue.start();
    await settle();

    /** 실행기가 받은 요청. */
    const request = env.executor.requests[0]!;
    expect(request.kind).toBe('diagnosis');
    expect(request.timeoutMs).toBe(DIAGNOSIS_TIMEOUT_MS);
    expect(request.readRoots).toEqual([env.repo]);
    expect(request.instructions).toContain('## 진단 절차');
    expect(request.instructions).toContain('high를 쓰지 않습니다');
    expect(request.instructions).toContain('한국어로 씁니다');
    expect(request.instructions).not.toContain(EXTRA_INSTRUCTIONS);
    expect(Object.keys((request.outputSchema as { properties: object }).properties)).not.toContain('reproduction');
    expect(request.input).toContain('TypeError: 시험 오류 메시지');
    expect(request.input).toContain('[앱] src/fake.ts:2:5 fakeHandler');

    /** 저장된 진단. */
    const diagnosis = env.byIssue('101')!;
    expect(diagnosis.status).toBe('ready');
    expect(diagnosis.report).toMatchObject({
      summary: '주문 목록이 비었을 때 첫 항목을 읽어 오류가 납니다.',
      reproduction: { result: 'impossible', impossibleReason: 'not-allowed' },
      cause: { confidence: 'medium' },
      evidence: [{ id: 1, path: 'src/fake.ts', located: true }],
      event: { eventId: 'event-101', release: 'fake@1.0.1', firstRelease: 'fake@1.0.0', sourceMaps: 'applied', missingData: [] },
      run: { repository: env.repo, headCommit: HEAD, uncommittedChanges: true, agent: 'claude-code', cliVersion: '2.1.300', reproductionAllowed: false, createdAt: NOW },
    });
    expect(diagnosis.runs).toHaveLength(1);
  });

  it('없는 데이터 항목은 지침과 보고서의 오류 이슈 정보에 적힌다', async () => {
    const env = await setup();
    await env.detect('101');
    env.api.issues.get('101')!.latestEvent!.exceptions = [];
    env.api.issues.get('101')!.latestEvent!.breadcrumbs = [];
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    await env.queue.start();
    await settle();

    expect(env.executor.requests[0]!.instructions).toContain('## 이 오류 이슈에서 없는 데이터\n- 스택트레이스 없음\n- breadcrumbs 없음');
    expect(env.byIssue('101')!.report!.event.missingData).toEqual(['스택트레이스 없음', 'breadcrumbs 없음']);
  });

  it.each([
    ['해결됨', 'resolved'],
    ['보관됨', 'ignored'],
    ['병합됨', 'merged'],
    ['삭제됨', 'deleted'],
  ] as const)('시작 직전 오류 이슈가 %s이면 진단하지 않고 조용히 빼며 로그에 적고, 중복 억제 기록은 남긴다', async (_label, state) => {
    const env = await setup();
    await env.detect('101');
    if (state === 'deleted') env.api.issues.delete('101');
    else if (state === 'merged') env.api.issues.get('101')!.merged = true;
    else env.api.issues.get('101')!.status = state;

    await env.queue.start();
    await settle();

    expect(env.executor.requests).toHaveLength(0);
    expect(env.byIssue('101')).toBeUndefined();
    expect(await env.store.hasDetectionKey({ issueId: '101', eventId: null })).toBe(true);
    expect(env.logged.some((line) => line.includes('sentry-diagnoses.dropped-before-start'))).toBe(true);
  });

  it('이벤트 데이터를 못 받는 일시적 실패는 진단 실패가 아니라 Sentry 어댑터 멈춤이고, 그동안 Flow 초안이 그 앞으로 지나간다', async () => {
    const env = await setup();
    await env.detect('101');
    env.api.failNext('latestEvent', { kind: 'network' });
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    await env.queue.start();
    await settle();
    env.flow.add(7);
    await settle();

    expect(env.byIssue('101')!.status).toBe('queued');
    expect(env.executor.requests).toHaveLength(0);
    expect(env.flow.saved).toEqual([7]);

    env.clock.advance(60_000);
    await settle();
    expect(env.byIssue('101')!.status).toBe('ready');
  });

  it('토큰이 거부되면 "토큰 확인 필요"가 오르고 진단은 실패하지 않고 줄에 남는다', async () => {
    const env = await setup();
    await env.detect('101');
    env.api.failNext('errorIssueState', { kind: 'unauthorized' });

    await env.queue.start();
    await settle();

    expect(env.connection.state().problem).toBe('rejected');
    expect(env.byIssue('101')!.status).toBe('queued');
    expect(env.executor.requests).toHaveLength(0);
  });

  it('`429`면 한도 초기화 시각까지 Sentry 어댑터만 멈춘다', async () => {
    const env = await setup();
    await env.detect('101');
    env.api.failNext('latestEvent', { kind: 'rate-limited', resetAt: NOW + 5 * MINUTE });
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    await env.queue.start();
    await settle();
    env.clock.advance(4 * MINUTE);
    await settle();
    expect(env.byIssue('101')!.status).toBe('queued');

    env.clock.advance(MINUTE);
    await settle();
    expect(env.byIssue('101')!.status).toBe('ready');
  });
});

describe('Sentry 어댑터: 결과 검사', () => {
  it('근거가 비밀 파일이면 결과 전체를 버리고 "비밀 파일을 근거로 듦" 진단 실패가 된다', async () => {
    const env = await setup();
    await env.detect('101');
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo, '.env') } });

    await env.queue.start();
    await settle();

    expect(env.byIssue('101')).toMatchObject({ status: 'failed', report: null, failure: { reason: 'secret-evidence', runKind: 'diagnosis' } });
  });

  it('위치를 찾을 수 없는 근거는 지우지 않고 표시만 한다', async () => {
    const env = await setup();
    await env.detect('101');
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo, 'src/missing.ts') } });

    await env.queue.start();
    await settle();

    expect(env.byIssue('101')!.report!.evidence).toMatchObject([{ path: 'src/missing.ts', located: false }]);
  });
});

describe('Sentry 어댑터: 진단 실패와 버튼', () => {
  it('재시도 뒤에도 구조화 출력이 없으면 사유가 붙은 진단 실패가 되고 자동으로 더 재시도하지 않는다', async () => {
    const env = await setup();
    await env.detect('101');
    /** 결과 형식 오류 한 번. */
    const invalid: ExecutorOutcome = { type: 'invalid-output', detail: '구조화 출력 없음' };
    env.executor.script({ outcome: invalid });
    env.executor.script({ outcome: invalid });

    await env.queue.start();
    await settle();

    expect(env.executor.requests).toHaveLength(2);
    expect(env.byIssue('101')).toMatchObject({ status: 'failed', failure: { reason: 'invalid-output' } });
    expect(env.byIssue('101')!.runs).toHaveLength(2);
  });

  it('시간 초과는 다시 실행하지 않고 진단 실패(시간 초과)가 된다', async () => {
    const env = await setup();
    await env.detect('101');
    env.executor.script({ outcome: { type: 'timed-out' } });

    await env.queue.start();
    await settle();

    expect(env.executor.requests).toHaveLength(1);
    expect(env.byIssue('101')!.failure!.reason).toBe('timed-out');
  });

  it('[다시 시도]는 `user` 칸에 서서 감지한 진단보다 먼저 돈다', async () => {
    const env = await setup();
    await env.detect('101');
    env.executor.script({ outcome: { type: 'timed-out' } });
    await env.queue.start();
    await settle();
    /** 진단 실패한 진단. */
    const failed = env.byIssue('101')!;
    /** 뒤에 감지된 진단이 실행 중일 때 [다시 시도]를 누른다. */
    const holdSecond = (() => {
      let finish!: (outcome: ExecutorOutcome) => void;
      env.executor.script({ outcome: new Promise<ExecutorOutcome>((resolve) => (finish = resolve)) });
      return (outcome: ExecutorOutcome) => finish(outcome);
    })();
    await env.detect('102', '103');
    await settle();

    await env.queue.changeByUser({ kind: SENTRY_TARGET_KIND, targetId: failed.id }, () => env.diagnoses.retry(failed.id));
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });
    holdSecond({ type: 'completed', output: reportOutput(env.repo) });
    await settle();

    /** 실행한 순서. 입력 문서에 든 오류 제목으로 가린다. */
    const order = env.executor.requests.map((request) => /제목: (\S+ \S+ \d+)/.exec(request.input)?.[1]);
    expect(order).toEqual(['시험 오류 101', '시험 오류 102', '시험 오류 101', '시험 오류 103']);
    expect(env.byIssue('101')!.status).toBe('ready');
  });

  it('진단 실패의 [완료]는 확인 없이 최소 기록만 남긴다', async () => {
    const env = await setup();
    await env.detect('101');
    env.executor.script({ outcome: { type: 'timed-out' } });
    await env.queue.start();
    await settle();

    await env.diagnoses.complete(env.byIssue('101')!.id);

    expect(env.byIssue('101')).toMatchObject({ status: 'completed', failure: null, report: null, runs: [], completedAt: NOW, issueId: '101', regressionEventId: null });
    // 앱을 다시 켜도 그대로다.
    await env.diagnoses.load();
    expect(env.byIssue('101')!.status).toBe('completed');
  });

  it('줄 서 있는 진단과 진행 중인 진단을 취소하면 진단 실패(취소함)가 된다', async () => {
    const env = await setup();
    await env.detect('101', '102');
    env.executor.script({ outcome: 'wait-for-abort' });
    await env.queue.start();
    await settle();
    /** 진행 중인 진단과 줄 선 진단. */
    const [running, waiting] = [env.byIssue('101')!, env.byIssue('102')!];
    expect(env.queue.progress({ kind: SENTRY_TARGET_KIND, targetId: running.id })?.status).toBe('running');
    expect(env.queue.aheadOf({ kind: SENTRY_TARGET_KIND, targetId: waiting.id })).toBe(1);

    await env.queue.cancel({ kind: SENTRY_TARGET_KIND, targetId: waiting.id });
    await env.queue.cancel({ kind: SENTRY_TARGET_KIND, targetId: running.id });
    await settle();

    expect(env.byIssue('101')!.failure!.reason).toBe('cancelled');
    expect(env.byIssue('102')!.failure!.reason).toBe('cancelled');
    expect(env.byIssue('102')!.status).toBe('failed');
  });

  it('진단 실패가 남은 오류 이슈에 새 재발이 오면 그 실패가 새 진단으로 바뀐다', async () => {
    const env = await setup();
    await env.detect('101');
    env.executor.script({ outcome: { type: 'timed-out' } });
    await env.queue.start();
    await settle();
    expect(env.byIssue('101')!.status).toBe('failed');

    env.executor.script({ outcome: 'wait-for-abort' });
    await env.diagnoses.record({
      registration: registration(),
      checkpoint: NOW,
      detectedAt: NOW + MINUTE,
      detected: [{ origin: 'regression', issue: listed('101'), eventId: 'event-r1' }],
    });
    await settle();

    /** 같은 오류 이슈의 진단. */
    const same = env.diagnoses.list().filter((item) => item.issueId === '101');
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ origin: 'regression', regressionEventId: 'event-r1', failure: null });
    expect(env.queue.progress({ kind: SENTRY_TARGET_KIND, targetId: same[0]!.id })).not.toBeNull();
  });

  it('진행 중인 진단에 새 재발이 오면 새 진단을 만들지 않고 키만 기록한다', async () => {
    const env = await setup();
    await env.detect('101');
    env.executor.script({ outcome: 'wait-for-abort' });
    await env.queue.start();
    await settle();

    await env.diagnoses.record({
      registration: registration(),
      checkpoint: NOW,
      detectedAt: NOW + MINUTE,
      detected: [{ origin: 'regression', issue: listed('101'), eventId: 'event-r1' }],
    });

    expect(env.diagnoses.list().filter((item) => item.issueId === '101')).toHaveLength(1);
    expect(await env.store.hasDetectionKey({ issueId: '101', eventId: 'event-r1' })).toBe(true);
  });
});

describe('Sentry 어댑터: 저장소 대기', () => {
  it('매핑을 저장하면 저장소 매핑 필요로 기다리던 진단이 처음 보인 순서대로 재개되어 진단된다', async () => {
    const env = await setup({ mapped: false });
    await env.detect('101', '102');
    await env.queue.start();
    await settle();
    expect(env.diagnoses.list().map((item) => item.status)).toEqual(['repo-check-needed', 'repo-check-needed']);

    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });
    await env.settingsStore.save({ ...(await env.settingsStore.load()), sentryRepoMappings: { '11': [env.repo] } });
    await env.projects.load();
    await env.diagnoses.resumeRepoWaiting();
    await settle();

    expect(env.executor.requests.map((request) => /제목: (\S+ \S+ \d+)/.exec(request.input)?.[1])).toEqual(['시험 오류 101', '시험 오류 102']);
    expect(env.diagnoses.list().map((item) => item.status)).toEqual(['ready', 'ready']);
  });

  it('기다리는 사이 매핑된 폴더가 사라지면 실행하지 않고 저장소 확인 필요가 된다', async () => {
    const env = await setup();
    await env.detect('101');
    rmSync(env.repo, { recursive: true, force: true });

    await env.queue.start();
    await settle();

    expect(env.byIssue('101')).toMatchObject({ status: 'repo-check-needed', repoCheck: { kind: 'missing-folder', path: env.repo } });
    expect(env.executor.requests).toHaveLength(0);
  });

  it('프로젝트 등록을 풀면 진행 중인 진단이 끊기고 목록에서 빠진다', async () => {
    const env = await setup();
    await env.detect('101');
    env.executor.script({ outcome: 'wait-for-abort' });
    await env.queue.start();
    await settle();

    await env.diagnoses.removeProject('11');
    await settle();

    expect(env.diagnoses.list()).toEqual([]);
    expect(env.queue.isRunning()).toBe(false);
  });
});
