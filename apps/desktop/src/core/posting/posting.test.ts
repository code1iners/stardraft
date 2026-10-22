import { describe, expect, it } from 'vitest';
import { mentionSetKey } from '../bundles/mention-bundle';
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
/** 멘션이 온 게시물. */
const POST_ID = '90000011';
/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${ME})`;
/** 게시 취소 카운트다운(밀리초). */
const COUNTDOWN_MS = 5_000;
/** 폴링 주기(밀리초). */
const POLL_MS = 60_000;
/** 매핑된 저장소 폴더가 사라졌다는 확인 결과. 감지한 묶음은 저장소 확인 필요로 기다리고, 테스트가 저장소를 골라 초안을 담는다. */
const GONE_REPO: RepoResolution = { kind: 'missing-folders', paths: ['/fake/work/gone'] };

/** 가짜 초안. 두 문단이고 첫 문장에만 근거가 있다. */
const DRAFT: Draft = {
  requirement: { text: '재시도 횟수를 알려 달라는 요구', summary: '재시도 횟수' },
  paragraphs: [
    { sentences: [{ text: '재시도는 5번입니다.', evidence: [1] }, { text: '간격은 2초입니다.', evidence: [] }] },
    { sentences: [{ text: '테스트 환경은 다를 수 있습니다.', evidence: [] }] },
  ],
  evidence: [{ id: 1, explanation: '재시도 설정', repository: '/fake/work/repo', path: 'config.yml', startLine: 3, endLine: 4, located: true }],
  repositories: ['/fake/work/repo'],
  autoSelection: null,
  createdAt: NOW,
};

/** 초안에서 만든 편집기 텍스트. 근거 번호는 들어가지 않는다. */
const DRAFT_TEXT = '재시도는 5번입니다. 간격은 2초입니다.\n\n테스트 환경은 다를 수 있습니다.';

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
    registerName: '알림 속 이름',
    registeredDateTime: '20261020085000',
    ...overrides,
  };
}

/** 가짜 시계가 부른 일이 끝나도록 대기 중인 비동기 일을 모두 돌린다. 가짜 포트는 모두 바로 답한다. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * 가짜 포트로 감지·멘션 묶음·게시를 만든다. 게시물 본문과 댓글 700에 송신자 "김철수"가 나를 멘션했다.
 * `place`가 `post`면 본문 묶음, `thread`면 댓글 700의 댓글 스레드 묶음 하나를 감지해 초안을 담은 준비됨으로 둔다.
 */
async function setup(place: 'post' | 'thread') {
  const clock = new FakeClock(NOW);
  const flow = new FakeFlowApi();
  const stateStore = new MemoryStateStore();
  stateStore.account = { ...FAKE_ME };
  stateStore.baselineAlarmId = '100';
  /** 진단 로그에 남은 줄. */
  const logLines: string[] = [];
  const logger = createLogger([{ write: (line) => logLines.push(line) }], clock);
  /** Flow가 키를 거부했다고 알린 횟수. */
  const keyRejections = { count: 0 };
  const bundles = new MentionBundles({
    stateStore,
    notifier: new RecordingNotifier(),
    clock,
    logger,
    findMyAnswers: async (bundlePlace) => new MentionJudge(flow, ME).myAnswers(bundlePlace, [ME]),
    collectContext: (bundle) => collectBundleContext(flow, bundle, clock.now(), [ME]),
    resolveRepos: async () => GONE_REPO,
  });
  await bundles.load();
  /** 지금 키로 부르는 가짜 Flow. */
  const connectFlow = () => ({ api: flow, reportKeyRejected: () => (keyRejections.count += 1) });
  const detection = new MentionDetection({ stateStore, bundles, clock, logger, connectFlow });
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
  flow.writtenDateTime = '20261020090010';

  await detection.start();
  flow.addAlarm(place === 'post' ? alarm('101') : alarm('101', { remarkId: '700' }));
  clock.advance(POLL_MS);
  await settle();

  /** 묶음 ID. */
  const bundleId = bundles.state()[0]!.id;
  // 저장소를 골라 다시 만들 때처럼 맥락을 조회한 뒤 초안을 담아 준비됨으로 둔다.
  await bundles.regenerateWithRepos(bundleId, ['/fake/work/repo']);
  await bundles.prepareRun(bundleId);
  await bundles.saveDraft(bundleId, DRAFT, [], mentionSetKey(bundles.get(bundleId)!));

  /** 새 알림을 맨 앞에 두고 다음 주기까지 시간을 돌린다. */
  const poll = async (...alarms: FlowAlarm[]) => {
    for (const item of alarms) flow.addAlarm(item);
    clock.advance(POLL_MS);
    await settle();
  };
  return { clock, flow, stateStore, bundles, detection, posting, bundleId, keyRejections, logLines, poll };
}

describe('게시: 위치와 게시 본문', () => {
  it('본문 묶음에서 [게시]를 누르면 5초 뒤 받는 사람 표기와 편집기 텍스트를 이은 게시 본문을 게시물의 새 댓글로 올리고 게시됨이 된다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');

    await posting.post(bundleId);
    expect(bundles.get(bundleId)?.status).toBe('posting');

    clock.advance(COUNTDOWN_MS - 1);
    await settle();
    expect(flow.writes).toEqual([]);

    clock.advance(1);
    await settle();
    expect(flow.writes).toEqual([{ request: `POST /user/comments/${POST_ID}`, contents: `@[김철수](${SENDER}) ${DRAFT_TEXT}` }]);
    expect(bundles.get(bundleId)).toMatchObject({
      status: 'posted',
      processedAt: NOW + POLL_MS + COUNTDOWN_MS,
      posting: { body: `@[김철수](${SENDER}) ${DRAFT_TEXT}`, postedId: '950000001' },
    });
  });

  it('댓글 스레드 묶음은 그 댓글의 대댓글로 올리고, 만든 대댓글의 replyId를 기록한다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('thread');

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(flow.writes).toEqual([{ request: `POST /user/comments/${POST_ID}/replies/700`, contents: `@[김철수](${SENDER}) ${DRAFT_TEXT}` }]);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posted', posting: { postedId: '950000001' } });
  });

  it('받는 사람을 모두 빼면 편집기 텍스트만 올리고, 편집본은 앞뒤 공백을 떼어 올린다. 근거 번호는 들어가지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    await bundles.removeRecipient(bundleId, 0, '김철수');
    await bundles.editDraft(bundleId, '\n  재시도는 다섯 번입니다.\n\n간격은 2초입니다.  \n');

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(flow.writes.map((write) => write.contents)).toEqual(['재시도는 다섯 번입니다.\n\n간격은 2초입니다.']);
  });
});

describe('게시: 카운트다운과 취소', () => {
  it('카운트다운 동안 취소하면 아무것도 보내지 않고 준비됨으로 돌아가며 초안은 그대로다. 다시 [게시]하면 처음부터 5초를 센다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    await posting.post(bundleId);
    expect(posting.countdownEndsAt(bundleId)).toBe(clock.now() + COUNTDOWN_MS);

    clock.advance(COUNTDOWN_MS - 1_000);
    await posting.cancel(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(flow.writes).toEqual([]);
    expect(posting.countdownEndsAt(bundleId)).toBeNull();
    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', posting: null, draft: DRAFT });

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS - 1);
    await settle();
    expect(flow.writes).toEqual([]);
    clock.advance(1);
    await settle();
    expect(flow.writes).toHaveLength(1);
  });

  it('카운트다운이 끝나 게시 요청을 보낸 뒤에는 취소해도 바뀌지 않는다', async () => {
    const { clock, bundles, posting, bundleId } = await setup('post');
    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    await posting.cancel(bundleId);

    expect(bundles.get(bundleId)?.status).toBe('posted');
  });
});

describe('게시: 앱 내 업데이트가 기다리는 게시', () => {
  it('카운트다운부터 게시 요청의 응답을 받을 때까지 진행 중이고, 끝나면 진행 중이 아니라고 알린다', async () => {
    const { clock, flow, posting, bundleId } = await setup('post');
    /** 게시 요청의 응답을 놓아 줄 함수. */
    const release = flow.hold(`POST /user/comments/${POST_ID}`);
    /** 알림을 받을 때마다의 진행 여부. */
    const seen: boolean[] = [];
    posting.onChange(() => seen.push(posting.isActive()));
    expect(posting.isActive()).toBe(false);

    await posting.post(bundleId);
    expect(posting.isActive()).toBe(true);

    clock.advance(COUNTDOWN_MS);
    await settle();
    expect(posting.isActive()).toBe(true);

    release();
    await settle();
    expect(posting.isActive()).toBe(false);
    expect(seen.at(-1)).toBe(false);
  });

  it('카운트다운을 취소하면 진행 중이 아니다', async () => {
    const { posting, bundleId } = await setup('post');
    await posting.post(bundleId);

    await posting.cancel(bundleId);

    expect(posting.isActive()).toBe(false);
  });

  it('429 뒤 다시 보내기를 기다리는 동안과 다시 보낸 요청의 응답을 받을 때까지도 진행 중이다', async () => {
    const { clock, flow, posting, bundleId } = await setup('post');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'rate-limited', retryAfterMs: 3_000 }, 1);
    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    expect(posting.isActive()).toBe(true);

    /** 다시 보낸 요청의 응답을 놓아 줄 함수. */
    const release = flow.hold(`POST /user/comments/${POST_ID}`);
    clock.advance(3_000);
    await settle();
    expect(posting.isActive()).toBe(true);

    release();
    await settle();
    expect(posting.isActive()).toBe(false);
  });
});

describe('게시: 보내기 전 기록과 성공 기록', () => {
  /** 댓글 700의 댓글 멘션 위치. 게시한 글이 답한 범위로 기록된다. */
  const THREAD_MENTION = { postId: POST_ID, remarkId: '700', replyId: '-1' };

  it('게시 요청이 Flow에 닿을 때 state.db에는 이미 "게시 요청 보냄"과 게시 본문, 그 글이 답한 멘션 위치가 적혀 있고, 성공하면 올라간 글의 ID와 게시됨이 저장된다', async () => {
    const { clock, flow, stateStore, posting, bundleId } = await setup('thread');
    /** 게시 요청이 닿은 순간 저장소에 있던 묶음. */
    let atRequest: Promise<unknown> | null = null;
    flow.whenRequested(`POST /user/comments/${POST_ID}/replies/700`, () => {
      // 메모리 저장소는 부른 순간의 값을 복사하므로, 기다리지 않고 받아 두었다가 나중에 읽는다.
      atRequest = stateStore.listBundles();
    });
    await posting.post(bundleId);
    /** 게시 요청을 보낸 시각. */
    const sentAt = clock.now() + COUNTDOWN_MS;

    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(await atRequest).toEqual([
      expect.objectContaining({
        id: bundleId,
        status: 'posting',
        posting: { body: `@[김철수](${SENDER}) ${DRAFT_TEXT}`, sentAt, postedId: null, failure: null, answeredMentions: [THREAD_MENTION] },
      }),
    ]);
    expect(await stateStore.listBundles()).toEqual([
      expect.objectContaining({
        id: bundleId,
        status: 'posted',
        processedAt: sentAt,
        posting: { body: `@[김철수](${SENDER}) ${DRAFT_TEXT}`, sentAt, postedId: '950000001', failure: null, answeredMentions: [THREAD_MENTION] },
      }),
    ]);
  });
});

describe('게시: [게시]를 끄는 경우', () => {
  it('편집기 텍스트가 비었으면(공백만 포함) 게시를 시작하지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    await bundles.editDraft(bundleId, ' \n\n ');

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)?.status).toBe('ready');
    expect(posting.countdownEndsAt(bundleId)).toBeNull();
    expect(flow.writes).toEqual([]);
  });

  it('받는 사람 표기를 포함한 게시 본문이 4,000자를 넘으면 게시를 시작하지 않고, 4,000자면 게시한다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    // 받는 사람 표기 `@[김철수](sender@example.test)` 27자와 공백 1자 뒤에 편집기 텍스트가 온다.
    await bundles.editDraft(bundleId, '가'.repeat(3_973));

    await posting.post(bundleId);
    expect(bundles.get(bundleId)?.status).toBe('ready');

    await bundles.editDraft(bundleId, '가'.repeat(3_972));
    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(flow.writes.map((write) => write.contents.length)).toEqual([4_000]);
  });

  it('게시 중 묶음은 다시 [게시]하거나 무시하거나 편집할 수 없다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    await posting.post(bundleId);

    await posting.post(bundleId);
    await bundles.ignore(bundleId);
    await bundles.editDraft(bundleId, '바꾼 글');
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(flow.writes.map((write) => write.contents)).toEqual([`@[김철수](${SENDER}) ${DRAFT_TEXT}`]);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posted', editedText: null });
  });
});

describe('게시: 검토 대기와 트레이 숫자', () => {
  it('게시 중 묶음은 검토 대기 목록에 남지만 트레이 숫자에서는 빠지고, 게시됨은 처리됨이 된다', async () => {
    const { clock, bundles, posting, bundleId } = await setup('post');
    expect(bundles.reviewCount()).toBe(1);

    await posting.post(bundleId);
    expect(bundles.reviewCount()).toBe(0);
    expect(bundles.state().map((bundle) => [bundle.id, bundle.status])).toEqual([[bundleId, 'posting']]);

    clock.advance(COUNTDOWN_MS);
    await settle();
    expect(bundles.reviewCount()).toBe(0);
    expect(bundles.get(bundleId)?.status).toBe('posted');
  });
});

describe('게시: 게시 중에 들어온 새 멘션', () => {
  it('게시를 누를 때의 확인이 끝난 뒤 카운트다운 중 같은 댓글 스레드에 새 멘션이 오면 합치지 않고 새 묶음이 되며, 게시는 그대로 진행한다', async () => {
    const { clock, flow, bundles, detection, posting, bundleId } = await setup('thread');
    await posting.post(bundleId);
    await settle();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registerName: '김철수', registeredDateTime: '20261020090005' });
    flow.addAlarm(alarm('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020090005' }));

    await detection.checkNow();
    await settle();
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(flow.writes).toHaveLength(1);
    expect(bundles.state().map((bundle) => [bundle.status, bundle.mentions.map((mention) => mention.alarmId)])).toEqual([
      ['repo-check-needed', ['102']],
      ['posted', ['101']],
    ]);
  });

  it('이 PC가 게시한 글은 게시한 묶음의 멘션에만 답한 것으로 본다. 게시 전에 온 멘션의 새 묶음은 그 글 때문에 이미 답함이 되지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId, poll } = await setup('thread');
    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    // 게시한 대댓글(09:00:10)보다 앞서 쓴 멘션의 알림이 게시가 끝난 뒤에 왔다.
    flow.addReply(POST_ID, '700', { replyId: '802', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registerName: '김철수', registeredDateTime: '20261020090008' });

    await poll(alarm('103', { remarkId: '700', replyId: '802', registeredDateTime: '20261020090008' }));
    /** 새 묶음. */
    const created = bundles.state().find((bundle) => bundle.id !== bundleId)!;
    expect(created).toMatchObject({ status: 'repo-check-needed', mentions: [expect.objectContaining({ alarmId: '103', answered: false })] });

    // 초안을 만들기 직전의 확인에서도 그 글을 답으로 보지 않는다.
    await bundles.regenerateWithRepos(created.id, ['/fake/work/repo']);
    await expect(bundles.prepareRun(created.id)).resolves.toMatchObject({ kind: 'prepared' });
  });

  it('다른 PC나 Flow 화면에서 쓴 내 답은 그대로 이미 답함으로 판정한다', async () => {
    const { clock, flow, bundles, posting, bundleId, poll } = await setup('thread');
    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    flow.addReply(POST_ID, '700', { replyId: '802', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registeredDateTime: '20261020090008' });
    flow.addReply(POST_ID, '700', { replyId: '803', contents: '직접 쓴 답', registerId: ME, registeredDateTime: '20261020090020' });

    await poll(alarm('103', { remarkId: '700', replyId: '802', registeredDateTime: '20261020090008' }));

    expect(bundles.state().find((bundle) => bundle.id !== bundleId)?.status).toBe('already-answered');
  });
});

describe('게시 실패: 응답별 처리', () => {
  it('403이면 게시 실패가 되고 사유는 권한 없음이다. 게시 기록과 초안·편집본은 그대로 남는다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    await bundles.editDraft(bundleId, '고친 답입니다.');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'http', status: 403 }, 1);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({
      status: 'post-failed',
      editedText: '고친 답입니다.',
      draft: DRAFT,
      posting: { body: `@[김철수](${SENDER}) 고친 답입니다.`, postedId: null, failure: 'forbidden' },
    });
    expect(flow.writes).toEqual([]);
  });

  it('404·412는 지워짐, 400·422와 그 밖의 거절은 받지 않음으로 게시 실패가 된다', async () => {
    for (const [status, reason] of [
      [404, 'gone'],
      [412, 'gone'],
      [400, 'rejected'],
      [422, 'rejected'],
      [409, 'rejected'],
    ] as const) {
      const { clock, flow, bundles, posting, bundleId } = await setup('thread');
      flow.failOn(`POST /user/comments/${POST_ID}/replies/700`, { kind: 'http', status }, 1);

      await posting.post(bundleId);
      clock.advance(COUNTDOWN_MS);
      await settle();

      expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', posting: { failure: reason } });
    }
  });

  it('429면 Retry-After만큼 기다렸다가 한 번 더 보내고, 그때 올라가면 게시됨이다. 기다리는 동안은 게시 결과 확인 중으로 남는다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'rate-limited', retryAfterMs: 3_000 }, 1);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posting', posting: { postedId: null, failure: null } });

    clock.advance(2_999);
    await settle();
    expect(flow.requests.filter((request) => request.startsWith('POST'))).toHaveLength(1);

    clock.advance(1);
    await settle();
    expect(flow.writes).toEqual([{ request: `POST /user/comments/${POST_ID}`, contents: `@[김철수](${SENDER}) ${DRAFT_TEXT}` }]);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posted', posting: { postedId: '950000001' } });
  });

  it('다시 보낸 요청도 429면 더 보내지 않고 게시 실패가 되며 사유는 요청 한도 초과다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'rate-limited', retryAfterMs: 1_000 }, 3);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    clock.advance(60_000);
    await settle();

    expect(flow.requests.filter((request) => request.startsWith('POST'))).toHaveLength(2);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', posting: { failure: 'rate-limited' } });
  });

  it('429에 Retry-After가 없으면 10초를 기다렸다가 한 번 더 보낸다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'rate-limited', retryAfterMs: null }, 1);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    clock.advance(9_999);
    await settle();
    expect(flow.writes).toEqual([]);

    clock.advance(1);
    await settle();
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posted', posting: { postedId: '950000001' } });
  });

  it('429의 Retry-After가 60초를 넘으면 기다리지 않고 바로 게시 실패(요청 한도 초과)가 된다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'rate-limited', retryAfterMs: 60_001 }, 1);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', posting: { failure: 'rate-limited' } });
    expect(flow.requests.filter((request) => request.startsWith('POST'))).toHaveLength(1);
  });

  it('Flow가 키를 거부하면(401) 묶음의 실패가 아니라 "키 확인 필요"를 알리고 묶음은 준비됨으로 둔다', async () => {
    const { clock, flow, bundles, posting, bundleId, keyRejections } = await setup('thread');
    flow.failOn(`POST /user/comments/${POST_ID}/replies/700`, { kind: 'unauthorized' }, 1);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(keyRejections.count).toBe(1);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', posting: null });
  });
});

describe('게시 실패: 올라갔는지 알 수 없을 때의 확인', () => {
  it('응답을 받지 못했지만 Flow에 올라갔으면, 그 자리를 다시 조회해 게시 본문과 똑같은 내 글을 찾아 그 ID로 게시됨이 된다. 다시 보내지 않는다', async () => {
    for (const failure of [{ kind: 'network' as const }, { kind: 'http' as const, status: 502 }, { kind: 'unexpected-response' as const }]) {
      const { clock, flow, bundles, posting, bundleId } = await setup('thread');
      // 게시 요청을 보낼 때 같은 스레드에 내가 앞서 쓴 다른 글이 있다. [게시]를 누를 때 있었으면 게시를 누를 때의 확인이 이미 답함으로 멈춘다.
      flow.whenRequested(`POST /user/comments/${POST_ID}/replies/700`, () =>
        flow.addReply(POST_ID, '700', { replyId: '710', contents: '다른 내용의 내 글', registerId: ME, registeredDateTime: '20261020085900' }),
      );
      flow.loseResponseOn(`POST /user/comments/${POST_ID}/replies/700`, failure);

      await posting.post(bundleId);
      clock.advance(COUNTDOWN_MS);
      await settle();

      expect(flow.writes).toHaveLength(1);
      expect(bundles.get(bundleId)).toMatchObject({ status: 'posted', posting: { postedId: '950000001', failure: null } });
      expect(flow.requests.filter((request) => request.startsWith('POST'))).toHaveLength(1);
    }
  });

  it('본문 묶음은 게시물의 댓글에서 찾는다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.loseResponseOn(`POST /user/comments/${POST_ID}`, { kind: 'network' });

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'posted', posting: { postedId: '950000001' } });
  });

  it('다시 조회해도 똑같은 글이 없으면 그대로 다시 보내지 않고 게시 실패("Flow가 응답하지 않았습니다")가 된다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'http', status: 503 }, 1);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', posting: { failure: 'no-response' } });
    expect(flow.requests.filter((request) => request.startsWith('POST'))).toHaveLength(1);
  });

  it('내용이 한 글자라도 다르거나 남이 쓴 글이면 올라간 글로 보지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('thread');
    /** 게시 본문. */
    const body = `@[김철수](${SENDER}) ${DRAFT_TEXT}`;
    // 게시 요청을 보낼 때 생긴 글이다. [게시]를 누를 때 있었으면 게시를 누를 때의 확인이 멈춘다.
    flow.whenRequested(`POST /user/comments/${POST_ID}/replies/700`, () => {
      flow.addReply(POST_ID, '700', { replyId: '711', contents: `${body} `, registerId: ME, registeredDateTime: '20261020085900' });
      flow.addReply(POST_ID, '700', { replyId: '712', contents: body, registerId: SENDER, registeredDateTime: '20261020085900' });
    });
    flow.failOn(`POST /user/comments/${POST_ID}/replies/700`, { kind: 'network' }, 1);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', posting: { failure: 'no-response' } });
  });

  it('이 PC의 다른 묶음이 이미 기록한 글은 본문이 같아도 올라간 글로 보지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId, poll } = await setup('thread');
    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    // 같은 스레드에 새 멘션이 와 새 묶음이 되고, 같은 초안과 같은 받는 사람이라 게시 본문도 같다.
    flow.addReply(POST_ID, '700', { replyId: '802', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registerName: '김철수', registeredDateTime: '20261020090008' });
    await poll(alarm('103', { remarkId: '700', replyId: '802', registeredDateTime: '20261020090008' }));
    /** 새 묶음. */
    const created = bundles.state().find((item) => item.id !== bundleId)!;
    await bundles.regenerateWithRepos(created.id, ['/fake/work/repo']);
    await bundles.prepareRun(created.id);
    await bundles.saveDraft(created.id, DRAFT, [], mentionSetKey(bundles.get(created.id)!));
    flow.failOn(`POST /user/comments/${POST_ID}/replies/700`, { kind: 'network' }, 1);

    await posting.post(created.id);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)?.posting?.body).toBe(bundles.get(created.id)?.posting?.body);
    expect(bundles.get(created.id)).toMatchObject({ status: 'post-failed', posting: { failure: 'no-response' } });
  });

  it('다시 조회하지 못하면 게시 결과 확인 중으로 둔 채 60초 뒤 다시 확인해 정한다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.loseResponseOn(`POST /user/comments/${POST_ID}`, { kind: 'network' });
    // 게시를 누를 때의 확인이 아니라 게시 요청 뒤의 다시 조회를 실패시킨다.
    flow.whenRequested(`POST /user/comments/${POST_ID}`, () => flow.failOn(`GET /user/comments/${POST_ID}`, { kind: 'network' }, 1));

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posting', posting: { postedId: null, failure: null } });

    clock.advance(59_999);
    await settle();
    expect(bundles.get(bundleId)?.status).toBe('posting');

    clock.advance(1);
    await settle();
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posted', posting: { postedId: '950000001' } });
    expect(flow.writes).toHaveLength(1);
  });

  it('다시 조회할 때 머리 댓글이 지워졌으면 게시 실패(지워짐)가 된다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('thread');
    flow.failOn(`POST /user/comments/${POST_ID}/replies/700`, { kind: 'network' }, 1);
    flow.whenRequested(`POST /user/comments/${POST_ID}/replies/700`, () => flow.removeComment(POST_ID, '700'));

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', posting: { failure: 'gone' } });
  });

  it('다시 조회할 때 대댓글 목록이 412(댓글이 존재하지 않음)를 주면 머리 댓글이 지워진 것으로 보고 게시 실패(지워짐)가 된다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('thread');
    flow.failOn(`POST /user/comments/${POST_ID}/replies/700`, { kind: 'network' }, 1);
    // 게시 요청 뒤의 다시 조회에서 대댓글 목록 API를 부르게 대댓글을 10개 넘게 달고 412를 준다.
    // [게시]를 누를 때 있었으면 게시를 누를 때의 확인이 새 글이나 원문 사라짐으로 멈춘다.
    flow.whenRequested(`POST /user/comments/${POST_ID}/replies/700`, () => {
      for (let index = 0; index < 11; index += 1) flow.addReply(POST_ID, '700', { replyId: String(901 + index), contents: `대댓글 ${index}` });
      flow.failOn(`GET /user/comments/${POST_ID}/replies/700`, { kind: 'http', status: 412 });
    });

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', posting: { failure: 'gone' } });
  });

  it('다시 조회할 때 게시물을 볼 수 없게 되었으면(403) 게시 실패(권한 없음)가 된다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'network' }, 1);
    flow.whenRequested(`POST /user/comments/${POST_ID}`, () => flow.failOn(`GET /user/comments/${POST_ID}`, { kind: 'http', status: 403 }, 1));

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', posting: { failure: 'forbidden' } });
  });

  it('다시 조회가 예외로 끝나도 게시 중으로 둔 채 60초 뒤 다시 확인한다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.loseResponseOn(`POST /user/comments/${POST_ID}`, { kind: 'network' });
    /** 원래 댓글 목록 조회. */
    const listComments = flow.listComments.bind(flow);
    // 게시를 누를 때의 확인이 아니라 게시 요청 뒤의 다시 조회를 예외로 끝낸다.
    flow.whenRequested(`POST /user/comments/${POST_ID}`, () => {
      flow.listComments = async () => {
        flow.listComments = listComments;
        throw new Error('연결이 끊김');
      };
    });

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    expect(bundles.get(bundleId)?.status).toBe('posting');

    clock.advance(60_000);
    await settle();
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posted', posting: { postedId: '950000001' } });
  });

  it('게시 요청이 예외로 끝나면 응답을 받지 못한 것으로 보고 확인을 거친다. 로그에 게시 본문은 남기지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId, logLines } = await setup('post');
    flow.createComment = async () => {
      throw new Error('연결이 끊김');
    };

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', posting: { body: `@[김철수](${SENDER}) ${DRAFT_TEXT}`, failure: 'no-response' } });
    expect(logLines.some((line) => line.includes('posting.crashed'))).toBe(true);
    expect(logLines.join('\n')).not.toContain('재시도는 5번입니다');
  });
});


describe('게시 실패 상태', () => {
  it('게시 실패가 되는 순간 실패를 한 번 알리고, 실패 목록에 들며 빨간 점의 대상이 된다. 트레이 숫자에는 세지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    /** 실패를 알린 묶음. */
    const failed: number[] = [];
    posting.onFailed((id) => failed.push(id));
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'http', status: 400 }, 1);
    expect(bundles.hasFailure()).toBe(false);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();
    clock.advance(POLL_MS);
    await settle();

    expect(failed).toEqual([bundleId]);
    expect(bundles.hasFailure()).toBe(true);
    expect(bundles.reviewCount()).toBe(0);
    expect(bundles.state().map((bundle) => bundle.status)).toEqual(['post-failed']);
  });

  it('게시 실패 묶음은 편집하고 받는 사람을 뺀 뒤 [다시 게시]할 수 있고, 다시 5초를 센 뒤 고친 게시 본문을 올린다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'http', status: 422 }, 1);
    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    await bundles.editDraft(bundleId, '짧게 고친 답입니다.');
    await bundles.removeRecipient(bundleId, 0, '김철수');
    await posting.post(bundleId);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posting', posting: null });
    clock.advance(COUNTDOWN_MS - 1);
    await settle();
    expect(flow.writes).toEqual([]);
    clock.advance(1);
    await settle();

    expect(flow.writes.map((write) => write.contents)).toEqual(['짧게 고친 답입니다.']);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'posted', posting: { postedId: '950000001', failure: null } });
  });

  it('게시 실패 묶음은 무시할 수 있지만 다시 만들 수는 없다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'http', status: 403 }, 1);
    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    await bundles.regenerate(bundleId, { path: 'again' });
    expect(bundles.get(bundleId)).toMatchObject({ status: 'post-failed', draft: DRAFT });

    await bundles.ignore(bundleId);
    expect(bundles.get(bundleId)?.status).toBe('ignored');
  });
});
