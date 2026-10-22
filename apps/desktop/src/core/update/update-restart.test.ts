import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeUpdateFeed } from '../fakes/fake-update-feed';
import { MemoryStateStore } from '../fakes/memory-state-store';
import { createLogger } from '../logging/logger';
import type { UpdateStatus } from './in-app-update';
import { UpdateRestart, type RestartActivity, type RestartBlockers, type UpdateState } from './update-restart';

/** 지금 시각. 2026-10-22 10:00:00 한국 표준시. */
const NOW = Date.UTC(2026, 9, 22, 1, 0, 0);
/** 1분(밀리초). */
const MINUTE_MS = 60_000;
/** 지금 앱 버전. */
const CURRENT_VERSION = '0.1.0';

/** 테스트마다 만드는 임시 폴더. 가짜 피드가 받은 파일을 쓰는 곳이지만 이 테스트는 받지 않는다. */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stardraft-restart-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 앱 내 업데이트의 상태만 흉내 낸다. 확인과 다운로드는 앱 내 업데이트 테스트가 따로 본다. */
class FakeUpdate {
  /** 지금 상태. */
  status: UpdateStatus = { kind: 'idle' };
  /** [지금 확인]을 부른 횟수. */
  checkCount = 0;
  /** [지금 확인]이 끝날 때의 상태. `null`이면 바꾸지 않는다. */
  statusAfterCheck: UpdateStatus | null = null;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(status: UpdateStatus) => void>();

  state(): UpdateStatus {
    return this.status;
  }

  onChange(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async checkNow(): Promise<void> {
    this.checkCount += 1;
    if (this.statusAfterCheck) this.set(this.statusAfterCheck);
  }

  /** 상태를 바꾸고 알린다. */
  set(status: UpdateStatus): void {
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }
}

/** 초안 대기열과 게시의 상태를 손으로 바꾸는 가짜. */
class FakeActivity implements RestartActivity {
  /** 지금 다시 시작을 미뤄야 하는 일. */
  current: RestartBlockers = { drafting: false, posting: false };
  /** 다음 실행을 시작하지 않게 잡아 두었는지 여부. */
  held = false;
  /** 다시 시작을 미룰 일이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  blockers(): RestartBlockers {
    return { ...this.current };
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  holdDrafts(held: boolean): void {
    this.held = held;
  }

  /** 상태를 바꾸고 알린다. */
  set(changes: Partial<RestartBlockers>): void {
    this.current = { ...this.current, ...changes };
    for (const listener of this.listeners) listener();
  }
}

/** 테스트 하나의 준비물. */
interface Harness {
  restart: UpdateRestart;
  update: FakeUpdate;
  activity: FakeActivity;
  feed: FakeUpdateFeed;
  stateStore: MemoryStateStore;
  clock: FakeClock;
  /** 편집기 내용을 저장한 횟수. */
  saves: () => number;
  /** 알림을 받은 상태들. */
  changes: UpdateState[];
}

/** 준비물을 만든다. `confirmsBeforeRestart`는 macOS처럼 확인 화면을 먼저 띄우는지 여부다. */
async function setUp(options: { confirmsBeforeRestart?: boolean; currentVersion?: string; stateStore?: MemoryStateStore } = {}): Promise<Harness> {
  const update = new FakeUpdate();
  const activity = new FakeActivity();
  const feed = new FakeUpdateFeed(dir);
  const stateStore = options.stateStore ?? new MemoryStateStore();
  const clock = new FakeClock(NOW);
  let saves = 0;
  const restart = new UpdateRestart({
    update,
    feed,
    currentVersion: options.currentVersion ?? CURRENT_VERSION,
    confirmsBeforeRestart: options.confirmsBeforeRestart ?? false,
    activity,
    saveEdits: async () => {
      saves += 1;
    },
    stateStore,
    clock,
    logger: createLogger([{ write: () => {} }], clock),
  });
  await restart.load();
  const changes: UpdateState[] = [];
  restart.onChange((state) => changes.push(state));
  return { restart, update, activity, feed, stateStore, clock, saves: () => saves, changes };
}

describe('다시 시작', () => {
  it('Windows는 확인 없이, 편집기 내용을 저장하고 업데이트 시도를 남긴 뒤 설치하며 다시 시작한다', async () => {
    const { restart, update, feed, stateStore, saves } = await setUp();
    update.set({ kind: 'ready', version: '0.2.0' });

    await restart.requestRestart();

    expect(saves()).toBe(1);
    await expect(stateStore.getUpdateAttempt()).resolves.toEqual({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: NOW, rejected: false });
    expect(feed.installCount).toBe(1);
  });

  it('설치 준비됨이 아니면 [다시 시작]을 눌러도 아무것도 하지 않는다', async () => {
    const { restart, update, feed, activity } = await setUp();
    update.set({ kind: 'downloading', version: '0.2.0', percent: 40 });

    await restart.requestRestart();

    expect(feed.installCount).toBe(0);
    expect(activity.held).toBe(false);
  });

  it('macOS는 먼저 확인 화면을 띄우고, 확인 화면의 [다시 시작]을 누를 때 다시 시작한다', async () => {
    const { restart, update, feed } = await setUp({ confirmsBeforeRestart: true });
    update.set({ kind: 'ready', version: '0.2.0' });

    await restart.requestRestart();

    expect(restart.state().restartConfirm).toBe('0.2.0');
    expect(feed.installCount).toBe(0);

    await restart.confirm();

    expect(restart.state().restartConfirm).toBeNull();
    expect(feed.installCount).toBe(1);
  });

  it('확인 화면의 [나중에]는 확인 화면만 닫고 다시 시작하지 않는다. 다음에 누르면 확인 화면을 또 띄운다', async () => {
    const { restart, update, feed, activity } = await setUp({ confirmsBeforeRestart: true });
    update.set({ kind: 'ready', version: '0.2.0' });
    await restart.requestRestart();

    restart.cancelConfirm();

    expect(restart.state()).toMatchObject({ status: { kind: 'ready', version: '0.2.0' }, restartConfirm: null });
    expect(activity.held).toBe(false);
    expect(feed.installCount).toBe(0);

    await restart.requestRestart();

    expect(restart.state().restartConfirm).toBe('0.2.0');
  });
});

describe('다시 시작을 미루는 조건', () => {
  it('에이전트 실행 중이면 끝날 때까지 미루며 다음 실행을 잡아 두고, 끝나면 바로 다시 시작한다', async () => {
    const { restart, update, feed, activity, saves } = await setUp();
    update.set({ kind: 'ready', version: '0.2.0' });
    activity.set({ drafting: true });

    await restart.requestRestart();

    expect(restart.state().status).toEqual({ kind: 'restart-pending', version: '0.2.0', waitingFor: { drafting: true, posting: false } });
    expect(activity.held).toBe(true);
    expect(feed.installCount).toBe(0);

    activity.set({ drafting: false });
    await flush();

    expect(saves()).toBe(1);
    expect(feed.installCount).toBe(1);
  });

  it('게시 카운트다운이나 게시 요청이 끝날 때까지 미루고, 미루는 일이 모두 끝나야 다시 시작한다', async () => {
    const { restart, update, feed, activity } = await setUp();
    update.set({ kind: 'ready', version: '0.2.0' });
    activity.set({ drafting: true, posting: true });
    await restart.requestRestart();

    activity.set({ drafting: false });
    await flush();

    expect(restart.state().status).toEqual({ kind: 'restart-pending', version: '0.2.0', waitingFor: { drafting: false, posting: true } });
    expect(feed.installCount).toBe(0);

    activity.set({ posting: false });
    await flush();

    expect(feed.installCount).toBe(1);
  });

  it('[지금 다시 시작]은 진행 중인 실행을 기다리지 않고 바로 다시 시작한다', async () => {
    const { restart, update, feed, activity, stateStore } = await setUp();
    update.set({ kind: 'ready', version: '0.2.0' });
    activity.set({ drafting: true });
    await restart.requestRestart();

    await restart.restartNow();

    expect(feed.installCount).toBe(1);
    await expect(stateStore.getUpdateAttempt()).resolves.toMatchObject({ toVersion: '0.2.0' });
  });

  it('[취소]는 대기를 풀어 설치 준비됨으로 돌리고 초안 대기열을 다시 돌린다. 그 뒤 실행이 끝나도 다시 시작하지 않는다', async () => {
    const { restart, update, feed, activity, clock } = await setUp();
    update.set({ kind: 'ready', version: '0.2.0' });
    activity.set({ drafting: true });
    await restart.requestRestart();

    restart.cancelRestart();
    activity.set({ drafting: false });
    clock.advance(20 * MINUTE_MS);
    await flush();

    expect(restart.state().status).toEqual({ kind: 'ready', version: '0.2.0' });
    expect(activity.held).toBe(false);
    expect(feed.installCount).toBe(0);
  });

  it('에이전트 실행은 최대 10분만 기다리고 실행을 끊고 다시 시작한다. 게시는 끝날 때까지 기다린다', async () => {
    const { restart, update, feed, activity, clock } = await setUp();
    update.set({ kind: 'ready', version: '0.2.0' });
    activity.set({ drafting: true });
    await restart.requestRestart();

    clock.advance(10 * MINUTE_MS - 1);
    await flush();
    expect(feed.installCount).toBe(0);

    activity.set({ posting: true });
    clock.advance(1);
    await flush();
    expect(restart.state().status).toMatchObject({ kind: 'restart-pending', waitingFor: { drafting: false, posting: true } });
    expect(feed.installCount).toBe(0);

    activity.set({ posting: false });
    await flush();
    expect(feed.installCount).toBe(1);
  });

  it('기다리는 동안 더 새 버전을 받기 시작해 설치 준비됨이 아니게 되면 다시 시작을 거둔다', async () => {
    const { restart, update, feed, activity } = await setUp();
    update.set({ kind: 'ready', version: '0.2.0' });
    activity.set({ drafting: true });
    await restart.requestRestart();

    update.set({ kind: 'downloading', version: '0.3.0', percent: 0 });
    activity.set({ drafting: false });
    await flush();

    expect(restart.state().status).toEqual({ kind: 'downloading', version: '0.3.0', percent: 0 });
    expect(activity.held).toBe(false);
    expect(feed.installCount).toBe(0);
  });
});

describe('설치 실패 판정', () => {
  it('다시 켰을 때 버전이 그대로면 설치 실패를 보이고 업데이트 시도를 지운다', async () => {
    const stateStore = new MemoryStateStore();
    await stateStore.setUpdateAttempt({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: NOW - MINUTE_MS, rejected: false });

    const { restart, update } = await setUp({ stateStore });

    expect(restart.state()).toMatchObject({ status: { kind: 'install-failed', version: '0.2.0', reason: 'not-applied' }, justUpdated: null });
    await expect(stateStore.getUpdateAttempt()).resolves.toBeNull();
    // 1분 뒤 확인이 같은 버전을 다시 받아 설치 준비됨이 되어도 설치 실패를 그대로 보인다.
    update.set({ kind: 'ready', version: '0.2.0' });
    expect(restart.state().status).toMatchObject({ kind: 'install-failed', version: '0.2.0' });
  });

  it('다시 켰을 때 새 버전이면 업데이트 직후 첫 실행이고, 기록을 지워 그다음 실행에서는 보이지 않는다', async () => {
    const stateStore = new MemoryStateStore();
    await stateStore.setUpdateAttempt({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: NOW - MINUTE_MS, rejected: false });

    const first = await setUp({ stateStore, currentVersion: '0.2.0' });
    expect(first.restart.state()).toMatchObject({ status: { kind: 'idle' }, justUpdated: '0.2.0' });

    const second = await setUp({ stateStore, currentVersion: '0.2.0' });
    expect(second.restart.state().justUpdated).toBeNull();
  });

  it('다시 켰을 때 두 버전 모두 아니면(사이트에서 다른 버전을 설치함) 아무것도 보이지 않는다', async () => {
    const stateStore = new MemoryStateStore();
    await stateStore.setUpdateAttempt({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: NOW - MINUTE_MS, rejected: false });

    const { restart } = await setUp({ stateStore, currentVersion: '0.3.0' });

    expect(restart.state()).toMatchObject({ status: { kind: 'idle' }, justUpdated: null });
  });

  it('Squirrel.Mac이 앱 안에서 거부하면 앱은 켜진 채 설치 실패(거부)를 보이고, 다시 켜도 그렇게 보이며 그 버전은 다시 시작할 수 없다', async () => {
    const { restart, update, feed, activity, stateStore } = await setUp();
    update.set({ kind: 'ready', version: '0.2.0' });
    await restart.requestRestart();

    feed.failInstall('rejected');
    await flush();

    expect(restart.state().status).toEqual({ kind: 'install-failed', version: '0.2.0', reason: 'rejected' });
    expect(activity.held).toBe(false);
    await restart.requestRestart();
    expect(feed.installCount).toBe(1);

    const relaunched = await setUp({ stateStore });
    expect(relaunched.restart.state().status).toEqual({ kind: 'install-failed', version: '0.2.0', reason: 'rejected' });
  });

  it('설치를 맡긴 뒤 2분이 지나도 꺼지지 않으면 설치하지 못한 것으로 본다', async () => {
    const { restart, update, clock } = await setUp();
    update.set({ kind: 'ready', version: '0.2.0' });
    await restart.requestRestart();

    clock.advance(2 * MINUTE_MS);
    await flush();

    expect(restart.state().status).toEqual({ kind: 'install-failed', version: '0.2.0', reason: 'not-applied' });
  });

  it('[다시 시도]는 받아 둔 업데이트를 다시 확인하고 설치 준비됨이 되면 다시 시작한다', async () => {
    const stateStore = new MemoryStateStore();
    await stateStore.setUpdateAttempt({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: NOW - MINUTE_MS, rejected: false });
    const { restart, update, feed } = await setUp({ stateStore });
    update.statusAfterCheck = { kind: 'ready', version: '0.2.0' };

    await restart.retryInstall();

    expect(update.checkCount).toBe(1);
    expect(feed.installCount).toBe(1);
  });

  it('설치에 실패한 뒤 더 새 버전을 받기 시작하거나 안내할 일이 생기면 그 상태를 보인다', async () => {
    const stateStore = new MemoryStateStore();
    await stateStore.setUpdateAttempt({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: NOW - MINUTE_MS, rejected: false });
    const { restart, update } = await setUp({ stateStore });

    update.set({ kind: 'downloading', version: '0.3.0', percent: 10 });
    expect(restart.state().status).toEqual({ kind: 'downloading', version: '0.3.0', percent: 10 });

    update.set({ kind: 'signature-failed', version: '0.2.0' });
    expect(restart.state().status).toEqual({ kind: 'signature-failed', version: '0.2.0' });
  });
});

describe('작은 창 띠', () => {
  it('닫은 띠의 이름들을 기억하고 바뀐 상태를 알린다', async () => {
    const { restart, changes } = await setUp();

    restart.dismissBanner('signature-failed:0.2.0');
    restart.dismissBanner('updated:0.2.0');
    restart.dismissBanner('updated:0.2.0');

    expect(restart.state().dismissedBanners).toEqual(['signature-failed:0.2.0', 'updated:0.2.0']);
    expect(changes.map((state) => state.dismissedBanners.length)).toEqual([1, 2]);
  });
});

/** 기다리지 않은 약속(활동 변화로 시작한 다시 시작)이 끝나게 마이크로태스크를 몇 번 넘긴다. */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

