import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MentionBundles } from '../bundles/mention-bundles';
import { MentionDetection } from '../detection/mention-detection';
import { FakeClock } from '../fakes/fake-clock';
import { FakeExecutor } from '../fakes/fake-executor';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { collectBundleContext } from '../flow/bundle-context';
import { MentionJudge } from '../flow/mention-judgement';
import { createLogger } from '../logging/logger';
import type { ExecutorOutcome } from '../ports/executor';
import type { FlowAlarm } from '../ports/flow-api';
import { RepoMappings } from '../repos/repo-mappings';
import { DRAFT_INSTRUCTIONS } from './draft-input';
import { draftAgentFrom, DraftQueue } from './draft-queue';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시(00:00:00 UTC). */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 나(키 소유자)의 사용자 ID. */
const ME = FAKE_ME.userId;
/** 송신자. 실제 사람이 아니다. */
const SENDER = 'sender@example.test';
/** 다른 송신자. 실제 사람이 아니다. */
const OTHER_SENDER = 'other@example.test';
/** 멘션이 온 Flow 프로젝트. */
const PROJECT_ID = '900001';
/** 멘션이 온 게시물. */
const POST_ID = '90000011';
/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${ME})`;
/** 폴링 주기(밀리초). */
const POLL_MS = 60_000;

/** 테스트마다 만드는 임시 폴더. 가짜 저장소를 둔다. */
let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'stardraft-drafts-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 가짜 멘션 알림. 기본은 08:50에 온 댓글 멘션이다. */
function alarm(alarmId: string, overrides: Partial<FlowAlarm> = {}): FlowAlarm {
  return {
    alarmId,
    projectId: PROJECT_ID,
    postId: POST_ID,
    remarkId: '700',
    replyId: '-1',
    receiverId: ME,
    registerId: SENDER,
    registerName: '보낸 사람',
    registeredDateTime: '20261020085000',
    ...overrides,
  };
}

/**
 * 가짜 시계가 부른 일과 가짜 포트의 응답이 모두 끝나도록 대기 중인 비동기 일을 여러 번 돌린다. 가짜 포트는 모두 바로 답한다.
 * 저장소 폴더 확인과 근거 위치 검증은 임시 폴더의 실제 파일을 읽으므로, 파일 읽기가 끝날 틈을 실제 시간으로도 준다.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** 근거 하나가 든 가짜 초안 실행 출력. `repository`는 넘긴 저장소 가운데 하나다. */
function draftOutput(repository: string) {
  return {
    requirement: { text: '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.', summary: '재시도 횟수' },
    paragraphs: [
      {
        sentences: [
          { text: '실제 서비스에서는 다섯 번까지 다시 시도합니다.', evidence: [1] },
          { text: '시험 환경은 세 번으로 보입니다.', evidence: [] },
        ],
      },
    ],
    evidence: [
      {
        id: 1,
        explanation: '운영 설정에서 다시 시도하는 횟수를 5로 정해 둡니다.',
        repository,
        path: 'src/main/resources/application-prod.yml',
        start_line: 88,
        end_line: 88,
      },
    ],
  };
}

/** 풀어 줄 때까지 끝나지 않는 실행 결과. */
function heldOutcome(): { outcome: Promise<ExecutorOutcome>; release: (outcome: ExecutorOutcome) => void } {
  /** 결과를 풀어 줄 함수. */
  let release: (outcome: ExecutorOutcome) => void = () => {};
  /** 풀릴 결과. */
  const outcome = new Promise<ExecutorOutcome>((resolve) => (release = resolve));
  return { outcome, release };
}

/** 감지한 묶음을 저장하는 일을 붙잡아 둘 수 있는 상태 저장소. 저장이 끝나기 전에 다른 일이 줄을 서는 경우를 만든다. */
class GatedStateStore extends MemoryStateStore {
  /** 붙잡은 저장을 놓아 줄 함수. 붙잡지 않으면 `null`. */
  private open: (() => void) | null = null;
  /** 다음 저장을 붙잡을지 여부. */
  private armed = false;

  /** 다음 감지 저장을 놓아 줄 때까지 붙잡는다. */
  holdNextDetection(): void {
    this.armed = true;
  }

  /** 붙잡은 저장을 놓아 준다. */
  releaseDetection(): void {
    this.open?.();
    this.open = null;
  }

  override async saveDetectedBundles(...args: Parameters<MemoryStateStore['saveDetectedBundles']>) {
    if (this.armed) {
      this.armed = false;
      await new Promise<void>((resolve) => (this.open = resolve));
    }
    return super.saveDetectedBundles(...args);
  }
}

/** 가짜 포트로 멘션 감지, 멘션 묶음, 초안 대기열을 만든다. 기준점은 `'100'`, 계정은 가짜 키 소유자다. */
async function setup() {
  /** 매핑된 가짜 저장소 둘. */
  const repos = { a: join(workDir, 'repo-a'), b: join(workDir, 'repo-b') };
  mkdirSync(repos.a);
  mkdirSync(repos.b);
  // 가짜 초안 출력의 근거가 가리키는 파일. 근거 위치 검증을 통과하도록 100줄로 둔다.
  mkdirSync(join(repos.a, 'src/main/resources'), { recursive: true });
  writeFileSync(join(repos.a, 'src/main/resources/application-prod.yml'), 'retry: 5\n'.repeat(100));

  const clock = new FakeClock(NOW);
  const flow = new FakeFlowApi();
  flow.respondToListParticipantProjects({ ok: true, value: [{ projectId: PROJECT_ID, title: '가짜 프로젝트', projectUrl: null }] });
  const stateStore = new GatedStateStore();
  stateStore.account = { ...FAKE_ME };
  stateStore.baselineAlarmId = '100';
  const settingsStore = new MemorySettingsStore({ repoMappings: { [PROJECT_ID]: [repos.a, repos.b] } });
  const notifier = new RecordingNotifier();
  const logger = createLogger([{ write: () => {} }], clock);
  /** 지금 키로 부르는 가짜 Flow. */
  const connectFlow = () => ({ api: flow, reportKeyRejected: () => {} });
  const repoMappings = new RepoMappings({ settingsStore, logger, connectFlow });
  await repoMappings.load();
  const bundles = new MentionBundles({
    stateStore,
    notifier,
    clock,
    logger,
    findMyAnswers: (place) => new MentionJudge(flow, ME).myAnswers(place, [ME]),
    collectContext: (bundle) => collectBundleContext(flow, bundle, clock.now(), [ME]),
    resolveRepos: (projectId) => repoMappings.resolve(projectId),
  });
  await bundles.load();
  const executor = new FakeExecutor('claude-code');
  /** 에이전트 연결 상태와 바뀔 때 부를 함수. */
  const agent = { connected: true, listeners: new Set<() => void>() };
  const drafts = new DraftQueue({
    bundles,
    agent: () => (agent.connected ? { executor, model: 'sonnet' } : null),
    onAgentChange: (listener) => {
      agent.listeners.add(listener);
      return () => agent.listeners.delete(listener);
    },
    settingsStore,
    myName: () => FAKE_ME.name,
    projectTitle: (projectId) => repoMappings.projectTitle(projectId),
    clock,
    logger,
  });
  drafts.start();
  const detection = new MentionDetection({ stateStore, bundles, clock, logger, connectFlow });
  flow.addPost({
    postId: POST_ID,
    title: '가짜 게시물',
    connectUrl: 'https://fake.flow.test/post/90000011',
    registerName: '글쓴이',
    registeredDateTime: '20261020080000',
    textComponents: [{ contents: '재시도 설정을 정리한 글입니다.', mentions: [] }],
    attachments: ['재시도표.xlsx'],
  });
  flow.addComment(POST_ID, {
    commentId: '700',
    contents: `${MY_MARKUP} 재시도는 몇 번 하나요?`,
    registerId: SENDER,
    registerName: '보낸 사람',
    registeredDateTime: '20261020085000',
  });

  /** 감지를 시작했는지 여부. */
  let started = false;
  /** 새 알림을 맨 앞에 두고 한 번 조회한 뒤, 이어지는 초안 대기열의 일을 끝까지 돌린다. */
  const poll = async (...alarms: FlowAlarm[]) => {
    for (const item of alarms) flow.addAlarm(item);
    if (!started) {
      started = true;
      await detection.start();
    } else {
      clock.advance(POLL_MS);
    }
    await settle();
  };
  /** 에이전트 연결을 바꾼다. */
  const setConnected = (connected: boolean) => {
    agent.connected = connected;
    for (const listener of agent.listeners) listener();
  };
  return { clock, flow, stateStore, settingsStore, notifier, bundles, executor, drafts, repos, poll, setConnected };
}

describe('초안 실행: 생성 중에서 준비됨으로', () => {
  it('저장소 매핑이 있는 Flow 프로젝트의 멘션 묶음은 생성 중이 되고, 초안 실행이 끝나면 요구·초안·근거·쓴 저장소를 담아 준비됨이 되며 OS 알림을 띄운다', async () => {
    const { executor, bundles, notifier, repos, poll } = await setup();
    /** 끝나지 않고 기다리는 초안 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });

    await poll(alarm('101'));

    expect(bundles.state().map((bundle) => bundle.status)).toEqual(['generating']);
    expect(bundles.reviewCount()).toBe(0);
    expect(notifier.sent).toEqual([]);

    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();

    /** 준비된 묶음. */
    const [ready] = bundles.state();
    expect(ready?.status).toBe('ready');
    expect(ready?.draft).toEqual({
      requirement: { text: '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.', summary: '재시도 횟수' },
      paragraphs: [
        {
          sentences: [
            { text: '실제 서비스에서는 다섯 번까지 다시 시도합니다.', evidence: [1] },
            { text: '시험 환경은 세 번으로 보입니다.', evidence: [] },
          ],
        },
      ],
      evidence: [
        {
          id: 1,
          explanation: '운영 설정에서 다시 시도하는 횟수를 5로 정해 둡니다.',
          repository: repos.a,
          path: 'src/main/resources/application-prod.yml',
          startLine: 88,
          endLine: 88,
          located: true,
        },
      ],
      repositories: [repos.a, repos.b],
      createdAt: NOW,
    });
    expect(bundles.reviewCount()).toBe(1);
    expect(notifier.sent).toEqual([{ title: '초안 준비됨', body: '보낸 사람님 멘션에 답할 초안이 준비됐습니다.', bundleId: ready?.id }]);
  });
});

describe('초안 실행: 입력', () => {
  it('멘션 원문 전부를 시간순으로 마지막 멘션에 답할 대상 표시와 멘션 위치를 붙여 넘기고, 맥락·송신자·내 이름·Flow 프로젝트 이름·첨부·읽을 저장소를 표준 입력 문서에 담는다. Flow 사용자 ID는 넘기지 않는다', async () => {
    const { flow, executor, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addReply(POST_ID, '700', {
      replyId: '801',
      contents: `${MY_MARKUP} 운영 기준으로 알려 주세요`,
      registerId: OTHER_SENDER,
      registerName: '다른 사람',
      registeredDateTime: '20261020085500',
    });

    await poll(
      alarm('101'),
      alarm('102', { replyId: '801', registerId: OTHER_SENDER, registerName: '다른 사람', registeredDateTime: '20261020085500' }),
    );

    /** 초안 실행 요청. */
    const [request] = executor.requests;
    expect(request?.kind).toBe('draft');
    /** 입력 문서. */
    const input = request?.input ?? '';
    expect(input).toContain(`# 읽을 저장소\n- ${repos.a}\n- ${repos.b}`);
    expect(input).toContain('답변 명의자(나): 테스트 사용자');
    expect(input).toContain('Flow 프로젝트: 가짜 프로젝트');
    expect(input).toContain('## 멘션 2건 (시간순, 마지막이 답할 대상)');
    expect(input).toContain('1. 보낸 사람 · 2026-10-20 08:50 · 댓글\n   @테스트 사용자 재시도는 몇 번 하나요?');
    expect(input).toContain('2. [답할 대상] 다른 사람 · 2026-10-20 08:55 · 대댓글\n   @테스트 사용자 운영 기준으로 알려 주세요');
    expect(input).toContain('제목: 가짜 게시물');
    expect(input).toContain('재시도 설정을 정리한 글입니다.');
    expect(input).toContain('첨부 있음(재시도표.xlsx)');
    // 데이터 구획(Flow에서 온 글)은 앱이 정한 읽을 저장소 뒤에서 시작해 문서 끝까지다.
    expect(input.indexOf('\n# 데이터\n')).toBeGreaterThan(input.indexOf('\n# 읽을 저장소\n'));
    expect(input.indexOf('\n# 데이터\n')).toBeLessThan(input.indexOf('## 멘션 2건'));
    for (const userId of [ME, SENDER, OTHER_SENDER]) expect(input).not.toContain(userId);
  });

  it('기본 지침 뒤에 추가 지침을 붙이고, 초안 실행 스키마와 함께 첫 저장소를 cwd로, 나머지를 읽기 범위로 넘긴다. 제한 시간은 10분이다', async () => {
    const { executor, repos, settingsStore, poll } = await setup();
    settingsStore.settings.extraInstructions = '  맺음말로 "확인 부탁드립니다"를 붙입니다.  ';
    settingsStore.settings.extraSecretPatterns = ['*.secret.yml'];
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });

    await poll(alarm('101'));

    /** 초안 실행 요청. */
    const [request] = executor.requests;
    expect(request?.instructions.startsWith(DRAFT_INSTRUCTIONS)).toBe(true);
    expect(request?.instructions.endsWith('\n\n## 사용자의 추가 지침\n맺음말로 "확인 부탁드립니다"를 붙입니다.')).toBe(true);
    for (const rule of ['합니다체', '결론을 첫 문장에', '5문장 이내, 최대 2문단', '인사와 서명을 넣지 않습니다', '단정하지 않습니다', '코드와 무관한 멘션', '"# 데이터" 줄부터']) {
      expect(request?.instructions).toContain(rule);
    }
    expect(request).toMatchObject({
      readRoots: [repos.a, repos.b],
      secretPatterns: ['*.secret.yml'],
      model: 'sonnet',
      timeoutMs: 10 * 60 * 1000,
    });
    // 근거의 저장소는 문자열이면 받는다. 넘긴 저장소가 아닌 값은 구조 실패로 돌리지 않고 출력 검증이 다룬다.
    expect(request?.outputSchema).toMatchObject({
      required: ['requirement', 'paragraphs', 'evidence'],
      properties: { evidence: { items: { required: ['id', 'explanation', 'repository', 'path', 'start_line', 'end_line'], properties: { repository: { type: 'string' } } } } },
    });
    expect(JSON.stringify(request?.outputSchema)).not.toContain('enum');
  });
});

describe('초안 실행: 형식 위반과 실패', () => {
  it('구조 실패(구조화 출력 없음, 스키마 모양이 아님)는 한 번 더 실행하고, 두 번째에 초안을 받으면 준비됨이 된다', async () => {
    const { executor, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'invalid-output', detail: '결과에 구조화 출력이 없습니다.' } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });

    await poll(alarm('101'));

    /** 준비된 묶음. */
    const [ready] = bundles.state();
    expect(ready?.status).toBe('ready');
    expect(executor.requests).toHaveLength(2);
    expect(ready?.runs.map((run) => run.result)).toEqual(['invalid-output', 'succeeded']);
  });

  it('두 번 모두 구조 실패면 실패가 되고, 사유는 구조 실패다', async () => {
    const { executor, bundles, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: { requirement: '문장이 아니라 글 하나' } } });
    executor.script({ outcome: { type: 'invalid-output', detail: '스키마에 맞는 구조화 출력을 만들지 못했습니다.' } });

    await poll(alarm('101'));

    /** 실패한 묶음. */
    const [failed] = bundles.state();
    expect(failed?.status).toBe('failed');
    expect(failed?.failure).toEqual({ reason: 'invalid-output', detail: '스키마에 맞는 구조화 출력을 만들지 못했습니다.', lastStep: '초안 쓰는 중' });
    expect(failed?.draft).toBeNull();
    expect(executor.requests).toHaveLength(2);
    expect(bundles.reviewCount()).toBe(0);
  });

  it('초안 문장이 하나도 없으면 다시 실행하지 않고 "빈 초안" 실패가 된다', async () => {
    const { executor, bundles, poll } = await setup();
    executor.script({
      outcome: {
        type: 'completed',
        output: { requirement: { text: '요구', summary: '요약' }, paragraphs: [{ sentences: [{ text: '  ', evidence: [] }] }], evidence: [] },
      },
    });

    await poll(alarm('101'));

    expect(bundles.state()[0]).toMatchObject({ status: 'failed', failure: { reason: 'empty-draft' }, draft: null });
    expect(executor.requests).toHaveLength(1);
  });

  it('스키마에는 맞지만 내용이 어긋난 출력은 실패로 돌리지 않고 근거가 줄어드는 쪽으로 고쳐 준비됨이 되며, 고친 내용은 실행 기록에만 남는다', async () => {
    const { executor, bundles, stateStore, repos, poll } = await setup();
    /** 없는 번호, 참조 없는 근거, 넘기지 않은 저장소, 파일 길이를 넘는 줄 범위가 섞인 출력. */
    const output = draftOutput(repos.a);
    output.paragraphs[0]!.sentences = [
      { text: '실제 서비스에서는 다섯 번까지 다시 시도합니다.', evidence: [4, 9] },
      { text: '시험 환경은 세 번으로 보입니다.', evidence: [1] },
    ];
    output.evidence = [
      { ...output.evidence[0]!, id: 1, repository: join(workDir, 'repo-c') },
      { ...output.evidence[0]!, id: 4, start_line: 99, end_line: 101 },
      { ...output.evidence[0]!, id: 6, explanation: '참조 없는 근거' },
    ];
    executor.script({ outcome: { type: 'completed', output } });

    await poll(alarm('101'));

    /** 준비된 묶음. */
    const [ready] = bundles.state();
    expect(ready?.status).toBe('ready');
    expect(ready?.draft?.paragraphs[0]?.sentences.map((sentence) => sentence.evidence)).toEqual([[1], [2]]);
    expect(ready?.draft?.evidence.map(({ id, located, explanation }) => ({ id, located, explanation }))).toEqual([
      { id: 1, located: false, explanation: '운영 설정에서 다시 시도하는 횟수를 5로 정해 둡니다.' },
      { id: 2, located: false, explanation: '운영 설정에서 다시 시도하는 횟수를 5로 정해 둡니다.' },
      { id: 3, located: true, explanation: '참조 없는 근거' },
    ]);
    /** 남긴 실행 기록. */
    const [run] = ready?.runs ?? [];
    expect(run?.result).toBe('succeeded');
    expect(run?.fixes).toEqual([
      '없는 근거 번호를 지움: 9번(1문단 1번째 문장)',
      '어느 문장도 참조하지 않는 근거를 목록 끝에 둠: 원래 6번',
      '근거 번호를 나온 순서대로 다시 매김: 4→1, 1→2',
      '위치를 찾을 수 없는 근거: 1번(줄 범위가 파일 길이(100줄)를 넘음)',
      '위치를 찾을 수 없는 근거: 2번(넘기지 않은 저장소)',
    ]);
    expect((await stateStore.listBundles())[0]?.draft?.evidence.map((item) => item.located)).toEqual([false, false, true]);
  });

  it('근거가 비밀 파일이면 다시 실행하지 않고 결과 전체를 버려 "비밀 파일을 근거로 듦" 실패가 되며, 대기열은 멈추지 않고 다음 묶음을 실행한다', async () => {
    const { flow, executor, bundles, notifier, repos, poll } = await setup();
    /** 둘째 근거가 비밀 파일인 출력. */
    const output = draftOutput(repos.a);
    output.evidence.push({ ...output.evidence[0]!, id: 2, path: 'config/.env.production' });
    executor.script({ outcome: { type: 'completed', output } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addComment(POST_ID, { commentId: '701', contents: `${MY_MARKUP} 다른 질문`, registerId: SENDER, registeredDateTime: '20261020085600' });

    await poll(alarm('101'), alarm('102', { remarkId: '701', registeredDateTime: '20261020085600' }));

    /** 비밀 파일을 근거로 든 묶음과 다음 묶음. */
    const [first, second] = bundles.state();
    expect(first).toMatchObject({ status: 'failed', failure: { reason: 'secret-evidence', detail: null, lastStep: '초안 쓰는 중' }, draft: null });
    expect(first?.runs.map(({ result, fixes }) => ({ result, fixes }))).toEqual([
      { result: 'secret-evidence', fixes: ['비밀 파일 패턴에 맞는 근거: 2번(config/.env.production)'] },
    ]);
    expect(second?.status).toBe('ready');
    expect(executor.requests).toHaveLength(2);
    expect(notifier.sent.map((sent) => sent.bundleId)).toEqual([second?.id]);
  });

  it('사용자가 추가한 비밀 파일 패턴에 맞는 근거도 결과 전체를 버린다', async () => {
    const { executor, bundles, settingsStore, repos, poll } = await setup();
    settingsStore.settings.extraSecretPatterns = ['application-prod.yml'];
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });

    await poll(alarm('101'));

    expect(bundles.state()[0]).toMatchObject({ status: 'failed', failure: { reason: 'secret-evidence' }, draft: null });
  });

  it('10분 제한 시간을 넘기면 다시 실행하지 않고 마지막 단계와 함께 "시간 초과" 실패가 된다', async () => {
    const { executor, bundles, poll } = await setup();
    executor.script({
      progress: [{ step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 }],
      outcome: { type: 'timed-out' },
    });

    await poll(alarm('101'));

    expect(bundles.state()[0]).toMatchObject({
      status: 'failed',
      failure: { reason: 'timed-out', detail: null, lastStep: '파일 읽는 중: RetryConfig.kt' },
    });
    expect(executor.requests).toHaveLength(1);
  });

  it('에이전트가 오류로 끝나면 그 사유와 오류 원문으로 실패가 된다', async () => {
    const { executor, bundles, poll } = await setup();
    executor.script({ outcome: { type: 'failed', reason: 'agent-error', detail: 'Claude usage limit reached.' } });

    await poll(alarm('101'));

    expect(bundles.state()[0]).toMatchObject({
      status: 'failed',
      failure: { reason: 'agent-error', detail: 'Claude usage limit reached.', lastStep: '초안 쓰는 중' },
    });
  });

  it('맥락을 Flow에서 조회하지 못하면 실행하지 않고 실패가 된다. 원문이 지워졌으면 원문을 찾을 수 없다는 사유다', async () => {
    const { flow, executor, bundles, poll } = await setup();
    // 감지가 판정에 쓰는 조회는 통과하고, 그 뒤 초안 실행 직전의 댓글 조회만 실패한다.
    flow.whenRequested(`GET /user/posts/${POST_ID}`, () => flow.failOn(`GET /user/comments/${POST_ID}`, { kind: 'http', status: 404 }, 1));

    await poll(alarm('101'));

    expect(bundles.state()[0]).toMatchObject({ status: 'failed', failure: { reason: 'source-gone', lastStep: 'Flow에서 맥락 가져오는 중' } });
    expect(executor.requests).toEqual([]);
  });
});

describe('초안 실행: 진행 단계와 취소', () => {
  it('실행 중에는 도구 이벤트로 바뀐 마지막 진행 단계 한 줄과 읽은 파일 수를, 기다리는 묶음은 대기 중을 알린다', async () => {
    const { flow, executor, drafts, bundles, poll } = await setup();
    executor.script({
      progress: [
        { step: '검색 중: retry', filesRead: 0 },
        { step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 },
      ],
      outcome: 'wait-for-abort',
    });
    flow.addComment(POST_ID, { commentId: '701', contents: `${MY_MARKUP} 다른 질문`, registerId: SENDER, registeredDateTime: '20261020085600' });
    /** 진행이 바뀔 때마다 받은 알림 수. */
    let changes = 0;
    drafts.onChange(() => (changes += 1));

    await poll(alarm('101'), alarm('102', { remarkId: '701', registeredDateTime: '20261020085600' }));

    /** 먼저 온 묶음과 나중에 온 묶음. */
    const [first, second] = bundles.state();
    expect([first?.status, second?.status]).toEqual(['generating', 'generating']);
    expect(drafts.progress(first!.id)).toEqual({ status: 'running', step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 });
    expect(drafts.progress(second!.id)).toEqual({ status: 'waiting' });
    expect(changes).toBeGreaterThan(0);
    // 한 번에 하나만 실행한다.
    expect(executor.requests).toHaveLength(1);
  });

  it('실행 중인 묶음을 취소하면 실행을 끊고 마지막 단계와 함께 "취소함" 실패가 되며, 다음 묶음을 실행한다', async () => {
    const { flow, executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ progress: [{ step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 }], outcome: 'wait-for-abort' });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addComment(POST_ID, { commentId: '701', contents: `${MY_MARKUP} 다른 질문`, registerId: SENDER, registeredDateTime: '20261020085600' });
    await poll(alarm('101'), alarm('102', { remarkId: '701', registeredDateTime: '20261020085600' }));
    /** 먼저 온 묶음과 나중에 온 묶음. */
    const [first, second] = bundles.state();

    await drafts.cancel(first!.id);
    await settle();

    expect(executor.requests[0]?.signal.aborted).toBe(true);
    expect(bundles.get(first!.id)).toMatchObject({
      status: 'failed',
      failure: { reason: 'cancelled', detail: null, lastStep: '파일 읽는 중: RetryConfig.kt' },
    });
    expect(bundles.get(first!.id)?.runs.map((run) => run.result)).toEqual(['cancelled']);
    expect(drafts.progress(first!.id)).toBeNull();
    expect(bundles.get(second!.id)?.status).toBe('ready');
    expect(executor.requests).toHaveLength(2);
  });

  it('기다리는 묶음을 취소하면 실행하지 않고 바로 "취소함" 실패가 된다', async () => {
    const { flow, executor, drafts, bundles, poll } = await setup();
    executor.script({ outcome: 'wait-for-abort' });
    flow.addComment(POST_ID, { commentId: '701', contents: `${MY_MARKUP} 다른 질문`, registerId: SENDER, registeredDateTime: '20261020085600' });
    await poll(alarm('101'), alarm('102', { remarkId: '701', registeredDateTime: '20261020085600' }));
    /** 기다리는 묶음. */
    const second = bundles.state()[1]!;

    await drafts.cancel(second.id);
    await settle();

    expect(bundles.get(second.id)).toMatchObject({ status: 'failed', failure: { reason: 'cancelled', lastStep: null }, runs: [] });
    expect(drafts.progress(second.id)).toBeNull();
    expect(executor.requests).toHaveLength(1);
  });

  it('에이전트 연결이 없으면 실행하지 않고 기다리다가, 연결되면 실행한다', async () => {
    const { executor, drafts, bundles, repos, poll, setConnected } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    setConnected(false);

    await poll(alarm('101'));

    /** 기다리는 묶음. */
    const [waiting] = bundles.state();
    expect(waiting?.status).toBe('generating');
    expect(drafts.progress(waiting!.id)).toEqual({ status: 'waiting' });
    expect(executor.requests).toEqual([]);

    setConnected(true);
    await settle();

    expect(bundles.get(waiting!.id)?.status).toBe('ready');
  });
});

describe('초안 실행: 생성 중 묶음의 변화', () => {
  it('생성 중 묶음에 새 멘션이 오면 실행을 끊고, 새 멘션을 합쳐 처음부터 다시 만든다. 합친 멘션은 "새 멘션"으로 세지 않는다', async () => {
    const { flow, executor, bundles, repos, poll } = await setup();
    executor.script({ progress: [{ step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 }], outcome: 'wait-for-abort' });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));

    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registeredDateTime: '20261020085500' });
    await poll(alarm('102', { replyId: '801', registeredDateTime: '20261020085500' }));

    /** 다시 만든 묶음. */
    const [bundle] = bundles.state();
    expect(executor.requests[0]?.signal.aborted).toBe(true);
    expect(executor.requests).toHaveLength(2);
    expect(executor.requests[1]?.input).toContain('## 멘션 2건 (시간순, 마지막이 답할 대상)');
    expect(bundle).toMatchObject({ status: 'ready', newMentionCount: 0 });
    expect(bundle?.runs.map((run) => [run.result, run.lastStep])).toEqual([
      ['bundle-changed', '파일 읽는 중: RetryConfig.kt'],
      ['succeeded', '초안 쓰는 중'],
    ]);
  });

  it('실행이 끝나 초안을 저장하기 직전에 새 멘션이 합쳐져도, 새 멘션이 빠진 초안을 저장하지 않고 처음부터 다시 만든다', async () => {
    const { flow, executor, bundles, stateStore, repos, poll, clock } = await setup();
    /** 끝나지 않고 기다리는 첫 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.b) } });
    await poll(alarm('101'));

    // 새 멘션을 합치는 저장을 붙잡아 둔 사이에 첫 실행이 끝나, 초안 저장이 합치기 뒤에 줄을 선다.
    stateStore.holdNextDetection();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registeredDateTime: '20261020085500' });
    flow.addAlarm(alarm('102', { replyId: '801', registeredDateTime: '20261020085500' }));
    clock.advance(POLL_MS);
    await settle();
    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();
    stateStore.releaseDetection();
    await settle();

    /** 다시 만든 묶음. */
    const [bundle] = bundles.state();
    expect(executor.requests).toHaveLength(2);
    expect(executor.requests[1]?.input).toContain('## 멘션 2건 (시간순, 마지막이 답할 대상)');
    expect(bundle).toMatchObject({ status: 'ready', draft: { evidence: [{ repository: repos.b }] } });
    expect(bundle?.runs.map((record) => record.result)).toEqual(['bundle-changed', 'succeeded']);
  });

  it('생성 직전에 Flow에 이미 내 답이 있으면 실행하지 않고 "이미 답함"이 된다', async () => {
    const { flow, executor, bundles, notifier, poll, setConnected } = await setup();
    setConnected(false);
    await poll(alarm('101'));
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085900' });

    setConnected(true);
    await settle();

    expect(bundles.state()[0]).toMatchObject({ status: 'already-answered', draft: null, runs: [] });
    expect(executor.requests).toEqual([]);
    expect(notifier.sent).toEqual([]);
  });

  it('생성 직전에 앞선 멘션에만 내 답이 있으면 그 멘션을 빼고 남은 멘션으로 실행한다', async () => {
    const { flow, executor, bundles, repos, poll, setConnected } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    setConnected(false);
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registeredDateTime: '20261020085700' });
    await poll(alarm('101'), alarm('102', { replyId: '801', registeredDateTime: '20261020085700' }));
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '첫 질문에 답했습니다', registerId: ME, registeredDateTime: '20261020085600' });

    setConnected(true);
    await settle();

    /** 준비된 묶음. */
    const [ready] = bundles.state();
    expect(ready?.status).toBe('ready');
    expect(ready?.mentions.map((mention) => [mention.alarmId, mention.answered])).toEqual([
      ['101', true],
      ['102', false],
    ]);
    expect(executor.requests[0]?.input).toContain('## 멘션 1건 (시간순, 마지막이 답할 대상)');
    expect(executor.requests[0]?.input).toContain('1. [답할 대상] 보낸 사람');
  });
});

describe('초안 실행: 저장소 매핑', () => {
  it('저장소 매핑의 폴더가 하나라도 없으면 실행하지 않고 "연결된 저장소 폴더를 찾을 수 없음" 사유로 저장소 확인 필요가 되며 OS 알림을 띄운다', async () => {
    const { executor, bundles, notifier, repos, settingsStore, poll } = await setup();
    rmSync(repos.b, { recursive: true });
    // 설정을 다시 읽지 않아도, 폴더는 멘션을 감지할 때마다 새로 확인한다.
    expect(settingsStore.settings.repoMappings[PROJECT_ID]).toEqual([repos.a, repos.b]);

    await poll(alarm('101'));

    /** 저장소 확인 필요 묶음. */
    const [bundle] = bundles.state();
    expect(bundle).toMatchObject({ status: 'repo-check-needed', repoCheck: { kind: 'missing-folders', paths: [repos.b] }, draft: null });
    expect(bundles.reviewCount()).toBe(1);
    expect(notifier.sent).toEqual([{ title: '저장소 확인 필요', body: '보낸 사람님이 나를 멘션했습니다.', bundleId: bundle?.id }]);
    expect(executor.requests).toEqual([]);
  });

  it('기다리는 사이에 매핑된 폴더가 사라지면 실행 직전에 알아채고 저장소 확인 필요가 된다', async () => {
    const { executor, bundles, notifier, repos, poll, setConnected } = await setup();
    setConnected(false);
    await poll(alarm('101'));
    expect(bundles.state()[0]?.status).toBe('generating');
    rmSync(repos.a, { recursive: true });

    setConnected(true);
    await settle();

    expect(bundles.state()[0]).toMatchObject({ status: 'repo-check-needed', repoCheck: { kind: 'missing-folders', paths: [repos.a] } });
    expect(notifier.sent.map((notification) => notification.title)).toEqual(['저장소 확인 필요']);
    expect(executor.requests).toEqual([]);
  });

  it('저장소 매핑이 없는 Flow 프로젝트의 묶음은 초안 실행 없이 사유 없는 저장소 확인 필요로 남는다', async () => {
    const { executor, bundles, poll } = await setup();

    await poll(alarm('101', { projectId: '900002' }));

    expect(bundles.state()[0]).toMatchObject({ status: 'repo-check-needed', repoCheck: null });
    expect(executor.requests).toEqual([]);
  });
});

describe('초안 실행: 실행 기록', () => {
  it('실행마다 에이전트·CLI 버전·모델·시작과 끝 시각·결과·마지막 단계·맥락에서 뺀 항목 수·비용과 토큰 수를 남기고, 상태 저장소에 둔다', async () => {
    const { clock, flow, executor, bundles, stateStore, repos, poll } = await setup();
    // 다른 댓글 하나가 맥락 길이 상한(30,000자)을 넘겨, 그 댓글을 빼야 상한 안에 든다.
    flow.addComment(POST_ID, { commentId: '650', contents: '가'.repeat(31_000), registerName: '동료', registeredDateTime: '20261020081000' });
    /** 끝나지 않고 기다리는 초안 실행. */
    const run = heldOutcome();
    executor.script({
      progress: [{ step: '파일 읽는 중: application-prod.yml', filesRead: 3 }],
      outcome: run.outcome,
      report: { cliVersion: '2.1.305', model: 'claude-fake-sonnet', usage: { costUsd: 0.0123, inputTokens: 5500, outputTokens: 456 } },
    });
    await poll(alarm('101'));

    clock.advance(134_000);
    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();

    /** 남긴 실행 기록. */
    const expected = [
      {
        kind: 'draft',
        agent: 'claude-code',
        cliVersion: '2.1.305',
        model: 'claude-fake-sonnet',
        startedAt: NOW,
        finishedAt: NOW + 134_000,
        result: 'succeeded',
        detail: null,
        lastStep: '파일 읽는 중: application-prod.yml',
        fixes: [],
        omittedContextItems: 1,
        usage: { costUsd: 0.0123, inputTokens: 5500, outputTokens: 456 },
      },
    ];
    expect(bundles.state()[0]?.runs).toEqual(expected);
    expect((await stateStore.listBundles())[0]?.runs).toEqual(expected);
  });

  it('에이전트가 모델과 사용량을 알려 주지 않으면 고른 모델을 남기고 비용과 토큰 수는 모른다', async () => {
    const { executor, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });

    await poll(alarm('101'));

    expect(bundles.state()[0]?.runs[0]).toMatchObject({ cliVersion: null, model: 'sonnet', usage: null });
  });
});

describe('초안 실행: 다시 시도와 되돌리기', () => {
  it('실패 묶음을 다시 시도하면 생성 중으로 돌아가 다시 실행하고, 실패 사유를 지운다. 실행 기록은 이어 쌓인다', async () => {
    const { executor, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'timed-out' } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 실패한 묶음. */
    const [failed] = bundles.state();
    expect(failed?.status).toBe('failed');

    await bundles.retry(failed!.id);
    await settle();

    expect(bundles.get(failed!.id)).toMatchObject({ status: 'ready', failure: null });
    expect(bundles.get(failed!.id)?.runs.map((run) => run.result)).toEqual(['timed-out', 'succeeded']);
  });

  it('준비됨에서 무시한 묶음을 되돌리면 초안 그대로 준비됨이 되고, 실패에서 무시한 묶음을 되돌리면 생성 중으로 새로 만든다', async () => {
    const { flow, executor, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'failed', reason: 'overloaded', detail: 'Overloaded' } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.b) } });
    flow.addComment(POST_ID, { commentId: '701', contents: `${MY_MARKUP} 다른 질문`, registerId: SENDER, registeredDateTime: '20261020085600' });
    await poll(alarm('101'), alarm('102', { remarkId: '701', registeredDateTime: '20261020085600' }));
    /** 준비된 묶음과 실패한 묶음. */
    const [ready, failed] = bundles.state();
    expect([ready?.status, failed?.status]).toEqual(['ready', 'failed']);
    await bundles.ignore(ready!.id);
    await bundles.ignore(failed!.id);

    await bundles.restore(ready!.id);
    await bundles.restore(failed!.id);
    await settle();

    expect(bundles.get(ready!.id)).toMatchObject({ status: 'ready', processedAt: null, draft: ready!.draft });
    expect(bundles.get(failed!.id)).toMatchObject({ status: 'ready', failure: null, draft: { repositories: [repos.a, repos.b] } });
    expect(executor.requests).toHaveLength(3);
  });
});

describe('초안 실행에 쓸 에이전트', () => {
  it('기본 에이전트의 실행기와 그 에이전트에 고른 모델을 쓰고, 기본 모델이면 모델을 넘기지 않는다. 연결된 에이전트가 없거나 실행기가 없으면 기다린다', () => {
    const claude = new FakeExecutor('claude-code');
    /** 모델 선택 상자. */
    const models = { 'claude-code': { options: [{ id: 'sonnet', label: 'Sonnet', unlisted: false }], selected: 'sonnet' } };

    expect(draftAgentFrom({ connectedAgents: ['claude-code'], defaultAgent: 'claude-code', models }, [claude])).toEqual({ executor: claude, model: 'sonnet' });
    expect(
      draftAgentFrom({ connectedAgents: ['claude-code'], defaultAgent: 'claude-code', models: { 'claude-code': { options: [], selected: null } } }, [claude]),
    ).toEqual({ executor: claude, model: null });
    expect(draftAgentFrom({ connectedAgents: [], defaultAgent: null, models: {} }, [claude])).toBeNull();
    expect(draftAgentFrom({ connectedAgents: ['codex'], defaultAgent: 'codex', models: {} }, [claude])).toBeNull();
  });
});
