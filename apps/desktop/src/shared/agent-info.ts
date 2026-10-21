import type { AgentId } from './ipc';

/** 화면과 실패 카드의 명령이 쓰는 에이전트 하나의 정보. 렌더러는 core를 import할 수 없어 shared에 둔다. */
export interface AgentInfo {
  /** 화면에 보일 이름. 모두 모음으로 끝나 조사 "를"·"가"를 쓴다. */
  name: string;
  /** 연결선 끝의 에이전트 아이콘에 쓰는 글자. */
  mark: string;
  /** CLI 실행 파일 이름. */
  commandName: string;
  /** 로그인 명령이 브라우저로 여는 계정. 실패 카드 셋째 장의 그림에 쓴다. */
  loginSite: string;
  /** 터미널에서 CLI를 부르는 말 뒤에 붙이는 로그인 명령. */
  loginArgs: string;
  /** 공식 설치 명령. macOS 터미널용과 Windows PowerShell용이고, 그 OS에서 후보가 아니면 `null`이다. */
  installCommands: { mac: string; windows: string | null };
}

/** 에이전트별 정보. 에이전트를 더하면 여기와 core의 `AGENT_CLIS`에 더한다. */
export const AGENT_INFO: Record<AgentId, AgentInfo> = {
  'claude-code': {
    name: 'Claude Code',
    mark: 'C',
    commandName: 'claude',
    loginSite: 'Claude',
    loginArgs: 'auth login',
    installCommands: { mac: 'curl -fsSL https://claude.ai/install.sh | bash', windows: 'irm https://claude.ai/install.ps1 | iex' },
  },
  codex: {
    name: 'Codex',
    mark: 'X',
    commandName: 'codex',
    loginSite: 'ChatGPT',
    loginArgs: 'login',
    // 공식 독립 설치 스크립트다(`~/.local/bin`에 설치). Codex는 macOS에서만 후보다.
    installCommands: { mac: 'curl -fsSL https://chatgpt.com/codex/install.sh | sh', windows: null },
  },
};
