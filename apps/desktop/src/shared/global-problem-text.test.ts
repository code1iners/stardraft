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

  it.each([
    ['cli-missing', 'Claude Code를 찾을 수 없습니다. 지워졌거나 위치가 바뀌었을 수 있습니다.'],
    ['not-logged-in', 'Claude Code에 로그인되어 있지 않습니다. 로그아웃했거나 로그인이 만료됐을 수 있습니다.'],
    ['update-required', 'Claude Code를 업데이트해야 합니다. 지금 버전은 Stardraft에 필요한 기능을 지원하지 않습니다.'],
    ['check-failed', 'Claude Code 작동 확인에 실패했습니다. 초안을 만들 수 없어 멈췄습니다.'],
  ] as const)('에이전트 전역 실패(%s)는 원인을 적고 [에이전트 확인]이 에이전트 칸을 연다', (reason, message) => {
    expect(globalProblemText({ cause: 'agent', agent: 'claude-code', reason }, 'darwin')).toEqual({
      title: '에이전트 확인 필요',
      message,
      actionLabel: '에이전트 확인',
      actionSection: 'agent',
    });
  });

  it('Codex의 전역 실패는 Codex 이름으로 원인을 적는다', () => {
    expect(globalProblemText({ cause: 'agent', agent: 'codex', reason: 'not-logged-in' }, 'darwin').message).toBe(
      'Codex에 로그인되어 있지 않습니다. 로그아웃했거나 로그인이 만료됐을 수 있습니다.',
    );
    expect(globalProblemText({ cause: 'agent', agent: 'codex', reason: 'cli-missing' }, 'darwin').message).toBe(
      'Codex를 찾을 수 없습니다. 지워졌거나 위치가 바뀌었을 수 있습니다.',
    );
  });
});
