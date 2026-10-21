import { describe, expect, it } from 'vitest';
import { compareMentions, type BundledMention } from '../bundles/mention-bundle';
import { MentionBundles } from '../bundles/mention-bundles';
import { FakeClock } from '../fakes/fake-clock';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger } from '../logging/logger';
import type { FlowAlarm } from '../ports/flow-api';
import { MentionDetection } from './mention-detection';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시(00:00:00 UTC). */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 나(키 소유자)의 사용자 ID. */
const ME = FAKE_ME.userId;
/** 송신자. 실제 사람이 아니다. */
const SENDER = 'sender@example.test';
/** 멘션이 온 게시물. */
const POST_ID = '90000011';

/** 가짜 멘션 알림. 기본은 1분 전에 온 본문 멘션이다. */
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
    registeredDateTime: '20261020085900',
    ...overrides,
  };
}

/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${ME})`;

/** 가짜 시계가 부른 조회가 끝나도록 대기 중인 비동기 일을 모두 돌린다. 가짜 포트는 모두 바로 답한다. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

/** 상태 저장소의 묶음에 든 멘션. 알림 시각 순서다. */
async function storedMentions(stateStore: MemoryStateStore): Promise<BundledMention[]> {
  return (await stateStore.listBundles()).flatMap((bundle) => bundle.mentions).sort(compareMentions);
}

/** 알림 목록을 조회한 횟수. */
function alarmRequests(flow: FakeFlowApi): number {
  return flow.requests.filter((request) => request.startsWith('GET /user/alarms')).length;
}

/** 가짜 포트로 멘션 감지를 만든다. 기준점은 `'100'`, 계정은 가짜 키 소유자다. */
async function setup({ baseline = '100' as string | null } = {}) {
  const clock = new FakeClock(NOW);
  const flow = new FakeFlowApi();
  const stateStore = new MemoryStateStore();
  stateStore.account = { ...FAKE_ME };
  stateStore.baselineAlarmId = baseline;
  const notifier = new RecordingNotifier();
  /** Flow가 키를 거부했다고 알린 횟수. */
  const rejected = { count: 0 };
  /** 남긴 진단 로그 줄. */
  const logLines: string[] = [];
  const logger = createLogger([{ write: (line) => logLines.push(line) }], clock);
  const bundles = new MentionBundles({
    stateStore,
    notifier,
    clock,
    logger,
    findMyAnswers: async () => null,
    collectContext: async () => null,
    resolveRepos: async () => ({ kind: 'unmapped' }),
  });
  await bundles.load();
  const detection = new MentionDetection({
    stateStore,
    bundles,
    clock,
    logger,
    connectFlow: () => ({ api: flow, reportKeyRejected: () => (rejected.count += 1) }),
  });
  flow.addPost({ postId: POST_ID, textComponents: [{ contents: '본문', mentions: [] }] });
  return { clock, flow, stateStore, notifier, rejected, logLines, bundles, detection };
}

describe('멘션 감지: 폴링', () => {
  it('감지를 시작하면 바로 알림을 조회하고, 나를 지목한 댓글 멘션을 멘션 위치로 저장하고 트레이 숫자와 OS 알림을 올린다', async () => {
    const { flow, stateStore, notifier, bundles, detection } = await setup();
    flow.addComment(POST_ID, { commentId: '700', contents: `${MY_MARKUP} 재시도는 몇 번 하나요?` });
    flow.respondToListMentionAlarms([alarm('101', { remarkId: '700' })]);

    await detection.start();

    expect(await storedMentions(stateStore)).toEqual([
      {
        postId: POST_ID,
        remarkId: '700',
        replyId: '-1',
        projectId: '900001',
        alarmId: '101',
        senderId: SENDER,
        senderName: '보낸 사람',
        registeredDateTime: '20261020085900',
        detectedAt: NOW,
        text: `${MY_MARKUP} 재시도는 몇 번 하나요?`,
        answered: false,
      },
    ]);
    expect(bundles.reviewCount()).toBe(1);
    expect(notifier.sent).toEqual([{ title: '저장소 확인 필요', body: '보낸 사람님이 나를 멘션했습니다.', bundleId: 1 }]);
    expect(stateStore.baselineAlarmId).toBe('101');
    // 알림 목록은 readYn 없이 조회만 하고, 읽음 처리 API는 부르지 않는다. 게시물은 묶음의 제목과 "Flow에서 열기" 주소를 읽으려고 조회한다.
    expect(flow.requests).toEqual(['GET /user/alarms', `GET /user/comments/${POST_ID}`, `GET /user/posts/${POST_ID}`]);
  });

  it('감지 중에는 60초마다 알림 목록을 다시 조회한다', async () => {
    const { clock, flow, detection } = await setup();
    await detection.start();

    clock.advance(59_999);
    await settle();
    expect(alarmRequests(flow)).toBe(1);

    clock.advance(1);
    await settle();
    expect(alarmRequests(flow)).toBe(2);

    clock.advance(60_000);
    await settle();
    expect(alarmRequests(flow)).toBe(3);
  });

  it('"지금 확인"과 잠자기에서 깨어남은 바로 조회하고, 다음 조회는 그때부터 60초 뒤다', async () => {
    const { clock, flow, detection } = await setup();
    await detection.start();
    clock.advance(30_000);

    await detection.checkNow();
    expect(alarmRequests(flow)).toBe(2);

    clock.advance(59_999);
    await settle();
    expect(alarmRequests(flow)).toBe(2);
    clock.advance(1);
    await settle();
    expect(alarmRequests(flow)).toBe(3);
  });

  it('감지를 시작하기 전이나 멈춘 뒤에는 "지금 확인"이 조회하지 않는다', async () => {
    const { clock, flow, detection } = await setup();

    await detection.checkNow();
    expect(flow.requests).toEqual([]);

    await detection.start();
    detection.stop();
    await detection.checkNow();
    clock.advance(10 * 60_000);
    await settle();
    expect(alarmRequests(flow)).toBe(1);
  });

  it('조회 중에 "지금 확인"이 오면 그 조회가 끝난 뒤 한 번만 더 조회한다', async () => {
    const { flow, detection } = await setup();

    /** 진행 중인 첫 조회. */
    const first = detection.start();
    /** 그 사이에 누른 "지금 확인" 두 번. */
    const again = [detection.checkNow(), detection.checkNow()];
    await Promise.all([first, ...again]);

    expect(alarmRequests(flow)).toBe(2);
  });
});

/** 게시물 본문에 나를 지목한 멘션이 있는 게시물을 둔다. */
function addPostMentioningMe(flow: FakeFlowApi, postId: string): void {
  flow.addPost({ postId, textComponents: [{ contents: `${MY_MARKUP} 확인 부탁드립니다.`, mentions: [ME] }] });
}

describe('멘션 감지: 기준점과 72시간', () => {
  it('기준점 이하의 알림을 만나면 쪽 넘기기를 멈추고, 기준점을 이번에 본 가장 큰 alarmId로 옮긴다', async () => {
    const { flow, stateStore, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'p1');
    addPostMentioningMe(flow, 'p2');
    flow.alarmPageSize = 2;
    flow.respondToListMentionAlarms([
      alarm('103', { postId: 'p2' }),
      alarm('102', { postId: 'p1' }),
      alarm('100', { postId: 'p0' }),
      alarm('99', { postId: 'p0' }),
    ]);

    await detection.start();

    expect((await storedMentions(stateStore)).map((mention) => mention.postId)).toEqual(['p1', 'p2']);
    expect(stateStore.baselineAlarmId).toBe('103');
    expect(flow.requests.filter((request) => request.startsWith('GET /user/alarms'))).toEqual([
      'GET /user/alarms',
      'GET /user/alarms?cursor=2',
    ]);
    expect(flow.requests).not.toContain('GET /user/posts/p0');
  });

  it('alarmId는 숫자 크기로 비교한다(자릿수가 많은 쪽이 크다)', async () => {
    const { flow, stateStore, bundles, detection } = await setup({ baseline: '999' });
    addPostMentioningMe(flow, 'p1');
    flow.respondToListMentionAlarms([alarm('1000', { postId: 'p1' }), alarm('999')]);

    await detection.start();

    expect(bundles.reviewCount()).toBe(1);
    expect(stateStore.baselineAlarmId).toBe('1000');
  });

  it('72시간보다 오래된 알림을 만나면 멈추고 그 알림부터는 가져오지 않는다', async () => {
    const { flow, stateStore, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'recent');
    addPostMentioningMe(flow, 'edge');
    addPostMentioningMe(flow, 'old');
    flow.respondToListMentionAlarms([
      // 2026-10-17 09:00:00 KST는 지금부터 정확히 72시간 전이다.
      alarm('103', { postId: 'recent', registeredDateTime: '20261019120000' }),
      alarm('102', { postId: 'edge', registeredDateTime: '20261017090000' }),
      alarm('101', { postId: 'old', registeredDateTime: '20261017085959' }),
    ]);

    await detection.start();

    expect((await storedMentions(stateStore)).map((mention) => mention.postId)).toEqual(['edge', 'recent']);
    expect(flow.requests).not.toContain('GET /user/posts/old');
    expect(stateStore.baselineAlarmId).toBe('103');
  });

  it('hasNext가 거짓이면(마지막 쪽) 기준점에 닿지 않아도 멈춘다', async () => {
    const { flow, stateStore, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'p1');
    flow.alarmPageSize = 20;
    flow.respondToListMentionAlarms([alarm('101', { postId: 'p1' })]);

    await detection.start();

    expect(flow.requests.filter((request) => request.startsWith('GET /user/alarms'))).toEqual(['GET /user/alarms']);
    expect((await storedMentions(stateStore)).length).toBe(1);
  });

  it('쪽을 넘기는 사이에 새 알림이 와서 같은 알림이 두 번 와도 멘션은 하나만 저장하고 알림도 한 번 띄운다', async () => {
    const { flow, stateStore, notifier, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'p1');
    addPostMentioningMe(flow, 'p2');
    addPostMentioningMe(flow, 'p3');
    flow.alarmPageSize = 2;
    flow.respondToListMentionAlarms([alarm('103', { postId: 'p3' }), alarm('102', { postId: 'p2' }), alarm('101', { postId: 'p1' })]);
    // 둘째 쪽을 받기 직전에 새 알림이 와서 102가 둘째 쪽으로 밀린다.
    flow.whenRequested('GET /user/alarms?cursor=2', () => flow.addAlarm(alarm('104', { postId: 'p3', remarkId: '-1' })));

    await detection.start();

    expect((await storedMentions(stateStore)).map((mention) => [mention.postId, mention.alarmId])).toEqual([
      ['p1', '101'],
      ['p2', '102'],
      ['p3', '103'],
    ]);
    expect(notifier.sent).toEqual([{ title: '저장소 확인 필요 3건', body: '보낸 사람님 외 2건의 멘션이 왔습니다.', bundleId: 1 }]);
    // 한 번의 조회에서 같은 게시물은 한 번만 받는다.
    expect(flow.requests.filter((request) => request === 'GET /user/posts/p2')).toHaveLength(1);
  });

  it('같은 멘션 위치에서 알림이 여럿 와도 멘션은 하나이고, 가장 먼저 온 알림으로 저장한다', async () => {
    const { flow, stateStore, detection } = await setup({ baseline: '100' });
    flow.addComment(POST_ID, { commentId: '700', contents: `${MY_MARKUP} 질문` });
    flow.respondToListMentionAlarms([
      alarm('105', { remarkId: '700', registeredDateTime: '20261020085900' }),
      alarm('101', { remarkId: '700', registeredDateTime: '20261020080000' }),
    ]);

    await detection.start();

    expect(await storedMentions(stateStore)).toEqual([
      expect.objectContaining({ remarkId: '700', alarmId: '101', registeredDateTime: '20261020080000' }),
    ]);
    expect(stateStore.baselineAlarmId).toBe('105');
  });

  it('기준점이 없으면(다른 계정의 키로 바꿔 기록을 비움) 가장 최근 alarmId를 기준점으로 잡고 과거 멘션은 가져오지 않는다', async () => {
    const { flow, stateStore, notifier, detection } = await setup({ baseline: null });
    addPostMentioningMe(flow, 'p1');
    flow.respondToListMentionAlarms([alarm('205', { postId: 'p1' }), alarm('204', { postId: 'p1' })]);

    await detection.start();

    expect(stateStore.baselineAlarmId).toBe('205');
    expect((await storedMentions(stateStore)).length).toBe(0);
    expect(notifier.sent).toEqual([]);
    expect(flow.requests).toEqual(['GET /user/alarms']);
  });

  it('기준점을 새로 잡을 때 알림이 하나도 없으면 0으로 잡아 그 뒤의 멘션을 모두 처리한다', async () => {
    const { clock, flow, stateStore, detection } = await setup({ baseline: null });
    flow.respondToListMentionAlarms([]);
    await detection.start();
    expect(stateStore.baselineAlarmId).toBe('0');

    addPostMentioningMe(flow, 'p1');
    flow.addAlarm(alarm('1', { postId: 'p1' }));
    clock.advance(60_000);
    await settle();

    expect((await storedMentions(stateStore)).length).toBe(1);
  });
});

/** 기준점 뒤에 알림 하나를 두고 감지를 한 번 돌려, 저장한 멘션 위치를 돌려준다. */
async function detectOne(prepare: (flow: FakeFlowApi) => void, notice: FlowAlarm) {
  const context = await setup({ baseline: '100' });
  prepare(context.flow);
  context.flow.respondToListMentionAlarms([notice]);
  await context.detection.start();
  return { ...context, stored: (await storedMentions(context.stateStore)).map(({ postId, remarkId, replyId }) => [postId, remarkId, replyId]) };
}

describe('멘션 감지: 나를 지목했는지 판정', () => {
  it('본문 멘션은 TEXT 컴포넌트의 MENTIONS에 내 ID가 있으면 멘션이다', async () => {
    const { stored } = await detectOne(
      (flow) => flow.addPost({ postId: 'p1', textComponents: [{ contents: '표기 없는 글', mentions: [ME.toUpperCase()] }] }),
      alarm('101', { postId: 'p1' }),
    );

    expect(stored).toEqual([['p1', '-1', '-1']]);
  });

  it('본문 멘션은 MENTIONS가 비어 있어도 다른 TEXT 컴포넌트의 CONTENTS에 내 표기가 있으면 멘션이다', async () => {
    const { stored } = await detectOne(
      (flow) =>
        flow.addPost({
          postId: 'p1',
          textComponents: [
            { contents: '첫 문단', mentions: [] },
            { contents: `둘째 문단 ${MY_MARKUP}`, mentions: [] },
          ],
        }),
      alarm('101', { postId: 'p1' }),
    );

    expect(stored).toEqual([['p1', '-1', '-1']]);
  });

  it('@전체(MENTIONS: ["ALL"])와 다른 사람만 지목한 본문은 멘션이 아니다', async () => {
    const { stored, notifier, stateStore } = await detectOne(
      (flow) =>
        flow.addPost({
          postId: 'p1',
          textComponents: [{ contents: '@[전체](ALL) @[다른 사람](other@example.test) 공지', mentions: ['ALL', 'other@example.test'] }],
        }),
      alarm('101', { postId: 'p1' }),
    );

    expect(stored).toEqual([]);
    expect(notifier.sent).toEqual([]);
    // 버린 알림도 판정을 마쳤으므로 기준점은 넘어간다.
    expect(stateStore.baselineAlarmId).toBe('101');
  });

  it('댓글 멘션은 그 댓글의 contents에 내 표기가 있어야 하고, 다른 사람의 표기만 있으면 멘션이 아니다', async () => {
    const { stored } = await detectOne((flow) => {
      flow.addComment(POST_ID, { commentId: '700', contents: '@[다른 사람](other@example.test) 이것 보세요' });
    }, alarm('101', { remarkId: '700' }));

    expect(stored).toEqual([]);
  });

  it('댓글 목록이 여러 쪽이면 넘겨서 그 댓글을 찾는다', async () => {
    const { stored, flow } = await detectOne((flow) => {
      flow.commentPageSize = 2;
      flow.addComment(POST_ID, { commentId: '701', contents: '하나' });
      flow.addComment(POST_ID, { commentId: '702', contents: '둘' });
      flow.addComment(POST_ID, { commentId: '703', contents: `${MY_MARKUP} 셋` });
    }, alarm('101', { remarkId: '703' }));

    expect(stored).toEqual([[POST_ID, '703', '-1']]);
    expect(flow.requests).toContain(`GET /user/comments/${POST_ID}?cursor=2`);
  });

  it('대댓글 멘션은 댓글과 함께 받은 처음 10개에서 찾고, 대댓글 API는 부르지 않는다', async () => {
    const { stored, flow } = await detectOne((flow) => {
      flow.addComment(POST_ID, {
        commentId: '700',
        contents: '머리 댓글',
        replies: [
          { replyId: '800', contents: '앞선 대댓글' },
          { replyId: '801', contents: `${MY_MARKUP} 대댓글 질문` },
        ],
      });
    }, alarm('101', { remarkId: '700', replyId: '801' }));

    expect(stored).toEqual([[POST_ID, '700', '801']]);
    expect(flow.requests.some((request) => request.includes('/replies/'))).toBe(false);
  });

  it('대댓글이 처음 10개에 없으면 대댓글 API로 쪽을 넘겨 찾는다', async () => {
    /** 머리 댓글 아래 대댓글 25개. 마지막만 나를 지목한다. */
    const replies = Array.from({ length: 25 }, (_, index) => ({
      replyId: String(800 + index),
      contents: index === 24 ? `${MY_MARKUP} 마지막 질문` : `대댓글 ${index}`,
    }));
    const { stored, flow } = await detectOne((flow) => {
      flow.replyPageSize = 10;
      flow.addComment(POST_ID, { commentId: '700', contents: '머리 댓글', replies });
    }, alarm('101', { remarkId: '700', replyId: '824' }));

    expect(stored).toEqual([[POST_ID, '700', '824']]);
    expect(flow.requests.filter((request) => request.includes('/replies/'))).toEqual([
      `GET /user/comments/${POST_ID}/replies/700`,
      `GET /user/comments/${POST_ID}/replies/700?cursor=10`,
      `GET /user/comments/${POST_ID}/replies/700?cursor=20`,
    ]);
  });

  it('대댓글 API로 넘겨도 대댓글이 없으면 지워진 것으로 보고 버린다', async () => {
    const replies = Array.from({ length: 12 }, (_, index) => ({ replyId: String(800 + index), contents: `대댓글 ${index}` }));
    const { stored, stateStore } = await detectOne((flow) => {
      flow.addComment(POST_ID, { commentId: '700', contents: '머리 댓글', replies });
    }, alarm('101', { remarkId: '700', replyId: '899' }));

    expect(stored).toEqual([]);
    expect(stateStore.baselineAlarmId).toBe('101');
  });
});

describe('멘션 감지: 조용히 버리는 알림', () => {
  it('송신자가 나인 알림은 글을 조회하지 않고 버린다', async () => {
    const { stored, flow } = await detectOne(
      (flow) => addPostMentioningMe(flow, 'p1'),
      alarm('101', { postId: 'p1', registerId: ME, registerName: '테스트 사용자' }),
    );

    expect(stored).toEqual([]);
    expect(flow.requests).toEqual(['GET /user/alarms']);
  });

  it('알림의 receiverId를 내 ID로 써서 판정하고, 키 확인 때 얻은 사용자 ID와 다르면 버리지 않고 경고만 남긴다', async () => {
    /** 키 확인 때와 다른 모양으로 온 내 ID. */
    const receiverId = 'me.alias@example.test';
    const { stored, logLines } = await detectOne(
      (flow) => flow.addComment(POST_ID, { commentId: '700', contents: `@[테스트 사용자](${receiverId}) 질문` }),
      alarm('101', { remarkId: '700', receiverId }),
    );

    expect(stored).toEqual([[POST_ID, '700', '-1']]);
    expect(logLines.some((line) => line.includes('"detection.receiver-mismatch"') && line.includes('"warn"'))).toBe(true);
    expect(logLines.join('')).not.toContain(receiverId);
  });

  it('송신자가 키 확인 때 얻은 내 사용자 ID와 같아도 송신자가 나인 알림으로 버린다', async () => {
    const { stored } = await detectOne(
      (flow) => addPostMentioningMe(flow, 'p1'),
      alarm('101', { postId: 'p1', receiverId: 'me.alias@example.test', registerId: ME }),
    );

    expect(stored).toEqual([]);
  });

  it('글이 지워졌거나(404) 권한이 없으면(403) 버리고 기준점은 넘어간다', async () => {
    const context = await setup({ baseline: '100' });
    addPostMentioningMe(context.flow, 'forbidden');
    context.flow.failOn('GET /user/posts/forbidden', { kind: 'http', status: 403 });
    addPostMentioningMe(context.flow, 'kept');
    context.flow.respondToListMentionAlarms([
      alarm('103', { postId: 'kept' }),
      alarm('102', { postId: 'forbidden' }),
      alarm('101', { postId: 'deleted' }),
    ]);

    await context.detection.start();

    expect((await storedMentions(context.stateStore)).map((mention) => mention.postId)).toEqual(['kept']);
    expect(context.stateStore.baselineAlarmId).toBe('103');
  });

  it('댓글이 지워져 목록에 없으면 버린다', async () => {
    const { stored } = await detectOne(() => {}, alarm('101', { remarkId: '799' }));

    expect(stored).toEqual([]);
  });

  it('수정되어 내 표기가 사라진 댓글은 버린다', async () => {
    const { stored } = await detectOne((flow) => {
      flow.addComment(POST_ID, { commentId: '700', contents: '테스트 사용자님 확인 부탁드립니다' });
    }, alarm('101', { remarkId: '700' }));

    expect(stored).toEqual([]);
  });

  it('이미 기록한 멘션 위치에서 다시 온 알림은 글을 조회하지 않고 버리며, 트레이 숫자와 알림도 그대로다', async () => {
    const { clock, flow, stateStore, notifier, bundles, detection } = await setup({ baseline: '100' });
    flow.addComment(POST_ID, { commentId: '700', contents: `${MY_MARKUP} 질문` });
    flow.respondToListMentionAlarms([alarm('101', { remarkId: '700' })]);
    await detection.start();

    flow.addAlarm(alarm('102', { remarkId: '700' }));
    clock.advance(60_000);
    await settle();

    expect((await storedMentions(stateStore)).length).toBe(1);
    expect(bundles.reviewCount()).toBe(1);
    expect(notifier.sent).toHaveLength(1);
    expect(flow.requests.filter((request) => request.startsWith('GET /user/comments'))).toHaveLength(1);
    expect(stateStore.baselineAlarmId).toBe('102');
  });

  it('72시간보다 오래된 알림은 기준점 뒤에 있어도 판정하지 않는다', async () => {
    const { stored, flow } = await detectOne(
      (flow) => addPostMentioningMe(flow, 'p1'),
      alarm('101', { postId: 'p1', registeredDateTime: '20261001090000' }),
    );

    expect(stored).toEqual([]);
    expect(flow.requests).toEqual(['GET /user/alarms']);
  });
});

describe('멘션 감지: 오류', () => {
  it('401이면 "키 확인 필요"를 알리고 폴링을 멈추며, 키를 다시 확인해 시작하면 바로 다시 조회한다', async () => {
    const { clock, flow, rejected, detection } = await setup();
    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'unauthorized' } });

    await detection.start();
    expect(rejected.count).toBe(1);

    clock.advance(10 * 60_000);
    await settle();
    await detection.checkNow();
    expect(alarmRequests(flow)).toBe(1);

    flow.respondToListMentionAlarms([]);
    await detection.start();
    expect(alarmRequests(flow)).toBe(2);
    clock.advance(60_000);
    await settle();
    expect(alarmRequests(flow)).toBe(3);
  });

  it('조회하는 사이에 키를 다시 확인해 감지를 시작했으면, 옛 키로 받은 401 때문에 폴링을 멈추지 않는다', async () => {
    const { clock, flow, detection } = await setup();
    flow.failOn('GET /user/alarms', { kind: 'unauthorized' }, 1);

    /** 옛 키로 시작한 조회. */
    const first = detection.start();
    /** 그 사이에 새 키를 확인해 다시 시작함. */
    const restarted = detection.start();
    await Promise.all([first, restarted]);
    expect(alarmRequests(flow)).toBe(2);

    clock.advance(60_000);
    await settle();
    expect(alarmRequests(flow)).toBe(3);
  });

  it('글을 판정하다 401이 와도 "키 확인 필요"를 알리고 폴링을 멈춘다. 기준점은 판정을 마친 알림까지만 옮긴다', async () => {
    const { clock, flow, stateStore, rejected, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'p1');
    addPostMentioningMe(flow, 'p2');
    flow.failOn('GET /user/posts/p2', { kind: 'unauthorized' });
    flow.respondToListMentionAlarms([alarm('102', { postId: 'p2' }), alarm('101', { postId: 'p1' })]);

    await detection.start();
    clock.advance(10 * 60_000);
    await settle();

    expect(rejected.count).toBe(1);
    expect(alarmRequests(flow)).toBe(1);
    expect(stateStore.baselineAlarmId).toBe('101');
    expect((await storedMentions(stateStore)).map((mention) => mention.postId)).toEqual(['p1']);
  });

  it('429면 Retry-After만큼 기다렸다가 다시 조회하고, 그동안 "지금 확인"도 앞당기지 않는다', async () => {
    const { clock, flow, detection } = await setup();
    flow.failOn('GET /user/alarms', { kind: 'rate-limited', retryAfterMs: 90_000 }, 1);

    await detection.start();
    clock.advance(60_000);
    await settle();
    await detection.checkNow();
    expect(alarmRequests(flow)).toBe(1);

    clock.advance(30_000);
    await settle();
    expect(alarmRequests(flow)).toBe(2);
    clock.advance(60_000);
    await settle();
    expect(alarmRequests(flow)).toBe(3);
  });

  it('429에 Retry-After가 없으면 다음 주기(60초 뒤)에 다시 조회한다', async () => {
    const { clock, flow, detection } = await setup();
    flow.failOn('GET /user/alarms', { kind: 'rate-limited', retryAfterMs: null }, 1);

    await detection.start();
    clock.advance(59_999);
    await settle();
    expect(alarmRequests(flow)).toBe(1);
    clock.advance(1);
    await settle();
    expect(alarmRequests(flow)).toBe(2);
  });

  it('알림 목록 조회가 연결 실패면 기준점을 그대로 두고 다음 주기에 다시 조회해 그 멘션을 가져온다', async () => {
    const { clock, flow, stateStore, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'p1');
    flow.respondToListMentionAlarms([alarm('101', { postId: 'p1' })]);
    flow.failOn('GET /user/alarms', { kind: 'network' }, 1);

    await detection.start();
    expect(stateStore.baselineAlarmId).toBe('100');

    clock.advance(60_000);
    await settle();
    expect((await storedMentions(stateStore)).length).toBe(1);
    expect(stateStore.baselineAlarmId).toBe('101');
  });

  it('판정 중 연결이 끊기면 앞서 판정한 멘션만 저장하고, 다음 주기에 나머지를 다시 판정한다', async () => {
    const { clock, flow, stateStore, notifier, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'p1');
    addPostMentioningMe(flow, 'p2');
    addPostMentioningMe(flow, 'p3');
    flow.failOn('GET /user/posts/p2', { kind: 'network' }, 1);
    flow.respondToListMentionAlarms([alarm('103', { postId: 'p3' }), alarm('102', { postId: 'p2' }), alarm('101', { postId: 'p1' })]);

    await detection.start();
    expect((await storedMentions(stateStore)).map((mention) => mention.postId)).toEqual(['p1']);
    expect(stateStore.baselineAlarmId).toBe('101');
    expect(flow.requests).not.toContain('GET /user/posts/p3');

    clock.advance(60_000);
    await settle();
    expect((await storedMentions(stateStore)).map((mention) => mention.postId)).toEqual(['p1', 'p2', 'p3']);
    expect(stateStore.baselineAlarmId).toBe('103');
    expect(notifier.sent.map((sent) => sent.title)).toEqual(['저장소 확인 필요', '저장소 확인 필요 2건']);
  });

  it('판정 중 서버 오류(5xx)는 다음 주기에 다시 판정한다', async () => {
    const { clock, flow, stateStore, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'p1');
    flow.failOn('GET /user/posts/p1', { kind: 'http', status: 503 }, 1);
    flow.respondToListMentionAlarms([alarm('101', { postId: 'p1' })]);

    await detection.start();
    expect((await storedMentions(stateStore)).length).toBe(0);
    expect(stateStore.baselineAlarmId).toBe('100');

    clock.advance(60_000);
    await settle();
    expect((await storedMentions(stateStore)).length).toBe(1);
  });

  it('모르는 응답 모양이나 그 밖의 응답 코드로 판정하지 못한 알림은 다음 조회에서 다시 판정하고, 세 번 연속 실패하면 버리고 넘어간다', async () => {
    const { clock, flow, stateStore, logLines, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'broken');
    addPostMentioningMe(flow, 'p2');
    flow.failOn('GET /user/posts/broken', { kind: 'unexpected-response' });
    flow.respondToListMentionAlarms([alarm('102', { postId: 'p2' }), alarm('101', { postId: 'broken' })]);

    await detection.start();
    clock.advance(60_000);
    await settle();
    // 두 번째 실패까지는 그 알림에서 멈추므로 뒤의 멘션도 아직 저장하지 않는다.
    expect((await storedMentions(stateStore)).length).toBe(0);
    expect(stateStore.baselineAlarmId).toBe('100');

    clock.advance(60_000);
    await settle();
    expect((await storedMentions(stateStore)).map((mention) => mention.postId)).toEqual(['p2']);
    expect(stateStore.baselineAlarmId).toBe('102');
    expect(flow.requests.filter((request) => request === 'GET /user/posts/broken')).toHaveLength(3);
    expect(logLines.some((line) => line.includes('"detection.alarm-given-up"') && line.includes('"101"'))).toBe(true);
  });

  it('판정에 한 번 실패한 알림도 다음 조회에서 판정되면 멘션으로 저장한다', async () => {
    const { clock, flow, stateStore, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'p1');
    flow.failOn('GET /user/posts/p1', { kind: 'http', status: 400 }, 2);
    flow.respondToListMentionAlarms([alarm('101', { postId: 'p1' })]);

    await detection.start();
    clock.advance(60_000);
    await settle();
    clock.advance(60_000);
    await settle();

    expect((await storedMentions(stateStore)).length).toBe(1);
  });

  it('판정 중 429면 앞서 판정한 멘션을 저장하고 Retry-After 뒤에 나머지를 판정한다', async () => {
    const { clock, flow, stateStore, detection } = await setup({ baseline: '100' });
    addPostMentioningMe(flow, 'p1');
    addPostMentioningMe(flow, 'p2');
    flow.failOn('GET /user/posts/p2', { kind: 'rate-limited', retryAfterMs: 5_000 }, 1);
    flow.respondToListMentionAlarms([alarm('102', { postId: 'p2' }), alarm('101', { postId: 'p1' })]);

    await detection.start();
    expect((await storedMentions(stateStore)).length).toBe(1);

    clock.advance(5_000);
    await settle();
    expect((await storedMentions(stateStore)).length).toBe(2);
  });

  it('쓸 키가 없으면 조회하지 않고 다음 주기에 다시 본다', async () => {
    const clock = new FakeClock(NOW);
    const flow = new FakeFlowApi();
    const stateStore = new MemoryStateStore();
    stateStore.account = { ...FAKE_ME };
    stateStore.baselineAlarmId = '100';
    /** 쓸 키가 있는지 여부. */
    let hasKey = false;
    const logger = createLogger([], clock);
    const detection = new MentionDetection({
      stateStore,
      bundles: new MentionBundles({
        stateStore,
        notifier: new RecordingNotifier(),
        clock,
        logger,
        findMyAnswers: async () => null,
        collectContext: async () => null,
        resolveRepos: async () => ({ kind: 'unmapped' }),
      }),
      clock,
      logger,
      connectFlow: () => (hasKey ? { api: flow, reportKeyRejected: () => {} } : null),
    });

    await detection.start();
    expect(flow.requests).toEqual([]);

    hasKey = true;
    clock.advance(60_000);
    await settle();
    expect(alarmRequests(flow)).toBe(1);
  });
});

describe('멘션 감지: 알림 시각', () => {
  it('알림 시각을 읽을 수 없으면 72시간 범위 안으로 보고 판정한다', async () => {
    const { stored } = await detectOne(
      (flow) => addPostMentioningMe(flow, 'p1'),
      alarm('101', { postId: 'p1', registeredDateTime: '2026-10-20 08:59' }),
    );

    expect(stored).toEqual([['p1', '-1', '-1']]);
  });

  it('알림 시각은 한국 표준시로 읽는다(72시간 경계가 9시간 밀리지 않는다)', async () => {
    const { stored } = await detectOne(
      (flow) => addPostMentioningMe(flow, 'p1'),
      // 2026-10-17 08:00:00 KST는 72시간 1시간 전이다. UTC로 잘못 읽으면 범위 안으로 들어온다.
      alarm('101', { postId: 'p1', registeredDateTime: '20261017080000' }),
    );

    expect(stored).toEqual([]);
  });
});
