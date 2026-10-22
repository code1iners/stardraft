import { describe, expect, it } from 'vitest';
import { planCursor, readReducedMotion, watchReducedMotion } from './motion';

/** 누를 곳의 위치. */
const TARGET = { x: 120, y: 80 };
/** 예시 화면의 크기. */
const VIEW = { width: 400, height: 260 };

/** `matchMedia`처럼 동작 줄이기 설정을 답하는 가짜. 설정을 바꾸면 듣는 쪽에 알린다. */
function fakeMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const matchMedia = (query: string) => {
    expect(query).toBe('(prefers-reduced-motion: reduce)');
    return {
      get matches() {
        return matches;
      },
      addEventListener: (_type: 'change', listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: 'change', listener: () => void) => listeners.delete(listener),
    };
  };
  const set = (next: boolean) => {
    matches = next;
    for (const listener of listeners) listener();
  };
  return { matchMedia, set, listeners };
}

describe('커서 이동', () => {
  it('동작 줄이기가 꺼져 있으면, 예시 화면이 보이기 전에는 커서를 숨긴다', () => {
    expect(planCursor({ reduced: false, seen: false, from: null, target: TARGET, view: VIEW })).toBeNull();
  });

  it('보이면 처음에는 오른쪽 아래 구석에서 누를 곳으로 움직인다', () => {
    expect(planCursor({ reduced: false, seen: true, from: null, target: TARGET, view: VIEW })).toEqual({
      from: { x: 360, y: 230 },
      to: TARGET,
      animate: true,
    });
  });

  it('다음 모습으로 넘어가면 지난 누를 곳에서 새 누를 곳으로 움직인다', () => {
    expect(planCursor({ reduced: false, seen: true, from: { x: 10, y: 20 }, target: TARGET, view: VIEW })).toEqual({
      from: { x: 10, y: 20 },
      to: TARGET,
      animate: true,
    });
  });

  it('동작 줄이기가 켜져 있으면 보이기 전이라도 커서를 누를 곳에 바로 놓는다', () => {
    for (const seen of [false, true]) {
      expect(planCursor({ reduced: true, seen, from: { x: 10, y: 20 }, target: TARGET, view: VIEW })).toEqual({
        from: TARGET,
        to: TARGET,
        animate: false,
      });
    }
  });

  it('누를 곳이 없는 마지막 모습에서는 커서를 숨긴다', () => {
    expect(planCursor({ reduced: false, seen: true, from: TARGET, target: null, view: VIEW })).toBeNull();
    expect(planCursor({ reduced: true, seen: true, from: TARGET, target: null, view: VIEW })).toBeNull();
  });
});

describe('동작 줄이기 설정 읽기', () => {
  it('OS 설정을 읽고, 바뀌면 알리고, 그만 들으면 알리지 않는다', () => {
    const media = fakeMatchMedia(true);
    const changes: boolean[] = [];

    expect(readReducedMotion(media.matchMedia)).toBe(true);
    const stop = watchReducedMotion(media.matchMedia, (reduced) => changes.push(reduced));
    media.set(false);
    stop();
    media.set(true);

    expect(changes).toEqual([false]);
    expect(media.listeners.size).toBe(0);
  });
});
