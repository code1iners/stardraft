import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BundledMention, PostingRecord, UnsavedBundle } from './bundles/mention-bundle';
import { MentionBundles } from './bundles/mention-bundles';
import { MentionDetection } from './detection/mention-detection';
import type { Draft, RunRecord } from './drafts/draft';
import { DraftQueue } from './drafts/draft-queue';
import { FakeClock } from './fakes/fake-clock';
import { FakeExecutor } from './fakes/fake-executor';
import { FAKE_ME, FakeFlowApi } from './fakes/fake-flow-api';
import { MemorySettingsStore } from './fakes/memory-settings-store';
import { MemoryStateStore } from './fakes/memory-state-store';
import { RecordingNotifier } from './fakes/recording-notifier';
import { collectBundleContext } from './flow/bundle-context';
import { MentionJudge } from './flow/mention-judgement';
import { createLogger } from './logging/logger';
import { Posting } from './posting/posting';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시(00:00:00 UTC). */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 나(키 소유자)의 사용자 ID. */
const ME = FAKE_ME.userId;
/** 송신자. 실제 사람이 아니다. */
const SENDER = 'sender@example.test';
/** 멘션이 온 Flow 프로젝트. */
const PROJECT_ID = '900001';
/** 멘션이 온 게시물. */
const POST_ID = '90000011';
/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${ME})`;
/** 앱을 끄기 전에 [게시]를 눌러 보낸 게시 본문. 받는 사람 표기 뒤에 편집기 텍스트를 이었다. */
const SENT_BODY = `@[김철수](${SENDER}) 재시도는 5번입니다.`;

/** 테스트마다 만드는 임시 폴더. 저장소 매핑에 연결한 가짜 저장소를 둔다. */
let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'stardraft-restart-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** 가짜 시계가 부른 일과 가짜 포트의 응답, 근거 위치 확인 같은 파일 작업이 끝나도록 기다린다. */
async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** 가짜 초안. 문장 하나에 근거 하나다. `repository`는 저장소 매핑에 연결한 가짜 저장소다. */
function draftOf(repository: string): Draft {
  return {
    requirement: { text: '재시도 횟수를 알려 달라는 요구', summary: '재시도 횟수' },
    paragraphs: [{ sentences: [{ text: '재시도는 5번입니다.', evidence: [1] }] }],
    evidence: [{ id: 1, explanation: '재시도 설정', repository, path: 'config.yml', startLine: 1, endLine: 1, located: true }],
    repositories: [repository],
    autoSelection: null,
    createdAt: NOW,
  };
}

/** 댓글 `commentId`에서 송신자 "김철수"가 나를 멘션한 것. */
function threadMention(commentId: string, alarmId: string, registeredDateTime: string): BundledMention {
  return {
    postId: POST_ID,
    remarkId: commentId,
    replyId: '-1',
    projectId: PROJECT_ID,
    alarmId,
    senderId: SENDER,
    senderName: '김철수',
    registeredDateTime,
    detectedAt: NOW,
    text: `${MY_MARKUP} 재시도는 몇 번 하나요?`,
    answered: false,
    gone: false,
    goneExcluded: false,
  };
}

/** 앱을 켜기 전 `state.db`에 있던 댓글 `commentId`의 댓글 스레드 묶음. */
function seededBundle(commentId: string, alarmId: string, overrides: Partial<UnsavedBundle> = {}): UnsavedBundle {
  return {
    id: null,
    postId: POST_ID,
    remarkId: commentId,
    projectId: PROJECT_ID,
    status: 'ready',
    postTitle: '가짜 게시물',
    connectUrl: null,
    mentions: [threadMention(commentId, alarmId, `202610200850${alarmId.slice(-2)}`)],
    answers: [],
    newMentionCount: 0,
    createdAt: NOW,
    processedAt: null,
    context: null,
    watchedContext: null,
    repoCheck: null,
    userRepos: null,
    draft: null,
    editedText: null,
    removedRecipients: [],
    directives: [],
    fixedRequirement: null,
    regeneration: null,
    failure: null,
    runs: [],
    posting: null,
    quitDuringCountdown: false,
    trial: false,
    ...overrides,
  };
}

/** 게시 요청을 보내기 직전에 적은 보내기 전 기록. 결과(올라간 글의 ID, 실패 사유)가 없다. */
function sentRecord(commentId: string): PostingRecord {
  return { body: SENT_BODY, sentAt: NOW - 60_000, postedId: null, failure: null, answeredMentions: [{ postId: POST_ID, remarkId: commentId, replyId: '-1' }] };
}

/**
 * 앱을 껐다 켜도 남는 것을 만든다. 상태 저장소(`seed`가 앱을 켜기 전에 있던 묶음), Flow, 실행기, 설정, 시계다.
 * 게시물에는 댓글 700~702가 있고 모두 "김철수"가 나를 멘션했다. 가짜 저장소 하나가 그 Flow 프로젝트에 연결되어 있다.
 */
async function environment(seed: readonly UnsavedBundle[]) {
  /** 연결한 가짜 저장소. 초안의 근거 파일이 있다. */
  const repo = join(workDir, 'repo');
  mkdirSync(repo);
  writeFileSync(join(repo, 'config.yml'), 'retry: 5\n');

  const clock = new FakeClock(NOW);
  const flow = new FakeFlowApi();
  const stateStore = new MemoryStateStore();
  stateStore.account = { ...FAKE_ME };
  await stateStore.saveDetectedBundles(seed, '100');
  const executor = new FakeExecutor('claude-code');
  const settingsStore = new MemorySettingsStore({ repoMappings: { [PROJECT_ID]: [repo] } });

  flow.addPost({ postId: POST_ID, title: '가짜 게시물', registerId: SENDER, registerName: '김철수', textComponents: [{ contents: '재시도 설정 글', mentions: [] }] });
  for (const commentId of ['700', '701', '702']) {
    flow.addComment(POST_ID, {
      commentId,
      contents: `${MY_MARKUP} 재시도는 몇 번 하나요?`,
      registerId: SENDER,
      registerName: '김철수',
      registeredDateTime: '20261020085000',
    });
  }
  return { clock, flow, stateStore, executor, settingsStore, repo };
}

/** 앱을 껐다 켜도 남는 것. */
type Environment = Awaited<ReturnType<typeof environment>>;

/**
 * 앱을 켠다. main의 시작 절차와 같은 순서다. 저장한 묶음을 읽고 끊긴 게시와 시험 묶음을 정리한 뒤,
 * 저장된 키를 읽고 나서 초안 대기열을 시작하고 응답을 받지 못한 게시를 확인한다.
 */
async function launch({ clock, flow, stateStore, executor, settingsStore, repo }: Environment) {
  const logger = createLogger([{ write: () => {} }], clock);
  /** 지금 키로 부르는 가짜 Flow. */
  const connectFlow = () => ({ api: flow, reportKeyRejected: () => {} });
  const bundles = new MentionBundles({
    stateStore,
    notifier: new RecordingNotifier(),
    clock,
    logger,
    findMyAnswers: (place) => new MentionJudge(flow, ME).myAnswers(place, [ME]),
    collectContext: (bundle) => collectBundleContext(flow, bundle, clock.now(), [ME]),
    resolveRepos: async () => ({ kind: 'mapped', repos: [repo] }),
  });
  await bundles.load();
  await bundles.recoverAfterRestart();
  const posting = new Posting({ bundles, connectFlow, myUserId: () => ME, clock, logger });
  const drafts = new DraftQueue({
    bundles,
    agent: () => ({ executor, model: null, confirmForRun: async () => true }),
    onAgentChange: () => () => {},
    flowKeyUsable: () => true,
    onFlowKeyChange: () => () => {},
    settingsStore,
    stateStore,
    myName: () => FAKE_ME.name,
    projectTitle: async () => '가짜 프로젝트',
    clock,
    logger,
  });
  const detection = new MentionDetection({ stateStore, bundles, clock, logger, connectFlow });

  // 저장된 키를 읽은 뒤.
  await drafts.start();
  posting.recoverAfterRestart();
  await settle();

  /** 앱을 끈다. main이 끝내기 전에 하는 정리와 같은 순서다. */
  const quit = async () => {
    detection.stop();
    await Promise.all([drafts.stop(), posting.stop()]);
    await bundles.whenIdle();
  };
  return { bundles, posting, drafts, detection, quit };
}

/** 가짜 초안 실행 출력. 요구 요약(`summary`)으로 어느 실행의 초안인지 가린다. `repository`는 연결한 가짜 저장소다. */
function draftOutput(repository: string, summary: string) {
  return {
    requirement: { text: '재시도 횟수를 알려 달라는 요구', summary },
    paragraphs: [{ sentences: [{ text: '재시도는 5번입니다.', evidence: [1] }] }],
    evidence: [{ id: 1, explanation: '재시도 설정', repository, path: 'config.yml', start_line: 1, end_line: 1 }],
  };
}

/** 묶음마다 댓글 자리와 상태, 초안이 있으면 그 요구 요약. 묶음 ID 순서다. */
function summaries(bundles: MentionBundles): [string, string, string | null][] {
  return bundles
    .state()
    .sort((a, b) => a.id - b.id)
    .map((bundle) => [bundle.remarkId, bundle.status, bundle.draft?.requirement.summary ?? null]);
}

describe('다시 켜기: 카운트다운 중에 꺼진 게시', () => {
  it('카운트다운 중이던 묶음은 게시하지 않고 준비됨으로 돌아오며 "앱이 꺼져서 게시하지 않았습니다"를 띄울 표시가 붙는다. 편집 중이던 초안은 그대로다', async () => {
    const env = await environment([seededBundle('700', '101', { status: 'posting', draft: draftOf('/fake/repo'), editedText: '재시도는 다섯 번입니다.' })]);

    const { bundles } = await launch(env);

    expect(bundles.state()).toMatchObject([{ status: 'ready', posting: null, quitDuringCountdown: true, editedText: '재시도는 다섯 번입니다.' }]);
    expect(env.flow.writes).toEqual([]);
    await expect(env.stateStore.listBundles()).resolves.toMatchObject([{ status: 'ready', quitDuringCountdown: true }]);
  });

  it('그 표시는 다시 [게시]하거나(취소해도), 다시 만들거나, 무시했다가 되돌리면 지운다', async () => {
    /** 카운트다운 중에 꺼진 묶음. */
    const interrupted = { status: 'posting', draft: draftOf('/fake/repo') } as const;
    const env = await environment([seededBundle('700', '101', interrupted), seededBundle('701', '102', interrupted), seededBundle('702', '103', interrupted)]);
    const { bundles, posting, drafts } = await launch(env);
    expect(bundles.state().map(({ quitDuringCountdown }) => quitDuringCountdown)).toEqual([true, true, true]);
    // 다시 만드는 실행은 끝나지 않고 기다린다.
    env.executor.script({ outcome: 'wait-for-abort' });

    await posting.post(1);
    await posting.cancel(1);
    await drafts.regenerate(2, { path: 'again' });
    await bundles.ignore(3);
    await bundles.restore(3);

    expect(bundles.get(1)).toMatchObject({ status: 'ready', quitDuringCountdown: false });
    expect(bundles.get(2)).toMatchObject({ status: 'generating', quitDuringCountdown: false });
    expect(bundles.get(3)).toMatchObject({ status: 'ready', quitDuringCountdown: false });
  });
});

describe('다시 켜기: 응답을 받지 못하고 꺼진 게시', () => {
  it('첫 조회가 끝나기 전에는 게시 중(게시 결과 확인 중)으로 남는다', async () => {
    const env = await environment([seededBundle('700', '101', { status: 'posting', draft: draftOf('/fake/repo'), posting: sentRecord('700') })]);
    env.flow.hold(`GET /user/comments/${POST_ID}`);

    const { bundles } = await launch(env);

    expect(bundles.state()).toMatchObject([{ status: 'posting', posting: { body: SENT_BODY, postedId: null, failure: null } }]);
  });

  it('첫 조회에서 이 PC가 기록한 적 없는 내 글 가운데 게시 본문과 같은 글을 찾으면 그 ID로 게시됨이 된다. 다시 보내지 않는다', async () => {
    const env = await environment([seededBundle('700', '101', { status: 'posting', draft: draftOf('/fake/repo'), posting: sentRecord('700') })]);
    env.flow.addReply(POST_ID, '700', { replyId: '950', contents: SENT_BODY, registerId: ME, registeredDateTime: '20261020085900' });

    const { bundles } = await launch(env);

    expect(bundles.state()).toMatchObject([{ status: 'posted', posting: { postedId: '950', failure: null } }]);
    expect(env.flow.writes).toEqual([]);
  });

  it('첫 조회에서 같은 글이 없으면 게시 실패("앱이 꺼져서 게시하지 못했습니다")가 되고 실패를 한 번 알린다. 초안은 그대로다', async () => {
    const env = await environment([
      seededBundle('700', '101', { status: 'posting', draft: draftOf('/fake/repo'), editedText: '재시도는 5번입니다.', posting: sentRecord('700') }),
    ]);
    // 한 글자 다른 내 글은 올라간 글이 아니다.
    env.flow.addReply(POST_ID, '700', { replyId: '950', contents: `${SENT_BODY}!`, registerId: ME, registeredDateTime: '20261020085900' });
    /** 게시 실패를 알린 묶음. */
    const failed: number[] = [];

    const { bundles } = await launchWatchingFailures(env, failed);

    expect(bundles.state()).toMatchObject([{ status: 'post-failed', posting: { body: SENT_BODY, failure: 'app-quit' }, editedText: '재시도는 5번입니다.' }]);
    expect(failed).toEqual([bundles.state()[0]!.id]);
    expect(env.flow.writes).toEqual([]);
  });

  it('조회하지 못하면 게시 중으로 둔 채 다음 폴링 주기(60초) 뒤 다시 확인하고, 그때 못 찾아도 앱이 꺼진 사유로 게시 실패다', async () => {
    const env = await environment([seededBundle('700', '101', { status: 'posting', draft: draftOf('/fake/repo'), posting: sentRecord('700') })]);
    env.flow.failOn(`GET /user/comments/${POST_ID}`, { kind: 'network' }, 1);

    const { bundles } = await launch(env);
    expect(bundles.state()).toMatchObject([{ status: 'posting', posting: { postedId: null, failure: null } }]);

    env.clock.advance(60_000 - 1);
    await settle();
    expect(bundles.state()[0]?.status).toBe('posting');

    env.clock.advance(1);
    await settle();
    expect(bundles.state()).toMatchObject([{ status: 'post-failed', posting: { failure: 'app-quit' } }]);
  });
});

describe('다시 켜기: 생성 중이던 묶음', () => {
  /** 앱을 끌 때 끊겨 "앱 종료로 중단"으로 남은 초안 실행 기록. */
  const QUIT_RUN: RunRecord = {
    kind: 'draft',
    agent: 'claude-code',
    cliVersion: null,
    model: null,
    startedAt: NOW - 120_000,
    finishedAt: NOW - 60_000,
    result: 'app-quit',
    detail: null,
    lastStep: '파일 읽는 중: RetryConfig.kt',
    fixes: [],
    omittedContextItems: 0,
    usage: null,
  };

  it('앱을 끌 때 남긴 대기열의 순서와 자리 그대로 돌아와, 끊긴 실행의 묶음부터 처음부터 다시 만든다. 남긴 대기열은 한 번만 쓴다', async () => {
    const env = await environment([
      seededBundle('700', '101', { status: 'generating' }),
      seededBundle('701', '102', { status: 'generating' }),
      seededBundle('702', '103', { status: 'generating', runs: [QUIT_RUN] }),
    ]);
    // 끌 때 댓글 702의 실행이 끊겼고, 701은 [다시 시도]로 사용자 행동 자리에, 700은 감지한 자리에서 기다렸다.
    await env.stateStore.setDraftQueue([
      { bundleId: 3, priority: 'resume' },
      { bundleId: 2, priority: 'user' },
      { bundleId: 1, priority: 'auto' },
    ]);
    for (const summary of ['첫째', '둘째', '셋째']) env.executor.script({ outcome: { type: 'completed', output: draftOutput(env.repo, summary) } });

    const { bundles } = await launch(env);

    expect(summaries(bundles)).toEqual([
      ['700', 'ready', '셋째'],
      ['701', 'ready', '둘째'],
      ['702', 'ready', '첫째'],
    ]);
    expect(bundles.get(3)?.runs.map(({ result }) => result)).toEqual(['app-quit', 'succeeded']);
    await expect(env.stateStore.getDraftQueue()).resolves.toEqual([]);
  });

  it('남긴 대기열이 없으면(앱이 정리하지 못하고 꺼짐) 생성 중 묶음을 작은 창 순서로 넣는다', async () => {
    const env = await environment([seededBundle('701', '102', { status: 'generating' }), seededBundle('700', '101', { status: 'generating' })]);
    for (const summary of ['첫째', '둘째']) env.executor.script({ outcome: { type: 'completed', output: draftOutput(env.repo, summary) } });

    const { bundles } = await launch(env);

    expect(summaries(bundles)).toEqual([
      ['701', 'ready', '둘째'],
      ['700', 'ready', '첫째'],
    ]);
  });

  it('꺼져 있던 사이에 Flow에서 답한 묶음은 생성 직전의 확인에서 이미 답함이 되고 실행하지 않는다', async () => {
    const env = await environment([seededBundle('700', '101', { status: 'generating', runs: [QUIT_RUN] })]);
    await env.stateStore.setDraftQueue([{ bundleId: 1, priority: 'resume' }]);
    env.flow.addReply(POST_ID, '700', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085500' });

    const { bundles } = await launch(env);

    expect(bundles.state()).toMatchObject([{ status: 'already-answered', draft: null }]);
    expect(env.executor.requests).toEqual([]);
  });
});

describe('끌 때: 생성 중인 실행', () => {
  it('실행을 끊어 프로세스 트리를 끝내고 그 실행을 "앱 종료로 중단"으로 기록한다. 다시 켜면 끊긴 묶음이 맨 앞, 사용자 행동 자리가 그다음으로 처음부터 다시 돈다', async () => {
    const env = await environment([
      seededBundle('700', '101', { status: 'failed', failure: { reason: 'timed-out', detail: null, lastStep: null, runKind: 'draft' } }),
      seededBundle('701', '102', { status: 'generating' }),
    ]);
    env.executor.script({ progress: [{ step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 }], outcome: 'wait-for-abort' });
    const app = await launch(env);
    // 댓글 701의 초안을 만드는 사이에 댓글 700을 [다시 시도]했다.
    await app.drafts.retry(1);
    await settle();

    await app.quit();

    expect(env.executor.requests[0]?.signal.aborted).toBe(true);
    expect(app.bundles.get(2)).toMatchObject({ status: 'generating', runs: [{ kind: 'draft', result: 'app-quit', lastStep: '파일 읽는 중: RetryConfig.kt' }] });
    expect(app.bundles.get(1)?.status).toBe('generating');

    for (const summary of ['첫째', '둘째']) env.executor.script({ outcome: { type: 'completed', output: draftOutput(env.repo, summary) } });
    const restarted = await launch(env);

    expect(summaries(restarted.bundles)).toEqual([
      ['700', 'ready', '둘째'],
      ['701', 'ready', '첫째'],
    ]);
    expect(restarted.bundles.get(2)?.runs.map(({ result }) => result)).toEqual(['app-quit', 'succeeded']);
  });
});

describe('끌 때: 게시', () => {
  /** 댓글 700에 대댓글을 다는 게시 요청. */
  const REPLY_REQUEST = `POST /user/comments/${POST_ID}/replies/700`;

  /** 준비됨 묶음 하나로 앱을 켜고 [게시]를 눌러 카운트다운이 끝나게 한다. 게시 요청은 붙잡혀 응답을 기다린다. */
  async function launchSending() {
    const env = await environment([seededBundle('700', '101', { draft: draftOf('/fake/repo') })]);
    const app = await launch(env);
    /** 붙잡은 게시 요청의 응답을 놓아 줄 함수. */
    const release = env.flow.hold(REPLY_REQUEST);
    await app.posting.post(1);
    env.clock.advance(5_000);
    await settle();
    expect(env.flow.requests).toContain(REPLY_REQUEST);
    /** 끄기가 끝났는지 여부. */
    const quit = { done: false };
    void app.quit().then(() => (quit.done = true));
    await settle();
    return { env, app, release, quit };
  }

  it('게시 요청 중에 끄면 응답을 기다려 게시됨과 올라간 글의 ID를 기록한 뒤 끝낸다. 확인 창은 없다', async () => {
    const { env, app, release, quit } = await launchSending();
    env.clock.advance(3_000);
    await settle();
    expect(quit.done).toBe(false);

    release();
    await settle();

    expect(quit.done).toBe(true);
    expect(app.bundles.get(1)).toMatchObject({ status: 'posted', posting: { body: SENT_BODY, postedId: '950000001' } });
    await expect(env.stateStore.listBundles()).resolves.toMatchObject([{ status: 'posted', posting: { postedId: '950000001' } }]);
  });

  it('응답을 5초까지 기다리고 그래도 없으면 보내기 전 기록을 둔 채 끝낸다. 다시 켜면 그 자리를 조회해 올라간 글을 찾아 게시됨으로 정한다', async () => {
    const { env, app, quit } = await launchSending();
    env.clock.advance(4_999);
    await settle();
    expect(quit.done).toBe(false);

    env.clock.advance(1);
    await settle();

    expect(quit.done).toBe(true);
    expect(app.bundles.get(1)).toMatchObject({ status: 'posting', posting: { body: SENT_BODY, postedId: null, failure: null } });
    // Flow는 요청을 받아 글을 올렸지만 앱은 응답을 받지 못했다.
    env.flow.addReply(POST_ID, '700', { replyId: '950', contents: SENT_BODY, registerId: ME, registeredDateTime: '20261020090010' });

    const restarted = await launch(env);

    expect(restarted.bundles.get(1)).toMatchObject({ status: 'posted', posting: { postedId: '950' } });
    expect(env.flow.writes).toEqual([]);
  });

  it('카운트다운 중에 끄면 게시 요청을 보내지 않고 기다리지도 않는다. 다시 켜면 준비됨이다', async () => {
    const env = await environment([seededBundle('700', '101', { draft: draftOf('/fake/repo') })]);
    const app = await launch(env);
    await app.posting.post(1);
    env.clock.advance(4_000);
    await settle();

    await app.quit();
    env.clock.advance(10_000);
    await settle();

    expect(env.flow.writes).toEqual([]);
    expect((await launch(env)).bundles.get(1)).toMatchObject({ status: 'ready', quitDuringCountdown: true, posting: null });
  });
});

describe('끌 때: 편집 중인 초안', () => {
  it('마지막으로 친 편집기 내용을 저장한 뒤 끝내고, 다시 켜면 그 텍스트가 그대로 보인다', async () => {
    const env = await environment([seededBundle('700', '101', { draft: draftOf('/fake/repo') })]);
    const app = await launch(env);
    // 묶음 저장이 디스크에 닿기까지 시간이 걸리는 경우를 만든다.
    /** 원래 묶음 저장. */
    const save = env.stateStore.saveBundle.bind(env.stateStore);
    env.stateStore.saveBundle = async (bundle) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      await save(bundle);
    };

    // 편집기가 친 글자마다 보낸 저장을 기다리지 않고 바로 끈다.
    void app.bundles.editDraft(1, '재시도는');
    void app.bundles.editDraft(1, '재시도는 다섯 번입니다.');
    await app.quit();

    // 끄기가 끝난 바로 뒤(state.db를 닫는 때)에 이미 저장되어 있다.
    await expect(env.stateStore.listBundles()).resolves.toMatchObject([{ editedText: '재시도는 다섯 번입니다.' }]);
    expect((await launch(env)).bundles.get(1)).toMatchObject({ status: 'ready', editedText: '재시도는 다섯 번입니다.' });
  });
});

describe('다시 켜기: 진행 중이던 시험 묶음', () => {
  it('시험 묶음은 상태와 상관없이 기록째 지우고 처리됨(최소 기록)에도 남기지 않는다. 시험이 아닌 묶음은 그대로다', async () => {
    const env = await environment([
      seededBundle('700', '101', { status: 'generating', trial: true }),
      seededBundle('701', '102', { status: 'ready', trial: true, draft: draftOf('/fake/repo') }),
      seededBundle('702', '103', { status: 'ready', draft: draftOf('/fake/repo') }),
    ]);

    const { bundles } = await launch(env);

    expect(bundles.state().map(({ remarkId, trial }) => [remarkId, trial])).toEqual([['702', false]]);
    expect((await env.stateStore.listBundles()).map(({ remarkId }) => remarkId)).toEqual(['702']);
    await expect(env.stateStore.listMinimalRecords()).resolves.toEqual([]);
    await expect(env.stateStore.hasMentionLocation({ postId: POST_ID, remarkId: '700', replyId: '-1' })).resolves.toBe(false);
    expect(env.executor.requests).toEqual([]);
  });
});

/** 앱을 켜되, 응답을 받지 못한 게시를 확인하기 전에 게시 실패 알림을 받도록 듣는다. */
async function launchWatchingFailures(env: Environment, failed: number[]) {
  /** 붙잡은 조회를 놓아 줄 함수. */
  const release = env.flow.hold(`GET /user/comments/${POST_ID}`);
  const app = await launch(env);
  app.posting.onFailed((bundleId) => failed.push(bundleId));
  release();
  await settle();
  return app;
}
