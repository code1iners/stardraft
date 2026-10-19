import { describe, expect, it } from 'vitest';
import { parseAppCommand } from './ipc';

describe('렌더러가 보낸 명령 검사', () => {
  it('설정 열기 명령을 칸과 함께 받는다', () => {
    expect(parseAppCommand({ type: 'open-settings', section: 'agent' })).toEqual({
      type: 'open-settings',
      section: 'agent',
    });
  });

  it('칸이 없는 설정 열기 명령을 받는다', () => {
    expect(parseAppCommand({ type: 'open-settings' })).toEqual({ type: 'open-settings' });
  });

  it('모르는 칸, 모르는 명령, 객체가 아닌 값은 거부한다', () => {
    expect(parseAppCommand({ type: 'open-settings', section: '../../etc' })).toBeNull();
    expect(parseAppCommand({ type: 'run-shell', command: 'rm -rf /' })).toBeNull();
    expect(parseAppCommand('open-settings')).toBeNull();
    expect(parseAppCommand(null)).toBeNull();
  });
});
