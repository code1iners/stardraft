import { describe, expect, it } from 'vitest';
import { FakeClock } from './fake-clock';

describe('가짜 시계', () => {
  it('시간을 돌리면 그 사이에 예약된 일만 예약 시각 순서대로 실행한다', () => {
    const clock = new FakeClock(1_000);
    const fired: string[] = [];
    clock.after(5_000, () => fired.push(`5초 @${clock.now()}`));
    clock.after(60_000, () => fired.push(`60초 @${clock.now()}`));
    clock.after(1_000, () => fired.push(`1초 @${clock.now()}`));

    clock.advance(10_000);

    expect(fired).toEqual(['1초 @2000', '5초 @6000']);
    expect(clock.now()).toBe(11_000);
  });

  it('취소한 예약은 시간이 지나도 실행하지 않는다', () => {
    const clock = new FakeClock();
    const fired: string[] = [];
    const cancel = clock.after(5_000, () => fired.push('취소됨'));
    clock.after(5_000, () => fired.push('남음'));

    cancel();
    clock.advance(5_000);

    expect(fired).toEqual(['남음']);
  });

  it('실행 중에 다시 예약한 일도 돌린 시간 안이면 실행한다', () => {
    const clock = new FakeClock();
    const pollTimes: number[] = [];
    const poll = () => {
      pollTimes.push(clock.now());
      clock.after(60_000, poll);
    };
    clock.after(60_000, poll);

    clock.advance(180_000);

    expect(pollTimes).toEqual([60_000, 120_000, 180_000]);
  });
});
