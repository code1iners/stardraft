import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { createLogger } from '../logging/logger';
import { RepoWaitMonitor, REPO_WAIT_RECHECK_MS } from './repo-wait-monitor';

/** 비동기 일이 끝나도록 대기 중인 일을 모두 돌린다. 가짜 묶음은 모두 바로 답한다. */
async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) await new Promise((resolve) => setImmediate(resolve));
}

/**
 * 가짜 멘션 묶음. 저장소 확인 필요(폴더 없음) 묶음이 있는지는 테스트가 바꾸고, 다시 판정할 때마다 부른 횟수를 센다.
 * 첫 다시 판정은 `state.held`를 부를 때까지 붙잡아 둘 수 있다.
 */
function fakeBundles(holdFirst: boolean) {
  /** 저장소 확인 필요 묶음이 있는지 여부. */
  const state = { missingWaiting: false, rechecks: 0, held: null as null | (() => void), resumed: 0 };
  /** 묶음이 바뀔 때 부를 함수. */
  const listeners = new Set<() => void>();
  return {
    state,
    bundles: {
      async resumeRepoWaiting(): Promise<number> {
        state.rechecks += 1;
        if (holdFirst && state.rechecks === 1) {
          await new Promise<void>((resolve) => (state.held = resolve));
        }
        return state.resumed;
      },
      hasMissingFolderWaiting: () => state.missingWaiting,
      onChange(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    emit: () => listeners.forEach((listener) => listener()),
  };
}

/** 가짜 시계와 가짜 묶음 위의 감시를 만든다. `holdFirst`면 첫 다시 판정을 `state.held`를 부를 때까지 붙잡는다. */
function setup(holdFirst = false) {
  const clock = new FakeClock(0);
  const { state, bundles, emit } = fakeBundles(holdFirst);
  const monitor = new RepoWaitMonitor({ bundles, clock, logger: createLogger([{ write: () => {} }], clock) });
  return { clock, state, monitor, emit };
}

describe('저장소 대기 감시', () => {
  it('시작할 때 한 번 다시 판정한다', async () => {
    const { monitor, state } = setup();

    monitor.start();
    await settle();

    expect(state.rechecks).toBe(1);
  });

  it('저장소 확인 필요(폴더 없음) 묶음이 있는 동안 60초마다 다시 판정하고, 없어지면 멈춘다', async () => {
    const { clock, monitor, state } = setup();
    state.missingWaiting = true;
    monitor.start();
    await settle();
    expect(state.rechecks).toBe(1);

    clock.advance(REPO_WAIT_RECHECK_MS - 1);
    await settle();
    expect(state.rechecks).toBe(1);
    clock.advance(1);
    await settle();
    expect(state.rechecks).toBe(2);
    clock.advance(REPO_WAIT_RECHECK_MS);
    await settle();
    expect(state.rechecks).toBe(3);

    // 폴더가 돌아와 저장소 확인 필요 묶음이 없어지면, 이미 잡힌 마지막 확인 뒤로는 예약하지 않는다.
    state.missingWaiting = false;
    clock.advance(REPO_WAIT_RECHECK_MS);
    await settle();
    expect(state.rechecks).toBe(4);
    clock.advance(10 * REPO_WAIT_RECHECK_MS);
    await settle();
    expect(state.rechecks).toBe(4);
  });

  it('저장소 확인 필요 묶음이 없으면(저장소 매핑 필요뿐이면) 주기로 다시 판정하지 않는다. 지금 확인(checkNow)으로만 한다', async () => {
    const { clock, monitor, state } = setup();
    monitor.start();
    await settle();

    clock.advance(10 * REPO_WAIT_RECHECK_MS);
    await settle();
    expect(state.rechecks).toBe(1);

    monitor.checkNow();
    await settle();
    expect(state.rechecks).toBe(2);
  });

  it('저장소 확인 필요 묶음이 생기면 그때부터 60초를 센다', async () => {
    const { clock, monitor, state, emit } = setup();
    monitor.start();
    await settle();
    state.missingWaiting = true;
    emit();

    clock.advance(REPO_WAIT_RECHECK_MS);
    await settle();

    expect(state.rechecks).toBe(2);
  });

  it('다시 판정하는 중에 다시 확인을 요청하면 겹쳐 돌지 않고 끝난 뒤 한 번 더 한다', async () => {
    const { monitor, state } = setup(true);
    monitor.start();
    await settle();
    expect(state.rechecks).toBe(1);

    monitor.checkNow();
    monitor.checkNow();
    await settle();
    expect(state.rechecks).toBe(1);

    state.held?.();
    await settle();

    expect(state.rechecks).toBe(2);
  });

  it('멈춘 뒤에는 예약도 지금 확인도 하지 않는다', async () => {
    const { clock, monitor, state } = setup();
    state.missingWaiting = true;
    monitor.start();
    await settle();

    monitor.stop();
    monitor.checkNow();
    clock.advance(10 * REPO_WAIT_RECHECK_MS);
    await settle();

    expect(state.rechecks).toBe(1);
  });
});
