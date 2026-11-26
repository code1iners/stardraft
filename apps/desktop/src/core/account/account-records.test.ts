import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MentionBundles } from '../bundles/mention-bundles';
import { BundleRetention } from '../bundles/retention';
import { MentionDetection } from '../detection/mention-detection';
import { DraftQueue } from '../drafts/draft-queue';
import { FakeClock } from '../fakes/fake-clock';
import { FakeExecutor } from '../fakes/fake-executor';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import { MemorySecretStore } from '../fakes/memory-secret-store';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { collectBundleContext } from '../flow/bundle-context';
import { MentionJudge } from '../flow/mention-judgement';
import { createLogger } from '../logging/logger';
import type { FlowAlarm, FlowConnection, FlowEmployee } from '../ports/flow-api';
import { Posting } from '../posting/posting';
import { GlobalProblems } from '../problems/global-problems';
import { RepoMappings } from '../repos/repo-mappings';
import { openStateDatabase, SqliteStateStore, STATE_MIGRATIONS } from '../storage/state-database';
import { AccountRecords } from './account-records';
import { FlowAccount } from './flow-account';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시(00:00:00 UTC). */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 하루(밀리초). */
const DAY_MS = 24 * 60 * 60 * 1000;
/** 폴링 주기(밀리초). */
const POLL_MS = 60_000;
/** 다른 회사의 가짜 계정. 같은 사람이라 이름이 같다. 실제 사람이 아니다. */
const OTHER: FlowEmployee = { userId: 'me@other.test', name: FAKE_ME.name, division: '다른 회사', email: 'me@other.test' };
/** 멘션이 온 Flow 프로젝트. */
const PROJECT_ID = '900001';
/** 멘션이 온 게시물. */
const POST_ID = '90000011';
/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${FAKE_ME.userId})`;
/** 근거 파일. 떠나 있는 동안 비밀 파일 패턴에 들게 한다. */
const EVIDENCE_PATH = 'src/main/resources/application-prod.yml';

/** 테스트마다 만드는 임시 폴더. 가짜 저장소와 `state.db`를 둔다. */
let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'stardraft-account-records-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 가짜 시계가 부른 일과 가짜 포트의 응답, 근거 위치 검증의 파일 읽기가 끝나도록 기다린다. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

/** 근거 하나가 든 가짜 초안 실행 출력. */
function draftOutput(repository: string) {
  return {
    requirement: { text: '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.', summary: '재시도 횟수' },
    paragraphs: [{ sentences: [{ text: '실제 서비스에서는 다섯 번까지 다시 시도합니다.', evidence: [1] }] }],
    evidence: [
      { id: 1, explanation: '운영 설정에서 다시 시도하는 횟수를 5로 정해 둡니다.', repository, path: EVIDENCE_PATH, start_line: 8, end_line: 8 },
    ],
  };
}

/** 실행 요청이 답할 멘션의 글. 입력 문서의 멘션 목록에서 "[답할 대상]"을 붙인 줄 바로 아래 줄이다. */
function targetMentionOf(input: string): string | undefined {
  return /^\d+\. \[답할 대상\][^\n]*\n\s*(.*)$/m.exec(input)?.[1];
}

/** 내 계정의 Flow에 나를 멘션한 댓글 스레드를 하나 더하고 그 멘션의 알림을 돌려준다. 댓글 스레드마다 다른 묶음이 된다. */
function addThreadMention(flow: FakeFlowApi, alarmId: string, commentId: string, registeredDateTime = '20261020085000'): FlowAlarm {
  flow.addComment(POST_ID, { commentId, contents: `${MY_MARKUP} 재시도는 몇 번 하나요? (${commentId})`, registerId: 'sender@example.test', registerName: '보낸 사람', registeredDateTime });
  /** 멘션 알림. */
  const alarm: FlowAlarm = {
    alarmId,
    projectId: PROJECT_ID,
    postId: POST_ID,
    remarkId: commentId,
    replyId: '-1',
    receiverId: FAKE_ME.userId,
    registerId: 'sender@example.test',
    registerName: '보낸 사람',
    registeredDateTime,
  };
  flow.addAlarm(alarm);
  return alarm;
}

/** 앱을 끄고 다시 켜도 그대로인 바깥: 두 회사의 Flow, 시계, 에이전트, 저장소 폴더, 설정, `state.db` 파일. */
function createWorld() {
  /** 매핑된 가짜 저장소. */
  const repo = join(workDir, 'repo-a');
  mkdirSync(join(repo, 'src/main/resources'), { recursive: true });
  writeFileSync(join(repo, EVIDENCE_PATH), 'retry: 5\n'.repeat(20));
  const clock = new FakeClock(NOW);
  /** 키마다의 Flow. 회사가 다르면 Flow도 다르다. */
  const flows = new Map([
    ['key-me', new FakeFlowApi()],
    ['key-other', new FakeFlowApi()],
  ]);
  flows.get('key-me')!.respondToGetMe({ ok: true, value: FAKE_ME });
  flows.get('key-other')!.respondToGetMe({ ok: true, value: OTHER });
  for (const flow of flows.values()) {
    flow.respondToListParticipantProjects({ ok: true, value: [{ projectId: PROJECT_ID, title: '가짜 프로젝트', projectUrl: null }] });
    flow.addPost({ postId: POST_ID, title: '가짜 게시물', registerName: '글쓴이', registeredDateTime: '20261020080000', textComponents: [{ contents: '재시도 설정', mentions: [] }] });
  }
  const executor = new FakeExecutor('claude-code');
  const settingsStore = new MemorySettingsStore({ repoMappings: { [PROJECT_ID]: [repo] } });
  return { repo, clock, flows, executor, settingsStore, dbPath: join(workDir, 'state.db') };
}

/**
 * 실제 `state.db`를 열고 앱 시작과 같은 순서로 서비스를 잇는다. 처음 열면 내 키(`key-me`)로 연결하고 기준점을 잡는다.
 * 앱처럼 키가 바뀌면 그 키로 감지를 다시 시작한다.
 */
async function openApp({ clock, flows, executor, settingsStore, dbPath }: ReturnType<typeof createWorld>) {
  const db = openStateDatabase(dbPath, STATE_MIGRATIONS, '0.1.0');
  const stateStore = new SqliteStateStore(db);
  const logger = createLogger([{ write: () => {} }], clock);
  const notifier = new RecordingNotifier();
  /** 계정 기록을 오가는 일. 묶음·대기열·게시를 만든 뒤 정한다. */
  let records: AccountRecords | null = null;
  const flowAccount: FlowAccount = new FlowAccount({
    connectFlow: (apiKey) => flows.get(apiKey)!,
    secretStore: new MemorySecretStore(),
    stateStore,
    records: { isStored: (userId) => records!.isStored(userId), switchTo: (account) => records!.switchTo(account), resume: () => records!.resume() },
    clock,
    logger,
    problems: new GlobalProblems({ notifier, clock, logger, notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }) }),
  });
  await flowAccount.load();
  /** 지금 쓰는 키로 만든 Flow 연결. */
  const connectFlow = (): FlowConnection | null => {
    /** 지금 쓰는 키. */
    const apiKey = flowAccount.apiKey();
    return apiKey ? { api: flows.get(apiKey)!, reportKeyRejected: () => {} } : null;
  };
  /** 지금 계정의 사용자 ID. */
  const myId = () => flowAccount.state().account?.userId ?? FAKE_ME.userId;
  const repoMappings = new RepoMappings({ settingsStore, logger, connectFlow });
  await repoMappings.load();
  const bundles = new MentionBundles({
    stateStore,
    notifier,
    clock,
    logger,
    findMyAnswers: (place) => new MentionJudge(connectFlow()!.api, myId()).myAnswers(place, [myId()]),
    collectContext: (bundle) => collectBundleContext(connectFlow()!.api, bundle, clock.now(), [myId()]),
    resolveRepos: (projectId) => repoMappings.resolve(projectId),
  });
  await bundles.load();
  await bundles.recoverAfterRestart();
  const drafts = new DraftQueue({
    bundles,
    agent: () => ({ executor, model: null, confirmForRun: async () => true }),
    onAgentChange: () => () => {},
    flowKeyUsable: () => flowAccount.apiKey() !== null,
    onFlowKeyChange: (listener) => flowAccount.onChange(listener),
    settingsStore,
    stateStore,
    myName: () => flowAccount.state().account?.name ?? null,
    projectTitle: async () => '가짜 프로젝트',
    clock,
    logger,
  });
  const posting = new Posting({ bundles, connectFlow, myUserId: () => flowAccount.state().account?.userId ?? null, clock, logger });
  records = new AccountRecords({ bundles, drafts, posting, stateStore, settingsStore, logger });
  const detection = new MentionDetection({ stateStore, bundles, clock, logger, connectFlow });
  const retention = new BundleRetention({ bundles, clock, logger });
  /** 감지를 시작한 키. */
  let detectionKey: string | null = null;
  flowAccount.onChange(() => {
    if (flowAccount.apiKey() === detectionKey) return;
    detectionKey = flowAccount.apiKey();
    void detection.start();
  });
  if (!(await stateStore.getAccount())) {
    await flowAccount.checkKey('key-me');
    await stateStore.setBaselineAlarmId('100');
  }
  await drafts.start();

  /** 다른 계정의 키를 넣고 확인 창에서 [계정 바꾸기]를 누른다. 떠나는 계정의 응답을 기다리는 게시가 있으면 5초를 흘려보낸다. */
  const switchTo = async (apiKey: string) => {
    /** 키 확인 결과. */
    const checked = await flowAccount.checkKey(apiKey);
    expect(checked.kind).toBe('needs-confirmation');
    /** 확인 창이 보여 준 것. */
    const shown = flowAccount.state().keyCheck;
    /** 계정 바꾸기. */
    const confirmed = flowAccount.confirmSwitch();
    await settle();
    clock.advance(5_000);
    await settle();
    expect(await confirmed).toEqual({ kind: 'connected' });
    await settle();
    return shown;
  };
  /** 앱을 끈다. */
  const quit = async () => {
    detection.stop();
    retention.stop();
    await drafts.stop();
    await posting.stop();
    db.close();
  };
  return { stateStore, bundles, drafts, posting, detection, retention, flowAccount, switchTo, quit };
}

/** 폴링 한 주기를 보내고 이어지는 일을 끝까지 돌린다. */
async function nextPoll(clock: FakeClock) {
  clock.advance(POLL_MS);
  await settle();
}

// 계정을 여러 번 오가며 실제 파일을 읽고 쓰므로, 다른 테스트가 함께 도는 부하에서도 기본 5초에 걸리지 않게 넉넉히 준다.
describe('Flow 기록의 계정별 보관', { timeout: 20_000 }, () => {
  it('떠날 때: 생성 중이던 실행은 끊기고, 카운트다운은 게시 없이 준비됨으로 돌아가며, 줄 서 있던 초안은 대기열에서 빠지고 화면에는 새 계정의 기록만 보인다', async () => {
    const world = createWorld();
    const { clock, flows, executor, repo } = world;
    const me = flows.get('key-me')!;
    const app = await openApp(world);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    addThreadMention(me, '101', '701');
    await nextPoll(clock);
    /** 준비됨이 된 첫 묶음. */
    const ready = app.bundles.state()[0]!;
    expect(ready.status).toBe('ready');
    executor.script({ outcome: 'wait-for-abort' });
    addThreadMention(me, '102', '702');
    addThreadMention(me, '103', '703');
    await nextPoll(clock);
    await app.posting.post(ready.id);
    await settle();
    expect(app.bundles.get(ready.id)?.status).toBe('posting');
    expect(executor.requests).toHaveLength(2);

    /** 확인 창이 보여 준 것. */
    const shown = await app.switchTo('key-other');

    expect(shown).toEqual({ status: 'awaiting-confirmation', account: OTHER, stored: false });
    expect(executor.requests[1]?.signal.aborted).toBe(true);
    expect(app.bundles.state()).toEqual([]);
    expect(app.drafts.progress(ready.id + 2)).toBeNull();
    clock.advance(10_000);
    await settle();
    // 카운트다운이 끝날 시각이 지나도 게시하지 않았고, 줄 서 있던 초안도 돌지 않았다.
    expect(me.writes).toEqual([]);
    expect(executor.requests).toHaveLength(2);
    await expect(app.stateStore.isStoredAccount(FAKE_ME.userId)).resolves.toBe(true);
    await app.quit();
  });

  it('돌아왔을 때: 준비됨 초안은 그대로 보이고, 끊긴 생성은 대기열 맨 앞에 다시 서며, 기준점 이후 중 72시간 안의 멘션만 가져온다', async () => {
    const world = createWorld();
    const { clock, flows, executor, repo } = world;
    const me = flows.get('key-me')!;
    const app = await openApp(world);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    addThreadMention(me, '101', '701');
    await nextPoll(clock);
    executor.script({ outcome: 'wait-for-abort' });
    addThreadMention(me, '102', '702');
    addThreadMention(me, '103', '703');
    await nextPoll(clock);
    /** 떠나기 전 묶음. 준비됨, 생성 중(실행 중), 생성 중(대기)이다. */
    const [ready, cut, queued] = app.bundles.state().sort((a, b) => a.id - b.id);
    await app.posting.post(ready!.id);
    await settle();
    await app.switchTo('key-other');

    // 떠나 있는 동안 4일이 지났고, 그 사이 내 회사 Flow에 멘션이 둘 왔다. 하나는 72시간보다 오래됐다.
    clock.advance(4 * DAY_MS);
    addThreadMention(me, '104', '704', '20261020100000');
    addThreadMention(me, '105', '705', '20261024080000');
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    /** 확인 창이 보여 준 것. */
    const shown = await app.switchTo('key-me');
    await nextPoll(clock);

    expect(shown).toEqual({ status: 'awaiting-confirmation', account: FAKE_ME, stored: true });
    // 카운트다운은 떠날 때 게시 없이 준비됨으로 돌아갔다. 앱이 꺼진 것이 아니므로 "앱이 꺼져서 게시하지 않았습니다"는 없다.
    expect(app.bundles.get(ready!.id)).toMatchObject({ status: 'ready', quitDuringCountdown: false, draft: { createdAt: ready!.draft!.createdAt } });
    expect(app.bundles.get(cut!.id)?.status).toBe('ready');
    expect(app.bundles.get(cut!.id)?.runs.map((run) => run.result)).toEqual(['account-left', 'succeeded']);
    expect(app.bundles.get(queued!.id)?.status).toBe('ready');
    // 끊긴 생성이 먼저 다시 돌고, 줄 서 있던 초안이 그 뒤에 돈다.
    expect(executor.requests.slice(2, 4).map((request) => targetMentionOf(request.input))).toEqual([
      expect.stringContaining('(702)'),
      expect.stringContaining('(703)'),
    ]);
    /** 떠나 있던 동안 온 멘션 가운데 가져온 것. */
    const fetched = app.bundles.state().filter((bundle) => ![ready!.id, cut!.id, queued!.id].includes(bundle.id));
    expect(fetched.map((bundle) => bundle.remarkId)).toEqual(['705']);
    expect(me.writes).toEqual([]);
    await app.quit();
  });

  it('응답을 받지 못하고 떠난 게시는 돌아왔을 때 실제로 올라갔는지 확인해 게시됨으로 둔다', async () => {
    const world = createWorld();
    const { clock, flows, executor, repo } = world;
    const me = flows.get('key-me')!;
    const app = await openApp(world);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    addThreadMention(me, '101', '701');
    await nextPoll(clock);
    /** 게시할 묶음. */
    const ready = app.bundles.state()[0]!;
    /** 게시 요청의 응답을 붙잡아 둔 것을 푸는 함수. */
    const release = me.hold(`POST /user/comments/${POST_ID}/replies/701`);
    await app.posting.post(ready.id);
    await settle();
    clock.advance(5_000);
    await settle();
    expect(app.bundles.get(ready.id)?.posting?.sentAt).not.toBeNull();

    await app.switchTo('key-other');
    // 떠난 뒤에 응답이 왔다. Flow에는 올라갔지만 앱은 결과를 기록하지 못했다.
    release();
    await settle();
    expect(me.writes).toHaveLength(1);

    await app.switchTo('key-me');

    expect(app.bundles.get(ready.id)).toMatchObject({ status: 'posted', posting: { postedId: expect.any(String) } });
    expect(me.writes).toHaveLength(1);
    await app.quit();
  });

  it('떠나 있던 동안 비밀 파일 패턴이 추가됐을 때만 돌아온 계정의 게시 전 초안을 지금 규칙대로 다시 검사한다', async () => {
    const world = createWorld();
    const { clock, flows, executor, repo, settingsStore } = world;
    const me = flows.get('key-me')!;
    const app = await openApp(world);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    addThreadMention(me, '101', '701');
    await nextPoll(clock);
    /** 준비됨 묶음. */
    const ready = app.bundles.state()[0]!;

    // 패턴이 그대로면 다시 검사하지 않는다.
    await app.switchTo('key-other');
    await app.switchTo('key-me');
    expect(app.bundles.get(ready.id)?.status).toBe('ready');

    await app.switchTo('key-other');
    await settingsStore.save({ ...(await settingsStore.load()), extraSecretPatterns: ['**/application-prod.yml'] });
    await app.switchTo('key-me');

    expect(app.bundles.get(ready.id)).toMatchObject({ status: 'failed', draft: null, failure: { reason: 'secret-evidence' } });
    expect(executor.requests).toHaveLength(1);
    await app.quit();
  });

  it('처리한 묶음의 7일 규칙은 보관 중인 계정에도 적용되고, 마지막으로 쓴 지 30일이 지난 계정은 처음 넣는 계정처럼 시작한다', async () => {
    const world = createWorld();
    const { clock, flows, executor, repo } = world;
    const me = flows.get('key-me')!;
    const app = await openApp(world);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    addThreadMention(me, '101', '701');
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    addThreadMention(me, '102', '702');
    await nextPoll(clock);
    /** 무시할 묶음과 그대로 둘 묶음. */
    const [ignored, kept] = app.bundles.state().sort((a, b) => a.id - b.id);
    await app.bundles.ignore(ignored!.id);
    await app.switchTo('key-other');

    clock.advance(8 * DAY_MS);
    app.retention.cleanUpNow();
    await settle();
    await app.switchTo('key-me');
    // 보관 중에 7일이 지나 처리됨 목록에서 빠졌다. 처리하지 않은 묶음은 그대로다.
    expect(app.bundles.get(ignored!.id)).toBeNull();
    expect(app.bundles.get(kept!.id)?.status).toBe('ready');

    await app.switchTo('key-other');
    clock.advance(31 * DAY_MS);
    app.retention.cleanUpNow();
    await settle();
    await expect(app.stateStore.isStoredAccount(FAKE_ME.userId)).resolves.toBe(false);
    /** 확인 창이 보여 준 것. */
    const shown = await app.switchTo('key-me');

    expect(shown).toMatchObject({ stored: false });
    expect(app.bundles.state()).toEqual([]);
    // 기준점을 처음부터 다시 잡으므로, 지운 기록의 멘션을 새로 가져오지 않는다.
    await nextPoll(clock);
    expect(app.bundles.state()).toEqual([]);
    expect(executor.requests).toHaveLength(2);
    await app.quit();
  });

  it('떠나기 전에 시작한 감지가 바꾼 뒤에 끝나도, 떠난 계정의 멘션은 새 계정의 기록에 들어가지 않고 돌아왔을 때 가져온다', async () => {
    const world = createWorld();
    const { clock, flows, executor, repo } = world;
    const me = flows.get('key-me')!;
    const app = await openApp(world);
    addThreadMention(me, '101', '701');
    /** 판정에 쓰는 게시물 조회를 붙잡아 둔 것을 푸는 함수. */
    const release = me.hold(`GET /user/comments/${POST_ID}`);
    clock.advance(POLL_MS);
    await settle();

    await app.switchTo('key-other');
    release();
    await settle();
    expect(app.bundles.state()).toEqual([]);
    await expect(app.stateStore.hasMentionLocation({ postId: POST_ID, remarkId: '701', replyId: '-1' })).resolves.toBe(false);

    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    await app.switchTo('key-me');
    await nextPoll(clock);
    expect(app.bundles.state()).toMatchObject([{ remarkId: '701', status: 'ready' }]);
    await app.quit();
  });

  it('다시 켜도 움직이는 계정과 보관한 계정의 기록이 그대로이다', async () => {
    const world = createWorld();
    const { clock, flows, executor, repo } = world;
    const me = flows.get('key-me')!;
    const first = await openApp(world);
    executor.script({ outcome: { type: 'completed', output: draftOutput(repo) } });
    addThreadMention(me, '101', '701');
    await nextPoll(clock);
    await first.switchTo('key-other');
    await first.quit();

    const second = await openApp(world);
    expect(second.flowAccount.state().account).toEqual(OTHER);
    expect(second.bundles.state()).toEqual([]);
    await second.flowAccount.checkKey('key-other');
    await second.switchTo('key-me');
    expect(second.bundles.state()).toMatchObject([{ status: 'ready', remarkId: '701' }]);
    await second.quit();
  });
});
