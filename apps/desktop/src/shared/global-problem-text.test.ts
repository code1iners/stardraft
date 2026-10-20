import { describe, expect, it } from 'vitest';
import { globalProblemText } from './global-problem-text';

describe('전역 문제 문구', () => {
  it('Flow가 키를 거부하면(401) 키가 삭제되거나 바뀌었을 수 있다고 알리고 [키 다시 입력]이 Flow 계정 칸을 연다', () => {
    expect(globalProblemText({ cause: 'flow-key', reason: 'rejected' }, 'darwin')).toEqual({
      title: '키 확인 필요',
      message: 'Flow가 키를 거부했습니다. 키가 삭제됐거나 바뀌었을 수 있습니다.',
      actionLabel: '키 다시 입력',
      actionSection: 'flow-account',
    });
  });

  it('macOS에서 저장된 키를 읽을 수 없으면 키체인 문구를 쓴다', () => {
    expect(globalProblemText({ cause: 'flow-key', reason: 'unreadable' }, 'darwin').message).toBe(
      '저장된 키를 읽을 수 없습니다. 키체인 접근을 거부했거나 항목이 지워졌을 수 있습니다.',
    );
  });

  it('Windows에서 저장된 키를 읽을 수 없으면 키체인 대신 Windows 사용자 계정(DPAPI)에 맞춘 문구를 쓴다', () => {
    /** Windows 문구. */
    const message = globalProblemText({ cause: 'flow-key', reason: 'unreadable' }, 'win32').message;

    expect(message).toBe('저장된 키를 읽을 수 없습니다. Windows 사용자 계정이 바뀌었거나 다른 PC에서 옮겨 온 데이터일 수 있습니다.');
    expect(message).not.toContain('키체인');
  });
});
