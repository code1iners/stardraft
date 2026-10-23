import { describe, expect, it } from 'vitest';
import { trayIndicator, type TrayIndicatorInput } from './tray-indicator';

/** 처리할 알림이 없는 기본 상태. */
const idle: TrayIndicatorInput = { hasGlobalProblem: false, setupNeeded: false, hasFailure: false, reviewCount: 0, generating: false };

describe('트레이 표시 우선순위', () => {
  it.each([
    [{ hasGlobalProblem: true, setupNeeded: true, hasFailure: true, reviewCount: 12 }, { kind: 'problem', reason: 'global' }],
    [{ setupNeeded: true, hasFailure: true, reviewCount: 12 }, { kind: 'problem', reason: 'setup-needed' }],
    [{ hasFailure: true, reviewCount: 12 }, { kind: 'problem', reason: 'failure' }],
    [{ hasFailure: true, generating: true }, { kind: 'problem', reason: 'failure' }],
    [{ reviewCount: 12, generating: true }, { kind: 'review', count: 12 }],
    [{ generating: true }, { kind: 'idle', generating: true }],
    [{}, { kind: 'idle', generating: false }],
  ] satisfies [Partial<TrayIndicatorInput>, ReturnType<typeof trayIndicator>][])('동시 상태 %j는 %j로 표시한다', (input, expected) => {
    expect(trayIndicator({ ...idle, ...input })).toEqual(expected);
  });

  it('문제 해결 후 검토가 남으면 검토로, 처리하면 빈 아이콘으로 돌아간다', () => {
    /** 문제와 검토가 함께 있던 상태. */
    const state = { ...idle, hasGlobalProblem: true, reviewCount: 3 };
    expect(trayIndicator(state)).toEqual({ kind: 'problem', reason: 'global' });
    state.hasGlobalProblem = false;
    expect(trayIndicator(state)).toEqual({ kind: 'review', count: 3 });
    state.reviewCount = 0;
    expect(trayIndicator(state)).toEqual({ kind: 'idle', generating: false });
  });
});
