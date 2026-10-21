import { AGENT_INFO } from './agent-info';
import type { AgentCheckDetails, AgentCheckFailure, AgentId, AppSnapshot } from './ipc';

/**
 * 실패 카드에 보이고 [명령 복사]가 복사하는 명령. 명령으로 고칠 수 없는 실패면 `null`이다.
 * 로그인 명령은 터미널에서 앱이 찾은 CLI가 실행되게 `cliCommand`를 앞에 붙이고, 업데이트 명령은 설치 방법에 맞춰 main이 정한 것을 쓴다.
 */
export function agentFixCommand(
  agent: AgentId,
  failure: AgentCheckFailure,
  details: Pick<AgentCheckDetails, 'cliCommand' | 'updateCommand'>,
  platform: AppSnapshot['platform'],
): string | null {
  /** 이 에이전트의 설치·로그인 명령. */
  const { installCommands, loginArgs } = AGENT_INFO[agent];
  switch (failure.reason) {
    case 'not-found':
      return platform === 'win32' ? installCommands.windows : installCommands.mac;
    case 'update-required':
      return details.updateCommand;
    case 'not-logged-in':
    case 'api-key-helper':
      return `${details.cliCommand} ${loginArgs}`;
    default:
      return null;
  }
}
