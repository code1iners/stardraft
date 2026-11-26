import type { AgentId } from '../ports/executor';
import { deniedServerFor } from './denied-tools';

/** MCP 서버의 연결 종류. */
export type McpServerKind = 'stdio' | 'http' | 'sse' | 'ws' | 'unknown';

/**
 * 설정 `재현` 탭 목록의 MCP 서버 한 줄. 서버 정의의 값(환경 변수, 헤더, 인수, 주소)은 담지 않는다.
 * 이름, 종류, 출처 CLI, 앱이 뺀 위험 도구, 외부로 보낼 수 있는지만 쓴다.
 */
export interface McpServerEntry {
  /** 서버가 등록된 CLI. 같은 이름이라도 CLI마다 다른 줄이다. */
  agent: AgentId;
  /** 서버 이름. */
  name: string;
  /** 연결 종류. */
  kind: McpServerKind;
  /** 외부로 보낼 수 있는 서버인지 여부: 원격(주소로 붙는) 서버이거나 알려진 외부 전송·클라우드 서버. */
  external: boolean;
  /** 앱이 고정으로 막는 위험 도구 이름. 알려진 서버가 아니면 비어 있다. */
  deniedTools: string[];
}

/** 알 수 없는 값을 객체로 본다. 객체가 아니면 `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** 알 수 없는 값을 문자열로 본다. 문자열이 아니면 빈 문자열. */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 서버 정의에서 이름을 알아보는 데 쓸 글자(명령, 인수, 주소)를 모은다. 환경 변수와 헤더는 보지 않는다. */
function identityOf(name: string, definition: Record<string, unknown>): string {
  /** 인수 목록. */
  const args = Array.isArray(definition.args) ? definition.args.map(asString) : [];
  return [name, asString(definition.command), ...args, asString(definition.url)].join(' ');
}

/** 연결 종류 글자를 `McpServerKind`로 바꾼다. */
function kindOf(type: string, definition: Record<string, unknown>): McpServerKind {
  switch (type) {
    case 'stdio':
      return 'stdio';
    case 'http':
    case 'streamable_http':
      return 'http';
    case 'sse':
      return 'sse';
    case 'ws':
      return 'ws';
    case '':
      // Claude Code는 종류를 생략하면 명령이 있는 stdio로 본다.
      if (asString(definition.command) !== '') return 'stdio';
      return asString(definition.url) !== '' ? 'http' : 'unknown';
    default:
      return 'unknown';
  }
}

/** 서버 정의 하나를 목록의 줄로 만든다. */
function entryOf(agent: AgentId, name: string, kind: McpServerKind, definition: Record<string, unknown>): McpServerEntry {
  /** 알려진 고정 deny 서버. */
  const known = deniedServerFor(identityOf(name, definition));
  return {
    agent,
    name,
    kind,
    external: kind === 'http' || kind === 'sse' || kind === 'ws' || (known?.sendsExternally ?? false),
    deniedTools: known ? [...known.tools] : [],
  };
}

/**
 * Claude Code가 설정 파일(`~/.claude.json`)에 둔 MCP 서버를 목록으로 읽는다.
 * 사용자 범위와, 매핑된 저장소 경로의 로컬 범위만 본다. 저장소의 프로젝트 정의 파일(`.mcp.json`)과 플러그인, 커넥터는 목록에 넣지 않는다.
 * 같은 이름은 로컬 > 사용자 순서로 하나만 남기고, 로컬 범위에서 꺼 둔 서버(`disabledMcpServers`)는 뺀다.
 * @param repoPaths 로컬 범위를 찾을 매핑된 저장소 절대 경로.
 */
export function parseClaudeMcpServers(config: unknown, repoPaths: readonly string[]): McpServerEntry[] {
  /** 설정 파일 전체. */
  const root = asRecord(config);
  if (!root) return [];
  /** 이름 → 정의. 사용자 범위를 먼저 담고 로컬 범위가 덮는다. */
  const definitions = new Map<string, Record<string, unknown>>();
  /** 꺼 둔 서버 이름. */
  const disabled = new Set<string>();
  /** 로컬 범위에서 이미 정의를 정한 이름. 사용자 범위는 덮어쓰지만 먼저 읽은 저장소의 로컬 정의는 덮어쓰지 않는다. */
  const localNames = new Set<string>();

  for (const [name, definition] of Object.entries(asRecord(root.mcpServers) ?? {})) {
    /** 정의. */
    const record = asRecord(definition);
    if (record) definitions.set(name, record);
  }
  /** 저장소 경로별 프로젝트 항목. */
  const projects = asRecord(root.projects) ?? {};
  for (const repoPath of repoPaths) {
    /** 이 저장소의 로컬 범위 항목. */
    const project = asRecord(projects[repoPath]);
    if (!project) continue;
    for (const [name, definition] of Object.entries(asRecord(project.mcpServers) ?? {})) {
      /** 정의. */
      const record = asRecord(definition);
      if (!record || localNames.has(name)) continue;
      definitions.set(name, record);
      localNames.add(name);
    }
    if (Array.isArray(project.disabledMcpServers)) {
      for (const name of project.disabledMcpServers) if (typeof name === 'string') disabled.add(name);
    }
  }

  return [...definitions]
    .filter(([name]) => !disabled.has(name))
    .map(([name, definition]) => entryOf('claude-code', name, kindOf(asString(definition.type), definition), definition));
}

/**
 * `codex mcp list --json`의 출력을 목록으로 읽는다. 이 출력에는 환경 변수와 헤더의 평문 값이 있지만 이름·종류만 꺼내고 나머지는 버린다.
 * 꺼 둔 서버(`enabled: false`)는 뺀다. 형식이 맞지 않으면 빈 목록이다.
 */
export function parseCodexMcpServers(listJson: unknown): McpServerEntry[] {
  if (!Array.isArray(listJson)) return [];
  /** 목록의 줄. */
  const entries: McpServerEntry[] = [];
  for (const item of listJson) {
    /** 서버 항목. */
    const server = asRecord(item);
    /** 연결 방식 항목. */
    const transport = asRecord(server?.transport);
    if (!server || !transport || typeof server.name !== 'string' || server.name === '') continue;
    if (server.enabled === false) continue;
    entries.push(entryOf('codex', server.name, kindOf(asString(transport.type), transport), transport));
  }
  return entries;
}
