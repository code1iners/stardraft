/** 트레이 아이콘에 덧붙이는 표시. macOS는 아이콘 옆 글자, Windows는 아이콘에 그린 배지로 보인다. */
export type TrayIndicator =
  /** 덧붙이는 표시가 없다. */
  | { kind: 'none' }
  /** "!". 전역 문제가 있다. */
  | { kind: 'alert' }
  /** 검토 대기 수. */
  | { kind: 'review-count'; count: number }
  /** 노란 점("설정 필요"). 감지를 시작하기 전이다. */
  | { kind: 'setup-needed' }
  /** 빨간 점. 실패나 게시 실패 묶음이 있다. */
  | { kind: 'failure' }
  /** 점 세 개. 생성 중인 묶음이 있다. */
  | { kind: 'generating' };

/** 트레이 표시를 고르는 데 쓰는 앱 상태. */
export interface TrayIndicatorInput {
  /** 전역 문제가 있는지 여부. */
  hasGlobalProblem: boolean;
  /** 검토 대기 수. */
  reviewCount: number;
  /** 감지를 시작하기 전인지 여부. */
  setupNeeded: boolean;
  /** 실패나 게시 실패 묶음이 있는지 여부. */
  hasFailure: boolean;
  /** 생성 중인 묶음이 있는지 여부. */
  generating: boolean;
}

/**
 * 트레이 표시는 한 자리라 우선순위가 높은 하나만 보인다.
 * 전역 문제 "!", 검토 대기 숫자, 노란 점, 실패의 빨간 점, 생성 중의 점 세 개 순이다.
 */
export function trayIndicator({ hasGlobalProblem, reviewCount, setupNeeded, hasFailure, generating }: TrayIndicatorInput): TrayIndicator {
  if (hasGlobalProblem) return { kind: 'alert' };
  if (reviewCount > 0) return { kind: 'review-count', count: reviewCount };
  if (setupNeeded) return { kind: 'setup-needed' };
  if (hasFailure) return { kind: 'failure' };
  if (generating) return { kind: 'generating' };
  return { kind: 'none' };
}
