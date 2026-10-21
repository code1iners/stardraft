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
import type { BundledMention, UnsavedBundle } from './mention-bundle';
import { MentionBundles } from './mention-bundles';
import { BundleRetention } from './retention';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시(00:00:00 UTC). */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 하루(밀리초). */
const DAY_MS = 24 * 60 * 60 * 1000;
/** 나(키 소유자)의 사용자 ID. */
const ME = FAKE_ME.userId;
/** 송신자. 실제 사람이 아니다. */
const SENDER = 'sender@example.test';
/** 멘션이 온 게시물. */
const POST_ID = '90000011';
/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${ME})`;

/** 가짜 멘션 알림. 기본은 08:50에 온 댓글 700의 멘션이다. */
function alarm(alarmId: string, overrides: Partial<FlowAlarm> = {}): FlowAlarm {
  return {
    alarmId,
    projectId: '900001',
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

/** 가짜 시계가 부른 일이 끝나도록 대기 중인 비동기 일을 모두 돌린다. 가짜 포트는 모두 바로 답한다. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * 가짜 포트로 멘션 감지, 멘션 묶음, 보관 정리를 만든다. 기준점은 `'100'`이고 매핑된 폴더가 사라져 묶음은 저장소 확인 필요로 기다린다.
 * `seed`는 앱을 켜기 전 `state.db`에 있던 묶음이다.
 */
async function setup(seed: readonly UnsavedBundle[] = []) {
  const clock = new FakeClock(NOW);
  const flow = new FakeFlowApi();
  const stateStore = new MemoryStateStore();
  stateStore.account = { ...FAKE_ME };
  await stateStore.saveDetectedBundles(seed, '100');
  const logger = createLogger([{ write: () => {} }], clock);
  const bundles = new MentionBundles({
    stateStore,
    notifier: new RecordingNotifier(),
    clock,
    logger,
    findMyAnswers: async (place) => new MentionJudge(flow, ME).myAnswers(place, [ME]),
    collectContext: (bundle) => collectBundleContext(flow, bundle, clock.now(), [ME]),
    resolveRepos: async () => ({ kind: 'missing-folders', paths: ['/fake/work/gone'] }),
  });
  await bundles.load();
  const detection = new MentionDetection({ stateStore, bundles, clock, logger, connectFlow: () => ({ api: flow, reportKeyRejected: () => {} }) });
  const retention = new BundleRetention({ bundles, clock, logger });
  flow.addPost({ postId: POST_ID, title: '가짜 게시물', textComponents: [{ contents: '본문', mentions: [] }] });
  flow.addComment(POST_ID, { commentId: '700', contents: `${MY_MARKUP} 재시도는 몇 번 하나요?`, registerId: SENDER });

  /** 새 알림을 맨 앞에 두고 감지를 (다시) 시작해 한 번 조회한다. */
  const poll = async (...alarms: FlowAlarm[]) => {
    for (const item of alarms) flow.addAlarm(item);
    await detection.start();
    await settle();
  };
  /** 시간을 `ms`만큼 돌리고, 그 사이 예약된 정리가 끝나기를 기다린다. 폴링은 멈춰 두어 조회 없이 정리만 돈다. */
  const advance = async (ms: number) => {
    detection.stop();
    clock.advance(ms);
    await settle();
  };
  return { clock, flow, stateStore, bundles, detection, retention, poll, advance };
}

/** 앱을 켜기 전에 있던 게시됨 묶음의 멘션. 댓글 700의 멘션이다. */
function seededMention(overrides: Partial<BundledMention> = {}): BundledMention {
  return {
    postId: POST_ID,
    remarkId: '700',
    replyId: '-1',
    projectId: '900001',
    alarmId: '90',
    senderId: SENDER,
    senderName: '보낸 사람',
    registeredDateTime: '20261020085000',
    detectedAt: NOW,
    text: `${MY_MARKUP} 재시도는 몇 번 하나요?`,
    answered: false,
    gone: false,
    goneExcluded: false,
    ...overrides,
  };
}

/** 앱을 켜기 전에 있던, 이 PC가 댓글 700에 대댓글 950을 올린 게시됨 묶음. `processedAt`에 처리했다. */
function postedBundle(processedAt: number): UnsavedBundle {
  return {
    id: null,
    postId: POST_ID,
    remarkId: '700',
    projectId: '900001',
    status: 'posted',
    postTitle: '가짜 게시물',
    connectUrl: null,
    mentions: [seededMention()],
    answers: [],
    newMentionCount: 0,
    createdAt: NOW,
    processedAt,
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
    posting: {
      body: '가짜 답',
      sentAt: processedAt,
      postedId: '950',
      failure: null,
      answeredMentions: [{ postId: POST_ID, remarkId: '700', replyId: '-1' }],
    },
    quitDuringCountdown: false,
    trial: false,
  };
}

describe('보관: 처리됨 목록의 7일', () => {
  it('앱을 켤 때 정리하면, 처리한 지 7일이 되기 직전의 묶음은 남아 되돌릴 수 있고 7일이 된 묶음은 빠진다', async () => {
    const { clock, bundles, retention, poll, advance } = await setup();
    await poll(alarm('101'));
    /** 묶음 ID. */
    const id = bundles.state()[0]!.id;
    await bundles.ignore(id);

    await advance(7 * DAY_MS - 1);
    retention.start();
    await settle();
    expect(bundles.state().map(({ id: bundleId, status }) => [bundleId, status])).toEqual([[id, 'ignored']]);
    retention.stop();

    clock.advance(1);
    retention.start();
    await settle();
    expect(bundles.state()).toEqual([]);
    retention.stop();
  });

  it('켜 둔 앱은 하루에 한 번 정리해, 처리한 지 7일째 정리에서 목록에서 뺀다', async () => {
    const { bundles, retention, poll, advance } = await setup();
    await poll(alarm('101'));
    await bundles.ignore(bundles.state()[0]!.id);
    retention.start();

    await advance(7 * DAY_MS - 1);
    expect(bundles.state().map(({ status }) => status)).toEqual(['ignored']);

    await advance(1);
    expect(bundles.state()).toEqual([]);
    retention.stop();
  });

  it('되돌렸다가 다시 처리하면 7일을 다시 처리한 때부터 새로 센다', async () => {
    const { bundles, retention, poll, advance } = await setup();
    await poll(alarm('101'));
    /** 묶음 ID. */
    const id = bundles.state()[0]!.id;
    await bundles.ignore(id);
    retention.start();

    await advance(5 * DAY_MS);
    await bundles.restore(id);
    await bundles.ignore(id);
    expect(bundles.state()[0]?.processedAt).toBe(NOW + 5 * DAY_MS);

    await advance(2 * DAY_MS);
    expect(bundles.state().map(({ status }) => status)).toEqual(['ignored']);

    await advance(5 * DAY_MS);
    expect(bundles.state()).toEqual([]);
    retention.stop();
  });

  it('Flow에서 답해 이미 답함이 된 묶음도 7일이 지나면 같은 규칙으로 빠지고 최소 기록에 마지막 상태가 남는다', async () => {
    const { flow, stateStore, bundles, retention, poll, advance } = await setup();
    flow.addReply(POST_ID, '700', { replyId: '890', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085500' });
    await poll(alarm('101'));
    expect(bundles.state().map(({ status }) => status)).toEqual(['already-answered']);
    retention.start();

    await advance(7 * DAY_MS);

    expect(bundles.state()).toEqual([]);
    expect((await stateStore.listMinimalRecords()).map(({ status, processedAt, posted }) => ({ status, processedAt, posted }))).toEqual([
      { status: 'already-answered', processedAt: NOW, posted: null },
    ]);
    retention.stop();
  });

  it('잠자기에서 깨어나 정리하면 하루마다 하는 정리를 기다리지 않고 7일이 된 묶음을 뺀다', async () => {
    const { bundles, retention, poll, advance } = await setup();
    await poll(alarm('101'));
    await bundles.ignore(bundles.state()[0]!.id);
    // 처리한 지 한 시간 뒤에 켠 앱이라, 하루마다 하는 정리는 처리한 지 7일 1시간에 돈다.
    await advance(60 * 60 * 1000);
    retention.start();
    await advance(7 * DAY_MS - 60 * 60 * 1000);
    expect(bundles.state().map(({ status }) => status)).toEqual(['ignored']);

    retention.cleanUpNow();
    await settle();

    expect(bundles.state()).toEqual([]);
    retention.stop();
  });

  it('대기 중인 묶음(저장소 확인 필요)은 기한 없이 남는다', async () => {
    const { bundles, retention, poll, advance } = await setup();
    await poll(alarm('101'));
    retention.start();

    await advance(30 * DAY_MS);

    expect(bundles.state().map(({ status }) => status)).toEqual(['repo-check-needed']);
    retention.stop();
  });

  it('7일이 지났지만 아직 정리하지 않은 묶음은 되돌리지 않고 그때 목록에서 뺀다', async () => {
    const { bundles, retention, poll, advance } = await setup();
    await poll(alarm('101'));
    /** 묶음 ID. */
    const id = bundles.state()[0]!.id;
    await bundles.ignore(id);
    // 처리한 지 한 시간 뒤에 켠 앱이라, 하루마다 하는 정리는 처리한 지 7일 1시간에 돈다.
    await advance(60 * 60 * 1000);
    retention.start();
    await advance(7 * DAY_MS - 60 * 60 * 1000);
    expect(bundles.state().map(({ status }) => status)).toEqual(['ignored']);

    await bundles.restore(id);

    expect(bundles.state()).toEqual([]);
    retention.stop();
  });
});

describe('보관: 최소 기록', () => {
  it('목록에서 빠진 게시됨 묶음은 전체 기록을 지우고 묶음 자리·멘션 위치·상태·처리한 시각·게시한 글과 답한 범위만 남긴다', async () => {
    const { stateStore, bundles, retention } = await setup([postedBundle(NOW - 7 * DAY_MS)]);

    retention.start();
    await settle();

    expect(bundles.state()).toEqual([]);
    await expect(stateStore.listBundles()).resolves.toEqual([]);
    await expect(stateStore.listMinimalRecords()).resolves.toEqual([
      {
        bundleId: 1,
        postId: POST_ID,
        remarkId: '700',
        mentions: [{ postId: POST_ID, remarkId: '700', replyId: '-1' }],
        status: 'posted',
        processedAt: NOW - 7 * DAY_MS,
        posted: { postedId: '950', answeredMentions: [{ postId: POST_ID, remarkId: '700', replyId: '-1' }] },
      },
    ]);
    expect(bundles.postedIds()).toEqual(new Set(['950']));
    retention.stop();
  });

  it('목록에서 빠진 묶음의 멘션 위치에서 다시 온 알림은 글이 수정됐더라도 다시 감지하지 않는다', async () => {
    const { flow, bundles, retention, poll, advance } = await setup();
    await poll(alarm('101'));
    await bundles.ignore(bundles.state()[0]!.id);
    retention.start();
    await advance(7 * DAY_MS);
    expect(bundles.state()).toEqual([]);

    flow.addComment(POST_ID, { commentId: '700', contents: `${MY_MARKUP} 수정한 질문`, registerId: SENDER });
    await poll(alarm('102', { registeredDateTime: '20261027085000' }));

    expect(bundles.state()).toEqual([]);
    retention.stop();
  });

  it('최소 기록만 남은 게시한 글도 그 글이 답한 범위의 멘션에만 답한 것으로 본다. 게시 중에 온 멘션의 새 묶음은 숨지 않는다', async () => {
    const { flow, bundles, retention, poll } = await setup([postedBundle(NOW - 7 * DAY_MS)]);
    retention.start();
    await settle();
    // 게시를 누른 뒤 카운트다운 중에 대댓글 801로 멘션이 왔고, 이 PC가 올린 대댓글 950은 그보다 나중에 올라갔다.
    flow.addReply(POST_ID, '700', { replyId: '801', contents: `${MY_MARKUP} 하나 더`, registerId: SENDER, registeredDateTime: '20261020085400' });
    flow.addReply(POST_ID, '700', { replyId: '950', contents: '가짜 답', registerId: ME, registeredDateTime: '20261020085500' });

    await poll(alarm('102', { replyId: '801', registeredDateTime: '20261020085400' }));

    expect(bundles.state().map(({ status, mentions }) => [status, mentions.map(({ replyId, answered }) => [replyId, answered])])).toEqual([
      ['repo-check-needed', [['801', false]]],
    ]);
    retention.stop();
  });
});
