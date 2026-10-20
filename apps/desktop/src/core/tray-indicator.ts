/**
 * 트레이 아이콘에 덧붙이는 표시. macOS는 아이콘 옆 글자, Windows는 아이콘에 그린 배지로 보인다.
 * 실패 있음(빨간 점), 생성 중(점 세 개)은 뒤 티켓이 우선순위 끝에 더한다.
 */
export type TrayIndicator =
  /** 덧붙이는 표시가 없다. */
  | { kind: 'none' }
  /** "!". 전역 문제가 있다. */
  | { kind: 'alert' }
  /** 검토 대기 수. */
  | { kind: 'review-count'; count: number }
  /** 노란 점("설정 필요"). 감지를 시작하기 전이다. */
  | { kind: 'setup-needed' };

/** 트레이 표시를 고르는 데 쓰는 앱 상태. */
export interface TrayIndicatorInput {
  /** 전역 문제가 있는지 여부. */
  hasGlobalProblem: boolean;
  /** 검토 대기 수. */
  reviewCount: number;
  /** 감지를 시작하기 전인지 여부. */
  setupNeeded: boolean;
}

/** 트레이 표시는 한 자리라 우선순위가 높은 하나만 보인다. 전역 문제 "!", 검토 대기 숫자, 노란 점 순이다. */
export function trayIndicator({ hasGlobalProblem, reviewCount, setupNeeded }: TrayIndicatorInput): TrayIndicator {
  if (hasGlobalProblem) return { kind: 'alert' };
  if (reviewCount > 0) return { kind: 'review-count', count: reviewCount };
  if (setupNeeded) return { kind: 'setup-needed' };
  return { kind: 'none' };
}
