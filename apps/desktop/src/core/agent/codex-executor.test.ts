import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codexNotLoggedInStream, codexStream as stream, codexSuccessStream, fakeCodexEvent } from '../fakes/fake-codex-events';
import { exited, FakeProcessRunner, type FakeProcessReply } from '../fakes/fake-process-runner';
import type { ExecutorRunRequest } from '../ports/executor';
import type { AgentLaunch, AgentRunReport } from './agent-launch';
import { CodexExecutor } from './codex-executor';
import type { ProcessRequest } from './process-runner';

/** 테스트마다 만드는 임시 폴더. 가짜 CLI, 저장소, 스키마 파일을 여기에 둔다. */
let root: string;
/** Homebrew처럼 버전 폴더에 둔 CLI 실제 파일. */
let realCli: string;
/** 설정에 저장된 CLI 경로. 실제 파일을 가리키는 심볼릭 링크다. */
let linkedCli: string;
/** git 저장소인 첫 저장소. */
let repoA: string;
/** 둘째 저장소. */
let repoB: string;
/** 셋째 저장소. */
let repoC: string;

beforeEach(() => {
  // macOS의 임시 폴더는 /var → /private/var 링크 아래에 있으므로 실제 경로로 잡는다.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'stardraft-codex-')));
  realCli = installFakeCli('0.163.0');
  linkedCli = join(root, 'bin', 'codex');
  mkdirSync(join(root, 'bin'));
  symlinkSync(realCli, linkedCli);
  repoA = makeDir('work/repo-a', { git: true });
  repoB = makeDir('work/repo-b', { git: true });
  repoC = makeDir('other/repo-c', { git: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** `version` 폴더에 실행 파일 `codex`를 만들고 경로를 돌려준다. */
function installFakeCli(version: string): string {
  /** CLI를 둘 폴더. */
  const dir = join(root, 'Caskroom', 'codex', version, 'bin');
  mkdirSync(dir, { recursive: true });
  /** 만든 CLI 경로. */
  const cliPath = join(dir, 'codex');
  writeFileSync(cliPath, '#!/bin/sh\n');
  chmodSync(cliPath, 0o755);
  return cliPath;
}

/** 임시 폴더 아래에 폴더를 만든다. `git`이면 `.git` 폴더를 둔다. */
function makeDir(relativePath: string, { git = false }: { git?: boolean } = {}): string {
  /** 만든 폴더. */
  const dir = join(root, relativePath);
  mkdirSync(git ? join(dir, '.git') : dir, { recursive: true });
  return dir;
}

/** 연결 확인이 정한 자식 환경. API 키 변수가 섞여 있어도 실행기가 뺀다. */
const CHILD_ENV = { PATH: '/fake/node/bin:/usr/bin:/bin', HOME: '/Users/fake', LANG: 'ko_KR.UTF-8', CODEX_API_KEY: 'fake-codex-key', ANTHROPIC_API_KEY: 'sk-fake' };

/** 테스트용 초안 실행 스키마. */
const DRAFT_SCHEMA = { type: 'object', properties: { requirement: { type: 'string' } }, required: ['requirement'], additionalProperties: false };

/** 테스트용 초안 실행 입력. */
function draftRequest(overrides: Partial<ExecutorRunRequest> = {}): ExecutorRunRequest {
  return {
    kind: 'draft',
    instructions: '가짜 지침: 쉬운 말로 씁니다.',
    input: '## 데이터\n가짜 멘션 원문',
    outputSchema: DRAFT_SCHEMA,
    readRoots: [repoA, repoB, repoC],
    secretPatterns: ['.env', 'company/*.secret'],
    model: null,
    timeoutMs: 600_000,
    signal: new AbortController().signal,
    onProgress: () => {},
    ...overrides,
  };
}

/** 가짜 실행기와 Codex 실행기를 만든다. */
function setup(launch: () => AgentLaunch | null = () => ({ cliPath: linkedCli, env: CHILD_ENV, version: '0.163.0' })) {
  const runner = new FakeProcessRunner();
  /** 실행이 끝날 때마다 받은 보고. */
  const reports: AgentRunReport[] = [];
  const executor = new CodexExecutor({ runner, launch, tempRoot: root, onRunFinished: (report) => reports.push(report) });
  return { runner, executor, reports };
}

/** 실제 경로의 CLI를 부른 요청에 `reply`로 대답한다. */
function answerCli(runner: FakeProcessRunner, reply: FakeProcessReply, cliPath = realCli): void {
  runner.respondWhen((request) => request.command === cliPath, reply);
}

/** 인수 목록에서 `flag` 바로 뒤의 값. */
function flagValue(request: ProcessRequest | undefined, flag: string): string | undefined {
  /** 플래그의 위치. */
  const index = request?.args.indexOf(flag) ?? -1;
  return index < 0 ? undefined : request?.args[index + 1];
}

/** 기본 비밀 파일 패턴의 Codex deny 규칙. 실행 계약의 기본 목록 순서다. */
const DEFAULT_DENY_RULES = [
  '"**/.env"="deny"',
  '"**/.env.*"="deny"',
  '"**/*.pem"="deny"',
  '"**/*.key"="deny"',
  '"**/*.p12"="deny"',
  '"**/*.pfx"="deny"',
  '"**/*.jks"="deny"',
  '"**/*.keystore"="deny"',
  '"**/id_rsa*"="deny"',
  '"**/id_ed25519*"="deny"',
  '"**/.npmrc"="deny"',
  '"**/.pypirc"="deny"',
  '"**/.netrc"="deny"',
  '"**/secrets/**"="deny"',
  '"**/.git/**"="deny"',
];

describe('Codex 실행기: 인수 묶음', () => {
  it('실행 계약의 필수 플래그 묶음을 그대로 쓰고, 링크를 푼 실제 경로로 띄워 그 파일만 프로필에서 읽기 허용한다. 첫 저장소는 -C와 cwd, 나머지는 workspace_roots다', async () => {
    const { runner, executor } = setup();
    /** 실행하는 동안 스키마 파일에 쓰여 있던 내용. 실행이 끝나면 파일을 지운다. */
    let schemaFileContent: unknown = null;
    answerCli(runner, (request) => {
      schemaFileContent = JSON.parse(readFileSync(flagValue(request, '--output-schema') ?? '', 'utf8'));
      return exited(0, codexSuccessStream({ requirement: '가짜 요구' }));
    });

    await executor.run(draftRequest());

    const [request] = runner.requests;
    expect(request?.command).toBe(realCli);
    expect(request?.cwd).toBe(repoA);
    expect(request?.args).toEqual([
      'exec',
      '--ignore-user-config',
      '--ignore-rules',
      '--ephemeral',
      '--json',
      '--output-schema',
      flagValue(request, '--output-schema'),
      '-C',
      repoA,
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
      'default_permissions="stardraft"',
      '-c',
      `permissions.stardraft.filesystem={":minimal"="read", "${realCli}"="read", ":slash_tmp"="deny", ":tmpdir"="deny", ":workspace_roots"={"."="read", ${[
        ...DEFAULT_DENY_RULES,
        '"**/company/*.secret"="deny"',
      ].join(', ')}, ".git"="deny"}}`,
      '-c',
      `permissions.stardraft.workspace_roots={"${repoB}"=true, "${repoC}"=true}`,
      '-c',
      'developer_instructions="가짜 지침: 쉬운 말로 씁니다."',
      '-',
    ]);
    expect(schemaFileContent).toEqual(DRAFT_SCHEMA);
  });

  it('선택 실행과 작동 확인(점검 실행)은 git 저장소가 아닌 폴더에서 돌므로 --skip-git-repo-check를 붙인다. 초안 실행은 첫 저장소가 git 저장소 안이면 붙이지 않는다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(0, codexSuccessStream({ requirement: '가짜 요구' })));
    /** git 저장소가 아닌 작업 폴더. */
    const workFolder = makeDir('plain-work');
    /** git 저장소 안의 하위 폴더. */
    const inside = makeDir('work/repo-a/sub/module');
    /** git 저장소가 아닌 코드 폴더(저장소 매핑은 이런 폴더도 받는다). */
    const plainCode = makeDir('plain-code');

    await executor.run(draftRequest({ kind: 'selection', readRoots: [workFolder, join(root, 'work')] }));
    await executor.run(draftRequest({ kind: 'check', readRoots: [workFolder] }));
    await executor.run(draftRequest({ kind: 'draft', readRoots: [repoA, plainCode] }));
    await executor.run(draftRequest({ kind: 'draft', readRoots: [inside] }));
    await executor.run(draftRequest({ kind: 'draft', readRoots: [plainCode, repoA] }));

    expect(runner.requests.map((request) => request.args.includes('--skip-git-repo-check'))).toEqual([true, true, false, false, true]);
    // 플래그는 -C 바로 뒤에 둔다.
    expect(runner.requests[0]?.args.slice(7, 10)).toEqual(['-C', workFolder, '--skip-git-repo-check']);
  });

  it('고른 모델은 표준 입력 표시(-) 앞에 -m으로 넘기고, 기본 모델이면 넘기지 않는다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(0, codexSuccessStream({ requirement: '가짜 요구' })));

    await executor.run(draftRequest({ model: 'gpt-fake-model' }));
    await executor.run(draftRequest({ model: null }));

    expect(runner.requests[0]?.args.slice(-3)).toEqual(['-m', 'gpt-fake-model', '-']);
    expect(runner.requests[1]?.args).not.toContain('-m');
  });

  it('지침은 TOML 문자열로 이스케이프해 developer_instructions에 넣는다(줄바꿈, 따옴표, 역슬래시, 탭, 제어 문자)', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(0, codexSuccessStream({ requirement: '가짜 요구' })));

    await executor.run(draftRequest({ instructions: '첫 줄\n"따옴표"와 C:\\경로\t탭\r\u0001끝' }));

    expect(runner.requests[0]?.args).toContain('developer_instructions="첫 줄\\n\\"따옴표\\"와 C:\\\\경로\\t탭\\r\\u0001끝"');
  });

  it('입력은 표준 입력으로 넘기고, 자식 환경에서 API 키 변수를 뺀다. CODEX_HOME은 사용자의 기본값을 그대로 둔다', async () => {
    const { runner, executor } = setup(() => ({
      cliPath: linkedCli,
      env: { ...CHILD_ENV, CODEX_HOME: '/Users/fake/.codex' },
      version: '0.163.0',
    }));
    answerCli(runner, exited(0, codexSuccessStream({ requirement: '가짜 요구' })));

    await executor.run(draftRequest());

    const [request] = runner.requests;
    expect(request?.stdin).toBe('## 데이터\n가짜 멘션 원문');
    expect(request?.env).toEqual({ PATH: '/fake/node/bin:/usr/bin:/bin', HOME: '/Users/fake', LANG: 'ko_KR.UTF-8', CODEX_HOME: '/Users/fake/.codex' });
  });

  it('추가 비밀 파일 패턴은 앞의 / 와 **/, 끝의 / 를 떼고 **/ 를 붙여 어느 깊이에서든 막는다. 기본 목록과 겹치면 한 번만 넣는다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(0, codexSuccessStream({ requirement: '가짜 요구' })));

    await executor.run(draftRequest({ secretPatterns: ['/config/prod.yml', '**/vault/', '.env'] }));

    /** 파일 시스템 권한 값. */
    const filesystem = runner.requests[0]?.args.find((arg) => arg.startsWith('permissions.stardraft.filesystem=')) ?? '';
    expect(filesystem).toContain(`${[...DEFAULT_DENY_RULES, '"**/config/prod.yml"="deny"', '"**/vault"="deny"'].join(', ')}, ".git"="deny"}}`);
  });
});

describe('Codex 실행기: 진행 단계와 결과', () => {
  it('명령 이벤트를 진행 단계 한 줄로 바꾼다. 파일 읽기는 파일 이름, 내용 검색은 검색어, 파일 이름 찾기는 패턴, 그 밖의 명령은 명령 줄을 보인다', async () => {
    const { runner, executor } = setup();
    /** 받은 진행 단계. */
    const steps: string[] = [];
    /** 띄운 명령. 실제 CLI는 명령을 띄울 때 item.started를 낸다. */
    const scripts = [
      'cat src/RetryConfig.kt',
      "sed -n '1,80p' src/main/Retry.kt",
      "nl -ba src/policy/Policy.kt | sed -n '10,40p'",
      'rg -n "max retries" src',
      'grep -rn -e timeout .',
      "rg --files -g '*.kt'",
      "find . -name 'Retry*.kt'",
      'rg --files',
      'ls -la src',
      'git   log --oneline -5',
    ];
    answerCli(
      runner,
      exited(
        0,
        stream(
          fakeCodexEvent.threadStarted(),
          fakeCodexEvent.turnStarted(),
          ...scripts.map((script, index) => fakeCodexEvent.commandStarted(`item_${index}`, script)),
          fakeCodexEvent.agentMessage('item_99', JSON.stringify({ requirement: '가짜 요구' })),
          fakeCodexEvent.turnCompleted(),
        ),
      ),
    );

    await executor.run(draftRequest({ onProgress: (progress) => steps.push(progress.step) }));

    expect(steps).toEqual([
      '파일 읽는 중: RetryConfig.kt',
      '파일 읽는 중: Retry.kt',
      '파일 읽는 중: Policy.kt',
      '검색 중: max retries',
      '검색 중: timeout',
      '검색 중: *.kt',
      '검색 중: Retry*.kt',
      '파일 목록 보는 중',
      '파일 목록 보는 중',
      '명령 실행 중: git log --oneline -5',
    ]);
  });

  it('읽은 파일 수는 종료 코드 0으로 끝난 읽기 명령의 파일을 한 번씩 센다. 실패한 읽기와 검색은 세지 않는다', async () => {
    const { runner, executor } = setup();
    /** 받은 진행. */
    const progress: [string, number][] = [];
    answerCli(
      runner,
      exited(
        0,
        stream(
          fakeCodexEvent.threadStarted(),
          fakeCodexEvent.commandStarted('item_1', 'cat missing.txt'),
          fakeCodexEvent.commandCompleted('item_1', 'cat missing.txt', { exitCode: 1, output: 'cat: missing.txt: No such file or directory\n' }),
          fakeCodexEvent.commandStarted('item_2', 'cat src/RetryConfig.kt'),
          fakeCodexEvent.commandCompleted('item_2', 'cat src/RetryConfig.kt'),
          fakeCodexEvent.commandStarted('item_3', 'rg -n retry .'),
          fakeCodexEvent.commandCompleted('item_3', 'rg -n retry .'),
          fakeCodexEvent.commandStarted('item_4', "sed -n '1,5p' src/RetryConfig.kt"),
          fakeCodexEvent.commandCompleted('item_4', "sed -n '1,5p' src/RetryConfig.kt"),
          fakeCodexEvent.agentMessage('item_5', JSON.stringify({ requirement: '가짜 요구' })),
          fakeCodexEvent.turnCompleted(),
        ),
      ),
    );

    await executor.run(draftRequest({ onProgress: ({ step, filesRead }) => progress.push([step, filesRead]) }));

    expect(progress).toEqual([
      ['파일 읽는 중: missing.txt', 0],
      ['파일 읽는 중: RetryConfig.kt', 0],
      ['파일 읽는 중: RetryConfig.kt', 1],
      ['검색 중: retry', 1],
      ['파일 읽는 중: RetryConfig.kt', 1],
    ]);
  });

  it('마지막 에이전트 메시지의 JSON을 구조화 출력으로 꺼내고, 토큰 수와 연결 확인이 읽은 CLI 버전, 넘긴 모델을 실행 보고에 담는다. 비용은 알려 주지 않는다', async () => {
    const { runner, executor, reports } = setup();
    answerCli(
      runner,
      exited(
        0,
        stream(
          fakeCodexEvent.threadStarted(),
          fakeCodexEvent.errorItem('item_0', 'Model metadata for `gpt-fake-model` not found. Defaulting to fallback metadata.'),
          fakeCodexEvent.turnStarted(),
          fakeCodexEvent.agentMessage('item_1', '중간 메시지'),
          fakeCodexEvent.agentMessage('item_2', JSON.stringify({ requirement: '가짜 요구' })),
          fakeCodexEvent.turnCompleted({ input: 5_700, cached: 3_700, output: 420 }),
        ),
      ),
    );

    /** 실행 보고. */
    const report = await executor.run(draftRequest({ model: 'gpt-fake-model' }));

    expect(report).toEqual({
      outcome: { type: 'completed', output: { requirement: '가짜 요구' } },
      cliVersion: '0.163.0',
      model: 'gpt-fake-model',
      usage: { costUsd: null, inputTokens: 5_700, outputTokens: 420 },
    });
    expect(reports).toEqual([{ kind: 'draft', ...report }]);
  });
});

describe('Codex 실행기: 실패', () => {
  it('로그인되어 있지 않으면(실측: 401로 다시 연결을 시도한 뒤 턴 실패, 종료 코드 1) 미로그인으로 끝나고 턴 실패 문장을 오류 원문으로 남긴다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(1, codexNotLoggedInStream(), '2026-10-21T00:00:00Z ERROR codex_api: failed to connect to websocket: HTTP error: 401 Unauthorized\n'));

    /** 실행 보고. */
    const report = await executor.run(draftRequest());

    expect(report.outcome).toEqual({
      type: 'failed',
      reason: 'not-logged-in',
      detail: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: https://api.openai.com/v1/responses',
    });
  });

  it.each([
    ['stream disconnected before completion: error sending request for url (https://api.openai.com/v1/responses)', 'network'],
    ['Codex is currently experiencing high demand (server overloaded). Please try again.', 'overloaded'],
    ["You've hit your usage limit. Upgrade to Pro, or try again at Oct 20th, 2026 2:21 PM.", 'agent-error'],
  ])('턴이 "%s"로 실패하면 %s로 끝난다', async (message, reason) => {
    const { runner, executor } = setup();
    answerCli(runner, exited(1, stream(fakeCodexEvent.threadStarted(), fakeCodexEvent.turnStarted(), fakeCodexEvent.error(message), fakeCodexEvent.turnFailed(message))));

    /** 실행 보고. */
    const report = await executor.run(draftRequest());

    expect(report.outcome).toEqual({ type: 'failed', reason, detail: message });
  });

  it.each([
    [
      '링크 경로로 띄워 세션을 만들지 못함',
      "Error: thread/start: thread/start failed: error creating thread: failed to load AGENTS.md instructions for environment `local`: fs sandbox helper failed with status exit status: 71: sandbox-exec: execvp() of '/fake/bin/codex' failed: Operation not permitted",
    ],
    ['git 저장소 밖', 'Not inside a trusted directory and --skip-git-repo-check was not specified.'],
    ['지원하지 않는 플래그', "error: unexpected argument '--ignore-rules' found"],
  ])('이벤트 없이 오류로 끝나면(%s) 결과 없이 끝난 실패로 보고 표준 오류를 오류 원문으로 남긴다', async (_case, stderr) => {
    const { runner, executor } = setup();
    answerCli(runner, exited(1, '', `${stderr}\n`));

    /** 실행 보고. */
    const report = await executor.run(draftRequest());

    expect(report.outcome).toEqual({ type: 'failed', reason: 'cli-error', detail: stderr });
  });

  it('CLI를 띄우지 못하면 CLI 없음, 제한 시간을 넘기면 시간 초과, 중단 신호로 끊기면 취소다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, { kind: 'spawn-failed', message: 'spawn EACCES' });
    expect((await executor.run(draftRequest())).outcome).toEqual({ type: 'failed', reason: 'cli-missing', detail: 'spawn EACCES' });

    answerCli(runner, { kind: 'timed-out', stdout: stream(fakeCodexEvent.threadStarted()), stderr: '' });
    expect((await executor.run(draftRequest())).outcome).toEqual({ type: 'timed-out' });

    answerCli(runner, { kind: 'aborted', stdout: '', stderr: '' });
    expect((await executor.run(draftRequest())).outcome).toEqual({ type: 'cancelled' });
  });

  it('마지막 메시지가 JSON 객체가 아니거나 메시지 없이 끝나면 스키마에 맞는 결과가 없는 것(구조 실패)이다', async () => {
    const { runner, executor } = setup();
    answerCli(runner, exited(0, stream(fakeCodexEvent.threadStarted(), fakeCodexEvent.agentMessage('item_0', '초안입니다'), fakeCodexEvent.turnCompleted())));
    expect((await executor.run(draftRequest())).outcome).toMatchObject({ type: 'invalid-output' });

    answerCli(runner, exited(0, stream(fakeCodexEvent.threadStarted(), fakeCodexEvent.agentMessage('item_0', '["배열"]'), fakeCodexEvent.turnCompleted())));
    expect((await executor.run(draftRequest())).outcome).toMatchObject({ type: 'invalid-output' });

    answerCli(runner, exited(0, stream(fakeCodexEvent.threadStarted(), fakeCodexEvent.turnCompleted())));
    expect((await executor.run(draftRequest())).outcome).toMatchObject({ type: 'invalid-output' });
  });

  it('저장한 CLI 경로의 링크를 풀 수 없거나(지워짐) 연결 확인이 아직 CLI를 찾지 못했으면 띄우지 않고 CLI 없음으로 끝난다', async () => {
    rmSync(realCli);
    const { runner, executor } = setup();
    expect((await executor.run(draftRequest())).outcome).toMatchObject({ type: 'failed', reason: 'cli-missing' });

    const notFound = setup(() => null);
    expect((await notFound.executor.run(draftRequest())).outcome).toMatchObject({ type: 'failed', reason: 'cli-missing' });
    expect([...runner.requests, ...notFound.runner.requests]).toEqual([]);
  });
});

describe('Codex 실행기: 실제 경로', () => {
  it('실행할 때마다 링크를 다시 풀어, CLI가 새 버전 폴더로 바뀌면 새 실제 경로로 띄우고 그 파일을 읽기 허용한다', async () => {
    const { runner, executor } = setup();
    /** 새 버전의 실제 파일. */
    const newCli = installFakeCli('0.164.0');
    runner.respondWhen(() => true, exited(0, codexSuccessStream({ requirement: '가짜 요구' })));

    await executor.run(draftRequest());
    // Homebrew로 올리면 링크가 새 버전 폴더를 가리키고 옛 폴더는 없어진다.
    rmSync(linkedCli);
    symlinkSync(newCli, linkedCli);
    rmSync(join(root, 'Caskroom', 'codex', '0.163.0'), { recursive: true });
    await executor.run(draftRequest());

    expect(runner.requests.map((request) => request.command)).toEqual([realCli, newCli]);
    expect(runner.requests[1]?.args.find((arg) => arg.startsWith('permissions.stardraft.filesystem='))).toContain(`"${newCli}"="read"`);
  });
});
