import type { DiagnosisMcpServersSnapshot, McpSkipReasonSnapshot } from './ipc';

/** MCP 서버가 빠진 까닭의 화면 글. */
const MCP_SKIP_REASON_TEXT: Readonly<Record<McpSkipReasonSnapshot, string>> = {
  disabled: '꺼 둠',
  'missing-variable': '변수 없음',
  'variable-conflict': '변수 충돌',
  unreadable: '설정을 옮기지 못함',
  'connection-failed': '연결 실패',
};

/**
 * 보고서 실행 정보의 MCP 줄. 실린 서버 이름과, 빠진 서버가 있으면 `이름(까닭)` 목록이다. 화면과 내보낸 파일이 같은 글을 쓴다.
 * 재현하지 않은 진단(`null`)은 줄이 없다.
 */
export function mcpServerFacts(mcp: DiagnosisMcpServersSnapshot | null): [label: string, value: string][] {
  if (mcp === null) return [];
  return [
    ['실린 MCP 서버', mcp.loaded.length === 0 ? '없음' : mcp.loaded.join(', ')],
    ...(mcp.skipped.length === 0 ? [] : [['빠진 MCP 서버', mcp.skipped.map((server) => `${server.name}(${MCP_SKIP_REASON_TEXT[server.reason]})`).join(', ')] as [string, string]]),
  ];
}
