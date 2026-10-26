/** 트레이에 표시하는 세 상태. 검토 수는 툴팁에서만 사용한다. */
export type TrayIndicator =
  | { kind: 'idle'; generating: boolean }
  | { kind: 'review'; count: number }
  | { kind: 'problem'; reason: 'global' | 'setup-needed' | 'failure' };

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

/** 문제, 검토 대기, 대기 순으로 표시한다. 창을 열어도 이 상태는 바뀌지 않는다. */
export function trayIndicator({ hasGlobalProblem, reviewCount, setupNeeded, hasFailure, generating }: TrayIndicatorInput): TrayIndicator {
  if (hasGlobalProblem) return { kind: 'problem', reason: 'global' };
  if (setupNeeded) return { kind: 'problem', reason: 'setup-needed' };
  if (hasFailure) return { kind: 'problem', reason: 'failure' };
  if (reviewCount > 0) return { kind: 'review', count: reviewCount };
  return { kind: 'idle', generating };
}
