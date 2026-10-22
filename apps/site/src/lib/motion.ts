// 설명용 모션(커서 이동)을 OS의 "동작 줄이기"에 맞춰 정한다. CSS는 global.css의 미디어 쿼리가 따로 멈춘다.

/** 예시 화면 안의 위치(px). 왼쪽 위가 0이다. */
export type Point = { x: number; y: number };

/** 커서를 어디에 놓고 어디로 옮길지. */
export type CursorPlan = {
  /** 처음 놓을 곳. */
  from: Point;
  /** 옮겨 갈 곳. */
  to: Point;
  /** 움직여 보일지. false면 `to`에 바로 놓는다. */
  animate: boolean;
};

/** 동작 줄이기 미디어 쿼리. */
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** 처음 커서를 놓는 곳: 예시 화면 오른쪽 아래 구석에서 띄운 거리(px). */
const START_INSET = { x: 40, y: 30 };

/**
 * 커서를 놓을 곳을 정한다. 커서가 없어야 하면 null.
 * - 동작 줄이기: 보이기 전이라도 누를 곳에 바로 놓는다.
 * - 그 밖: 예시 화면이 보이는 위치까지 스크롤한 뒤에, 지난 누를 곳(처음이면 오른쪽 아래 구석)에서 누를 곳으로 움직인다.
 */
export function planCursor(input: {
  /** 동작 줄이기가 켜져 있는지. */
  reduced: boolean;
  /** 예시 화면이 보이는 위치까지 스크롤했는지. */
  seen: boolean;
  /** 지난번 커서 위치. 처음이면 null. */
  from: Point | null;
  /** 지금 누를 곳. 누를 곳이 없으면 null. */
  target: Point | null;
  /** 예시 화면의 크기. */
  view: { width: number; height: number };
}): CursorPlan | null {
  const { reduced, seen, from, target, view } = input;
  if (!target) return null;
  if (reduced) return { from: target, to: target, animate: false };
  if (!seen) return null;
  return { from: from ?? { x: view.width - START_INSET.x, y: view.height - START_INSET.y }, to: target, animate: true };
}

/** 동작 줄이기를 묻는 `window.matchMedia`의 일부. */
export type MatchMediaLike = (query: string) => {
  matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
};

/** OS의 동작 줄이기가 켜져 있는지. */
export function readReducedMotion(matchMedia: MatchMediaLike): boolean {
  return matchMedia(REDUCED_MOTION_QUERY).matches;
}

/** 동작 줄이기 설정이 바뀔 때마다 알린다. 돌려받은 함수를 부르면 그만 듣는다. */
export function watchReducedMotion(matchMedia: MatchMediaLike, onChange: (reduced: boolean) => void): () => void {
  const query = matchMedia(REDUCED_MOTION_QUERY);
  const listener = () => onChange(query.matches);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
