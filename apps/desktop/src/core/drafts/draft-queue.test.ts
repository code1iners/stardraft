import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConnection } from '../agent/agent-connection';
import { AgentPreferences } from '../agent/agent-preferences';
import { CHECK_RUN_INPUT } from '../agent/check-run';
import { MentionBundles } from '../bundles/mention-bundles';
import { MentionDetection } from '../detection/mention-detection';
import { claudeNotLoggedInStream, claudeSuccessStream, fakeClaudeAuthStatus } from '../fakes/fake-claude-stream';
import { FakeClock } from '../fakes/fake-clock';
import { FakeExecutor } from '../fakes/fake-executor';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import { exited, FakeProcessRunner } from '../fakes/fake-process-runner';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { collectBundleContext } from '../flow/bundle-context';
import { MentionJudge } from '../flow/mention-judgement';
import { createLogger } from '../logging/logger';
import type { ExecutorOutcome, ExecutorRunRequest } from '../ports/executor';
import type { FlowAlarm } from '../ports/flow-api';
import { GlobalProblems } from '../problems/global-problems';
import { RepoMappings } from '../repos/repo-mappings';
import { DRAFT_INSTRUCTIONS } from './draft-input';
import { draftAgentFrom, DraftQueue, type DraftQueueOptions } from './draft-queue';

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

/** 가짜 게시물에 나를 멘션한 댓글 스레드를 하나 더하고 그 멘션의 알림을 돌려준다. 댓글 스레드마다 다른 멘션 묶음이 된다. */
function addThreadMention(flow: FakeFlowApi, alarmId: string, commentId: string, text: string, registeredDateTime: string): FlowAlarm {
  flow.addComment(POST_ID, { commentId, contents: `${MY_MARKUP} ${text}`, registerId: SENDER, registeredDateTime });
  return alarm(alarmId, { remarkId: commentId, registeredDateTime });
}

/** 실행 요청이 답할 멘션의 글. 입력 문서의 멘션 목록에서 "[답할 대상]"을 붙인 줄 바로 아래 줄이다. */
function targetMentionOf(request: ExecutorRunRequest | undefined): string | undefined {
  return /^\d+\. \[답할 대상\][^\n]*\n\s*(.*)$/m.exec(request?.input ?? '')?.[1];
}

/** 풀어 줄 때까지 끝나지 않는 실행 결과. */
function heldOutcome(): { outcome: Promise<ExecutorOutcome>; release: (outcome: ExecutorOutcome) => void } {
  /** 결과를 풀어 줄 함수. */
  let release: (outcome: ExecutorOutcome) => void = () => {};
  /** 풀릴 결과. */
  const outcome = new Promise<ExecutorOutcome>((resolve) => (release = resolve));
  return { outcome, release };
}

/** 감지한 묶음이나 묶음 하나를 저장하는 일을 붙잡아 둘 수 있는 상태 저장소. 저장이 끝나기 전에 다른 일이 끼어드는 경우를 만든다. */
class GatedStateStore extends MemoryStateStore {
  /** 붙잡은 감지 저장을 놓아 줄 함수. 붙잡지 않으면 `null`. */
  private open: (() => void) | null = null;
  /** 다음 감지 저장을 붙잡을지 여부. */
  private armed = false;
  /** 붙잡은 묶음 저장을 놓아 줄 함수. 붙잡지 않으면 `null`. */
  private openSave: (() => void) | null = null;
  /** 다음 묶음 저장을 붙잡을지 여부. */
  private armedSave = false;

  /** 다음 감지 저장을 놓아 줄 때까지 붙잡는다. */
  holdNextDetection(): void {
    this.armed = true;
  }

  /** 붙잡은 감지 저장을 놓아 준다. */
  releaseDetection(): void {
    this.open?.();
    this.open = null;
  }

  /** 다음 묶음 저장(실행 기록 더하기, 실패로 두기 등)을 놓아 줄 때까지 붙잡는다. */
  holdNextSave(): void {
    this.armedSave = true;
  }

  /** 붙잡은 묶음 저장을 놓아 준다. */
  releaseSave(): void {
    this.openSave?.();
    this.openSave = null;
  }

  override async saveDetectedBundles(...args: Parameters<MemoryStateStore['saveDetectedBundles']>) {
    if (this.armed) {
      this.armed = false;
      await new Promise<void>((resolve) => (this.open = resolve));
    }
    return super.saveDetectedBundles(...args);
  }

  override async saveBundle(...args: Parameters<MemoryStateStore['saveBundle']>) {
    if (this.armedSave) {
      this.armedSave = false;
      await new Promise<void>((resolve) => (this.openSave = resolve));
    }
    return super.saveBundle(...args);
  }
}

/**
 * 가짜 포트로 멘션 감지, 멘션 묶음, 초안 대기열을 만든다. 기준점은 `'100'`, 계정은 가짜 키 소유자다.
 * `queueAgent`를 주면 대기열이 그 에이전트를 쓰고, 주지 않으면 테스트가 바꿀 수 있는 가짜 에이전트 연결(`agent`)을 쓴다.
 */
async function setup(queueAgent?: Pick<DraftQueueOptions, 'agent' | 'onAgentChange'>) {
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
  /** 전역 문제. 앱처럼 맥락을 조회할 때 Flow가 키를 거부하면 "키 확인 필요"가 생긴다. */
  const problems = new GlobalProblems({
    notifier: new RecordingNotifier(),
    clock,
    logger,
    notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }),
  });
  const bundles = new MentionBundles({
    stateStore,
    notifier,
    clock,
    logger,
    findMyAnswers: (place) => new MentionJudge(flow, ME).myAnswers(place, [ME]),
    collectContext: async (bundle) => {
      /** 조회한 결과. */
      const result = await collectBundleContext(flow, bundle, clock.now(), [ME]);
      if (!result.ok && result.failure.kind === 'unauthorized') problems.raise({ cause: 'flow-key', reason: 'rejected' });
      return result;
    },
    resolveRepos: (projectId) => repoMappings.resolve(projectId),
  });
  await bundles.load();
  const executor = new FakeExecutor('claude-code');
  /**
   * 가짜 에이전트 연결. 연결되어 있는지, 기본 에이전트의 실행기와 고른 모델, 바뀔 때 부를 함수, 실행 직전 확인을 든다.
   * 실행 직전 확인은 기본으로 연결되어 있는지를 돌려준다. 테스트가 바꿔 CLI 버전이 바뀌어 돌린 작동 확인 같은 것을 흉내 낸다.
   */
  const agent = {
    connected: true,
    executor,
    model: 'sonnet' as string | null,
    listeners: new Set<() => void>(),
    confirmForRun: async (): Promise<boolean> => agent.connected,
  };
  /** 초안 대기열을 만든다. 앱을 다시 켤 때처럼 같은 묶음과 포트로 새로 만들 수 있다. */
  const createQueue = () =>
    new DraftQueue({
      bundles,
      ...(queueAgent ?? {
        agent: () => (agent.connected ? { executor: agent.executor, model: agent.model, confirmForRun: () => agent.confirmForRun() } : null),
        onAgentChange: (listener: () => void) => {
          agent.listeners.add(listener);
          return () => agent.listeners.delete(listener);
        },
      }),
      flowKeyUsable: () => !problems.has('flow-key'),
      onFlowKeyChange: (listener) => problems.onChange(listener),
      settingsStore,
      myName: () => FAKE_ME.name,
      projectTitle: (projectId) => repoMappings.projectTitle(projectId),
      clock,
      logger,
    });
  const drafts = createQueue();
  drafts.start();
  /** 앱을 끄고 다시 켠 것처럼 대기열을 멈추고 새 대기열을 시작한다. 새 대기열을 돌려준다. */
  const restartApp = () => {
    drafts.stop();
    /** 다시 켠 앱의 대기열. */
    const restarted = createQueue();
    restarted.start();
    return restarted;
  };
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
  return { clock, flow, stateStore, settingsStore, notifier, problems, bundles, executor, agent, drafts, repos, poll, setConnected, restartApp, createQueue };
}

/** 가짜 CLI 경로. 실제 파일은 없고, 연결 확인이 실행할 수 있는 파일로 본다. */
const FAKE_CLI = '/fake/bin/claude';

/**
 * 가짜 프로세스 실행기 위에 실제 에이전트 연결 확인과 기본 에이전트·모델 선택을 만든다. 감지를 시작한 뒤라 연결이 끊기면 전역 문제로 알린다.
 * 가짜 CLI는 처음에 2.1.303으로 로그인되어 있고 작동 확인과 초안 실행이 성공한다. 테스트가 `cli`를 바꿔 CLI의 대답을 바꾼다.
 * 초안 실행은 cwd(첫 저장소)를 근거의 저장소로 드는 초안을 낸다.
 */
async function realAgent(tempRoot: string) {
  /** 가짜 CLI의 상태. */
  const cli = { version: '2.1.303', loggedIn: true, checkRunWorks: true };
  const runner = new FakeProcessRunner();
  runner.respond(FAKE_CLI, ['--version'], () => exited(0, `${cli.version} (Claude Code)\n`));
  /** 지금 로그인 상태의 `claude auth status` 대답. 로그인되어 있지 않으면 종료 코드 1이다. */
  const authStatus = () => (cli.loggedIn ? exited(0, fakeClaudeAuthStatus.loggedIn) : exited(1, fakeClaudeAuthStatus.notLoggedIn));
  runner.respond(FAKE_CLI, ['--restricted', 'auth', 'status'], authStatus);
  runner.respond(FAKE_CLI, ['auth', 'status'], authStatus);
  runner.respondWhen(
    (request) => request.command === FAKE_CLI && request.args[0] === '-p',
    (request) => {
      if (!cli.loggedIn) return exited(1, claudeNotLoggedInStream());
      if (request.stdin !== CHECK_RUN_INPUT) return exited(0, claudeSuccessStream(draftOutput(request.cwd), cli.version));
      return cli.checkRunWorks ? exited(0, claudeSuccessStream({ ok: true }, cli.version)) : exited(1, '', 'error: something broke');
    },
  );
  const clock = new FakeClock(NOW);
  const logger = createLogger([{ write: () => {} }], clock);
  const notifier = new RecordingNotifier();
  const problems = new GlobalProblems({ notifier, clock, logger, notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }) });
  const settingsStore = new MemorySettingsStore({ detectionStarted: true, agentCliPaths: { 'claude-code': FAKE_CLI } });
  const connection = new AgentConnection({
    platform: 'darwin',
    env: { PATH: '/usr/bin:/bin', HOME: tempRoot },
    homeDir: tempRoot,
    loginShell: '/bin/fake-login-shell',
    runner,
    settingsStore,
    logger,
    problems,
    checkDir: join(tempRoot, 'agent-check'),
    tempRoot,
    isExecutableFile: async (filePath) => filePath === FAKE_CLI,
  });
  const preferences = new AgentPreferences({
    settingsStore,
    logger,
    connectedAgents: () => (connection.isConnected() ? [connection.state().agent] : []),
  });
  await preferences.load();
  /** 앱처럼 기본 에이전트의 연결로 실행하고, 연결이 바뀌면 대기열에 알리는 에이전트. */
  const queueAgent: Pick<DraftQueueOptions, 'agent' | 'onAgentChange'> = {
    agent: () => draftAgentFrom(preferences.state(), [connection]),
    onAgentChange: (listener) => connection.onChange(listener),
  };
  /** 연결 확인이 로그인을 확인한 횟수. */
  const loginChecks = () => runner.requests.filter((request) => request.args.join(' ') === '--restricted auth status').length;
  /** 초안 실행 요청 수. 작동 확인은 세지 않는다. */
  const draftRuns = () => runner.requests.filter((request) => request.args[0] === '-p' && request.stdin !== CHECK_RUN_INPUT).length;
  return { cli, connection, problems, notifier, queueAgent, loginChecks, draftRuns };
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

  it('대기열을 시작하기 전(저장된 키를 읽기 전)에도 생성 중 묶음을 취소할 수 있다', async () => {
    const { bundles, poll, setConnected, createQueue } = await setup();
    setConnected(false);
    await poll(alarm('101'));
    /** 생성 중 묶음. */
    const [bundle] = bundles.state();
    /** 아직 시작하지 않은 대기열. */
    const notStarted = createQueue();

    await notStarted.cancel(bundle!.id);

    expect(bundles.get(bundle!.id)).toMatchObject({ status: 'failed', failure: { reason: 'cancelled', lastStep: null } });
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
    executor.script({ outcome: { type: 'failed', reason: 'agent-error', detail: 'Claude usage limit reached.' } });
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

describe('대기열: 순서와 우선순위', () => {
  it('사용자가 누른 다시 시도는 감지해서 기다리는 묶음보다 앞에 들어가, 실행 중인 실행이 끝나면 바로 돈다', async () => {
    const { flow, executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'failed', reason: 'agent-error', detail: 'Claude usage limit reached.' } });
    await poll(alarm('101'));
    /** 실패한 묶음. */
    const [failed] = bundles.state();
    expect(failed?.status).toBe('failed');
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(
      addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'),
      addThreadMention(flow, '103', '702', '세 번째 질문', '20261020085700'),
    );

    await drafts.retry(failed!.id);
    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();

    expect(executor.requests.map(targetMentionOf)).toEqual([
      '@테스트 사용자 재시도는 몇 번 하나요?',
      '@테스트 사용자 두 번째 질문',
      '@테스트 사용자 재시도는 몇 번 하나요?',
      '@테스트 사용자 세 번째 질문',
    ]);
    expect(bundles.state().map((bundle) => bundle.status)).toEqual(['ready', 'ready', 'ready']);
  });

  it('사용자 행동끼리는 누른 순서대로 돌고, 실행 중에 새 멘션이 합쳐져 처음부터 다시 만드는 묶음은 그보다도 앞에서 바로 다시 돈다', async () => {
    const { flow, executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'failed', reason: 'agent-error', detail: '첫 실패' } });
    executor.script({ outcome: { type: 'failed', reason: 'agent-error', detail: '둘째 실패' } });
    executor.script({ outcome: 'wait-for-abort' });
    for (let run = 0; run < 4; run += 1) executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'), addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085100'));
    /** 실패한 두 묶음. */
    const [first, second] = bundles.state();
    expect([first?.status, second?.status]).toEqual(['failed', 'failed']);
    await poll(addThreadMention(flow, '103', '702', '세 번째 질문', '20261020085600'), addThreadMention(flow, '104', '703', '네 번째 질문', '20261020085700'));

    await drafts.retry(first!.id);
    await drafts.retry(second!.id);
    flow.addReply(POST_ID, '702', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registeredDateTime: '20261020085800' });
    await poll(alarm('105', { remarkId: '702', replyId: '801', registeredDateTime: '20261020085800' }));

    expect(executor.requests.map(targetMentionOf)).toEqual([
      '@테스트 사용자 재시도는 몇 번 하나요?',
      '@테스트 사용자 두 번째 질문',
      '@테스트 사용자 세 번째 질문',
      '@테스트 사용자 하나 더',
      '@테스트 사용자 재시도는 몇 번 하나요?',
      '@테스트 사용자 두 번째 질문',
      '@테스트 사용자 네 번째 질문',
    ]);
    expect(bundles.state().map((bundle) => bundle.status)).toEqual(['ready', 'ready', 'ready', 'ready']);
  });

  it('실패해서 무시한 묶음을 되돌려 새로 만들게 되면, 사용자 행동이라 감지해서 기다리는 묶음보다 앞에 든다', async () => {
    const { flow, executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'failed', reason: 'agent-error', detail: 'Claude usage limit reached.' } });
    await poll(alarm('101'));
    /** 실패해서 무시한 묶음. */
    const [ignored] = bundles.state();
    await bundles.ignore(ignored!.id);
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(
      addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'),
      addThreadMention(flow, '103', '702', '세 번째 질문', '20261020085700'),
    );

    await drafts.restore(ignored!.id);
    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();

    expect(bundles.get(ignored!.id)?.status).toBe('ready');
    expect(executor.requests.map(targetMentionOf)).toEqual([
      '@테스트 사용자 재시도는 몇 번 하나요?',
      '@테스트 사용자 두 번째 질문',
      '@테스트 사용자 재시도는 몇 번 하나요?',
      '@테스트 사용자 세 번째 질문',
    ]);
  });
});

describe('대기열: 자동 재시도', () => {
  it.each([
    ['모델 과부하', { type: 'failed', reason: 'overloaded', detail: 'API Error: 529 Overloaded' }],
    ['네트워크 오류', { type: 'failed', reason: 'network', detail: 'API Error: Connection refused' }],
  ] as const)('일시적 실패(%s)면 한 번 더 실행하고, 두 번째에 초안을 받으면 준비됨이 된다', async (_label, outcome) => {
    const { executor, bundles, repos, poll } = await setup();
    executor.script({ outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });

    await poll(alarm('101'));

    expect(bundles.state()[0]).toMatchObject({ status: 'ready', failure: null });
    expect(bundles.state()[0]?.runs.map((run) => run.result)).toEqual([outcome.reason, 'succeeded']);
    expect(executor.requests).toHaveLength(2);
  });

  it('일시적 실패는 종류가 달라도 생성 한 번에 한 번만 다시 실행하고, 두 번째도 일시적 실패면 그 사유로 실패가 된다', async () => {
    const { executor, bundles, poll } = await setup();
    executor.script({ outcome: { type: 'failed', reason: 'overloaded', detail: 'API Error: 529 Overloaded' } });
    executor.script({ outcome: { type: 'invalid-output', detail: '결과에 구조화 출력이 없습니다.' } });

    await poll(alarm('101'));

    expect(bundles.state()[0]).toMatchObject({ status: 'failed', failure: { reason: 'invalid-output', detail: '결과에 구조화 출력이 없습니다.' } });
    expect(bundles.state()[0]?.runs.map((run) => run.result)).toEqual(['overloaded', 'invalid-output']);
    expect(executor.requests).toHaveLength(2);
  });

  it.each([
    ['턴 수 상한', { type: 'failed', reason: 'max-turns', detail: '턴 수 상한에 닿았습니다.' }],
    ['사용량 한도 같은 에이전트 오류', { type: 'failed', reason: 'agent-error', detail: 'Claude usage limit reached.' }],
  ] as const)('일시적 실패가 아닌 실패(%s)는 다시 실행하지 않는다', async (_label, outcome) => {
    const { executor, bundles, poll } = await setup();
    executor.script({ outcome });

    await poll(alarm('101'));

    expect(bundles.state()[0]).toMatchObject({ status: 'failed', failure: { reason: outcome.reason } });
    expect(executor.requests).toHaveLength(1);
  });

  it('앱 종료로 끊긴 실행은 자동 재시도 1회에 세지 않는다. 다시 켠 뒤 일시적 실패가 나면 한 번 더 실행한다', async () => {
    const { executor, bundles, repos, poll, restartApp } = await setup();
    executor.script({ progress: [{ step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 }], outcome: 'wait-for-abort' });
    executor.script({ outcome: { type: 'failed', reason: 'network', detail: 'API Error: Connection refused' } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));

    restartApp();
    await settle();

    expect(executor.requests[0]?.signal.aborted).toBe(true);
    expect(executor.requests).toHaveLength(3);
    expect(bundles.state()[0]?.status).toBe('ready');
  });
});

describe('대기열: 에이전트 전역 실패', () => {
  it.each([
    ['미로그인', 'not-logged-in', 'Not logged in · Please run /login'],
    ['CLI 없음', 'cli-missing', 'spawn /fake/bin/claude ENOENT'],
    ['결과 메시지 없음', 'cli-error', "error: unknown option '--permission-prompts'"],
  ] as const)(
    '실행이 %s으로 끝나고 다시 한 연결 확인도 실패하면, 묶음을 실패로 두지 않고 대기열을 멈춘다. 연결되면 그 묶음부터 처음부터 다시 돈다',
    async (_label, reason, detail) => {
      const { flow, executor, drafts, bundles, repos, poll, setConnected } = await setup();
      /** 끝나지 않고 기다리는 실행. */
      const run = heldOutcome();
      executor.script({ outcome: run.outcome });
      executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
      executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
      await poll(alarm('101'), addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'));
      /** 실행하던 묶음과 기다리던 묶음. */
      const [first, second] = bundles.state();

      // 실행하는 사이에 CLI가 지워지거나 로그아웃되어, 실행이 끝난 뒤 다시 한 연결 확인도 실패한다.
      setConnected(false);
      run.release({ type: 'failed', reason, detail });
      await settle();

      expect(bundles.get(first!.id)).toMatchObject({ status: 'generating', failure: null });
      expect(bundles.get(first!.id)?.runs.map((record) => record.result)).toEqual([reason]);
      expect([drafts.progress(first!.id), drafts.progress(second!.id)]).toEqual([{ status: 'waiting' }, { status: 'waiting' }]);
      expect(executor.requests).toHaveLength(1);

      setConnected(true);
      await settle();

      expect(executor.requests.map(targetMentionOf)).toEqual([
        '@테스트 사용자 재시도는 몇 번 하나요?',
        '@테스트 사용자 재시도는 몇 번 하나요?',
        '@테스트 사용자 두 번째 질문',
      ]);
      expect(bundles.state().map((bundle) => bundle.status)).toEqual(['ready', 'ready']);
      expect(bundles.get(first!.id)?.runs.map((record) => record.result)).toEqual([reason, 'succeeded']);
    },
  );

  it('실행이 전역 실패를 의심하게 끝나면 다시 한 연결 확인을 기다리고, 확인이 통과하면(실행하는 사이 CLI가 새 버전으로 바뀐 경우 등) 일시적 실패처럼 한 번 더 실행한다', async () => {
    const { executor, agent, bundles, repos, poll } = await setup();
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 실행하던 묶음. */
    const [bundle] = bundles.state();
    /** 다시 하는 연결 확인을 끝내는 함수. */
    let finishRecheck: (connected: boolean) => void = () => {};
    agent.confirmForRun = () => new Promise((resolve) => (finishRecheck = resolve));

    run.release({ type: 'failed', reason: 'cli-missing', detail: 'spawn /fake/bin/claude ENOENT' });
    await settle();

    expect(bundles.get(bundle!.id)).toMatchObject({ status: 'generating', failure: null });
    expect(executor.requests).toHaveLength(1);

    agent.confirmForRun = async () => agent.connected;
    finishRecheck(true);
    await settle();

    expect(bundles.get(bundle!.id)?.status).toBe('ready');
    expect(bundles.get(bundle!.id)?.runs.map((record) => record.result)).toEqual(['cli-missing', 'succeeded']);
    expect(executor.requests).toHaveLength(2);
  });

  it('전역 실패로 묶음을 대기열 맨 앞에 되돌리는 사이에 [취소]를 누르면, 다시 넣지 않고 "취소함" 실패로 둔다', async () => {
    const { executor, stateStore, drafts, bundles, poll, setConnected } = await setup();
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    await poll(alarm('101'));
    /** 실행하던 묶음. */
    const [bundle] = bundles.state();

    // 실행 기록을 남기는 저장을 붙잡아, 그사이에 [취소]를 누른다.
    stateStore.holdNextSave();
    setConnected(false);
    run.release({ type: 'failed', reason: 'not-logged-in', detail: 'Not logged in · Please run /login' });
    await settle();
    await drafts.cancel(bundle!.id);
    stateStore.releaseSave();
    await settle();

    expect(bundles.get(bundle!.id)).toMatchObject({ status: 'failed', failure: { reason: 'cancelled' } });
    expect(bundles.get(bundle!.id)?.runs.map((record) => record.result)).toEqual(['not-logged-in']);

    setConnected(true);
    await settle();

    expect(executor.requests).toHaveLength(1);
  });

  it('다시 한 연결 확인이 통과했는데 한 번 더 실행해도 같은 실패면, 그 묶음만 실패로 두고 다음 묶음을 실행한다', async () => {
    const { flow, executor, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'failed', reason: 'cli-error', detail: 'Segmentation fault' } });
    executor.script({ outcome: { type: 'failed', reason: 'cli-error', detail: 'Segmentation fault' } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });

    await poll(alarm('101'), addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'));

    /** 실패한 묶음과 다음 묶음. */
    const [first, second] = bundles.state();
    expect(first).toMatchObject({ status: 'failed', failure: { reason: 'cli-error', detail: 'Segmentation fault' } });
    expect(first?.runs.map((record) => record.result)).toEqual(['cli-error', 'cli-error']);
    expect(second?.status).toBe('ready');
    expect(executor.requests).toHaveLength(3);
  });

  it('실행 직전 확인이 실패하면(CLI 버전이 바뀌어 돌린 작동 확인이 실패하는 등) 실행하지 않고 대기열을 멈추며, 에이전트 연결이 바뀌었다는 알림이 오기 전에는 다시 확인하지 않는다', async () => {
    const { executor, agent, drafts, bundles, repos, poll, setConnected } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    // 처음 확인만 실패하고 그 뒤로는 통과한다. 알림 없이 다시 확인하는 대기열이면 곧바로 실행해 버린다.
    /** 실패를 이미 한 번 돌려줬는지 여부. */
    let failedOnce = false;
    agent.confirmForRun = async () => {
      if (failedOnce) return true;
      failedOnce = true;
      return false;
    };

    await poll(alarm('101'));

    /** 기다리는 묶음. */
    const [bundle] = bundles.state();
    expect(bundle).toMatchObject({ status: 'generating', failure: null, runs: [] });
    expect(drafts.progress(bundle!.id)).toEqual({ status: 'waiting' });
    expect(executor.requests).toEqual([]);

    setConnected(true);
    await settle();

    expect(bundles.get(bundle!.id)?.status).toBe('ready');
  });
});

describe('대기열: 설정 변경의 반영', () => {
  it('실행 중에 기본 에이전트·모델·추가 지침을 바꾸면 실행 중인 실행은 그대로 끝내고, 다음 실행부터 바뀐 값을 쓴다', async () => {
    const { flow, executor, agent, settingsStore, bundles, repos, poll, setConnected } = await setup();
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    /** 바꾼 기본 에이전트의 실행기. */
    const codex = new FakeExecutor('codex');
    codex.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'), addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'));

    agent.executor = codex;
    agent.model = 'fake-codex-model';
    settingsStore.settings.extraInstructions = '맺음말로 "확인 부탁드립니다"를 붙입니다.';
    // 기본 에이전트와 모델이 바뀌었다고 알린다.
    setConnected(true);
    await settle();

    expect(executor.requests[0]?.signal.aborted).toBe(false);
    expect(codex.requests).toEqual([]);

    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();

    expect(executor.requests).toHaveLength(1);
    expect(executor.requests[0]?.model).toBe('sonnet');
    expect(executor.requests[0]?.instructions).not.toContain('확인 부탁드립니다');
    expect(codex.requests).toHaveLength(1);
    expect(codex.requests[0]?.model).toBe('fake-codex-model');
    expect(codex.requests[0]?.instructions.endsWith('## 사용자의 추가 지침\n맺음말로 "확인 부탁드립니다"를 붙입니다.')).toBe(true);
    expect(bundles.state().map((bundle) => [bundle.status, bundle.runs[0]?.agent])).toEqual([
      ['ready', 'claude-code'],
      ['ready', 'codex'],
    ]);
  });

  it('맥락을 조회하는 사이에 모델을 바꾸면, 아직 에이전트를 띄우기 전이라 그 실행부터 바뀐 모델을 쓴다', async () => {
    const { flow, executor, agent, repos, poll, setConnected } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    setConnected(false);
    await poll(alarm('101'));
    // 초안 실행 직전의 맥락 조회(게시물부터 받는다)가 도는 사이에 모델을 바꾼다.
    flow.whenRequested(`GET /user/posts/${POST_ID}`, () => {
      agent.model = 'opus';
    });

    setConnected(true);
    await settle();

    expect(executor.requests.map((request) => request.model)).toEqual(['opus']);
  });

  it('일시적 실패로 다시 실행하는 것도 다음 실행이라, 그 사이 바뀐 모델과 추가 지침을 쓴다', async () => {
    const { executor, agent, settingsStore, bundles, repos, poll } = await setup();
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));

    agent.model = 'opus';
    settingsStore.settings.extraInstructions = '맺음말로 "확인 부탁드립니다"를 붙입니다.';
    run.release({ type: 'failed', reason: 'overloaded', detail: 'API Error: 529 Overloaded' });
    await settle();

    expect(executor.requests.map((request) => request.model)).toEqual(['sonnet', 'opus']);
    expect(executor.requests[0]?.instructions).not.toContain('확인 부탁드립니다');
    expect(executor.requests[1]?.instructions).toContain('확인 부탁드립니다');
    expect(bundles.state()[0]?.runs.map((record) => record.model)).toEqual(['sonnet', 'opus']);
    expect(bundles.state()[0]?.status).toBe('ready');
  });

  it('일시적 실패로 다시 실행하기 직전 확인이 실패하면, 묶음을 실패로 두지 않고 대기열을 멈췄다가 연결되면 처음부터 다시 만든다', async () => {
    const { executor, agent, bundles, repos, poll, setConnected } = await setup();
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 실행하던 묶음. */
    const [bundle] = bundles.state();

    // 다시 실행하기 전에 CLI 버전이 바뀌어 돌린 작동 확인이 실패해 연결이 끊긴다.
    agent.confirmForRun = async () => {
      agent.connected = false;
      return false;
    };
    run.release({ type: 'failed', reason: 'network', detail: 'API Error: Connection refused' });
    await settle();

    expect(bundles.get(bundle!.id)).toMatchObject({ status: 'generating', failure: null });
    expect(executor.requests).toHaveLength(1);

    agent.confirmForRun = async () => agent.connected;
    setConnected(true);
    await settle();

    expect(bundles.get(bundle!.id)?.status).toBe('ready');
    expect(bundles.get(bundle!.id)?.runs.map((record) => record.result)).toEqual(['network', 'succeeded']);
  });
});

describe('대기열과 에이전트 연결 확인', () => {
  it('실행 직전에 CLI 버전이 바뀐 것을 알아채면 작동 확인을 먼저 돌리고, 실패하면 대기열을 멈추고 에이전트 확인 필요를 한 번 알린다. 고친 뒤 다시 확인하면 다시 돈다', async () => {
    const real = await realAgent(workDir);
    await real.connection.check();
    const { flow, bundles, poll } = await setup(real.queueAgent);

    await poll(alarm('101'));

    // 매 실행 전에는 버전만 읽고, 로그인은 앱을 시작할 때 한 번만 확인했다.
    expect(bundles.state()[0]?.status).toBe('ready');
    expect(real.loginChecks()).toBe(1);

    // CLI가 스스로 새 버전으로 바뀌었는데, 새 버전에서는 작동 확인이 실패한다.
    real.cli.version = '2.1.310';
    real.cli.checkRunWorks = false;
    await poll(addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'));
    await settle();

    /** 새 버전을 알아챈 뒤 기다리는 묶음. */
    const second = bundles.state()[1];
    expect(second).toMatchObject({ status: 'generating', failure: null, runs: [] });
    expect(real.draftRuns()).toBe(1);
    expect(real.problems.current()?.problem).toEqual({ cause: 'agent', reason: 'check-failed' });
    expect(real.notifier.sent).toHaveLength(1);

    // 사용자가 고친 뒤 설정의 에이전트 칸에서 다시 확인한다.
    real.cli.checkRunWorks = true;
    await real.connection.check();
    await settle();

    expect(bundles.get(second!.id)?.status).toBe('ready');
    expect(real.draftRuns()).toBe(2);
    expect(real.problems.current()).toBeNull();
    expect(real.notifier.sent).toHaveLength(1);
  });

  it('초안 실행이 미로그인으로 끝나 다시 한 연결 확인도 실패하면, 묶음을 실패로 두지 않고 대기열을 멈추며 에이전트 확인 필요를 알린다. 로그인한 뒤 다시 확인하면 그 묶음부터 다시 돈다', async () => {
    const real = await realAgent(workDir);
    await real.connection.check();
    const { bundles, poll } = await setup(real.queueAgent);
    // 앱을 켠 뒤 로그인이 만료됐다. 실행 직전에는 버전만 읽으므로 실행해 보고서야 알아챈다.
    real.cli.loggedIn = false;

    await poll(alarm('101'));
    await settle();

    /** 실행했던 묶음. */
    const [bundle] = bundles.state();
    expect(bundle).toMatchObject({ status: 'generating', failure: null });
    expect(bundle?.runs.map((run) => run.result)).toEqual(['not-logged-in']);
    expect(real.problems.current()?.problem).toEqual({ cause: 'agent', reason: 'not-logged-in' });
    expect(real.notifier.sent).toHaveLength(1);

    real.cli.loggedIn = true;
    await real.connection.check();
    await settle();

    expect(bundles.get(bundle!.id)?.status).toBe('ready');
    expect(bundles.get(bundle!.id)?.runs.map((run) => run.result)).toEqual(['not-logged-in', 'succeeded']);
    expect(real.problems.current()).toBeNull();
  });
});

describe('대기열: 키 확인 필요', () => {
  it('맥락을 조회할 때 Flow가 키를 거부하면(401) 묶음을 실패로 두지 않고 대기열을 멈추고, 키 확인 필요가 풀리면 그 묶음부터 다시 돈다', async () => {
    const { flow, executor, problems, bundles, repos, poll, setConnected } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    setConnected(false);
    await poll(alarm('101'), addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'));
    // 감지가 끝난 뒤 Flow가 키를 거부하기 시작해, 초안 실행 직전의 맥락 조회(게시물부터 받는다)가 401을 받는다.
    flow.failOn(`GET /user/posts/${POST_ID}`, { kind: 'unauthorized' }, 1);

    setConnected(true);
    await settle();

    expect(problems.current()?.problem).toEqual({ cause: 'flow-key', reason: 'rejected' });
    expect(bundles.state().map(({ status, failure }) => ({ status, failure }))).toEqual([
      { status: 'generating', failure: null },
      { status: 'generating', failure: null },
    ]);
    expect(executor.requests).toEqual([]);

    problems.resolve('flow-key');
    await settle();

    expect(executor.requests.map(targetMentionOf)).toEqual(['@테스트 사용자 재시도는 몇 번 하나요?', '@테스트 사용자 두 번째 질문']);
    expect(bundles.state().map((bundle) => bundle.status)).toEqual(['ready', 'ready']);
  });

  it('키 확인 필요인 동안에는 생성을 시작하지 않고, 풀리면 기다리던 묶음을 실행한다', async () => {
    const { executor, problems, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    problems.raise({ cause: 'flow-key', reason: 'unreadable' });

    await poll(alarm('101'));

    /** 기다리는 묶음. */
    const [bundle] = bundles.state();
    expect(bundle?.status).toBe('generating');
    expect(drafts.progress(bundle!.id)).toEqual({ status: 'waiting' });
    expect(executor.requests).toEqual([]);

    problems.resolve('flow-key');
    await settle();

    expect(bundles.get(bundle!.id)?.status).toBe('ready');
  });
});

describe('대기열: Flow에 닿지 못할 때', () => {
  it('맥락을 조회할 때 Flow에 닿지 못하면(네트워크 오류) 묶음을 실패로 두지 않고 대기열을 멈췄다가, 폴링 주기(1분) 뒤 다시 조회해 실행한다', async () => {
    const { flow, executor, clock, drafts, bundles, repos, poll, setConnected } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    setConnected(false);
    await poll(alarm('101'), addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'));
    // 감지가 끝난 뒤 네트워크가 끊겨, 초안 실행 직전의 맥락 조회(게시물부터 받는다)가 Flow에 닿지 못한다.
    flow.failOn(`GET /user/posts/${POST_ID}`, { kind: 'network' }, 1);

    setConnected(true);
    await settle();

    /** 맥락을 조회하던 묶음과 기다리던 묶음. */
    const [first, second] = bundles.state();
    expect([first?.status, second?.status]).toEqual(['generating', 'generating']);
    expect(first?.failure).toBeNull();
    expect(drafts.progress(first!.id)).toEqual({ status: 'waiting' });
    expect(executor.requests).toEqual([]);

    clock.advance(59_000);
    await settle();

    expect(executor.requests).toEqual([]);

    clock.advance(1_000);
    await settle();

    expect(executor.requests.map(targetMentionOf)).toEqual(['@테스트 사용자 재시도는 몇 번 하나요?', '@테스트 사용자 두 번째 질문']);
    expect(bundles.state().map((bundle) => bundle.status)).toEqual(['ready', 'ready']);
  });

  it('맥락을 조회할 때 요청 한도(429)에 걸리면 Flow가 알려 준 Retry-After만큼 기다렸다가 다시 조회한다', async () => {
    const { flow, executor, clock, bundles, repos, poll, setConnected } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    setConnected(false);
    await poll(alarm('101'));
    flow.failOn(`GET /user/posts/${POST_ID}`, { kind: 'rate-limited', retryAfterMs: 20_000 }, 1);

    setConnected(true);
    await settle();
    clock.advance(19_000);
    await settle();

    expect(bundles.state()[0]).toMatchObject({ status: 'generating', failure: null });
    expect(executor.requests).toEqual([]);

    clock.advance(1_000);
    await settle();

    expect(bundles.state()[0]?.status).toBe('ready');
  });

  it('Flow 서버 오류(5xx)는 그 글에서만 생길 수 있어 대기열을 멈추지 않고 그 묶음을 실패로 둔다', async () => {
    const { flow, executor, bundles, repos, poll, setConnected } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    setConnected(false);
    await poll(alarm('101'), addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'));
    flow.failOn(`GET /user/posts/${POST_ID}`, { kind: 'http', status: 503 }, 1);

    setConnected(true);
    await settle();

    /** 맥락을 조회하지 못한 묶음과 다음 묶음. */
    const [first, second] = bundles.state();
    expect(first).toMatchObject({ status: 'failed', failure: { reason: 'flow-unavailable' } });
    expect(second?.status).toBe('ready');
  });
});

describe('초안 실행에 쓸 에이전트', () => {
  it('기본 에이전트의 연결이 만든 실행기와 실행 직전 확인, 그 에이전트에 고른 모델을 쓰고, 기본 모델이면 모델을 넘기지 않는다. 연결된 에이전트가 없거나 그 연결이 없으면 기다린다', async () => {
    /** Claude Code 연결. 실행 직전 확인은 실행하면 안 된다고 답한다. */
    const claude = { executor: new FakeExecutor('claude-code'), confirmForRun: async () => false };
    /** 모델 선택 상자. */
    const models = { 'claude-code': { options: [{ id: 'sonnet', label: 'Sonnet', unlisted: false }], selected: 'sonnet' } };

    /** 고른 에이전트. */
    const picked = draftAgentFrom({ connectedAgents: ['claude-code'], defaultAgent: 'claude-code', models }, [claude]);
    expect(picked).toMatchObject({ executor: claude.executor, model: 'sonnet' });
    await expect(picked?.confirmForRun()).resolves.toBe(false);
    expect(
      draftAgentFrom({ connectedAgents: ['claude-code'], defaultAgent: 'claude-code', models: { 'claude-code': { options: [], selected: null } } }, [claude]),
    ).toMatchObject({ executor: claude.executor, model: null });
    expect(draftAgentFrom({ connectedAgents: [], defaultAgent: null, models: {} }, [claude])).toBeNull();
    expect(draftAgentFrom({ connectedAgents: ['codex'], defaultAgent: 'codex', models: {} }, [claude])).toBeNull();
  });
});
