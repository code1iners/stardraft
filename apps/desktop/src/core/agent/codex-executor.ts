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
  RunKind,
} from '../ports/executor';
import type { AgentExecutorOptions } from './agent-launch';
import { withoutAgentApiKeys } from './cli-discovery';
import { describeCodexCommand, type CodexCommand } from './codex-commands';
import type { ProcessResult } from './process-runner';
import { LISTING_FILES_STEP, readingFileStep, runningCommandStep, searchingStep } from './progress-steps';
import { withDefaultSecretPatterns } from './secret-patterns';

/** 오류 원문의 최대 길이. 넘으면 앞부분만 남긴다. */
const DETAIL_MAX_LENGTH = 2_000;

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
    if (!launch) return { outcome: failed('cli-missing', 'Codex CLI를 아직 찾지 못했습니다.'), cliVersion: null, model: null, usage: null };
    /** `-C`와 cwd가 될 첫 루트와 `workspace_roots`로 넘길 나머지. */
    const [cwd, ...extraRoots] = request.readRoots;
    if (cwd === undefined) throw new Error('읽을 디렉터리가 없습니다.');

    // 심볼릭 링크로 띄우면 세션이 만들어지지 않는다. 실제 경로는 버전마다 바뀌므로 실행할 때마다 푼다.
    /** CLI의 실제 경로. 풀 수 없으면 파일이 지워진 것이다. */
    const realCli = await realpath(launch.cliPath).catch(() => null);
    if (realCli === null) return { outcome: failed('cli-missing', `${launch.cliPath}를 찾을 수 없습니다.`), cliVersion: null, model: null, usage: null };

    /** 이번 실행의 임시 폴더. */
    const tempDir = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), 'stardraft-run-'));
    try {
      /** `--output-schema`로 넘길 스키마 파일. */
      const schemaFile = join(tempDir, 'schema.json');
      await writeFile(schemaFile, JSON.stringify(request.outputSchema), 'utf8');

      /** JSONL을 읽는 쪽. */
      const reader = new CodexEventReader(request.onProgress);
      /** 프로세스 결과. */
      const result = await this.options.runner.run({
        command: realCli,
        args: codexRunArgs(request, { realCli, schemaFile, cwd, extraRoots, skipGitRepoCheck: await needsGitRepoCheckSkip(request.kind, cwd) }),
        env: withoutAgentApiKeys(launch.env),
        cwd,
        timeoutMs: request.timeoutMs,
        stdin: request.input,
        onStdoutLine: (line) => reader.push(line),
        signal: request.signal,
      });
      // Codex의 이벤트는 버전과 모델을 알려 주지 않는다. 버전은 실행 직전 확인이 읽은 것이고, 모델은 넘긴 것이다.
      return { outcome: classifyCodexRun(result, reader), cliVersion: launch.version, model: request.model, usage: reader.usage };
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
    const event = parseObject(line);
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
      this.turnFailure = typeof asRecord(event.error)?.message === 'string' ? (asRecord(event.error)?.message as string) : '';
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
 * 선택 실행(작업 폴더)과 점검 실행(앱 전용 빈 폴더)은 git 저장소가 아닌 폴더에서 돌므로 늘 붙인다.
 * 초안 실행은 첫 저장소가 git 저장소 안이면 붙이지 않고, 저장소 매핑이 받는 git이 아닌 코드 폴더일 때만 붙인다.
 */
async function needsGitRepoCheckSkip(kind: RunKind, cwd: string): Promise<boolean> {
  return kind !== 'draft' || !(await isInsideGitRepo(cwd));
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

/**
 * 프로세스 결과와 JSONL로 실행 결과를 정한다. 턴이 실패했으면 그 문장으로 실패 이유를 가리고,
 * 이벤트 없이 오류로 끝나면(세션을 만들지 못함, 지원하지 않는 플래그 등) 표준 오류만 오류 원문으로 남긴다.
 * 표준 출력의 JSONL에는 명령이 읽은 파일 내용이 들어 있어 오류 원문에 넣지 않는다.
 */
function classifyCodexRun(result: ProcessResult, reader: CodexEventReader): ExecutorOutcome {
  switch (result.kind) {
    case 'spawn-failed':
      return failed('cli-missing', result.message);
    case 'timed-out':
      return { type: 'timed-out' };
    case 'aborted':
      return { type: 'cancelled' };
    case 'exited':
      break;
  }

  if (reader.turnFailure !== null) return failed(turnFailureReason(reader.turnFailure), reader.turnFailure);
  if (result.exitCode !== 0) {
    return failed('cli-error', reader.lastError ?? (result.stderr.trim() || `종료 코드 ${String(result.exitCode)}로 끝났습니다.`));
  }
  if (reader.lastMessage === null) return { type: 'invalid-output', detail: '결과에 구조화 출력이 없습니다.' };

  /** 마지막 메시지를 JSON으로 푼 것. */
  const output = parseObject(reader.lastMessage);
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

/** 실패 결과를 만든다. 오류 원문은 길이 상한까지만 남긴다. */
function failed(reason: ExecutorFailureReason, detail: string): ExecutorOutcome {
  return { type: 'failed', reason, detail: detail.slice(0, DETAIL_MAX_LENGTH) };
}

/** 유한한 숫자면 그 값, 아니면 `null`. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** 배열이 아닌 객체면 필드를 읽을 수 있게, 아니면 `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** JSON 객체 한 줄을 푼다. 객체가 아니면 `null`. */
function parseObject(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}
