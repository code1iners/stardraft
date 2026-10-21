import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeNotLoggedInStream, claudeStream as stream, fakeClaudeEvent } from '../fakes/fake-claude-stream';
import { exited, FakeProcessRunner, type FakeProcessReply } from '../fakes/fake-process-runner';
import type { ExecutorProgress, ExecutorRunRequest } from '../ports/executor';
import { ClaudeCodeExecutor, type ClaudeLaunch, type ClaudeRunReport } from './claude-code-executor';
import { NodeProcessRunner } from './node-process-runner';
import type { ProcessRequest } from './process-runner';

/** 테스트마다 만드는 임시 폴더. 지침 파일을 여기에 쓴다. */
let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), 'stardraft-executor-'));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

/** 가짜 CLI 경로. */
const CLI = '/fake/bin/claude';

/** 연결 확인이 정한 자식 환경. */
const CHILD_ENV = { PATH: '/fake/node/bin:/usr/bin:/bin', HOME: '/Users/fake', LANG: 'ko_KR.UTF-8' };

/** 테스트용 초안 실행 스키마. */
const DRAFT_SCHEMA = { type: 'object', properties: { requirement: { type: 'string' } }, required: ['requirement'] };

/** 테스트용 초안 실행 입력. */
function draftRequest(overrides: Partial<ExecutorRunRequest> = {}): ExecutorRunRequest {
  return {
    kind: 'draft',
    instructions: '가짜 지침: 쉬운 말로 씁니다.',
    input: '## 데이터\n가짜 멘션 원문',
    outputSchema: DRAFT_SCHEMA,
    readRoots: ['/fake/work/repo-a', '/fake/work/repo-b', '/fake/other/repo-c'],
    secretPatterns: ['.env', 'company/*.secret'],
    model: null,
    timeoutMs: 600_000,
    signal: new AbortController().signal,
    onProgress: () => {},
    ...overrides,
  };
}

/** 가짜 실행기와 실행기 어댑터를 만든다. */
function setup(launch: ClaudeLaunch | null = { cliPath: CLI, env: CHILD_ENV }) {
  const runner = new FakeProcessRunner();
  /** 실행이 끝날 때마다 받은 보고. */
  const reports: ClaudeRunReport[] = [];
  const executor = new ClaudeCodeExecutor({ runner, launch: () => launch, tempRoot, onRunFinished: (report) => reports.push(report) });
  return { runner, executor, reports };
}

/** CLI를 부른 요청에 `reply`로 대답한다. */
function answerCli(runner: FakeProcessRunner, reply: FakeProcessReply): void {
  runner.respondWhen((request) => request.command === CLI, reply);
}

/** 인수 목록에서 `flag` 바로 뒤의 값. */
function flagValue(request: ProcessRequest | undefined, flag: string): string | undefined {
  /** 플래그의 위치. */
  const index = request?.args.indexOf(flag) ?? -1;
  return index < 0 ? undefined : request?.args[index + 1];
}

describe('Claude Code 실행기: 인수 묶음', () => {
  it('실행 계약의 필수 플래그 묶음을 그대로 쓰고, 첫 저장소를 cwd로, 나머지 저장소를 --add-dir로 붙인다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(0, stream(fakeClaudeEvent.init(), fakeClaudeEvent.result({ structured_output: { requirement: '가짜 요구' } }))));

    await executor.run(draftRequest());

    const [request] = runner.requests;
    expect(request?.cwd).toBe('/fake/work/repo-a');
    expect(request?.args).toEqual([
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--json-schema',
      JSON.stringify(DRAFT_SCHEMA),
      '--tools',
      'Read,Glob,Grep',
      '--disallowedTools',
      'mcp__*',
      '--settings',
      expect.any(String),
      '--permission-mode',
      'dontAsk',
      '--permission-prompts',
      'none',
      '--restricted',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-turns',
      expect.stringMatching(/^[1-9]\d*$/),
      '--append-system-prompt-file',
      expect.any(String),
      '--add-dir',
      '/fake/work/repo-b',
      '--add-dir',
      '/fake/other/repo-c',
    ]);
    expect(request?.args).not.toContain('--bare');
    expect(request?.args).not.toContain('--model');
  });

  it('비밀 파일은 기본 목록과 추가 패턴을 Read(//**/<패턴>) 형식의 deny 규칙으로 넣는다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(0, stream(fakeClaudeEvent.init(), fakeClaudeEvent.result({ structured_output: {} }))));

    // 기본 목록을 빠뜨린 요청이어도 기본 목록은 늘 들어간다.
    await executor.run(draftRequest({ secretPatterns: ['company/*.secret', '.env'] }));

    /** `--settings`로 넘긴 설정. */
    const settings: unknown = JSON.parse(flagValue(runner.requests[0], '--settings') ?? 'null');
    expect(settings).toEqual({
      permissions: {
        deny: [
          'Read(//**/.env)',
          'Read(//**/.env.*)',
          'Read(//**/*.pem)',
          'Read(//**/*.key)',
          'Read(//**/*.p12)',
          'Read(//**/*.pfx)',
          'Read(//**/*.jks)',
          'Read(//**/*.keystore)',
          'Read(//**/id_rsa*)',
          'Read(//**/id_ed25519*)',
          'Read(//**/.npmrc)',
          'Read(//**/.pypirc)',
          'Read(//**/.netrc)',
          'Read(//**/secrets/**)',
          'Read(//**/.git/**)',
          'Read(//**/company/*.secret)',
        ],
      },
    });
  });

  it('모델을 고르면 --model로 넘긴다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(0, stream(fakeClaudeEvent.init(), fakeClaudeEvent.result({ structured_output: {} }))));

    await executor.run(draftRequest({ model: 'sonnet' }));

    expect(runner.requests[0]?.args.slice(-2)).toEqual(['--model', 'sonnet']);
  });

  it('입력 문서는 표준 입력으로 넘기고, 지침은 지침 파일로 넣었다가 실행 뒤 지운다', async () => {
    const { runner, executor } = setup();
    /** 실행 중에 읽은 지침 파일 내용. */
    let instructionsSeen = '';
    /** 지침 파일 경로. */
    let instructionsFile = '';
    answerCli(runner, (request) => {
      instructionsFile = flagValue(request, '--append-system-prompt-file') ?? '';
      instructionsSeen = readFileSync(instructionsFile, 'utf8');
      return exited(0, stream(fakeClaudeEvent.init(), fakeClaudeEvent.result({ structured_output: {} })));
    });

    await executor.run(draftRequest());

    expect(runner.requests[0]?.stdin).toBe('## 데이터\n가짜 멘션 원문');
    expect(instructionsSeen).toBe('가짜 지침: 쉬운 말로 씁니다.');
    expect(instructionsFile.startsWith(tempRoot)).toBe(true);
    expect(existsSync(instructionsFile)).toBe(false);
  });

  it('자식 환경은 앱이 구성한 것을 쓰고, ANTHROPIC_API_KEY와 CODEX_API_KEY는 넘기지 않는다', async () => {
    const { runner, executor } = setup({
      cliPath: CLI,
      env: { ...CHILD_ENV, ANTHROPIC_API_KEY: 'sk-fake-key', CODEX_API_KEY: 'fake-codex-key' },
    });
    answerCli(runner, exited(0, stream(fakeClaudeEvent.init(), fakeClaudeEvent.result({ structured_output: {} }))));

    await executor.run(draftRequest());

    expect(runner.requests[0]?.env).toEqual(CHILD_ENV);
    expect(runner.requests[0]?.command).toBe(CLI);
  });

  it('제한 시간과 중단 신호를 프로세스 실행기에 넘긴다', async () => {
    const { runner, executor } = setup();
    const controller = new AbortController();
    answerCli(runner, exited(0, stream(fakeClaudeEvent.init(), fakeClaudeEvent.result({ structured_output: {} }))));

    await executor.run(draftRequest({ timeoutMs: 123_000, signal: controller.signal }));

    expect(runner.requests[0]).toMatchObject({ timeoutMs: 123_000, signal: controller.signal });
  });
});

describe('Claude Code 실행기: 진행 단계', () => {
  it('도구 사용 이벤트를 "파일 읽는 중: 파일 이름"과 "검색 중: 찾는 말"로 바꿔 알리고, 읽은 파일 수는 읽기 결과가 오면 늘린다. 같은 파일은 한 번, 거부된 읽기는 세지 않는다', async () => {
    const { runner, executor } = setup();
    answerCli(
      runner,
      exited(
        0,
        stream(
          fakeClaudeEvent.init(),
          fakeClaudeEvent.toolUse('/fake/work/repo-a/src/RetryConfig.kt', 'toolu_1'),
          fakeClaudeEvent.toolResult('toolu_1'),
          fakeClaudeEvent.tools({ name: 'Grep', input: { pattern: 'retry', path: '/fake/work/repo-a' } }, { name: 'Glob', input: { pattern: '**/*.yml' } }),
          fakeClaudeEvent.toolUse('/fake/work/repo-a/src/RetryConfig.kt', 'toolu_2'),
          fakeClaudeEvent.toolResult('toolu_2'),
          fakeClaudeEvent.toolUse('/fake/work/repo-a/.env', 'toolu_3'),
          fakeClaudeEvent.toolResult('toolu_3', { isError: true, content: 'Permission to read /fake/work/repo-a/.env has been denied.' }),
          fakeClaudeEvent.toolUse('C:\\fake\\work\\repo-b\\application-prod.yml', 'toolu_4'),
          fakeClaudeEvent.toolResult('toolu_4'),
          fakeClaudeEvent.tools({ name: 'StructuredOutput', input: { requirement: '가짜 요구' } }),
          fakeClaudeEvent.result({ structured_output: { requirement: '가짜 요구' } }),
        ),
      ),
    );
    /** 알린 진행 단계. */
    const progress: ExecutorProgress[] = [];

    await executor.run(draftRequest({ onProgress: (step) => progress.push(step) }));

    expect(progress).toEqual([
      { step: '파일 읽는 중: RetryConfig.kt', filesRead: 0 },
      { step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 },
      { step: '검색 중: retry', filesRead: 1 },
      { step: '검색 중: **/*.yml', filesRead: 1 },
      { step: '파일 읽는 중: RetryConfig.kt', filesRead: 1 },
      { step: '파일 읽는 중: .env', filesRead: 1 },
      { step: '파일 읽는 중: application-prod.yml', filesRead: 1 },
      { step: '파일 읽는 중: application-prod.yml', filesRead: 2 },
    ]);
  });

  it('여러 줄짜리 검색어는 한 줄로 줄여 알린다', async () => {
    const { runner, executor } = setup();
    answerCli(
      runner,
      exited(
        0,
        stream(
          fakeClaudeEvent.init(),
          fakeClaudeEvent.tools({ name: 'Grep', input: { pattern: 'retry\n  count', multiline: true } }),
          fakeClaudeEvent.result({ structured_output: {} }),
        ),
      ),
    );
    /** 알린 진행 단계. */
    const progress: ExecutorProgress[] = [];

    await executor.run(draftRequest({ onProgress: (step) => progress.push(step) }));

    expect(progress).toEqual([{ step: '검색 중: retry count', filesRead: 0 }]);
  });
});

describe('Claude Code 실행기: 실행 보고', () => {
  it('init 이벤트에서 CLI 버전과 모델을, result 메시지에서 비용과 토큰 수를 꺼내 실행 결과와 함께 돌려준다', async () => {
    const { runner, executor } = setup();
    answerCli(
      runner,
      exited(
        0,
        stream(
          fakeClaudeEvent.init('2.1.305', 'claude-fake-sonnet'),
          fakeClaudeEvent.result({
            structured_output: { requirement: '가짜 요구' },
            total_cost_usd: 0.0123,
            usage: { input_tokens: 1200, cache_creation_input_tokens: 300, cache_read_input_tokens: 4000, output_tokens: 456 },
          }),
        ),
      ),
    );

    const report = await executor.run(draftRequest());

    // 입력 토큰은 캐시에 쓰거나 캐시에서 읽은 토큰까지 더한다.
    expect(report).toEqual({
      outcome: { type: 'completed', output: { requirement: '가짜 요구' } },
      cliVersion: '2.1.305',
      model: 'claude-fake-sonnet',
      usage: { costUsd: 0.0123, inputTokens: 5500, outputTokens: 456 },
    });
  });

  it('result 메시지 없이 끝나면 비용과 토큰 수를 모르고, init 이벤트 전에 끝나면 버전과 모델도 모른다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(1, stream(fakeClaudeEvent.init('2.1.305', 'claude-fake-sonnet')), 'fake crash'));
    expect(await executor.run(draftRequest())).toMatchObject({ cliVersion: '2.1.305', model: 'claude-fake-sonnet', usage: null });

    answerCli(runner, { kind: 'spawn-failed', message: `spawn ${CLI} ENOENT` });
    expect(await executor.run(draftRequest())).toMatchObject({ cliVersion: null, model: null, usage: null });
  });
});

describe('Claude Code 실행기: 결과', () => {
  it('stream-json의 마지막 result 메시지에서 structured_output을 꺼낸다', async () => {
    const { runner, executor } = setup();
    answerCli(
      runner,
      exited(
        0,
        stream(
          fakeClaudeEvent.init(),
          'JSON이 아닌 경고 줄',
          fakeClaudeEvent.toolUse(),
          JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fake', content: '가짜 파일 내용' }] } }),
          fakeClaudeEvent.result({ structured_output: { requirement: '재시도 횟수를 알고 싶다' } }),
        ),
      ),
    );

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toEqual({ type: 'completed', output: { requirement: '재시도 횟수를 알고 싶다' } });
  });

  it('실행에서 본 CLI 버전과 결과를 보고한다', async () => {
    const { runner, executor, reports } = setup();
    answerCli(runner, exited(0, stream(fakeClaudeEvent.init('2.1.310'), fakeClaudeEvent.result({ structured_output: { ok: true } }))));

    await executor.run(draftRequest({ kind: 'selection' }));

    expect(reports).toEqual([
      {
        kind: 'selection',
        cliVersion: '2.1.310',
        model: 'claude-fake-model',
        usage: { costUsd: 0.01, inputTokens: null, outputTokens: null },
        outcome: { type: 'completed', output: { ok: true } },
      },
    ]);
  });

  it('성공했지만 structured_output이 없으면 구조 실패다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(0, stream(fakeClaudeEvent.init(), fakeClaudeEvent.result({ result: '스키마 없이 쓴 글' }))));

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toMatchObject({ type: 'invalid-output' });
  });

  it('구조화 출력 재시도 상한에 닿으면 구조 실패다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(1, stream(fakeClaudeEvent.init(), fakeClaudeEvent.result({ subtype: 'error_max_structured_output_retries', is_error: true }))));

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toMatchObject({ type: 'invalid-output' });
  });
});

describe('Claude Code 실행기: 실패 분류', () => {
  it('CLI를 띄우지 못하면 CLI 없음이다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, { kind: 'spawn-failed', message: `spawn ${CLI} ENOENT` });

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toEqual({ type: 'failed', reason: 'cli-missing', detail: `spawn ${CLI} ENOENT` });
  });

  it('연결 확인이 아직 CLI를 찾지 못했으면 띄우지 않고 CLI 없음이다', async () => {
    const { runner, executor } = setup(null);

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toMatchObject({ type: 'failed', reason: 'cli-missing' });
    expect(runner.requests).toEqual([]);
  });

  it('로그인되어 있지 않으면(실제 CLI 2.1.303의 출력 모양, 종료 코드 1) 미로그인이다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(1, claudeNotLoggedInStream()));

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toEqual({ type: 'failed', reason: 'not-logged-in', detail: 'Not logged in · Please run /login' });
  });

  it('모델 API에 연결하지 못하면(실제 CLI가 재시도 10회 뒤 내는 모양) 네트워크 오류다', async () => {
    const { runner, executor } = setup();
    /** 실제 CLI의 오류 문구. */
    const text = 'API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)';
    answerCli(
      runner,
      exited(
        1,
        stream(
          fakeClaudeEvent.init(),
          JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 10, error_status: null, error: 'unknown' }),
          fakeClaudeEvent.apiError('server_error', text),
          fakeClaudeEvent.result({ is_error: true, terminal_reason: 'api_error', api_error_status: null, result: text }),
        ),
      ),
    );

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toEqual({ type: 'failed', reason: 'network', detail: text });
  });

  it('모델 서버가 오류 코드를 주면 네트워크 오류가 아니라 에이전트 오류다', async () => {
    const { runner, executor } = setup();
    answerCli(
      runner,
      exited(
        1,
        stream(
          fakeClaudeEvent.init(),
          fakeClaudeEvent.apiError('server_error', 'API Error: 500 Internal server error'),
          fakeClaudeEvent.result({ is_error: true, terminal_reason: 'api_error', api_error_status: 500, result: 'API Error: 500 Internal server error' }),
        ),
      ),
    );

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toMatchObject({ type: 'failed', reason: 'agent-error' });
  });

  it('모델이 과부하면 과부하다', async () => {
    const { runner, executor } = setup();
    answerCli(
      runner,
      exited(
        1,
        stream(
          fakeClaudeEvent.init(),
          fakeClaudeEvent.apiError('overloaded', 'API Error: 529 Overloaded'),
          fakeClaudeEvent.result({ is_error: true, terminal_reason: 'api_error', api_error_status: 529, result: 'API Error: 529 Overloaded' }),
        ),
      ),
    );

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toMatchObject({ type: 'failed', reason: 'overloaded' });
  });

  it('턴 수 상한에 닿으면 턴 상한이다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(1, stream(fakeClaudeEvent.init(), fakeClaudeEvent.toolUse(), fakeClaudeEvent.result({ subtype: 'error_max_turns', is_error: true, terminal_reason: 'max_turns' }))));

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toMatchObject({ type: 'failed', reason: 'max-turns' });
  });

  it('사용량 한도 같은 그 밖의 오류는 에이전트 오류이고 CLI가 알려 준 문장을 남긴다', async () => {
    const { runner, executor } = setup();
    /** 가짜 사용량 한도 문구. */
    const text = 'Claude usage limit reached. Your limit will reset at 3pm.';
    answerCli(runner, exited(1, stream(fakeClaudeEvent.init(), fakeClaudeEvent.apiError('rate_limit', text), fakeClaudeEvent.result({ is_error: true, result: text }))));

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toEqual({ type: 'failed', reason: 'agent-error', detail: text });
  });

  it('result 메시지 없이 끝나면(지원하지 않는 플래그 등) CLI 오류이고 표준 오류를 남긴다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(1, '', "error: unknown option '--permission-prompts'\n"));

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toEqual({ type: 'failed', reason: 'cli-error', detail: "error: unknown option '--permission-prompts'" });
  });

  it('result 메시지 없이 끝난 실행의 오류 원문에는 표준 출력(읽은 파일 내용이 든 stream-json)을 넣지 않는다', async () => {
    const { runner, executor } = setup();
    answerCli(
      runner,
      exited(
        137,
        stream(
          fakeClaudeEvent.init(),
          JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_fake', content: 'FAKE_FILE_CONTENT' }] } }),
        ),
      ),
    );

    const { outcome } = await executor.run(draftRequest());

    expect(outcome).toEqual({ type: 'failed', reason: 'cli-error', detail: '종료 코드 137로 끝났습니다.' });
  });

  it('제한 시간을 넘기면 시간 초과, 중단 신호로 끝나면 취소다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, { kind: 'timed-out', stdout: stream(fakeClaudeEvent.init(), fakeClaudeEvent.toolUse()), stderr: '' });
    expect((await executor.run(draftRequest())).outcome).toEqual({ type: 'timed-out' });

    answerCli(runner, { kind: 'aborted', stdout: stream(fakeClaudeEvent.init()), stderr: '' });
    expect((await executor.run(draftRequest())).outcome).toEqual({ type: 'cancelled' });
  });
});

describe('Claude Code 실행기: 실제 프로세스의 취소', () => {
  it.skipIf(process.platform === 'win32')('진행 중에 취소하면 CLI가 띄운 자식 프로세스까지 끝내고 취소로 돌려준다', async () => {
    // 가짜 CLI는 도구 실행을 흉내 낸 자식 프로세스(다른 프로세스와 겹치지 않는 sleep 시간)를 띄운 뒤 파일을 읽는 이벤트를 낸다.
    /** 남은 자식 프로세스를 찾을 표지. */
    const marker = 'sleep 47.4321';
    /** 가짜 CLI 경로. */
    const cliPath = join(tempRoot, 'claude');
    writeFileSync(
      cliPath,
      [
        '#!/bin/sh',
        'cat > /dev/null',
        `${marker} &`,
        'sleep 0.2',
        `echo '${fakeClaudeEvent.init()}'`,
        `echo '${fakeClaudeEvent.toolUse('/fake/work/repo-a/RetryConfig.kt')}'`,
        'wait',
      ].join('\n'),
    );
    chmodSync(cliPath, 0o755);
    const executor = new ClaudeCodeExecutor({ runner: new NodeProcessRunner(), launch: () => ({ cliPath, env: { PATH: '/usr/bin:/bin' } }), tempRoot });
    const controller = new AbortController();
    /** 취소하기 직전에 자식 프로세스가 돌고 있었는지 여부. */
    let childRunningBeforeCancel = false;

    const report = await executor.run(
      draftRequest({
        readRoots: [tempRoot],
        signal: controller.signal,
        onProgress: ({ step }) => {
          if (!step.startsWith('파일 읽는 중')) return;
          childRunningBeforeCancel = isRunning(marker);
          controller.abort();
        },
      }),
    );

    expect(childRunningBeforeCancel).toBe(true);
    expect(report.outcome).toEqual({ type: 'cancelled' });
    // 프로세스 그룹에 보낸 SIGKILL은 커널이 곧 처리한다. 처리하기 전에 볼 수 있으므로 잠시 기다리며 본다.
    expect(await stopsRunningWithin(marker, 2_000)).toBe(true);
  });
});

/** `timeoutMs` 안에 명령줄에 `pattern`이 든 프로세스가 사라지는지 본다. */
async function stopsRunningWithin(pattern: string, timeoutMs: number): Promise<boolean> {
  /** 기다림을 그만둘 시각. */
  const deadline = Date.now() + timeoutMs;
  while (isRunning(pattern)) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return true;
}

/** 명령줄에 `pattern`이 든 프로세스가 돌고 있는지 본다. */
function isRunning(pattern: string): boolean {
  try {
    execFileSync('pgrep', ['-f', pattern], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
