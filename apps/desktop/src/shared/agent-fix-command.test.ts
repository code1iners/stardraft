import { describe, expect, it } from 'vitest';
import { agentFixCommand } from './agent-fix-command';

describe('에이전트 실패 카드의 명령', () => {
  it('찾지 못하면 OS에 맞는 공식 설치 명령을 보인다', () => {
    const failure = { step: 'find', reason: 'not-found' } as const;

    expect(agentFixCommand(failure, { cliCommand: 'claude' }, 'darwin')).toBe('curl -fsSL https://claude.ai/install.sh | bash');
    expect(agentFixCommand(failure, { cliCommand: 'claude' }, 'win32')).toBe('irm https://claude.ai/install.ps1 | iex');
  });

  it('업데이트와 로그인 명령은 앱이 찾은 CLI를 부르는 말을 앞에 붙인다', () => {
    expect(agentFixCommand({ step: 'version', reason: 'update-required' }, { cliCommand: 'claude' }, 'darwin')).toBe('claude update');
    expect(agentFixCommand({ step: 'login', reason: 'not-logged-in' }, { cliCommand: "'/opt/tools/claude'" }, 'darwin')).toBe(
      "'/opt/tools/claude' auth login",
    );
    expect(agentFixCommand({ step: 'login', reason: 'api-key-helper' }, { cliCommand: "& 'C:\\tools\\claude.exe'" }, 'win32')).toBe(
      "& 'C:\\tools\\claude.exe' auth login",
    );
  });

  it('명령으로 고칠 수 없는 실패는 명령이 없다', () => {
    expect(agentFixCommand({ step: 'version', reason: 'unreadable' }, { cliCommand: 'claude' }, 'darwin')).toBeNull();
    expect(agentFixCommand({ step: 'login', reason: 'unreadable' }, { cliCommand: 'claude' }, 'darwin')).toBeNull();
    expect(agentFixCommand({ step: 'find', reason: 'picked-invalid' }, { cliCommand: 'claude' }, 'darwin')).toBeNull();
  });
});
