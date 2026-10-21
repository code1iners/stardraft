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
  const posting = new Posting({ bundles, connectFlow, clock, logger });

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

describe('게시: 보내기 전 기록과 성공 기록', () => {
  it('게시 요청이 Flow에 닿을 때 state.db에는 이미 "게시 요청 보냄"과 게시 본문이 적혀 있고, 성공하면 올라간 글의 ID와 게시됨이 저장된다', async () => {
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
      expect.objectContaining({ id: bundleId, status: 'posting', posting: { body: `@[김철수](${SENDER}) ${DRAFT_TEXT}`, sentAt, postedId: null } }),
    ]);
    expect(await stateStore.listBundles()).toEqual([
      expect.objectContaining({
        id: bundleId,
        status: 'posted',
        processedAt: sentAt,
        posting: { body: `@[김철수](${SENDER}) ${DRAFT_TEXT}`, sentAt, postedId: '950000001' },
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
  it('카운트다운 중 같은 댓글 스레드에 새 멘션이 오면 합치지 않고 새 묶음이 되며, 게시는 그대로 진행한다', async () => {
    const { clock, flow, bundles, detection, posting, bundleId } = await setup('thread');
    await posting.post(bundleId);
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

describe('게시: 게시하지 못했을 때', () => {
  it('Flow가 게시 요청을 거절하면 준비됨으로 돌아가고 게시 기록을 지우며 초안·편집본은 그대로 둔다', async () => {
    const { clock, flow, bundles, posting, bundleId } = await setup('post');
    await bundles.editDraft(bundleId, '고친 답입니다.');
    flow.failOn(`POST /user/comments/${POST_ID}`, { kind: 'http', status: 403 }, 1);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', posting: null, editedText: '고친 답입니다.', draft: DRAFT });
    expect(flow.writes).toEqual([]);
  });

  it('Flow가 키를 거부하면(401) "키 확인 필요"를 알리고 묶음은 준비됨으로 둔다', async () => {
    const { clock, flow, bundles, posting, bundleId, keyRejections } = await setup('thread');
    flow.failOn(`POST /user/comments/${POST_ID}/replies/700`, { kind: 'unauthorized' }, 1);

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(keyRejections.count).toBe(1);
    expect(bundles.get(bundleId)).toMatchObject({ status: 'ready', posting: null });
  });

  it('게시 요청이 예외로 끝나면 로그에 남기고, 올라갔는지 알 수 없으므로 보내기 전 기록을 둔 채 게시 중으로 둔다. 로그에 게시 본문은 남기지 않는다', async () => {
    const { clock, flow, bundles, posting, bundleId, logLines } = await setup('post');
    flow.createComment = async () => {
      throw new Error('연결이 끊김');
    };

    await posting.post(bundleId);
    clock.advance(COUNTDOWN_MS);
    await settle();

    expect(bundles.get(bundleId)).toMatchObject({ status: 'posting', posting: { body: `@[김철수](${SENDER}) ${DRAFT_TEXT}`, postedId: null } });
    expect(logLines.some((line) => line.includes('posting.crashed'))).toBe(true);
    expect(logLines.join('\n')).not.toContain('재시도는 5번입니다');
  });
});
