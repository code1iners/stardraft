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
import { asRecord, failedOutcome, numberOrNull, parseJsonObject } from './executor-output';
import type { ProcessResult } from './process-runner';
import { readingFileStep, searchingStep } from './progress-steps';
import { copySecretPatterns, ENV_FILE_PATTERNS, PERSONAL_SECRET_PATHS, reproductionEnv } from './reproduction-boundary';
import { withDefaultSecretPatterns } from './secret-patterns';

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
    if (!launch) return { outcome: failedOutcome('cli-missing', 'Claude Code CLI를 아직 찾지 못했습니다.'), cliVersion: null, model: null, usage: null };
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
      /** 재현 경계로 도는지 여부. */
      const reproducing = request.reproduction != null;
      // 재현하는 진단은 결과를 낸 뒤에도 백그라운드 명령(dev 서버 등)이 끝나기를 기다리며 CLI가 열려 있으므로, 결과가 오면 남은 프로세스를 끝낸다.
      /** 결과를 받아 앱이 끝낸 실행을 끊는 장치. 사용자의 중단 신호도 함께 받는다. */
      const stopAfterResult = new AbortController();
      /** 결과를 받아 앱이 끝냈는지 여부. */
      let stoppedAfterResult = false;
      /** 사용자의 중단 신호를 끊는 장치로 넘긴다. */
      const forwardAbort = () => stopAfterResult.abort();
      if (request.signal.aborted) forwardAbort();
      else request.signal.addEventListener('abort', forwardAbort, { once: true });
      try {
        /** 프로세스 결과. */
        const result = await this.options.runner.run({
          command: launch.cliPath,
          args: reproducing ? claudeReproductionArgs(request, instructionsFile) : claudeRunArgs(request, instructionsFile, extraRoots),
          env: reproducing ? { ...reproductionEnv(withoutAgentApiKeys(launch.env)), ...reproductionExtraEnv(request.timeoutMs) } : withoutAgentApiKeys(launch.env),
          cwd,
          timeoutMs: request.timeoutMs,
          stdin: request.input,
          onStdoutLine: (line) => {
            reader.push(line);
            if (reproducing && reader.result !== null && !stopAfterResult.signal.aborted) {
              stoppedAfterResult = true;
              stopAfterResult.abort();
            }
          },
          signal: reproducing ? stopAfterResult.signal : request.signal,
          ...(reproducing ? { killDescendants: true } : {}),
        });
        // 결과를 받아 앱이 끝낸 실행은 스스로 끝난 것처럼 결과 메시지로 가린다.
        /** 분류할 결과. */
        const classified: ProcessResult = stoppedAfterResult && result.kind === 'aborted' ? { kind: 'exited', exitCode: 0, stdout: result.stdout, stderr: result.stderr } : result;
        return { outcome: classifyClaudeRun(classified, reader), cliVersion: reader.cliVersion, model: reader.model, usage: reader.usage() };
      } finally {
        request.signal.removeEventListener('abort', forwardAbort);
      }
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
 * 재현하는 진단의 플래그 묶음(26번 실측의 확정 묶음). 사용자 설정을 끌어오지 않는 플래그는 읽기 전용 묶음과 같고,
 * 셸과 편집 도구를 열고 셸 명령은 OS 샌드박스 안에서만 돌게 한다. 이 단계에서는 MCP 정의를 넘기지 않아 서버가 하나도 실리지 않는다.
 * 사본만 읽을 루트이자 cwd라 `--add-dir`은 없다.
 */
function claudeReproductionArgs(request: ExecutorRunRequest, instructionsFile: string): string[] {
  /** 사본 실제 경로와 원본 저장소 경로. */
  const { copyRoot, sourceRoot } = request.reproduction!;
  /** 권한 규칙과 샌드박스. */
  const settings = {
    // dontAsk에서는 허용 규칙이 있어야 셸과 편집 도구가 돈다(2.1.324부터 샌드박스만으로 셸을 자동 허용하지 않음).
    permissions: {
      allow: ['Bash', 'Edit', 'Write'],
      // 사본과 원본 경로로 좁힌다. 루트 전체 형식을 샌드박스에 합치면 /etc/ssl/cert.pem과 ~/.npmrc까지 막혀 HTTPS가 깨진다.
      // 원본도 막아야 원본 경로로 원본의 비밀 파일을 읽지 못한다. 원본 `.env`는 아래 샌드박스 규칙이 막는다.
      deny: [copyRoot, sourceRoot].flatMap((root) => copySecretPatterns(request.secretPatterns).map((pattern) => `Read(/${root}/**/${pattern})`)),
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      // 네트워크는 샌드박스 프록시를 거친다. 프록시를 쓰지 않는 도구는 나가지 못한다.
      network: { allowedDomains: ['*'], allowLocalBinding: true },
      // `.env` 계열은 어디서나 막고 사본 아래만 다시 연다. 더 좁은 경로의 규칙이 이긴다.
      filesystem: {
        denyRead: [...ENV_FILE_PATTERNS.map((pattern) => `/**/${pattern}`), ...PERSONAL_SECRET_PATHS],
        allowRead: ENV_FILE_PATTERNS.map((pattern) => `${copyRoot}/**/${pattern}`),
      },
    },
  };
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--json-schema',
    JSON.stringify(request.outputSchema),
    '--tools',
    'Read,Glob,Grep,Bash,Edit,Write',
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
    ...(request.model === null ? [] : ['--model', request.model]),
  ];
}

/**
 * 재현하는 진단에서 최소 환경 변수에 더하는 값. Node `fetch`가 샌드박스 프록시를 타게 하고(없으면 dev 서버의 API 호출이 실패한다),
 * 백그라운드 명령을 기다리는 상한을 진단 시간 상한에 맞춘다.
 */
function reproductionExtraEnv(timeoutMs: number): Record<string, string> {
  return { NODE_USE_ENV_PROXY: '1', CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: String(timeoutMs) };
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
    const event = parseJsonObject(line);
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

/**
 * 프로세스 결과와 stream-json으로 실행 결과를 정한다.
 * 결과 메시지 없이 끝나면 표준 오류만 오류 원문으로 남긴다. 표준 출력의 stream-json에는 읽은 파일 내용이 들어 있을 수 있다.
 */
function classifyClaudeRun(result: ProcessResult, reader: ClaudeStreamReader): ExecutorOutcome {
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

  /** 마지막 `result` 메시지. */
  const message = reader.result;
  if (!message) return failedOutcome('cli-error', result.stderr.trim() || `종료 코드 ${String(result.exitCode)}로 끝났습니다.`);
  /** CLI가 알려 준 결과 문장. 실패면 오류 문장이다. */
  const text = typeof message.result === 'string' ? message.result : '';

  if (message.subtype === 'error_max_structured_output_retries') {
    return { type: 'invalid-output', detail: '스키마에 맞는 구조화 출력을 만들지 못했습니다.' };
  }
  if (message.subtype === 'error_max_turns' || message.terminal_reason === 'max_turns') {
    return failedOutcome('max-turns', text || '턴 수 상한에 닿았습니다.');
  }
  if (message.is_error === true || message.subtype !== 'success') {
    return failedOutcome(apiFailureReason(reader.apiError, message.api_error_status), text || String(message.subtype));
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
