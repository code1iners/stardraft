import type { AgentId } from './ipc';

/** 에이전트 이름. 설정 화면, 전역 문제 문구, 상세 머리의 실행 줄이 같이 쓴다. */
export const AGENT_NAMES: Record<AgentId, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
};
