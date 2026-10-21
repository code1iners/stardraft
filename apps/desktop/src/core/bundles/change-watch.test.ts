import { describe, expect, it } from 'vitest';
import { MentionDetection } from '../detection/mention-detection';
import type { Draft } from '../drafts/draft';
import { FakeClock } from '../fakes/fake-clock';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { collectBundleContext } from '../flow/bundle-context';
import { MentionJudge } from '../flow/mention-judgement';
import { createLogger } from '../logging/logger';
import type { FlowAlarm } from '../ports/flow-api';
import type { RepoResolution } from '../repos/repo-mappings';
import { bundleRecipients } from '../drafts/post-body';
import { Posting } from '../posting/posting';
import { bundleChanges } from './bundle-changes';
import { mentionSetKey } from './mention-bundle';
import { MentionBundles } from './mention-bundles';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시(00:00:00 UTC). */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 나(키 소유자)의 사용자 ID. */
const ME = FAKE_ME.userId;
/** 송신자. 실제 사람이 아니다. */
const SENDER = 'sender@example.test';
/** 다른 동료. 실제 사람이 아니다. */
const COLLEAGUE = 'colleague@example.test';
/** 멘션이 온 게시물. */
const POST_ID = '90000011';
/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${ME})`;
/** 폴링 주기(밀리초). */
const POLL_MS = 60_000;
/** 매핑된 저장소 폴더가 사라졌다는 확인 결과. 감지한 묶음은 저장소 확인 필요로 기다리고, 테스트가 저장소를 골라 초안을 담는다. */
const GONE_REPO: RepoResolution = { kind: 'missing-folders', paths: ['/fake/work/gone'] };

/** 가짜 초안. */
const DRAFT: Draft = {
  requirement: { text: '재시도 횟수를 알려 달라는 요구', summary: '재시도 횟수' },
  paragraphs: [{ sentences: [{ text: '재시도는 5번입니다.', evidence: [] }] }],
  evidence: [],
  repositories: ['/fake/work/repo'],
  autoSelection: null,
  createdAt: NOW,
};

/** 가짜 멘션 알림. 기본은 08:50에 온 본문 멘션이다. */
function alarm(alarmId: string, overrides: Partial<FlowAlarm> = {}): FlowAlarm {
  return {
    alarmId,
    projectId: '900001',
    postId: POST_ID,
    remarkId: '-1',
    replyId: '-1',
    receiverId: ME,
    registerId: SENDER,
    registerName: '김철수',
    registeredDateTime: '20261020085000',
    ...overrides,
  };
}

/** 가짜 시계가 부른 일이 끝나도록 대기 중인 비동기 일을 모두 돌린다. 가짜 포트는 모두 바로 답한다. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * 가짜 포트로 감지·멘션 묶음·게시를 만든다. 감지는 폴링마다 변화 감시를 한다.
 * 게시물 본문과 댓글 700에 송신자 "김철수"가 08:50에 나를 멘션했다. `place`가 `post`면 본문 묶음, `thread`면 댓글 700의 댓글 스레드 묶음이다.
 * `ready`가 참이면(기본) 그 묶음의 맥락을 조회해 비교 기준으로 저장하고 초안을 담아 준비됨으로 둔다. 거짓이면 저장소 확인 필요로 둔다.
 */
async function setup(place: 'post' | 'thread', { ready = true }: { ready?: boolean } = {}) {
  /** 가짜 시계. */
  const clock = new FakeClock(NOW);
  /** 가짜 Flow. */
  const flow = new FakeFlowApi();
  /** 메모리 상태 저장소. 계정과 기준점이 있다. */
  const stateStore = new MemoryStateStore();
  stateStore.account = { ...FAKE_ME };
  stateStore.baselineAlarmId = '100';
  /** 진단 로그. 버린다. */
  const logger = createLogger([{ write: () => {} }], clock);
  /** 띄운 OS 알림을 남기는 알림. */
  const notifier = new RecordingNotifier();
  /** 지금 키로 부르는 가짜 Flow. */
  const connectFlow = () => ({ api: flow, reportKeyRejected: () => {} });
  /** 멘션 묶음. */
  const bundles = new MentionBundles({
    stateStore,
    notifier,
    clock,
    logger,
    findMyAnswers: async (bundlePlace) => new MentionJudge(flow, ME).myAnswers(bundlePlace, [ME]),
    collectContext: (bundle) => collectBundleContext(flow, bundle, clock.now(), [ME]),
    resolveRepos: async () => GONE_REPO,
  });
  await bundles.load();
  /** 멘션 감지. 폴링마다 변화 감시를 한다. */
  const detection = new MentionDetection({ stateStore, bundles, clock, logger, connectFlow });
  /** 게시. */
  const posting = new Posting({ bundles, connectFlow, myUserId: () => ME, clock, logger });

  flow.addPost({
    postId: POST_ID,
    title: '가짜 게시물',
    registerId: SENDER,
    registerName: '김철수',
    registeredDateTime: '20261020085000',
    textComponents: [{ contents: `${MY_MARKUP} 재시도는 몇 번 하나요?`, mentions: [ME] }],
  });
  flow.addComment(POST_ID, {
    commentId: '700',
    contents: `${MY_MARKUP} 간격은요?`,
    registerId: SENDER,
    registerName: '김철수',
    registeredDateTime: '20261020085000',
  });

  await detection.start();
  flow.addAlarm(place === 'post' ? alarm('101') : alarm('101', { remarkId: '700' }));
  clock.advance(POLL_MS);
  await settle();

  /** 묶음 ID. */
  const bundleId = bundles.state()[0]!.id;
  if (ready) await makeReady(bundles, bundleId);

  /** 새 알림을 맨 앞에 두고 다음 주기까지 시간을 돌린다. */
  const poll = async (...alarms: FlowAlarm[]) => {
    for (const item of alarms) flow.addAlarm(item);
    clock.advance(POLL_MS);
    await settle();
  };
  return { clock, flow, stateStore, notifier, bundles, detection, posting, bundleId, poll };
}

/** 묶음의 맥락을 새로 조회해 비교 기준으로 저장하고 초안을 담아 준비됨으로 둔다. */
async function makeReady(bundles: MentionBundles, bundleId: number): Promise<void> {
  await bundles.regenerateWithRepos(bundleId, ['/fake/work/repo']);
  await bundles.prepareRun(bundleId);
  await bundles.saveDraft(bundleId, DRAFT, [], mentionSetKey(bundles.get(bundleId)!));
}

/**
 * 댓글 700의 댓글 스레드 묶음에 멘션 두 건(김철수의 댓글 멘션, 이영희의 대댓글 801 멘션)을 담아 준비됨으로 둔다.
 */
async function setupTwoMentions() {
  /** 감지와 묶음. */
  const context = await setup('thread', { ready: false });
  context.flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 저도 궁금해요`, registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085500' });
  await context.poll(alarm('102', { remarkId: '700', replyId: '801', registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085500' }));
  await makeReady(context.bundles, context.bundleId);
  return context;
}

describe('변화 감시: 알리기만 하는 변화', () => {
  it('준비됨 댓글 스레드 묶음에 멘션이 아닌 새 대댓글이 달리면 폴링 뒤 새 글로 알리기만 한다. 다시 만들지 않고 트레이 숫자와 OS 알림도 그대로다', async () => {
    const { flow, notifier, bundles, bundleId, poll } = await setup('thread');
    /** 감시하기 전에 띄운 OS 알림 수. */
    const notified = notifier.sent.length;
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '운영 환경 얘기예요', registerId: SENDER, registerName: '김철수', registeredDateTime: '20261020090100' });

    await poll();

    /** 감시한 뒤의 묶음. */
    const bundle = bundles.get(bundleId)!;
    expect(bundle).toMatchObject({ status: 'ready', draft: DRAFT });
    expect(bundleChanges(bundle)).toEqual({ newWritings: ['reply:801'], editedWritings: [], goneMentions: 0 });
    expect(bundles.reviewCount()).toBe(1);
    expect(bundles.hasFailure()).toBe(false);
    expect(notifier.sent).toHaveLength(notified);
  });
});

describe('변화 감시: 원문 수정과 지켜볼 범위', () => {
  it('멘션 글이 수정되어도 내 표기가 남아 있으면 수정됨으로 알리기만 한다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.editComment(POST_ID, '700', `${MY_MARKUP} 간격은 몇 초인가요?`);

    await poll();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', draft: DRAFT });
    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: [], editedWritings: ['comment:700'], goneMentions: 0 });
  });

  it('댓글 스레드 묶음은 그 스레드 밖의 변화(본문 수정, 다른 댓글과 그 대댓글), 시스템 댓글, 첨부의 변화를 보지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.editPost(POST_ID, [{ contents: `${MY_MARKUP} 재시도는 몇 번 하나요? (수정)`, mentions: [ME] }]);
    flow.addComment(POST_ID, { commentId: '710', contents: '다른 이야기', registerId: COLLEAGUE, registeredDateTime: '20261020090100' });
    flow.addReply(POST_ID, '710', { replyId: '811', contents: '다른 이야기의 대댓글', registerId: COLLEAGUE, registeredDateTime: '20261020090200' });
    flow.addReply(POST_ID, '700', { replyId: '812', contents: '업무 상태를 바꿨습니다.', registerId: COLLEAGUE, systemCode: 'S45_2^^대기^^진행', registeredDateTime: '20261020090300' });

    await poll();

    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: [], editedWritings: [], goneMentions: 0 });
  });

  it('본문 묶음은 게시물 본문과 댓글을 지켜보고 대댓글은 보지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('post');
    flow.editPost(POST_ID, [{ contents: `${MY_MARKUP} 재시도는 몇 번 하나요? 운영 기준입니다.`, mentions: [ME] }]);
    flow.addComment(POST_ID, { commentId: '710', contents: '저도 궁금합니다', registerId: COLLEAGUE, registeredDateTime: '20261020090100' });
    flow.addReply(POST_ID, '700', { replyId: '811', contents: '대댓글은 보지 않는다', registerId: COLLEAGUE, registeredDateTime: '20261020090200' });

    await poll();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', draft: DRAFT });
    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: ['comment:710'], editedWritings: ['post'], goneMentions: 0 });
  });

  it('본문 묶음의 비교 기준에 든 최근 댓글보다 앞선 댓글은 새 글로 세지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('post', { ready: false });
    // 비교 기준을 만들기 전에 댓글이 20개 넘게 달려, 비교 기준에는 최근 20개만 들어간다.
    for (let index = 0; index < 22; index += 1) {
      flow.addComment(POST_ID, { commentId: String(720 + index), contents: `댓글 ${index}`, registerId: COLLEAGUE, registeredDateTime: `202610200851${String(index).padStart(2, '0')}` });
    }
    await makeReady(bundles, bundleId);
    flow.addComment(POST_ID, { commentId: '760', contents: '새 댓글', registerId: COLLEAGUE, registeredDateTime: '20261020090100' });

    await poll();

    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: ['comment:760'], editedWritings: [], goneMentions: 0 });
  });

  it('준비됨 묶음에 합쳐진 새 멘션의 글은 새 글로 따로 세지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    await bundles.editDraft(bundleId, '고친 초안');
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registerName: '김철수', registeredDateTime: '20261020090100' });

    await poll(alarm('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020090100' }));

    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', newMentionCount: 1, editedText: '고친 초안' });
    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: [], editedWritings: [], goneMentions: 0 });
  });

  it('다시 만들면 새 비교 기준과 견주므로 그 전의 변화는 사라진다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '운영 환경 얘기예요', registerId: SENDER, registeredDateTime: '20261020090100' });
    await poll();
    expect(bundleChanges(bundles.get(bundleId)!).newWritings).toEqual(['reply:801']);

    // 감시가 본 새 글이 다시 만들기 전에 지워졌다. 새 비교 기준에는 없으므로 옛 감시 내용과 견주면 안 된다.
    flow.removeReply(POST_ID, '700', '801');
    await bundles.regenerate(bundleId, { path: 'again' });
    expect(bundleChanges(bundles.get(bundleId)!).newWritings).toEqual([]);
    await bundles.prepareRun(bundleId);
    await bundles.saveDraft(bundleId, DRAFT, [], mentionSetKey(bundles.get(bundleId)!));

    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: [], editedWritings: [], goneMentions: 0 });
    await poll();
    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: [], editedWritings: [], goneMentions: 0 });
  });
});

describe('변화 감시: 내 답이 생김', () => {
  it('준비됨 묶음의 댓글 스레드에 멘션보다 나중에 쓴 내 대댓글이 생기면 이미 답함으로 옮기고 초안은 편집본까지 그대로 둔다', async () => {
    const { clock, flow, bundles, bundleId, poll } = await setup('thread');
    await bundles.editDraft(bundleId, '고친 초안');
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '직접 답했습니다', registerId: ME, registeredDateTime: '20261020090100' });

    await poll();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'already-answered', processedAt: clock.now(), draft: DRAFT, editedText: '고친 초안' });
    expect(bundles.reviewCount()).toBe(0);
  });

  it('본문 묶음은 게시물에 쓴 내 댓글만 답으로 본다. 내 대댓글과 내 명의의 시스템 댓글은 답이 아니다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('post');
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '대댓글로 답함', registerId: ME, registeredDateTime: '20261020090100' });
    flow.addComment(POST_ID, { commentId: '710', contents: '업무 상태를 바꿨습니다.', registerId: ME, systemCode: 'S45_2^^대기^^진행', registeredDateTime: '20261020090200' });
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('ready');

    flow.addComment(POST_ID, { commentId: '711', contents: '댓글로 답함', registerId: ME, registeredDateTime: '20261020090300' });
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('already-answered');
  });

  it('멘션보다 먼저 쓴 내 글이나 같은 초에 쓴 내 글은 답으로 보지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '앞서 쓴 글', registerId: ME, registeredDateTime: '20261020084900' });
    flow.addReply(POST_ID, '700', { replyId: '802', contents: '같은 초에 쓴 글', registerId: ME, registeredDateTime: '20261020085000' });

    await poll();

    expect(bundles.get(bundleId)?.status).toBe('ready');
  });

  it('초안이 없는 저장소 확인 필요 묶음은 새 글을 견주지 않고 맥락도 그대로 두며, 내 답이 생기면 이미 답함으로 옮긴다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread', { ready: false });
    /** 감시하기 전의 맥락. */
    const before = bundles.get(bundleId)!.context;
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '운영 환경 얘기예요', registerId: SENDER, registeredDateTime: '20261020090100' });
    await poll();
    expect(bundles.get(bundleId)).toMatchObject({ status: 'repo-check-needed', context: before, watchedContext: null });
    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: [], editedWritings: [], goneMentions: 0 });

    flow.addReply(POST_ID, '700', { replyId: '802', contents: '직접 답했습니다', registerId: ME, registeredDateTime: '20261020090200' });
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('already-answered');
  });

  it('실패 묶음과 게시 실패 묶음도 내 답이 생기면 이미 답함으로 옮긴다', async () => {
    /** 생성이 실패한 묶음. */
    const failed = await setup('thread', { ready: false });
    await failed.bundles.regenerateWithRepos(failed.bundleId, ['/fake/work/repo']);
    await failed.bundles.markFailed(failed.bundleId, { reason: 'timed-out', detail: null, lastStep: null, runKind: 'draft' }, [], null);
    failed.flow.addReply(POST_ID, '700', { replyId: '801', contents: '직접 답했습니다', registerId: ME, registeredDateTime: '20261020090100' });
    await failed.poll();
    expect(failed.bundles.get(failed.bundleId)?.status).toBe('already-answered');

    /** 게시가 실패한 묶음. */
    const postFailed = await setup('thread');
    postFailed.flow.failOn(`POST /user/comments/${POST_ID}/replies/700`, { kind: 'http', status: 403 }, 1);
    await postFailed.posting.post(postFailed.bundleId);
    postFailed.clock.advance(5_000);
    await settle();
    expect(postFailed.bundles.get(postFailed.bundleId)?.status).toBe('post-failed');
    postFailed.flow.addReply(POST_ID, '700', { replyId: '801', contents: '직접 답했습니다', registerId: ME, registeredDateTime: '20261020090100' });
    await postFailed.poll();
    expect(postFailed.bundles.get(postFailed.bundleId)).toMatchObject({ status: 'already-answered', draft: DRAFT });
  });

  it('생성 중 묶음과 게시 중 묶음은 감시하지 않는다', async () => {
    /** 다시 만드는 중인 묶음. */
    const generating = await setup('thread');
    await generating.bundles.regenerate(generating.bundleId, { path: 'again' });
    generating.flow.addReply(POST_ID, '700', { replyId: '801', contents: '직접 답했습니다', registerId: ME, registeredDateTime: '20261020090100' });
    await generating.poll();
    expect(generating.bundles.get(generating.bundleId)?.status).toBe('generating');

    /** 게시 카운트다운 중인 묶음. */
    const posting = await setup('thread');
    await posting.posting.post(posting.bundleId);
    // 게시를 누를 때의 확인이 끝난 뒤에 생긴 답이다. 확인 전에 생겼으면 그 확인이 멈춘다.
    await settle();
    posting.flow.addReply(POST_ID, '700', { replyId: '801', contents: '직접 답했습니다', registerId: ME, registeredDateTime: '20261020090100' });
    await posting.detection.checkNow();
    await settle();
    expect(posting.bundles.get(posting.bundleId)?.status).toBe('posting');
  });
});

describe('변화 감시: 멘션이 사라짐', () => {
  it('멘션 일부가 사라지면 그 멘션을 묶음에서 빼고 준비됨을 유지한다. 그 송신자에게 남은 멘션이 없으면 받는 사람에서 빠진다', async () => {
    const { flow, bundles, bundleId, poll } = await setupTwoMentions();
    expect(bundleRecipients(bundles.get(bundleId)!).map((recipient) => recipient.name)).toEqual(['김철수', '이영희']);
    flow.removeReply(POST_ID, '700', '801');

    await poll();

    /** 감시한 뒤의 묶음. */
    const bundle = bundles.get(bundleId)!;
    expect(bundle).toMatchObject({ status: 'ready', draft: DRAFT });
    expect(bundle.mentions.map((mention) => [mention.alarmId, mention.gone])).toEqual([
      ['101', false],
      ['102', true],
    ]);
    expect(bundleChanges(bundle).goneMentions).toBe(1);
    expect(bundleRecipients(bundle).map((recipient) => recipient.name)).toEqual(['김철수']);
    expect(bundles.reviewCount()).toBe(1);
  });

  it('내 표기만 지워진 멘션 글은 사라진 멘션으로만 알리고 원문 수정으로 세지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setupTwoMentions();
    flow.editReply(POST_ID, '700', '801', '저도 궁금해요 (멘션 지움)');

    await poll();

    expect(bundles.get(bundleId)?.status).toBe('ready');
    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: [], editedWritings: [], goneMentions: 1 });
  });

  it('내 답으로 이미 빠진 멘션은 그 글이 지워져도 사라진 멘션 수에 세지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setupTwoMentions();
    // 김철수의 멘션(08:50)과 이영희의 멘션(08:55) 사이에 내 답을 썼다고 기록되어, 앞선 멘션은 이미 답한 것으로 빠진다.
    flow.addReply(POST_ID, '700', { replyId: '802', contents: '앞의 질문에 답합니다', registerId: ME, registeredDateTime: '20261020085200' });
    await poll();
    expect(bundles.get(bundleId)?.mentions.map((mention) => [mention.alarmId, mention.answered])).toEqual([
      ['101', true],
      ['102', false],
    ]);
    flow.editComment(POST_ID, '700', '간격은요? (멘션 지움)');

    await poll();

    expect(bundles.get(bundleId)?.status).toBe('ready');
    expect(bundleChanges(bundles.get(bundleId)!).goneMentions).toBe(0);
  });

  it('수정되어 내 표기가 빠진 멘션도 사라진 것이다. 멘션이 모두 사라지면 원문 사라짐으로 옮기고 초안은 그대로 둔다', async () => {
    const { clock, flow, bundles, bundleId, poll } = await setup('thread');
    await bundles.editDraft(bundleId, '고친 초안');
    flow.editComment(POST_ID, '700', '간격은요? (멘션 지움)');

    await poll();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'source-gone', processedAt: clock.now(), draft: DRAFT, editedText: '고친 초안' });
    expect(bundles.reviewCount()).toBe(0);
  });

  it('본문 멘션은 표기를 지워도 MENTIONS에 내 ID가 남아 있으면 사라지지 않고, 둘 다 빠지면 사라진다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('post');
    flow.editPost(POST_ID, [{ contents: '재시도는 몇 번 하나요?', mentions: [ME] }]);
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('ready');

    flow.editPost(POST_ID, [{ contents: '재시도는 몇 번 하나요?', mentions: [] }]);
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('source-gone');
  });

  it('게시물이 지워지면(404) 원문 사라짐이다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('post');
    flow.removePost(POST_ID);

    await poll();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'source-gone', draft: DRAFT });
  });

  it('게시물을 볼 수 없게 되면(403) 원문 사라짐이다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.failOn(`GET /user/posts/${POST_ID}`, { kind: 'http', status: 403 });

    await poll();

    expect(bundles.get(bundleId)?.status).toBe('source-gone');
  });

  it('머리 댓글이 지워지면 대댓글 멘션이 남아 있어도 묶음 전체가 원문 사라짐이다', async () => {
    const { flow, bundles, bundleId, poll } = await setupTwoMentions();
    flow.removeComment(POST_ID, '700');

    await poll();

    expect(bundles.get(bundleId)?.status).toBe('source-gone');
    expect(bundles.get(bundleId)?.mentions.every((mention) => mention.gone)).toBe(true);
  });

  it('대댓글 목록이 412(댓글이 존재하지 않음)를 주면 머리 댓글이 지워진 것으로 보고 원문 사라짐이다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    // 대댓글이 10개를 넘어야 대댓글 목록 API를 부른다.
    for (let index = 0; index < 11; index += 1) {
      flow.addReply(POST_ID, '700', { replyId: String(901 + index), contents: `대댓글 ${index}`, registerId: COLLEAGUE, registeredDateTime: '20261020084000' });
    }
    flow.failOn(`GET /user/comments/${POST_ID}/replies/700`, { kind: 'http', status: 412 });

    await poll();

    expect(bundles.get(bundleId)?.status).toBe('source-gone');
  });

  it('네트워크 오류, 5xx, 429는 사라진 것으로 보지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    for (const failure of [{ kind: 'network' }, { kind: 'http', status: 503 }, { kind: 'rate-limited', retryAfterMs: null }] as const) {
      flow.failOn(`GET /user/posts/${POST_ID}`, failure, 1);
      await poll();
      expect(bundles.get(bundleId)?.status).toBe('ready');
    }
  });
});

describe('변화 감시: 되돌린 뒤의 재판정', () => {
  it('이미 답함에서 되돌리면 초안을 가진 채 준비됨으로 돌아오고, 그때 있던 내 답으로는 다시 옮겨지지 않으며 새 글로도 세지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '확인해 볼게요', registerId: ME, registeredDateTime: '20261020090100' });
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('already-answered');

    await bundles.restore(bundleId);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', draft: DRAFT, processedAt: null });
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('ready');
    expect(bundleChanges(bundles.get(bundleId)!)).toEqual({ newWritings: [], editedWritings: [], goneMentions: 0 });

    // 되돌린 뒤 새로 쓴 내 답은 다시 판정한다.
    flow.addReply(POST_ID, '700', { replyId: '802', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020090500' });
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('already-answered');
  });

  it('원문 사라짐에서 되돌리면 사라진 멘션을 기록해 다음 폴링이 다시 옮기지 않는다. 그 멘션은 다시 묶음에 들어 받는 사람도 돌아온다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.editComment(POST_ID, '700', '간격은요? (멘션 지움)');
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('source-gone');

    await bundles.restore(bundleId);
    /** 되돌린 묶음. */
    const restored = bundles.get(bundleId)!;
    expect(restored).toMatchObject({ status: 'ready', draft: DRAFT, processedAt: null });
    expect(restored.mentions.map((mention) => [mention.gone, mention.goneExcluded])).toEqual([[false, true]]);
    expect(bundleRecipients(restored).map((recipient) => recipient.name)).toEqual(['김철수']);

    await poll();
    expect(bundles.get(bundleId)?.status).toBe('ready');
  });

  it('머리 댓글이 지워져 원문 사라짐이 된 묶음도 되돌리면 다음 폴링이 다시 옮기지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.removeComment(POST_ID, '700');
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('source-gone');

    await bundles.restore(bundleId);
    await poll();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', draft: DRAFT });
  });

  it('원문 사라짐에서 되돌리면 그때 있던 내 답도 기록해 이후 판정에서 뺀다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.editComment(POST_ID, '700', '간격은요? (멘션 지움)');
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('source-gone');
    // 처리됨으로 옮겨진 뒤 Flow에 내 답을 썼다.
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '확인해 볼게요', registerId: ME, registeredDateTime: '20261020090100' });

    await bundles.restore(bundleId);
    await poll();

    expect(bundles.get(bundleId)?.status).toBe('ready');
  });

  it('초안이 없는 묶음은 원문 사라짐에서 되돌리면 초안 없이 기다리던 상태로 돌아간다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread', { ready: false });
    flow.removeComment(POST_ID, '700');
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('source-gone');

    await bundles.restore(bundleId);

    expect(bundles.get(bundleId)).toMatchObject({ status: 'repo-check-needed', draft: null, processedAt: null });
  });
});

describe('변화 감시: 이 PC가 게시한 글이 답한 범위', () => {
  /** 댓글 스레드 묶음의 [게시]를 누른다. 5초 뒤 올라갈 대댓글의 시각은 `writtenAt`이다. */
  async function postBundle(context: Awaited<ReturnType<typeof setup>>, bundleId: number, writtenAt: string): Promise<void> {
    context.flow.writtenDateTime = writtenAt;
    await context.posting.post(bundleId);
  }

  it('게시한 글은 게시할 때의 멘션에만 답한 것으로 본다. 카운트다운 중에 와서 새 묶음이 된 멘션은 그 글보다 앞서도 준비된 뒤 이미 답함이 되지 않는다', async () => {
    /** 감지·묶음·게시. */
    const context = await setup('thread');
    const { clock, flow, bundles, detection, bundleId, poll } = context;
    await postBundle(context, bundleId, '20261020090010');
    // 게시를 누를 때의 확인이 끝난 뒤에 온 멘션이다.
    await settle();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020090005' });
    flow.addAlarm(alarm('102', { remarkId: '700', replyId: '801', registerId: COLLEAGUE, registeredDateTime: '20261020090005' }));
    await detection.checkNow();
    await settle();
    clock.advance(5_000);
    await settle();
    expect(bundles.get(bundleId)?.status).toBe('posted');

    /** 카운트다운 중에 온 멘션의 새 묶음. */
    const created = bundles.state().find((bundle) => bundle.id !== bundleId)!;
    expect(bundles.get(bundleId)?.posting?.answeredMentions).toEqual([{ postId: POST_ID, remarkId: '700', replyId: '-1' }]);
    await makeReady(bundles, created.id);
    await poll();

    expect(bundles.get(created.id)?.status).toBe('ready');
  });

  it('게시한 글이 답한 범위에 든 멘션은 Flow의 작성 시각과 관계없이 그 글로 답한 것으로 본다', async () => {
    /** 감지·묶음·게시. */
    const context = await setup('thread');
    const { clock, flow, stateStore, bundles, bundleId, poll } = context;
    await postBundle(context, bundleId, '20261020085900');
    clock.advance(5_000);
    await settle();
    // 게시를 누를 때 조회한 내용에 대댓글 802의 멘션도 있었다. Flow의 작성 시각은 게시한 글보다 늦게 찍혀 있다.
    // 그 조회와 범위 저장은 게시를 누를 때의 확인이 맡으므로, 여기서는 저장된 범위를 직접 넣는다.
    flow.addReply(POST_ID, '700', { replyId: '802', contents: `${MY_MARKUP} 이것도요`, registerId: COLLEAGUE, registeredDateTime: '20261020090000' });
    /** 게시한 묶음. */
    const posted = bundles.get(bundleId)!;
    await stateStore.saveBundle({
      ...posted,
      posting: { ...posted.posting!, answeredMentions: [...posted.posting!.answeredMentions, { postId: POST_ID, remarkId: '700', replyId: '802' }] },
    });
    await bundles.load();

    await poll(alarm('103', { remarkId: '700', replyId: '802', registerId: COLLEAGUE, registeredDateTime: '20261020090000' }));

    expect(bundles.state().find((bundle) => bundle.id !== bundleId)?.status).toBe('already-answered');
  });
});

describe('변화 감시: 조회하지 못할 때', () => {
  it('요청 한도(429)에 걸리면 이번 감시를 멈추고 다음 폴링에 다시 본다. 서버 오류는 그 묶음만 건너뛰고 다음 묶음을 본다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    await poll(alarm('102', { registeredDateTime: '20261020085500' }));
    /** 대기열에서 댓글 스레드 묶음 다음에 오는 본문 묶음. */
    const postBundleId = bundles.state().find((bundle) => bundle.id !== bundleId)!.id;
    flow.addComment(POST_ID, { commentId: '711', contents: '댓글로 답함', registerId: ME, registeredDateTime: '20261020090100' });

    flow.failOn(`GET /user/posts/${POST_ID}`, { kind: 'rate-limited', retryAfterMs: null }, 1);
    await poll();
    expect(bundles.get(postBundleId)?.status).toBe('repo-check-needed');

    flow.failOn(`GET /user/posts/${POST_ID}`, { kind: 'http', status: 503 }, 1);
    await poll();
    expect(bundles.get(bundleId)?.status).toBe('ready');
    expect(bundles.get(postBundleId)?.status).toBe('already-answered');
  });

  it('알림 목록을 조회하지 못한 폴링에서는 감시하지 않는다', async () => {
    const { flow, bundles, bundleId, poll } = await setup('thread');
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '직접 답했습니다', registerId: ME, registeredDateTime: '20261020090100' });
    flow.failOn('GET /user/alarms', { kind: 'network' }, 1);

    await poll();
    expect(bundles.get(bundleId)?.status).toBe('ready');

    await poll();
    expect(bundles.get(bundleId)?.status).toBe('already-answered');
  });
});
