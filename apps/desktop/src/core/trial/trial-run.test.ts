import { describe, expect, it } from 'vitest';
import { MentionBundles } from '../bundles/mention-bundles';
import { FakeClock } from '../fakes/fake-clock';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger } from '../logging/logger';
import type { FlowAlarm } from '../ports/flow-api';
import { TrialRun } from './trial-run';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시. */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 나(키 소유자)의 사용자 ID. */
const ME = FAKE_ME.userId;

/** 가짜 본문 멘션 알림. */
function alarm(alarmId: string, postId: string): FlowAlarm {
  return {
    alarmId,
    projectId: '900001',
    postId,
    remarkId: '-1',
    replyId: '-1',
    receiverId: ME,
    registerId: 'sender@example.test',
    registerName: '보낸 사람',
    registeredDateTime: '20261020085900',
  };
}

/** 가짜 포트로 시험 실행을 만든다. 감지는 시작한 상태이고, 저장소 매핑은 없다. */
async function setup() {
  const clock = new FakeClock(NOW);
  const flow = new FakeFlowApi();
  flow.addPost({ postId: '1', title: '가짜 게시물', textComponents: [{ contents: `@[테스트 사용자](${ME}) 확인 부탁드립니다`, mentions: [ME] }] });
  flow.respondToListMentionAlarms([alarm('101', '1')]);
  const stateStore = new MemoryStateStore();
  const logger = createLogger([{ write: () => {} }], clock);
  const bundles = new MentionBundles({
    stateStore,
    notifier: new RecordingNotifier(),
    clock,
    logger,
    findMyAnswers: async () => null,
    collectContext: async () => null,
    resolveRepos: async () => ({ kind: 'unmapped' }),
  });
  await bundles.load();
  /** 감지를 시작했는지 여부, 쓸 키가 있는지 여부, Flow가 키를 거부했다고 알린 횟수. */
  const env = { detectionStarted: true, hasKey: true, rejected: 0 };
  const trial = new TrialRun({
    bundles,
    connectFlow: () => (env.hasKey ? { api: flow, reportKeyRejected: () => (env.rejected += 1) } : null),
    myUserId: () => ME,
    detectionStarted: () => env.detectionStarted,
    projectTitle: async (projectId) => (projectId === '900001' ? '가짜 프로젝트' : null),
    clock,
    logger,
  });
  return { flow, bundles, trial, env };
}

describe('최근 멘션으로 시험: 멘션 고르기', () => {
  it('감지를 시작한 뒤에만 연다. 열면 최근 멘션을 불러와 Flow 프로젝트 이름과 함께 보인다', async () => {
    const { trial, env } = await setup();
    env.detectionStarted = false;
    await trial.open('settings');
    expect(trial.state().picker).toBeNull();

    env.detectionStarted = true;
    /** 불러오는 중인 열기. */
    const opening = trial.open('settings');
    expect(trial.state().picker).toEqual({ window: 'settings', status: 'loading' });
    await opening;

    expect(trial.state().picker).toMatchObject({
      window: 'settings',
      status: 'loaded',
      candidates: [{ mention: expect.objectContaining({ alarmId: '101', senderName: '보낸 사람' }), projectTitle: '가짜 프로젝트', answered: false }],
    });
  });

  it('하나를 고르면 목록을 닫고 시험 묶음을 만든다. 시험 묶음이 있는 동안에는 다시 열지 않는다', async () => {
    const { trial, bundles } = await setup();
    await trial.open('popover');

    await trial.start('101');

    expect(trial.state().picker).toBeNull();
    expect(bundles.state()).toMatchObject([{ trial: true, status: 'generating', postTitle: '가짜 게시물' }]);
    await trial.open('popover');
    expect(trial.state().picker).toBeNull();
  });

  it('쓸 키가 없거나 Flow가 키를 거부하면 그 까닭으로 실패를 보이고, 키 거부는 "키 확인 필요"로 알린다', async () => {
    const { trial, flow, env } = await setup();
    env.hasKey = false;
    await trial.open('popover');
    expect(trial.state().picker).toEqual({ window: 'popover', status: 'failed', reason: 'no-key' });

    env.hasKey = true;
    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'unauthorized' } });
    await trial.reload();
    expect(trial.state().picker).toEqual({ window: 'popover', status: 'failed', reason: 'unauthorized' });
    expect(env.rejected).toBe(1);

    trial.close();
    expect(trial.state().picker).toBeNull();
  });
});
