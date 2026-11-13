import { AssignmentDetection } from '../detection/assignment-detection';
import { bundleRecipients } from './post-body';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentConnection } from '../agent/agent-connection';
import { AgentConnections } from '../agent/agent-connections';
import { AgentPreferences } from '../agent/agent-preferences';
import { CHECK_RUN_INPUT } from '../agent/check-run';
import { MentionBundles } from '../bundles/mention-bundles';
import { MentionDetection } from '../detection/mention-detection';
import { claudeNotLoggedInStream, claudeSuccessStream, fakeClaudeAuthStatus } from '../fakes/fake-claude-stream';
import { codexModelsOutput, codexSuccessStream, fakeCodexLoginStatus } from '../fakes/fake-codex-events';
import { FakeClock } from '../fakes/fake-clock';
import { FakeExecutor } from '../fakes/fake-executor';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import { exited, FakeProcessRunner } from '../fakes/fake-process-runner';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { collectBundleContext } from '../flow/bundle-context';
import assignmentComments from '../flow/fixtures/assignment-comments-2026-10-29.json';
import assignmentPost from '../flow/fixtures/assignment-post-2026-10-29.json';
import { HttpFlowApi } from '../flow/http-flow-api';
import { FakeFlowServer, flowEnvelope } from '../fakes/fake-flow-server';
import { MentionJudge } from '../flow/mention-judgement';
import { createLogger } from '../logging/logger';
import type { ExecutorOutcome, ExecutorRunRequest } from '../ports/executor';
import type { FlowAlarm, FlowEmployee } from '../ports/flow-api';
import { GlobalProblems } from '../problems/global-problems';
import { FlowAccount } from '../account/flow-account';
import { MemorySecretStore } from '../fakes/memory-secret-store';
import { RepoMappings } from '../repos/repo-mappings';
import { DRAFT_INSTRUCTIONS } from './draft-input';
import { draftAgentFrom, DraftQueue, type DraftQueueOptions } from './draft-queue';
import { DraftSettings } from './draft-settings';
import { Posting } from '../posting/posting';
import { openStateDatabase, SqliteStateStore, STATE_MIGRATIONS } from '../storage/state-database';
import { SELECTION_INSTRUCTIONS } from './repo-selection';
import { ManualCheckSession } from '../manual-check/manual-check-session';
import { ManualMentionCheck } from '../manual-check/manual-mention-check';

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
/** 저장소 매핑이 없는 Flow 프로젝트. 이 프로젝트의 멘션 묶음은 자동 선택으로 저장소를 정한다. */
const UNMAPPED_PROJECT_ID = '900002';
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

/** `settle`이 한 번에 기다리는 가장 긴 실제 시간(밀리초). 파일 작업이 끝나지 않는 고장이 있어도 테스트가 멈추지 않게 한다. */
const SETTLE_LIMIT_MS = 3_000;

/**
 * 가짜 시계가 부른 일과 가짜 포트의 응답이 모두 끝나도록 대기 중인 비동기 일을 여러 번 돌린다. 가짜 포트는 모두 바로 답한다.
 * 저장소 폴더 확인, 근거 위치 검증, 지침 파일 쓰기는 임시 폴더의 실제 파일을 다루므로, 끝나지 않은 파일 작업이 없는 차례가
 * 연달아 지날 때까지 기다린다. 정해진 시간만 기다리면 기계가 바빠 파일 작업이 늦을 때 흔들린다.
 */
async function settle(): Promise<void> {
  /** 그만 기다릴 시각. */
  const deadline = Date.now() + SETTLE_LIMIT_MS;
  /** 끝나지 않은 파일 작업 없이 연달아 지나간 차례 수. */
  let quietRounds = 0;
  while (quietRounds < 3 && Date.now() < deadline) {
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    /** 끝나기를 기다리는 파일 작업이 있는지 여부. Node는 진행 중인 파일 작업을 `FSReq`로 시작하는 이름으로 보인다. */
    const filesPending = process.getActiveResourcesInfo().some((resource) => resource.startsWith('FSReq'));
    quietRounds = filesPending ? 0 : quietRounds + 1;
    await new Promise((resolve) => setTimeout(resolve, filesPending ? 5 : 1));
  }
}

/**
 * 테스트 임시 폴더에 작업 폴더를 만들고, 그 안에 `.git` 폴더가 있는 가짜 저장소를 만든다.
 * 작업 폴더와 저장소의 절대 경로를 돌려준다. 저장소는 준 순서다.
 */
function makeWorkFolder(name: string, repoNames: readonly string[]): { folder: string; repos: string[] } {
  /** 작업 폴더. */
  const folder = join(workDir, name);
  mkdirSync(folder);
  /** 가짜 저장소. */
  const repos = repoNames.map((repoName) => {
    /** 저장소 폴더. */
    const repo = join(folder, repoName);
    mkdirSync(join(repo, '.git'), { recursive: true });
    return repo;
  });
  return { folder, repos };
}

/** 근거 하나가 든 가짜 초안 실행 출력. `repository`는 넘긴 저장소 가운데 하나다. */
function draftOutput(repository: string) {
  return {
    requirement: { text: '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.', summary: '재시도 횟수' },
    paragraphs: [
      {
        sentences: [
          { text: '실제 서비스에서는 다섯 번까지 다시 시도합니다.', evidence: [1] },
          { text: '테스트 환경은 세 번으로 보입니다.', evidence: [] },
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
  flow.respondToListParticipantProjects({
    ok: true,
    value: [
      { projectId: PROJECT_ID, title: '가짜 프로젝트', projectUrl: null },
      { projectId: UNMAPPED_PROJECT_ID, title: '매핑 없는 프로젝트', projectUrl: null },
    ],
  });
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
      stateStore,
      myName: () => FAKE_ME.name,
      projectTitle: (projectId) => repoMappings.projectTitle(projectId),
      clock,
      logger,
    });
  const drafts = createQueue();
  await drafts.start();
  /** 앱을 끄고 다시 켠 것처럼 대기열을 멈추고 새 대기열을 시작한다. 새 대기열을 돌려준다. */
  const restartApp = async () => {
    await drafts.stop();
    /** 다시 켠 앱의 대기열. */
    const restarted = createQueue();
    await restarted.start();
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
    agent: 'claude-code',
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
    connectedAgents: () => (connection.isConnected() ? [connection.agent] : []),
    listedModels: () => connection.models(),
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
            { text: '테스트 환경은 세 번으로 보입니다.', evidence: [] },
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
      // 저장소 매핑으로 정한 저장소라 자동 선택의 내력이 없다.
      autoSelection: null,
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
    expect(failed?.failure).toEqual({
      reason: 'invalid-output',
      detail: '스키마에 맞는 구조화 출력을 만들지 못했습니다.',
      lastStep: '초안 쓰는 중',
      runKind: 'draft',
    });
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
      { text: '테스트 환경은 세 번으로 보입니다.', evidence: [1] },
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

describe('초안 실행: 앱 내 업데이트의 다시 시작 대기', () => {
  it('다시 시작을 기다리는 동안 실행 중인 실행은 끝까지 가지만 다음 실행은 시작하지 않고, 대기를 풀면 다시 돈다', async () => {
    const { flow, executor, drafts, bundles, repos, poll } = await setup();
    /** 끝을 붙잡아 둔 첫 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addComment(POST_ID, { commentId: '701', contents: `${MY_MARKUP} 다른 질문`, registerId: SENDER, registeredDateTime: '20261020085600' });
    await poll(alarm('101'), alarm('102', { remarkId: '701', registeredDateTime: '20261020085600' }));
    /** 먼저 온 묶음과 나중에 온 묶음. */
    const [first, second] = bundles.state();
    expect(drafts.isRunning()).toBe(true);

    drafts.holdForRestart(true);
    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();

    expect(bundles.get(first!.id)?.status).toBe('ready');
    expect(drafts.isRunning()).toBe(false);
    expect(drafts.progress(second!.id)).toEqual({ status: 'waiting' });
    expect(executor.requests).toHaveLength(1);

    drafts.holdForRestart(false);
    await settle();

    expect(bundles.get(second!.id)?.status).toBe('ready');
    expect(executor.requests).toHaveLength(2);
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

});

describe('자동 선택: 후보 찾기', () => {
  it('저장소 매핑이 없는 Flow 프로젝트의 멘션 묶음은 작업 폴더에서 후보를 찾고, 작업 폴더가 없으면 실행 없이 "작업 폴더에서 저장소를 찾지 못함" 사유로 저장소 확인 필요가 되며 OS 알림을 띄운다', async () => {
    const { executor, bundles, notifier, poll } = await setup();

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    /** 저장소 확인 필요 묶음. */
    const [bundle] = bundles.state();
    expect(bundle).toMatchObject({ status: 'repo-check-needed', repoCheck: { kind: 'no-candidates' }, draft: null });
    expect(bundles.reviewCount()).toBe(1);
    expect(notifier.sent).toEqual([{ title: '저장소 확인 필요', body: '보낸 사람님이 나를 멘션했습니다.', bundleId: bundle?.id }]);
    expect(executor.requests).toEqual([]);
    // 원문 영역의 "스레드 보기"에 보일 맥락은 조회해 둔다.
    expect(bundle?.context?.post.title).toBe('가짜 게시물');
  });

  it('작업 폴더가 비어 있거나 사라졌어도 후보가 0개라 같은 사유로 저장소 확인 필요가 된다', async () => {
    const { executor, bundles, settingsStore, poll } = await setup();
    /** 저장소가 없는 작업 폴더. */
    const empty = makeWorkFolder('empty', []);
    settingsStore.settings.workFolders = [empty.folder, join(workDir, 'gone')];

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    expect(bundles.state()[0]).toMatchObject({ status: 'repo-check-needed', repoCheck: { kind: 'no-candidates' } });
    expect(executor.requests).toEqual([]);
  });

  it('후보가 1개면 선택 실행 없이 그 저장소로 초안 실행을 돌리고, 초안에 후보가 하나라 그 저장소를 썼다고 남긴다. 저장소 매핑으로 저장하지 않는다', async () => {
    const { executor, bundles, settingsStore, repos, poll } = await setup();
    /** 저장소가 하나인 작업 폴더. */
    const work = makeWorkFolder('work', ['only-repo']);
    settingsStore.settings.workFolders = [work.folder];
    executor.script({ outcome: { type: 'completed', output: draftOutput(work.repos[0]!) } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    expect(executor.requests.map((request) => request.kind)).toEqual(['draft']);
    expect(executor.requests[0]?.readRoots).toEqual(work.repos);
    expect(executor.requests[0]?.input).toContain(`# 읽을 저장소\n- ${work.repos[0]}\n`);
    expect(bundles.state()[0]).toMatchObject({ status: 'ready', draft: { repositories: work.repos, autoSelection: { kind: 'single-candidate' } } });
    expect(settingsStore.settings.repoMappings).toEqual({ [PROJECT_ID]: [repos.a, repos.b] });
  });
});

describe('자동 선택: 선택 실행', () => {
  it('후보가 여럿이면 선택 실행이 먼저 돌고 고른 저장소로 초안 실행이 바로 이어진다. 선택 실행은 작업 폴더 전부를 읽고(첫 폴더가 cwd) 선택 실행 지침, 후보 enum 스키마, 5분 제한으로 돈다', async () => {
    const { executor, bundles, settingsStore, repos, poll } = await setup();
    /** 저장소가 둘인 작업 폴더와 하나인 작업 폴더. */
    const [work, side] = [makeWorkFolder('work', ['api', 'web']), makeWorkFolder('side', ['batch'])];
    /** 후보 저장소. */
    const [api, web, batch] = [...work.repos, ...side.repos] as [string, string, string];
    settingsStore.settings.workFolders = [work.folder, side.folder];
    settingsStore.settings.extraInstructions = '맺음말로 "확인 부탁드립니다"를 붙입니다.';
    settingsStore.settings.extraSecretPatterns = ['*.secret.yml'];
    /** 선택 실행이 적은 이유. */
    const reason = '화면에서 쓰는 재시도 설정을 묻고 있어 웹 화면 저장소와 그 서버 저장소를 골랐습니다.';
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [web, api], reason } } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(web) } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    /** 선택 실행 요청과 초안 실행 요청. */
    const [selection, draft] = executor.requests;
    expect(executor.requests.map((request) => request.kind)).toEqual(['selection', 'draft']);
    expect(selection).toMatchObject({ readRoots: [work.folder, side.folder], secretPatterns: ['*.secret.yml'], model: 'sonnet', timeoutMs: 5 * 60 * 1000 });
    // 선택 실행은 전용 지침만 쓰고, 초안 문체를 바꾸는 추가 지침은 붙이지 않는다.
    expect(selection?.instructions).toBe(SELECTION_INSTRUCTIONS);
    for (const rule of ['확신이 낮다고 후보를 모두 넣지 않습니다', '"# 데이터" 줄부터', 'chosen', 'unsure', 'unrelated', '쉬운 말']) {
      expect(selection?.instructions).toContain(rule);
    }
    expect(selection?.outputSchema).toEqual({
      type: 'object',
      properties: {
        verdict: { type: 'string', enum: ['chosen', 'unsure', 'unrelated'] },
        repositories: { type: 'array', items: { type: 'string', enum: [api, web, batch] } },
        reason: { type: 'string' },
      },
      required: ['verdict', 'repositories', 'reason'],
      additionalProperties: false,
    });
    /** 선택 실행의 입력 문서. */
    const input = selection?.input ?? '';
    expect(input).toContain(`# 후보 저장소\n- ${api}\n- ${web}\n- ${batch}\n`);
    expect(input).toContain('Flow 프로젝트: 매핑 없는 프로젝트');
    expect(input).toContain('1. [답할 대상] 보낸 사람 · 2026-10-20 08:50 · 댓글\n   @테스트 사용자 재시도는 몇 번 하나요?');
    expect(input).toContain('재시도 설정을 정리한 글입니다.');
    expect(input.indexOf('\n# 데이터\n')).toBeGreaterThan(input.indexOf('\n# 후보 저장소\n'));
    for (const userId of [ME, SENDER]) expect(input).not.toContain(userId);
    // 초안 실행은 고른 순서대로 저장소를 읽고, 데이터 구획(맥락)은 선택 실행과 같다.
    expect(draft?.readRoots).toEqual([web, api]);
    expect(draft?.input.slice(draft.input.indexOf('\n# 데이터\n'))).toBe(input.slice(input.indexOf('\n# 데이터\n')));

    /** 준비된 묶음. */
    const [ready] = bundles.state();
    expect(ready).toMatchObject({ status: 'ready', draft: { repositories: [web, api], autoSelection: { kind: 'chosen', reason } } });
    expect(ready?.runs.map((run) => [run.kind, run.result])).toEqual([
      ['selection', 'succeeded'],
      ['draft', 'succeeded'],
    ]);
    // 자동으로 고른 저장소는 저장소 매핑으로 저장하지 않는다.
    expect(settingsStore.settings.repoMappings).toEqual({ [PROJECT_ID]: [repos.a, repos.b] });
  });

  it('선택 실행에서 초안 실행으로 넘어가도 묶음은 생성 중 하나로 보이고, 진행 단계만 "저장소 고르는 중"에서 "초안 쓰는 중"으로 바뀐다', async () => {
    const { executor, drafts, bundles, settingsStore, poll } = await setup();
    /** 저장소가 둘인 작업 폴더. */
    const work = makeWorkFolder('work', ['api', 'web']);
    settingsStore.settings.workFolders = [work.folder];
    /** 끝나지 않고 기다리는 선택 실행과 초안 실행. */
    const [selection, draft] = [heldOutcome(), heldOutcome()];
    executor.script({ outcome: selection.outcome });
    executor.script({ outcome: draft.outcome });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));
    /** 생성 중 묶음. */
    const bundleId = bundles.state()[0]!.id;
    expect(bundles.get(bundleId)?.status).toBe('generating');
    expect(drafts.progress(bundleId)).toEqual({ status: 'running', step: '저장소 고르는 중', filesRead: 0 });

    selection.release({ type: 'completed', output: { verdict: 'chosen', repositories: [work.repos[1]], reason: '웹 화면 질문입니다.' } });
    await settle();

    expect(bundles.get(bundleId)?.status).toBe('generating');
    expect(drafts.progress(bundleId)).toEqual({ status: 'running', step: '초안 쓰는 중', filesRead: 0 });
    expect(executor.requests.map((request) => request.kind)).toEqual(['selection', 'draft']);
  });

  it.each([
    ['unsure', '재시도 설정이 화면과 서버 양쪽에 있어 어느 쪽을 묻는지 알 수 없습니다.'],
    ['unrelated', '회의 일정을 묻는 멘션이라 저장소를 읽을 필요가 없습니다.'],
  ] as const)('선택 실행의 판정이 %s면 초안 없이 에이전트의 사유, 작업 폴더의 후보, 에이전트가 짚은 저장소를 담아 저장소 확인 필요가 되고, OS 알림을 띄우며 트레이 숫자에 센다', async (verdict, reason) => {
    const { executor, bundles, notifier, settingsStore, poll } = await setup();
    /** 저장소가 셋인 작업 폴더. */
    const work = makeWorkFolder('work', ['api', 'batch', 'web']);
    settingsStore.settings.workFolders = [work.folder];
    /** 에이전트가 짚은 후보. 판정이 고름이 아니어도 가능성이 있는 저장소를 넣을 수 있다. */
    const picked = verdict === 'unsure' ? [work.repos[2]!, work.repos[0]!] : [];
    executor.script({ outcome: { type: 'completed', output: { verdict, repositories: picked, reason } } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    expect(executor.requests.map((request) => request.kind)).toEqual(['selection']);
    /** 저장소 확인 필요 묶음. */
    const [bundle] = bundles.state();
    expect(bundle).toMatchObject({ status: 'repo-check-needed', draft: null });
    expect(bundle?.repoCheck).toEqual({
      kind: verdict,
      reason,
      candidates: [
        { name: 'api', path: work.repos[0] },
        { name: 'batch', path: work.repos[1] },
        { name: 'web', path: work.repos[2] },
      ],
      picked,
    });
    expect(bundle?.runs.map((run) => [run.kind, run.result])).toEqual([['selection', 'succeeded']]);
    expect(bundles.reviewCount()).toBe(1);
    expect(notifier.sent).toEqual([{ title: '저장소 확인 필요', body: '보낸 사람님이 나를 멘션했습니다.', bundleId: bundle?.id }]);
  });
});

describe('자동 선택: 선택 실행의 내용 불일치', () => {
  /** 저장소가 다섯인 작업 폴더를 만들고 작업 폴더로 둔다. */
  function fiveRepos(settingsStore: MemorySettingsStore) {
    /** 작업 폴더. */
    const work = makeWorkFolder('work', ['a-api', 'b-web', 'c-batch', 'd-admin', 'e-docs']);
    settingsStore.settings.workFolders = [work.folder];
    return work;
  }

  it('판정이 고름인데 저장소가 0개면 확신 못함으로 다뤄 저장소 확인 필요가 되고, 고친 내용은 실행 기록에만 남긴다', async () => {
    const { executor, bundles, settingsStore, poll } = await setup();
    fiveRepos(settingsStore);
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [], reason: '고를 저장소가 보이지 않습니다.' } } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    /** 저장소 확인 필요 묶음. */
    const [bundle] = bundles.state();
    expect(bundle).toMatchObject({ status: 'repo-check-needed', repoCheck: { kind: 'unsure', reason: '고를 저장소가 보이지 않습니다.', picked: [] } });
    expect(bundle?.runs.map(({ kind, result, fixes }) => ({ kind, result, fixes }))).toEqual([
      { kind: 'selection', result: 'succeeded', fixes: ['판정이 고름인데 저장소가 0개라 확신 못함으로 다룸'] },
    ]);
    expect(executor.requests.map((request) => request.kind)).toEqual(['selection']);
  });

  it('판정이 고름인데 저장소가 4개 이상이면 앞의 3개만 써서 초안 실행을 돌린다. 같은 저장소를 거듭 고르면 한 번만 센다', async () => {
    const { executor, bundles, settingsStore, poll } = await setup();
    /** 저장소가 다섯인 작업 폴더. */
    const work = fiveRepos(settingsStore);
    /** 에이전트가 고른 순서. 같은 저장소가 거듭 나온다. */
    const [a, b, c, d, e] = work.repos as [string, string, string, string, string];
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [e, c, e, a, d, b], reason: '여러 저장소가 관련 있습니다.' } } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(e) } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    expect(executor.requests[1]?.readRoots).toEqual([e, c, a]);
    /** 준비된 묶음. */
    const [ready] = bundles.state();
    expect(ready).toMatchObject({ status: 'ready', draft: { repositories: [e, c, a] } });
    expect(ready?.runs[0]?.fixes).toEqual(['같은 저장소를 거듭 고름: 1개를 뺌', '저장소를 5개 골라 앞의 3개만 씀']);
  });

  it('이유가 비어 있으면 빈 이유로 두고(화면에는 "이유 없음") 고친 내용을 실행 기록에 남긴다', async () => {
    const { executor, bundles, settingsStore, poll } = await setup();
    /** 저장소가 다섯인 작업 폴더. */
    const work = fiveRepos(settingsStore);
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [work.repos[1]], reason: '   ' } } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(work.repos[1]!) } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    /** 준비된 묶음. */
    const [ready] = bundles.state();
    expect(ready?.draft?.autoSelection).toEqual({ kind: 'chosen', reason: '' });
    expect(ready?.runs[0]?.fixes).toEqual(['이유가 비어 있음']);
  });

  it('후보가 아닌 저장소를 고르거나 판정이 세 값이 아니면 구조 실패라 한 번 더 실행하고, 두 번 모두 그러면 선택 실행의 구조 실패로 실패가 된다', async () => {
    const { executor, bundles, settingsStore, poll } = await setup();
    fiveRepos(settingsStore);
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: ['/somewhere/else'], reason: '다른 곳입니다.' } } });
    executor.script({ outcome: { type: 'completed', output: { verdict: 'maybe', repositories: [], reason: '모르겠습니다.' } } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    /** 실패한 묶음. */
    const [failed] = bundles.state();
    expect(failed).toMatchObject({ status: 'failed', failure: { reason: 'invalid-output', detail: '구조화 출력이 선택 실행 스키마 모양이 아닙니다.' } });
    expect(failed?.runs.map(({ kind, result }) => [kind, result])).toEqual([
      ['selection', 'invalid-output'],
      ['selection', 'invalid-output'],
    ]);
    expect(executor.requests.map((request) => request.kind)).toEqual(['selection', 'selection']);
  });
});

describe('자동 선택: 잇기 순서와 선택 실행의 실패', () => {
  /** 저장소가 둘인 작업 폴더를 만들고 작업 폴더로 둔다. */
  function twoRepos(settingsStore: MemorySettingsStore) {
    /** 작업 폴더. */
    const work = makeWorkFolder('work', ['api', 'web']);
    settingsStore.settings.workFolders = [work.folder];
    return work;
  }

  it('선택 실행이 끝나면 그사이 사용자가 누른 다시 시도나 감지한 묶음보다 앞서, 그 묶음의 초안 실행이 바로 이어진다', async () => {
    const { flow, executor, drafts, bundles, settingsStore, repos, poll } = await setup();
    /** 저장소가 둘인 작업 폴더. */
    const work = twoRepos(settingsStore);
    executor.script({ outcome: { type: 'failed', reason: 'agent-error', detail: 'usage limit' } });
    await poll(alarm('101'));
    /** 실패한 묶음. 저장소 매핑이 있다. */
    const failed = bundles.state()[0]!;
    expect(failed.status).toBe('failed');

    /** 끝나지 않고 기다리는 선택 실행. */
    const selection = heldOutcome();
    executor.script({ outcome: selection.outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(work.repos[0]!) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(
      { ...addThreadMention(flow, '102', '701', '매핑 없는 질문', '20261020085100'), projectId: UNMAPPED_PROJECT_ID },
      addThreadMention(flow, '103', '702', '감지한 질문', '20261020085200'),
    );
    await drafts.retry(failed.id);
    await settle();
    expect(executor.requests.map((request) => request.kind)).toEqual(['draft', 'selection']);

    selection.release({ type: 'completed', output: { verdict: 'chosen', repositories: [work.repos[0]], reason: '서버 질문입니다.' } });
    await settle();

    expect(executor.requests.map((request) => [request.kind, targetMentionOf(request)])).toEqual([
      ['draft', '@테스트 사용자 재시도는 몇 번 하나요?'],
      ['selection', '@테스트 사용자 매핑 없는 질문'],
      ['draft', '@테스트 사용자 매핑 없는 질문'],
      ['draft', '@테스트 사용자 재시도는 몇 번 하나요?'],
      ['draft', '@테스트 사용자 감지한 질문'],
    ]);
    expect(bundles.state().map((bundle) => bundle.status)).toEqual(['ready', 'ready', 'ready']);
  });

  it('선택 실행이 5분 제한 시간을 넘기면 다시 실행하지 않고 초안 실행 없이 실패가 되며, 실패에는 선택 실행에서 실패했다고 남는다', async () => {
    const { executor, bundles, settingsStore, poll } = await setup();
    twoRepos(settingsStore);
    executor.script({ progress: [{ step: '파일 읽는 중: README.md', filesRead: 1 }], outcome: { type: 'timed-out' } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    expect(bundles.state()[0]).toMatchObject({
      status: 'failed',
      failure: { reason: 'timed-out', detail: null, lastStep: '파일 읽는 중: README.md', runKind: 'selection' },
    });
    expect(executor.requests.map((request) => request.kind)).toEqual(['selection']);
  });

  it('선택 실행 중에 취소하면 실행을 끊고 선택 실행에서 "취소함" 실패가 된다', async () => {
    const { executor, drafts, bundles, settingsStore, poll } = await setup();
    twoRepos(settingsStore);
    executor.script({ outcome: 'wait-for-abort' });
    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));
    /** 생성 중 묶음. */
    const bundleId = bundles.state()[0]!.id;

    await drafts.cancel(bundleId);
    await settle();

    expect(executor.requests[0]?.signal.aborted).toBe(true);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'failed', failure: { reason: 'cancelled', lastStep: '저장소 고르는 중', runKind: 'selection' } });
    expect(bundles.get(bundleId)?.runs.map(({ kind, result }) => [kind, result])).toEqual([['selection', 'cancelled']]);
  });

  it('초안 실행에서 실패하면 실패에 초안 실행에서 실패했다고 남는다', async () => {
    const { executor, bundles, settingsStore, poll } = await setup();
    /** 저장소가 둘인 작업 폴더. */
    const work = twoRepos(settingsStore);
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [work.repos[0]], reason: '서버 질문입니다.' } } });
    executor.script({ outcome: { type: 'timed-out' } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    expect(bundles.state()[0]).toMatchObject({ status: 'failed', failure: { reason: 'timed-out', runKind: 'draft' } });
  });

  it('선택 실행 중에 새 멘션이 합쳐지면 실행을 끊고 선택 실행부터 처음부터 다시 한다', async () => {
    const { flow, executor, bundles, settingsStore, poll } = await setup();
    /** 저장소가 둘인 작업 폴더. */
    const work = twoRepos(settingsStore);
    executor.script({ outcome: 'wait-for-abort' });
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [work.repos[1]], reason: '웹 질문입니다.' } } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(work.repos[1]!) } });
    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 화면 기준으로요`, registerId: SENDER, registeredDateTime: '20261020085500' });

    await poll(alarm('102', { projectId: UNMAPPED_PROJECT_ID, replyId: '801', registeredDateTime: '20261020085500' }));

    expect(executor.requests.map((request) => [request.kind, targetMentionOf(request)])).toEqual([
      ['selection', '@테스트 사용자 재시도는 몇 번 하나요?'],
      ['selection', '@테스트 사용자 화면 기준으로요'],
      ['draft', '@테스트 사용자 화면 기준으로요'],
    ]);
    /** 준비된 묶음. */
    const [ready] = bundles.state();
    expect(ready?.status).toBe('ready');
    expect(ready?.runs.map(({ kind, result }) => [kind, result])).toEqual([
      ['selection', 'bundle-changed'],
      ['selection', 'succeeded'],
      ['draft', 'succeeded'],
    ]);
  });

  it('일시적 실패는 선택 실행과 초안 실행에서 각각 한 번씩 다시 실행한다', async () => {
    const { executor, bundles, settingsStore, poll } = await setup();
    /** 저장소가 둘인 작업 폴더. */
    const work = twoRepos(settingsStore);
    executor.script({ outcome: { type: 'failed', reason: 'overloaded', detail: 'Overloaded' } });
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [work.repos[0]], reason: '서버 질문입니다.' } } });
    executor.script({ outcome: { type: 'invalid-output', detail: '결과에 구조화 출력이 없습니다.' } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(work.repos[0]!) } });

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    expect(bundles.state()[0]?.status).toBe('ready');
    expect(bundles.state()[0]?.runs.map(({ kind, result }) => [kind, result])).toEqual([
      ['selection', 'overloaded'],
      ['selection', 'succeeded'],
      ['draft', 'invalid-output'],
      ['draft', 'succeeded'],
    ]);
  });

  it('선택 실행이 미로그인으로 끝나 다시 한 연결 확인도 실패하면, 묶음을 실패로 두지 않고 대기열을 멈췄다가 연결되면 선택 실행부터 다시 돈다', async () => {
    const { executor, drafts, bundles, settingsStore, poll, setConnected } = await setup();
    /** 저장소가 둘인 작업 폴더. */
    const work = twoRepos(settingsStore);
    /** 끝나지 않고 기다리는 선택 실행. */
    const selection = heldOutcome();
    executor.script({ outcome: selection.outcome });
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [work.repos[0]], reason: '서버 질문입니다.' } } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(work.repos[0]!) } });
    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));
    /** 생성 중 묶음. */
    const bundleId = bundles.state()[0]!.id;

    setConnected(false);
    selection.release({ type: 'failed', reason: 'not-logged-in', detail: 'Not logged in · Please run /login' });
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'generating', failure: null });
    expect(drafts.progress(bundleId)).toEqual({ status: 'waiting' });

    setConnected(true);
    await settle();

    expect(executor.requests.map((request) => request.kind)).toEqual(['selection', 'selection', 'draft']);
    expect(bundles.get(bundleId)?.status).toBe('ready');
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

describe('저장소 선택 창으로 다시 만들기', () => {
  it('준비됨 묶음을 다른 저장소로 다시 만들면 직전 초안을 지우고, 처음 입력에서 읽을 저장소만 바꾼 새 초안 실행이 돈다', async () => {
    const { executor, drafts, bundles, settingsStore, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 저장소 매핑으로 만든 준비됨 묶음. */
    const [ready] = bundles.state();
    expect(ready).toMatchObject({ status: 'ready', draft: { repositories: [repos.a, repos.b] } });
    /** 끝나지 않고 기다리는 두 번째 초안 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });

    await drafts.regenerateWithRepos(ready!.id, [repos.b]);
    await settle();

    // 생성 중에는 직전 초안이 남지 않는다.
    expect(bundles.get(ready!.id)).toMatchObject({ status: 'generating', draft: null, userRepos: [repos.b] });
    /** 처음 초안 실행과 다시 만든 초안 실행. */
    const [first, second] = executor.requests;
    expect(executor.requests.map((request) => request.kind)).toEqual(['draft', 'draft']);
    expect(second?.readRoots).toEqual([repos.b]);
    // 처음 입력과 읽을 저장소만 다르다. 직전 초안은 넘기지 않는다.
    expect(second?.input).toBe(first?.input.replace(`# 읽을 저장소\n- ${repos.a}\n- ${repos.b}\n`, `# 읽을 저장소\n- ${repos.b}\n`));
    expect(second?.input).not.toContain('다섯 번까지 다시 시도합니다');

    run.release({ type: 'completed', output: draftOutput(repos.b) });
    await settle();

    expect(bundles.get(ready!.id)).toMatchObject({ status: 'ready', draft: { repositories: [repos.b], autoSelection: null } });
    // 고른 구성은 연결 버튼을 누르기 전까지 저장소 매핑이 아니다.
    expect(settingsStore.settings.repoMappings).toEqual({ [PROJECT_ID]: [repos.a, repos.b] });
  });

  it('저장소 확인 필요 묶음에서 고른 구성으로 만들면, 저장소 매핑이 없어도 선택 실행 없이 그 구성으로 초안 실행만 돈다', async () => {
    const { executor, drafts, bundles, settingsStore, poll } = await setup();
    /** 저장소가 둘인 작업 폴더. */
    const work = makeWorkFolder('work', ['api', 'web']);
    /** 후보 저장소. */
    const [api, web] = work.repos as [string, string];
    settingsStore.settings.workFolders = [work.folder];
    executor.script({ outcome: { type: 'completed', output: { verdict: 'unsure', repositories: [api], reason: '알 수 없습니다.' } } });
    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));
    /** 저장소 확인 필요 묶음. */
    const [check] = bundles.state();
    expect(check?.status).toBe('repo-check-needed');
    executor.script({ outcome: { type: 'completed', output: draftOutput(web) } });

    await drafts.regenerateWithRepos(check!.id, [web, api]);
    await settle();

    expect(executor.requests.map((request) => request.kind)).toEqual(['selection', 'draft']);
    expect(executor.requests[1]?.readRoots).toEqual([web, api]);
    expect(bundles.get(check!.id)).toMatchObject({ status: 'ready', repoCheck: null, draft: { repositories: [web, api], autoSelection: null } });
  });

  it('고른 저장소 폴더가 실행 직전에 사라졌으면 실행하지 않고 저장소 확인 필요가 된다', async () => {
    const { executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 준비됨 묶음. */
    const [ready] = bundles.state();
    /** 사라진 폴더. */
    const gone = join(workDir, 'gone');

    await drafts.regenerateWithRepos(ready!.id, [repos.a, gone]);
    await settle();

    expect(executor.requests).toHaveLength(1);
    expect(bundles.get(ready!.id)).toMatchObject({ status: 'repo-check-needed', repoCheck: { kind: 'missing-folders', paths: [gone] } });
  });

  it('생성 중이거나 처리됨 묶음, 빈 구성은 받지 않는다', async () => {
    const { executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 준비됨 묶음. */
    const [ready] = bundles.state();

    await drafts.regenerateWithRepos(ready!.id, []);
    await bundles.ignore(ready!.id);
    await drafts.regenerateWithRepos(ready!.id, [repos.b]);
    await settle();

    expect(bundles.get(ready!.id)).toMatchObject({ status: 'ignored', userRepos: null });
    expect(executor.requests).toHaveLength(1);
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

  it('준비됨 묶음을 다시 만들면 감지해서 기다리는 묶음보다 앞에 들어가, 실행 중인 실행이 끝나면 바로 돈다', async () => {
    const { flow, executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 준비됨 묶음. */
    const [ready] = bundles.state();
    expect(ready?.status).toBe('ready');
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(
      addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'),
      addThreadMention(flow, '103', '702', '세 번째 질문', '20261020085700'),
    );

    await drafts.regenerate(ready!.id, { path: 'directive', directive: '더 짧게 써 주세요.' });
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

    await restartApp();
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
    expect(real.problems.current()?.problem).toEqual({ cause: 'agent', agent: 'claude-code', reason: 'check-failed' });
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
    expect(real.problems.current()?.problem).toEqual({ cause: 'agent', agent: 'claude-code', reason: 'not-logged-in' });
    expect(real.notifier.sent).toHaveLength(1);

    real.cli.loggedIn = true;
    await real.connection.check();
    await settle();

    expect(bundles.get(bundle!.id)?.status).toBe('ready');
    expect(bundles.get(bundle!.id)?.runs.map((run) => run.result)).toEqual(['not-logged-in', 'succeeded']);
    expect(real.problems.current()).toBeNull();
  });
});

/**
 * 가짜 프로세스 실행기 위에 macOS의 실제 연결 확인 묶음(Claude Code와 Codex)과 기본 에이전트·모델 선택을 만든다.
 * 기본 에이전트로 Codex와 그 모델을 골라 둔 설정이다. Codex는 Homebrew처럼 버전 폴더의 실제 파일을 링크로 가리킨다.
 * Codex 선택 실행은 입력의 첫 후보 저장소를 고르고, 초안 실행은 첫 루트(-C)를 근거의 저장소로 드는 초안을 낸다.
 */
async function realCodexAgents(tempRoot: string) {
  /** Codex 실제 파일. */
  const codexReal = join(tempRoot, 'Caskroom', 'codex', '0.163.0', 'bin', 'codex');
  mkdirSync(dirname(codexReal), { recursive: true });
  writeFileSync(codexReal, '#!/bin/sh\n');
  chmodSync(codexReal, 0o755);
  /** 설정에 저장한 Codex 경로(링크). */
  const codexLink = join(tempRoot, 'codex-link');
  symlinkSync(codexReal, codexLink);
  /** 실행기가 띄우는 Codex 실제 경로. macOS 임시 폴더는 링크 아래에 있어 실제 경로로 잡는다. */
  const codexPath = realpathSync(codexReal);

  const runner = new FakeProcessRunner();
  runner.respond(FAKE_CLI, ['--version'], exited(0, '2.1.303 (Claude Code)\n'));
  runner.respond(FAKE_CLI, ['--restricted', 'auth', 'status'], exited(0, fakeClaudeAuthStatus.loggedIn));
  runner.respondWhen((request) => request.command === FAKE_CLI && request.args[0] === '-p', exited(0, claudeSuccessStream({ ok: true })));
  runner.respond(codexLink, ['--version'], exited(0, 'codex-cli 0.163.0\n'));
  runner.respond(codexLink, ['login', 'status'], exited(0, '', fakeCodexLoginStatus.chatgpt));
  runner.respond(codexLink, ['debug', 'models'], exited(0, codexModelsOutput([{ slug: 'gpt-fake-pro', display_name: 'GPT-Fake-Pro', visibility: 'list' }])));
  runner.respondWhen(
    (request) => request.command === codexPath && request.args[0] === 'exec',
    (request) => {
      if (request.stdin === CHECK_RUN_INPUT) return exited(0, codexSuccessStream({ ok: true }));
      /** 선택 실행 입력의 첫 후보 저장소. */
      const candidate = /# 후보 저장소\n- (.+)\n/.exec(request.stdin ?? '')?.[1];
      if (candidate) return exited(0, codexSuccessStream({ verdict: 'chosen', repositories: [candidate], reason: '가짜 이유' }));
      return exited(0, codexSuccessStream(draftOutput(request.cwd)));
    },
  );
  const clock = new FakeClock(NOW);
  const logger = createLogger([{ write: () => {} }], clock);
  const problems = new GlobalProblems({ notifier: new RecordingNotifier(), clock, logger, notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }) });
  const settingsStore = new MemorySettingsStore({
    detectionStarted: true,
    agentCliPaths: { 'claude-code': FAKE_CLI, codex: codexLink },
    defaultAgent: 'codex',
    agentModels: { codex: 'gpt-fake-pro' },
  });
  const connections = new AgentConnections({
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
    isExecutableFile: async (filePath) => filePath === FAKE_CLI || filePath === codexLink,
  });
  const preferences = new AgentPreferences({
    settingsStore,
    logger,
    connectedAgents: () => connections.connectedAgents(),
    listedModels: (agent) => connections.models(agent),
  });
  await preferences.load();
  /** 앱처럼 기본 에이전트의 연결로 실행하고, 연결이나 선택이 바뀌면 대기열에 알리는 에이전트. */
  const queueAgent: Pick<DraftQueueOptions, 'agent' | 'onAgentChange'> = {
    agent: () => draftAgentFrom(preferences.state(), connections.all),
    onAgentChange: (listener) => {
      /** 끊을 구독. */
      const unsubscribes = [connections.onChange(listener), preferences.onChange(listener)];
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
  };
  /** Codex로 띄운 선택·초안 실행 요청. 작동 확인은 뺀다. */
  const codexRuns = () => runner.requests.filter((request) => request.command === codexPath && request.args[0] === 'exec' && request.stdin !== CHECK_RUN_INPUT);
  /** Claude Code로 띄운 선택·초안 실행 요청. 작동 확인은 뺀다. */
  const claudeRuns = () => runner.requests.filter((request) => request.command === FAKE_CLI && request.args[0] === '-p' && request.stdin !== CHECK_RUN_INPUT);
  return { connections, preferences, queueAgent, codexPath, codexRuns, claudeRuns };
}

describe('대기열: Codex 실행기', () => {
  it('기본 에이전트로 Codex를 고르면 선택 실행과 초안 실행이 Codex 권한 프로필 묶음과 고른 모델로 돌고, 실행 기록에 Codex와 확인한 CLI 버전을 남긴다', async () => {
    const real = await realCodexAgents(workDir);
    await real.connections.checkAll();
    expect(real.preferences.state()).toMatchObject({ connectedAgents: ['claude-code', 'codex'], defaultAgent: 'codex' });
    const { bundles, settingsStore, poll } = await setup(real.queueAgent);
    /** 저장소가 둘인 작업 폴더. 첫 후보(api)를 고른다. */
    const work = makeWorkFolder('work', ['api', 'web']);
    const [api] = work.repos as [string];
    mkdirSync(join(api, 'src/main/resources'), { recursive: true });
    writeFileSync(join(api, 'src/main/resources/application-prod.yml'), 'retry: 5\n'.repeat(100));
    settingsStore.settings.workFolders = [work.folder];

    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));

    /** Codex 선택 실행과 초안 실행 요청. */
    const [selection, draft] = real.codexRuns();
    expect(real.codexRuns()).toHaveLength(2);
    expect(real.claudeRuns()).toEqual([]);
    // 선택 실행은 작업 폴더(git 저장소가 아님)에서 돌아 --skip-git-repo-check를 붙이고, 초안 실행은 고른 저장소에서 붙이지 않는다.
    expect(selection?.args.slice(7, 10)).toEqual(['-C', work.folder, '--skip-git-repo-check']);
    expect(draft?.args.slice(7, 9)).toEqual(['-C', api]);
    expect(draft?.args).not.toContain('--skip-git-repo-check');
    for (const request of [selection, draft]) {
      expect(request?.args).toContain('default_permissions="stardraft"');
      expect(request?.args.find((arg) => arg.startsWith('permissions.stardraft.filesystem='))).toContain(`"${real.codexPath}"="read"`);
      expect(request?.args.slice(-3)).toEqual(['-m', 'gpt-fake-pro', '-']);
    }
    expect(bundles.state()[0]).toMatchObject({ status: 'ready', draft: { repositories: [api] } });
    expect(bundles.state()[0]?.runs.map((run) => [run.kind, run.agent, run.cliVersion, run.model, run.result])).toEqual([
      ['selection', 'codex', '0.163.0', 'gpt-fake-pro', 'succeeded'],
      ['draft', 'codex', '0.163.0', 'gpt-fake-pro', 'succeeded'],
    ]);
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

describe('재생성: 입력', () => {
  it('다시 만들기는 직전 초안과 비교 기준을 바로 지우고, Flow 내용을 새로 조회해 처음과 같은 구성의 입력으로 새 초안 실행을 돌린다', async () => {
    const { flow, executor, drafts, bundles, repos, poll, setConnected } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 준비됨 묶음. */
    const [ready] = bundles.state();
    expect(ready?.context).not.toBeNull();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    // 처음 초안 실행 뒤에 생긴, 멘션이 아닌 새 글. 재생성은 Flow 내용을 새로 조회한다.
    flow.addReply(POST_ID, '700', { replyId: '802', contents: '참고로 테스트 환경도 궁금합니다.', registerId: OTHER_SENDER, registeredDateTime: '20261020085800' });
    // 실행을 시작하기 전의 묶음을 보려고 에이전트 연결을 잠시 끊는다.
    setConnected(false);

    await drafts.regenerate(ready!.id, { path: 'again' });
    await settle();

    expect(bundles.get(ready!.id)).toMatchObject({ status: 'generating', draft: null, editedText: null, context: null });

    setConnected(true);
    await settle();

    /** 처음 초안 실행과 다시 만든 초안 실행. */
    const [first, second] = executor.requests;
    expect(executor.requests.map((request) => request.kind)).toEqual(['draft', 'draft']);
    expect(second?.readRoots).toEqual(first?.readRoots);
    expect(second?.instructions).toBe(first?.instructions);
    // 읽을 저장소와 멘션은 처음과 같고, 맥락은 새로 조회한 것이다. 직전 결과는 넘기지 않는다.
    expect(second?.input.slice(0, second.input.indexOf('## 맥락'))).toBe(first?.input.slice(0, first.input.indexOf('## 맥락')));
    expect(first?.input).not.toContain('참고로 테스트 환경도 궁금합니다.');
    expect(second?.input).toContain('참고로 테스트 환경도 궁금합니다.');
    expect(second?.input).not.toContain('다섯 번까지 다시 시도합니다');
    expect(bundles.get(ready!.id)).toMatchObject({ status: 'ready', draft: { repositories: [repos.a, repos.b] } });
  });
  it('지시를 덧붙여 다시 만들면 처음 입력에 직전 결과(요구·초안·근거)와 지금까지 덧붙인 지시 전부를 더해 넘긴다. 편집한 초안은 넘기지 않는다', async () => {
    const { executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 준비됨 묶음. */
    const [ready] = bundles.state();
    await bundles.editDraft(ready!.id, '사용자가 고쳐 쓴 초안입니다.');
    /** 두 번째 초안. 첫 지시를 반영해 짧아졌다. */
    const shorter = { ...draftOutput(repos.a), paragraphs: [{ sentences: [{ text: '다섯 번 다시 시도합니다.', evidence: [1] }] }] };
    executor.script({ outcome: { type: 'completed', output: shorter } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });

    await drafts.regenerate(ready!.id, { path: 'directive', directive: '  더 짧게 써 주세요.  ' });
    await settle();
    await drafts.regenerate(ready!.id, { path: 'directive', directive: '테스트 환경 이야기는 빼 주세요.' });
    await settle();

    /** 처음 실행, 첫 지시를 덧붙인 실행, 둘째 지시를 덧붙인 실행. */
    const [first, second, third] = executor.requests;
    expect(executor.requests.map((request) => request.kind)).toEqual(['draft', 'draft', 'draft']);
    expect(second?.readRoots).toEqual(first?.readRoots);
    // 첫 재생성: 첫 초안의 결과와 첫 지시.
    expect(second?.input).toContain(
      [
        '# 직전 결과',
        '직전 초안 실행이 낸 요구·초안·근거입니다. "# 덧붙인 지시"를 모두 반영해 이 결과를 고쳐 씁니다.',
        '## 요구',
        '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.',
        '요약: 재시도 횟수',
        '## 초안',
        '실제 서비스에서는 다섯 번까지 다시 시도합니다. [근거 1] 테스트 환경은 세 번으로 보입니다. [근거 없음]',
        '## 근거',
        `1. 운영 설정에서 다시 시도하는 횟수를 5로 정해 둡니다. (${repos.a} · src/main/resources/application-prod.yml · 88-88번째 줄)`,
        '',
        '# 덧붙인 지시',
        '1. 더 짧게 써 주세요.',
        '',
        '# 데이터',
      ].join('\n'),
    );
    // 둘째 재생성: 직전(둘째) 초안의 결과와 지금까지의 지시 전부.
    expect(third?.input).toContain('## 초안\n다섯 번 다시 시도합니다. [근거 1]\n');
    expect(third?.input).toContain('# 덧붙인 지시\n1. 더 짧게 써 주세요.\n2. 테스트 환경 이야기는 빼 주세요.\n');
    for (const request of [second, third]) {
      expect(request?.input).not.toContain('사용자가 고쳐 쓴 초안입니다.');
      // 읽을 저장소와 데이터 구획은 처음 입력과 같다.
      expect(request?.input.startsWith(first!.input.slice(0, first!.input.indexOf('\n# 데이터\n')).replace(/\n+$/, ''))).toBe(true);
      expect(request?.input.slice(request.input.indexOf('\n# 데이터\n'))).toBe(first?.input.slice(first.input.indexOf('\n# 데이터\n')));
    }
    expect(first?.input).not.toContain('# 직전 결과');
    expect(bundles.get(ready!.id)).toMatchObject({ status: 'ready', editedText: null, directives: ['더 짧게 써 주세요.', '테스트 환경 이야기는 빼 주세요.'] });
  });

  it('다른 저장소로 다시 만들면 그때까지의 지시와 고친 요구를 지우고, 처음 입력에 읽을 저장소만 바꿔 넘긴다', async () => {
    const { executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.b) } });
    await poll(alarm('101'));
    /** 준비됨 묶음. */
    const [ready] = bundles.state();
    await drafts.regenerate(ready!.id, { path: 'directive', directive: '더 짧게 써 주세요.' });
    await settle();

    await drafts.regenerateWithRepos(ready!.id, [repos.b]);
    await settle();

    expect(executor.requests.at(-1)?.input).not.toContain('# 덧붙인 지시');
    expect(executor.requests.at(-1)?.input).not.toContain('# 직전 결과');
    expect(bundles.get(ready!.id)).toMatchObject({ status: 'ready', directives: [], fixedRequirement: null, regeneration: null });
  });

  it('빈 지시나 빈 요구는 받지 않고, 준비됨이 아닌 묶음은 다시 만들지 않는다', async () => {
    const { executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'timed-out' } });
    await poll(alarm('101'));
    /** 실패 묶음. */
    const [failed] = bundles.state();

    await drafts.regenerate(failed!.id, { path: 'again' });
    await settle();
    expect(bundles.get(failed!.id)?.status).toBe('failed');

    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await bundles.retry(failed!.id);
    await settle();
    await drafts.regenerate(failed!.id, { path: 'directive', directive: '   ' });
    await drafts.regenerate(failed!.id, { path: 'requirement', requirement: '' });
    await settle();

    expect(bundles.get(failed!.id)).toMatchObject({ status: 'ready', directives: [], fixedRequirement: null });
    expect(executor.requests).toHaveLength(2);
  });
  it('요구를 고치면 처음 입력에 고친 요구만 더해 넘기고 직전 결과는 넘기지 않는다. 에이전트가 다른 요구를 내도 고친 요구로 덮어쓰고 요약은 새로 받은 것을 쓰며, 그때까지의 지시는 지운다', async () => {
    const { executor, drafts, bundles, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 준비됨 묶음. */
    const [ready] = bundles.state();
    await drafts.regenerate(ready!.id, { path: 'directive', directive: '더 짧게 써 주세요.' });
    await settle();
    /** 고친 요구를 다시 해석해 바꿔 낸 출력. */
    const reinterpreted = { ...draftOutput(repos.a), requirement: { text: '재시도 정책 전체를 알고 싶다.', summary: '운영 재시도 횟수' } };
    executor.script({ outcome: { type: 'completed', output: reinterpreted } });

    await drafts.regenerate(ready!.id, { path: 'requirement', requirement: '  운영 환경에서\n재시도 횟수만 알고 싶다.  ' });
    await settle();

    /** 처음 실행과 요구를 고친 실행. */
    const [first, , fixed] = executor.requests;
    expect(fixed?.input).toContain('# 고친 요구\n사용자가 요구를 아래처럼 고쳤습니다. 다시 해석하지 않고 requirement.text에 그대로 쓰고, summary만 새로 씁니다.\n운영 환경에서 재시도 횟수만 알고 싶다.\n\n# 데이터\n');
    expect(fixed?.input).not.toContain('# 직전 결과');
    expect(fixed?.input).not.toContain('# 덧붙인 지시');
    expect(fixed?.input).not.toContain('다섯 번까지 다시 시도합니다');
    expect(fixed?.input.slice(fixed.input.indexOf('\n# 데이터\n'))).toBe(first?.input.slice(first.input.indexOf('\n# 데이터\n')));
    expect(fixed?.instructions).toContain('"# 고친 요구"가 있으면');

    /** 요구를 고쳐 만든 묶음. */
    const regenerated = bundles.get(ready!.id);
    expect(regenerated).toMatchObject({
      status: 'ready',
      directives: [],
      fixedRequirement: '운영 환경에서 재시도 횟수만 알고 싶다.',
      regeneration: null,
      draft: { requirement: { text: '운영 환경에서 재시도 횟수만 알고 싶다.', summary: '운영 재시도 횟수' } },
    });
    expect(regenerated?.runs.at(-1)?.fixes).toContain('에이전트가 낸 요구를 사용자가 고친 요구로 덮어씀');
  });
  it('자동으로 저장소를 고른 묶음은 다시 만들기, 지시를 덧붙여, 요구 고치기에서 선택 실행을 다시 돌리지 않고 고른 저장소로 초안 실행만 돌린다', async () => {
    const { executor, drafts, bundles, settingsStore, poll } = await setup();
    /** 저장소가 둘인 작업 폴더. */
    const work = makeWorkFolder('work', ['api', 'web']);
    /** 후보 저장소. */
    const [api, web] = work.repos as [string, string];
    settingsStore.settings.workFolders = [work.folder];
    /** 선택 실행이 적은 이유. */
    const reason = '화면 설정을 묻고 있어 웹 화면 저장소를 골랐습니다.';
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [web], reason } } });
    for (let run = 0; run < 4; run += 1) executor.script({ outcome: { type: 'completed', output: draftOutput(web) } });
    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));
    /** 자동 선택으로 만든 준비됨 묶음. */
    const [ready] = bundles.state();

    await drafts.regenerate(ready!.id, { path: 'again' });
    await settle();
    await drafts.regenerate(ready!.id, { path: 'directive', directive: '더 짧게 써 주세요.' });
    await settle();
    await drafts.regenerate(ready!.id, { path: 'requirement', requirement: '화면의 재시도 횟수만 알고 싶다.' });
    await settle();

    expect(executor.requests.map((request) => request.kind)).toEqual(['selection', 'draft', 'draft', 'draft', 'draft']);
    for (const request of executor.requests.slice(1)) expect(request.readRoots).toEqual([web]);
    // 저장소 영역은 여전히 자동으로 고른 이유를 보인다.
    expect(bundles.get(ready!.id)).toMatchObject({ status: 'ready', draft: { repositories: [web], autoSelection: { kind: 'chosen', reason } } });
    expect(api).not.toBe(web);
  });

  it('자동으로 고른 저장소 폴더가 사라졌으면 다시 만들 때 자동 선택을 다시 한다', async () => {
    const { executor, drafts, bundles, settingsStore, poll } = await setup();
    /** 저장소가 둘인 작업 폴더. */
    const work = makeWorkFolder('work', ['api', 'web']);
    /** 후보 저장소. */
    const [api, web] = work.repos as [string, string];
    settingsStore.settings.workFolders = [work.folder];
    executor.script({ outcome: { type: 'completed', output: { verdict: 'chosen', repositories: [web], reason: '웹입니다.' } } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(web) } });
    await poll(alarm('101', { projectId: UNMAPPED_PROJECT_ID }));
    /** 자동 선택으로 만든 준비됨 묶음. */
    const [ready] = bundles.state();
    rmSync(web, { recursive: true });
    // 저장소가 하나 남아 선택 실행 없이 그 저장소를 쓴다.
    executor.script({ outcome: { type: 'completed', output: draftOutput(api) } });

    await drafts.regenerate(ready!.id, { path: 'again' });
    await settle();

    expect(executor.requests.map((request) => request.kind)).toEqual(['selection', 'draft', 'draft']);
    expect(executor.requests[2]?.readRoots).toEqual([api]);
    expect(bundles.get(ready!.id)).toMatchObject({ status: 'ready', draft: { repositories: [api], autoSelection: { kind: 'single-candidate' } } });
  });
});

describe('재생성: 준비됨·실패 묶음에 새 멘션이 올 때', () => {
  /** 처음 초안이 준비된 묶음과, 같은 댓글 스레드에 새 멘션을 보내는 함수. 새 멘션은 다른 송신자가 보낸 대댓글이다. */
  async function readyWithNewMention() {
    const context = await setup();
    context.executor.script({ outcome: { type: 'completed', output: draftOutput(context.repos.a) } });
    await context.poll(alarm('101'));
    /** 준비됨 묶음의 ID. */
    const bundleId = context.bundles.state()[0]!.id;
    /** 같은 댓글 스레드에 새 멘션을 보내고 한 번 조회한다. */
    const sendNewMention = async () => {
      context.flow.addReply(POST_ID, '700', {
        replyId: '801',
        contents: `${MY_MARKUP} 테스트 환경도 알려 주세요`,
        registerId: OTHER_SENDER,
        registerName: '다른 사람',
        registeredDateTime: '20261020085500',
      });
      await context.poll(alarm('102', { replyId: '801', registerId: OTHER_SENDER, registerName: '다른 사람', registeredDateTime: '20261020085500' }));
    };
    return { ...context, bundleId, sendNewMention };
  }

  it('초안·요구·지시를 손대지 않았으면 합치고 자동으로 다시 만든다. 받는 사람을 뺀 것은 손댐이 아니라 뺀 사람은 그대로 빠져 있다', async () => {
    const { executor, bundles, bundleId, repos, sendNewMention } = await readyWithNewMention();
    await bundles.removeRecipient(bundleId, 0, '보낸 사람');
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.b) } });

    await sendNewMention();

    /** 자동으로 다시 만든 묶음. */
    const regenerated = bundles.get(bundleId);
    expect(executor.requests).toHaveLength(2);
    expect(executor.requests[1]?.input).toContain('## 멘션 2건 (시간순, 마지막이 답할 대상)');
    expect(executor.requests[1]?.input).toContain('2. [답할 대상] 다른 사람');
    expect(regenerated).toMatchObject({ status: 'ready', newMentionCount: 0, draft: { evidence: [{ repository: repos.b }] } });
    // 받는 사람에서 뺀 송신자는 그대로 빠져 있다.
    expect(regenerated?.removedRecipients).toEqual([SENDER]);
  });

  it('새 멘션의 송신자를 전에 받는 사람에서 뺐더라도, 합칠 때 다시 더한다', async () => {
    const { executor, bundles, bundleId, flow, repos, poll } = await readyWithNewMention();
    await bundles.removeRecipient(bundleId, 0, '보낸 사람');
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    // 뺀 송신자가 같은 스레드에서 다시 멘션한다.
    flow.addReply(POST_ID, '700', { replyId: '803', contents: `${MY_MARKUP} 다시 여쭙니다`, registerId: SENDER, registeredDateTime: '20261020085600' });

    await poll(alarm('103', { replyId: '803', registeredDateTime: '20261020085600' }));

    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', removedRecipients: [] });
    expect(executor.requests).toHaveLength(2);
  });

  it.each([
    ['초안을 편집했으면', 'edited'],
    ['지시를 덧붙였으면', 'directive'],
    ['요구를 고쳤으면', 'requirement'],
  ] as const)('%s 합치기만 하고 "새 멘션 1건"을 세며 초안을 그대로 둔다. [다시 만들기]를 누르면 새 멘션까지 넣어 다시 만든다', async (_, touch) => {
    const { executor, drafts, bundles, bundleId, repos, sendNewMention } = await readyWithNewMention();
    if (touch === 'edited') {
      await bundles.editDraft(bundleId, '사용자가 고쳐 쓴 초안입니다.');
    } else {
      executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
      await drafts.regenerate(bundleId, touch === 'directive' ? { path: 'directive', directive: '더 짧게' } : { path: 'requirement', requirement: '횟수만 알고 싶다.' });
      await settle();
    }
    /** 손댄 뒤의 묶음. */
    const touched = bundles.get(bundleId)!;
    /** 손댄 뒤까지의 실행 수. */
    const runsBefore = executor.requests.length;

    await sendNewMention();

    /** 합치기만 한 묶음. */
    const merged = bundles.get(bundleId);
    expect(executor.requests).toHaveLength(runsBefore);
    expect(merged).toMatchObject({ status: 'ready', newMentionCount: 1, draft: touched.draft, editedText: touched.editedText, context: touched.context });
    expect(merged?.mentions).toHaveLength(2);

    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await drafts.regenerate(bundleId, { path: 'again' });
    await settle();

    expect(executor.requests).toHaveLength(runsBefore + 1);
    expect(executor.requests.at(-1)?.input).toContain('## 멘션 2건 (시간순, 마지막이 답할 대상)');
    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', newMentionCount: 0, editedText: null });
  });

  it('실패 묶음에 새 멘션이 오면 합치고 자동으로 다시 시도한다', async () => {
    const { executor, bundles, flow, repos, poll } = await setup();
    executor.script({ outcome: { type: 'timed-out' } });
    await poll(alarm('101'));
    /** 실패 묶음. */
    const [failed] = bundles.state();
    expect(failed?.status).toBe('failed');
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registeredDateTime: '20261020085500' });

    await poll(alarm('102', { replyId: '801', registeredDateTime: '20261020085500' }));

    expect(executor.requests).toHaveLength(2);
    expect(executor.requests[1]?.input).toContain('## 멘션 2건 (시간순, 마지막이 답할 대상)');
    expect(bundles.get(failed!.id)).toMatchObject({ status: 'ready', failure: null, newMentionCount: 0 });
  });

  it('지시를 덧붙여 다시 만들다 실패한 묶음에 새 멘션이 오면, 같은 재생성 입력에 새 멘션을 넣어 다시 시도한다', async () => {
    const { executor, drafts, bundles, flow, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'timed-out' } });
    await poll(alarm('101'));
    /** 준비됨 묶음. */
    const [ready] = bundles.state();
    await drafts.regenerate(ready!.id, { path: 'directive', directive: '더 짧게' });
    await settle();
    expect(bundles.get(ready!.id)?.status).toBe('failed');
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registeredDateTime: '20261020085500' });

    await poll(alarm('102', { replyId: '801', registeredDateTime: '20261020085500' }));

    /** 다시 시도한 실행의 입력. */
    const input = executor.requests.at(-1)?.input ?? '';
    expect(executor.requests).toHaveLength(3);
    expect(input).toContain('# 직전 결과');
    expect(input).toContain('# 덧붙인 지시\n1. 더 짧게\n');
    expect(input).toContain('## 멘션 2건 (시간순, 마지막이 답할 대상)');
    expect(bundles.get(ready!.id)).toMatchObject({ status: 'ready', regeneration: null, directives: ['더 짧게'] });
  });
});

describe('설정: 비밀 파일 패턴 추가의 반영', () => {
  /** 테스트의 묶음과 초안 대기열에 이어 붙인 설정 "초안" 칸. 앱처럼 패턴을 추가하면 실행 재시작과 초안 재검사를 맡긴다. */
  async function draftSettingsOf({ settingsStore, drafts, bundles }: Awaited<ReturnType<typeof setup>>) {
    /** 설정 "초안" 칸. */
    const draftSettings = new DraftSettings({ settingsStore, logger: createLogger([{ write: () => {} }], new FakeClock(NOW)), drafts, bundles });
    await draftSettings.load();
    return draftSettings;
  }

  it('패턴을 추가하면 실행 중인 실행을 취소해 대기열 맨 앞에 다시 넣고, 새 패턴으로 처음부터 다시 만든다', async () => {
    /** 가짜 포트로 만든 감지·묶음·대기열. */
    const context = await setup();
    const { flow, executor, bundles, settingsStore, repos, poll } = context;
    executor.script({ progress: [{ step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 }], outcome: 'wait-for-abort' });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'), addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'));
    /** 실행 중인 묶음과 기다리는 묶음. */
    const [first, second] = bundles.state();
    /** 설정 "초안" 칸. */
    const draftSettings = await draftSettingsOf(context);

    await draftSettings.addSecretPattern('  *.vault.yml ');
    await settle();

    expect(settingsStore.settings.extraSecretPatterns).toEqual(['*.vault.yml']);
    expect(executor.requests[0]?.signal.aborted).toBe(true);
    expect(executor.requests.map(targetMentionOf)).toEqual(['@테스트 사용자 재시도는 몇 번 하나요?', '@테스트 사용자 재시도는 몇 번 하나요?', '@테스트 사용자 두 번째 질문']);
    expect(executor.requests.map((request) => request.secretPatterns)).toEqual([[], ['*.vault.yml'], ['*.vault.yml']]);
    expect(bundles.get(first!.id)).toMatchObject({ status: 'ready', failure: null });
    expect(bundles.get(first!.id)?.runs.map((run) => run.result)).toEqual(['secret-patterns-changed', 'succeeded']);
    expect(bundles.get(second!.id)?.status).toBe('ready');
  });

  it('패턴을 추가하면 게시하지 않은 초안의 근거 경로를 다시 검사해, 걸린 초안은 결과를 버리고 "비밀 파일을 근거로 듦" 실패로 둔다. 카운트다운 중이면 게시하지 않는다', async () => {
    /** 가짜 포트로 만든 감지·묶음·대기열. */
    const context = await setup();
    const { flow, executor, bundles, clock, repos, poll } = context;
    /** 새 패턴에 걸리지 않는 근거를 든 출력. */
    const safeOutput = draftOutput(repos.a);
    safeOutput.evidence[0]!.path = 'src/main/kotlin/RetryConfig.kt';
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: safeOutput } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(
      alarm('101'),
      addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'),
      addThreadMention(flow, '103', '702', '세 번째 질문', '20261020085700'),
    );
    /** 카운트다운 중으로 둘 묶음, 걸리지 않는 묶음, 무시한 묶음. */
    const [counting, safe, ignored] = bundles.state();
    expect([counting?.status, safe?.status, ignored?.status]).toEqual(['ready', 'ready', 'ready']);
    await bundles.editDraft(counting!.id, '고친 초안입니다.');
    await bundles.ignore(ignored!.id);
    /** 버리는 진단 로그. */
    const logger = createLogger([{ write: () => {} }], clock);
    /** [게시]의 카운트다운. */
    const posting = new Posting({ bundles, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }), myUserId: () => ME, clock, logger });
    /** 게시를 멈춘 까닭. */
    const stops: unknown[] = [];
    bundles.onPostStopped((bundleId, stop) => stops.push({ bundleId, stop }));
    await posting.post(counting!.id);
    await settle();
    expect(bundles.get(counting!.id)?.status).toBe('posting');
    /** 설정 "초안" 칸. */
    const draftSettings = await draftSettingsOf(context);

    await draftSettings.addSecretPattern('application-prod.yml');
    clock.advance(10_000);
    await settle();

    expect(bundles.get(counting!.id)).toMatchObject({
      status: 'failed',
      failure: { reason: 'secret-evidence' },
      draft: null,
      editedText: null,
      posting: null,
    });
    expect(stops).toEqual([{ bundleId: counting!.id, stop: { kind: 'secret-evidence' } }]);
    expect(posting.countdownEndsAt(counting!.id)).toBeNull();
    expect(flow.requests.filter((request) => request.startsWith('POST'))).toEqual([]);
    expect(bundles.get(safe!.id)).toMatchObject({ status: 'ready', draft: { evidence: [{ path: 'src/main/kotlin/RetryConfig.kt' }] } });
    expect(bundles.get(ignored!.id)).toMatchObject({ status: 'ignored', draft: null });
    // 이미 만든 초안은 다시 만들지 않는다.
    expect(executor.requests).toHaveLength(3);
  });

  it('실행이 끝나 초안을 저장하는 중에 패턴을 추가해도, 저장이 끝난 뒤 그 초안까지 다시 검사해 걸리면 결과를 버린다', async () => {
    /** 가짜 포트로 만든 감지·묶음·대기열. */
    const context = await setup();
    const { executor, bundles, stateStore, repos, poll } = context;
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    await poll(alarm('101'));
    /** 생성 중인 묶음. */
    const [bundle] = bundles.state();
    /** 설정 "초안" 칸. */
    const draftSettings = await draftSettingsOf(context);
    // 실행이 끝나 초안을 저장하는 순간을 붙잡는다. 실행을 끊기에는 이미 늦은 때다.
    stateStore.holdNextSave();
    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();

    /** 패턴 추가. 붙잡은 저장이 끝나기를 기다린다. */
    const adding = draftSettings.addSecretPattern('application-prod.yml');
    await settle();
    stateStore.releaseSave();
    await adding;
    await settle();

    expect(bundles.get(bundle!.id)).toMatchObject({ status: 'failed', failure: { reason: 'secret-evidence' }, draft: null });
  });
});


describe('담당 업무 최초 초안', () => {
  it('기준 이후 생성 시 배정된 업무 본문을 검토하고 작성자 멘션을 뺀 편집본을 승인 후 게시한다', async () => {
    /** 실제 서비스와 가짜 외부 포트를 연결한 검증 환경. */
    const { flow, clock, stateStore, bundles, executor, repos, notifier } = await setup();
    /** 담당 업무 감지. */
    const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
    await detection.checkNow();
    clock.advance(60_000);
    flow.addPost({ postId: 'assignment-post', title: '최신 업무 제목', registerId: SENDER, registerName: '업무 작성자',
      registeredDateTime: '20261020090100', editedDateTime: '20261020090100',
      textComponents: [{ contents: '운영 재시도 횟수를 확인해주세요.', mentions: [] }],
      tasks: [{ taskId: 'task-1', workerIds: [ME, 'other@example.test'], completion: 'active' }] });
    flow.addWorkerAlarm(alarm('201', { postId: 'assignment-post', remarkId: '-1', registeredDateTime: '20261020090100' }));
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await detection.checkNow();
    await settle();
    /** 생성된 담당 업무 초안. */
    const bundle = bundles.state()[0]!;
    expect(bundle.status).toBe('ready');
    expect(notifier.sent.at(-1)?.body).toBe('담당 업무 초안이 준비됐습니다.');
    expect(bundle.mentions).toEqual([]);
    expect(bundle.assignment?.taskId).toBe('task-1');
    expect(executor.requests[0]?.input).toContain('담당 업무');
    expect(executor.requests[0]?.input).toContain('최신 업무 제목');
    expect(executor.requests[0]?.input).toContain('운영 재시도 횟수를 확인해주세요.');
    expect(bundleRecipients(bundle)).toEqual([{ id: SENDER, name: '업무 작성자' }]);
    expect(flow.writes).toEqual([]);
    await bundles.editDraft(bundle.id, '확인한 결과입니다.');
    await bundles.removeRecipient(bundle.id, 0, '업무 작성자');
    /** 승인 후 게시 서비스. */
    const posting = new Posting({ bundles, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }), myUserId: () => ME,
      clock, logger: createLogger([{ write: () => {} }], clock) });
    await posting.post(bundle.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(flow.writes).toEqual([{ request: 'POST /user/comments/assignment-post', contents: '확인한 결과입니다.' }]);
    await detection.checkNow();
    expect(bundles.state()).toHaveLength(1);
  });
});

it('담당 업무의 조회 실패와 담당자 누락을 보류하고 회복하면 한 번만 초안을 만든다', async () => {
  /** 서비스 검증 환경. */
  const { flow, clock, stateStore, bundles, executor, repos } = await setup();
  /** 감지 서비스. */
  const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
  flow.failOn('GET /user/alarms/worker', { kind: 'network' }, 1);
  await detection.checkNow();
  expect((await stateStore.getAssignmentState())?.baselineReady).toBe(false);
  clock.advance(60_000);
  flow.addWorkerAlarm(alarm('201', { postId: 'recover', remarkId: '-1', registeredDateTime: '20261020090100' }));
  /** 나중에 담당자 필드가 회복될 업무. */
  const post = { postId: 'recover', title: '복구할 업무', registerId: SENDER, registerName: '작성자', registeredDateTime: '20261020090100', editedDateTime: '20261020090100', textComponents: [{ contents: '확인해주세요.', mentions: [] }] };
  flow.addPost({ ...post, tasks: [{ taskId: 'recover-task', workerIds: null, completion: 'active' }] });
  flow.failOn('GET /user/posts/recover', { kind: 'http', status: 500 }, 1);
  await detection.checkNow();
  await detection.checkNow();
  expect(bundles.state()).toEqual([]);
  flow.addPost({ ...post, tasks: [{ taskId: 'recover-task', workerIds: [ME], completion: 'active' }] });
  executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
  await detection.checkNow();
  await settle();
  expect(bundles.state().map((item) => item.status)).toEqual(['ready']);
  /** 앱 재시작 뒤 반복 후보도 기존 묶음을 재사용한다. */
  const restarted = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
  flow.addWorkerAlarm(alarm('202', { postId: 'recover', remarkId: '-1', registeredDateTime: '20261020090100' }));
  await restarted.checkNow();
  expect(bundles.state()).toHaveLength(1);
});

it.each(['existing', 'self', 'completed', 'unknown', 'unassigned', 'comment'] as const)('담당 업무 제외 또는 보류: %s', async (kind) => {
  /** 서비스 검증 환경. */
  const { flow, clock, stateStore, bundles, executor } = await setup();
  /** 감지 서비스. */
  const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
  await detection.checkNow();
  clock.advance(60_000);
  /** 기존 업무에는 새 댓글이 와도 초안을 만들지 않는다. */
  const time = kind === 'existing' ? '20261019090100' : '20261020090100';
  flow.addPost({ postId: 'excluded', title: '처리하지 않을 업무', registerId: kind === 'self' ? ME : SENDER,
    registeredDateTime: time, editedDateTime: time, textComponents: [{ contents: '본문', mentions: [] }],
    tasks: [{ taskId: 'excluded-task', workerIds: kind === 'unassigned' ? [] : [ME],
      completion: kind === 'completed' ? 'completed' : kind === 'unknown' ? 'unknown' : 'active' }] });
  flow.addWorkerAlarm(alarm('201', { postId: 'excluded', remarkId: kind === 'comment' ? '700' : '-1', registeredDateTime: time }));
  await detection.checkNow();
  await settle();
  expect(bundles.state()).toEqual([]);
  expect(executor.requests).toEqual([]);
  // 다시 조회해도 같은 상태 범주는 보류하지 않고 새 알림이 올 때까지 후보에서 뺀다.
  if (kind === 'unknown') expect((await stateStore.getAssignmentState())?.pending).toEqual([]);
});

it.each([
  ['담당자 이름이 오면 생성 때 담당 기록의 시각으로 초안을 만든다', true],
  ['담당자 이름이 없으면 기록을 내 것으로 확정하지 못해 만들지 않는다', false],
] as const)('생성 시 지정 업무가 처음 발견되기 전에 수정됐을 때: %s', async (_, named) => {
  /** 서비스 검증 환경. */
  const { flow, clock, stateStore, bundles, executor, repos } = await setup();
  /** 감지 서비스. */
  const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
  await detection.checkNow();
  clock.advance(60_000);
  // 수정 시각이 생성 시각과 달라 생성 시 지정으로 바로 보지 않고, 생성 때의 담당 기록(`@$%` 형식)을 배정 근거로 쓴다.
  flow.addPost({ postId: 'edited', title: '수정한 업무', registerId: SENDER, registerName: '업무 작성자',
    registeredDateTime: '20261020090100', editedDateTime: '20261020090500', textComponents: [{ contents: '수정한 본문', mentions: [] }],
    tasks: [{ taskId: 'edited-task', workerIds: [ME], completion: 'active', ...(named ? { workerNames: [{ userId: ME, name: FAKE_ME.name }] } : {}) }] });
  flow.addComment('edited', { commentId: '830', contents: '', registerId: SENDER, registeredDateTime: '20261020090100', systemCode: `S41^^'${FAKE_ME.name}'@$%` });
  flow.addWorkerAlarm(alarm('201', { postId: 'edited', remarkId: '-1', registeredDateTime: '20261020090100' }));
  executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
  await detection.checkNow();
  await settle();
  if (named) {
    expect(bundles.state()).toMatchObject([{ status: 'ready', assignment: { taskId: 'edited-task', assignedAt: '20261020090100' } }]);
    expect(executor.requests[0]?.input).toContain('수정한 본문');
  } else {
    expect(bundles.state()).toEqual([]);
    expect(executor.requests).toEqual([]);
  }
});

it('첫 담당 업무 조회가 한 주기 상한을 넘으면 다음 주기에 이어 받고 불완전한 기준을 확정하지 않는다', async () => {
  /** 서비스 검증 환경. */
  const { flow, clock, stateStore, bundles } = await setup();
  flow.alarmPageSize = 1;
  for (let index = 0; index < 51; index += 1) flow.addWorkerAlarm(alarm(String(200 + index)));
  /** 감지 서비스. */
  const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
  await detection.checkNow();
  expect((await stateStore.getAssignmentState())?.baselineReady).toBe(false);
  await detection.checkNow();
  expect((await stateStore.getAssignmentState())?.baselineReady).toBe(true);
  expect(bundles.state()).toEqual([]);
});

it('담당 업무 초안 실패는 재시도할 수 있고 수정된 최신 제목과 본문을 사용한다', async () => {
  /** 서비스 검증 환경. */
  const { flow, clock, stateStore, bundles, executor, repos } = await setup();
  /** 담당 업무 감지. */
  const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
  await detection.checkNow();
  clock.advance(60_000);
  /** 최초 생성 시 확인한 업무. */
  const post = { postId: 'retry-task-post', title: '처음 제목', registerId: SENDER, registerName: '작성자',
    registeredDateTime: '20261020090100', editedDateTime: '20261020090100',
    textComponents: [{ contents: '처음 본문', mentions: [] }],
    tasks: [{ taskId: 'retry-task', workerIds: [ME], completion: 'active' as const }] };
  flow.addPost(post);
  flow.addWorkerAlarm(alarm('201', { postId: post.postId, remarkId: '-1', registeredDateTime: post.registeredDateTime }));
  executor.script({ outcome: { type: 'timed-out' } });
  await detection.checkNow();
  await settle();
  /** 실패 기록을 가진 기존 초안 묶음. */
  const failed = bundles.state()[0]!;
  expect(failed.status).toBe('failed');
  flow.addPost({ ...post, title: '수정한 최신 제목', editedDateTime: '20261020090200', textComponents: [{ contents: '수정한 최신 본문', mentions: [] }] });
  executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
  await bundles.retry(failed.id);
  await settle();
  expect(bundles.get(failed.id)?.status).toBe('ready');
  expect(executor.requests.at(-1)?.input).toContain('수정한 최신 제목');
  expect(executor.requests.at(-1)?.input).toContain('수정한 최신 본문');
  flow.addWorkerAlarm(alarm('202', { postId: post.postId, remarkId: '700', registeredDateTime: '20261020090200' }));
  await detection.checkNow();
  expect(bundles.state()).toHaveLength(1);
});

describe('기존 업무의 신규 배정과 이미 답함', () => {
  /** 다른 담당자. 실제 사람이 아니다. */
  const CO_WORKER = 'co-worker@example.test';
  /** 기능 시작 후 나를 추가한 담당 변경 기록의 서버 시각. */
  const ASSIGNED_AT = '20261020090100';

  /**
   * 기능 시작 전에 작성된 업무에 나중에 나를 추가한 상황을 둔다.
   * 최초 담당 기록, 배정 전 내 댓글, 나를 추가한 기록, 배정 후 내가 바꾼 상태 기록과 그 담당 변경 알림이다. `workerNames`가 `null`이면 담당자 이름이 오지 않는다.
   */
  function addLaterAssignedTask(flow: FakeFlowApi, postId: string, overrides: { workerNames?: readonly { userId: string; name: string }[] | null; change?: string } = {}) {
    /** 상세 응답의 담당자 이름. */
    const workerNames = overrides.workerNames === undefined ? [{ userId: CO_WORKER, name: '다른 담당자' }, { userId: ME, name: FAKE_ME.name }] : overrides.workerNames;
    flow.addPost({ postId, title: '오래된 업무', registerId: SENDER, registerName: '업무 작성자',
      registeredDateTime: '20260930163809', editedDateTime: '20260930164152',
      textComponents: [{ contents: '배포 순서를 정리해주세요.', mentions: [] }],
      tasks: [{ taskId: `${postId}-task`, workerIds: [CO_WORKER, ME], completion: 'active', ...(workerNames ? { workerNames: [...workerNames] } : {}) }] });
    flow.addComment(postId, { commentId: '801', contents: '', registerId: SENDER, registeredDateTime: '20260930164152', systemCode: "S41^^'다른 담당자'@$%" });
    flow.addComment(postId, { commentId: '802', contents: '예전 논의입니다.', registerId: ME, registeredDateTime: '20261001100000' });
    flow.addComment(postId, { commentId: '803', contents: '', registerId: CO_WORKER, registeredDateTime: ASSIGNED_AT,
      systemCode: overrides.change ?? `S41^^'다른 담당자'^^'다른 담당자', '${FAKE_ME.name}'` });
    flow.addComment(postId, { commentId: '804', contents: '', registerId: ME, registeredDateTime: '20261020090130', systemCode: 'S45_2^^대기^^진행' });
    flow.addWorkerAlarm(alarm('201', { postId, remarkId: '803', registerId: CO_WORKER, registeredDateTime: ASSIGNED_AT }));
  }

  /** 기능을 시작해 기준을 만든 감지 서비스. */
  async function startedDetection({ flow, clock, stateStore, bundles }: Awaited<ReturnType<typeof setup>>) {
    /** 담당 업무 감지. */
    const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
    await detection.checkNow();
    clock.advance(60_000);
    return detection;
  }

  it('작성일이 기능 시작 전인 업무에 나중에 배정되면 배정 전 내 댓글·시스템 기록과 무관하게 초안을 만들고 승인 후 게시한다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, clock, bundles, executor, repos } = env;
    /** 기준을 만든 감지. */
    const detection = await startedDetection(env);
    addLaterAssignedTask(flow, 'old-task');
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await detection.checkNow();
    await settle();
    /** 생성된 담당 업무 초안. */
    const bundle = bundles.state()[0]!;
    expect(bundle).toMatchObject({ status: 'ready', assignment: { taskId: 'old-task-task', assignedAt: ASSIGNED_AT } });
    expect(bundleRecipients(bundle)).toEqual([{ id: SENDER, name: '업무 작성자' }]);
    expect(executor.requests[0]?.input).toContain('배포 순서를 정리해주세요.');
    expect(executor.requests[0]?.input).not.toContain('S41');
    /** 승인 후 게시 서비스. */
    const posting = new Posting({ bundles, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }), myUserId: () => ME,
      clock, logger: createLogger([{ write: () => {} }], clock) });
    await posting.post(bundle.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(flow.writes).toEqual([{ request: 'POST /user/comments/old-task', contents: expect.stringContaining('업무 작성자') }]);
    expect(bundles.get(bundle.id)?.status).toBe('posted');
  });

  it.each(['comment', 'reply'] as const)('배정 후 이미 쓴 내 %s이 있으면 생성 없이 이미 답함으로 처리하고 반복 조회에도 다시 만들지 않는다', async (kind) => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor } = env;
    /** 기준을 만든 감지. */
    const detection = await startedDetection(env);
    addLaterAssignedTask(flow, 'answered-task');
    if (kind === 'comment') flow.addComment('answered-task', { commentId: '805', contents: '확인했습니다.', registerId: ME, registeredDateTime: '20261020090200' });
    else {
      flow.addComment('answered-task', { commentId: '805', contents: '질문 있습니다.', registerId: SENDER, registeredDateTime: '20260930170000',
        replies: [...Array.from({ length: 10 }, (_, index) => ({ replyId: `9${index}`, contents: '이전 답글', registerId: SENDER, registeredDateTime: '20260930170100' })),
          { replyId: '99', contents: '배정 후 답했습니다.', registerId: ME, registeredDateTime: '20261020090200' }] });
    }
    await detection.checkNow();
    await settle();
    expect(bundles.state()).toMatchObject([{ status: 'already-answered', assignment: { assignedAt: ASSIGNED_AT } }]);
    // 감지 때 받은 업무 본문을 남겨 처리됨 원문 칸이 비지 않는다.
    expect(bundles.state()[0]?.context?.post).toMatchObject({ title: '오래된 업무', contents: '배포 순서를 정리해주세요.', assignment: true });
    expect(executor.requests).toEqual([]);
    flow.addWorkerAlarm(alarm('202', { postId: 'answered-task', remarkId: '805', registeredDateTime: '20261020090300' }));
    await detection.checkNow();
    await settle();
    expect(bundles.state()).toHaveLength(1);
    expect(executor.requests).toEqual([]);
  });

  it('생성 시 배정된 업무도 생성 이후 내 댓글이 있으면 이미 답함으로 처리한다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor } = env;
    /** 기준을 만든 감지. */
    const detection = await startedDetection(env);
    flow.addPost({ postId: 'created-answered', title: '새 업무', registerId: SENDER, registerName: '업무 작성자',
      registeredDateTime: '20261020090100', editedDateTime: '20261020090100', textComponents: [{ contents: '확인해주세요.', mentions: [] }],
      tasks: [{ taskId: 'created-answered-task', workerIds: [ME], completion: 'active' }] });
    flow.addComment('created-answered', { commentId: '810', contents: '보고 있습니다.', registerId: ME, registeredDateTime: '20261020090200' });
    flow.addWorkerAlarm(alarm('201', { postId: 'created-answered', remarkId: '-1', registeredDateTime: '20261020090100' }));
    await detection.checkNow();
    await settle();
    expect(bundles.state()).toMatchObject([{ status: 'already-answered', assignment: { assignedAt: '20261020090100' } }]);
    expect(executor.requests).toEqual([]);
  });

  it('배정 후 초안 생성 직전에 쓴 내 댓글도 이미 답함으로 처리하고 되돌리면 그 답을 빼고 다시 만든다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, setConnected } = env;
    /** 기준을 만든 감지. */
    const detection = await startedDetection(env);
    setConnected(false);
    addLaterAssignedTask(flow, 'late-answer');
    await detection.checkNow();
    await settle();
    expect(bundles.state().map((item) => item.status)).toEqual(['generating']);
    flow.addComment('late-answer', { commentId: '805', contents: '먼저 답했습니다.', registerId: SENDER, registeredDateTime: '20261020090200',
      replies: [{ replyId: '901', contents: '제가 볼게요.', registerId: ME, registeredDateTime: '20261020090300' }] });
    setConnected(true);
    await settle();
    /** 생성 직전 판정으로 처리한 묶음. */
    const [bundle] = bundles.state();
    expect(bundle?.status).toBe('already-answered');
    expect(executor.requests).toEqual([]);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await bundles.restore(bundle!.id);
    await settle();
    expect(bundles.get(bundle!.id)?.status).toBe('ready');
  });

  it('생성 직전 판정도 담당 변경 기록 스레드에 단 내 답글을 답으로 센다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, setConnected } = env;
    /** 기준을 만든 감지. */
    const detection = await startedDetection(env);
    setConnected(false);
    addLaterAssignedTask(flow, 'system-thread');
    await detection.checkNow();
    await settle();
    flow.addReply('system-thread', '803', { replyId: '902', contents: '제가 맡겠습니다.', registerId: ME, registeredDateTime: '20261020090300' });
    setConnected(true);
    await settle();
    expect(bundles.state().map((item) => item.status)).toEqual(['already-answered']);
    expect(executor.requests).toEqual([]);
  });

  it('댓글을 쪽 상한까지 받아도 끝나지 않으면 답이 없다고 단정하지 않고 새 알림이 올 때까지 후보에서 뺀다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, stateStore } = env;
    /** 기준을 만든 감지. */
    const detection = await startedDetection(env);
    addLaterAssignedTask(flow, 'long-thread');
    for (let index = 0; index < 50; index += 1) {
      flow.addComment('long-thread', { commentId: String(1000 + index), contents: '긴 논의', registerId: SENDER, registeredDateTime: '20261020090150' });
    }
    flow.commentPageSize = 1;
    await detection.checkNow();
    await settle();
    expect(bundles.state()).toEqual([]);
    expect(executor.requests).toEqual([]);
    expect((await stateStore.getAssignmentState())?.pending).toEqual([]);
    /** 다음 주기 전까지 받은 요청 수. */
    const before = flow.requests.length;
    await detection.checkNow();
    expect(flow.requests.slice(before)).toEqual(['GET /user/alarms/worker']);
  });

  it('기능 시작 전부터 맡던 업무의 일반 댓글·상태 변경 알림을 신규 배정으로 보지 않는다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, clock, stateStore, bundles, executor } = env;
    // 기능 시작 전 알림에 나타난 업무와, 알림은 없지만 시작 전에 나를 추가한 기록이 있는 업무다.
    flow.addWorkerAlarm(alarm('150', { postId: 'initial-alarm', remarkId: '-1', registeredDateTime: '20261019090000' }));
    /** 담당 업무 감지. */
    const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
    await detection.checkNow();
    clock.advance(60_000);
    for (const postId of ['initial-alarm', 'initial-record']) {
      flow.addPost({ postId, title: '기존 업무', registerId: SENDER, registeredDateTime: '20261001090000', editedDateTime: '20261001090500',
        textComponents: [{ contents: '기존 본문', mentions: [] }],
        tasks: [{ taskId: `${postId}-task`, workerIds: [ME], completion: 'active', workerNames: [{ userId: ME, name: FAKE_ME.name }] }] });
      flow.addComment(postId, { commentId: '820', contents: '', registerId: SENDER, registeredDateTime: '20261001090500', systemCode: `S41^^'${FAKE_ME.name}'@$%` });
      flow.addComment(postId, { commentId: '821', contents: '', registerId: SENDER, registeredDateTime: '20261020090100', systemCode: 'S45_2^^진행^^확인 요청' });
      flow.addComment(postId, { commentId: '822', contents: '진행 상황 공유합니다.', registerId: SENDER, registeredDateTime: '20261020090200' });
    }
    flow.addWorkerAlarm(alarm('201', { postId: 'initial-alarm', remarkId: '821', registeredDateTime: '20261020090100' }));
    flow.addWorkerAlarm(alarm('202', { postId: 'initial-record', remarkId: '821', registeredDateTime: '20261020090100' }));
    flow.addWorkerAlarm(alarm('203', { postId: 'initial-record', remarkId: '822', registeredDateTime: '20261020090200' }));
    await detection.checkNow();
    await detection.checkNow();
    await settle();
    expect(bundles.state()).toEqual([]);
    expect(executor.requests).toEqual([]);
  });

  it.each([
    ['동명이인 담당자', { workerNames: [{ userId: 'same-name@example.test', name: FAKE_ME.name }, { userId: ME, name: FAKE_ME.name }] }],
    ['담당자 이름 누락', { workerNames: null }],
    ['기록의 이름 불일치', { change: "S41^^'다른 담당자'^^'다른 담당자', '예전 이름'" }],
    ['해석할 수 없는 기록', { change: 'S41^^알 수 없는 형식' }],
  ] as const)('배정 근거가 불명확하면 이미 답함이나 생성을 확정하지 않는다: %s', async (_, overrides) => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor } = env;
    /** 기준을 만든 감지. */
    const detection = await startedDetection(env);
    addLaterAssignedTask(flow, 'unclear', overrides);
    flow.addComment('unclear', { commentId: '805', contents: '확인했습니다.', registerId: ME, registeredDateTime: '20261020090200' });
    await detection.checkNow();
    await settle();
    expect(bundles.state()).toEqual([]);
    expect(executor.requests).toEqual([]);
  });

  it('댓글 조회가 실패하면 보류하고 다음 조회에서 배정 후 답변을 판정한다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, stateStore } = env;
    /** 기준을 만든 감지. */
    const detection = await startedDetection(env);
    addLaterAssignedTask(flow, 'retry-comments');
    flow.addComment('retry-comments', { commentId: '805', contents: '확인했습니다.', registerId: ME, registeredDateTime: '20261020090200' });
    flow.failOn('GET /user/comments/retry-comments', { kind: 'network' }, 1);
    await detection.checkNow();
    await settle();
    expect(bundles.state()).toEqual([]);
    expect((await stateStore.getAssignmentState())?.pending.map((item) => item.postId)).toEqual(['retry-comments']);
    await detection.checkNow();
    await settle();
    expect(bundles.state().map((item) => item.status)).toEqual(['already-answered']);
    expect(executor.requests).toEqual([]);
  });
});

describe('마스킹한 실응답 사례 A의 최종 판정', () => {
  /** 2026-10-29 실응답 사례 A의 본인 별칭. 담당 변경 기록의 이름도 같은 별칭으로 가렸다. */
  const CASE_ME = 'id-1';

  /**
   * 상세 응답. 실응답은 담당자 컬럼 이름(`USER_NM`)을 `[redacted]`로, 담당 변경 기록의 이름을 사용자 별칭으로 따로 가렸다.
   * 같은 사람을 같은 이름으로 맞추려고 이름을 그 사람의 별칭으로 바꾼다. `category`를 주면 실응답에 없는 상태를 가정한 변형이다.
   */
  function casePost(category?: string) {
    /** 고칠 사본. */
    const post = structuredClone(assignmentPost);
    for (const column of post.tasks[0]!.TASK_COLUMN_REC) {
      for (const data of column.COLUMN_DATA_REC) {
        if (column.DEFAULT_COLUMN_TYPE === 'WORKER_ID') data.USER_NM = data.CUSTOM_COLUMN_DATA;
        if (column.DEFAULT_COLUMN_TYPE === 'STATUS' && category !== undefined) data.OPTION_CATEGORY = category;
      }
    }
    return flowEnvelope(post);
  }

  /** 담당 변경 기록(`id-40`)의 `WORKER` 알림 한 쪽. 2026-10-29 관측한 알림 필드를 위 fixture와 같은 별칭으로 옮겼다. */
  const caseAlarms = flowEnvelope({ alarms: { hasNext: false, lastCursor: 1, alarms: [{ alarmId: 'id-41', projectId: 'id-6', postId: 'id-7',
    remarkId: 'id-40', replyId: '-1', registerId: 'id-11', registeredDateTime: '20261029102448' }] } });

  /** 빈 알림 목록으로 기준을 만든 뒤, 실제 HTTP 어댑터로 사례 A를 받는 감지. */
  async function caseDetection(env: Awaited<ReturnType<typeof setup>>, server: FakeFlowServer) {
    env.stateStore.account = { ...FAKE_ME, userId: CASE_ME, name: CASE_ME };
    /** 실응답을 읽는 어댑터로 연결한 감지. */
    const detection = new AssignmentDetection({ stateStore: env.stateStore, bundles: env.bundles, clock: env.clock,
      connectFlow: () => ({ api: new HttpFlowApi({ apiKey: 'fake-key-1', fetch: server.fetch, clock: env.clock }), reportKeyRejected: () => {} }) });
    server.replyNext({ status: 200, body: flowEnvelope({ alarms: { hasNext: false, lastCursor: -1, alarms: [] } }) });
    await detection.checkNow();
    env.clock.advance(60_000);
    return detection;
  }

  /** 받은 요청의 경로. */
  const paths = (server: FakeFlowServer) => server.requests.map((request) => new URL(request.url).pathname);

  it('관측 그대로인 완료 범주(2)의 업무는 댓글을 받지 않고 제외한다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    /** 실응답 대역. */
    const server = new FakeFlowServer();
    /** 기준을 만든 감지. */
    const detection = await caseDetection(env, server);
    server.replyNext({ status: 200, body: caseAlarms }, { status: 200, body: casePost() });
    await detection.checkNow();
    await settle();
    expect(env.bundles.state()).toEqual([]);
    expect((await env.stateStore.getAssignmentState())?.pending).toEqual([]);
    expect(paths(server)).toEqual(['/user/alarms', '/user/alarms', '/user/posts/id-7']);
  });

  it('변형: 미완료 범주(0)였다면 담당 변경 기록 뒤의 내 답글로 이미 답함 처리한다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    /** 실응답 대역. */
    const server = new FakeFlowServer();
    /** 기준을 만든 감지. */
    const detection = await caseDetection(env, server);
    server.replyNext({ status: 200, body: caseAlarms }, { status: 200, body: casePost('0') }, { status: 200, body: assignmentComments });
    await detection.checkNow();
    await settle();
    expect(env.bundles.state()).toMatchObject([{ status: 'already-answered', assignment: { taskId: 'id-23', assignedAt: '20261029102448' } }]);
    expect(env.executor.requests).toEqual([]);
  });

  it('변형: 진행·피드백 범주(1)였다면 초안 없이 후보에서 빼고 다음 주기에 상세를 다시 받지 않는다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    /** 실응답 대역. */
    const server = new FakeFlowServer();
    /** 기준을 만든 감지. */
    const detection = await caseDetection(env, server);
    server.replyNext({ status: 200, body: caseAlarms }, { status: 200, body: casePost('1') }, { status: 200, body: caseAlarms });
    await detection.checkNow();
    await detection.checkNow();
    await settle();
    expect(env.bundles.state()).toEqual([]);
    expect((await env.stateStore.getAssignmentState())?.pending).toEqual([]);
    expect(paths(server)).toEqual(['/user/alarms', '/user/alarms', '/user/posts/id-7', '/user/alarms']);
  });
});

describe('본문 멘션과 담당자 지정의 합치기', () => {
  /** 나를 본문에서 멘션하면서 담당자로도 지정한 업무 게시물. */
  const BODY_POST = 'mention-task';
  /** 업무 생성 시각. 기능 시작 뒤다. */
  const CREATED_AT = '20261020090100';

  /** 본문 멘션과 생성 시 지정이 함께 있는 업무를 두고, 멘션 알림과 담당 업무 알림을 돌려준다. 담당 업무 알림은 아직 넣지 않는다. */
  function addMentionedTask(flow: FakeFlowApi) {
    flow.addPost({ postId: BODY_POST, title: '멘션한 업무', registerId: SENDER, registerName: '업무 작성자',
      registeredDateTime: CREATED_AT, editedDateTime: CREATED_AT,
      textComponents: [{ contents: `${MY_MARKUP} 배포 순서를 정리해주세요.`, mentions: [ME] }],
      tasks: [{ taskId: 'mention-task-id', workerIds: [ME], completion: 'active' }] });
    return {
      mention: alarm('101', { postId: BODY_POST, remarkId: '-1', registerName: '업무 작성자', registeredDateTime: CREATED_AT }),
      worker: alarm('201', { postId: BODY_POST, remarkId: '-1', registeredDateTime: CREATED_AT }),
    };
  }

  /** 기능을 시작해 기준을 만든 담당 업무 감지. */
  async function startedAssignments({ flow, clock, stateStore, bundles }: Awaited<ReturnType<typeof setup>>) {
    /** 담당 업무 감지. */
    const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
    await detection.checkNow();
    clock.advance(60_000);
    return detection;
  }

  it('멘션 묶음이 검토 중일 때 담당자 지정이 오면 같은 묶음에 감지 사유를 더하고 초안을 다시 만들지 않는다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    /** 기준을 만든 감지. */
    const assignments = await startedAssignments(env);
    /** 업무의 두 알림. */
    const { mention, worker } = addMentionedTask(flow);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(mention);
    expect(bundles.state()).toMatchObject([{ status: 'ready', mentions: [{ remarkId: '-1' }] }]);
    flow.addWorkerAlarm(worker);
    await assignments.checkNow();
    await settle();
    expect(bundles.state()).toHaveLength(1);
    expect(bundles.state()[0]).toMatchObject({ status: 'ready', newMentionCount: 0, mentions: [{ remarkId: '-1' }],
      assignment: { taskId: 'mention-task-id', assignedAt: CREATED_AT } });
    expect(executor.requests).toHaveLength(1);
  });

  it.each(['generating', 'ready'] as const)('담당 업무 묶음이 %s일 때 본문 멘션이 오면 같은 묶음에 멘션을 남기고 별도 초안이나 재생성을 만들지 않는다', async (phase) => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    /** 기준을 만든 감지. */
    const assignments = await startedAssignments(env);
    /** 업무의 두 알림. */
    const { mention, worker } = addMentionedTask(flow);
    /** 생성 중에 멈춰 둘 실행. */
    const held = heldOutcome();
    executor.script(phase === 'generating' ? { outcome: held.outcome } : { outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addWorkerAlarm(worker);
    await assignments.checkNow();
    await settle();
    expect(bundles.state()).toMatchObject([{ status: phase }]);
    await poll(mention);
    if (phase === 'generating') {
      held.release({ type: 'completed', output: draftOutput(repos.a) });
      await settle();
    }
    expect(bundles.state()).toHaveLength(1);
    expect(bundles.state()[0]).toMatchObject({ status: 'ready', newMentionCount: 0, mentions: [{ remarkId: '-1', replyId: '-1' }],
      assignment: { taskId: 'mention-task-id' } });
    expect(executor.requests).toHaveLength(1);
  });

  /** 묶음을 승인 후 게시하고 카운트다운까지 끝낸다. */
  async function postApproved({ flow, clock, bundles }: Awaited<ReturnType<typeof setup>>, bundleId: number) {
    /** 승인 후 게시 서비스. */
    const posting = new Posting({ bundles, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }), myUserId: () => ME,
      clock, logger: createLogger([{ write: () => {} }], clock) });
    await posting.post(bundleId);
    await settle();
    clock.advance(5_000);
    await settle();
  }

  it('이미 게시한 담당 업무 본문에 멘션 알림이 늦게 와도 또 다른 초기 초안을 만들지 않는다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    /** 기준을 만든 감지. */
    const assignments = await startedAssignments(env);
    /** 업무의 두 알림. */
    const { mention, worker } = addMentionedTask(flow);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addWorkerAlarm(worker);
    await assignments.checkNow();
    await settle();
    await postApproved(env, bundles.state()[0]!.id);
    expect(bundles.state()).toMatchObject([{ status: 'posted' }]);
    await poll(mention);
    expect(bundles.state()).toMatchObject([{ status: 'posted', mentions: [{ remarkId: '-1' }] }]);
    expect(executor.requests).toHaveLength(1);
    expect(flow.writes).toHaveLength(1);
  });

  it.each(['posted', 'archived'] as const)('본문 멘션 묶음을 처리한 뒤(%s) 담당자 지정이 늦게 와도 또 다른 초기 초안을 만들지 않는다', async (kind) => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, clock, bundles, executor, repos, poll } = env;
    /** 기준을 만든 감지. */
    const assignments = await startedAssignments(env);
    /** 업무의 두 알림. */
    const { mention, worker } = addMentionedTask(flow);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(mention);
    await postApproved(env, bundles.state()[0]!.id);
    if (kind === 'archived') {
      clock.advance(8 * 24 * 60 * 60 * 1000);
      await bundles.archiveExpired();
      expect(bundles.state()).toEqual([]);
    }
    flow.addWorkerAlarm(worker);
    await assignments.checkNow();
    await settle();
    expect(bundles.state()).toHaveLength(kind === 'archived' ? 0 : 1);
    expect(executor.requests).toHaveLength(1);
    expect(flow.writes).toHaveLength(1);
  });

  it('같은 주기에 본문 멘션과 담당자 지정이 함께 수집되면 초안 하나만 만들고 반복 알림에도 늘지 않는다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    /** 기준을 만든 감지. */
    const assignments = await startedAssignments(env);
    /** 업무의 두 알림. */
    const { mention, worker } = addMentionedTask(flow);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addWorkerAlarm(worker);
    await Promise.all([poll(mention), assignments.checkNow()]);
    await settle();
    flow.addWorkerAlarm(alarm('202', { postId: BODY_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    flow.addAlarm(alarm('102', { postId: BODY_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    await Promise.all([poll(), assignments.checkNow()]);
    await settle();
    expect(bundles.state()).toHaveLength(1);
    expect(bundles.state()[0]).toMatchObject({ status: 'ready', mentions: [{ remarkId: '-1' }], assignment: { taskId: 'mention-task-id' } });
    expect(executor.requests).toHaveLength(1);
    expect(bundles.reviewCount()).toBe(1);
  });

  it('합쳐진 초안은 최신 업무 본문에 답해 한 번만 게시되고, 같은 업무의 이후 댓글 멘션은 댓글 스레드 묶음으로 따로 처리된다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    /** 기준을 만든 감지. */
    const assignments = await startedAssignments(env);
    /** 업무의 두 알림. */
    const { mention, worker } = addMentionedTask(flow);
    /** 첫 감지 사유로 생성 중에 멈춰 둔 실행. */
    const held = heldOutcome();
    executor.script({ outcome: held.outcome });
    await poll(mention);
    flow.addWorkerAlarm(worker);
    await assignments.checkNow();
    held.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();
    /** 합쳐진 묶음. */
    const merged = bundles.state()[0]!;
    expect(merged).toMatchObject({ status: 'ready', mentions: [{ remarkId: '-1' }], assignment: { taskId: 'mention-task-id' } });
    expect(executor.requests[0]?.input).toContain('배포 순서를 정리해주세요.');
    expect(bundleRecipients(merged)).toEqual([{ id: SENDER, name: '업무 작성자' }]);
    await bundles.editDraft(merged.id, '정리한 배포 순서입니다.');
    await bundles.removeRecipient(merged.id, 0, '업무 작성자');
    await postApproved(env, merged.id);
    expect(flow.writes).toEqual([{ request: `POST /user/comments/${BODY_POST}`, contents: '정리한 배포 순서입니다.' }]);
    expect(bundles.get(merged.id)?.status).toBe('posted');

    flow.addComment(BODY_POST, { commentId: '901', contents: `${MY_MARKUP} 롤백 순서도 알려주세요.`, registerId: SENDER, registeredDateTime: '20261020093000' });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addWorkerAlarm(alarm('203', { postId: BODY_POST, remarkId: '901', registeredDateTime: '20261020093000' }));
    await poll(alarm('103', { postId: BODY_POST, remarkId: '901', registeredDateTime: '20261020093000' }));
    await assignments.checkNow();
    await settle();
    expect(bundles.state().map((bundle) => [bundle.remarkId, bundle.status, !!bundle.assignment])).toEqual([['901', 'ready', false], ['-1', 'posted', true]]);
    expect(targetMentionOf(executor.requests[1])).toContain('롤백 순서도 알려주세요.');
    expect(flow.writes).toHaveLength(1);
  });

  it('합쳐진 묶음은 본문에서 내 멘션 표기가 빠져도 담당 업무 사유로 남고, 두 감지 사유를 따로 보존한다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    /** 기준을 만든 감지. */
    const assignments = await startedAssignments(env);
    /** 업무의 두 알림. */
    const { mention, worker } = addMentionedTask(flow);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(mention);
    flow.addWorkerAlarm(worker);
    await assignments.checkNow();
    await settle();
    flow.editPost(BODY_POST, [{ contents: '배포 순서를 정리해주세요.', mentions: [] }]);
    await bundles.watchWaiting();
    await settle();
    expect(bundles.state()).toMatchObject([{ status: 'ready', mentions: [{ remarkId: '-1', gone: true }], assignment: { taskId: 'mention-task-id' } }]);
  });

  it.each(['mention-first', 'assignment-first'] as const)('저장소 확인을 기다리는 같은 본문에 두 번째 감지 사유가 와도(%s) 검토 대상 하나로 남는다', async (order) => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    // 매핑된 폴더 하나가 없어 새 묶음은 저장소 확인 필요로 기다린다.
    rmSync(repos.b, { recursive: true, force: true });
    /** 기준을 만든 감지. */
    const assignments = await startedAssignments(env);
    /** 업무의 두 알림. */
    const { mention, worker } = addMentionedTask(flow);
    flow.addWorkerAlarm(worker);
    if (order === 'mention-first') {
      await poll(mention);
      await assignments.checkNow();
    } else {
      await assignments.checkNow();
      await poll(mention);
    }
    await settle();
    expect(bundles.state()).toMatchObject([{ status: 'repo-check-needed', mentions: [{ remarkId: '-1' }], assignment: { taskId: 'mention-task-id' } }]);
    expect(bundles.reviewCount()).toBe(1);
    expect(executor.requests).toEqual([]);
  });

  it('무시한 담당 업무 묶음이 최소 기록만 남은 뒤 본문 멘션 알림이 늦게 와도 새 묶음을 만들지 않는다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, clock, bundles, executor, repos, poll } = env;
    /** 기준을 만든 감지. */
    const assignments = await startedAssignments(env);
    /** 업무의 두 알림. */
    const { mention, worker } = addMentionedTask(flow);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addWorkerAlarm(worker);
    await assignments.checkNow();
    await settle();
    // 게시한 글은 멘션 판정이 내 답으로 먼저 거르므로, 내 답이 없는 무시함으로 처리한다.
    await bundles.ignore(bundles.state()[0]!.id);
    clock.advance(8 * 24 * 60 * 60 * 1000);
    await bundles.archiveExpired();
    // 처음 시각의 알림은 멘션 감지 범위(72시간) 밖이므로, 본문을 고쳐 다시 온 같은 위치의 알림으로 늦은 중복을 만든다.
    await poll({ ...mention, alarmId: '102', registeredDateTime: '20261028090200' });
    expect(bundles.state()).toEqual([]);
    expect(executor.requests).toHaveLength(1);
  });
});

describe('담당 해제', () => {
  /** 담당 업무 게시물. */
  const TASK_POST = 'removed-task';
  /** 다른 담당자. 실제 사람이 아니다. */
  const CO_WORKER = 'co-worker@example.test';
  /** 업무 생성 시각. 기능 시작 뒤다. */
  const CREATED_AT = '20261020090100';

  /** 생성 시 나와 다른 담당자를 지정한 업무를 둔다. `workerIds`로 지금 담당자를 바꾼다. */
  function setTask(flow: FakeFlowApi, workerIds: string[] | null, contents = '배포 순서를 정리해주세요.') {
    flow.addPost({ postId: TASK_POST, title: '담당 업무', registerId: SENDER, registerName: '업무 작성자',
      registeredDateTime: CREATED_AT, editedDateTime: CREATED_AT,
      textComponents: [{ contents, mentions: contents.includes(MY_MARKUP) ? [ME] : [] }],
      tasks: [{ taskId: 'removed-task-id', workerIds, completion: 'active' }] });
  }

  /** 기능을 시작한 뒤 업무를 배정하고 담당 업무 감지를 한 번 돌린다. 대기열은 바로 생성을 시작한다. */
  async function assign(env: Awaited<ReturnType<typeof setup>>, contents?: string) {
    const { flow, clock, stateStore, bundles } = env;
    /** 담당 업무 감지. */
    const detection = new AssignmentDetection({ stateStore, bundles, clock, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
    await detection.checkNow();
    clock.advance(60_000);
    setTask(flow, [ME, CO_WORKER], contents);
    flow.addWorkerAlarm(alarm('201', { postId: TASK_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    await detection.checkNow();
    await settle();
    return detection;
  }

  it('생성 직전에 담당 해제를 확인하면 실행하지 않고 처리됨의 담당 해제로 옮긴다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, setConnected } = env;
    setConnected(false);
    await assign(env);
    expect(bundles.state()).toMatchObject([{ status: 'generating' }]);
    setTask(flow, [CO_WORKER]);
    setConnected(true);
    await settle();
    expect(executor.requests).toEqual([]);
    expect(bundles.state()).toMatchObject([{ status: 'unassigned', draft: null, assignment: { taskId: 'removed-task-id', unassignedAt: NOW + 60_000 } }]);
  });

  it('생성 중 다음 폴링에서 담당 해제를 확인하면 실행을 끊고, 뒤늦게 도착한 실행 결과를 초안으로 저장하지 않는다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    await poll();
    await assign(env);
    expect(bundles.state()).toMatchObject([{ status: 'generating' }]);
    setTask(flow, [CO_WORKER]);
    await poll();
    expect(executor.requests[0]?.signal.aborted).toBe(true);
    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();
    expect(executor.requests).toHaveLength(1);
    expect(bundles.state()).toMatchObject([{ status: 'unassigned', draft: null, assignment: { unassignedAt: expect.any(Number) } }]);
    expect(bundles.state()[0]?.runs.map((record) => record.result)).toEqual(['bundle-changed']);
  });

  it('생성 중 담당자 조회가 실패하거나 다른 담당자만 빠지면 해제로 보지 않고 초안을 만든다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    await poll();
    await assign(env);
    flow.failOn(`GET /user/posts/${TASK_POST}`, { kind: 'http', status: 500 }, 1);
    await poll();
    setTask(flow, null);
    await poll();
    setTask(flow, [ME]);
    await poll();
    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();
    expect(executor.requests).toHaveLength(1);
    expect(bundles.state()).toMatchObject([{ status: 'ready' }]);
    expect(bundles.state()[0]?.runs.map((record) => record.result)).toEqual(['succeeded']);
    expect(bundles.state()[0]?.assignment?.unassignedAt).toBeUndefined();
  });

  /** 승인 후 게시 서비스. */
  function postingOf({ bundles, flow, clock }: Awaited<ReturnType<typeof setup>>) {
    return new Posting({ bundles, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }), myUserId: () => ME,
      clock, logger: createLogger([{ write: () => {} }], clock) });
  }

  it('검토 중 담당 해제를 확인하면 초안과 편집본을 둔 채 게시를 막고, 다시 담당자로 확인되면 게시할 수 있다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll, clock } = env;
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll();
    await assign(env);
    /** 준비된 담당 업무 초안. */
    const ready = bundles.state()[0]!;
    await bundles.editDraft(ready.id, '편집한 답변입니다.');
    setTask(flow, [CO_WORKER]);
    await poll();
    expect(bundles.get(ready.id)).toMatchObject({ status: 'ready', editedText: '편집한 답변입니다.', draft: { createdAt: ready.draft!.createdAt },
      assignment: { unassignedAt: expect.any(Number) } });
    /** 게시 서비스. */
    const posting = postingOf(env);
    await posting.post(ready.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(flow.writes).toEqual([]);
    expect(bundles.get(ready.id)?.status).toBe('ready');
    await bundles.regenerate(ready.id, { path: 'again' });
    await settle();
    expect(executor.requests).toHaveLength(1);
    expect(bundles.get(ready.id)?.editedText).toBe('편집한 답변입니다.');

    setTask(flow, [ME]);
    await poll();
    expect(bundles.get(ready.id)?.assignment?.unassignedAt).toBeUndefined();
    await posting.post(ready.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(flow.writes).toEqual([{ request: `POST /user/comments/${TASK_POST}`, contents: expect.stringContaining('편집한 답변입니다.') }]);
  });

  it('검토 중 담당자 조회가 실패하거나 담당자 목록이 누락되면 해제로 기록하지 않는다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll } = env;
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll();
    await assign(env);
    flow.failOn(`GET /user/posts/${TASK_POST}`, { kind: 'network' }, 1);
    await poll();
    flow.failOn(`GET /user/posts/${TASK_POST}`, { kind: 'http', status: 500 }, 1);
    await poll();
    setTask(flow, null);
    await poll();
    expect(bundles.state()).toMatchObject([{ status: 'ready' }]);
    expect(bundles.state()[0]?.assignment?.unassignedAt).toBeUndefined();
  });

  it('본문 멘션과 합친 묶음은 담당만 해제되고 멘션이 남아 있으면 게시할 수 있다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll, clock } = env;
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll();
    await assign(env, `${MY_MARKUP} 배포 순서를 정리해주세요.`);
    await poll(alarm('101', { postId: TASK_POST, remarkId: '-1', registerName: '업무 작성자', registeredDateTime: CREATED_AT }));
    /** 합친 묶음. */
    const merged = bundles.state()[0]!;
    expect(merged).toMatchObject({ status: 'ready', mentions: [{ remarkId: '-1' }] });
    setTask(flow, [CO_WORKER], `${MY_MARKUP} 배포 순서를 정리해주세요.`);
    await poll();
    expect(bundles.get(merged.id)?.assignment?.unassignedAt).toEqual(expect.any(Number));
    await postingOf(env).post(merged.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(bundles.get(merged.id)?.status).toBe('posted');
  });

  it('게시 직전 확인에서 담당 해제를 찾으면 게시 요청을 보내지 않고 준비됨으로 돌려 해제를 알린다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll, clock } = env;
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll();
    await assign(env);
    /** 준비된 담당 업무 초안. */
    const ready = bundles.state()[0]!;
    /** 게시를 멈춘 까닭. */
    const stops: unknown[] = [];
    bundles.onPostStopped((_, stop) => stops.push(stop));
    setTask(flow, [CO_WORKER]);
    await postingOf(env).post(ready.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(flow.writes).toEqual([]);
    expect(stops).toEqual([{ kind: 'unassigned' }]);
    expect(bundles.get(ready.id)).toMatchObject({ status: 'ready', draft: { createdAt: ready.draft!.createdAt }, assignment: { unassignedAt: expect.any(Number) } });
  });

  it('게시 직전 확인이 실패하면 담당 해제로 기록하지 않고 기존 확인 실패 규칙대로 게시한다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, poll, clock } = env;
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll();
    await assign(env);
    /** 준비된 담당 업무 초안. */
    const ready = bundles.state()[0]!;
    flow.failOn(`GET /user/posts/${TASK_POST}`, { kind: 'http', status: 503 }, 1);
    await postingOf(env).post(ready.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(bundles.get(ready.id)?.assignment?.unassignedAt).toBeUndefined();
    expect(bundles.get(ready.id)?.status).toBe('posted');
  });

  it('담당 해제로 생성을 멈춘 묶음은 재지정 알림으로 다시 만들지 않고, 되돌리면 생성 직전에 담당 여부를 다시 확인한다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, repos, setConnected, clock } = env;
    setConnected(false);
    /** 담당 업무 감지. */
    const detection = await assign(env);
    setTask(flow, [CO_WORKER]);
    setConnected(true);
    await settle();
    /** 담당 해제로 멈춘 묶음. */
    const stopped = bundles.state()[0]!;
    expect(stopped.status).toBe('unassigned');

    await bundles.restore(stopped.id);
    await settle();
    expect(bundles.get(stopped.id)?.status).toBe('unassigned');
    expect(executor.requests).toEqual([]);

    setTask(flow, [ME, CO_WORKER]);
    flow.addWorkerAlarm(alarm('202', { postId: TASK_POST, remarkId: '-1', registeredDateTime: '20261020090500' }));
    clock.advance(60_000);
    await detection.checkNow();
    await settle();
    expect(bundles.state()).toHaveLength(1);
    expect(executor.requests).toEqual([]);

    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await bundles.restore(stopped.id);
    await settle();
    expect(bundles.get(stopped.id)).toMatchObject({ status: 'ready' });
    expect(bundles.get(stopped.id)?.assignment?.unassignedAt).toBeUndefined();
  });

  it('초안 없이 실패한 담당 업무가 감시에서 담당 해제로 확인되면 처리됨의 담당 해제로 옮기고 다시 시도하지 않는다', async () => {
    /** 서비스 검증 환경. */
    const env = await setup();
    const { flow, bundles, executor, poll } = env;
    executor.script({ outcome: { type: 'timed-out' } });
    await poll();
    await assign(env);
    expect(bundles.state()).toMatchObject([{ status: 'failed', draft: null }]);
    setTask(flow, [CO_WORKER]);
    await poll();
    expect(bundles.state()).toMatchObject([{ status: 'unassigned', assignment: { unassignedAt: expect.any(Number) } }]);
    expect(executor.requests).toHaveLength(1);
  });
});

describe('재시작·재시도·재지정 복구', () => {
  /** 담당 업무 게시물. */
  const TASK_POST = 'recovery-task';
  /** 다른 담당자. 실제 사람이 아니다. */
  const CO_WORKER = 'co-worker@example.test';
  /** 업무 생성 시각. 기능 시작 뒤다. */
  const CREATED_AT = '20261020090100';

  /** 앱을 끄고 다시 켜도 그대로인 바깥: Flow, 시계, 에이전트, 저장소 폴더, 설정. */
  function createWorld() {
    /** 매핑된 가짜 저장소. */
    const repos = { a: join(workDir, 'repo-a') };
    mkdirSync(join(repos.a, 'src/main/resources'), { recursive: true });
    writeFileSync(join(repos.a, 'src/main/resources/application-prod.yml'), 'retry: 5\n'.repeat(100));
    const clock = new FakeClock(NOW);
    const flow = new FakeFlowApi();
    flow.respondToListParticipantProjects({ ok: true, value: [{ projectId: PROJECT_ID, title: '가짜 프로젝트', projectUrl: null }] });
    const executor = new FakeExecutor('claude-code');
    const settingsStore = new MemorySettingsStore({ repoMappings: { [PROJECT_ID]: [repos.a] } });
    return { repos, clock, flow, executor, settingsStore, dbPath: join(workDir, 'state.db') };
  }

  /** 실제 `state.db`를 열고 앱 시작과 같은 순서로 서비스를 연결한다. 감지는 켜지 않는다. 처음 열면 나(`FAKE_ME`)로 연결된 기록을 만든다. */
  async function openApp({ clock, flow, executor, settingsStore, dbPath }: ReturnType<typeof createWorld>) {
    /** 다시 열 때 이전 기록을 그대로 읽는 실제 SQLite 연결. */
    const db = openStateDatabase(dbPath, STATE_MIGRATIONS, '0.1.0');
    const stateStore = new SqliteStateStore(db);
    if (!(await stateStore.getAccount())) {
      await stateStore.setAccount({ ...FAKE_ME });
      await stateStore.setBaselineAlarmId('100');
    }
    /** 이 앱이 연결된 계정. 키 확인으로 다른 계정이 되면 바뀐다. */
    let me = (await stateStore.getAccount())!;
    const logger = createLogger([{ write: () => {} }], clock);
    /** 지금 키로 부르는 가짜 Flow. */
    const connectFlow = () => ({ api: flow, reportKeyRejected: () => {} });
    const repoMappings = new RepoMappings({ settingsStore, logger, connectFlow });
    await repoMappings.load();
    const bundles = new MentionBundles({
      stateStore,
      notifier: new RecordingNotifier(),
      clock,
      logger,
      findMyAnswers: (place) => new MentionJudge(flow, me.userId).myAnswers(place, [me.userId]),
      collectContext: (bundle) => collectBundleContext(flow, bundle, clock.now(), [me.userId]),
      resolveRepos: (projectId) => repoMappings.resolve(projectId),
    });
    await bundles.load();
    await bundles.recoverAfterRestart();
    /** 설정 창의 Flow 계정. 앱처럼 다른 계정이 연결되면 묶음을 새 기록으로 다시 읽는다. */
    const flowAccount = new FlowAccount({ connectFlow: () => flow, secretStore: new MemorySecretStore(), stateStore, clock, logger,
      problems: new GlobalProblems({ notifier: new RecordingNotifier(), clock, logger, notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }) }) });
    await flowAccount.load();
    flowAccount.onChange(({ account: connected }) => {
      if (!connected || connected.userId === me.userId) return;
      me = connected;
      void bundles.load();
    });
    const drafts = new DraftQueue({
      bundles,
      agent: () => ({ executor, model: null, confirmForRun: async () => true }),
      onAgentChange: () => () => {},
      flowKeyUsable: () => true,
      onFlowKeyChange: () => () => {},
      settingsStore,
      stateStore,
      myName: () => me.name,
      projectTitle: (projectId) => repoMappings.projectTitle(projectId),
      clock,
      logger,
    });
    await drafts.start();
    const assignments = new AssignmentDetection({ stateStore, bundles, clock, connectFlow });
    const detection = new MentionDetection({ assignments, stateStore, bundles, clock, logger, connectFlow });
    const posting = new Posting({ bundles, connectFlow, myUserId: () => me.userId, clock, logger });
    /** 앱을 끈다. 폴링과 대기열을 멈추고 DB를 닫는다. */
    const quit = async () => {
      detection.stop();
      await drafts.stop();
      db.close();
    };
    return { stateStore, bundles, drafts, detection, posting, flowAccount, quit };
  }

  /** 생성 시 나와 다른 담당자를 지정한 업무를 둔다. `workerIds`로 지금 담당자를 바꾼다. */
  function setTask(flow: FakeFlowApi, workerIds: string[] | null, contents = '배포 순서를 정리해주세요.') {
    flow.addPost({ postId: TASK_POST, title: '복구할 업무', registerId: SENDER, registerName: '업무 작성자',
      registeredDateTime: CREATED_AT, editedDateTime: CREATED_AT,
      textComponents: [{ contents, mentions: contents.includes(MY_MARKUP) ? [ME] : [] }],
      tasks: [{ taskId: 'recovery-task-id', workerIds, completion: 'active',
        workerNames: (workerIds ?? []).map((userId) => ({ userId, name: userId === ME ? FAKE_ME.name : '다른 담당자' })) }] });
  }

  /** 폴링 한 주기를 보내고 이어지는 일을 끝까지 돌린다. */
  async function nextPoll(clock: FakeClock) {
    clock.advance(POLL_MS);
    await settle();
  }

  it('생성 중 앱을 끄고 다시 켜면 같은 묶음을 이어 만들고, 반복 알림·일반 댓글·해제 후 재지정으로 초기 초안을 다시 만들지 않는다', async () => {
    /** 재시작 사이에 그대로인 바깥. */
    const world = createWorld();
    const { clock, flow, executor, repos } = world;
    /** 처음 켠 앱. */
    const first = await openApp(world);
    await first.detection.start();
    await settle();
    /** 기능을 처음 시작한 시각. */
    const enabledAt = (await first.stateStore.getAssignmentState())?.enabledAt;
    expect(enabledAt).toBe(NOW);
    setTask(flow, [ME, CO_WORKER]);
    flow.addWorkerAlarm(alarm('201', { postId: TASK_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    executor.script({ outcome: 'wait-for-abort' });
    await nextPoll(clock);
    expect(first.bundles.state()).toMatchObject([{ status: 'generating', assignment: { taskId: 'recovery-task-id' } }]);
    await first.quit();
    expect(executor.requests[0]?.signal.aborted).toBe(true);

    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    /** 다시 켠 앱. */
    const second = await openApp(world);
    await second.detection.start();
    await settle();
    /** 이어 만든 같은 묶음. */
    const resumed = second.bundles.state()[0]!;
    expect(second.bundles.state()).toHaveLength(1);
    expect(resumed).toMatchObject({ status: 'ready', mentions: [] });
    expect(resumed.runs.map((run) => run.result)).toEqual(['app-quit', 'succeeded']);
    expect((await second.stateStore.getAssignmentState())?.enabledAt).toBe(enabledAt);

    flow.addComment(TASK_POST, { commentId: '901', contents: '일정 공유합니다.', registerId: CO_WORKER, registeredDateTime: '20261020091000' });
    flow.addWorkerAlarm(alarm('202', { postId: TASK_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    flow.addWorkerAlarm(alarm('203', { postId: TASK_POST, remarkId: '901', registerId: CO_WORKER, registeredDateTime: '20261020091000' }));
    await nextPoll(clock);
    setTask(flow, [CO_WORKER]);
    flow.addComment(TASK_POST, { commentId: '902', contents: '', registerId: SENDER, registeredDateTime: '20261020091500',
      systemCode: `S41^^'${FAKE_ME.name}', '다른 담당자'^^'다른 담당자'` });
    await nextPoll(clock);
    expect(second.bundles.get(resumed.id)?.assignment?.unassignedAt).toEqual(expect.any(Number));
    await second.quit();

    /** 해제를 기록한 뒤 다시 켠 앱. */
    const third = await openApp(world);
    expect(third.bundles.get(resumed.id)?.assignment?.unassignedAt).toEqual(expect.any(Number));
    await third.posting.post(resumed.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(flow.writes).toEqual([]);
    expect(third.bundles.get(resumed.id)?.status).toBe('ready');
    await third.detection.start();
    await settle();
    // 다시 나를 추가한 담당 변경 기록이 있어 생성 후 배정의 판정 근거까지 갖춘 재지정이다.
    setTask(flow, [ME, CO_WORKER]);
    flow.addComment(TASK_POST, { commentId: '903', contents: '', registerId: SENDER, registeredDateTime: '20261020092000',
      systemCode: `S41^^'다른 담당자'^^'다른 담당자', '${FAKE_ME.name}'` });
    flow.addWorkerAlarm(alarm('204', { postId: TASK_POST, remarkId: '903', registeredDateTime: '20261020092000' }));
    await nextPoll(clock);
    expect(third.bundles.state()).toHaveLength(1);
    expect(third.bundles.get(resumed.id)?.assignment?.unassignedAt).toBeUndefined();
    expect(executor.requests).toHaveLength(2);

    await third.posting.post(resumed.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(flow.writes).toEqual([{ request: `POST /user/comments/${TASK_POST}`, contents: expect.stringContaining('@[업무 작성자]') }]);
    expect(third.bundles.get(resumed.id)?.status).toBe('posted');
    await third.quit();
  });

  it('생성 중 담당 해제로 멈춘 묶음은 재시작 뒤에도 담당 해제로 남아 재지정 알림으로 다시 만들지 않고, 되돌리면 담당 여부를 다시 확인해 만든다', async () => {
    /** 재시작 사이에 그대로인 바깥. */
    const world = createWorld();
    const { clock, flow, executor, repos } = world;
    /** 처음 켠 앱. */
    const first = await openApp(world);
    await first.detection.start();
    await settle();
    setTask(flow, [ME, CO_WORKER]);
    flow.addWorkerAlarm(alarm('201', { postId: TASK_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    executor.script({ outcome: 'wait-for-abort' });
    await nextPoll(clock);
    setTask(flow, [CO_WORKER]);
    flow.addComment(TASK_POST, { commentId: '902', contents: '', registerId: SENDER, registeredDateTime: '20261020091500',
      systemCode: `S41^^'${FAKE_ME.name}', '다른 담당자'^^'다른 담당자'` });
    await nextPoll(clock);
    /** 담당 해제로 멈춘 묶음. */
    const stopped = first.bundles.state()[0]!;
    expect(stopped).toMatchObject({ status: 'unassigned', draft: null });
    expect(executor.requests[0]?.signal.aborted).toBe(true);
    await first.quit();

    /** 다시 켠 앱. */
    const second = await openApp(world);
    expect(second.bundles.state()).toMatchObject([{ id: stopped.id, status: 'unassigned', assignment: { unassignedAt: expect.any(Number) } }]);
    await second.detection.start();
    await settle();
    setTask(flow, [ME, CO_WORKER]);
    flow.addComment(TASK_POST, { commentId: '903', contents: '', registerId: SENDER, registeredDateTime: '20261020092000',
      systemCode: `S41^^'다른 담당자'^^'다른 담당자', '${FAKE_ME.name}'` });
    flow.addWorkerAlarm(alarm('202', { postId: TASK_POST, remarkId: '903', registeredDateTime: '20261020092000' }));
    await nextPoll(clock);
    expect(second.bundles.state()).toMatchObject([{ id: stopped.id, status: 'unassigned' }]);
    expect(executor.requests).toHaveLength(1);

    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await second.bundles.restore(stopped.id);
    await settle();
    expect(second.bundles.get(stopped.id)?.status).toBe('ready');
    expect(second.bundles.get(stopped.id)?.assignment?.unassignedAt).toBeUndefined();
    expect(second.bundles.state()).toHaveLength(1);
    await second.quit();
  });

  it('실패한 담당 업무 초안은 재시작 뒤에도 실패로 남아 저절로 다시 돌지 않고, 다시 시도와 지시를 덧붙인 재생성은 같은 묶음에서 이어진다', async () => {
    /** 재시작 사이에 그대로인 바깥. */
    const world = createWorld();
    const { clock, flow, executor, repos } = world;
    /** 처음 켠 앱. */
    const first = await openApp(world);
    await first.detection.start();
    await settle();
    setTask(flow, [ME]);
    flow.addWorkerAlarm(alarm('201', { postId: TASK_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    executor.script({ outcome: { type: 'timed-out' } });
    await nextPoll(clock);
    /** 초안 없이 실패한 묶음. */
    const failed = first.bundles.state()[0]!;
    expect(failed).toMatchObject({ status: 'failed', draft: null });
    await first.quit();

    /** 다시 켠 앱. */
    const second = await openApp(world);
    await second.detection.start();
    flow.addWorkerAlarm(alarm('202', { postId: TASK_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    await nextPoll(clock);
    expect(second.bundles.state()).toMatchObject([{ id: failed.id, status: 'failed', draft: null }]);
    expect(executor.requests).toHaveLength(1);

    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await second.drafts.retry(failed.id);
    await settle();
    expect(second.bundles.get(failed.id)?.status).toBe('ready');
    await second.bundles.removeRecipient(failed.id, 0, '업무 작성자');

    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await second.drafts.regenerate(failed.id, { path: 'directive', directive: '배포 전 확인 항목을 더해 주세요.' });
    await settle();
    expect(executor.requests).toHaveLength(3);
    expect(executor.requests[2]?.input).toContain('# 덧붙인 지시\n1. 배포 전 확인 항목을 더해 주세요.');
    expect(executor.requests[2]?.input).toContain('배포 순서를 정리해주세요.');
    expect(second.bundles.state()).toHaveLength(1);
    expect(second.bundles.get(failed.id)).toMatchObject({ status: 'ready', directives: ['배포 전 확인 항목을 더해 주세요.'] });
    expect(bundleRecipients(second.bundles.get(failed.id)!)).toEqual([]);
    await second.quit();

    /** 재생성 뒤 다시 켠 앱. */
    const third = await openApp(world);
    await third.detection.start();
    flow.addWorkerAlarm(alarm('203', { postId: TASK_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    await nextPoll(clock);
    expect(third.bundles.state()).toMatchObject([{ id: failed.id, status: 'ready', directives: ['배포 전 확인 항목을 더해 주세요.'] }]);
    expect(executor.requests).toHaveLength(3);
    await third.quit();
  });

  it('다른 계정으로 바꾸면 이전 계정의 담당 업무 기록·초안·처리 기준이 섞이지 않고, 새 계정은 자기 기준으로 다시 시작한다', async () => {
    /** 재시작 사이에 그대로인 바깥. */
    const world = createWorld();
    const { clock, flow, executor, repos } = world;
    /** 새로 연결할 가짜 계정. 실제 사람이 아니다. */
    const next: FlowEmployee = { userId: 'next@example.test', name: '다음 사용자', division: '다른 팀', email: 'next@example.test' };
    /** 이전 계정으로 켠 앱. */
    const first = await openApp(world);
    await first.detection.start();
    await settle();
    setTask(flow, [ME, next.userId]);
    flow.addWorkerAlarm(alarm('201', { postId: TASK_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    flow.addWorkerAlarm(alarm('202', { postId: TASK_POST, remarkId: '-1', receiverId: next.userId, registeredDateTime: CREATED_AT }));
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await nextPoll(clock);
    expect(first.bundles.state()).toMatchObject([{ status: 'ready', assignment: { taskId: 'recovery-task-id' } }]);
    // 켜 둔 앱에서 다른 사람의 키를 확인하고 계정 바꾸기를 승인하면 기록을 지우고 새 계정으로 시작한다.
    flow.respondToGetMe({ ok: true, value: next });
    expect(await first.flowAccount.checkKey('next-key')).toMatchObject({ kind: 'needs-confirmation' });
    await first.flowAccount.confirmSwitch();
    await settle();
    expect(first.bundles.state()).toEqual([]);
    await nextPoll(clock);
    expect(first.bundles.state()).toEqual([]);
    /** 새 계정이 전환 뒤 첫 조회에서 정한 기능 시작 시각. */
    const nextEnabledAt = (await first.stateStore.getAssignmentState())?.enabledAt;
    expect(await first.stateStore.getAssignmentState()).toMatchObject({ accountId: next.userId, enabledAt: clock.now(), initialPostIds: [TASK_POST] });
    await first.quit();

    /** 새 계정으로 다시 켠 앱. */
    const second = await openApp(world);
    await second.detection.start();
    await settle();
    expect(second.bundles.state()).toEqual([]);
    expect(await second.stateStore.getAssignmentState()).toMatchObject({ accountId: next.userId, enabledAt: nextEnabledAt });

    clock.advance(30 * 60_000);
    flow.addPost({ postId: 'next-task', title: '새 계정의 업무', registerId: SENDER, registerName: '업무 작성자',
      registeredDateTime: '20261020093000', editedDateTime: '20261020093000', textComponents: [{ contents: '새 업무입니다.', mentions: [] }],
      tasks: [{ taskId: 'next-task-id', workerIds: [next.userId], completion: 'active' }] });
    flow.addWorkerAlarm(alarm('203', { postId: 'next-task', remarkId: '-1', receiverId: next.userId, registeredDateTime: '20261020093000' }));
    flow.addWorkerAlarm(alarm('204', { postId: TASK_POST, remarkId: '-1', receiverId: next.userId, registeredDateTime: CREATED_AT }));
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await nextPoll(clock);
    expect(second.bundles.state()).toMatchObject([{ postId: 'next-task', status: 'ready', assignment: { taskId: 'next-task-id' } }]);
    expect(executor.requests).toHaveLength(2);
    await second.quit();
  });

  it('본문 멘션과 합친 묶음은 재시작 뒤에도 두 감지 사유를 지키고, 조회 실패는 해제로 보지 않으며, 담당만 해제되면 게시하고 이후 댓글 멘션은 따로 만든다', async () => {
    /** 재시작 사이에 그대로인 바깥. */
    const world = createWorld();
    const { clock, flow, executor, repos } = world;
    /** 나를 멘션한 업무 본문. */
    const body = `${MY_MARKUP} 배포 순서를 정리해주세요.`;
    /** 처음 켠 앱. */
    const first = await openApp(world);
    await first.detection.start();
    await settle();
    setTask(flow, [ME, CO_WORKER], body);
    flow.addAlarm(alarm('101', { postId: TASK_POST, remarkId: '-1', registerName: '업무 작성자', registeredDateTime: CREATED_AT }));
    flow.addWorkerAlarm(alarm('201', { postId: TASK_POST, remarkId: '-1', registeredDateTime: CREATED_AT }));
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await nextPoll(clock);
    /** 합친 묶음. */
    const merged = first.bundles.state()[0]!;
    expect(first.bundles.state()).toHaveLength(1);
    expect(merged).toMatchObject({ status: 'ready', mentions: [{ remarkId: '-1' }], assignment: { taskId: 'recovery-task-id' } });
    await first.quit();

    /** 다시 켠 앱. */
    const second = await openApp(world);
    expect(second.bundles.state()).toMatchObject([{ id: merged.id, mentions: [{ remarkId: '-1' }], assignment: { taskId: 'recovery-task-id' } }]);
    await second.detection.start();
    await settle();
    flow.failOn(`GET /user/posts/${TASK_POST}`, { kind: 'http', status: 503 }, 1);
    /** 실패를 넣기 전까지의 요청 수. 감시가 실패한 조회를 실제로 거쳤는지 본다. */
    const requestsBefore = flow.requests.length;
    await nextPoll(clock);
    expect(flow.requests.slice(requestsBefore)).toContain(`GET /user/posts/${TASK_POST}`);
    expect(second.bundles.get(merged.id)?.assignment?.unassignedAt).toBeUndefined();

    setTask(flow, [CO_WORKER], body);
    flow.addComment(TASK_POST, { commentId: '902', contents: '', registerId: SENDER, registeredDateTime: '20261020091500',
      systemCode: `S41^^'${FAKE_ME.name}', '다른 담당자'^^'다른 담당자'` });
    flow.addComment(TASK_POST, { commentId: '905', contents: `${MY_MARKUP} 롤백 순서도 알려주세요.`, registerId: SENDER,
      registerName: '업무 작성자', registeredDateTime: '20261020093000' });
    flow.addAlarm(alarm('102', { postId: TASK_POST, remarkId: '905', registerName: '업무 작성자', registeredDateTime: '20261020093000' }));
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await nextPoll(clock);
    expect(second.bundles.get(merged.id)).toMatchObject({ status: 'ready', assignment: { unassignedAt: expect.any(Number) } });
    expect(second.bundles.state().map((bundle) => [bundle.remarkId, bundle.status, !!bundle.assignment]))
      .toEqual(expect.arrayContaining([['-1', 'ready', true], ['905', 'ready', false]]));
    expect(targetMentionOf(executor.requests[1])).toContain('롤백 순서도 알려주세요.');
    await second.quit();

    /** 해제를 기록한 뒤 다시 켠 앱. */
    const third = await openApp(world);
    expect(third.bundles.get(merged.id)?.assignment?.unassignedAt).toEqual(expect.any(Number));
    await third.posting.post(merged.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(flow.writes).toEqual([{ request: `POST /user/comments/${TASK_POST}`, contents: expect.stringContaining('@[업무 작성자]') }]);
    expect(third.bundles.get(merged.id)?.status).toBe('posted');
    expect(executor.requests).toHaveLength(2);
    await third.quit();
  });
});

/** 하루(밀리초). */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 가짜 Flow와 멘션 묶음으로 최근 멘션 확인을 만든다. 쓸 키가 있는지와 Flow가 키를 거부했다고 알린 횟수를 함께 돌려준다. */
function manualCheckOf(flow: FakeFlowApi, bundles: MentionBundles, clock: FakeClock) {
  /** 쓸 키가 있는지 여부와 Flow가 키를 거부했다고 알린 횟수. */
  const env = { hasKey: true, rejected: 0 };
  const check = new ManualMentionCheck({
    bundles,
    connectFlow: () => (env.hasKey ? { api: flow, reportKeyRejected: () => (env.rejected += 1) } : null),
    myUserId: () => ME,
    projectTitle: async (projectId) => (projectId === PROJECT_ID ? '가짜 프로젝트' : null),
    clock,
    logger: createLogger([{ write: () => {} }], clock),
  });
  return { check, env };
}

/** 최근 멘션 확인의 첫 목록을 불러온다. 불러오지 못하면 테스트를 멈춘다. */
async function manualCandidatesOf(check: ManualMentionCheck) {
  /** 불러온 목록. */
  const list = await check.listMentions(null);
  if (!list.ok) throw new Error(`최근 멘션 목록을 불러오지 못했습니다: ${list.reason}`);
  return list.candidates;
}

describe('최근 멘션 확인: 수동 요청 묶음', () => {
  it('72시간이 지난 멘션과 기준점 앞의 멘션도 목록에 나오고, 고르면 게시할 수 있는 수동 요청 묶음이 되며 기준점은 그대로다', async () => {
    const { flow, executor, bundles, stateStore, notifier, clock, repos } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addAlarm(alarm('99'));
    flow.addAlarm(addThreadMention(flow, '101', '701', '닷새 전 질문', '20261015085000'));
    const { check } = manualCheckOf(flow, bundles, clock);

    /** 목록에 보인 멘션. */
    const candidates = await manualCandidatesOf(check);
    expect(candidates.map(({ mention, projectTitle, answered }) => [mention.alarmId, projectTitle, answered])).toEqual([
      ['101', '가짜 프로젝트', false],
      ['99', '가짜 프로젝트', false],
    ]);

    /** 고른 두 멘션으로 만든 결과. */
    const results = [await check.request(candidates[0]!), await check.request(candidates[1]!)];
    await settle();

    expect(results.map((result) => result.kind)).toEqual(['created', 'created']);
    expect(results.map((result) => bundles.get(result.bundleId))).toMatchObject([
      { manual: true, status: 'ready', postTitle: '가짜 게시물', mentions: [expect.objectContaining({ alarmId: '101' })] },
      { manual: true, status: 'ready', mentions: [expect.objectContaining({ alarmId: '99' })] },
    ]);
    expect(executor.requests.map(targetMentionOf)).toEqual(['@테스트 사용자 닷새 전 질문', '@테스트 사용자 재시도는 몇 번 하나요?']);
    expect(notifier.sent).toContainEqual({ title: '초안 준비됨', body: '보낸 사람님 멘션에 답할 초안이 준비됐습니다.', bundleId: results[0]!.bundleId });
    expect(bundles.reviewCount()).toBe(2);
    expect(stateStore.baselineAlarmId).toBe('100');

    expect(await bundles.startPosting(results[0]!.bundleId)).toBe(true);
    expect(await bundles.checkBeforePost(results[0]!.bundleId)).toBe('passed');
  });

  it('나에게 온 멘션이 아닌 알림은 나오지 않고, 더 보기는 다음 10건을 이어 불러오며 끝에서 멈춘다', async () => {
    const { flow, bundles, clock } = await setup();
    flow.alarmPageSize = 5;
    flow.addPost({ postId: '90000099', textComponents: [{ contents: '@전체 공지', mentions: ['ALL'] }] });
    for (let index = 0; index < 12; index += 1) {
      flow.addAlarm(addThreadMention(flow, String(200 + index), String(710 + index), `질문 ${index}`, '20261020085000'));
      if (index === 6) flow.addAlarm(alarm(String(250 + index), { postId: '90000099', remarkId: '-1' }));
    }
    const { check } = manualCheckOf(flow, bundles, clock);

    /** 첫 목록. */
    const first = await check.listMentions(null);
    if (!first.ok) throw new Error('첫 목록을 불러오지 못했습니다.');
    /** 더 보기로 이어 불러온 목록. */
    const second = await check.listMentions(first.next);
    if (!second.ok) throw new Error('이어 불러오지 못했습니다.');

    expect(first.candidates.map((candidate) => candidate.mention.alarmId)).toEqual(['211', '210', '209', '208', '207', '206', '205', '204', '203', '202']);
    expect(second.candidates.map((candidate) => candidate.mention.alarmId)).toEqual(['201', '200']);
    expect(second.next).toBeNull();
  });

  it('이미 묶음이 있는 멘션은 처리됐어도 7일 안이면 새로 만들지 않고 그 묶음을 돌려주고, 최소 기록만 남았으면 최소 기록을 지우고 새로 만든다', async () => {
    const { flow, executor, bundles, stateStore, clock, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    /** 감지해 만든 묶음. */
    const [detected] = bundles.state();
    expect(detected?.status).toBe('ready');
    const { check } = manualCheckOf(flow, bundles, clock);
    /** 그 멘션의 목록 줄. */
    const [candidate] = await manualCandidatesOf(check);

    expect(await check.request(candidate!)).toEqual({ kind: 'existing', bundleId: detected!.id });
    await bundles.ignore(detected!.id);
    clock.advance(6 * DAY_MS);
    expect(await check.request(candidate!)).toEqual({ kind: 'existing', bundleId: detected!.id });
    expect(bundles.state()).toHaveLength(1);

    clock.advance(2 * DAY_MS);
    /** 7일이 지나 최소 기록만 남은 뒤에 고른 결과. */
    const recreated = await check.request(candidate!);
    await settle();

    expect(recreated.kind).toBe('created');
    expect(recreated.bundleId).not.toBe(detected!.id);
    expect(bundles.state()).toMatchObject([{ id: recreated.bundleId, manual: true, status: 'ready' }]);
    expect(await stateStore.listMinimalRecords()).toEqual([]);
    expect(await stateStore.hasMentionLocation(candidate!.mention)).toBe(true);
  });

  it('이미 답한 멘션도 초안을 만들고 실행 직전에도 이미 답함으로 처리하지 않으며, 게시를 누를 때의 확인을 통과한다. 그 뒤의 새 답은 일반 묶음처럼 감시한다', async () => {
    const { flow, executor, bundles, clock, repos, poll } = await setup();
    await poll();
    flow.addReply(POST_ID, '700', { replyId: '800', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085500' });
    flow.respondToListMentionAlarms([alarm('99')]);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    const { check } = manualCheckOf(flow, bundles, clock);
    /** 이미 답한 멘션의 목록 줄. */
    const [candidate] = await manualCandidatesOf(check);
    expect(candidate?.answered).toBe(true);

    /** 고른 결과. */
    const { bundleId } = await check.request(candidate!);
    await settle();

    expect(executor.requests).toHaveLength(1);
    expect(bundles.get(bundleId)).toMatchObject({ manual: true, status: 'ready', mentions: [expect.objectContaining({ answered: false })] });
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('ready');
    expect(await bundles.startPosting(bundleId)).toBe(true);
    expect(await bundles.checkBeforePost(bundleId)).toBe('passed');
    expect(await bundles.cancelPosting(bundleId)).toBe(true);

    flow.addReply(POST_ID, '700', { replyId: '801', contents: '다시 답했습니다', registerId: ME, registeredDateTime: '20261020090500' });
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('already-answered');
  });

  it('수동 요청 묶음을 만든 뒤 같은 멘션 위치의 알림이 와도 자동 감지가 묶음을 만들지 않는다', async () => {
    const { flow, executor, bundles, stateStore, clock, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll();
    flow.addAlarm(alarm('101'));
    const { check } = manualCheckOf(flow, bundles, clock);
    /** 아직 감지하지 않은 기준점 뒤의 멘션. */
    const [candidate] = await manualCandidatesOf(check);

    /** 고른 결과. */
    const { bundleId } = await check.request(candidate!);
    expect(stateStore.baselineAlarmId).toBe('100');
    await poll(alarm('102'));

    expect(bundles.state().map(({ id, manual }) => [id, manual])).toEqual([[bundleId, true]]);
    expect(executor.requests).toHaveLength(1);
  });

  it('무시한 수동 요청 묶음은 기록째 지워지지 않고 처리됨 "무시함"이 되어 되돌릴 수 있다', async () => {
    const { flow, executor, bundles, clock, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll();
    flow.addAlarm(alarm('101'));
    const { check } = manualCheckOf(flow, bundles, clock);
    /** 아직 감지하지 않은 기준점 뒤의 멘션. */
    const [candidate] = await manualCandidatesOf(check);
    /** 고른 결과. */
    const { bundleId } = await check.request(candidate!);
    await settle();

    await bundles.ignore(bundleId);
    expect(bundles.get(bundleId)).toMatchObject({ manual: true, status: 'ignored' });

    await bundles.restore(bundleId);
    expect(bundles.get(bundleId)).toMatchObject({ manual: true });
    expect(bundles.get(bundleId)?.status).not.toBe('ignored');
  });

  it('감지해서 기다리는 묶음보다 앞에서 실행하고, 저장소 매핑이 없는 프로젝트면 일반 묶음처럼 자동 선택을 거쳐 저장소 확인 필요로 올린다', async () => {
    const { flow, executor, bundles, notifier, settingsStore, clock, repos, poll } = await setup();
    /** 저장소가 둘인 작업 폴더. 후보가 둘이어야 선택 실행이 돈다. */
    const work = makeWorkFolder('work', ['api', 'web']);
    settingsStore.settings.workFolders = [work.folder];
    /** 끝나지 않고 기다리는 실행. */
    const run = heldOutcome();
    executor.script({ outcome: run.outcome });
    executor.script({ outcome: { type: 'completed', output: { verdict: 'unrelated', repositories: [], reason: '회의 일정을 묻는 멘션입니다.' } } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'), addThreadMention(flow, '102', '701', '두 번째 질문', '20261020085600'));
    flow.addPost({ postId: '90000021', title: '매핑 없는 게시물', textComponents: [{ contents: `${MY_MARKUP} 회의는 언제인가요?`, mentions: [ME] }] });
    flow.respondToListMentionAlarms([alarm('99', { projectId: UNMAPPED_PROJECT_ID, postId: '90000021', remarkId: '-1' })]);
    const { check } = manualCheckOf(flow, bundles, clock);
    /** 매핑 없는 프로젝트의 멘션. */
    const [candidate] = await manualCandidatesOf(check);

    /** 고른 결과. */
    const { bundleId } = await check.request(candidate!);
    run.release({ type: 'completed', output: draftOutput(repos.a) });
    await settle();

    expect(executor.requests.map((request) => request.kind)).toEqual(['draft', 'selection', 'draft']);
    expect(targetMentionOf(executor.requests[2])).toBe('@테스트 사용자 두 번째 질문');
    expect(bundles.get(bundleId)).toMatchObject({ manual: true, status: 'repo-check-needed', repoCheck: { kind: 'unrelated' } });
    expect(notifier.sent).toContainEqual({ title: '저장소 확인 필요', body: '보낸 사람님이 나를 멘션했습니다.', bundleId });
  });

  it('목록을 불러오지 못하면 키 없음, 키 거부, 연결 실패, 요청 한도를 구분해 돌려주고, 키 거부는 "키 확인 필요"로 알린다', async () => {
    const { flow, bundles, clock } = await setup();
    flow.addAlarm(alarm('101'));
    const { check, env } = manualCheckOf(flow, bundles, clock);

    env.hasKey = false;
    expect(await check.listMentions(null)).toEqual({ ok: false, reason: 'no-key' });
    env.hasKey = true;
    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'unauthorized' } });
    expect(await check.listMentions(null)).toEqual({ ok: false, reason: 'unauthorized' });
    expect(env.rejected).toBe(1);
    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'network' } });
    expect(await check.listMentions(null)).toEqual({ ok: false, reason: 'network' });
    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'rate-limited', retryAfterMs: 30_000 } });
    expect(await check.listMentions(null)).toEqual({ ok: false, reason: 'rate-limited' });
    expect(bundles.state()).toEqual([]);
  });
});

/** 가짜 Flow와 멘션 묶음으로 최근 멘션 확인 시트를 만든다. 시트가 보인 묶음 ID와 열 수 있는지 여부도 함께 돌려준다. */
function manualSessionOf(flow: FakeFlowApi, bundles: MentionBundles, clock: FakeClock) {
  /** 열 수 있는지 여부와 시트가 보인 묶음 ID. */
  const env = { canOpen: true, shown: [] as number[] };
  const { check, env: checkEnv } = manualCheckOf(flow, bundles, clock);
  const session = new ManualCheckSession({ check, canOpen: () => env.canOpen, showBundle: (bundleId) => env.shown.push(bundleId) });
  return { session, env, checkEnv };
}

describe('최근 멘션 확인 시트', () => {
  it('열 수 없으면 열리지 않고, 열면 불러온 뒤 최신순 목록과 더 보기를 보인다. 더 보기는 10건씩 이어 불러오고 끝에서 멈춘다', async () => {
    const { flow, bundles, clock } = await setup();
    flow.alarmPageSize = 5;
    for (let index = 0; index < 12; index += 1) flow.addAlarm(addThreadMention(flow, String(200 + index), String(710 + index), `질문 ${index}`, '20261020085000'));
    const { session, env } = manualSessionOf(flow, bundles, clock);

    env.canOpen = false;
    await session.open('popover');
    expect(session.state()).toEqual({ sheet: null });

    env.canOpen = true;
    await session.open('popover');
    /** 처음 열린 시트. */
    const first = session.state().sheet;
    expect(first).toMatchObject({ window: 'popover', status: 'loaded', hasMore: true, loadingMore: false, moreFailure: null });
    expect(first?.status === 'loaded' && first.candidates.map((candidate) => candidate.mention.alarmId)).toEqual(['211', '210', '209', '208', '207', '206', '205', '204', '203', '202']);

    await session.more();
    /** 더 보기 뒤의 시트. */
    const second = session.state().sheet;
    expect(second?.status === 'loaded' && second.candidates.map((candidate) => candidate.mention.alarmId).slice(10)).toEqual(['201', '200']);
    expect(second).toMatchObject({ hasMore: false });
    // 끝이면 더 불러오지 않는다.
    await session.more();
    expect(session.state().sheet).toEqual(second);
  });

  it('목록을 불러오지 못하면 까닭을 보이고 [다시 불러오기]로 이어 간다. 더 보기에서 실패해도 이미 불러온 목록은 남는다', async () => {
    const { flow, bundles, clock } = await setup();
    flow.alarmPageSize = 5;
    for (let index = 0; index < 12; index += 1) flow.addAlarm(addThreadMention(flow, String(200 + index), String(710 + index), `질문 ${index}`, '20261020085000'));
    const { session, checkEnv } = manualSessionOf(flow, bundles, clock);

    checkEnv.hasKey = false;
    await session.open('settings');
    expect(session.state().sheet).toEqual({ window: 'settings', status: 'failed', reason: 'no-key' });
    checkEnv.hasKey = true;
    await session.reload();
    expect(session.state().sheet).toMatchObject({ window: 'settings', status: 'loaded' });

    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'rate-limited', retryAfterMs: 30_000 } });
    await session.more();
    expect(session.state().sheet).toMatchObject({ status: 'loaded', loadingMore: false, moreFailure: 'rate-limited', hasMore: true });

    session.close();
    expect(session.state()).toEqual({ sheet: null });
    // 닫힌 시트는 다시 불러오지 않는다.
    await session.reload();
    expect(session.state()).toEqual({ sheet: null });
  });

  it('새 멘션을 고르면 수동 요청 묶음이 만들어지고 시트가 닫히며 그 묶음을 보인다. 같은 멘션을 다시 고르면 새로 만들지 않고 그 묶음을 보인다', async () => {
    const { flow, executor, bundles, stateStore, clock, repos } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    flow.addAlarm(addThreadMention(flow, '101', '701', '닷새 전 질문', '20261015085000'));
    const { session, env } = manualSessionOf(flow, bundles, clock);

    await session.open('popover');
    expect(await session.pick('999')).toBeNull();
    /** 고른 결과. */
    const first = await session.pick('101');
    await settle();

    expect(first?.kind).toBe('created');
    expect(session.state()).toEqual({ sheet: null });
    expect(env.shown).toEqual([first!.bundleId]);
    expect(bundles.get(first!.bundleId)).toMatchObject({ manual: true, status: 'ready' });
    // 수동 요청은 감지 기준점을 옮기지 않는다. 기준점은 setup이 정한 그대로다.
    expect(stateStore.baselineAlarmId).toBe('100');

    // 다시 열면 그 줄에 기존 묶음이 보이고, 고르면 그 묶음으로 이동한다.
    await session.open('popover');
    expect(bundles.manualPlaceOf(bundles.get(first!.bundleId)!.mentions[0]!)).toEqual({ kind: 'bundle', bundleId: first!.bundleId, status: 'ready' });
    expect(await session.pick('101')).toEqual({ kind: 'existing', bundleId: first!.bundleId });
    expect(env.shown).toEqual([first!.bundleId, first!.bundleId]);
    expect(bundles.state()).toHaveLength(1);
    expect(executor.requests).toHaveLength(1);
  });

  it('처리한 지 7일이 지나 최소 기록만 남은 줄은 "record"로 보이고, 고르면 최소 기록을 지우고 새 묶음을 만든다', async () => {
    const { flow, executor, bundles, stateStore, clock, repos, poll } = await setup();
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repos.a) } });
    await poll(alarm('101'));
    const [detected] = bundles.state();
    await bundles.ignore(detected!.id);
    clock.advance(8 * DAY_MS);
    await bundles.archiveExpired();
    const { session, env } = manualSessionOf(flow, bundles, clock);

    await session.open('popover');
    /** 목록에 보인 줄. */
    const sheet = session.state().sheet;
    expect(sheet?.status === 'loaded' && sheet.candidates.map((candidate) => bundles.manualPlaceOf(candidate.mention).kind)).toEqual(['record']);

    /** 고른 결과. */
    const result = await session.pick('101');
    await settle();

    expect(result?.kind).toBe('created');
    expect(env.shown).toEqual([result!.bundleId]);
    expect(await stateStore.listMinimalRecords()).toEqual([]);
    expect(bundles.state()).toMatchObject([{ id: result!.bundleId, manual: true }]);
  });
});
