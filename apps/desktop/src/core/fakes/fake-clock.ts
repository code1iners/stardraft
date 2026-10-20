import type { CancelScheduled, Clock } from '../ports/clock';

/** 가짜 시계에 예약된 일. */
interface ScheduledTask {
  /** 실행할 시각(Unix epoch 밀리초). */
  dueAt: number;
  /** 같은 시각에 예약된 일의 순서를 지키기 위한 예약 번호. */
  order: number;
  /** 실행할 일. */
  callback: () => void;
}

/** 테스트에서 손으로 돌리는 시계. `advance`를 부르기 전에는 시간이 흐르지 않는다. */
export class FakeClock implements Clock {
  /** 지금 시각(Unix epoch 밀리초). */
  private current: number;
  /** 아직 실행하지 않은 예약. */
  private tasks: ScheduledTask[] = [];
  /** 다음 예약 번호. */
  private nextOrder = 0;

  constructor(startAt = 0) {
    this.current = startAt;
  }

  now(): number {
    return this.current;
  }

  after(delayMs: number, callback: () => void): CancelScheduled {
    /** 새 예약. */
    const task: ScheduledTask = { dueAt: this.current + delayMs, order: this.nextOrder++, callback };
    this.tasks.push(task);
    return () => {
      this.tasks = this.tasks.filter((scheduled) => scheduled !== task);
    };
  }

  /** 시간을 `ms`만큼 돌리며, 그 사이에 닿는 예약을 예약 시각 순서대로 실행한다. */
  advance(ms: number): void {
    /** 돌린 뒤의 시각. */
    const target = this.current + ms;

    // 실행 도중 새로 예약된 일도 목표 시각 안이면 실행하도록 매번 가장 이른 예약을 다시 찾는다.
    for (;;) {
      /** 다음에 실행할 예약. */
      const next = this.earliestTaskUntil(target);
      if (!next) break;
      this.tasks = this.tasks.filter((scheduled) => scheduled !== next);
      this.current = next.dueAt;
      next.callback();
    }

    this.current = target;
  }

  /** `target` 시각까지 실행할 예약 가운데 가장 이른 것. */
  private earliestTaskUntil(target: number): ScheduledTask | undefined {
    return this.tasks
      .filter((task) => task.dueAt <= target)
      .sort((a, b) => a.dueAt - b.dueAt || a.order - b.order)[0];
  }
}
