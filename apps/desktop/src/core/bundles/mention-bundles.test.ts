import { describe, expect, it } from 'vitest';
import { collectBundleContext } from '../flow/bundle-context';
import { MentionDetection } from '../detection/mention-detection';
import { FakeClock } from '../fakes/fake-clock';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { MentionJudge } from '../flow/mention-judgement';
import { createLogger } from '../logging/logger';
import type { FlowAlarm } from '../ports/flow-api';
import type { RepoResolution } from '../repos/repo-mappings';
import type { Draft } from '../drafts/draft';
import { mentionSetKey, type MentionBundle } from './mention-bundle';
import { MentionBundles } from './mention-bundles';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시(00:00:00 UTC). */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 나(키 소유자)의 사용자 ID. */
const ME = FAKE_ME.userId;
/** 송신자. 실제 사람이 아니다. */
const SENDER = 'sender@example.test';
/** 다른 송신자. 실제 사람이 아니다. */
const OTHER_SENDER = 'other@example.test';
/** 멘션이 온 게시물. */
const POST_ID = '90000011';
/** 같은 Flow 프로젝트의 다른 게시물. */
const OTHER_POST_ID = '90000012';
/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${ME})`;
/** 폴링 주기(밀리초). */
const POLL_MS = 60_000;
/** 매핑된 저장소 폴더가 사라졌다는 확인 결과. 이 테스트의 묶음은 초안 실행 없이 저장소 확인 필요로 기다린다. */
const GONE_REPO: RepoResolution = { kind: 'missing-folders', paths: ['/fake/work/gone'] };

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
    registerName: '보낸 사람',
    registeredDateTime: '20261020085000',
    ...overrides,
  };
}

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

/** 가짜 시계가 부른 조회가 끝나도록 대기 중인 비동기 일을 모두 돌린다. 가짜 포트는 모두 바로 답한다. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** 묶음을 비교하기 쉬운 모양으로 줄인다. 자리, 상태, 묶음에 남은 멘션(알림 ID)과 빠진 멘션. */
function summary(bundle: MentionBundle) {
  return {
    place: [bundle.postId, bundle.remarkId],
    status: bundle.status,
    mentions: bundle.mentions.filter((mention) => !mention.answered).map((mention) => mention.alarmId),
    answered: bundle.mentions.filter((mention) => mention.answered).map((mention) => mention.alarmId),
  };
}

/** 가짜 포트로 멘션 감지와 멘션 묶음을 만든다. 기준점은 `'100'`, 계정은 가짜 키 소유자다. */
async function setup() {
  const clock = new FakeClock(NOW);
  const flow = new FakeFlowApi();
  const stateStore = new MemoryStateStore();
  stateStore.account = { ...FAKE_ME };
  stateStore.baselineAlarmId = '100';
  const notifier = new RecordingNotifier();
  const logger = createLogger([{ write: () => {} }], clock);
  /** 내 답 조회를 실패시킬지 여부. */
  const answersLookup = { fails: false };
  const bundles = new MentionBundles({
    stateStore,
    notifier,
    clock,
    logger,
    findMyAnswers: async (place) => (answersLookup.fails ? null : new MentionJudge(flow, ME).myAnswers(place, [ME])),
    collectContext: (bundle) => collectBundleContext(flow, bundle, clock.now(), [ME]),
    // 매핑된 저장소 폴더가 사라진 Flow 프로젝트라 묶음이 저장소 확인 필요로 기다린다. 생성 중 묶음(매핑, 자동 선택)은 초안 대기열 테스트가 다룬다.
    resolveRepos: async () => GONE_REPO,
  });
  await bundles.load();
  const detection = new MentionDetection({
    stateStore,
    bundles,
    clock,
    logger,
    connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }),
  });
  flow.addPost({
    postId: POST_ID,
    title: '가짜 게시물',
    connectUrl: 'https://fake.flow.test/post/90000011',
    textComponents: [{ contents: '본문', mentions: [] }],
  });
  flow.addComment(POST_ID, { commentId: '700', contents: `${MY_MARKUP} 재시도는 몇 번 하나요?`, registerId: SENDER });

  /** 감지를 시작했는지 여부. */
  let started = false;
  /** 새 알림을 맨 앞에 두고 한 번 조회한다. 처음이면 감지를 시작하고, 아니면 다음 주기까지 시간을 돌린다. */
  const poll = async (...alarms: FlowAlarm[]) => {
    for (const item of alarms) flow.addAlarm(item);
    if (!started) {
      started = true;
      await detection.start();
      return;
    }
    clock.advance(POLL_MS);
    await settle();
  };
  return { clock, flow, stateStore, notifier, answersLookup, bundles, detection, poll };
}

describe('멘션 묶음: 묶음 키', () => {
  it('댓글 멘션과 그 대댓글 멘션은 한 묶음, 본문 멘션은 게시물마다 한 묶음, 다른 댓글 스레드는 다른 묶음이다', async () => {
    const { flow, bundles, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 덧붙여 질문`, registerId: OTHER_SENDER });
    flow.addComment(POST_ID, { commentId: '701', contents: `${MY_MARKUP} 다른 질문`, registerId: SENDER });
    flow.addPost({ postId: OTHER_POST_ID, textComponents: [{ contents: `${MY_MARKUP} 본문 질문`, mentions: [] }] });
    flow.addPost({
      postId: POST_ID,
      title: '가짜 게시물',
      connectUrl: 'https://fake.flow.test/post/90000011',
      textComponents: [{ contents: `${MY_MARKUP} 이 게시물 본문 질문`, mentions: [] }],
    });

    await poll(
      alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }),
      alarm('102', { remarkId: '700', replyId: '801', registerId: OTHER_SENDER, registerName: '다른 사람', registeredDateTime: '20261020085100' }),
      alarm('103', { registeredDateTime: '20261020085200' }),
      alarm('104', { postId: OTHER_POST_ID, registeredDateTime: '20261020085300' }),
      alarm('105', { remarkId: '701', registeredDateTime: '20261020085400' }),
    );

    expect(bundles.state().map(summary)).toEqual([
      { place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['101', '102'], answered: [] },
      { place: [POST_ID, '-1'], status: 'repo-check-needed', mentions: ['103'], answered: [] },
      { place: [OTHER_POST_ID, '-1'], status: 'repo-check-needed', mentions: ['104'], answered: [] },
      { place: [POST_ID, '701'], status: 'repo-check-needed', mentions: ['105'], answered: [] },
    ]);
    /** 댓글 스레드 묶음. */
    const thread = bundles.state()[0]!;
    expect(thread.mentions.map(({ senderName, text }) => [senderName, text])).toEqual([
      ['보낸 사람', `${MY_MARKUP} 재시도는 몇 번 하나요?`],
      ['다른 사람', `${MY_MARKUP} 덧붙여 질문`],
    ]);
    expect([thread.postTitle, thread.connectUrl]).toEqual(['가짜 게시물', 'https://fake.flow.test/post/90000011']);
    expect(bundles.state()[1]!.mentions[0]!.text).toBe(`${MY_MARKUP} 이 게시물 본문 질문`);
  });
});

describe('멘션 묶음: 합치기', () => {
  it('저장소 확인 필요 묶음에 같은 댓글 스레드의 새 멘션이 오면 합치고 "새 멘션 1건"을 세며, 알림은 다시 띄우지 않는다', async () => {
    const { flow, notifier, bundles, poll } = await setup();
    await poll(alarm('101', { remarkId: '700' }));

    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: OTHER_SENDER });
    await poll(alarm('102', { remarkId: '700', replyId: '801', registerId: OTHER_SENDER, registeredDateTime: '20261020085500' }));

    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['101', '102'], answered: [] }]);
    expect(bundles.state()[0]?.newMentionCount).toBe(1);
    expect(bundles.reviewCount()).toBe(1);
    expect(notifier.sent).toHaveLength(1);
  });

  it('처리됨 묶음에 새 멘션이 오면 새 묶음을 만들고, 처리됨 묶음을 되돌려도 두 묶음을 합치지 않는다. 그 뒤의 멘션은 가장 최근 묶음에 합친다', async () => {
    const { flow, bundles, poll } = await setup();
    await poll(alarm('101', { remarkId: '700' }));
    /** 처음 묶음. */
    const first = bundles.state()[0]!;
    await bundles.ignore(first.id);

    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 다시 질문`, registerId: SENDER });
    await poll(alarm('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020085500' }));
    await bundles.restore(first.id);
    flow.addReply(POST_ID, '700', { replyId: '802', contents: `${MY_MARKUP} 또 질문`, registerId: SENDER });
    await poll(alarm('103', { remarkId: '700', replyId: '802', registeredDateTime: '20261020085600' }));

    expect(bundles.state().map((bundle) => [bundle.id, summary(bundle)])).toEqual([
      [first.id, { place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['101'], answered: [] }],
      [first.id + 1, { place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['102', '103'], answered: [] }],
    ]);
    expect(bundles.reviewCount()).toBe(2);
  });
});

describe('멘션 묶음: 맥락', () => {
  it('감지한 묶음은 맥락을 Flow에서 조회해 비교 기준으로 저장하고, 새 멘션이 합쳐지면 다시 새로 조회한다', async () => {
    const { clock, flow, stateStore, bundles, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '800', contents: '앞선 대댓글', registerName: '동료', registeredDateTime: '20261020085030' });
    await poll(alarm('101', { remarkId: '700' }));

    /** 처음 저장한 맥락. */
    const first = bundles.state()[0]!.context!;
    expect(first.fetchedAt).toBe(NOW);
    expect(first.post.title).toBe('가짜 게시물');
    expect(first.targetThread?.mention).toBe(true);
    expect(first.targetThread?.replies.map((reply) => [reply.contents, reply.mention])).toEqual([['앞선 대댓글', false]]);
    expect((await stateStore.listBundles())[0]?.context).toEqual(first);

    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: OTHER_SENDER, registeredDateTime: '20261020085500' });
    await poll(alarm('102', { remarkId: '700', replyId: '801', registerId: OTHER_SENDER, registeredDateTime: '20261020085500' }));

    /** 합친 뒤 다시 조회한 맥락. */
    const merged = bundles.state()[0]!.context!;
    expect(merged.fetchedAt).toBe(clock.now());
    expect(merged.targetThread?.replies.map((reply) => [reply.id, reply.mention])).toEqual([
      ['800', false],
      ['801', true],
    ]);
  });

  it('맥락을 조회하지 못하면 전에 저장한 맥락을 그대로 두고, 이미 답함이 된 묶음은 조회하지 않는다', async () => {
    const { flow, bundles, poll } = await setup();
    await poll(alarm('101', { remarkId: '700' }));
    /** 처음 저장한 맥락. */
    const first = bundles.state()[0]!.context;

    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registeredDateTime: '20261020085500' });
    // 감지가 판정에 쓰는 조회는 통과하고, 그 뒤 맥락 조회의 댓글 조회만 실패한다.
    flow.whenRequested(`GET /user/posts/${POST_ID}`, () => flow.failOn(`GET /user/comments/${POST_ID}`, { kind: 'network' }, 1));
    await poll(alarm('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020085500' }));

    expect(bundles.state()[0]?.mentions).toHaveLength(2);
    expect(bundles.state()[0]?.context).toEqual(first);

    flow.addComment(POST_ID, { commentId: '720', contents: `${MY_MARKUP} 질문`, registerId: SENDER });
    flow.addReply(POST_ID, '720', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085900' });
    /** 이미 답함이 될 묶음을 감지하기 전의 요청 수. */
    const before = flow.requests.length;
    await poll(alarm('103', { remarkId: '720', registeredDateTime: '20261020085800' }));

    expect(bundles.state().find((bundle) => bundle.remarkId === '720')).toMatchObject({ status: 'already-answered', context: null });
    expect(flow.requests.slice(before).filter((request) => request.startsWith(`GET /user/posts/`))).toHaveLength(1);
  });

  it('되돌리면 맥락을 새로 조회한다', async () => {
    const { clock, bundles, poll } = await setup();
    await poll(alarm('101', { remarkId: '700' }));
    /** 묶음. */
    const bundle = bundles.state()[0]!;
    await bundles.ignore(bundle.id);
    clock.advance(5_000);

    await bundles.restore(bundle.id);

    expect(bundles.get(bundle.id)?.context?.fetchedAt).toBe(NOW + 5_000);
  });
});

describe('멘션 묶음: 감지할 때의 이미 답함', () => {
  it('댓글 스레드에 멘션보다 나중에 쓴 내 대댓글이 있으면 초안 없이 처리됨의 "이미 답함"이 되고, 트레이 숫자와 알림은 그대로다', async () => {
    const { flow, notifier, bundles, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085100' });

    await poll(alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }));

    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'already-answered', mentions: [], answered: ['101'] }]);
    expect(bundles.state()[0]?.processedAt).toBe(NOW);
    expect(bundles.reviewCount()).toBe(0);
    expect(notifier.sent).toEqual([]);
  });

  it('본문 묶음은 게시물에 멘션보다 나중에 쓴 내 댓글만 답으로 본다. 대댓글과 다른 댓글 스레드의 글은 답이 아니다', async () => {
    const { flow, bundles, poll } = await setup();
    flow.addPost({ postId: OTHER_POST_ID, textComponents: [{ contents: `${MY_MARKUP} 본문 질문`, mentions: [] }] });
    flow.addComment(OTHER_POST_ID, { commentId: '710', contents: '다른 사람 댓글', registerId: OTHER_SENDER, registeredDateTime: '20261020084000' });
    flow.addReply(OTHER_POST_ID, '710', { replyId: '891', contents: '대댓글로 답함', registerId: ME, registeredDateTime: '20261020085100' });
    flow.addPost({ postId: '90000013', textComponents: [{ contents: `${MY_MARKUP} 본문 질문`, mentions: [] }] });
    flow.addComment('90000013', { commentId: '720', contents: '댓글로 답함', registerId: ME, registeredDateTime: '20261020085100' });

    await poll(alarm('101', { postId: OTHER_POST_ID }), alarm('102', { postId: '90000013', registeredDateTime: '20261020085001' }));

    expect(bundles.state().map(summary)).toEqual([
      { place: [OTHER_POST_ID, '-1'], status: 'repo-check-needed', mentions: ['101'], answered: [] },
      { place: ['90000013', '-1'], status: 'already-answered', mentions: [], answered: ['102'] },
    ]);
  });

  it('본문 묶음에서도 내 명의의 시스템 댓글(업무 상태 변경 등)은 내 답으로 보지 않는다', async () => {
    const { flow, bundles, poll } = await setup();
    flow.addPost({ postId: OTHER_POST_ID, textComponents: [{ contents: `${MY_MARKUP} 본문 질문`, mentions: [] }] });
    flow.addComment(OTHER_POST_ID, { commentId: '710', contents: '업무 상태 변경', registerId: ME, registeredDateTime: '20261020085100', systemCode: 'S45_2^^대기^^진행' });

    await poll(alarm('101', { postId: OTHER_POST_ID }));

    expect(bundles.state().map(summary)).toEqual([{ place: [OTHER_POST_ID, '-1'], status: 'repo-check-needed', mentions: ['101'], answered: [] }]);
  });

  it('시스템 댓글, 멘션보다 먼저 쓴 글, 같은 초에 쓴 글, 다른 사람의 글은 내 답으로 보지 않는다', async () => {
    const { flow, bundles, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '업무 상태 변경', registerId: ME, registeredDateTime: '20261020085500', systemCode: 'S45_2^^대기^^진행' });
    flow.addReply(POST_ID, '700', { replyId: '891', contents: '먼저 쓴 글', registerId: ME, registeredDateTime: '20261020084900' });
    flow.addReply(POST_ID, '700', { replyId: '892', contents: '같은 초', registerId: ME, registeredDateTime: '20261020085000' });
    flow.addReply(POST_ID, '700', { replyId: '893', contents: '다른 사람 답', registerId: OTHER_SENDER, registeredDateTime: '20261020085500' });

    await poll(alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }));

    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['101'], answered: [] }]);
  });

  it('내가 마지막으로 답한 글보다 앞선 멘션만 묶음에서 빼고, 남은 멘션으로 묶음을 둔다', async () => {
    const { flow, bundles, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '첫 질문에 답함', registerId: ME, registeredDateTime: '20261020085100' });
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 이어서 질문`, registerId: SENDER });

    await poll(
      alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }),
      alarm('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020085200' }),
    );

    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['102'], answered: ['101'] }]);
  });

  it('저장소 확인 필요 묶음에 새 멘션이 올 때 그 사이 쓴 내 답이 있으면, 앞선 멘션은 빼고 새 멘션만 남긴다', async () => {
    const { flow, bundles, poll } = await setup();
    await poll(alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }));

    flow.addReply(POST_ID, '700', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085100' });
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 이어서 질문`, registerId: SENDER });
    await poll(alarm('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020085200' }));

    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['102'], answered: ['101'] }]);
    expect(bundles.state()[0]?.newMentionCount).toBe(1);
  });

  it('처음 10개 뒤의 대댓글로 답했어도 대댓글 목록 API로 찾아 이미 답함으로 본다', async () => {
    const { flow, bundles, poll } = await setup();
    for (let index = 0; index < 10; index += 1) {
      flow.addReply(POST_ID, '700', { replyId: String(810 + index), contents: `대댓글 ${index}`, registerId: OTHER_SENDER, registeredDateTime: '20261020084000' });
    }
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085100' });

    await poll(alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }));

    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'already-answered', mentions: [], answered: ['101'] }]);
  });

  it('내 답을 조회하지 못하면 답하지 않은 것으로 보고 저장소 확인 필요로 올린다', async () => {
    const { flow, bundles, poll } = await setup();
    flow.addPost({ postId: OTHER_POST_ID, textComponents: [{ contents: `${MY_MARKUP} 본문 질문`, mentions: [] }] });
    flow.addComment(OTHER_POST_ID, { commentId: '710', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085100' });
    flow.failOn(`GET /user/comments/${OTHER_POST_ID}`, { kind: 'network' });

    await poll(alarm('101', { postId: OTHER_POST_ID }));

    expect(bundles.state().map(summary)).toEqual([{ place: [OTHER_POST_ID, '-1'], status: 'repo-check-needed', mentions: ['101'], answered: [] }]);
  });
});

describe('멘션 묶음: 무시와 되돌리기', () => {
  it('무시하면 처리됨의 "무시함"이 되어 트레이 숫자에서 빠지고, 되돌리면 저장소 확인 필요로 돌아온다', async () => {
    const { clock, bundles, poll } = await setup();
    await poll(alarm('101', { remarkId: '700' }));
    /** 묶음 ID. */
    const id = bundles.state()[0]!.id;

    await bundles.ignore(id);
    expect([bundles.state()[0]?.status, bundles.state()[0]?.processedAt, bundles.reviewCount()]).toEqual(['ignored', NOW, 0]);

    clock.advance(1_000);
    await bundles.restore(id);
    expect([bundles.state()[0]?.status, bundles.state()[0]?.processedAt, bundles.reviewCount()]).toEqual(['repo-check-needed', null, 1]);
  });

  it('이미 답함에서 되돌리면 빠졌던 멘션이 다시 들고, 그때 있던 내 답은 이후 판정에서 빼서 같은 답으로 다시 처리됨이 되지 않는다', async () => {
    const { flow, bundles, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085100' });
    await poll(alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }));
    /** 이미 답함이 된 묶음. */
    const answered = bundles.state()[0]!;

    await bundles.restore(answered.id);
    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['101'], answered: [] }]);
    expect(bundles.state()[0]?.answers).toEqual([{ answerId: '890', registeredDateTime: '20261020085100', excluded: true }]);

    // 다음 멘션이 와서 다시 판정해도 되돌릴 때 기록한 답은 세지 않는다.
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 이어서 질문`, registerId: SENDER });
    await poll(alarm('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020085200' }));
    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['101', '102'], answered: [] }]);

    // 되돌린 뒤 새로 쓴 내 답은 센다.
    flow.addReply(POST_ID, '700', { replyId: '891', contents: '다시 답함', registerId: ME, registeredDateTime: '20261020085300' });
    flow.addReply(POST_ID, '700', { replyId: '802', contents: `${MY_MARKUP} 마지막 질문`, registerId: SENDER });
    await poll(alarm('103', { remarkId: '700', replyId: '802', registeredDateTime: '20261020085400' }));
    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['103'], answered: ['101', '102'] }]);
  });

  it('이미 답함에서 되돌리면 그때 Flow에 있는 내 답을 새로 조회해 빼기로 기록한다. 처리됨이 된 뒤 쓴 답도 묶음을 다시 처리됨으로 보내지 않는다', async () => {
    const { flow, bundles, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085100' });
    await poll(alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }));
    // 처리됨이 된 뒤 Flow에서 한 번 더 답했다.
    flow.addReply(POST_ID, '700', { replyId: '891', contents: '덧붙여 답함', registerId: ME, registeredDateTime: '20261020085300' });

    await bundles.restore(bundles.state()[0]!.id);
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 이어서 질문`, registerId: SENDER });
    await poll(alarm('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020085400' }));

    expect(bundles.state()[0]?.answers).toEqual([
      { answerId: '890', registeredDateTime: '20261020085100', excluded: true },
      { answerId: '891', registeredDateTime: '20261020085300', excluded: true },
    ]);
    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['101', '102'], answered: [] }]);
  });

  it('되돌릴 때 내 답을 조회하지 못하면 판정 때 기록한 답만 빼기로 기록하고 되돌린다', async () => {
    const { flow, answersLookup, bundles, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085100' });
    await poll(alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }));
    answersLookup.fails = true;

    await bundles.restore(bundles.state()[0]!.id);

    expect(bundles.state()[0]?.answers).toEqual([{ answerId: '890', registeredDateTime: '20261020085100', excluded: true }]);
    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['101'], answered: [] }]);
  });

  it('무시함에서 되돌리면 내 답을 빼지 않아, 내가 이미 답한 앞선 멘션은 묶음에서 빠진 채로 둔다', async () => {
    const { flow, bundles, poll } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '첫 질문에 답함', registerId: ME, registeredDateTime: '20261020085100' });
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 이어서 질문`, registerId: SENDER });
    await poll(
      alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }),
      alarm('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020085200' }),
    );
    /** 묶음 ID. */
    const id = bundles.state()[0]!.id;

    await bundles.ignore(id);
    await bundles.restore(id);

    expect(bundles.state().map(summary)).toEqual([{ place: [POST_ID, '700'], status: 'repo-check-needed', mentions: ['102'], answered: ['101'] }]);
    expect(bundles.state()[0]?.answers.map((answer) => answer.excluded)).toEqual([false]);
  });

  it('처리됨이 아닌 묶음은 되돌리지 않고, 처리됨 묶음은 다시 무시하지 않으며, 없는 묶음은 아무것도 하지 않는다', async () => {
    const { bundles, poll } = await setup();
    await poll(alarm('101', { remarkId: '700' }));
    /** 묶음 ID. */
    const id = bundles.state()[0]!.id;

    await bundles.restore(id);
    await bundles.ignore(999);
    expect(bundles.state()[0]?.status).toBe('repo-check-needed');

    await bundles.ignore(id);
    /** 처음 무시한 시각. */
    const processedAt = bundles.state()[0]?.processedAt;
    await bundles.ignore(id);
    expect(bundles.state()[0]?.processedAt).toBe(processedAt);
  });

  it('무시와 되돌리기는 상태 저장소에 남아, 다시 읽어도 같다', async () => {
    const { stateStore, notifier, clock, bundles, poll } = await setup();
    await poll(alarm('101', { remarkId: '700' }));
    await bundles.ignore(bundles.state()[0]!.id);

    /** 같은 저장소를 다시 읽은 멘션 묶음. */
    const reloaded = new MentionBundles({
      stateStore,
      notifier,
      clock,
      logger: createLogger([], clock),
      findMyAnswers: async () => null,
      collectContext: async () => null,
      resolveRepos: async () => GONE_REPO,
    });
    await reloaded.load();

    expect(reloaded.state()).toEqual(bundles.state());
  });
});

describe('멘션 묶음: 대기열과 트레이 숫자', () => {
  it('처리되지 않은 묶음을 가장 오래된 미처리 멘션 순으로 두고, 처리됨 묶음은 그 뒤에 최근에 처리한 것부터 둔다', async () => {
    const { flow, clock, bundles, poll } = await setup();
    flow.addComment(POST_ID, { commentId: '701', contents: `${MY_MARKUP} 질문`, registerId: SENDER });
    flow.addComment(POST_ID, { commentId: '702', contents: `${MY_MARKUP} 질문`, registerId: SENDER });
    flow.addComment(POST_ID, { commentId: '703', contents: `${MY_MARKUP} 질문`, registerId: SENDER });
    await poll(
      alarm('101', { remarkId: '703', registeredDateTime: '20261020084000' }),
      alarm('102', { remarkId: '701', registeredDateTime: '20261020084500' }),
    );
    await poll(alarm('103', { remarkId: '702', registeredDateTime: '20261020085000' }), alarm('104', { remarkId: '700', registeredDateTime: '20261020083000' }));
    /** 자리(댓글)로 찾은 묶음 ID. */
    const idOf = (remarkId: string) => bundles.state().find((bundle) => bundle.remarkId === remarkId)!.id;
    await bundles.ignore(idOf('703'));
    clock.advance(1_000);
    await bundles.ignore(idOf('702'));

    expect(bundles.state().map((bundle) => [bundle.remarkId, bundle.status])).toEqual([
      ['700', 'repo-check-needed'],
      ['701', 'repo-check-needed'],
      ['702', 'ignored'],
      ['703', 'ignored'],
    ]);
    expect(bundles.reviewCount()).toBe(2);
  });

  it('한 번의 조회에서 새 묶음이 여럿이면 OS 알림을 하나만 띄우고, 누르면 대기열 첫 묶음을 연다. 묶음이 바뀌면 듣는 쪽에 알린다', async () => {
    const { flow, notifier, bundles, poll } = await setup();
    flow.addComment(POST_ID, { commentId: '701', contents: `${MY_MARKUP} 질문`, registerId: OTHER_SENDER });
    /** 바뀐 횟수. */
    let changes = 0;
    bundles.onChange(() => (changes += 1));

    await poll(
      alarm('102', { remarkId: '701', registerName: '다른 사람', registeredDateTime: '20261020085100' }),
      alarm('101', { remarkId: '700', registeredDateTime: '20261020085000' }),
    );

    /** 대기열 첫 묶음. */
    const first = bundles.state()[0]!;
    expect(first.remarkId).toBe('700');
    expect(notifier.sent).toEqual([{ title: '저장소 확인 필요 2건', body: '보낸 사람님 외 1건의 멘션이 왔습니다.', bundleId: first.id }]);
    // 멘션을 넣을 때 한 번, 두 묶음의 맥락을 저장할 때 한 번 알린다.
    expect(changes).toBe(2);
  });
});

describe('멘션 묶음: 초안 편집과 받는 사람', () => {
  /** 송신자의 댓글 멘션과 다른 송신자의 대댓글 멘션이 든 묶음에 초안을 담아 준비됨으로 둔다. */
  async function readyBundle() {
    const context = await setup();
    const { flow, bundles, poll } = context;
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 덧붙여 질문`, registerId: OTHER_SENDER, registerName: '다른 사람' });
    await poll(
      alarm('101', { remarkId: '700' }),
      alarm('102', { remarkId: '700', replyId: '801', registerId: OTHER_SENDER, registerName: '다른 사람', registeredDateTime: '20261020085100' }),
    );
    /** 묶음 ID. */
    const bundleId = bundles.state()[0]!.id;
    await bundles.regenerateWithRepos(bundleId, ['/fake/work/repo']);
    await bundles.saveDraft(bundleId, DRAFT, [], mentionSetKey(bundles.get(bundleId)!));
    return { ...context, bundleId };
  }

  it('편집하면 편집본을 묶음에 저장하고, 다시 읽어도 남는다. 원래 초안과 같아지면 편집하지 않은 것으로 본다', async () => {
    const { stateStore, notifier, clock, bundles, bundleId } = await readyBundle();

    await bundles.editDraft(bundleId, '재시도는 다섯 번입니다.');
    expect(bundles.get(bundleId)?.editedText).toBe('재시도는 다섯 번입니다.');

    /** 같은 저장소를 다시 읽은 멘션 묶음. 창을 닫았다 열거나 앱을 다시 켠 것과 같다. */
    const reloaded = new MentionBundles({
      stateStore,
      notifier,
      clock,
      logger: createLogger([], clock),
      findMyAnswers: async () => null,
      collectContext: async () => null,
      resolveRepos: async () => GONE_REPO,
    });
    await reloaded.load();
    expect(reloaded.get(bundleId)?.editedText).toBe('재시도는 다섯 번입니다.');

    await bundles.editDraft(bundleId, '재시도는 5번입니다. 간격은 2초입니다.\n\n테스트 환경은 다를 수 있습니다.');
    expect(bundles.get(bundleId)?.editedText).toBeNull();
  });

  it('"원래 초안으로 되돌리기"는 편집본을 버린다', async () => {
    const { bundles, bundleId } = await readyBundle();
    await bundles.editDraft(bundleId, '고친 초안');

    await bundles.revertDraftEdit(bundleId);

    expect(bundles.get(bundleId)?.editedText).toBeNull();
    expect(bundles.get(bundleId)?.draft).toEqual(DRAFT);
  });

  it('화면에 보인 받는 사람 목록의 위치와 이름으로 한 사람을 빼고, 그 사람의 사용자 ID를 묶음에 기록한다', async () => {
    const { bundles, bundleId } = await readyBundle();

    await bundles.removeRecipient(bundleId, 1, '다른 사람');

    expect(bundles.get(bundleId)?.removedRecipients).toEqual([OTHER_SENDER]);
  });

  it('그사이 목록이 바뀌어 그 위치의 이름이 다르거나 위치에 사람이 없으면 아무도 빼지 않는다', async () => {
    const { bundles, bundleId } = await readyBundle();
    await bundles.removeRecipient(bundleId, 0, '보낸 사람');

    // 송신자를 빼서 다른 사람이 0번이 되었다. 옛 화면이 보낸 1번 "다른 사람"은 없는 자리다.
    await bundles.removeRecipient(bundleId, 1, '다른 사람');
    await bundles.removeRecipient(bundleId, 0, '보낸 사람');

    expect(bundles.get(bundleId)?.removedRecipients).toEqual([SENDER]);
  });

  it('새 멘션이 합쳐지면 그 송신자는 전에 ×로 뺐더라도 받는 사람에 다시 더하고, 다른 사람을 뺀 것은 그대로 둔다', async () => {
    const { flow, bundles, bundleId, poll } = await readyBundle();
    await bundles.removeRecipient(bundleId, 0, '보낸 사람');
    await bundles.removeRecipient(bundleId, 0, '다른 사람');
    flow.addReply(POST_ID, '700', { replyId: '802', contents: `${MY_MARKUP} 하나 더`, registerId: OTHER_SENDER, registerName: '다른 사람' });

    await poll(alarm('103', { remarkId: '700', replyId: '802', registerId: OTHER_SENDER, registerName: '다른 사람', registeredDateTime: '20261020085200' }));

    expect(bundles.get(bundleId)).toMatchObject({ newMentionCount: 1, removedRecipients: [SENDER] });
  });

  it('준비됨이 아닌 묶음은 편집하거나 받는 사람을 빼지 않는다', async () => {
    const { bundles, bundleId } = await readyBundle();
    await bundles.ignore(bundleId);

    await bundles.editDraft(bundleId, '고친 초안');
    await bundles.removeRecipient(bundleId, 0, '보낸 사람');

    expect(bundles.get(bundleId)).toMatchObject({ editedText: null, removedRecipients: [] });
  });

  it('다른 저장소로 다시 만들면 직전 초안과 함께 편집본을 버린다', async () => {
    const { bundles, bundleId } = await readyBundle();
    await bundles.editDraft(bundleId, '고친 초안');

    await bundles.regenerateWithRepos(bundleId, ['/fake/work/other']);
    expect(bundles.get(bundleId)?.editedText).toBeNull();
  });
});
