import { describe, expect, it } from 'vitest';
import { trayIndicator } from './tray-indicator';

describe('트레이 아이콘 표시', () => {
  it('전역 문제가 있으면 검토 대기 숫자가 있어도 "!"를 보인다', () => {
    expect(trayIndicator({ hasGlobalProblem: true, reviewCount: 3, setupNeeded: false, hasFailure: false, generating: false })).toEqual({ kind: 'alert' });
  });

  it('전역 문제가 없으면 검토 대기 숫자를 보인다', () => {
    expect(trayIndicator({ hasGlobalProblem: false, reviewCount: 3, setupNeeded: false, hasFailure: false, generating: false })).toEqual({ kind: 'review-count', count: 3 });
  });

  it('전역 문제도 검토 대기도 없으면 아무것도 보이지 않는다', () => {
    expect(trayIndicator({ hasGlobalProblem: false, reviewCount: 0, setupNeeded: false, hasFailure: false, generating: false })).toEqual({ kind: 'none' });
  });

  it('감지를 시작하기 전이면 노란 점("설정 필요")을 보인다', () => {
    expect(trayIndicator({ hasGlobalProblem: false, reviewCount: 0, setupNeeded: true, hasFailure: false, generating: false })).toEqual({ kind: 'setup-needed' });
  });

  it('검토 대기가 없고 실패한 묶음이 있으면 빨간 점을, 생성 중인 묶음만 있으면 점 세 개를 보인다', () => {
    expect(trayIndicator({ hasGlobalProblem: false, reviewCount: 0, setupNeeded: false, hasFailure: true, generating: true })).toEqual({ kind: 'failure' });
    expect(trayIndicator({ hasGlobalProblem: false, reviewCount: 0, setupNeeded: false, hasFailure: false, generating: true })).toEqual({ kind: 'generating' });
  });

  it('표시 자리는 하나라서 검토 대기 숫자와 전역 문제가 실패와 생성 중보다 앞선다', () => {
    expect(trayIndicator({ hasGlobalProblem: false, reviewCount: 2, setupNeeded: false, hasFailure: true, generating: true })).toEqual({ kind: 'review-count', count: 2 });
    expect(trayIndicator({ hasGlobalProblem: true, reviewCount: 0, setupNeeded: false, hasFailure: true, generating: true })).toEqual({ kind: 'alert' });
  });

  it('감지를 시작하기 전이라도 전역 문제가 있으면 "!"가 앞선다', () => {
    expect(trayIndicator({ hasGlobalProblem: true, reviewCount: 0, setupNeeded: true, hasFailure: false, generating: false })).toEqual({ kind: 'alert' });
  });
});
