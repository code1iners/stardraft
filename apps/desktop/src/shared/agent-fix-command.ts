import type { AgentCheckDetails, AgentCheckFailure, AppSnapshot } from './ipc';

/** Claude Code 설치 명령. macOS 터미널용. 공식 설치 스크립트다. */
const CLAUDE_INSTALL_COMMAND_MAC = 'curl -fsSL https://claude.ai/install.sh | bash';

/** Claude Code 설치 명령. Windows PowerShell용. 공식 설치 스크립트다. */
const CLAUDE_INSTALL_COMMAND_WINDOWS = 'irm https://claude.ai/install.ps1 | iex';

/**
 * 실패 카드에 보이고 [명령 복사]가 복사하는 명령. 명령으로 고칠 수 없는 실패면 `null`이다.
 * 로그인 명령은 터미널에서 앱이 찾은 CLI가 실행되게 `cliCommand`를 앞에 붙이고, 업데이트 명령은 설치 방법에 맞춰 main이 정한 것을 쓴다.
 */
export function agentFixCommand(
  failure: AgentCheckFailure,
  details: Pick<AgentCheckDetails, 'cliCommand' | 'updateCommand'>,
  platform: AppSnapshot['platform'],
): string | null {
  switch (failure.reason) {
    case 'not-found':
      return platform === 'win32' ? CLAUDE_INSTALL_COMMAND_WINDOWS : CLAUDE_INSTALL_COMMAND_MAC;
    case 'update-required':
      return details.updateCommand;
    case 'not-logged-in':
    case 'api-key-helper':
      return `${details.cliCommand} auth login`;
    default:
      return null;
  }
}
