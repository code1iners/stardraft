import { mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type {
  AgentId,
  Executor,
  ExecutorFailureReason,
  ExecutorOutcome,
  ExecutorProgress,
  ExecutorReport,
  ExecutorRunRequest,
  ExecutorUsage,
  ReproductionMcp,
  RunKind,
} from '../ports/executor';
import { DENIED_TOOL_SERVERS } from '../reproduction/denied-tools';
import type { AgentExecutorOptions } from './agent-launch';
import { withoutAgentApiKeys } from './cli-discovery';
import { asRecord, failedOutcome, numberOrNull, parseJsonObject } from './executor-output';
import { describeCodexCommand, type CodexCommand } from './codex-commands';
import type { ProcessResult } from './process-runner';
import { LISTING_FILES_STEP, readingFileStep, runningCommandStep, searchingStep } from './progress-steps';
import { copySecretPatterns, ENV_FILE_PATTERNS, PERSONAL_SECRET_PATHS, reproductionEnv } from './reproduction-boundary';
import { withDefaultSecretPatterns } from './secret-patterns';

/** 실행 계약이 인라인으로 정의하는 Codex 권한 프로필의 이름. */
const PERMISSION_PROFILE = 'stardraft';

/**
 * Codex 실행기. 에이전트 실행 계약의 필수 플래그 묶음으로 `codex exec`를 띄우고, `--json` JSONL 이벤트에서 결과를 읽는다.
 * macOS에서만 쓴다. `--sandbox` 대신 권한 프로필을 인라인으로 정의해 읽기 범위와 비밀 파일을 막는다.
 */
export class CodexExecutor implements Executor {
  /** 이 실행기가 부르는 에이전트. */
  readonly agent: AgentId = 'codex';

  constructor(private readonly options: AgentExecutorOptions) {}

  async run(request: ExecutorRunRequest): Promise<ExecutorReport> {
    /** 실행 결과와 실행에서 본 CLI 버전·모델·사용량. */
    const report = await this.execute(request);
    this.options.onRunFinished?.({ kind: request.kind, ...report });
    return report;
  }

  /** 링크를 풀고 스키마 파일을 쓴 뒤 CLI를 띄워 결과를 분류한다. 스키마 파일은 끝나면 지운다. */
  private async execute(request: ExecutorRunRequest): Promise<ExecutorReport> {
    /** 띄울 CLI와 환경. */
    const launch = this.options.launch();
    if (!launch) return { outcome: failedOutcome('cli-missing', 'Codex CLI를 아직 찾지 못했습니다.'), cliVersion: null, model: null, usage: null };
    /** `-C`와 cwd가 될 첫 루트와 `workspace_roots`로 넘길 나머지. */
    const [cwd, ...extraRoots] = request.readRoots;
    if (cwd === undefined) throw new Error('읽을 디렉터리가 없습니다.');

    // 심볼릭 링크로 띄우면 세션이 만들어지지 않는다. 실제 경로는 버전마다 바뀌므로 실행할 때마다 푼다.
    /** CLI의 실제 경로. 풀 수 없으면 파일이 지워진 것이다. */
    const realCli = await realpath(launch.cliPath).catch(() => null);
    if (realCli === null) return { outcome: failedOutcome('cli-missing', `${launch.cliPath}를 찾을 수 없습니다.`), cliVersion: null, model: null, usage: null };

    /** 이번 실행의 임시 폴더. */
    const tempDir = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), 'stardraft-run-'));
    try {
      /** `--output-schema`로 넘길 스키마 파일. */
      const schemaFile = join(tempDir, 'schema.json');
      await writeFile(schemaFile, JSON.stringify(request.outputSchema), 'utf8');

      /** JSONL을 읽는 쪽. */
      const reader = new CodexEventReader(request.onProgress);
      /** 재현 경계로 도는지 여부. */
      const reproducing = request.reproduction != null;
      /** 실을 MCP. 서버가 없으면 `null`. */
      const mcp = reproducing && (request.reproduction?.mcp?.servers.length ?? 0) > 0 ? request.reproduction!.mcp! : null;
      /** 프로세스 결과. */
      const raw = await this.options.runner.run({
        command: realCli,
        args: reproducing
          ? codexReproductionArgs(request, { schemaFile, cwd }, mcp)
          : codexRunArgs(request, { realCli, schemaFile, cwd, extraRoots, skipGitRepoCheck: await needsGitRepoCheckSkip(request.kind, cwd) }),
        // 정의의 평문 값과 참조한 변수는 프로세스 환경으로 넘긴다. MCP 연결 실패는 이벤트에 나오지 않아 MCP 로그만 표준 오류로 받는다.
        env: reproducing
          ? { ...(mcp?.env ?? {}), ...reproductionEnv(withoutAgentApiKeys(launch.env)), ...(mcp ? { RUST_LOG: MCP_LOG_FILTER } : {}) }
          : withoutAgentApiKeys(launch.env),
        cwd,
        timeoutMs: request.timeoutMs,
        stdin: request.input,
        onStdoutLine: (line) => reader.push(line),
        signal: request.signal,
        // MCP 서버와 셸 명령은 CLI와 다른 프로세스 그룹이라 CLI 그룹만 끝내면 남는다.
        ...(reproducing ? { killDescendants: true } : {}),
      });
      /** MCP 로그를 걷어 낸 결과와 연결하지 못한 서버. 로그 줄은 오류 원문에 넣지 않는다. */
      const { result, failedServers } = mcp ? withoutMcpLog(raw) : { result: raw, failedServers: [] };
      // Codex의 이벤트는 버전과 모델을 알려 주지 않는다. 버전은 실행 직전 확인이 읽은 것이고, 모델은 넘긴 것이다.
      return {
        outcome: classifyCodexRun(result, reader),
        cliVersion: launch.version,
        model: request.model,
        usage: reader.usage,
        ...(mcp ? { mcpFailedServers: mcp.servers.map((server) => server.name).filter((name) => failedServers.includes(name)) } : {}),
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * `--json` JSONL 줄을 받아 앱이 쓰는 값만 모으고, 명령 이벤트를 진행 단계로 알린다. JSON이 아닌 줄은 건너뛴다.
 * 읽은 파일 수는 읽기 명령이 종료 코드 0으로 끝났을 때 센다. 샌드박스가 막은 읽기는 실제 CLI가 이벤트를 내지 않는다.
 */
class CodexEventReader {
  /** 마지막 에이전트 메시지. `--output-schema`를 주면 스키마에 맞는 JSON 문자열이다. */
  lastMessage: string | null = null;
  /** 턴이 실패했으면 그 오류 문장. */
  turnFailure: string | null = null;
  /** 마지막 오류 이벤트의 문장. 다시 시도할 오류도 들어 있다. */
  lastError: string | null = null;
  /** 마지막 `turn.completed`가 알려 준 토큰 수. 비용은 알려 주지 않는다. */
  usage: ExecutorUsage | null = null;
  /** 읽기에 성공한 파일. 같은 파일은 한 번만 센다. */
  private readonly filesRead = new Set<string>();
  /** 마지막으로 알린 진행 단계. 읽은 파일 수만 바뀔 때 같은 단계로 다시 알린다. */
  private lastStep: string | null = null;

  /** `onProgress`는 명령을 띄울 때와 읽은 파일 수가 늘 때마다 진행 단계로 부른다. */
  constructor(private readonly onProgress: (progress: ExecutorProgress) => void) {}

  /** 표준 출력 한 줄을 읽는다. */
  push(line: string): void {
    /** JSON으로 푼 이벤트. */
    const event = parseJsonObject(line);
    if (!event) return;
    /** 이벤트의 항목. */
    const item = asRecord(event.item);
    if (event.type === 'item.started' && item?.type === 'command_execution' && typeof item.command === 'string') {
      this.lastStep = commandStep(describeCodexCommand(item.command));
      this.onProgress({ step: this.lastStep, filesRead: this.filesRead.size });
    } else if (event.type === 'item.completed' && item?.type === 'command_execution' && typeof item.command === 'string') {
      if (item.exit_code === 0) this.countReadFiles(describeCodexCommand(item.command));
    } else if (event.type === 'item.completed' && item?.type === 'agent_message' && typeof item.text === 'string') {
      this.lastMessage = item.text;
    } else if (event.type === 'turn.completed') {
      /** 토큰 수. */
      const tokens = asRecord(event.usage) ?? {};
      this.usage = { costUsd: null, inputTokens: numberOrNull(tokens.input_tokens), outputTokens: numberOrNull(tokens.output_tokens) };
    } else if (event.type === 'turn.failed') {
      /** 턴 실패 문장. */
      const message = asRecord(event.error)?.message;
      this.turnFailure = typeof message === 'string' ? message : '';
    } else if (event.type === 'error' && typeof event.message === 'string') {
      this.lastError = event.message;
    }
  }

  /** 끝난 읽기 명령의 파일을 센다. 처음 읽은 파일이 있으면 마지막 단계로 다시 알린다. */
  private countReadFiles(command: CodexCommand): void {
    if (command.kind !== 'read') return;
    /** 세기 전의 수. */
    const before = this.filesRead.size;
    for (const file of command.files) this.filesRead.add(file);
    if (this.filesRead.size > before && this.lastStep !== null) this.onProgress({ step: this.lastStep, filesRead: this.filesRead.size });
  }
}

/** 명령 하나의 진행 단계. */
function commandStep(command: CodexCommand): string {
  switch (command.kind) {
    case 'read':
      return readingFileStep(command.files[0] as string);
    case 'search':
      return searchingStep(command.query);
    case 'list':
      return LISTING_FILES_STEP;
    case 'other':
      return runningCommandStep(command.text);
  }
}

/** 인수 묶음에 넣을 경로들. */
interface RunPaths {
  /** 링크를 푼 CLI 실제 경로. 프로필에서 이 파일만 읽기 허용한다. */
  realCli: string;
  /** 출력 스키마 파일. */
  schemaFile: string;
  /** 첫 루트. */
  cwd: string;
  /** 둘째 루트부터. */
  extraRoots: readonly string[];
  /** `--skip-git-repo-check`를 붙일지 여부. */
  skipGitRepoCheck: boolean;
}

/**
 * `--skip-git-repo-check`를 붙일지 정한다. Codex는 git 저장소 밖의 첫 루트에서 실행을 거부한다.
 * 점검 실행(앱 전용 빈 폴더)은 git 저장소가 아닌 폴더에서 돌므로 늘 붙인다.
 * 초안 실행과 진단 실행은 첫 저장소가 git 저장소 안이면 붙이지 않고, 저장소 매핑이 받는 git이 아닌 코드 폴더일 때만 붙인다.
 */
async function needsGitRepoCheckSkip(kind: RunKind, cwd: string): Promise<boolean> {
  return kind === 'check' || !(await isInsideGitRepo(cwd));
}

/** `dir`이나 그 위 폴더에 `.git`(폴더, 또는 worktree·서브모듈의 파일)이 있는지 본다. Codex가 git 저장소를 찾는 방식과 같다. */
async function isInsideGitRepo(dir: string): Promise<boolean> {
  for (let current = dir; ; current = dirname(current)) {
    if (await stat(join(current, '.git')).then(() => true, () => false)) return true;
    if (dirname(current) === current) return false;
  }
}

/**
 * 실행 계약의 필수 플래그 묶음. 빼거나 바꿀 수 없다(0.162.1·0.163.0에서 실측).
 * 권한 프로필은 시스템 경로(`:minimal`)와 CLI 실제 경로만 읽기, `/tmp`는 막고, 넘긴 루트 아래는 읽기에 비밀 파일과 `.git`을 막는다.
 */
function codexRunArgs(request: ExecutorRunRequest, paths: RunPaths): string[] {
  /** 루트 아래에서 막을 비밀 파일 규칙. 요청이 기본 목록을 빠뜨려도 늘 넣는다. */
  const denyRules = [...new Set(withDefaultSecretPatterns(request.secretPatterns).map(anyDepthPattern))].map((pattern) => `${tomlString(pattern)}="deny"`);
  /** 읽기 범위와 비밀 파일 deny를 담은 파일 시스템 권한. */
  const filesystem = `{":minimal"="read", ${tomlString(paths.realCli)}="read", ":slash_tmp"="deny", ":tmpdir"="deny", ":workspace_roots"={"."="read", ${denyRules.join(', ')}, ".git"="deny"}}`;
  /** 둘째 루트부터 더하는 작업 루트. */
  const workspaceRoots = `{${paths.extraRoots.map((dir) => `${tomlString(dir)}=true`).join(', ')}}`;
  return [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--json',
    '--output-schema',
    paths.schemaFile,
    '-C',
    paths.cwd,
    ...(paths.skipGitRepoCheck ? ['--skip-git-repo-check'] : []),
    '-c',
    'web_search="disabled"',
    // ChatGPT 앱 도구(메일 발송, 원격 쓰기, 웹 검색)가 모델에 넘어가지 않게 한다.
    '-c',
    'features.apps=false',
    '-c',
    'features.hooks=false',
    '-c',
    'features.multi_agent=false',
    '-c',
    'features.goals=false',
    '-c',
    `default_permissions="${PERMISSION_PROFILE}"`,
    '-c',
    `permissions.${PERMISSION_PROFILE}.filesystem=${filesystem}`,
    '-c',
    `permissions.${PERMISSION_PROFILE}.workspace_roots=${workspaceRoots}`,
    '-c',
    `developer_instructions=${tomlString(request.instructions)}`,
    ...(request.model === null ? [] : ['-m', request.model]),
    // 입력은 표준 입력으로 넘긴다.
    '-',
  ];
}

/** Codex MCP 연결 실패만 표준 오류에 찍게 하는 로그 설정(0.172.0 실측: `WARN codex_mcp::rmcp_client: MCP server startup failed server_name="..."`). */
const MCP_LOG_FILTER = 'codex_mcp=warn';

/** MCP 로그 줄. */
const MCP_LOG_LINE = /^\S+\s+\w+\s+codex_mcp::/;

/** MCP 시작에 실패한 서버의 이름을 담은 로그. */
const MCP_STARTUP_FAILED = /MCP server startup failed server_name="((?:[^"\\]|\\.)*)"/;

/** 고정 deny 목록의 모든 도구. 실은 모든 서버의 비활성 도구에 넣는다. */
const FIXED_DENIED_TOOLS: readonly string[] = [...new Set(DENIED_TOOL_SERVERS.flatMap((server) => server.tools))];

/** 표준 오류에서 MCP 로그 줄을 걷어 내고, 시작에 실패한 서버 이름을 모은다. 로그의 오류 문장에는 서버가 낸 글이 들 수 있다. */
function withoutMcpLog(result: ProcessResult): { result: ProcessResult; failedServers: string[] } {
  if (result.kind === 'spawn-failed') return { result, failedServers: [] };
  /** 실패한 서버. */
  const failedServers = new Set<string>();
  /** MCP 로그가 아닌 줄. */
  const kept: string[] = [];
  for (const line of result.stderr.split('\n')) {
    if (!MCP_LOG_LINE.test(line)) {
      kept.push(line);
      continue;
    }
    /** 실패한 서버 이름. */
    const name = MCP_STARTUP_FAILED.exec(line)?.[1];
    if (name !== undefined) failedServers.add(name.replace(/\\(.)/g, '$1'));
  }
  return { result: { ...result, stderr: kept.join('\n') }, failedServers: [...failedServers] };
}

/**
 * 실을 MCP 서버를 인라인 설정 하나로 쓴다. 사용자 설정을 무시하므로 프로필·설정 파일이 아니라 `-c`로만 넘길 수 있다.
 * 서버 이름에 `.`이 있어도 되게 `mcp_servers` 표 전체를 값으로 넘긴다. 이름과 주소는 그대로 둬 Codex가 저장한 로그인을 찾게 한다.
 * 실은 서버마다 도구 승인을 자동 허용으로 둔다(`exec`의 승인 정책이 `never`라 승인이 필요한 도구는 거부된다).
 * 고정 deny 목록 전체를 사용자가 적어 둔 비활성 도구와 합쳐 모든 서버의 비활성 도구로 넣는다.
 */
function codexMcpArgs(mcp: ReproductionMcp): string[] {
  /** 서버 이름 → 인라인 정의. */
  const servers = Object.fromEntries(
    mcp.servers.map((server) => {
      /** 사용자가 꺼 둔 도구. */
      const userDisabled = Array.isArray(server.definition.disabled_tools) ? server.definition.disabled_tools.filter((tool) => typeof tool === 'string') : [];
      return [server.name, { ...server.definition, default_tools_approval_mode: 'approve', disabled_tools: [...new Set([...userDisabled, ...FIXED_DENIED_TOOLS])] }];
    }),
  );
  /** 넘긴 변수 이름. 셸 명령에는 보이지 않게 한다. */
  const passed = Object.keys(mcp.env);
  return [
    '-c',
    `mcp_servers=${tomlValue(servers)}`,
    ...(passed.length > 0 ? ['-c', `shell_environment_policy.exclude=${tomlValue(passed)}`] : []),
  ];
}

/**
 * 재현하는 진단의 플래그 묶음. 사용자 설정·rules·앱 도구·훅을 끄는 것은 읽기 전용 묶음과 같고, 권한 프로필만 바꾼다(26번 실측의 프로필).
 * MCP는 앱이 읽은 정의만 인라인으로 싣는다(실을 서버가 없으면 넘기지 않는다). 정의가 참조한 변수와 옮긴 평문 값은 셸 환경 정책으로 셸 명령에서 가린다.
 * 모든 경로를 읽을 수 있게 두되 홈 아래의 `.env` 계열과 개인 비밀을 막고, 사본(작업 루트)만 쓰기로 열어 `.env` 계열 말고 다른 비밀 패턴과 `.git`을 막는다.
 * 글롭 경로는 deny만 되므로 사본의 `.env`를 열려면 사본을 홈 밖에 둬야 한다. 홈 밖의 다른 저장소 `.env`는 막지 못한다(알려진 한계).
 * linked worktree의 `.git`은 파일이라 `**\/.git`도 막는다. 임시 폴더 쓰기는 열지 않는다(같은 임시 폴더의 다른 사본까지 열린다).
 */
function codexReproductionArgs(request: ExecutorRunRequest, paths: Pick<RunPaths, 'schemaFile' | 'cwd'>, mcp: ReproductionMcp | null): string[] {
  /** 홈 아래에서 막을 경로. */
  const homeDeny = [...ENV_FILE_PATTERNS.map((pattern) => `~/**/${pattern}`), ...PERSONAL_SECRET_PATHS].map((path) => `${tomlString(path)}="deny"`);
  /** 사본 안과 원본에서 막을 패턴. 글롭 규칙은 끝의 `/` 없이 쓴다. */
  const patterns = [...copySecretPatterns(request.secretPatterns).map((pattern) => pattern.replace(/\/+$/, '')), '.git'];
  /** 원본 경로로 원본의 비밀 파일을 읽지 못하게 막는 규칙. 원본 `.env`는 홈 아래면 위 규칙이 막는다. */
  const sourceDeny = patterns.map((pattern) => `${tomlString(`${request.reproduction!.sourceRoot}/**/${pattern}`)}="deny"`);
  /** 사본 아래에서 막을 규칙. */
  const copyDeny = patterns.map((pattern) => `${tomlString(`**/${pattern}`)}="deny"`);
  /** 파일 시스템 권한. */
  const filesystem = `{":root"="read", ${[...homeDeny, ...sourceDeny].join(', ')}, ":workspace_roots"={"."="write", ${copyDeny.join(', ')}}}`;
  return [
    'exec',
    '--ignore-user-config',
    '--ignore-rules',
    '--ephemeral',
    '--json',
    '--output-schema',
    paths.schemaFile,
    '-C',
    paths.cwd,
    '--skip-git-repo-check',
    '-c',
    'web_search="disabled"',
    '-c',
    'features.apps=false',
    '-c',
    'features.hooks=false',
    '-c',
    'features.multi_agent=false',
    '-c',
    'features.goals=false',
    '-c',
    `default_permissions="${PERMISSION_PROFILE}"`,
    '-c',
    `permissions.${PERMISSION_PROFILE}.filesystem=${filesystem}`,
    '-c',
    `permissions.${PERMISSION_PROFILE}.workspace_roots={}`,
    '-c',
    `permissions.${PERMISSION_PROFILE}.network.enabled=true`,
    ...(mcp ? codexMcpArgs(mcp) : []),
    '-c',
    `developer_instructions=${tomlString(request.instructions)}`,
    ...(request.model === null ? [] : ['-m', request.model]),
    '-',
  ];
}

/**
 * 비밀 파일 패턴을 넘긴 루트 아래 어느 깊이에서든 맞는 Codex 규칙(`**\/<패턴>`)으로 바꾼다.
 * 앞에 붙은 `/`와 `**\/`는 "어느 깊이에서든"과 같고 끝의 `/`는 "폴더"라는 뜻이라 뗀다. 앱의 근거 검사와 같은 해석이다.
 */
function anyDepthPattern(pattern: string): string {
  return `**/${pattern.replace(/^(?:\/|\*\*\/)+/, '').replace(/\/+$/, '')}`;
}

/** TOML 기본 문자열에서 이름 있는 이스케이프를 쓰는 글자. */
const TOML_ESCAPES: Readonly<Record<string, string>> = { '"': '\\"', '\\': '\\\\', '\b': '\\b', '\t': '\\t', '\n': '\\n', '\f': '\\f', '\r': '\\r' };

/** 값을 TOML 기본 문자열로 쓴다. `-c` 값은 TOML로 읽히므로 따옴표, 역슬래시, 줄바꿈, 제어 문자를 이스케이프한다. */
function tomlString(value: string): string {
  // eslint-disable-next-line no-control-regex
  return `"${value.replace(/["\\\u0000-\u001f\u007f]/g, (char) => TOML_ESCAPES[char] ?? `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;
}

/** TOML 맨 키로 쓸 수 있는 이름. 아니면 따옴표로 감싼다. */
const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

/** JSON 값(문자열, 유한한 수, 참거짓, 목록, 표)을 TOML 인라인 값으로 쓴다. `null`인 칸은 뺀다. */
function tomlValue(value: unknown): string {
  if (typeof value === 'string') return tomlString(value);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `[${value.map(tomlValue).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    /** 값이 있는 칸. */
    const entries = Object.entries(value).filter(([, item]) => item !== null && item !== undefined);
    return `{${entries.map(([key, item]) => `${TOML_BARE_KEY.test(key) ? key : tomlString(key)}=${tomlValue(item)}`).join(', ')}}`;
  }
  throw new Error('TOML로 쓸 수 없는 값입니다.');
}

/**
 * 프로세스 결과와 JSONL로 실행 결과를 정한다. 턴이 실패했으면 그 문장으로 실패 이유를 가리고,
 * 이벤트 없이 오류로 끝나면(세션을 만들지 못함, 지원하지 않는 플래그 등) 표준 오류만 오류 원문으로 남긴다.
 * 표준 출력의 JSONL에는 명령이 읽은 파일 내용이 들어 있어 오류 원문에 넣지 않는다.
 */
function classifyCodexRun(result: ProcessResult, reader: CodexEventReader): ExecutorOutcome {
  switch (result.kind) {
    case 'spawn-failed':
      return failedOutcome('cli-missing', result.message);
    case 'timed-out':
      return { type: 'timed-out' };
    case 'aborted':
      return { type: 'cancelled' };
    case 'exited':
      break;
  }

  if (reader.turnFailure !== null) return failedOutcome(turnFailureReason(reader.turnFailure), reader.turnFailure);
  if (result.exitCode !== 0) {
    return failedOutcome('cli-error', reader.lastError ?? (result.stderr.trim() || `종료 코드 ${String(result.exitCode)}로 끝났습니다.`));
  }
  if (reader.lastMessage === null) return { type: 'invalid-output', detail: '결과에 구조화 출력이 없습니다.' };

  /** 마지막 메시지를 JSON으로 푼 것. */
  const output = parseJsonObject(reader.lastMessage);
  if (output === null) return { type: 'invalid-output', detail: '마지막 메시지가 JSON 객체가 아닙니다.' };
  return { type: 'completed', output };
}

/**
 * 턴 실패 문장으로 실패 이유를 정한다. 미로그인은 실측 문장(`unexpected status 401 Unauthorized`)이고,
 * 과부하·연결 실패는 다시 실행할 일시적 실패다. 사용량 한도처럼 그 밖의 실패는 에이전트 오류다.
 */
function turnFailureReason(message: string): ExecutorFailureReason {
  if (/\b401\b|unauthorized|not logged in|log ?in again|refresh token/i.test(message)) return 'not-logged-in';
  if (/overloaded|high demand|\b529\b|\b503\b/i.test(message)) return 'overloaded';
  if (/stream disconnected|error sending request|connection (?:refused|reset|closed)|failed to connect|dns error|network/i.test(message)) return 'network';
  return 'agent-error';
}
