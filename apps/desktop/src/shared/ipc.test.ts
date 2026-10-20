import { describe, expect, it } from 'vitest';
import { FLOW_API_KEY_MAX_LENGTH, parseAppCommand } from './ipc';

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

  it('데이터 폴더와 로그 폴더 열기 명령을 받는다', () => {
    expect(parseAppCommand({ type: 'open-folder', folder: 'data' })).toEqual({ type: 'open-folder', folder: 'data' });
    expect(parseAppCommand({ type: 'open-folder', folder: 'logs' })).toEqual({ type: 'open-folder', folder: 'logs' });
  });

  it('정해진 폴더가 아니면 폴더 열기 명령을 거부한다', () => {
    expect(parseAppCommand({ type: 'open-folder', folder: '/etc' })).toBeNull();
    expect(parseAppCommand({ type: 'open-folder' })).toBeNull();
  });

  it('키 확인 명령은 붙여 넣은 키를 그대로 받는다', () => {
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: ' fake-key-1\n' })).toEqual({
      type: 'check-flow-key',
      apiKey: ' fake-key-1\n',
    });
  });

  it('키가 비었거나 문자열이 아니거나 너무 길면 키 확인 명령을 거부한다', () => {
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: '' })).toBeNull();
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: ' \n ' })).toBeNull();
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: 42 })).toBeNull();
    expect(parseAppCommand({ type: 'check-flow-key' })).toBeNull();
    expect(parseAppCommand({ type: 'check-flow-key', apiKey: 'k'.repeat(FLOW_API_KEY_MAX_LENGTH + 1) })).toBeNull();
  });

  it('다른 계정으로 바꾸기 확인과 키 확인 그만두기 명령을 받는다', () => {
    expect(parseAppCommand({ type: 'confirm-flow-account-switch' })).toEqual({ type: 'confirm-flow-account-switch' });
    expect(parseAppCommand({ type: 'cancel-flow-key-check' })).toEqual({ type: 'cancel-flow-key-check' });
  });

  it('모르는 칸, 모르는 명령, 객체가 아닌 값은 거부한다', () => {
    expect(parseAppCommand({ type: 'open-settings', section: '../../etc' })).toBeNull();
    expect(parseAppCommand({ type: 'run-shell', command: 'rm -rf /' })).toBeNull();
    expect(parseAppCommand('open-settings')).toBeNull();
    expect(parseAppCommand(null)).toBeNull();
  });
});
