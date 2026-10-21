import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeSuccessStream, fakeClaudeAuthStatus } from '../fakes/fake-claude-stream';
import { codexSuccessStream, fakeCodexLoginStatus } from '../fakes/fake-codex-events';
import { FakeClock } from '../fakes/fake-clock';
import { exited, FakeProcessRunner } from '../fakes/fake-process-runner';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger } from '../logging/logger';
import type { AgentId } from '../ports/executor';
import type { Settings } from '../ports/settings-store';
import { GlobalProblems } from '../problems/global-problems';
import { AgentConnections } from './agent-connections';
import { isExecutableFileOnDisk, LOGIN_SHELL_MARKERS } from './cli-discovery';
import type { ProcessRequest } from './process-runner';

/** 테스트마다 만드는 임시 홈 폴더. */
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'stardraft-agents-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** 가짜 로그인 셸 경로. */
const SHELL = '/bin/fake-login-shell';

/** 로그인 셸이 돌려주는 사용자 PATH. */
const SHELL_PATH = '/usr/local/fake-node/bin:/usr/bin:/bin';

/** 가짜 CLI 하나의 상태. 테스트가 바꿔 CLI의 대답을 바꾼다. */
interface FakeCli {
  /** 설치되어 있는지 여부. */
  installed: boolean;
  /** 로그인되어 있는지 여부. */
  loggedIn: boolean;
}

/** 홈 폴더의 `~/.local/bin`에 실행 파일 `name`을 만들고 경로를 돌려준다. */
function installCli(name: string): string {
  /** CLI를 둘 폴더. */
  const dir = join(home, '.local', 'bin');
  mkdirSync(dir, { recursive: true });
  /** 만든 CLI 경로. */
  const cliPath = join(dir, name);
  writeFileSync(cliPath, '#!/bin/sh\n');
  chmodSync(cliPath, 0o755);
  return cliPath;
}

/**
 * 가짜 Claude Code와 Codex를 두고 연결 확인 묶음을 만든다. 설치된 CLI는 로그인 셸의 `command -v`가 알려 준다.
 * 실행 파일 검사는 임시 홈 폴더 안으로 한정해 이 PC에 실제로 설치된 CLI를 찾지 않게 한다.
 */
function setup({ platform = 'darwin', settings = {} }: { platform?: NodeJS.Platform; settings?: Partial<Settings> } = {}) {
  /** 에이전트별 가짜 CLI 상태. */
  const clis: Record<AgentId, FakeCli> = { 'claude-code': { installed: true, loggedIn: true }, codex: { installed: true, loggedIn: true } };
  const claudePath = installCli('claude');
  const codexPath = installCli('codex');
  const runner = new FakeProcessRunner();
  // 로그인 셸은 찾는 명령이 설치되어 있으면 그 경로를 알려 준다.
  runner.respondWhen(
    (request) => request.command === SHELL,
    (request) => {
      /** 찾는 명령의 경로. */
      const found = request.args[1]?.includes('command -v codex') ? (clis.codex.installed ? codexPath : null) : clis['claude-code'].installed ? claudePath : null;
      return exited(0, [LOGIN_SHELL_MARKERS.begin, ...(found ? [found] : []), LOGIN_SHELL_MARKERS.path, SHELL_PATH, LOGIN_SHELL_MARKERS.end].join('\n'));
    },
  );
  runner.respond(claudePath, ['--version'], exited(0, '2.1.303 (Claude Code)\n'));
  runner.respond(claudePath, ['--restricted', 'auth', 'status'], () =>
    clis['claude-code'].loggedIn ? exited(0, fakeClaudeAuthStatus.loggedIn) : exited(1, fakeClaudeAuthStatus.notLoggedIn),
  );
  runner.respond(claudePath, ['auth', 'status'], exited(1, fakeClaudeAuthStatus.notLoggedIn));
  runner.respondWhen((request) => request.command === claudePath && request.args[0] === '-p', exited(0, claudeSuccessStream({ ok: true })));
  runner.respond(codexPath, ['--version'], exited(0, 'codex-cli 0.163.0\n'));
  runner.respond(codexPath, ['login', 'status'], () =>
    clis.codex.loggedIn ? exited(0, '', fakeCodexLoginStatus.chatgpt) : exited(1, '', fakeCodexLoginStatus.notLoggedIn),
  );
  runner.respond(codexPath, ['debug', 'models'], exited(1, '', 'error: fake'));
  runner.respondWhen((request) => request.args[0] === 'exec', exited(0, codexSuccessStream({ ok: true })));

  const clock = new FakeClock();
  const logger = createLogger([], clock);
  const notifier = new RecordingNotifier();
  const problems = new GlobalProblems({ notifier, clock, logger, notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }) });
  const settingsStore = new MemorySettingsStore(settings);
  const connections = new AgentConnections({
    platform,
    env: { PATH: '/usr/bin:/bin', HOME: home },
    homeDir: home,
    loginShell: SHELL,
    runner,
    settingsStore,
    logger,
    problems,
    checkDir: join(home, 'agent-check'),
    tempRoot: home,
    isExecutableFile: async (filePath) => filePath.startsWith(home) && isExecutableFileOnDisk(filePath),
  });
  /** CLI를 지운다. 저장한 경로도 더는 실행할 수 없다. */
  const uninstall = (agent: AgentId) => {
    clis[agent].installed = false;
    rmSync(agent === 'codex' ? codexPath : claudePath);
  };
  return { clis, runner, problems, notifier, settingsStore, connections, uninstall };
}

/** 요청이 Codex를 찾거나 부른 것인지 본다. */
function touchesCodex(request: ProcessRequest): boolean {
  return request.command.endsWith('/codex') || request.args.some((arg) => arg.includes('command -v codex')) || request.args[0] === 'exec';
}

describe('에이전트 연결 후보', () => {
  it('macOS는 Claude Code와 Codex를 모두 확인해, 연결된 에이전트를 후보 순서대로 알려 준다', async () => {
    const { connections } = setup();

    await connections.checkAll();

    expect(connections.all.map((connection) => connection.agent)).toEqual(['claude-code', 'codex']);
    expect(connections.connectedAgents()).toEqual(['claude-code', 'codex']);
    expect(connections.get('codex')?.state().progress).toEqual({ status: 'connected' });
  });

  it('Windows에서는 Codex가 후보에서 빠져 찾지도 부르지도 않는다', async () => {
    const { connections, runner } = setup({ platform: 'win32' });

    await connections.checkAll();

    expect(connections.all.map((connection) => connection.agent)).toEqual(['claude-code']);
    expect(connections.get('codex')).toBeNull();
    expect(runner.requests.some(touchesCodex)).toBe(false);
  });

  it('모델 목록은 에이전트별 연결 확인이 읽은 것이고, 후보가 아닌 에이전트는 비어 있다', async () => {
    const { connections } = setup();

    await connections.checkAll();

    expect(connections.models('claude-code').map((model) => model.id)).toEqual(['fable', 'opus', 'sonnet']);
    // 이 설정의 가짜 Codex는 모델 목록 명령이 실패한다.
    expect(connections.models('codex')).toEqual([]);
    expect(setup({ platform: 'win32' }).connections.models('codex')).toEqual([]);
  });

  it('필수 설정의 에이전트 연결은 하나라도 연결되면 연결됨, 확인 중인 에이전트가 있으면 확인 중, 모두 실패하면 연결 안 됨이다', async () => {
    const { connections, clis } = setup();
    expect(connections.setupStatus()).toBe('checking');

    clis['claude-code'].loggedIn = false;
    await connections.checkAll();
    expect(connections.setupStatus()).toBe('connected');

    clis.codex.loggedIn = false;
    await connections.checkAll();
    expect(connections.setupStatus()).toBe('not-connected');
  });
});

describe('여러 에이전트의 전역 문제', () => {
  it('감지를 시작한 뒤 Codex가 설치되어 있지 않아도 Claude Code가 연결되어 있으면 전역 문제를 띄우지 않는다', async () => {
    const { connections, problems, notifier, uninstall } = setup({ settings: { detectionStarted: true } });
    uninstall('codex');

    await connections.checkAll();

    expect(connections.connectedAgents()).toEqual(['claude-code']);
    expect(problems.current()).toBeNull();
    expect(notifier.sent).toEqual([]);
  });

  it('고른 기본 에이전트(Codex)의 로그인이 풀려도 Claude Code가 연결되어 있으면 대기열은 Claude Code로 이어 가므로 전역 문제를 띄우지 않는다', async () => {
    const { connections, problems, clis } = setup({ settings: { detectionStarted: true, defaultAgent: 'codex' } });
    await connections.checkAll();
    clis.codex.loggedIn = false;

    await connections.get('codex')?.check();

    expect(connections.connectedAgents()).toEqual(['claude-code']);
    expect(problems.current()).toBeNull();
  });

  it('연결된 에이전트가 하나도 없으면 전역 문제를 띄우고, 설치된 에이전트의 문제를 설치되지 않은 에이전트의 CLI 없음보다 먼저 보인다', async () => {
    const { connections, problems, notifier, clis, uninstall } = setup({ settings: { detectionStarted: true } });
    uninstall('claude-code');
    clis.codex.loggedIn = false;

    await connections.checkAll();

    expect(problems.current()?.problem).toEqual({ cause: 'agent', agent: 'codex', reason: 'not-logged-in' });
    expect(notifier.sent).toHaveLength(1);
  });

  it('둘 다 설치되어 있는데 모두 실패하면 저장한 기본 에이전트의 문제를 보인다', async () => {
    const { connections, problems, clis } = setup({ settings: { detectionStarted: true, defaultAgent: 'codex' } });
    clis['claude-code'].loggedIn = false;
    clis.codex.loggedIn = false;

    await connections.checkAll();

    expect(problems.current()?.problem).toEqual({ cause: 'agent', agent: 'codex', reason: 'not-logged-in' });
  });

  it('모두 설치되어 있지 않으면 저장한 기본 에이전트와 상관없이 늘 칸에 보이는 Claude Code의 CLI 없음을 보인다', async () => {
    const { connections, problems, uninstall } = setup({ settings: { detectionStarted: true, defaultAgent: 'codex' } });
    uninstall('claude-code');
    uninstall('codex');

    await connections.checkAll();

    expect(problems.current()?.problem).toEqual({ cause: 'agent', agent: 'claude-code', reason: 'cli-missing' });
  });

  it('하나라도 다시 연결되면 전역 문제가 사라진다', async () => {
    const { connections, problems, clis } = setup({ settings: { detectionStarted: true } });
    clis['claude-code'].loggedIn = false;
    clis.codex.loggedIn = false;
    await connections.checkAll();
    expect(problems.current()?.problem).toMatchObject({ cause: 'agent', agent: 'claude-code' });

    clis.codex.loggedIn = true;
    await connections.get('codex')?.check();

    expect(problems.current()).toBeNull();
  });

  it('감지를 시작하기 전에는 모두 실패해도 전역 문제를 띄우지 않는다(필수 설정 전 화면이 보여 준다)', async () => {
    const { connections, problems, uninstall } = setup();
    uninstall('claude-code');
    uninstall('codex');

    await connections.checkAll();

    expect(connections.setupStatus()).toBe('not-connected');
    expect(problems.current()).toBeNull();
  });

  it('연결 상태가 바뀌면 어느 에이전트든 알린다', async () => {
    const { connections } = setup();
    /** 알림을 받은 횟수. */
    let changes = 0;
    connections.onChange(() => (changes += 1));

    await connections.get('codex')?.check();

    expect(changes).toBeGreaterThan(0);
  });
});
