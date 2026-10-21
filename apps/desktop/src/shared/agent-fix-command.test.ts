import { describe, expect, it } from 'vitest';
import { agentFixCommand } from './agent-fix-command';

describe('에이전트 실패 카드의 명령', () => {
  it('찾지 못하면 OS에 맞는 공식 설치 명령을 보인다', () => {
    const failure = { step: 'find', reason: 'not-found' } as const;

    expect(agentFixCommand('claude-code', failure, { cliCommand: 'claude', updateCommand: 'claude update' }, 'darwin')).toBe('curl -fsSL https://claude.ai/install.sh | bash');
    expect(agentFixCommand('claude-code', failure, { cliCommand: 'claude', updateCommand: 'claude update' }, 'win32')).toBe('irm https://claude.ai/install.ps1 | iex');
  });

  it('업데이트는 설치 방법에 맞춘 명령을, 로그인은 앱이 찾은 CLI를 부르는 말을 앞에 붙인 명령을 보인다', () => {
    expect(
      agentFixCommand('claude-code', { step: 'version', reason: 'update-required' }, { cliCommand: 'claude', updateCommand: 'brew upgrade --cask claude-code' }, 'darwin'),
    ).toBe('brew upgrade --cask claude-code');
    expect(agentFixCommand('claude-code', { step: 'version', reason: 'update-required' }, { cliCommand: 'claude', updateCommand: 'claude update' }, 'darwin')).toBe('claude update');
    expect(agentFixCommand('claude-code', { step: 'login', reason: 'not-logged-in' }, { cliCommand: "'/opt/tools/claude'", updateCommand: "'/opt/tools/claude' update" }, 'darwin')).toBe(
      "'/opt/tools/claude' auth login",
    );
    expect(agentFixCommand('claude-code', { step: 'login', reason: 'api-key-helper' }, { cliCommand: "& 'C:\\tools\\claude.exe'", updateCommand: "& 'C:\\tools\\claude.exe' update" }, 'win32')).toBe(
      "& 'C:\\tools\\claude.exe' auth login",
    );
  });

  it('Codex는 공식 독립 설치 명령, 설치 방법에 맞춘 업데이트 명령, 앱이 찾은 CLI를 부르는 말을 붙인 로그인 명령을 보인다', () => {
    /** Homebrew로 설치한 Codex의 자세히 내용. */
    const details = { cliCommand: 'codex', updateCommand: 'brew upgrade --cask codex' };

    expect(agentFixCommand('codex', { step: 'find', reason: 'not-found' }, details, 'darwin')).toBe('curl -fsSL https://chatgpt.com/codex/install.sh | sh');
    expect(agentFixCommand('codex', { step: 'version', reason: 'update-required' }, details, 'darwin')).toBe('brew upgrade --cask codex');
    expect(agentFixCommand('codex', { step: 'login', reason: 'not-logged-in' }, details, 'darwin')).toBe('codex login');
    expect(agentFixCommand('codex', { step: 'login', reason: 'not-logged-in' }, { ...details, cliCommand: "'/opt/tools/codex'" }, 'darwin')).toBe(
      "'/opt/tools/codex' login",
    );
  });

  it('명령으로 고칠 수 없는 실패는 명령이 없다', () => {
    expect(agentFixCommand('claude-code', { step: 'version', reason: 'unreadable' }, { cliCommand: 'claude', updateCommand: 'claude update' }, 'darwin')).toBeNull();
    expect(agentFixCommand('claude-code', { step: 'login', reason: 'unreadable' }, { cliCommand: 'claude', updateCommand: 'claude update' }, 'darwin')).toBeNull();
    expect(agentFixCommand('claude-code', { step: 'find', reason: 'picked-invalid' }, { cliCommand: 'claude', updateCommand: 'claude update' }, 'darwin')).toBeNull();
  });
});
