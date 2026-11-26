import { errorFields, type Logger } from '../logging/logger';
import { DEFAULT_SETTINGS, type SettingsStore } from '../ports/settings-store';
import { SerialQueue } from '../serial-queue';
import { clampParallelWork, PARALLEL_WORK_MAX, PARALLEL_WORK_MIN, type ParallelWorkLimit } from './generation-queue';

/** 병렬 작업 수 설정에 필요한 것. */
export interface ParallelWorkOptions {
  /** 병렬 작업 수를 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. */
  logger: Logger;
}

/**
 * 설정 "에이전트" 칸 `병렬 작업` 탭의 병렬 작업 수. 앱 전체 설정이고 1~5, 기본값 1이다.
 * 바꾸는 즉시 `settings.json`에 저장하고 알린다. 생성 대기열은 다음 실행을 꺼낼 때부터 새 값을 쓴다.
 */
export class ParallelWork implements ParallelWorkLimit {
  /** 설정에서 읽어 둔 값. */
  private saved = DEFAULT_SETTINGS.parallelWorkCount;
  /** 설정을 읽고 저장하는 일을 하나씩 하는 줄. 슬라이더를 빠르게 움직여도 마지막 값이 남게 한다. */
  private readonly lane = new SerialQueue();
  /** 값이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: ParallelWorkOptions) {}

  /** 저장된 병렬 작업 수를 읽는다. 손으로 고친 파일의 범위 밖 값은 가까운 끝 값으로 읽는다. */
  async load(): Promise<void> {
    this.saved = clampParallelWork((await this.options.settingsStore.load()).parallelWorkCount);
  }

  /** 지금 병렬 작업 수. */
  count(): number {
    return this.saved;
  }

  /** 값이 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 병렬 작업 수를 바꾼다. 같은 값, 1~5 밖의 값, 정수가 아닌 값은 받지 않는다. 저장하지 못하면 로그만 남기고 그대로 둔다. */
  set(count: number): Promise<void> {
    return this.lane.run(async () => {
      if (!Number.isInteger(count) || count < PARALLEL_WORK_MIN || count > PARALLEL_WORK_MAX) {
        this.options.logger.warn('parallel-work.count-rejected', { count });
        return;
      }
      if (count === this.saved) return;
      try {
        // 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다.
        /** 저장 직전의 설정. */
        const settings = await this.options.settingsStore.load();
        await this.options.settingsStore.save({ ...settings, parallelWorkCount: count });
      } catch (error) {
        this.options.logger.error('parallel-work.save-failed', errorFields(error));
        return;
      }
      this.saved = count;
      this.options.logger.info('parallel-work.changed', { count });
      for (const listener of this.listeners) listener();
    });
  }
}
