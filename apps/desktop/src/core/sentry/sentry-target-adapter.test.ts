import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cp } from 'node:fs/promises';
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
import { ReproductionCopies } from '../reproduction/reproduction-copies';
import { DiagnosisAttachmentFolders } from './diagnosis-attachments';
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

/**
 * 가짜 시계와 포트의 응답이 모두 끝나도록 대기 중인 비동기 일을 돌린다. 근거 검사와 폴더 확인은 파일 시스템을 거치는데,
 * 부하가 큰 PC에서는 그 일이 즉시 큐만 돌려서는 끝나지 않으므로 사이사이 실제 시간도 조금 기다린다.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
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
/** 재현 허용을 흉내 내는 설정. */
interface ReproductionFixture {
  /** 저장소의 재현 허용. */
  enabled: boolean;
  /** 재현용 환경 파일 내용. 없으면 지정하지 않은 것이다. */
  envFile?: string | null;
  /** OS. 기본은 macOS다. */
  platform?: NodeJS.Platform;
  /** 사본 만들기가 실패하는지 여부. */
  failClone?: boolean;
}

async function setup({ mapped = true, reproduction = null }: { mapped?: boolean; reproduction?: ReproductionFixture | null } = {}) {
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
  /** 진단 첨부 폴더. */
  const folders = new DiagnosisAttachmentFolders(makeDir());
  diagnoses = new SentryDiagnoses({
    store,
    notifier,
    logger,
    clock,
    resolveRepo: (projectId) => projects.resolveRepo(projectId),
    isRegistered: (item) => projects.isRegistered(item),
    removeAttachments: (id) => folders.remove(id),
    replaceAttachments: (id, staged) => folders.replace(id, staged),
    discardAttachments: (staged) => folders.discard(staged),
  });
  await diagnoses.load();
  const executor = new FakeExecutor('claude-code');
  /** 지금 그 자리에 있는 것으로 보는 내보낸 파일 경로. */
  const existingExports = new Set<string>();
  /** 재현 사본을 두는 폴더. */
  const copiesRoot = join(makeDir(), 'copies');
  /** 재현용 환경 파일. */
  const envFile = reproduction?.envFile == null ? null : join(makeDir(), 'reproduction.env');
  if (envFile !== null) writeFileSync(envFile, reproduction!.envFile!);
  /** 재현 허용. 테스트가 바꿀 수 있다. */
  const reproductionState = { enabled: reproduction?.enabled ?? false };
  /** 가짜 시뮬레이터. 켜진 기기 목록과 끈 기기를 기록한다. */
  const devices = { booted: ['USER-SIM'], shutDown: [] as string[] };
  const copies = new ReproductionCopies({
    root: copiesRoot,
    clone: async (from, to, names) => {
      if (reproduction?.failClone) throw new Error('clonefile 실패');
      for (const name of names) await cp(join(from, name), join(to, name), { recursive: true });
    },
    logger,
  });
  const adapter = new SentryTargetAdapter({
    diagnoses,
    projects,
    connection,
    connectSentry: api.connect,
    settingsStore,
    repoState: async () => ({ headCommit: HEAD, uncommittedChanges: true }),
    exportFileExists: async (path) => existingExports.has(path),
    clock,
    logger,
    reproduction: {
      platform: reproduction?.platform ?? 'darwin',
      setting: () => ({ enabled: reproductionState.enabled, envFile }),
      copies,
      devices: {
        snapshot: async () => ({ ios: [...devices.booted], android: [] }),
        shutDownNew: async (before) => {
          for (const udid of devices.booted.filter((item) => !before.ios.includes(item))) devices.shutDown.push(udid);
          devices.booted = devices.booted.filter((item) => before.ios.includes(item));
        },
      },
      attachments: folders,
    },
  });
  const flow = new PassingFlowAdapter();
  /** 병렬 작업 수. */
  const parallel = { count: 1 };
  const queue = new GenerationQueue({
    adapters: [flow, adapter],
    agent: () => ({ executor, model: null, confirmForRun: async () => true }),
    onAgentChange: () => () => {},
    parallelWork: { count: () => parallel.count, onChange: () => () => {} },
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
  return {
    clock,
    api,
    logged,
    connection,
    projects,
    diagnoses,
    store,
    executor,
    queue,
    flow,
    repo,
    detect,
    byIssue,
    settingsStore,
    existingExports,
    folders,
    copiesRoot,
    devices,
    parallel,
    reproductionState,
  };
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

  it.each([
    ['접근 거부(403)', 'latestEvent', { kind: 'forbidden' }],
    ['최신 이벤트 없음(404)', 'latestEvent', { kind: 'not-found' }],
    ['앱이 모르는 응답', 'errorIssueState', { kind: 'unexpected-response' }],
    ['그 밖의 4xx', 'latestEvent', { kind: 'http', status: 400 }],
  ] as const)('기다려도 풀리지 않을 %s는 그 진단만 "Sentry에서 오류 데이터를 가져오지 못함" 실패로 두고 다음 진단은 계속한다', async (_label, method, failure) => {
    const env = await setup();
    await env.detect('101', '102');
    env.api.failNext(method, failure, '101');
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    await env.queue.start();
    await settle();

    expect(env.byIssue('101')).toMatchObject({ status: 'failed', failure: { reason: 'sentry-unavailable', runKind: null } });
    expect(env.byIssue('102')!.status).toBe('ready');
  });

  it('`5xx`는 일시적 실패라 Sentry 어댑터만 잠시 멈췄다가 다시 진단한다', async () => {
    const env = await setup();
    await env.detect('101');
    env.api.failNext('errorIssueState', { kind: 'http', status: 502 });
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    await env.queue.start();
    await settle();
    expect(env.byIssue('101')!.status).toBe('queued');

    env.clock.advance(60_000);
    await settle();
    expect(env.byIssue('101')!.status).toBe('ready');
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

/** 진단을 감지한 뒤 읽기 전용 진단으로 끝내 검토 대기로 둔다. */
async function diagnoseToReady(env: Awaited<ReturnType<typeof setup>>, issueId: string): Promise<number> {
  await env.detect(issueId);
  env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });
  await env.queue.start();
  await settle();
  /** 검토 대기가 된 진단. */
  const diagnosis = env.byIssue(issueId)!;
  expect(diagnosis.status).toBe('ready');
  return diagnosis.id;
}

/** 진단을 다시 진단으로 건다. 사용자 요청이라 대기열의 `user` 칸에 선다. */
async function rediagnose(env: Awaited<ReturnType<typeof setup>>, id: number, directive: string | null): Promise<void> {
  await env.queue.changeByUser({ kind: SENTRY_TARGET_KIND, targetId: id }, async () => {
    await env.diagnoses.rediagnose(id, directive);
  });
  await settle();
}

describe('Sentry 어댑터: 다시 진단', () => {
  it('지시 없이 다시 진단하면 앞선 보고서도 쌓인 지시도 넘기지 않고, 이벤트 데이터는 새로 받는다', async () => {
    const env = await setup();
    const id = await diagnoseToReady(env, '101');
    env.api.issues.get('101')!.latestEvent!.message = '새로 받은 이벤트 메시지';
    env.executor.script({ outcome: { type: 'completed', output: { ...reportOutput(env.repo), summary: '새 요약입니다.' } } });

    await rediagnose(env, id, null);

    /** 다시 진단의 요청. */
    const request = env.executor.requests[1]!;
    expect(request.input).not.toContain('# 직전 결과');
    expect(request.input).not.toContain('# 덧붙인 지시');
    expect(request.input).not.toContain('주문 목록이 비었을 때');
    expect(request.input).toContain('새로 받은 이벤트 메시지');
    expect(request.instructions).not.toContain('## 직전 결과와 덧붙인 지시');
    expect(env.byIssue('101')).toMatchObject({ status: 'ready', report: { summary: '새 요약입니다.' } });
  });

  it('지시를 덧붙이면 앞선 보고서와 쌓인 지시 전부를 넘기고 첨부는 넘기지 않는다', async () => {
    const env = await setup();
    const id = await diagnoseToReady(env, '101');
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    await rediagnose(env, id, '캐시를 먼저 의심해 줘');
    await rediagnose(env, id, '근거를 더 찾아 줘\n둘째 줄');

    /** 둘째 다시 진단의 요청. */
    const request = env.executor.requests[2]!;
    expect(request.input).toContain('# 직전 결과');
    expect(request.input).toContain('주문 목록이 비었을 때 첫 항목을 읽어 오류가 납니다.');
    expect(request.input).toContain('빈 배열의 첫 항목을 확인 없이 읽습니다. [근거 1]');
    expect(request.input).toContain('빈 목록을 먼저 확인합니다.');
    expect(request.input).toContain('빈 목록이 언제 오는지 확인하지 못했습니다.');
    expect(request.input).toContain('# 덧붙인 지시\n1. 캐시를 먼저 의심해 줘\n2. 근거를 더 찾아 줘\n   둘째 줄');
    expect(request.input).not.toMatch(/attachment|첨부/);
    expect(request.instructions).toContain('## 직전 결과와 덧붙인 지시');
    // 앱이 채운 "불가(허용 안 됨)" 재현 칸은 에이전트의 답이 아니라 넘기지 않는다.
    expect(request.input).not.toContain('## 재현');
    // 첫 다시 진단에는 지시가 하나뿐이었다.
    expect(env.executor.requests[1]!.input).toContain('# 덧붙인 지시\n1. 캐시를 먼저 의심해 줘');
    expect(env.executor.requests[1]!.input).not.toContain('2. ');
  });

  it('지시 없이 다시 진단하면 그 전에 쌓인 지시를 비워 다음 지시는 처음부터 쌓인다', async () => {
    const env = await setup();
    const id = await diagnoseToReady(env, '101');
    for (let count = 0; count < 3; count += 1) env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    await rediagnose(env, id, '첫 지시');
    await rediagnose(env, id, null);
    await rediagnose(env, id, '새 지시');

    expect(env.executor.requests[3]!.input).toContain('# 덧붙인 지시\n1. 새 지시');
    expect(env.executor.requests[3]!.input).not.toContain('첫 지시');
  });

  it('다시 진단하는 동안 앞선 보고서를 보관하고, 새 보고서가 나오면 바꾼다', async () => {
    const env = await setup();
    const id = await diagnoseToReady(env, '101');
    env.executor.script({ outcome: 'wait-for-abort' });

    await rediagnose(env, id, '더 짧게');

    expect(env.byIssue('101')).toMatchObject({ status: 'queued', report: { summary: '주문 목록이 비었을 때 첫 항목을 읽어 오류가 납니다.' } });
    expect(env.queue.progress({ kind: SENTRY_TARGET_KIND, targetId: id })).not.toBeNull();
  });

  it('다시 진단이 실패하면 진단 실패가 아니라 앞선 보고서로 돌아오고 지시는 남는다', async () => {
    const env = await setup();
    const id = await diagnoseToReady(env, '101');
    env.executor.script({ outcome: { type: 'timed-out' } });
    env.executor.script({ outcome: { type: 'timed-out' } });

    await rediagnose(env, id, '더 짧게');

    expect(env.byIssue('101')).toMatchObject({
      status: 'ready',
      failure: null,
      directives: ['더 짧게'],
      rediagnosisFailure: { reason: 'timed-out', runKind: 'diagnosis' },
      report: { summary: '주문 목록이 비었을 때 첫 항목을 읽어 오류가 납니다.' },
    });
  });

  it('다시 진단을 취소하면 앞선 보고서로 돌아온다', async () => {
    const env = await setup();
    const id = await diagnoseToReady(env, '101');
    env.executor.script({ outcome: 'wait-for-abort' });
    await rediagnose(env, id, null);

    await env.queue.cancel({ kind: SENTRY_TARGET_KIND, targetId: id });
    await settle();

    expect(env.byIssue('101')).toMatchObject({ status: 'ready', rediagnosisFailure: { reason: 'cancelled' } });
    expect(env.byIssue('101')!.report).not.toBeNull();
  });

  it('다시 진단 사이 오류 이슈가 해결·보관돼도 사용자가 요청했으니 조용히 빼지 않고 진단한다', async () => {
    const env = await setup();
    const id = await diagnoseToReady(env, '101');
    env.api.issues.get('101')!.status = 'resolved';
    env.executor.script({ outcome: { type: 'completed', output: { ...reportOutput(env.repo), summary: '해결된 뒤의 요약입니다.' } } });

    await rediagnose(env, id, null);

    expect(env.byIssue('101')).toMatchObject({ status: 'ready', report: { summary: '해결된 뒤의 요약입니다.' } });
  });

  it('다시 진단 사이 오류 이슈가 삭제됐으면 앞선 보고서를 지우지 않고 돌아와 사유를 알린다', async () => {
    const env = await setup();
    const id = await diagnoseToReady(env, '101');
    env.api.issues.delete('101');

    await rediagnose(env, id, null);

    expect(env.byIssue('101')).toMatchObject({ status: 'ready', rediagnosisFailure: { reason: 'sentry-unavailable' } });
    expect(env.byIssue('101')!.report).not.toBeNull();
  });

  it('다시 진단 사이 저장소 폴더가 사라지면 저장소 대기가 아니라 앞선 보고서로 돌아온다', async () => {
    const env = await setup();
    const id = await diagnoseToReady(env, '101');
    rmSync(env.repo, { recursive: true, force: true });

    await rediagnose(env, id, null);

    expect(env.byIssue('101')).toMatchObject({ status: 'ready', rediagnosisFailure: { reason: 'repository-unavailable' } });
  });
});

describe('Sentry 어댑터: 앞선 진단 참고', () => {
  /** 같은 오류 이슈에 새 재발을 감지한다. */
  const regress = async (env: Awaited<ReturnType<typeof setup>>, issueId: string, eventId: string) => {
    await env.diagnoses.record({
      registration: registration(),
      checkpoint: NOW,
      detectedAt: NOW + MINUTE,
      detected: [{ origin: 'regression', issue: listed(issueId), eventId }],
    });
    return env.diagnoses.list().filter((item) => item.issueId === issueId).at(-1)!;
  };

  it('검토 대기 중 재발로 만든 새 진단의 입력에 앞선 보고서의 요약·원인·개선 방향이 참고일 뿐이라는 문구와 함께 들어가고, 보고서에 앞선 진단이 적힌다', async () => {
    const env = await setup();
    await diagnoseToReady(env, '101');
    env.executor.script({ outcome: { type: 'completed', output: { ...reportOutput(env.repo), summary: '새 보고서 요약입니다.' } } });

    const second = await regress(env, '101', 'event-r1');
    await settle();

    /** 새 진단의 요청. */
    const request = env.executor.requests[1]!;
    expect(request.input).toContain('# 앞선 진단');
    expect(request.input).toContain('참고일 뿐이고 이 원인이 틀렸을 수 있습니다');
    expect(request.input).toContain('주문 목록이 비었을 때 첫 항목을 읽어 오류가 납니다.');
    expect(request.input).toContain('빈 배열의 첫 항목을 확인 없이 읽습니다.');
    expect(request.input).toContain('빈 목록을 먼저 확인합니다.');
    // 앞선 진단의 근거와 남은 의문은 넘기지 않는다.
    expect(request.input).not.toContain('빈 목록이 언제 오는지');
    expect(request.input).not.toContain('# 직전 결과');
    expect(request.instructions).toContain('## 앞선 진단');
    expect(env.diagnoses.get(second.id)?.report).toMatchObject({ summary: '새 보고서 요약입니다.', priorDiagnosis: { kind: 'in-review' } });
    // 앞선 보고서는 그대로다.
    expect(env.byIssue('101')!.report!.priorDiagnosis).toBeNull();
  });

  it('완료한 뒤 재발한 진단의 입력에는 아무것도 넘기지 않고, 보고서에 완료한 날짜와 마지막으로 내보낸 파일 경로가 적힌다', async () => {
    const env = await setup();
    const first = await diagnoseToReady(env, '101');
    await env.diagnoses.recordExport(first, { path: '/내보냄/old.md', at: NOW, reportCreatedAt: NOW });
    env.existingExports.add('/내보냄/old.md');
    await env.diagnoses.complete(first);
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    const second = await regress(env, '101', 'event-r1');
    await settle();

    /** 새 진단의 요청. */
    const request = env.executor.requests[1]!;
    expect(request.input).not.toContain('# 앞선 진단');
    expect(request.input).not.toContain('주문 목록이 비었을 때');
    expect(request.input).not.toContain('/내보냄/old.md');
    expect(request.instructions).not.toContain('## 앞선 진단');
    expect(env.diagnoses.get(second.id)?.report?.priorDiagnosis).toEqual({ kind: 'completed', completedAt: NOW, exportPath: '/내보냄/old.md' });
  });

  it('내보낸 파일이 그 자리에 없거나 내보낸 적이 없으면 날짜만 적는다', async () => {
    const env = await setup();
    const first = await diagnoseToReady(env, '101');
    await env.diagnoses.recordExport(first, { path: '/내보냄/gone.md', at: NOW, reportCreatedAt: NOW });
    await env.diagnoses.complete(first);
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    const second = await regress(env, '101', 'event-r1');
    await settle();

    expect(env.diagnoses.get(second.id)?.report?.priorDiagnosis).toEqual({ kind: 'completed', completedAt: NOW, exportPath: null });
  });

  it('앞선 진단이 없으면 보고서의 앞선 진단 칸은 비어 있다', async () => {
    const env = await setup();
    await diagnoseToReady(env, '101');

    expect(env.byIssue('101')!.report!.priorDiagnosis).toBeNull();
  });
});

/** 재현하는 진단의 출력. 재현 칸과 사본 안 첨부 경로가 더해진다. */
function reproducingOutput(repository: string, reproduction: Record<string, unknown> = {}) {
  return {
    ...reportOutput(repository),
    reproduction: {
      result: 'success',
      impossible_reason: null,
      method: '개발 서버에 빈 주문 목록 요청 3번 중 3번',
      steps: ['pnpm dev', '빈 주문 목록으로 /orders 요청'],
      attachments: [],
      ...reproduction,
    },
  };
}

/** 사본 폴더 안의 사본. 지우기는 기다리지 않으므로 잠시 기다리며 본다. */
async function copiesLeft(root: string): Promise<string[]> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    /** 남은 사본. */
    const left = existsSync(root) ? readdirSync(root) : [];
    if (left.length === 0) return left;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return existsSync(root) ? readdirSync(root) : [];
}

describe('Sentry 어댑터: 재현하는 진단', () => {
  it('재현 허용이 켜진 저장소의 진단은 원본의 사본에서 재현 경계로 돈다. 사본에는 .git이 없고 재현용 환경 파일이 .env가 된다', async () => {
    const env = await setup({ reproduction: { enabled: true, envFile: 'FAKE=staging\n' } });
    mkdirSync(join(env.repo, '.git'));
    writeFileSync(join(env.repo, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await env.detect('101');
    /** 실행 중에 본 사본의 내용. */
    let seen: { entries: string[]; env: string } | null = null;
    env.executor.script({
      outcome: { type: 'completed', output: reproducingOutput(env.repo) },
      during: (request) => {
        /** 사본. */
        const copy = request.reproduction!.copyRoot;
        seen = { entries: readdirSync(copy).sort(), env: readFileSync(join(copy, '.env'), 'utf8') };
      },
    });

    await env.queue.start();
    await settle();

    /** 실행기가 받은 요청. */
    const request = env.executor.requests[0]!;
    expect(request.reproduction?.copyRoot.startsWith(env.copiesRoot.replace(/^\/var\//, '/private/var/'))).toBe(true);
    expect(request.readRoots).toEqual([request.reproduction!.copyRoot]);
    expect(request.instructions).toContain('피드백 루프');
    expect(request.instructions).not.toContain(EXTRA_INSTRUCTIONS);
    expect(Object.keys((request.outputSchema as { properties: object }).properties)).toContain('reproduction');
    expect(request.input).toContain(`# 재현 사본\n- ${request.reproduction!.copyRoot}`);
    expect(seen).toEqual({ entries: ['.env', 'src'], env: 'FAKE=staging\n' });
    // 원본은 바뀌지 않는다.
    expect(readFileSync(join(env.repo, '.env'), 'utf8')).toBe('FAKE=1\n');
    expect(env.byIssue('101')!.report).toMatchObject({
      reproduction: { result: 'success', impossibleReason: null, method: '개발 서버에 빈 주문 목록 요청 3번 중 3번', steps: ['pnpm dev', '빈 주문 목록으로 /orders 요청'] },
      run: { repository: env.repo, reproductionAllowed: true },
      evidence: [{ repository: env.repo, path: 'src/fake.ts', located: true }],
    });
    // 끝나면 사본을 지운다.
    expect(await copiesLeft(env.copiesRoot)).toEqual([]);
  });

  it('에이전트가 근거의 저장소를 사본 경로로 적어도 원본 저장소로 고쳐 위치를 확인한다', async () => {
    const env = await setup({ reproduction: { enabled: true } });
    await env.detect('101');
    /** 사본 경로로 적은 결과. */
    let finish!: (outcome: ExecutorOutcome) => void;
    env.executor.script({
      outcome: new Promise<ExecutorOutcome>((resolve) => (finish = resolve)),
      during: (request) => finish({ type: 'completed', output: reproducingOutput(request.reproduction!.copyRoot) }),
    });

    await env.queue.start();
    await settle();

    expect(env.byIssue('101')!.report!.evidence).toEqual([expect.objectContaining({ repository: env.repo, path: 'src/fake.ts', located: true })]);
  });

  it('재현 결과·방법·순서와 첨부가 보고서에 실린다. 허용한 종류와 한도 안의 첨부만 진단별 폴더로 옮기고 나머지는 생략한 수로 적는다', async () => {
    const env = await setup({ reproduction: { enabled: true } });
    await env.detect('101');
    /** 결과를 낼 함수. */
    let finish!: (outcome: ExecutorOutcome) => void;
    env.executor.script({
      outcome: new Promise<ExecutorOutcome>((resolve) => (finish = resolve)),
      during: (request) => {
        /** 사본. */
        const copy = request.reproduction!.copyRoot;
        mkdirSync(join(copy, 'repro'));
        writeFileSync(join(copy, 'repro', 'orders.png'), 'png');
        writeFileSync(join(copy, 'repro', 'server.log'), 'TypeError: 시험 오류 메시지\n');
        writeFileSync(join(copy, 'repro', 'fix.patch'), 'diff');
        finish({
          type: 'completed',
          output: reproducingOutput(env.repo, { result: 'failure', attachments: ['repro/orders.png', join(copy, 'repro/server.log'), 'repro/fix.patch', '.env'] }),
        });
      },
    });

    await env.queue.start();
    await settle();

    /** 저장된 진단. */
    const diagnosis = env.byIssue('101')!;
    expect(diagnosis.report).toMatchObject({
      reproduction: { result: 'failure' },
      attachments: [
        { name: 'orders.png', sizeBytes: 3 },
        { name: 'server.log', sizeBytes: Buffer.byteLength('TypeError: 시험 오류 메시지\n') },
      ],
      omittedAttachments: 2,
    });
    expect(await env.folders.list(diagnosis.id)).toEqual(['orders.png', 'server.log']);
    expect(await copiesLeft(env.copiesRoot)).toEqual([]);
  });

  it('실행 전에 켜져 있던 시뮬레이터는 그대로 두고 실행이 새로 켠 것만 끈다. 실패해도, 취소해도 사본을 지우고 정리한다', async () => {
    const env = await setup({ reproduction: { enabled: true } });
    await env.detect('101', '102');
    env.executor.script({
      outcome: { type: 'failed', reason: 'agent-error', detail: '가짜 실패' },
      during: () => void env.devices.booted.push('NEW-SIM-1'),
    });
    env.executor.script({ outcome: 'wait-for-abort', during: () => void env.devices.booted.push('NEW-SIM-2') });

    await env.queue.start();
    await settle();
    expect(env.byIssue('101')!.status).toBe('failed');
    expect(env.devices.shutDown).toEqual(['NEW-SIM-1']);

    await env.queue.cancel({ kind: SENTRY_TARGET_KIND, targetId: env.byIssue('102')!.id });
    await settle();

    expect(env.byIssue('102')!.failure?.reason).toBe('cancelled');
    expect(env.devices.shutDown).toEqual(['NEW-SIM-1', 'NEW-SIM-2']);
    expect(env.devices.booted).toEqual(['USER-SIM']);
    expect(await copiesLeft(env.copiesRoot)).toEqual([]);
  });

  it('재현하는 진단은 한 번에 하나만 돌고, 그사이 읽기 전용 진단과 초안은 진행된다', async () => {
    const env = await setup({ reproduction: { enabled: true } });
    env.parallel.count = 3;
    await env.detect('101', '102');
    env.executor.script({ outcome: 'wait-for-abort' });

    await env.queue.start();
    env.flow.add(1);
    await settle();

    expect(env.executor.requests).toHaveLength(1);
    expect(env.flow.saved).toEqual([1]);
    expect(env.queue.progress({ kind: SENTRY_TARGET_KIND, targetId: env.byIssue('102')!.id })).toEqual({ status: 'waiting' });

    env.executor.script({ outcome: { type: 'completed', output: reproducingOutput(env.repo) } });
    await env.queue.cancel({ kind: SENTRY_TARGET_KIND, targetId: env.byIssue('101')!.id });
    await settle();
    expect(env.executor.requests).toHaveLength(2);
    expect(env.byIssue('102')!.status).toBe('ready');
  });

  it('재현 허용이 꺼진 저장소와 Windows의 진단은 읽기 전용 그대로이고 사본을 만들지 않는다. 실행 정보의 재현 허용은 저장소 설정을 따른다', async () => {
    for (const fixture of [{ enabled: false }, { enabled: true, platform: 'win32' as const }]) {
      const env = await setup({ reproduction: fixture });
      await env.detect('101');
      env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

      await env.queue.start();
      await settle();

      expect(env.executor.requests[0]!.reproduction ?? null).toBeNull();
      expect(env.executor.requests[0]!.readRoots).toEqual([env.repo]);
      expect(existsSync(env.copiesRoot)).toBe(false);
      expect(env.byIssue('101')!.report).toMatchObject({ reproduction: { result: 'impossible', impossibleReason: 'not-allowed' }, run: { reproductionAllowed: false } });
      await env.queue.stop();
    }
  });

  it('사본을 만들지 못하면 코드만 읽고 진단하고, 재현 칸은 앱이 불가(환경 실패)로 채운다', async () => {
    const env = await setup({ reproduction: { enabled: true, failClone: true } });
    await env.detect('101');
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    await env.queue.start();
    await settle();

    expect(env.executor.requests[0]!.reproduction ?? null).toBeNull();
    expect(env.executor.requests[0]!.readRoots).toEqual([env.repo]);
    expect(env.byIssue('101')!.report).toMatchObject({ reproduction: { result: 'impossible', impossibleReason: 'env-failed' }, run: { reproductionAllowed: true } });
  });
});

describe('Sentry 어댑터: 재현도 다시 하기', () => {
  /** 재현에 성공하고 첨부 하나를 남긴 검토 대기 보고서를 만든다. */
  async function readyWithReproduction(env: Awaited<ReturnType<typeof setup>>): Promise<number> {
    await env.detect('101');
    /** 결과를 낼 함수. */
    let finish!: (outcome: ExecutorOutcome) => void;
    env.executor.script({
      outcome: new Promise<ExecutorOutcome>((resolve) => (finish = resolve)),
      during: (request) => {
        writeFileSync(join(request.reproduction!.copyRoot, 'first.png'), 'png');
        finish({ type: 'completed', output: reproducingOutput(env.repo, { attachments: ['first.png'] }) });
      },
    });
    await env.queue.start();
    await settle();
    return env.byIssue('101')!.id;
  }

  it('지시를 덧붙이며 재현도 다시 하기를 끄면 읽기 전용으로 돌고, 앞선 재현 칸과 첨부를 그대로 옮긴다', async () => {
    const env = await setup({ reproduction: { enabled: true } });
    const id = await readyWithReproduction(env);
    env.executor.script({ outcome: { type: 'completed', output: { ...reportOutput(env.repo), summary: '지시를 반영한 요약입니다.' } } });

    await env.queue.changeByUser({ kind: SENTRY_TARGET_KIND, targetId: id }, async () => void (await env.diagnoses.rediagnose(id, '원인을 더 자세히', { reproduce: false })));
    await settle();

    /** 다시 진단의 요청. */
    const request = env.executor.requests[1]!;
    expect(request.reproduction ?? null).toBeNull();
    expect(Object.keys((request.outputSchema as { properties: object }).properties)).not.toContain('reproduction');
    expect(env.byIssue('101')!.report).toMatchObject({
      summary: '지시를 반영한 요약입니다.',
      reproduction: { result: 'success', method: '개발 서버에 빈 주문 목록 요청 3번 중 3번' },
      attachments: [{ name: 'first.png', sizeBytes: 3 }],
      run: { reproductionAllowed: true },
    });
    expect(await env.folders.list(id)).toEqual(['first.png']);
  });

  it('그사이 저장소의 재현 허용을 껐으면 재현을 끈 다시 진단이어도 앞선 재현을 옮기지 않고 불가(허용 안 됨)로 채운다', async () => {
    const env = await setup({ reproduction: { enabled: true } });
    const id = await readyWithReproduction(env);
    env.reproductionState.enabled = false;
    env.executor.script({ outcome: { type: 'completed', output: reportOutput(env.repo) } });

    await env.queue.changeByUser({ kind: SENTRY_TARGET_KIND, targetId: id }, async () => void (await env.diagnoses.rediagnose(id, '원인을 더 자세히', { reproduce: false })));
    await settle();

    expect(env.byIssue('101')!.report).toMatchObject({ reproduction: { result: 'impossible', impossibleReason: 'not-allowed' }, attachments: [], run: { reproductionAllowed: false } });
    expect(await env.folders.list(id)).toEqual([]);
  });

  it('지시 없는 다시 진단과 재현도 다시 하기를 켠 다시 진단은 다시 재현하고 재현 칸과 첨부를 새 결과로 바꾼다', async () => {
    const env = await setup({ reproduction: { enabled: true } });
    const id = await readyWithReproduction(env);
    env.executor.script({ outcome: { type: 'completed', output: reproducingOutput(env.repo, { result: 'failure' }) } });

    await env.queue.changeByUser({ kind: SENTRY_TARGET_KIND, targetId: id }, async () => void (await env.diagnoses.rediagnose(id, null)));
    await settle();

    expect(env.executor.requests[1]!.reproduction).not.toBeNull();
    expect(env.byIssue('101')!.report).toMatchObject({ reproduction: { result: 'failure' }, attachments: [] });
    expect(await env.folders.list(id)).toEqual([]);
  });
});
