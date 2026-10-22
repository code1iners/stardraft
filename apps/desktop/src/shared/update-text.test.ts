import { describe, expect, it } from 'vitest';
import type { UpdateSnapshot } from './ipc';
import { updateMenuItem } from './update-text';

describe('오른쪽 클릭 메뉴의 업데이트 항목', () => {
  it('최신·확인 중·확인 실패·서명 검증 실패·설치 실패에는 항목을 두지 않는다', () => {
    /** 메뉴에 보이지 않는 상태. */
    const hidden: UpdateSnapshot[] = [
      { kind: 'idle' },
      { kind: 'checking' },
      { kind: 'up-to-date', checkedAt: 0 },
      { kind: 'check-failed', failedAt: 0 },
      { kind: 'signature-failed', version: '0.2.0' },
      { kind: 'install-failed', version: '0.2.0', reason: 'not-applied' },
      { kind: 'install-failed', version: '0.2.0', reason: 'rejected' },
    ];
    for (const status of hidden) expect(updateMenuItem(status)).toBeNull();
  });

  it('받는 중이면 받은 비율을 누를 수 없는 항목으로 보인다', () => {
    expect(updateMenuItem({ kind: 'downloading', version: '0.2.0', percent: 45 })).toEqual({ label: '0.2.0 받는 중… 45%', action: null });
  });

  it('설치 준비됨이면 "다시 시작해서 업데이트 (0.2.0)"를 누르면 다시 시작한다', () => {
    expect(updateMenuItem({ kind: 'ready', version: '0.2.0' })).toEqual({ label: '다시 시작해서 업데이트 (0.2.0)', action: 'restart' });
  });

  it('다시 시작 대기면 "다시 시작 대기 중…"을 누르면 [지금 다시 시작]과 [취소]가 있는 작은 창을 연다', () => {
    expect(updateMenuItem({ kind: 'restart-pending', version: '0.2.0', waitingFor: { drafting: true, posting: false } })).toEqual({
      label: '다시 시작 대기 중…',
      action: 'open-popover',
    });
  });

  it('스스로 바꿀 수 없는 위치면 "새 버전 0.2.0 · 사이트에서 받기"를 누르면 사이트의 업데이트 섹션을 연다', () => {
    expect(updateMenuItem({ kind: 'location-blocked', version: '0.2.0', reason: 'read-only' })).toEqual({
      label: '새 버전 0.2.0 · 사이트에서 받기',
      action: 'open-site',
    });
  });
});
