import { describe, expect, it } from 'vitest';
import { trayIndicator } from './tray-indicator';

describe('트레이 아이콘 표시', () => {
  it('전역 문제가 있으면 검토 대기 숫자가 있어도 "!"를 보인다', () => {
    expect(trayIndicator({ hasGlobalProblem: true, reviewCount: 3, setupNeeded: false })).toEqual({ kind: 'alert' });
  });

  it('전역 문제가 없으면 검토 대기 숫자를 보인다', () => {
    expect(trayIndicator({ hasGlobalProblem: false, reviewCount: 3, setupNeeded: false })).toEqual({ kind: 'review-count', count: 3 });
  });

  it('전역 문제도 검토 대기도 없으면 아무것도 보이지 않는다', () => {
    expect(trayIndicator({ hasGlobalProblem: false, reviewCount: 0, setupNeeded: false })).toEqual({ kind: 'none' });
  });

  it('감지를 시작하기 전이면 노란 점("설정 필요")을 보인다', () => {
    expect(trayIndicator({ hasGlobalProblem: false, reviewCount: 0, setupNeeded: true })).toEqual({ kind: 'setup-needed' });
  });

  it('감지를 시작하기 전이라도 전역 문제가 있으면 "!"가 앞선다', () => {
    expect(trayIndicator({ hasGlobalProblem: true, reviewCount: 0, setupNeeded: true })).toEqual({ kind: 'alert' });
  });
});
