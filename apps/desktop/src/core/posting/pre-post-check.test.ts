import { describe, expect, it } from 'vitest';
import { bundleChanges } from '../bundles/bundle-changes';
import { mentionSetKey, type PostStop } from '../bundles/mention-bundle';
import { MentionBundles } from '../bundles/mention-bundles';
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
import { Posting } from './posting';

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
/** 게시 취소 카운트다운(밀리초). */
const COUNTDOWN_MS = 5_000;
/** 카운트다운이 끝난 뒤 게시 전 확인을 기다려 주는 시간(밀리초). */
const CHECK_GRACE_MS = 5_000;
/** 폴링 주기(밀리초). */
const POLL_MS = 60_000;
/** 매핑된 저장소 폴더가 사라졌다는 확인 결과. 감지한 묶음은 저장소 확인 필요로 기다리고, 테스트가 저장소를 골라 초안을 담는다. */
const GONE_REPO: RepoResolution = { kind: 'missing-folders', paths: ['/fake/work/gone'] };
/** 댓글 스레드 묶음의 대댓글 목록 요청. 게시 전 확인이 맥락을 모을 때 부른다. */
const THREAD_COMMENTS = `GET /user/comments/${POST_ID}`;

/** 가짜 초안. */
const DRAFT: Draft = {
  requirement: { text: '재시도 횟수를 알려 달라는 요구', summary: '재시도 횟수' },
  paragraphs: [{ sentences: [{ text: '재시도는 5번입니다.', evidence: [] }] }],
  evidence: [],
  repositories: ['/fake/work/repo'],
  autoSelection: null,
  createdAt: NOW,
};

/** 가짜 멘션 알림. 기본은 08:50에 댓글 700에 온 댓글 멘션이다. */
function alarm(alarmId: string, overrides: Partial<FlowAlarm> = {}): FlowAlarm {
  return {
    alarmId,
    projectId: '900001',
    postId: POST_ID,
    remarkId: '700',
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
  for (let round = 0; round < 8; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * 가짜 포트로 감지·멘션 묶음·게시를 만든다. 감지는 폴링마다 변화 감시를 한다.
 * 송신자 "김철수"가 08:50에 댓글 700에서 나를 멘션해 댓글 스레드 묶음 하나가 생기고, 맥락을 조회해 초안을 담은 준비됨이 된다.
 * 게시를 멈춘 알림은 `stops`에 쌓인다. `holdContext`를 부르면 돌려준 함수를 부를 때까지 맥락 조회(게시 전 확인, 변화 감시)만 늦춘다.
 */
async function setup() {
  const clock = new FakeClock(NOW);
  const flow = new FakeFlowApi();
  const stateStore = new MemoryStateStore();
  stateStore.account = { ...FAKE_ME };
  stateStore.baselineAlarmId = '100';
  const logger = createLogger([{ write: () => {} }], clock);
  /** 맥락 조회를 붙잡아 둔 문. 없으면 바로 조회한다. */
  let contextGate: Promise<void> | null = null;
  /** 맥락 조회를 붙잡아 두고, 풀어 줄 함수를 돌려준다. 감지의 멘션 판정은 붙잡지 않는다. */
  const holdContext = () => {
    /** 문을 연다. */
    let release!: () => void;
    contextGate = new Promise<void>((resolve) => (release = resolve));
    return () => {
      contextGate = null;
      release();
    };
  };
  const bundles = new MentionBundles({
    stateStore,
    notifier: new RecordingNotifier(),
    clock,
    logger,
    findMyAnswers: async (bundlePlace) => new MentionJudge(flow, ME).myAnswers(bundlePlace, [ME]),
    collectContext: async (bundle) => {
      await contextGate;
      return collectBundleContext(flow, bundle, clock.now(), [ME]);
    },
    resolveRepos: async () => GONE_REPO,
  });
  await bundles.load();
  /** 게시를 멈춘 알림. 받은 순서다. */
  const stops: { bundleId: number; stop: PostStop }[] = [];
  bundles.onPostStopped((bundleId, stop) => stops.push({ bundleId, stop }));
  /** 지금 키로 부르는 가짜 Flow. */
  const connectFlow = () => ({ api: flow, reportKeyRejected: () => {} });
  const detection = new MentionDetection({ stateStore, bundles, clock, logger, connectFlow });
  const posting = new Posting({ bundles, connectFlow, myUserId: () => ME, clock, logger });

  flow.addPost({
    postId: POST_ID,
    title: '가짜 게시물',
    registerId: SENDER,
    registerName: '김철수',
    registeredDateTime: '20261020084000',
    textComponents: [{ contents: '재시도 설정을 정리합니다.', mentions: [] }],
  });
  flow.addComment(POST_ID, {
    commentId: '700',
    contents: `${MY_MARKUP} 재시도는 몇 번 하나요?`,
    registerId: SENDER,
    registerName: '김철수',
    registeredDateTime: '20261020085000',
  });
  flow.writtenDateTime = '20261020090100';

  await detection.start();
  flow.addAlarm(alarm('101'));
  clock.advance(POLL_MS);
  await settle();

  /** 묶음 ID. */
  const bundleId = bundles.state()[0]!.id;
  await bundles.regenerateWithRepos(bundleId, ['/fake/work/repo']);
  await bundles.prepareRun(bundleId);
  await bundles.saveDraft(bundleId, DRAFT, [], mentionSetKey(bundles.get(bundleId)!));

  /** 새 알림을 맨 앞에 두고 다음 주기까지 시간을 돌린다. */
  const poll = async (...alarms: FlowAlarm[]) => {
    for (const item of alarms) flow.addAlarm(item);
    clock.advance(POLL_MS);
    await settle();
  };
  /** 게시 요청을 받은 수. */
  const postCount = () => flow.requests.filter((request) => request.startsWith('POST')).length;
  return { clock, flow, stateStore, bundles, detection, posting, bundleId, stops, poll, postCount, holdContext };
}

describe('게시를 누를 때의 확인: 이미 답함', () => {
  it('누를 때 Flow에 멘션보다 나중에 쓴 내 답이 있으면 게시하지 않고 이미 답함으로 옮기며, "Flow에 이미 내 답이 있음" 멈춤을 알린다', async () => {
    const { clock, flow, bundles, posting, bundleId, stops, postCount } = await setup();
    await bundles.editDraft(bundleId, '고친 답입니다.');
    // 다른 PC에서 쓴 내 답.
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '다른 데서 쓴 답', registerId: ME, registeredDateTime: '20261020085500' });

    await posting.post(bundleId);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'already-answered', processedAt: NOW + POLL_MS, editedText: '고친 답입니다.', draft: DRAFT });
    expect(posting.countdownEndsAt(bundleId)).toBeNull();
    expect(stops).toEqual([{ bundleId, stop: { kind: 'already-answered' } }]);

    clock.advance(COUNTDOWN_MS + CHECK_GRACE_MS);
    await settle();
    expect(postCount()).toBe(0);
  });
});

describe('게시를 누를 때의 확인: 원문 사라짐', () => {
  it('표기만 빠지고 게시할 자리가 남아 있어도 멈추고 원문 사라짐으로 옮긴다. 되돌리고 다시 누르면 게시된다', async () => {
    const { clock, flow, bundles, posting, bundleId, stops, postCount } = await setup();
    flow.editComment(POST_ID, '700', '재시도는 몇 번 하나요?');

    await posting.post(bundleId);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'source-gone', draft: DRAFT });
    expect(stops).toEqual([{ bundleId, stop: { kind: 'source-gone' } }]);
    clock.advance(COUNTDOWN_MS + CHECK_GRACE_MS);
    await settle();
    expect(postCount()).toBe(0);

    await bundles.restore(bundleId);
    await posting.post(bundleId);
    await settle();
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(postCount()).toBe(1);
    expect(bundles.get(bundleId)?.status).toBe('posted');
  });

  it('댓글 스레드의 머리 댓글이 지워졌으면 멈추고 원문 사라짐으로 옮긴다. 다른 자리로 옮겨 게시하지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId, stops, postCount } = await setup();
    flow.removeComment(POST_ID, '700');

    await posting.post(bundleId);
    await settle();
    clock.advance(COUNTDOWN_MS + CHECK_GRACE_MS);
    await settle();

    expect(bundles.get(bundleId)?.status).toBe('source-gone');
    expect(stops).toEqual([{ bundleId, stop: { kind: 'source-gone' } }]);
    expect(postCount()).toBe(0);
  });
});

describe('게시를 누를 때의 확인: 화면에 없던 변화', () => {
  it('누를 때 화면에 없던 새 글이 있으면 멈추고 준비됨으로 돌려 알림 줄을 붙이며, "새 글 1건" 멈춤을 알린다', async () => {
    const { clock, flow, bundles, posting, bundleId, stops, postCount } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '저도 궁금합니다.', registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' });

    await posting.post(bundleId);
    await settle();

    /** 멈춘 묶음. */
    const stopped = bundles.get(bundleId)!;
    expect(stopped).toMatchObject({ status: 'ready', processedAt: null, draft: DRAFT });
    expect(bundleChanges(stopped)).toMatchObject({ newWritings: ['reply:801'], editedWritings: [], goneMentions: 0 });
    expect(stops).toEqual([{ bundleId, stop: { kind: 'changed', newMentionCount: 0, newWritingCount: 1, edited: false, goneMentionCount: 0 } }]);
    expect(posting.countdownEndsAt(bundleId)).toBeNull();

    clock.advance(COUNTDOWN_MS + CHECK_GRACE_MS);
    await settle();
    expect(postCount()).toBe(0);
  });

  it('누를 때 화면에 없던 원문 수정(내 표기는 남음)도 멈추고 "원문 수정됨"을 알린다', async () => {
    const { flow, bundles, posting, bundleId, stops } = await setup();
    flow.editComment(POST_ID, '700', `${MY_MARKUP} 재시도는 몇 번이고 간격은 얼마인가요?`);

    await posting.post(bundleId);
    await settle();

    expect(bundles.get(bundleId)?.status).toBe('ready');
    expect(bundleChanges(bundles.get(bundleId)!)).toMatchObject({ newWritings: [], editedWritings: ['comment:700'] });
    expect(stops).toEqual([{ bundleId, stop: { kind: 'changed', newMentionCount: 0, newWritingCount: 0, edited: true, goneMentionCount: 0 } }]);
  });

  it('나를 멘션한 새 글도 멈춘다. 멈춘 뒤 다음 폴링에 온 그 알림은 준비됨 규칙으로 합쳐진다(손댄 초안이면 "새 멘션 1건")', async () => {
    const { flow, bundles, posting, bundleId, stops, poll, postCount } = await setup();
    await bundles.editDraft(bundleId, '고친 답입니다.');
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더요`, registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' });

    await posting.post(bundleId);
    await settle();
    expect(stops).toEqual([{ bundleId, stop: expect.objectContaining({ kind: 'changed', newWritingCount: 1 }) }]);

    await poll(alarm('102', { replyId: '801', registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' }));

    expect(bundles.state().map((bundle) => bundle.id)).toEqual([bundleId]);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', newMentionCount: 1, editedText: '고친 답입니다.' });
    expect(bundles.get(bundleId)?.mentions.map((mention) => mention.alarmId)).toEqual(['101', '102']);
    expect(postCount()).toBe(0);
  });

  it('이미 알림 줄에 떠 있던 변화뿐이면 그대로 게시한다', async () => {
    const { clock, flow, bundles, posting, bundleId, stops, poll, postCount } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '저도 궁금합니다.', registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' });
    flow.editComment(POST_ID, '700', `${MY_MARKUP} 재시도는 몇 번이고 간격은 얼마인가요?`);
    await poll();
    expect(bundleChanges(bundles.get(bundleId)!)).toMatchObject({ newWritings: ['reply:801'], editedWritings: ['comment:700'] });

    await posting.post(bundleId);
    await settle();
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(stops).toEqual([]);
    expect(postCount()).toBe(1);
    expect(bundles.get(bundleId)?.status).toBe('posted');
  });

  it('알림 줄에 떠 있던 글이 그 뒤에 또 고쳐졌으면 화면에 없던 수정으로 보고 멈춘다', async () => {
    const { flow, bundles, posting, bundleId, stops, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '저도 궁금합니다.', registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' });
    await poll();
    flow.editReply(POST_ID, '700', '801', '저도 궁금합니다. 간격도요.');

    await posting.post(bundleId);
    await settle();

    expect(bundles.get(bundleId)?.status).toBe('ready');
    expect(stops).toEqual([{ bundleId, stop: { kind: 'changed', newMentionCount: 0, newWritingCount: 0, edited: true, goneMentionCount: 0 } }]);
  });
});

describe('게시를 누를 때의 확인: 일부 멘션이 사라짐', () => {
  it('묶음의 멘션 가운데 일부만 사라졌으면 멈추고 준비됨으로 돌려 "멘션 1건 사라짐"을 알린다. 그 송신자는 받는 사람에서 빠진다', async () => {
    const { flow, bundles, posting, bundleId, stops, poll } = await setup();
    await bundles.editDraft(bundleId, '고친 답입니다.');
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더요`, registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' });
    await poll(alarm('102', { replyId: '801', registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' }));
    flow.removeReply(POST_ID, '700', '801');

    await posting.post(bundleId);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready' });
    expect(bundles.get(bundleId)?.mentions.map((mention) => [mention.alarmId, mention.gone])).toEqual([
      ['101', false],
      ['102', true],
    ]);
    expect(stops).toEqual([{ bundleId, stop: { kind: 'changed', newMentionCount: 0, newWritingCount: 0, edited: false, goneMentionCount: 1 } }]);
  });
});

describe('게시를 누를 때의 확인: 조회 실패와 늦음', () => {
  it('조회가 실패하면(503, 네트워크 오류, 429) 카운트다운이 끝날 때 그대로 게시한다', async () => {
    for (const failure of [{ kind: 'http', status: 503 }, { kind: 'network' }, { kind: 'rate-limited', retryAfterMs: 1_000 }] as const) {
      const { clock, flow, bundles, posting, bundleId, stops, postCount } = await setup();
      flow.failOn(THREAD_COMMENTS, failure, 1);

      await posting.post(bundleId);
      await settle();
      clock.advance(COUNTDOWN_MS - 1);
      await settle();
      expect(postCount()).toBe(0);

      clock.advance(1);
      await settle();
      expect(postCount()).toBe(1);
      expect(bundles.get(bundleId)?.status).toBe('posted');
      expect(stops).toEqual([]);
    }
  });

  it('카운트다운이 끝난 뒤 5초가 지나도 조회가 끝나지 않으면 그대로 게시하고, 늦게 끝난 조회의 결과는 버린다', async () => {
    const { clock, flow, bundles, posting, bundleId, stops, postCount } = await setup();
    /** 붙잡아 둔 댓글 목록 응답을 푼다. */
    const release = flow.hold(THREAD_COMMENTS);
    // 늦게 끝날 조회는 이 답을 보게 된다.
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '다른 데서 쓴 답', registerId: ME, registeredDateTime: '20261020085500' });

    await posting.post(bundleId);
    await settle();
    clock.advance(COUNTDOWN_MS);
    await settle();
    expect(posting.countdownEndsAt(bundleId)).toBeNull();
    expect(bundles.get(bundleId)?.status).toBe('posting');

    clock.advance(CHECK_GRACE_MS - 1);
    await settle();
    expect(postCount()).toBe(0);

    clock.advance(1);
    await settle();
    expect(postCount()).toBe(1);
    expect(bundles.get(bundleId)?.status).toBe('posted');

    release();
    await settle();
    expect(bundles.get(bundleId)?.status).toBe('posted');
    expect(stops).toEqual([]);
  });

  it('카운트다운이 끝난 뒤 5초 안에 조회가 끝나면 그 결과를 따른다. 멈출 까닭이 없으면 그 자리에서 게시한다', async () => {
    const { clock, flow, posting, bundleId, postCount } = await setup();
    const release = flow.hold(THREAD_COMMENTS);

    await posting.post(bundleId);
    await settle();
    clock.advance(COUNTDOWN_MS + 2_000);
    await settle();
    expect(postCount()).toBe(0);

    release();
    await settle();
    expect(postCount()).toBe(1);
  });

  it('카운트다운이 끝난 뒤 5초 안에 끝난 조회가 이미 답함을 찾으면 게시하지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId, stops, postCount } = await setup();
    const release = flow.hold(THREAD_COMMENTS);
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '다른 데서 쓴 답', registerId: ME, registeredDateTime: '20261020085500' });

    await posting.post(bundleId);
    await settle();
    clock.advance(COUNTDOWN_MS + 2_000);
    await settle();
    release();
    await settle();
    clock.advance(CHECK_GRACE_MS);
    await settle();

    expect(postCount()).toBe(0);
    expect(bundles.get(bundleId)?.status).toBe('already-answered');
    expect(stops).toEqual([{ bundleId, stop: { kind: 'already-answered' } }]);
  });

  it('카운트다운 중 취소하면 조회 결과를 버린다. 다시 누르면 새로 조회한다', async () => {
    const { clock, flow, bundles, posting, bundleId, stops, postCount } = await setup();
    const release = flow.hold(THREAD_COMMENTS);
    flow.addReply(POST_ID, '700', { replyId: '801', contents: '다른 데서 쓴 답', registerId: ME, registeredDateTime: '20261020085500' });

    await posting.post(bundleId);
    await settle();
    await posting.cancel(bundleId);
    release();
    await settle();

    expect(bundles.get(bundleId)?.status).toBe('ready');
    expect(stops).toEqual([]);

    await posting.post(bundleId);
    await settle();
    clock.advance(COUNTDOWN_MS + CHECK_GRACE_MS);
    await settle();
    expect(bundles.get(bundleId)?.status).toBe('already-answered');
    expect(postCount()).toBe(0);
  });
});

describe('게시를 누를 때의 확인: 그사이 들어온 멘션', () => {
  /** 댓글 700의 댓글 멘션 위치. */
  const THREAD_MENTION = { postId: POST_ID, remarkId: '700', replyId: '-1' };

  it('확인이 끝나기 전에 들어온 멘션은 합치지 않는 게시 중 규칙 대신 준비됨 규칙으로 합치고 게시를 멈춘다', async () => {
    const { clock, flow, bundles, detection, posting, bundleId, stops, postCount, holdContext } = await setup();
    await bundles.editDraft(bundleId, '고친 답입니다.');
    const release = holdContext();

    await posting.post(bundleId);
    await settle();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더요`, registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' });
    flow.addAlarm(alarm('102', { replyId: '801', registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' }));
    // 감지 뒤의 변화 감시도 붙잡힌 맥락 조회를 기다리므로 폴링이 끝나기를 기다리지 않는다.
    void detection.checkNow();
    await settle();

    expect(bundles.state().map((bundle) => bundle.id)).toEqual([bundleId]);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', newMentionCount: 1, editedText: '고친 답입니다.' });
    expect(posting.countdownEndsAt(bundleId)).toBeNull();
    expect(stops).toEqual([{ bundleId, stop: { kind: 'changed', newMentionCount: 1, newWritingCount: 0, edited: false, goneMentionCount: 0 } }]);

    release();
    clock.advance(COUNTDOWN_MS + CHECK_GRACE_MS);
    await settle();
    expect(postCount()).toBe(0);
    expect(bundles.get(bundleId)?.status).toBe('ready');
  });

  it('손대지 않은 초안이면 확인이 끝나기 전에 들어온 멘션을 합쳐 자동으로 다시 만든다', async () => {
    const { flow, bundles, detection, posting, bundleId, stops, holdContext } = await setup();
    holdContext();

    await posting.post(bundleId);
    await settle();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더요`, registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' });
    flow.addAlarm(alarm('102', { replyId: '801', registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' }));
    void detection.checkNow();
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'generating', draft: null, newMentionCount: 0 });
    expect(stops).toEqual([{ bundleId, stop: expect.objectContaining({ kind: 'changed', newMentionCount: 1 }) }]);
  });

  it('확인이 끝난 뒤 들어온 멘션은 합치지 않고 새 묶음이 되며 게시는 그대로 진행한다. 조회한 내용의 멘션이 게시한 글이 답한 범위로 저장된다', async () => {
    const { clock, flow, stateStore, bundles, detection, posting, bundleId, stops, postCount } = await setup();

    await posting.post(bundleId);
    await settle();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더요`, registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' });
    flow.addAlarm(alarm('102', { replyId: '801', registerId: COLLEAGUE, registerName: '이영희', registeredDateTime: '20261020085800' }));
    await detection.checkNow();
    await settle();
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(postCount()).toBe(1);
    expect(stops).toEqual([]);
    expect(bundles.state().map((bundle) => [bundle.status, bundle.mentions.map((mention) => [mention.alarmId, mention.answered])])).toEqual([
      ['repo-check-needed', [['102', false]]],
      ['posted', [['101', false]]],
    ]);
    expect((await stateStore.listBundles()).find((bundle) => bundle.id === bundleId)?.posting?.answeredMentions).toEqual([THREAD_MENTION]);
  });

  it('조회하지 못하고 게시했으면 게시 요청을 보낼 때 묶음에 남은 멘션을 답한 범위로 저장한다', async () => {
    const { clock, flow, stateStore, posting, bundleId, postCount } = await setup();
    flow.failOn(THREAD_COMMENTS, { kind: 'http', status: 503 }, 1);

    await posting.post(bundleId);
    await settle();
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(postCount()).toBe(1);
    expect((await stateStore.listBundles()).find((bundle) => bundle.id === bundleId)?.posting?.answeredMentions).toEqual([THREAD_MENTION]);
  });
});
