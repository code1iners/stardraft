import type { AgentId, Executor } from '../ports/executor';
import type { AgentExecutorOptions } from './agent-launch';
import { checkClaudeLogin, CLAUDE_COMMAND_NAME, CLAUDE_MODEL_ALIASES, claudeUpdateCommand, MIN_CLAUDE_VERSION } from './claude-cli';
import { ClaudeCodeExecutor } from './claude-code-executor';
import { checkCodexLogin, CODEX_COMMAND_NAME, codexUpdateCommand, MIN_CODEX_VERSION, readCodexModels } from './codex-cli';
import { CodexExecutor } from './codex-executor';
import type { ProcessResult } from './process-runner';

/** 모델 선택 상자에 넣는 모델 하나. */
export interface ListedModel {
  /** CLI에 넘길 모델 값. */
  id: string;
  /** 화면에 보일 이름. */
  label: string;
}

/** 찾은 CLI를 앱이 실제로 쓰는 환경으로 실행한다. `onStdoutLine`을 주면 길이 상한 없이 줄 단위로 받는다. */
export type CliCommand = (args: string[], onStdoutLine?: (line: string) => void) => Promise<ProcessResult>;

/** 로그인 확인의 결과. */
export type LoginCheck =
  /** 로그인되어 있다. `authMethod`는 CLI가 알려 준 로그인 방식이다. */
  | { ok: true; authMethod: string | null }
  /** 로그인되어 있지 않거나 앱이 쓸 수 없는 방식(`apiKeyHelper`)으로만 인증한다. */
  | { ok: false; reason: 'not-logged-in' | 'api-key-helper'; authMethod: string | null }
  /** 로그인 상태 명령이 실패했거나 출력을 읽지 못했다. `failedResult`의 출력을 오류 원문으로 남긴다. */
  | { ok: false; reason: 'unreadable'; authMethod: string | null; failedResult: ProcessResult };

/** 연결 확인과 실행이 에이전트마다 다르게 하는 것. */
export interface AgentCli {
  /** 에이전트. */
  readonly agent: AgentId;
  /** 터미널과 PATH에서 찾는 명령 이름. */
  readonly commandName: string;
  /** 실행 계약의 필수 플래그를 모두 지원하는 가장 낮은 버전. */
  readonly minVersion: string;
  /** 설치 방법에 맞는 업데이트 명령. `realPath`는 링크를 푼 실제 경로다. */
  updateCommand(realPath: string, cliCommand: string): string;
  /** 로그인을 확인한다. */
  checkLogin(runCli: CliCommand): Promise<LoginCheck>;
  /** 연결 확인 때 모델 선택 상자에 넣을 모델을 읽는다. 읽지 못하면 빈 목록이다. */
  readModels(runCli: CliCommand): Promise<ListedModel[]>;
  /** 연결 확인이 찾은 CLI와 환경으로 띄우는 실행기를 만든다. */
  createExecutor(options: AgentExecutorOptions): Executor;
}

/** 에이전트별 CLI 정보. */
export const AGENT_CLIS: Readonly<Record<AgentId, AgentCli>> = {
  'claude-code': {
    agent: 'claude-code',
    commandName: CLAUDE_COMMAND_NAME,
    minVersion: MIN_CLAUDE_VERSION,
    updateCommand: claudeUpdateCommand,
    checkLogin: checkClaudeLogin,
    // 계열 별칭은 앱에 넣어 두므로 CLI에 묻지 않는다.
    readModels: () => Promise.resolve([...CLAUDE_MODEL_ALIASES]),
    createExecutor: (options) => new ClaudeCodeExecutor(options),
  },
  codex: {
    agent: 'codex',
    commandName: CODEX_COMMAND_NAME,
    minVersion: MIN_CODEX_VERSION,
    updateCommand: codexUpdateCommand,
    checkLogin: checkCodexLogin,
    readModels: readCodexModels,
    createExecutor: (options) => new CodexExecutor(options),
  },
};

/**
 * 이 OS에서 연결 후보가 되는 에이전트. 실행기 허용 기준(쓰기·웹 차단, 읽기 범위 제한, 비밀 파일 차단)을 실측으로 확인한 OS에서만 후보다.
 * Codex는 macOS에서만 허용한다. Windows는 MXC 샌드박스 실측 전까지 Claude Code만 쓴다.
 */
export function agentCandidates(platform: NodeJS.Platform): AgentId[] {
  return platform === 'darwin' ? ['claude-code', 'codex'] : ['claude-code'];
}
