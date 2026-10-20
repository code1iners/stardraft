import type { Clock } from '../core/ports/clock';

/** 실제 시간을 쓰는 시계. 테스트는 core의 가짜 시계를 쓴다. */
export const systemClock: Clock = {
  now: () => Date.now(),
  after: (delayMs, callback) => {
    /** 예약한 타이머. */
    const timer = setTimeout(callback, delayMs);
    return () => clearTimeout(timer);
  },
};
