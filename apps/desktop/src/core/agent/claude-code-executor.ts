import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentId,
  Executor,
  ExecutorFailureReason,
  ExecutorOutcome,
  ExecutorProgress,
  ExecutorReport,
  ExecutorRunRequest,
  ExecutorUsage,
} from '../ports/executor';
import type { AgentExecutorOptions } from './agent-launch';
import { CLAUDE_MAX_TURNS } from './claude-cli';
import { withoutAgentApiKeys } from './cli-discovery';
import type { ProcessResult } from './process-runner';
import { readingFileStep, searchingStep } from './progress-steps';
import { withDefaultSecretPatterns } from './secret-patterns';

/** 오류 원문의 최대 길이. 넘으면 앞부분만 남긴다. */
const DETAIL_MAX_LENGTH = 2_000;

/**
 * Claude Code 실행기. 에이전트 실행 계약의 필수 플래그 묶음으로 `claude -p`를 띄우고,
 * stream-json 마지막 `result` 메시지의 `structured_output`을 꺼낸다.
 */
export class ClaudeCodeExecutor implements Executor {
  /** 이 실행기가 부르는 에이전트. */
  readonly agent: AgentId = 'claude-code';

  constructor(private readonly options: AgentExecutorOptions) {}

  async run(request: ExecutorRunRequest): Promise<ExecutorReport> {
    /** 실행 결과와 실행에서 본 CLI 버전·모델·사용량. */
    const report = await this.execute(request);
    this.options.onRunFinished?.({ kind: request.kind, ...report });
    return report;
  }

  /** 지침 파일을 쓰고 CLI를 띄운 뒤 결과를 분류한다. 지침 파일은 끝나면 지운다. */
  private async execute(request: ExecutorRunRequest): Promise<ExecutorReport> {
    /** 띄울 CLI와 환경. */
    const launch = this.options.launch();
    if (!launch) return { outcome: failed('cli-missing', 'Claude Code CLI를 아직 찾지 못했습니다.'), cliVersion: null, model: null, usage: null };
    /** cwd가 될 첫 저장소와 `--add-dir`로 붙일 나머지. */
    const [cwd, ...extraRoots] = request.readRoots;
    if (cwd === undefined) throw new Error('읽을 디렉터리가 없습니다.');

    /** 이번 실행의 임시 폴더. */
    const tempDir = await mkdtemp(join(this.options.tempRoot ?? tmpdir(), 'stardraft-run-'));
    try {
      /** `--append-system-prompt-file`로 넘길 지침 파일. */
      const instructionsFile = join(tempDir, 'instructions.md');
      await writeFile(instructionsFile, request.instructions, 'utf8');

      /** stream-json을 읽는 쪽. */
      const reader = new ClaudeStreamReader(request.onProgress);
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
      return { outcome: classifyClaudeRun(result, reader), cliVersion: reader.cliVersion, model: reader.model, usage: reader.usage() };
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

/**
 * stream-json 줄을 받아 앱이 쓰는 값만 모으고, 도구 사용 이벤트를 진행 단계로 알린다. JSON이 아닌 줄은 건너뛴다.
 * 읽은 파일 수는 Read 결과가 오류 없이 돌아왔을 때 센다. 비밀 파일처럼 거부된 읽기는 세지 않는다.
 */
class ClaudeStreamReader {
  /** 첫 `system/init` 이벤트가 알려 준 CLI 버전. */
  cliVersion: string | null = null;
  /** 첫 `system/init` 이벤트가 알려 준 모델. */
  model: string | null = null;
  /** 마지막 모델 API 오류 종류(`authentication_failed`, `overloaded`, `server_error` 등). */
  apiError: string | null = null;
  /** 마지막 `result` 메시지. */
  result: Record<string, unknown> | null = null;
  /** 읽기에 성공한 파일 경로. 같은 파일은 한 번만 센다. */
  private readonly filesRead = new Set<string>();
  /** 결과를 기다리는 Read 호출. 도구 호출 ID → 파일 경로. */
  private readonly pendingReads = new Map<string, string>();
  /** 마지막으로 알린 진행 단계. 읽은 파일 수만 바뀔 때 같은 단계로 다시 알린다. */
  private lastStep: string | null = null;

  /** `onProgress`는 도구를 부를 때와 읽은 파일 수가 늘 때마다 진행 단계로 부른다. */
  constructor(private readonly onProgress: (progress: ExecutorProgress) => void) {}

  /** 표준 출력 한 줄을 읽는다. */
  push(line: string): void {
    /** JSON으로 푼 이벤트. */
    const event = parseObject(line);
    if (!event) return;
    if (event.type === 'system' && event.subtype === 'init') {
      if (typeof event.claude_code_version === 'string') this.cliVersion = event.claude_code_version;
      if (typeof event.model === 'string') this.model = event.model;
    } else if (event.type === 'assistant') {
      if (typeof event.error === 'string') this.apiError = event.error;
      // 한 메시지에 도구 여럿이 함께 올 수 있다.
      for (const block of contentBlocks(event.message)) if (block.type === 'tool_use') this.readToolUse(block);
    } else if (event.type === 'user') {
      for (const block of contentBlocks(event.message)) if (block.type === 'tool_result') this.readToolResult(block);
    } else if (event.type === 'result') {
      this.result = event;
    }
  }

  /** 마지막 `result` 메시지가 알려 준 비용과 토큰 수. `result` 메시지가 없으면 `null`. */
  usage(): ExecutorUsage | null {
    if (!this.result) return null;
    /** 토큰 수. */
    const tokens = asRecord(this.result.usage) ?? {};
    /** 캐시를 거치지 않은 입력 토큰 수. 없으면 입력 토큰 수를 모른다. */
    const input = numberOrNull(tokens.input_tokens);
    return {
      costUsd: numberOrNull(this.result.total_cost_usd),
      inputTokens:
        input === null ? null : input + (numberOrNull(tokens.cache_creation_input_tokens) ?? 0) + (numberOrNull(tokens.cache_read_input_tokens) ?? 0),
      outputTokens: numberOrNull(tokens.output_tokens),
    };
  }

  /** 도구 호출 하나를 진행 단계로 알린다. 화면에 보일 일이 아니면(구조화 출력 등) 알리지 않는다. Read 호출은 결과가 올 때 셀 수 있게 기억한다. */
  private readToolUse(use: Record<string, unknown>): void {
    /** 도구 입력. */
    const input = asRecord(use.input) ?? {};
    /** 이 도구 호출의 진행 단계. */
    let step: string | null = null;
    if (use.name === 'Read' && typeof input.file_path === 'string') {
      if (typeof use.id === 'string') this.pendingReads.set(use.id, input.file_path);
      step = readingFileStep(input.file_path);
    } else if ((use.name === 'Grep' || use.name === 'Glob') && typeof input.pattern === 'string') {
      step = searchingStep(input.pattern);
    }
    if (step === null) return;
    this.lastStep = step;
    this.onProgress({ step, filesRead: this.filesRead.size });
  }

  /** Read 결과가 오류 없이 돌아오면 읽은 파일 수를 늘려 알린다. 처음 읽은 파일만 센다. */
  private readToolResult(result: Record<string, unknown>): void {
    /** 결과가 짝을 이룬 도구 호출 ID. */
    const useId = typeof result.tool_use_id === 'string' ? result.tool_use_id : null;
    /** 그 호출이 읽은 파일. Read 호출이 아니면 없다. */
    const path = useId === null ? undefined : this.pendingReads.get(useId);
    if (useId === null || path === undefined) return;
    this.pendingReads.delete(useId);
    if (result.is_error === true || this.filesRead.has(path)) return;
    this.filesRead.add(path);
    if (this.lastStep !== null) this.onProgress({ step: this.lastStep, filesRead: this.filesRead.size });
  }
}

/** 메시지의 내용 조각. 객체가 아닌 조각은 건너뛴다. */
function contentBlocks(message: unknown): Record<string, unknown>[] {
  /** 메시지 내용. */
  const content = asRecord(message)?.content;
  return Array.isArray(content) ? content.map(asRecord).filter((block) => block !== null) : [];
}

/** 배열이 아닌 객체면 필드를 읽을 수 있게, 아니면 `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * 프로세스 결과와 stream-json으로 실행 결과를 정한다.
 * 결과 메시지 없이 끝나면 표준 오류만 오류 원문으로 남긴다. 표준 출력의 stream-json에는 읽은 파일 내용이 들어 있을 수 있다.
 */
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
  if (!message) return failed('cli-error', result.stderr.trim() || `종료 코드 ${String(result.exitCode)}로 끝났습니다.`);
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

/** 유한한 숫자면 그 값, 아니면 `null`. */
function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** JSON 객체 한 줄을 푼다. 객체가 아니면 `null`. */
function parseObject(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}
