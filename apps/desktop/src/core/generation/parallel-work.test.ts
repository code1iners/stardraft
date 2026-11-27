import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { PARALLEL_WORK_COUNT_MAX, PARALLEL_WORK_COUNT_MIN } from '../../shared/ipc';
import { createLogger } from '../logging/logger';
import { PARALLEL_WORK_MAX, PARALLEL_WORK_MIN } from './generation-queue';
import { ParallelWork } from './parallel-work';

/** 가짜 설정 저장소 위에 병렬 작업 수를 만든다. */
async function setup(initial: ConstructorParameters<typeof MemorySettingsStore>[0] = {}) {
  const settingsStore = new MemorySettingsStore(initial);
  const parallelWork = new ParallelWork({ settingsStore, logger: createLogger([{ write: () => {} }], new FakeClock(0)) });
  await parallelWork.load();
  /** 값이 바뀌었다는 알림 수. */
  let changes = 0;
  parallelWork.onChange(() => (changes += 1));
  return { settingsStore, parallelWork, changes: () => changes };
}

describe('병렬 작업 수 설정', () => {
  it('처음에는 1이라 지금처럼 하나씩 돈다', async () => {
    const { parallelWork } = await setup();
    expect(parallelWork.count()).toBe(1);
  });

  it('고른 값을 다른 설정을 덮지 않고 저장해 알린다. 같은 값과 1~5 밖의 값, 정수가 아닌 값은 저장하지 않는다', async () => {
    const { settingsStore, parallelWork, changes } = await setup({ extraInstructions: '맺음말' });

    await parallelWork.set(3);
    expect(parallelWork.count()).toBe(3);
    expect(await settingsStore.load()).toMatchObject({ parallelWorkCount: 3, extraInstructions: '맺음말' });
    expect(changes()).toBe(1);

    await parallelWork.set(3);
    await parallelWork.set(0);
    await parallelWork.set(6);
    await parallelWork.set(2.5);
    expect(parallelWork.count()).toBe(3);
    expect(changes()).toBe(1);
  });

  it('설정 화면 슬라이더의 범위와 생성 대기열의 범위가 같다', () => {
    expect([PARALLEL_WORK_COUNT_MIN, PARALLEL_WORK_COUNT_MAX]).toEqual([PARALLEL_WORK_MIN, PARALLEL_WORK_MAX]);
  });

  it('설정 파일에 1~5 밖의 값이 있으면 가까운 끝 값으로 읽는다', async () => {
    expect((await setup({ parallelWorkCount: 9 })).parallelWork.count()).toBe(5);
    expect((await setup({ parallelWorkCount: -2 })).parallelWork.count()).toBe(1);
  });
});
