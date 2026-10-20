import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeFlowApi } from '../fakes/fake-flow-api';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger } from '../logging/logger';
import type { FlowAlarm } from '../ports/flow-api';
import type { Settings } from '../ports/settings-store';
import { LaunchAtLogin } from './launch-at-login';
import { Onboarding, type SetupInputs } from './onboarding';

/** 필수 세 가지가 모두 된 입력. */
const ALL_DONE: SetupInputs = { keyVerified: true, agent: 'connected', workFolderCount: 1 };
/** 필수 세 가지가 하나도 안 된 입력(첫 실행). */
const NOTHING_DONE: SetupInputs = { keyVerified: false, agent: 'not-connected', workFolderCount: 0 };

/** 가짜 멘션 알림. 실제 사람이나 회사가 아니다. */
function alarm(alarmId: string): FlowAlarm {
  return {
    alarmId,
    projectId: '900001',
    postId: '90000011',
    remarkId: '-1',
    replyId: '-1',
    receiverId: 'me@example.test',
    registerId: 'sender@example.test',
    registeredDateTime: '20261019093000',
  };
}

/** 가짜 포트로 온보딩을 만들고 저장된 설정을 읽어 둔다. */
async function setup(inputs: SetupInputs, settings: Partial<Settings> = {}) {
  const settingsStore = new MemorySettingsStore(settings);
  const stateStore = new MemoryStateStore();
  const notifier = new RecordingNotifier();
  const flow = new FakeFlowApi();
  const logger = createLogger([], new FakeClock());
  /** 지금 입력. 테스트가 바꾼다. */
  let current = inputs;
  /** 쓸 키가 있는지 여부. */
  let hasKey = true;
  /** OS 로그인 항목에 적용한 값. 적용한 순서대로 쌓인다. */
  const loginItem: boolean[] = [];
  /** Flow가 키를 거부했다고 알린 횟수. */
  const rejected = { count: 0 };
  const launchAtLogin = new LaunchAtLogin({ settingsStore, logger, applyToSystem: (enabled) => loginItem.push(enabled) });
  await launchAtLogin.load();
  const onboarding = new Onboarding({
    settingsStore,
    stateStore,
    notifier,
    logger,
    launchAtLogin,
    setupInputs: () => current,
    connectFlow: () => (hasKey ? { api: flow, reportKeyRejected: () => (rejected.count += 1) } : null),
  });
  await onboarding.load();
  /** 상태가 바뀐 횟수. */
  const changes = { count: 0 };
  onboarding.onChange(() => (changes.count += 1));
  return {
    onboarding,
    settingsStore,
    stateStore,
    notifier,
    flow,
    loginItem,
    rejected,
    changes,
    setInputs: (next: SetupInputs) => {
      current = next;
      onboarding.refresh();
    },
    removeKey: () => {
      hasKey = false;
    },
  };
}

describe('온보딩: 필수 세 가지', () => {
  it('첫 실행에는 세 가지가 모두 "필요"이고 감지를 시작하기 전이다', async () => {
    const { onboarding } = await setup(NOTHING_DONE);

    expect(onboarding.state()).toMatchObject({
      detectionStarted: false,
      requirements: { 'flow-key': 'needed', agent: 'needed', 'work-folders': 'needed' },
      ready: false,
    });
  });

  it('통과한 항목만 ✓가 되고, 순서와 상관없이 셋이 다 되면 감지를 시작할 수 있다', async () => {
    const { onboarding, setInputs, changes } = await setup(NOTHING_DONE);

    setInputs({ keyVerified: false, agent: 'not-connected', workFolderCount: 2 });
    expect(onboarding.state()).toMatchObject({
      requirements: { 'flow-key': 'needed', agent: 'needed', 'work-folders': 'done' },
      ready: false,
    });

    setInputs(ALL_DONE);
    expect(onboarding.state()).toMatchObject({
      requirements: { 'flow-key': 'done', agent: 'done', 'work-folders': 'done' },
      ready: true,
    });
    expect(changes.count).toBe(2);
  });

  it('에이전트 연결을 확인하는 중이면 "확인 중"이고 감지를 시작할 수 없다', async () => {
    const { onboarding } = await setup({ ...ALL_DONE, agent: 'checking' });

    expect(onboarding.state()).toMatchObject({ requirements: { agent: 'checking' }, ready: false });
  });

  it('입력이 그대로면 바뀌었다고 알리지 않는다', async () => {
    const { setInputs, changes } = await setup(ALL_DONE);

    setInputs({ ...ALL_DONE });

    expect(changes.count).toBe(0);
  });

  it('필수 설정 전에는 감지를 시작하지 않고 Flow도 부르지 않는다', async () => {
    const { onboarding, flow, stateStore, settingsStore, notifier } = await setup({ ...ALL_DONE, workFolderCount: 0 });

    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'skipped' });

    expect(flow.requests).toEqual([]);
    expect(stateStore.baselineAlarmId).toBeNull();
    expect(settingsStore.settings.detectionStarted).toBe(false);
    expect(notifier.sent).toEqual([]);
  });
});

describe('온보딩: 감지 시작', () => {
  it('알림 목록을 한 번 조회해 가장 최근 alarmId를 기준점으로 저장하고, 감지 시작과 로그인 시 자동 시작을 켜고, 시작 알림을 띄운다', async () => {
    const { onboarding, flow, stateStore, settingsStore, notifier, loginItem } = await setup(ALL_DONE);
    flow.respondToListMentionAlarms([alarm('1000000010'), alarm('999999999')]);

    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'started' });

    expect(flow.requests).toEqual(['GET /user/alarms']);
    expect(stateStore.baselineAlarmId).toBe('1000000010');
    expect(settingsStore.settings).toMatchObject({ detectionStarted: true, launchAtLogin: true });
    expect(loginItem).toEqual([true]);
    expect(notifier.sent).toEqual([{ title: '멘션 감지를 시작했습니다', body: expect.any(String) }]);
    expect(onboarding.state()).toMatchObject({ detectionStarted: true, start: { status: 'idle' } });
  });

  it('알림이 하나도 없으면 기준점을 0으로 잡아 그 뒤의 멘션을 모두 처리한다', async () => {
    const { onboarding, stateStore } = await setup(ALL_DONE);

    await onboarding.startDetection();

    expect(stateStore.baselineAlarmId).toBe('0');
  });

  it('감지를 시작한 뒤 다시 켜면 감지 중이고, 다시 시작하지 않는다', async () => {
    const { onboarding, flow } = await setup(NOTHING_DONE, { detectionStarted: true });

    expect(onboarding.state().detectionStarted).toBe(true);
    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'skipped' });
    expect(flow.requests).toEqual([]);
  });

  it('Flow가 키를 거부하면(401) "키 확인 필요"를 알리고, 아무것도 저장하지 않는다', async () => {
    const { onboarding, flow, stateStore, settingsStore, notifier, rejected } = await setup(ALL_DONE);
    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'unauthorized' } });

    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'failed', reason: 'unauthorized' });

    expect(rejected.count).toBe(1);
    expect(stateStore.baselineAlarmId).toBeNull();
    expect(settingsStore.settings.detectionStarted).toBe(false);
    expect(notifier.sent).toEqual([]);
    expect(onboarding.state()).toMatchObject({ detectionStarted: false, start: { status: 'failed', reason: 'unauthorized' } });
  });

  it('Flow에 연결하지 못하면 실패를 보이고, 다시 누르면 시작한다', async () => {
    const { onboarding, flow, stateStore } = await setup(ALL_DONE);
    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'network' } });

    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'failed', reason: 'network' });
    expect(onboarding.state().start).toEqual({ status: 'failed', reason: 'network' });

    flow.respondToListMentionAlarms([alarm('42')]);
    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'started' });
    expect(stateStore.baselineAlarmId).toBe('42');
    expect(onboarding.state().start).toEqual({ status: 'idle' });
  });

  it('요청 한도와 모르는 응답은 각각의 실패로 보인다', async () => {
    const { onboarding, flow } = await setup(ALL_DONE);

    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'rate-limited', retryAfterMs: 1_000 } });
    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'failed', reason: 'rate-limited' });

    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'http', status: 500 } });
    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'failed', reason: 'unexpected' });
  });

  it('쓸 키를 읽을 수 없으면 Flow를 부르지 않고 실패한다', async () => {
    const { onboarding, flow, removeKey } = await setup(ALL_DONE);
    removeKey();

    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'failed', reason: 'no-key' });
    expect(flow.requests).toEqual([]);
  });

  it('시작하는 동안 다시 눌러도 한 번만 시작한다', async () => {
    const { onboarding, flow, notifier } = await setup(ALL_DONE);

    const [first, second] = await Promise.all([onboarding.startDetection(), onboarding.startDetection()]);

    expect([first, second]).toEqual([{ kind: 'started' }, { kind: 'skipped' }]);
    expect(flow.requests).toEqual(['GET /user/alarms']);
    expect(notifier.sent).toHaveLength(1);
  });

  it('기준점을 저장하지 못하면 감지를 시작하지 않는다', async () => {
    const { onboarding, stateStore, settingsStore } = await setup(ALL_DONE);
    stateStore.setBaselineAlarmId = async () => {
      throw new Error('disk full');
    };

    await expect(onboarding.startDetection()).resolves.toEqual({ kind: 'failed', reason: 'save-failed' });
    expect(settingsStore.settings.detectionStarted).toBe(false);
  });
});

describe('로그인 시 자동 시작', () => {
  it('끄면 OS 로그인 항목에서 빼고 설정에 저장한다', async () => {
    const settingsStore = new MemorySettingsStore({ launchAtLogin: true });
    /** OS 로그인 항목에 적용한 값. */
    const loginItem: boolean[] = [];
    const launchAtLogin = new LaunchAtLogin({
      settingsStore,
      logger: createLogger([], new FakeClock()),
      applyToSystem: (enabled) => loginItem.push(enabled),
    });
    await launchAtLogin.load();
    expect(launchAtLogin.enabled()).toBe(true);

    await launchAtLogin.set(false);

    expect(launchAtLogin.enabled()).toBe(false);
    expect(loginItem).toEqual([false]);
    expect(settingsStore.settings.launchAtLogin).toBe(false);
  });

  it('OS 로그인 항목을 바꾸지 못하면 설정도 그대로 둔다', async () => {
    const settingsStore = new MemorySettingsStore();
    const launchAtLogin = new LaunchAtLogin({
      settingsStore,
      logger: createLogger([], new FakeClock()),
      applyToSystem: () => {
        throw new Error('denied');
      },
    });
    await launchAtLogin.load();

    await launchAtLogin.set(true);

    expect(launchAtLogin.enabled()).toBe(false);
    expect(settingsStore.settings.launchAtLogin).toBe(false);
  });
});
