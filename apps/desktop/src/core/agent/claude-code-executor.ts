import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentId, Executor, ExecutorFailureReason, ExecutorOutcome, ExecutorRunRequest, RunKind } from '../ports/executor';
import { CLAUDE_MAX_TURNS } from './claude-cli';
import { withoutAgentApiKeys } from './cli-discovery';
import type { ProcessResult, ProcessRunner } from './process-runner';
import { withDefaultSecretPatterns } from './secret-patterns';

/** Claude Code CLI를 띄울 때 쓰는 것. 연결 확인이 정한다. */
export interface ClaudeLaunch {
  /** CLI 절대 경로. */
  cliPath: string;
  /** 앱이 구성한 자식 프로세스 환경. */
  env: Record<string, string>;
}

/** 실행 하나가 끝났을 때의 보고. */
export interface ClaudeRunReport {
  /** 실행의 종류. */
  kind: RunKind;
  /** stream-json 첫 이벤트가 알려 준 CLI 버전. 받기 전에 끝났으면 `null`. */
  cliVersion: string | null;
  /** 실행 결과. */
  outcome: ExecutorOutcome;
}

/** Claude Code 실행기에 필요한 것. */
export interface ClaudeCodeExecutorOptions {
  /** CLI를 띄우는 프로세스 실행기. */
  runner: ProcessRunner;
  /** 지금 쓸 CLI와 자식 환경. 연결 확인이 아직 CLI를 찾지 못했으면 `null`. */
  launch: () => ClaudeLaunch | null;
  /** 실행마다 지침 파일을 둘 임시 폴더를 만들 곳. 없으면 OS 임시 폴더다. */
  tempRoot?: string;
  /** 실행이 끝날 때마다 부른다. 연결 확인이 CLI 버전 변화와 전역 실패를 알아채는 데 쓴다. */
  onRunFinished?: (report: ClaudeRunReport) => void;
}

/** 오류 원문의 최대 길이. 넘으면 앞부분만 남긴다. */
const DETAIL_MAX_LENGTH = 2_000;

/**
 * Claude Code 실행기. 에이전트 실행 계약의 필수 플래그 묶음으로 `claude -p`를 띄우고,
 * stream-json 마지막 `result` 메시지의 `structured_output`을 꺼낸다.
 */
export class ClaudeCodeExecutor implements Executor {
  readonly agent: AgentId = 'claude-code';

  constructor(private readonly options: ClaudeCodeExecutorOptions) {}

  async run(request: ExecutorRunRequest): Promise<ExecutorOutcome> {
    /** 실행 결과와 실행에서 본 CLI 버전. */
    const { outcome, cliVersion } = await this.execute(request);
    this.options.onRunFinished?.({ kind: request.kind, cliVersion, outcome });
    return outcome;
  }

  /** 지침 파일을 쓰고 CLI를 띄운 뒤 결과를 분류한다. 지침 파일은 끝나면 지운다. */
  private async execute(request: ExecutorRunRequest): Promise<{ outcome: ExecutorOutcome; cliVersion: string | null }> {
    /** 띄울 CLI와 환경. */
    const launch = this.options.launch();
    if (!launch) return { outcome: failed('cli-missing', 'Claude Code CLI를 아직 찾지 못했습니다.'), cliVersion: null };
    /** 작업 폴더가 될 첫 저장소와 `--add-dir`로 붙일 나머지. */
    const [cwd, ...extraRoots] = request.readRoots;
    if (cwd === undefined) throw new Error('읽을 디렉터리가 없습니다.');

    /** 이번 실행의 임시 폴더. */
    const tempDir = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), 'stardraft-run-'));
    try {
      /** `--append-system-prompt-file`로 넘길 지침 파일. */
      const instructionsFile = join(tempDir, 'instructions.md');
      await writeFile(instructionsFile, request.instructions, 'utf8');

      /** stream-json을 읽는 쪽. */
      const reader = new ClaudeStreamReader();
      /** 프로세스 결과. */
      const result = await this.options.runner.run({
        command: launch.cliPath,
        args: claudeRunArgs(request, instructionsFile, extraRoots),
        env: withoutAgentApiKeys(launch.env),
        cwd,
        timeoutMs: request.timeoutMs,
        stdin: request.input,
        onStdoutLine: (line) => reader.push(line),
        signal: request.signal,
      });
      return { outcome: classifyClaudeRun(result, reader), cliVersion: reader.cliVersion };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

/**
 * 실행 계약의 필수 플래그 묶음. 빼거나 바꿀 수 없다.
 * 비밀 파일 deny 규칙은 `--add-dir` 저장소에도 걸리게 절대 형식 `Read(//**\/<패턴>)`으로 쓴다.
 * `--bare`는 구독 로그인을 읽지 않으므로 쓰지 않는다.
 */
function claudeRunArgs(request: ExecutorRunRequest, instructionsFile: string, extraRoots: readonly string[]): string[] {
  /** 비밀 파일을 읽지 못하게 하는 설정. 요청이 기본 목록을 빠뜨려도 늘 넣는다. */
  const settings = { permissions: { deny: withDefaultSecretPatterns(request.secretPatterns).map((pattern) => `Read(//**/${pattern})`) } };
  return [
    '-p',
    '--output-format',
    'stream-json',
    // stream-json은 --verbose가 없으면 오류로 끝난다.
    '--verbose',
    '--json-schema',
    JSON.stringify(request.outputSchema),
    '--tools',
    'Read,Glob,Grep',
    '--disallowedTools',
    'mcp__*',
    '--settings',
    JSON.stringify(settings),
    '--permission-mode',
    'dontAsk',
    '--permission-prompts',
    'none',
    '--restricted',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    String(CLAUDE_MAX_TURNS[request.kind]),
    '--append-system-prompt-file',
    instructionsFile,
    ...extraRoots.flatMap((dir) => ['--add-dir', dir]),
    ...(request.model === null ? [] : ['--model', request.model]),
  ];
}

/** stream-json 줄을 받아 앱이 쓰는 값만 모은다. JSON이 아닌 줄은 건너뛴다. */
class ClaudeStreamReader {
  /** 첫 `system/init` 이벤트가 알려 준 CLI 버전. */
  cliVersion: string | null = null;
  /** 마지막 모델 API 오류 종류(`authentication_failed`, `overloaded`, `server_error` 등). */
  apiError: string | null = null;
  /** 마지막 `result` 메시지. */
  result: Record<string, unknown> | null = null;

  push(line: string): void {
    /** JSON으로 푼 이벤트. */
    const event = parseObject(line);
    if (!event) return;
    if (event.type === 'system' && event.subtype === 'init' && typeof event.claude_code_version === 'string') {
      this.cliVersion = event.claude_code_version;
    } else if (event.type === 'assistant' && typeof event.error === 'string') {
      this.apiError = event.error;
    } else if (event.type === 'result') {
      this.result = event;
    }
  }
}

/** 프로세스 결과와 stream-json으로 실행 결과를 정한다. */
function classifyClaudeRun(result: ProcessResult, reader: ClaudeStreamReader): ExecutorOutcome {
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

  /** 마지막 `result` 메시지. */
  const message = reader.result;
  if (!message) return failed('cli-error', processOutputDetail(result.stderr, result.stdout, result.exitCode));
  /** CLI가 알려 준 결과 문장. 실패면 오류 문장이다. */
  const text = typeof message.result === 'string' ? message.result : '';

  if (message.subtype === 'error_max_structured_output_retries') {
    return { type: 'invalid-output', detail: '스키마에 맞는 구조화 출력을 만들지 못했습니다.' };
  }
  if (message.subtype === 'error_max_turns' || message.terminal_reason === 'max_turns') {
    return failed('max-turns', text || '턴 수 상한에 닿았습니다.');
  }
  if (message.is_error === true || message.subtype !== 'success') {
    return failed(apiFailureReason(reader.apiError, message.api_error_status), text || String(message.subtype));
  }

  /** 스키마 결과. 문서는 성공이어도 비어 있을 수 있다고 한다. */
  const output = message.structured_output;
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    return { type: 'invalid-output', detail: '결과에 구조화 출력이 없습니다.' };
  }
  return { type: 'completed', output };
}

/** 모델 API 오류 종류와 HTTP 상태로 실패 이유를 정한다. */
function apiFailureReason(apiError: string | null, status: unknown): ExecutorFailureReason {
  if (apiError === 'authentication_failed') return 'not-logged-in';
  if (apiError === 'overloaded' || status === 529) return 'overloaded';
  // 연결 자체가 실패하면 HTTP 상태 없이 server_error로 온다(실측: 연결 거부를 10회 재시도한 뒤).
  if (apiError === 'server_error' && (status === null || status === undefined)) return 'network';
  return 'agent-error';
}

/** 실패 결과를 만든다. 오류 원문은 길이 상한까지만 남긴다. */
function failed(reason: ExecutorFailureReason, detail: string): ExecutorOutcome {
  return { type: 'failed', reason, detail: detail.slice(0, DETAIL_MAX_LENGTH) };
}

/** 결과 메시지 없이 끝난 프로세스의 오류 원문. 표준 오류를 먼저 쓴다. */
function processOutputDetail(stderr: string, stdout: string, exitCode: number | null): string {
  return stderr.trim() || stdout.trim() || `종료 코드 ${String(exitCode)}로 끝났습니다.`;
}

/** JSON 객체 한 줄을 푼다. 객체가 아니면 `null`. */
function parseObject(line: string): Record<string, unknown> | null {
  try {
    /** 푼 값. */
    const parsed: unknown = JSON.parse(line);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
