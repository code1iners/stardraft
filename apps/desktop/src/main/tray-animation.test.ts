import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TrayAnimation } from './tray-animation';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('네이티브 트레이 pulse 수명', () => {
  it('40프레임을 반복하고 같은 상태 재통지는 주기를 초기화하지 않는다', () => {
    /** 관찰하는 프레임 출력. */
    const paint = vi.fn();
    const animation = new TrayAnimation(paint, () => false);
    animation.show('review');
    expect(paint).toHaveBeenLastCalledWith('review', 0);
    vi.advanceTimersByTime(750);
    animation.show('review');
    animation.refresh();
    expect(paint).toHaveBeenLastCalledWith('review', 15);
    vi.advanceTimersByTime(250);
    expect(paint).toHaveBeenLastCalledWith('review', 20);
    vi.advanceTimersByTime(1000);
    expect(paint).toHaveBeenLastCalledWith('review', 0);
    expect(vi.getTimerCount()).toBe(2);
    animation.show('problem');
    expect(paint.mock.lastCall?.[0]).toBe('problem');
    expect(vi.getTimerCount()).toBe(0);
    animation.show('review');
    expect(paint).toHaveBeenLastCalledWith('review', 0);
    animation.show('idle');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('동작 줄이기 중에는 채움으로 정지하고 해제 여부만 확인한다', () => {
    /** 변경할 운영체제 설정과 출력. */
    let reduced = true;
    const paint = vi.fn();
    const preference = vi.fn(() => reduced);
    const animation = new TrayAnimation(paint, preference);
    animation.show('review');
    expect(paint).toHaveBeenLastCalledWith('review', 20);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(2000);
    expect(paint).toHaveBeenCalledTimes(1);
    reduced = false;
    vi.advanceTimersByTime(1000);
    expect(paint).toHaveBeenLastCalledWith('review', 0);
    expect(vi.getTimerCount()).toBe(2);
    vi.advanceTimersByTime(500);
    reduced = true;
    vi.advanceTimersByTime(500);
    expect(paint).toHaveBeenLastCalledWith('review', 20);
    expect(vi.getTimerCount()).toBe(1);
    animation.show('idle');
    preference.mockClear();
    vi.advanceTimersByTime(5000);
    expect(preference).not.toHaveBeenCalled();
  });

  it('절전·복귀와 폐기가 중복 타이머나 늦은 그림을 남기지 않는다', () => {
    /** 출력과 수명 관리 대상. */
    const paint = vi.fn();
    const animation = new TrayAnimation(paint, () => false);
    animation.show('review');
    vi.advanceTimersByTime(300);
    animation.suspend();
    expect(vi.getTimerCount()).toBe(0);
    // 잠든 사이 도메인 상태가 바뀌어도 예약은 재개하지 않는다.
    animation.show('problem');
    animation.show('review');
    expect(vi.getTimerCount()).toBe(0);
    animation.resume();
    animation.resume();
    expect(paint).toHaveBeenLastCalledWith('review', 0);
    expect(vi.getTimerCount()).toBe(2);
    animation.destroy();
    animation.destroy();
    paint.mockClear();
    animation.show('review');
    animation.refresh();
    animation.suspend();
    animation.resume();
    vi.advanceTimersByTime(10000);
    expect(paint).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('늦게 실행된 틱도 벽시계나 누적 틱 수 대신 단조 시각으로 프레임을 고른다', () => {
    /** 지연을 주입하는 시계. */
    let now = 0;
    let tick = (): void => {};
    const paint = vi.fn();
    const animation = new TrayAnimation(paint, () => false, {
      now: () => now,
      after: (delay, callback) => {
        if (delay <= 50) tick = callback;
        return () => {};
      },
    });
    animation.show('review');
    now = 3750;
    tick();
    expect(paint).toHaveBeenLastCalledWith('review', 35);
    animation.destroy();
  });
});
