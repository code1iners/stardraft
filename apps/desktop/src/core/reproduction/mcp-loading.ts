import { isReservedEnvName } from '../agent/reproduction-boundary';
import type { ProcessRunner } from '../agent/process-runner';
import type { Logger } from '../logging/logger';
import type { AgentId, McpServerSkip, ReproductionMcp, ReproductionMcpServer } from '../ports/executor';
import type { ReproductionToolsSetting } from '../ports/settings-store';
import { CODEX_MCP_CONFIG_ARGS } from './mcp-servers';

/** Codex 목록·상세 명령을 기다리는 시간(밀리초). 이 명령은 stdio 서버를 띄우지 않는다. */
const CODEX_COMMAND_TIMEOUT_MS = 15_000;

/** Claude Code 정의의 변수 참조 `${NAME}`과 `${NAME:-기본값}`. 기본값이 있으면 값이 없어도 CLI가 펼친다. */
const CLAUDE_VARIABLE_REFERENCE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(:-[^}]*)?\}/g;

/** Codex 정의의 평문 헤더 값을 옮길 환경 변수 이름의 앞부분. 뒤에 번호가 붙는다. */
const HEADER_VARIABLE_PREFIX = 'STARDRAFT_MCP_HEADER_';

/** 실을 후보 서버 하나와 정의가 참조한 변수. */
interface Candidate extends ReproductionMcpServer {
  /** 값이 없으면 서버를 뺄 변수. */
  required: string[];
  /** 값이 없어도 되는 변수(기본값이 있는 참조). 값이 있으면 넘긴다. */
  optional: string[];
}

/** 실을 후보와 싣기 전에 뺀 서버. */
interface Candidates {
  /** 후보. */
  candidates: Candidate[];
  /** 뺀 서버. */
  skipped: McpServerSkip[];
}

/** 알 수 없는 값을 객체로 본다. 객체가 아니면 `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** 알 수 없는 값에서 문자열 목록만 꺼낸다. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** 방식과 켜 둔 서버로 이 서버를 실을지 본다. `직접 선택`이면 켠 서버만 싣는다. */
function chosen(tools: ReproductionToolsSetting, agent: AgentId, name: string): boolean {
  return tools.mode === 'auto' || (tools.enabledServers[agent] ?? []).includes(name);
}

/** 정의 안의 모든 문자열 값을 모은다. 키는 보지 않는다. */
function stringsIn(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  /** 객체. */
  const record = asRecord(value);
  return record ? Object.values(record).flatMap(stringsIn) : [];
}

/** Claude Code 정의가 참조한 변수. 같은 변수를 기본값 있이도, 없이도 참조하면 값이 꼭 있어야 한다. */
export function claudeVariableReferences(definition: Record<string, unknown>): { required: string[]; optional: string[] } {
  /** 값이 꼭 있어야 하는 변수. */
  const required = new Set<string>();
  /** 기본값이 있는 변수. */
  const optional = new Set<string>();
  for (const text of stringsIn(definition)) {
    for (const match of text.matchAll(CLAUDE_VARIABLE_REFERENCE)) {
      /** 변수 이름. */
      const name = match[1] as string;
      if (match[2] === undefined) required.add(name);
      else optional.add(name);
    }
  }
  return { required: [...required], optional: [...optional].filter((name) => !required.has(name)) };
}

/**
 * Claude Code가 이 저장소에서 쓸 MCP 서버를 고른다. 사용자 범위(`mcpServers`), 원본 저장소 경로의 로컬 범위(`projects[경로].mcpServers`),
 * 원본 저장소의 프로젝트 정의 파일(`.mcp.json`)을 CLI와 같은 순서(로컬 > 프로젝트 > 사용자)로 이름마다 하나만 쓴다.
 * 사용자가 CLI에서 꺼 둔 서버(`disabledMcpServers`, `disabledMcpjsonServers`)와 `직접 선택`에서 켜지 않은 서버는 "꺼 둠"으로 뺀다.
 * `직접 선택`이면 프로젝트 정의 파일은 읽지 않는다. 플러그인과 커넥터는 이 파일들에 없어 실리지 않는다.
 * @param config Claude Code 설정 파일(`~/.claude.json`)을 JSON으로 읽은 것. 없으면 `null`.
 * @param projectFile 원본 저장소의 `.mcp.json`을 JSON으로 읽은 것. 없으면 `null`.
 */
export function claudeCandidates(config: unknown, projectFile: unknown, sourceRoot: string, tools: ReproductionToolsSetting): Candidates {
  /** 설정 파일 전체. */
  const root = asRecord(config) ?? {};
  /** 원본 저장소의 로컬 범위 항목. */
  const project = asRecord(asRecord(root.projects)?.[sourceRoot]) ?? {};
  /** 꺼 둔 서버 이름. */
  const disabled = new Set([...stringList(project.disabledMcpServers), ...stringList(project.disabledMcpjsonServers)]);
  /** 이름 → 정의. 낮은 범위부터 담고 높은 범위가 덮는다. */
  const definitions = new Map<string, Record<string, unknown>>();
  /** 범위마다 서버 정의. 사용자 → 프로젝트 → 로컬 순서다. */
  const scopes = [asRecord(root.mcpServers), tools.mode === 'auto' ? asRecord(asRecord(projectFile)?.mcpServers) : null, asRecord(project.mcpServers)];
  for (const scope of scopes) {
    for (const [name, definition] of Object.entries(scope ?? {})) {
      /** 정의. */
      const record = asRecord(definition);
      if (record) definitions.set(name, record);
    }
  }

  /** 결과. */
  const result: Candidates = { candidates: [], skipped: [] };
  for (const [name, definition] of definitions) {
    if (disabled.has(name) || !chosen(tools, 'claude-code', name)) result.skipped.push({ name, reason: 'disabled' });
    else result.candidates.push({ name, definition, ...claudeVariableReferences(definition) });
  }
  return result;
}

/**
 * `codex mcp list --json` 출력에서 실을 서버 이름을 고른다. 꺼 둔 서버(`enabled: false`)와 `직접 선택`에서 켜지 않은 서버는 "꺼 둠"으로 뺀다.
 * 목록은 플러그인 MCP를 끄고 읽으므로(`CODEX_MCP_CONFIG_ARGS`) 사용자 설정 파일의 서버만 있다.
 */
export function codexServerNames(listJson: unknown, tools: ReproductionToolsSetting): { names: string[]; skipped: McpServerSkip[] } {
  /** 결과. */
  const result: { names: string[]; skipped: McpServerSkip[] } = { names: [], skipped: [] };
  for (const item of Array.isArray(listJson) ? listJson : []) {
    /** 서버 항목. */
    const server = asRecord(item);
    if (!server || typeof server.name !== 'string' || server.name === '') continue;
    if (server.enabled === false || !chosen(tools, 'codex', server.name)) result.skipped.push({ name: server.name, reason: 'disabled' });
    else result.names.push(server.name);
  }
  return result;
}

/** Codex `env_vars` 항목의 변수 이름. 문자열이거나 `name` 칸이 있는 표다. */
function envVarName(item: unknown): string | null {
  if (typeof item === 'string') return item;
  /** 표 항목. */
  const name = asRecord(item)?.name;
  return typeof name === 'string' ? name : null;
}

/**
 * `codex mcp get <이름> --json` 출력으로 인라인 정의를 만든다. 정의가 참조한 변수(`env_vars`, `bearer_token_env_var`, `env_http_headers`)는
 * 값이 꼭 있어야 한다. 평문 값(`env`, `http_headers`)은 명령줄에 싣지 않으려고 `values`에 옮기고 정의가 그 변수를 참조하게 바꾼다.
 * 헤더 값을 계산하는 명령(`http_headers_helper`)은 목록이 값을 가려 옮길 수 없어 넘기지 않는다. 사용자가 꺼 둔 도구와 고른 도구, 시간 상한은 그대로 둔다.
 * 연결 방식을 알 수 없으면 `null`.
 * @param nextHeaderVariable 평문 헤더 값을 옮길 새 변수 이름을 하나씩 내준다.
 */
export function codexCandidate(
  name: string,
  getJson: unknown,
  nextHeaderVariable: () => string,
): { candidate: Candidate; values: Record<string, string> } | null {
  /** 서버 상세. */
  const server = asRecord(getJson);
  /** 연결 방식. */
  const transport = asRecord(server?.transport);
  if (!server || !transport) return null;
  /** 만든 정의. */
  const definition: Record<string, unknown> = {};
  /** 평문 값을 옮긴 변수. */
  const values: Record<string, string> = {};
  /** 정의가 참조하는 변수(평문을 옮긴 것은 빼고). */
  const required: string[] = [];

  if (transport.type === 'stdio' && typeof transport.command === 'string') {
    definition.command = transport.command;
    definition.args = stringList(transport.args);
    if (typeof transport.cwd === 'string') definition.cwd = transport.cwd;
    /** 사용자가 넘기라고 적은 변수. */
    const passed = (Array.isArray(transport.env_vars) ? transport.env_vars : []).map(envVarName).filter((item) => item !== null);
    required.push(...passed);
    // 평문 값은 같은 이름의 변수로 프로세스 환경에 넣고, 서버가 그 변수를 물려받게 한다.
    for (const [key, value] of Object.entries(asRecord(transport.env) ?? {})) {
      if (typeof value === 'string') values[key] = value;
    }
    definition.env_vars = [...new Set([...passed, ...Object.keys(values)])];
  } else if (transport.type === 'streamable_http' && typeof transport.url === 'string') {
    definition.url = transport.url;
    if (typeof transport.bearer_token_env_var === 'string') {
      definition.bearer_token_env_var = transport.bearer_token_env_var;
      required.push(transport.bearer_token_env_var);
    }
    /** 헤더 → 변수 이름. */
    const envHeaders: Record<string, string> = {};
    for (const [header, variable] of Object.entries(asRecord(transport.env_http_headers) ?? {})) {
      if (typeof variable !== 'string') continue;
      envHeaders[header] = variable;
      required.push(variable);
    }
    // 평문 헤더 값은 새 변수로 옮기고 그 변수를 참조하는 헤더로 바꾼다.
    for (const [header, value] of Object.entries(asRecord(transport.http_headers) ?? {})) {
      if (typeof value !== 'string') continue;
      /** 옮길 변수 이름. */
      const variable = nextHeaderVariable();
      values[variable] = value;
      envHeaders[header] = variable;
    }
    if (Object.keys(envHeaders).length > 0) definition.env_http_headers = envHeaders;
  } else {
    return null;
  }

  for (const key of ['enabled_tools', 'disabled_tools'] as const) {
    if (Array.isArray(server[key])) definition[key] = stringList(server[key]);
  }
  for (const key of ['startup_timeout_sec', 'tool_timeout_sec'] as const) {
    if (typeof server[key] === 'number') definition[key] = server[key];
  }
  return { candidate: { name, definition, required: [...new Set(required)], optional: [] }, values };
}

/** 재현에 MCP를 싣는 데 필요한 것. */
export interface ReproductionMcpLoaderOptions {
  /** 재현 도구 권한. 실행마다 설정에서 새로 읽는다. */
  tools: () => Promise<ReproductionToolsSetting>;
  /** Claude Code 설정 파일(`~/.claude.json`)을 JSON으로 읽는다. 파일이 없으면 `null`. */
  readClaudeConfig: () => Promise<unknown | null>;
  /** 원본 저장소의 프로젝트 정의 파일(`.mcp.json`)을 JSON으로 읽는다. 파일이 없으면 `null`. */
  readProjectFile: (repoPath: string) => Promise<unknown | null>;
  /** 서버를 띄우지 않는 Codex 목록·상세 명령을 돌릴 프로세스 실행기. */
  runner: ProcessRunner;
  /** Codex CLI와 자식 환경. 아직 찾지 못했으면 `null`. */
  codexLaunch: () => { cliPath: string; env: Record<string, string> } | null;
  /** Codex 명령을 돌릴 작업 폴더. 저장소 안에서 돌리지 않는다. */
  cwd: string;
  /** 로그인 셸에서 변수 값을 읽는다. 찾지 못한 변수는 결과에 없다. */
  readVariables: (names: readonly string[]) => Promise<Record<string, string>>;
  /** 진단 로그. 서버 정의의 값과 오류 원문은 남기지 않는다. */
  logger: Logger;
}

/**
 * 재현하는 진단에 실을 MCP를 정한다. 실행할 때마다 실행하는 CLI 자신의 정의를 다시 읽는다(Claude Code는 설정 파일과 프로젝트 정의 파일,
 * Codex는 서버를 띄우지 않는 목록·상세 명령). 정의가 참조한 변수의 이름만 모아 로그인 셸에서 그 값을 읽고, 값을 찾지 못한 서버는 뺀다.
 * 정의와 값은 돌려주기만 하고 디스크와 로그에 남기지 않는다. 읽지 못하면 서버 없이 진행한다.
 */
export class ReproductionMcpLoader {
  constructor(private readonly options: ReproductionMcpLoaderOptions) {}

  /** `agent`로 `sourceRoot`의 사본에서 재현할 때 실을 MCP. */
  async load(agent: AgentId, sourceRoot: string): Promise<ReproductionMcp> {
    /** 재현 도구 권한. */
    const tools = await this.options.tools();
    /** 실을 후보와 평문 값을 옮긴 변수. */
    const { candidates, skipped, values } = agent === 'claude-code' ? { ...(await this.claude(sourceRoot, tools)), values: {} } : await this.codex(tools);
    if (candidates.length === 0) return { servers: [], env: {}, skipped };

    /** 로그인 셸에서 읽을 변수. 앱이 정하는 이름은 앱의 값을 쓴다. */
    const names = [...new Set(candidates.flatMap((candidate) => [...candidate.required, ...candidate.optional]))].filter((name) => !isReservedEnvName(name));
    /** 읽은 값. */
    const found = names.length === 0 ? {} : await this.options.readVariables(names);
    /** 결과. */
    const result: ReproductionMcp = { servers: [], env: {}, skipped: [...skipped] };
    for (const candidate of candidates) {
      if (candidate.required.some((name) => !isReservedEnvName(name) && found[name] === undefined)) {
        result.skipped.push({ name: candidate.name, reason: 'missing-variable' });
        continue;
      }
      /** 이 서버가 더할 변수. 참조한 변수의 값과 옮긴 평문 값이다. */
      const env: Record<string, string> = {};
      for (const name of [...candidate.required, ...candidate.optional]) if (found[name] !== undefined) env[name] = found[name];
      Object.assign(env, values[candidate.name] ?? {});
      // 앱이 정하는 변수나 다른 서버가 다른 값으로 쓴 변수와 겹치면 이 서버에는 그 값을 줄 수 없다.
      if (Object.entries(env).some(([name, value]) => isReservedEnvName(name) || (result.env[name] !== undefined && result.env[name] !== value))) {
        result.skipped.push({ name: candidate.name, reason: 'variable-conflict' });
        continue;
      }
      Object.assign(result.env, env);
      result.servers.push({ name: candidate.name, definition: candidate.definition });
    }
    this.options.logger.info('reproduction.mcp-resolved', { agent, loaded: result.servers.length, skipped: result.skipped.length });
    return result;
  }

  /** Claude Code의 후보. 설정 파일을 읽지 못하면 서버가 없다. */
  private async claude(sourceRoot: string, tools: ReproductionToolsSetting): Promise<Candidates> {
    try {
      /** 설정 파일. */
      const config = await this.options.readClaudeConfig();
      /** 프로젝트 정의 파일. `직접 선택`이면 읽지 않는다. */
      const projectFile = tools.mode === 'auto' ? await this.options.readProjectFile(sourceRoot).catch(() => null) : null;
      return claudeCandidates(config, projectFile, sourceRoot, tools);
    } catch {
      // 깨진 JSON의 오류 메시지에는 파일 내용 조각(환경 변수, 헤더)이 들어갈 수 있어 오류 원문은 남기지 않는다.
      this.options.logger.warn('reproduction.mcp-claude-config-unreadable');
      return { candidates: [], skipped: [] };
    }
  }

  /** Codex의 후보와 평문 값을 옮긴 변수(서버 이름 → 변수). 목록을 읽지 못하면 서버가 없다. */
  private async codex(tools: ReproductionToolsSetting): Promise<Candidates & { values: Record<string, Record<string, string>> }> {
    /** 결과. */
    const result: Candidates & { values: Record<string, Record<string, string>> } = { candidates: [], skipped: [], values: {} };
    /** Codex CLI와 자식 환경. */
    const launch = this.options.codexLaunch();
    if (!launch) return result;
    /** 목록. */
    const list = await this.codexJson(launch, ['mcp', 'list', '--json']);
    if (list === undefined) {
      this.options.logger.warn('reproduction.mcp-codex-list-failed');
      return result;
    }
    /** 실을 이름과 꺼 둔 서버. */
    const { names, skipped } = codexServerNames(list, tools);
    result.skipped.push(...skipped);
    /** 서버마다 상세. 목록에는 사용자가 꺼 둔 도구가 없어 상세를 읽는다. */
    const details = await Promise.all(names.map(async (name) => [name, await this.codexJson(launch, ['mcp', 'get', name, '--json'])] as const));
    /** 다음 헤더 변수 번호. */
    let headerIndex = 0;
    for (const [name, detail] of details) {
      /** 만든 후보. */
      const built = detail === undefined ? null : codexCandidate(name, detail, () => `${HEADER_VARIABLE_PREFIX}${String(++headerIndex)}`);
      if (!built) {
        result.skipped.push({ name, reason: 'unreadable' });
        continue;
      }
      result.candidates.push(built.candidate);
      result.values[name] = built.values;
    }
    return result;
  }

  /** Codex 명령을 플러그인 MCP를 끈 채 돌려 JSON 출력을 읽는다. 실패하면 `undefined`. 출력에는 평문 값이 있어 남기지 않는다. */
  private async codexJson(launch: { cliPath: string; env: Record<string, string> }, args: string[]): Promise<unknown> {
    /** 명령 결과. */
    const result = await this.options.runner.run({
      command: launch.cliPath,
      args: [...args, ...CODEX_MCP_CONFIG_ARGS],
      env: launch.env,
      cwd: this.options.cwd,
      timeoutMs: CODEX_COMMAND_TIMEOUT_MS,
    });
    if (result.kind !== 'exited' || result.exitCode !== 0) return undefined;
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      return undefined;
    }
  }
}
