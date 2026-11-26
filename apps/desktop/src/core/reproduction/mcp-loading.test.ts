import { describe, expect, it } from 'vitest';
import { exited, FakeProcessRunner } from '../fakes/fake-process-runner';
import type { LogFields, Logger } from '../logging/logger';
import type { ReproductionToolsSetting } from '../ports/settings-store';
import { ReproductionMcpLoader } from './mcp-loading';

/** 테스트용 가짜 비밀 값. 로그에 나오면 안 된다. */
const SECRET = 'FAKE-SECRET-VALUE-71c2';
/** 원본 저장소. */
const SOURCE = '/fake/work/web-app';
/** 가짜 Codex CLI. */
const CODEX = '/fake/bin/codex';
/** 플러그인 MCP를 끄는 설정. */
const PLUGINS_OFF = ['-c', 'features.plugins=false'];

/** 자동 방식. */
const AUTO: ReproductionToolsSetting = { mode: 'auto', enabledServers: {} };

/** 가짜 Claude Code 설정 파일. 사용자 범위 넷, 원본 저장소의 로컬 범위 둘(이름 겹침 포함), 다른 저장소의 로컬 범위 하나. */
const CLAUDE_CONFIG = {
  mcpServers: {
    playwright: { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'] },
    docs: { type: 'http', url: 'https://fake.example/mcp', headers: { Authorization: 'Bearer ${DOCS_TOKEN}' } },
    shared: { command: 'user-version' },
    off: { command: 'off-server' },
    'with-default': { command: 'node', args: ['${SERVER_DIR:-/opt/server}/index.js'], env: { MODE: '${MODE:-dev}', KEY: SECRET } },
  },
  projects: {
    [SOURCE]: {
      mcpServers: { shared: { command: 'local-version' }, 'local-only': { type: 'sse', url: 'https://fake.example/sse' } },
      disabledMcpServers: ['off'],
      disabledMcpjsonServers: ['rejected-project'],
    },
    '/fake/work/other': { mcpServers: { 'other-local': { command: 'x' } } },
  },
};

/** 가짜 원본 저장소의 `.mcp.json`. 프로젝트 범위는 사용자 범위를 덮고 로컬 범위에 진다. */
const PROJECT_FILE = {
  mcpServers: {
    playwright: { command: 'project-playwright' },
    shared: { command: 'project-version' },
    'project-only': { command: 'p' },
    'rejected-project': { command: 'r' },
  },
};

/** 가짜 로거. 남긴 필드를 모은다. */
function fakeLogger(): Logger & { lines: { event: string; fields: LogFields | undefined }[] } {
  const lines: { event: string; fields: LogFields | undefined }[] = [];
  const log = (event: string, fields?: LogFields) => lines.push({ event, fields });
  return { lines, info: log, warn: log, error: log };
}

/** 가짜 싣기 모듈. 로그인 셸에는 `variables`만 있다. */
function setup(options: { tools?: ReproductionToolsSetting; claudeConfig?: unknown; projectFile?: unknown; variables?: Record<string, string>; codex?: boolean } = {}) {
  const runner = new FakeProcessRunner();
  const logger = fakeLogger();
  /** 로그인 셸에서 읽으라고 한 변수 이름. */
  const readNames: string[][] = [];
  /** 프로젝트 정의 파일을 읽은 저장소. */
  const projectReads: string[] = [];
  const loader = new ReproductionMcpLoader({
    tools: async () => options.tools ?? AUTO,
    readClaudeConfig: async () => (options.claudeConfig === undefined ? CLAUDE_CONFIG : options.claudeConfig),
    readProjectFile: async (path) => {
      projectReads.push(path);
      return options.projectFile === undefined ? PROJECT_FILE : options.projectFile;
    },
    runner,
    codexLaunch: () => (options.codex === false ? null : { cliPath: CODEX, env: { PATH: '/fake/bin' } }),
    cwd: '/fake/app-data',
    readVariables: async (names) => {
      readNames.push([...names]);
      return Object.fromEntries(names.flatMap((name) => (options.variables?.[name] === undefined ? [] : [[name, options.variables[name]]])));
    },
    logger,
  });
  return { loader, runner, logger, readNames, projectReads };
}

describe('재현 MCP 싣기: Claude Code', () => {
  it('사용자·로컬·프로젝트 범위를 로컬 > 프로젝트 > 사용자 순서로 하나씩 싣고, CLI에서 꺼 둔 서버는 "꺼 둠"으로 뺀다. 다른 저장소의 로컬 범위는 보지 않는다', async () => {
    const { loader, projectReads } = setup({ variables: { DOCS_TOKEN: 'fake-docs-token' } });

    const mcp = await loader.load('claude-code', SOURCE);

    expect(mcp.servers).toEqual([
      { name: 'playwright', definition: { command: 'project-playwright' } },
      { name: 'docs', definition: CLAUDE_CONFIG.mcpServers.docs },
      { name: 'shared', definition: { command: 'local-version' } },
      { name: 'with-default', definition: CLAUDE_CONFIG.mcpServers['with-default'] },
      { name: 'project-only', definition: { command: 'p' } },
      { name: 'local-only', definition: { type: 'sse', url: 'https://fake.example/sse' } },
    ]);
    expect(mcp.skipped).toEqual([
      { name: 'off', reason: 'disabled' },
      { name: 'rejected-project', reason: 'disabled' },
    ]);
    expect(projectReads).toEqual([SOURCE]);
  });

  it('정의가 참조한 변수의 이름만 로그인 셸에서 읽어 실행 환경에 더하고, 기본값 없는 참조의 값을 찾지 못한 서버는 "변수 없음"으로 뺀다', async () => {
    const { loader, readNames } = setup({ variables: { MODE: 'test' } });

    const mcp = await loader.load('claude-code', SOURCE);

    expect(readNames).toEqual([['DOCS_TOKEN', 'SERVER_DIR', 'MODE']]);
    expect(mcp.servers.map((server) => server.name)).not.toContain('docs');
    expect(mcp.skipped).toContainEqual({ name: 'docs', reason: 'missing-variable' });
    // 기본값이 있는 참조는 값이 없어도 싣고, 값이 있으면 넘긴다.
    expect(mcp.servers.map((server) => server.name)).toContain('with-default');
    expect(mcp.env).toEqual({ MODE: 'test' });
  });

  it('앱이 정하는 변수(PATH, HOME 등)를 참조하면 로그인 셸에서 다시 읽지 않는다', async () => {
    const { loader, readNames } = setup({ claudeConfig: { mcpServers: { a: { command: '${HOME}/bin/a', env: { P: '${PATH}' } } } }, projectFile: null });

    const mcp = await loader.load('claude-code', SOURCE);

    expect(readNames).toEqual([]);
    expect(mcp.servers.map((server) => server.name)).toEqual(['a']);
    expect(mcp.env).toEqual({});
  });

  it('`직접 선택`이면 켠 서버만 싣고, 저장소의 프로젝트 정의 파일은 읽지도 싣지도 않는다', async () => {
    const { loader, projectReads } = setup({
      tools: { mode: 'manual', enabledServers: { 'claude-code': ['playwright', 'shared', 'project-only', 'off'], codex: ['docs'] } },
    });

    const mcp = await loader.load('claude-code', SOURCE);

    // 프로젝트 범위가 빠지므로 playwright는 사용자 범위 정의다. 같은 이름의 Codex 서버를 켠 것은 상관없다.
    expect(mcp.servers).toEqual([
      { name: 'playwright', definition: CLAUDE_CONFIG.mcpServers.playwright },
      { name: 'shared', definition: { command: 'local-version' } },
    ]);
    expect(mcp.skipped).toEqual([
      { name: 'docs', reason: 'disabled' },
      { name: 'off', reason: 'disabled' },
      { name: 'with-default', reason: 'disabled' },
      { name: 'local-only', reason: 'disabled' },
    ]);
    expect(projectReads).toEqual([]);
  });

  it('설정 파일이 없거나 읽지 못하면 서버 없이 진행하고, 오류 원문은 로그에 남기지 않는다', async () => {
    const empty = setup({ claudeConfig: null, projectFile: null });
    expect(await empty.loader.load('claude-code', SOURCE)).toEqual({ servers: [], env: {}, skipped: [] });

    const broken = setup();
    // 깨진 JSON의 오류 메시지에 들어 있을 파일 조각을 흉내 낸다.
    (broken.loader as unknown as { options: { readClaudeConfig: () => Promise<unknown> } }).options.readClaudeConfig = async () => {
      throw new SyntaxError(`Unexpected token in JSON at "${SECRET}"`);
    };
    expect(await broken.loader.load('claude-code', SOURCE)).toEqual({ servers: [], env: {}, skipped: [] });
    expect(JSON.stringify(broken.logger.lines)).not.toContain(SECRET);
  });
});

/** 가짜 `codex mcp list --json` 출력. */
const CODEX_LIST = [
  { name: 'playwright', enabled: true, transport: { type: 'stdio', command: 'npx', args: ['@playwright/mcp'], env: { API_KEY: SECRET }, env_vars: ['PW_TOKEN'], cwd: null } },
  { name: 'remote', enabled: true, transport: { type: 'streamable_http', url: 'https://fake.example/mcp' } },
  { name: 'off', enabled: false, transport: { type: 'stdio', command: 'off' } },
];

/** 가짜 `codex mcp get <이름> --json` 출력. */
const CODEX_DETAILS: Record<string, unknown> = {
  playwright: {
    name: 'playwright',
    enabled: true,
    transport: { type: 'stdio', command: 'npx', args: ['@playwright/mcp'], env: { API_KEY: SECRET }, env_vars: ['PW_TOKEN', 'HOME'], cwd: null },
    enabled_tools: null,
    disabled_tools: ['browser_close'],
    startup_timeout_sec: 30,
    tool_timeout_sec: null,
  },
  remote: {
    name: 'remote',
    enabled: true,
    transport: {
      type: 'streamable_http',
      url: 'https://fake.example/mcp',
      bearer_token_env_var: 'REMOTE_TOKEN',
      http_headers: { 'X-Api-Key': SECRET },
      env_http_headers: { 'X-Team': 'TEAM_ID' },
      http_headers_helper: null,
    },
    enabled_tools: ['search'],
    disabled_tools: null,
  },
};

/** Codex 목록과 상세 명령에 대답한다. */
function answerCodex(runner: FakeProcessRunner, details: Record<string, unknown> = CODEX_DETAILS): void {
  runner.respond(CODEX, ['mcp', 'list', '--json', ...PLUGINS_OFF], exited(0, JSON.stringify(CODEX_LIST)));
  for (const [name, detail] of Object.entries(details)) runner.respond(CODEX, ['mcp', 'get', name, '--json', ...PLUGINS_OFF], exited(0, JSON.stringify(detail)));
}

describe('재현 MCP 싣기: Codex', () => {
  it('플러그인 MCP를 끈 목록·상세 명령으로 사용자 설정의 서버를 읽고, 꺼 둔 서버는 "꺼 둠"으로 뺀다', async () => {
    const { loader, runner } = setup({ variables: { PW_TOKEN: 'fake-pw', REMOTE_TOKEN: 'fake-remote', TEAM_ID: 'fake-team' } });
    answerCodex(runner);

    const mcp = await loader.load('codex', SOURCE);

    expect(mcp.servers.map((server) => server.name)).toEqual(['playwright', 'remote']);
    expect(mcp.skipped).toEqual([{ name: 'off', reason: 'disabled' }]);
    expect(runner.requests.map((request) => [request.args, request.cwd])).toEqual([
      [['mcp', 'list', '--json', ...PLUGINS_OFF], '/fake/app-data'],
      [['mcp', 'get', 'playwright', '--json', ...PLUGINS_OFF], '/fake/app-data'],
      [['mcp', 'get', 'remote', '--json', ...PLUGINS_OFF], '/fake/app-data'],
    ]);
  });

  it('정의의 평문 값은 프로세스 환경으로 옮기고 정의는 그 변수를 참조하게 바꾼다. 참조한 변수의 값은 로그인 셸에서 읽어 더한다', async () => {
    const { loader, runner, readNames } = setup({ variables: { PW_TOKEN: 'fake-pw', REMOTE_TOKEN: 'fake-remote', TEAM_ID: 'fake-team' } });
    answerCodex(runner);

    const mcp = await loader.load('codex', SOURCE);

    expect(mcp.servers).toEqual([
      {
        name: 'playwright',
        definition: { command: 'npx', args: ['@playwright/mcp'], env_vars: ['PW_TOKEN', 'HOME', 'API_KEY'], disabled_tools: ['browser_close'], startup_timeout_sec: 30 },
      },
      {
        // 이름과 주소는 그대로다. Codex는 저장한 OAuth 로그인을 서버 이름과 주소로 찾는다.
        name: 'remote',
        definition: {
          url: 'https://fake.example/mcp',
          bearer_token_env_var: 'REMOTE_TOKEN',
          env_http_headers: { 'X-Team': 'TEAM_ID', 'X-Api-Key': 'STARDRAFT_MCP_HEADER_1' },
          enabled_tools: ['search'],
        },
      },
    ]);
    expect(JSON.stringify(mcp.servers)).not.toContain(SECRET);
    expect(mcp.env).toEqual({ PW_TOKEN: 'fake-pw', API_KEY: SECRET, REMOTE_TOKEN: 'fake-remote', TEAM_ID: 'fake-team', STARDRAFT_MCP_HEADER_1: SECRET });
    // HOME은 앱이 정하는 변수라 다시 읽지 않는다.
    expect(readNames).toEqual([['PW_TOKEN', 'REMOTE_TOKEN', 'TEAM_ID']]);
  });

  it('참조한 변수를 찾지 못한 서버는 "변수 없음", 상세를 읽지 못한 서버는 "읽지 못함"으로 뺀다', async () => {
    const { loader, runner } = setup({ variables: { REMOTE_TOKEN: 'fake-remote', TEAM_ID: 'fake-team' } });
    answerCodex(runner, { playwright: CODEX_DETAILS.playwright });

    const mcp = await loader.load('codex', SOURCE);

    expect(mcp.servers).toEqual([]);
    expect(mcp.skipped).toEqual([
      { name: 'off', reason: 'disabled' },
      { name: 'remote', reason: 'unreadable' },
      { name: 'playwright', reason: 'missing-variable' },
    ]);
    expect(mcp.env).toEqual({});
  });

  it('평문 값이 앱이 정하는 변수나 다른 서버의 값과 겹치면 그 서버는 "변수 충돌"로 뺀다', async () => {
    const { loader, runner } = setup({ variables: { PW_TOKEN: 'fake-pw', REMOTE_TOKEN: 'fake-remote', TEAM_ID: 'fake-team' } });
    answerCodex(runner, {
      ...CODEX_DETAILS,
      remote: { name: 'remote', transport: { type: 'stdio', command: 'r', env: { API_KEY: 'other-value' } } },
    });
    runner.respond(CODEX, ['mcp', 'list', '--json', ...PLUGINS_OFF], exited(0, JSON.stringify([...CODEX_LIST, { name: 'path-env', enabled: true, transport: { type: 'stdio', command: 'p' } }])));
    runner.respond(CODEX, ['mcp', 'get', 'path-env', '--json', ...PLUGINS_OFF], exited(0, JSON.stringify({ name: 'path-env', transport: { type: 'stdio', command: 'p', env: { PATH: '/x' } } })));

    const mcp = await loader.load('codex', SOURCE);

    expect(mcp.servers.map((server) => server.name)).toEqual(['playwright']);
    expect(mcp.skipped).toEqual([
      { name: 'off', reason: 'disabled' },
      { name: 'remote', reason: 'variable-conflict' },
      { name: 'path-env', reason: 'variable-conflict' },
    ]);
  });

  it('`직접 선택`이면 Codex에서 켠 서버만 싣는다', async () => {
    const { loader, runner } = setup({ tools: { mode: 'manual', enabledServers: { codex: ['remote'], 'claude-code': ['playwright'] } }, variables: { REMOTE_TOKEN: 'r', TEAM_ID: 't' } });
    answerCodex(runner);

    const mcp = await loader.load('codex', SOURCE);

    expect(mcp.servers.map((server) => server.name)).toEqual(['remote']);
    expect(mcp.skipped).toEqual([
      { name: 'playwright', reason: 'disabled' },
      { name: 'off', reason: 'disabled' },
    ]);
  });

  it('Codex를 찾지 못했거나 목록 명령이 실패하면 서버 없이 진행하고, 출력의 평문 값은 로그에 남기지 않는다', async () => {
    expect(await setup({ codex: false }).loader.load('codex', SOURCE)).toEqual({ servers: [], env: {}, skipped: [] });

    const { loader, runner, logger } = setup();
    runner.respond(CODEX, ['mcp', 'list', '--json', ...PLUGINS_OFF], exited(1, `{"env":"${SECRET}"}`, SECRET));
    expect(await loader.load('codex', SOURCE)).toEqual({ servers: [], env: {}, skipped: [] });
    expect(JSON.stringify(logger.lines)).not.toContain(SECRET);
  });
});
