import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { claudeNotLoggedInStream, claudeStream, claudeSuccessStream, fakeClaudeAuthStatus, fakeClaudeEvent } from '../fakes/fake-claude-stream';
import { FakeClock } from '../fakes/fake-clock';
import { exited, FakeProcessRunner, type FakeProcessReply } from '../fakes/fake-process-runner';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger } from '../logging/logger';
import type { Settings } from '../ports/settings-store';
import { GlobalProblems } from '../problems/global-problems';
import { AgentConnection, type AgentCheckProgress, type AgentConnectionOptions } from './agent-connection';
import { isExecutableFileOnDisk, LOGIN_SHELL_MARKERS } from './cli-discovery';
import type { ProcessRequest } from './process-runner';

/** 테스트마다 만드는 임시 홈 폴더. */
let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'stardraft-agent-'));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** 아무 데도 남기지 않는 로거. */
const silentLogger = createLogger([], new FakeClock());

/** 가짜 로그인 셸 경로. */
const SHELL = '/bin/fake-login-shell';

/** 로그인 셸이 돌려주는 사용자 PATH. */
const SHELL_PATH = '/usr/local/fake-node/bin:/usr/bin:/bin';

/** 실제 CLI처럼 로그인된 `claude auth status` 출력. */
const LOGGED_IN = fakeClaudeAuthStatus.loggedIn;

/** 로그인되지 않았을 때 `claude auth status`의 실제 출력 모양(2.1.303, 종료 코드 1). */
const NOT_LOGGED_IN = fakeClaudeAuthStatus.notLoggedIn;

/** `apiKeyHelper`만 설정했을 때 `claude auth status`의 실제 출력 모양(2.1.303, 종료 코드 0). */
const API_KEY_HELPER = fakeClaudeAuthStatus.apiKeyHelper;

/** 홈 폴더 아래 `relativeDir`에 실행 파일 `claude`를 만들고 경로를 돌려준다. */
function installCli(relativeDir: string): string {
  /** CLI를 둘 폴더. */
  const dir = join(home, relativeDir);
  mkdirSync(dir, { recursive: true });
  /** 만든 CLI 경로. */
  const cliPath = join(dir, 'claude');
  writeFileSync(cliPath, '#!/bin/sh\n');
  chmodSync(cliPath, 0o755);
  return cliPath;
}

/** rc 파일 출력이 앞뒤에 섞인 로그인 셸 출력. */
function shellOutput(commandLines: string[], path: string): string {
  return [
    'Last login: Mon Oct 19 09:00:00',
    LOGIN_SHELL_MARKERS.begin,
    ...commandLines,
    LOGIN_SHELL_MARKERS.path,
    path,
    LOGIN_SHELL_MARKERS.end,
    'rc 파일이 끝에 찍은 줄',
  ].join('\n');
}

/** 로그인 셸 요청인지 본다. */
function isShellRequest(request: ProcessRequest): boolean {
  return request.command === SHELL && request.args[0] === '-ilc';
}

/**
 * 가짜 실행기와 메모리 설정 저장소로 연결 확인을 만든다.
 * 실행 파일 검사는 실제 파일 시스템을 쓰되, 이 PC에 실제로 설치된 CLI를 찾지 않게 임시 홈 폴더 안으로 한정한다.
 */
function setup(overrides: Partial<AgentConnectionOptions> = {}, settings: Partial<Settings> = {}) {
  const runner = new FakeProcessRunner();
  const settingsStore = new MemorySettingsStore(settings);
  const clock = new FakeClock();
  const notifier = new RecordingNotifier();
  const problems = new GlobalProblems({
    notifier,
    clock,
    logger: silentLogger,
    notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }),
  });
  const connection = new AgentConnection({
    platform: 'darwin',
    env: { PATH: '/usr/bin:/bin', HOME: home, ANTHROPIC_API_KEY: 'sk-fake-key', CODEX_API_KEY: 'fake-codex-key', LANG: 'ko_KR.UTF-8' },
    homeDir: home,
    loginShell: SHELL,
    runner,
    settingsStore,
    logger: silentLogger,
    problems,
    checkDir: join(home, 'agent-check'),
    tempRoot: home,
    isExecutableFile: async (filePath) => filePath.startsWith(home) && isExecutableFileOnDisk(filePath),
    ...overrides,
  });
  /** 상태가 바뀔 때마다 기록한 진행 상태. */
  const progress: AgentCheckProgress[] = [];
  connection.onChange((state) => progress.push(state.progress));
  return { runner, settingsStore, connection, progress, problems, notifier };
}

/** `cliPath`를 `-p`로 띄운 실행(작동 확인, 선택·초안 실행) 요청인지 본다. */
function isRunRequest(cliPath: string) {
  return (request: ProcessRequest) => request.command === cliPath && request.args[0] === '-p';
}

/** 작동 확인 실행에 `reply`로 대답한다. */
function answerCheckRun(runner: FakeProcessRunner, cliPath: string, reply: FakeProcessReply): void {
  runner.respondWhen(isRunRequest(cliPath), reply);
}

/** 버전, 로그인, 작동 확인이 통과하도록 가짜 CLI의 대답을 정한다. */
function answerHealthyCli(runner: FakeProcessRunner, cliPath: string, version = '2.1.303 (Claude Code)'): void {
  runner.respond(cliPath, ['--version'], exited(0, `${version}\n`));
  runner.respond(cliPath, ['--restricted', 'auth', 'status'], exited(0, LOGGED_IN));
  answerCheckRun(runner, cliPath, exited(0, claudeSuccessStream({ ok: true }, version.split(' ')[0])));
}

describe('에이전트 연결 확인: 찾기', () => {
  it('macOS는 로그인 셸의 command -v로 CLI를 찾아 절대 경로를 설정에 저장한다', async () => {
    const cliPath = installCli('.local/bin');
    const { runner, settingsStore, connection, progress } = setup();
    runner.respondWhen(isShellRequest, exited(0, shellOutput([cliPath], SHELL_PATH)));
    answerHealthyCli(runner, cliPath);

    await connection.check();

    expect(progress.map((p) => (p.status === 'checking' ? p.step : p.status))).toEqual([
      'find',
      'version',
      'login',
      'run-check',
      'connected',
    ]);
    expect(connection.state().details).toMatchObject({ cliPath, cliCommand: 'claude', pathSource: 'login-shell' });
    expect(settingsStore.settings.agentCliPaths['claude-code']).toBe(cliPath);
    const shellRequest = runner.requests.find(isShellRequest);
    expect(shellRequest?.timeoutMs).toBe(5_000);
    expect(shellRequest?.args[1]).toContain('command -v claude');
    expect(shellRequest?.args[1]).toContain('printenv PATH');
  });

  it('command -v가 별칭 정의를 찍으면 로그인 셸 PATH에서 CLI를 찾는다', async () => {
    const cliPath = installCli('tools/bin');
    const { runner, connection } = setup();
    runner.respondWhen(isShellRequest, exited(0, shellOutput(["alias claude='claude --verbose'"], `/usr/bin:${join(home, 'tools/bin')}`)));
    answerHealthyCli(runner, cliPath);

    await connection.check();

    expect(connection.state().details.cliPath).toBe(cliPath);
    expect(connection.state().progress).toEqual({ status: 'connected' });
  });

  it('로그인 셸이 5초 안에 끝나지 않으면 알려진 설치 위치에서 찾고, 앱 PATH 앞에 CLI 폴더를 붙여 쓴다', async () => {
    const cliPath = installCli('.local/bin');
    const { runner, connection } = setup();
    runner.respondWhen(isShellRequest, { kind: 'timed-out', stdout: 'rc 파일이 입력을 기다림', stderr: '' });
    answerHealthyCli(runner, cliPath);

    await connection.check();

    expect(connection.state().details).toMatchObject({ cliPath, pathSource: 'app', cliCommand: `'${cliPath}'` });
    expect(connection.processEnv()?.PATH).toBe(`${join(home, '.local/bin')}:/usr/bin:/bin`);
  });

  it('어디에도 없으면 찾기에서 멈추고 찾아본 설치 위치를 남긴다', async () => {
    const { runner, settingsStore, connection } = setup();
    runner.respondWhen(isShellRequest, exited(1, shellOutput([], SHELL_PATH)));

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'find', reason: 'not-found' } });
    expect(connection.state().details.searchedDirs).toEqual([join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin']);
    expect(settingsStore.settings.agentCliPaths).toEqual({});
    expect(runner.requests.filter((request) => !isShellRequest(request))).toEqual([]);
  });

  it('저장한 경로가 있으면 다시 찾지 않고, 로그인 셸은 처음 한 번만 띄운다', async () => {
    const cliPath = installCli('custom');
    const { runner, settingsStore, connection } = setup();
    settingsStore.settings.agentCliPaths = { 'claude-code': cliPath };
    runner.respondWhen(isShellRequest, exited(0, shellOutput(['/somewhere/else/claude'], SHELL_PATH)));
    answerHealthyCli(runner, cliPath);

    await connection.check();
    await connection.check();

    expect(connection.state().details.cliPath).toBe(cliPath);
    expect(runner.requests.filter(isShellRequest)).toHaveLength(1);
  });

  it('저장한 경로가 사라졌으면 다시 찾아 새 경로를 저장한다', async () => {
    const cliPath = installCli('.local/bin');
    const { runner, settingsStore, connection } = setup();
    settingsStore.settings.agentCliPaths = { 'claude-code': join(home, 'removed/claude') };
    runner.respondWhen(isShellRequest, exited(0, shellOutput([cliPath], SHELL_PATH)));
    answerHealthyCli(runner, cliPath);

    await connection.check();

    expect(settingsStore.settings.agentCliPaths['claude-code']).toBe(cliPath);
  });

  it('다시 찾기는 저장한 경로가 있어도 로그인 셸부터 다시 찾는다', async () => {
    const oldPath = installCli('old');
    const newPath = installCli('.local/bin');
    const { runner, settingsStore, connection } = setup();
    settingsStore.settings.agentCliPaths = { 'claude-code': oldPath };
    runner.respondWhen(isShellRequest, exited(0, shellOutput([newPath], SHELL_PATH)));
    answerHealthyCli(runner, oldPath);
    answerHealthyCli(runner, newPath);

    await connection.check();
    await connection.rediscover();

    expect(runner.requests.filter(isShellRequest)).toHaveLength(2);
    expect(settingsStore.settings.agentCliPaths['claude-code']).toBe(newPath);
  });

  it('확인 중에 다시 찾기를 누르면 앞 확인의 결과는 버리고 새 확인의 결과를 보인다', async () => {
    const oldPath = installCli('old');
    const newPath = installCli('.local/bin');
    const { runner, settingsStore, connection } = setup();
    /** 앞 확인의 로그인 셸 대답을 늦추는 장치. */
    let releaseSlowShell: () => void = () => {};
    const slowShell = new Promise<void>((resolve) => {
      releaseSlowShell = resolve;
    });
    let shellCalls = 0;
    runner.respondWhen(isShellRequest, async () => {
      shellCalls += 1;
      if (shellCalls === 1) {
        await slowShell;
        return exited(0, shellOutput([oldPath], SHELL_PATH));
      }
      return exited(0, shellOutput([newPath], SHELL_PATH));
    });
    answerHealthyCli(runner, oldPath);
    answerHealthyCli(runner, newPath);

    const first = connection.check();
    await connection.rediscover();
    releaseSlowShell();
    await first;

    expect(connection.state().details.cliPath).toBe(newPath);
    expect(connection.state().progress).toEqual({ status: 'connected' });
    expect(settingsStore.settings.agentCliPaths['claude-code']).toBe(newPath);
  });

  it('직접 지정한 실행 파일을 저장하고 확인을 이어 간다', async () => {
    const cliPath = installCli('picked');
    const { runner, settingsStore, connection } = setup();
    runner.respondWhen(isShellRequest, exited(0, shellOutput([], SHELL_PATH)));
    answerHealthyCli(runner, cliPath);

    await connection.useCliPath(cliPath);

    expect(settingsStore.settings.agentCliPaths['claude-code']).toBe(cliPath);
    expect(connection.state().progress).toEqual({ status: 'connected' });
    expect(connection.state().details.cliCommand).toBe(`'${cliPath}'`);
  });

  it('직접 지정한 파일을 실행할 수 없으면 저장하지 않고 찾기에서 멈춘다', async () => {
    const notExecutable = join(home, 'notes.txt');
    writeFileSync(notExecutable, 'not a cli');
    const { settingsStore, connection } = setup();

    await connection.useCliPath(notExecutable);

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'find', reason: 'picked-invalid' } });
    expect(settingsStore.settings.agentCliPaths).toEqual({});
  });

  it('Windows는 앱이 받은 PATH에서 찾고 WindowsApps의 Claude 데스크톱 앱은 건너뛴다', async () => {
    const userHome = 'C:\\Users\\fake-user';
    const desktopApp = `${userHome}\\AppData\\Local\\Microsoft\\WindowsApps\\Claude.exe`;
    const cliPath = `${userHome}\\.local\\bin\\claude.exe`;
    // Windows 파일 시스템처럼 대소문자를 가리지 않고 본다.
    const files = new Set([desktopApp, cliPath].map((file) => file.toLowerCase()));
    const { runner, connection } = setup({
      platform: 'win32',
      env: { Path: `${userHome}\\AppData\\Local\\Microsoft\\WindowsApps;${userHome}\\.local\\bin`, PATHEXT: '.COM;.EXE;.BAT;.CMD;.PS1' },
      homeDir: userHome,
      isExecutableFile: async (filePath) => files.has(filePath.toLowerCase()),
    });
    answerHealthyCli(runner, cliPath);

    await connection.check();

    expect(runner.requests.some(isShellRequest)).toBe(false);
    expect(connection.state().details).toMatchObject({
      cliPath,
      pathSource: 'app',
      // 터미널에서 이름만 치면 데스크톱 앱이 먼저 실행되므로 절대 경로를 쓴다.
      cliCommand: `& '${cliPath}'`,
    });
  });

  it('Windows 데스크톱 앱을 직접 지정하면 받지 않는다', async () => {
    const desktopApp = 'C:\\Users\\fake-user\\AppData\\Local\\Microsoft\\WindowsApps\\Claude.exe';
    const { connection } = setup({ platform: 'win32', env: {}, homeDir: 'C:\\Users\\fake-user', isExecutableFile: async () => true });

    await connection.useCliPath(desktopApp);

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'find', reason: 'picked-invalid' } });
  });
});

describe('에이전트 연결 확인: 버전', () => {
  /** 로그인 셸이 `cliPath`를 가리키게 한 연결 확인. */
  function setupFound() {
    const cliPath = installCli('.local/bin');
    const context = setup();
    context.runner.respondWhen(isShellRequest, exited(0, shellOutput([cliPath], SHELL_PATH)));
    return { ...context, cliPath };
  }

  it('필수 플래그를 지원하지 않는 낮은 버전이면 업데이트 필요로 멈춘다', async () => {
    const { runner, connection, cliPath } = setupFound();
    // 2.1.258에는 --restricted는 있지만 --permission-prompts가 없다.
    answerHealthyCli(runner, cliPath, '2.1.258 (Claude Code)');

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'version', reason: 'update-required' } });
    expect(connection.state().details).toMatchObject({ version: '2.1.258', requiredVersion: '2.1.259', updateCommand: 'claude update' });
    expect(runner.requests.some((request) => request.args.includes('auth'))).toBe(false);
  });

  it('필수 플래그를 모두 처음 지원하는 2.1.259면 통과한다', async () => {
    const { runner, connection, cliPath } = setupFound();
    answerHealthyCli(runner, cliPath, '2.1.259 (Claude Code)');

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'connected' });
  });

  it('Homebrew cask 설치본은 업데이트 명령으로 brew 명령을 보인다', async () => {
    const realCli = installCli('homebrew/Caskroom/claude-code@latest/2.1.250');
    mkdirSync(join(home, 'homebrew/bin'), { recursive: true });
    const linkPath = join(home, 'homebrew/bin/claude');
    symlinkSync(realCli, linkPath);
    const { runner, connection } = setup();
    runner.respondWhen(isShellRequest, exited(0, shellOutput([linkPath], SHELL_PATH)));
    answerHealthyCli(runner, linkPath, '2.1.250 (Claude Code)');

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'version', reason: 'update-required' } });
    expect(connection.state().details).toMatchObject({ cliPath: linkPath, updateCommand: 'brew upgrade --cask claude-code@latest' });
  });

  it('버전 명령이 실패하면 오류 원문을 남기고 버전에서 멈춘다', async () => {
    const { runner, connection, cliPath } = setupFound();
    runner.respond(cliPath, ['--version'], exited(127, '', 'env: node: No such file or directory'));

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'version', reason: 'unreadable' } });
    expect(connection.state().details.errorOutput).toBe('env: node: No such file or directory');
  });
});

describe('에이전트 연결 확인: 로그인', () => {
  /** 찾기와 버전을 통과하는 연결 확인. */
  function setupVersioned() {
    const cliPath = installCli('.local/bin');
    const context = setup();
    context.runner.respondWhen(isShellRequest, exited(0, shellOutput([cliPath], SHELL_PATH)));
    context.runner.respond(cliPath, ['--version'], exited(0, '2.1.303 (Claude Code)\n'));
    return { ...context, cliPath };
  }

  it('로그인 상태를 실제 실행과 같은 환경(API 키 변수 제외, 로그인 셸 PATH, --restricted)으로 확인한다', async () => {
    const { runner, connection, cliPath } = setupVersioned();
    runner.respond(cliPath, ['--restricted', 'auth', 'status'], exited(0, LOGGED_IN));
    answerCheckRun(runner, cliPath, exited(0, claudeSuccessStream({ ok: true })));

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'connected' });
    expect(connection.state().details.authMethod).toBe('claude.ai');
    const authRequest = runner.requests.find((request) => request.args.includes('auth'));
    expect(authRequest?.env).toEqual({ PATH: SHELL_PATH, HOME: home, LANG: 'ko_KR.UTF-8' });
    expect(authRequest?.cwd).toBe(home);
  });

  it('로그인되어 있지 않으면(종료 코드 1) 로그인 필요로 멈춘다', async () => {
    const { runner, connection, cliPath } = setupVersioned();
    runner.respond(cliPath, ['--restricted', 'auth', 'status'], exited(1, NOT_LOGGED_IN));
    runner.respond(cliPath, ['auth', 'status'], exited(1, NOT_LOGGED_IN));

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'login', reason: 'not-logged-in' } });
    expect(connection.state().details.authMethod).toBe('none');
  });

  it('apiKeyHelper로만 인증하면 지원하지 않는 방식으로 멈춘다', async () => {
    const { runner, connection, cliPath } = setupVersioned();
    // --restricted는 사용자 설정의 apiKeyHelper를 무시하므로 로그인되지 않은 것으로 나온다.
    runner.respond(cliPath, ['--restricted', 'auth', 'status'], exited(1, NOT_LOGGED_IN));
    runner.respond(cliPath, ['auth', 'status'], exited(0, API_KEY_HELPER));

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'login', reason: 'api-key-helper' } });
    expect(connection.state().details.authMethod).toBe('api_key_helper');
  });

  it('로그인 상태 출력을 읽지 못하면 오류 원문을 남기고 로그인에서 멈춘다', async () => {
    const { runner, connection, cliPath } = setupVersioned();
    runner.respond(cliPath, ['--restricted', 'auth', 'status'], exited(1, '', "error: unknown command 'auth'"));

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'login', reason: 'unreadable' } });
    expect(connection.state().details.errorOutput).toBe("error: unknown command 'auth'");
  });
});

/** 찾기·버전·로그인을 통과하는 연결 확인. 작동 확인의 대답은 테스트가 정한다. */
function setupLoggedIn(overrides: Partial<AgentConnectionOptions> = {}, settings: Partial<Settings> = {}) {
  const cliPath = installCli('.local/bin');
  const context = setup(overrides, settings);
  context.runner.respondWhen(isShellRequest, exited(0, shellOutput([cliPath], SHELL_PATH)));
  context.runner.respond(cliPath, ['--version'], exited(0, '2.1.303 (Claude Code)\n'));
  context.runner.respond(cliPath, ['--restricted', 'auth', 'status'], exited(0, LOGGED_IN));
  return { ...context, cliPath };
}

/** 작동 확인으로 띄운 요청. */
function checkRunRequest(runner: FakeProcessRunner, cliPath: string): ProcessRequest | undefined {
  return runner.requests.find(isRunRequest(cliPath));
}

describe('에이전트 연결 확인: 작동 확인', () => {
  it('로그인까지 통과하면 실행 계약의 플래그 묶음으로 최소 스키마 실행을 한 번 돌리고, ok를 받으면 연결됨이 된다', async () => {
    const { runner, connection, cliPath } = setupLoggedIn();
    answerCheckRun(runner, cliPath, exited(0, claudeSuccessStream({ ok: true })));

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'connected' });
    expect(runner.requests.filter(isRunRequest(cliPath))).toHaveLength(1);
    const request = checkRunRequest(runner, cliPath);
    // 비어 있는 앱 전용 폴더에서 돌려 저장소나 홈 폴더를 읽을 수 없게 한다.
    expect(request?.cwd).toBe(join(home, 'agent-check'));
    expect(request?.args).toEqual(expect.arrayContaining(['--output-format', 'stream-json', '--restricted', '--permission-mode', 'dontAsk']));
    expect(JSON.parse(request?.args[request.args.indexOf('--json-schema') + 1] ?? 'null')).toMatchObject({
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    });
    expect(request?.args).not.toContain('--model');
    expect(request?.stdin).not.toBe('');
  });

  it('작동 확인은 앱이 구성한 환경(API 키 변수 제외, 로그인 셸 PATH)으로 돈다', async () => {
    const { runner, connection, cliPath } = setupLoggedIn();
    answerCheckRun(runner, cliPath, exited(0, claudeSuccessStream({ ok: true })));

    await connection.check();

    expect(checkRunRequest(runner, cliPath)?.env).toEqual({ PATH: SHELL_PATH, HOME: home, LANG: 'ko_KR.UTF-8' });
  });

  it('작동 확인은 고른 모델과 상관없이 기본 모델로 돌고, 추가 비밀 파일 패턴은 넣는다', async () => {
    // 모델 하나의 문제(사용량 한도 등)로 연결이 끊기면 모델 선택 상자도 사라져 되돌릴 수 없으므로 모델은 넘기지 않는다.
    const { runner, connection, cliPath } = setupLoggedIn({}, { agentModels: { 'claude-code': 'opus' }, extraSecretPatterns: ['*.secret'] });
    answerCheckRun(runner, cliPath, exited(0, claudeSuccessStream({ ok: true })));

    await connection.check();

    const args = checkRunRequest(runner, cliPath)?.args ?? [];
    expect(args).not.toContain('--model');
    expect(args[args.indexOf('--settings') + 1]).toContain('Read(//**/*.secret)');
  });

  it('작동 확인이 오류로 끝나면 작동 확인에서 멈추고 CLI가 알려 준 문장을 자세히에 남긴다', async () => {
    const { runner, connection, cliPath } = setupLoggedIn();
    /** 가짜 사용량 한도 문구. */
    const text = 'Claude usage limit reached. Your limit will reset at 3pm.';
    answerCheckRun(
      runner,
      cliPath,
      exited(1, claudeStream(fakeClaudeEvent.init(), fakeClaudeEvent.apiError('rate_limit', text), fakeClaudeEvent.result({ is_error: true, result: text }))),
    );

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'run-check', reason: 'run-failed' } });
    expect(connection.state().details.errorOutput).toBe(text);
  });

  it('작동 확인에서 로그인이 만료된 것이 드러나면 로그인 필요로 멈춘다', async () => {
    const { runner, connection, cliPath } = setupLoggedIn();
    answerCheckRun(runner, cliPath, exited(1, claudeNotLoggedInStream()));

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'login', reason: 'not-logged-in' } });
    expect(connection.state().details.errorOutput).toBe('Not logged in · Please run /login');
  });

  it('작동 확인이 제한 시간(60초)을 넘기면 작동 확인에서 멈춘다', async () => {
    const { runner, connection, cliPath } = setupLoggedIn();
    answerCheckRun(runner, cliPath, { kind: 'timed-out', stdout: claudeStream(fakeClaudeEvent.init()), stderr: '' });

    await connection.check();

    expect(checkRunRequest(runner, cliPath)?.timeoutMs).toBe(60_000);
    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'run-check', reason: 'run-failed' } });
    expect(connection.state().details.errorOutput).toBe('60초 안에 끝나지 않았습니다.');
  });

  it('스키마에 맞지 않는 결과면 작동 확인에서 멈춘다', async () => {
    const { runner, connection, cliPath } = setupLoggedIn();
    answerCheckRun(runner, cliPath, exited(0, claudeStream(fakeClaudeEvent.init(), fakeClaudeEvent.result({ result: '그냥 쓴 글' }))));

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'run-check', reason: 'run-failed' } });
  });
});

describe('에이전트 전역 문제', () => {
  it('감지를 시작한 뒤 CLI가 없으면 CLI 없음 전역 문제가 생기고, 다시 확인해 연결되면 사라진다', async () => {
    const { runner, connection, problems, notifier } = setup({}, { detectionStarted: true });
    runner.respondWhen(isShellRequest, exited(0, shellOutput([], SHELL_PATH)));

    await connection.check();

    expect(problems.current()?.problem).toEqual({ cause: 'agent', reason: 'cli-missing' });
    expect(notifier.sent).toHaveLength(1);

    const cliPath = installCli('.local/bin');
    answerHealthyCli(runner, cliPath);
    await connection.rediscover();

    expect(connection.state().progress).toEqual({ status: 'connected' });
    expect(problems.current()).toBeNull();
  });

  it.each([
    ['로그인 필요', exited(1, NOT_LOGGED_IN), 'not-logged-in'],
    ['apiKeyHelper', exited(0, API_KEY_HELPER), 'not-logged-in'],
  ] as const)('로그인 단계에서 멈추면(%s) 미로그인 전역 문제다', async (_label, unrestrictedReply, reason) => {
    const cliPath = installCli('.local/bin');
    const { runner, connection, problems } = setup({}, { detectionStarted: true });
    runner.respondWhen(isShellRequest, exited(0, shellOutput([cliPath], SHELL_PATH)));
    runner.respond(cliPath, ['--version'], exited(0, '2.1.303 (Claude Code)\n'));
    runner.respond(cliPath, ['--restricted', 'auth', 'status'], exited(1, NOT_LOGGED_IN));
    runner.respond(cliPath, ['auth', 'status'], unrestrictedReply);

    await connection.check();

    expect(problems.current()?.problem).toEqual({ cause: 'agent', reason });
  });

  it('필수 플래그를 지원하지 않는 버전이면 CLI 업데이트 필요 전역 문제다', async () => {
    const cliPath = installCli('.local/bin');
    const { runner, connection, problems } = setup({}, { detectionStarted: true });
    runner.respondWhen(isShellRequest, exited(0, shellOutput([cliPath], SHELL_PATH)));
    answerHealthyCli(runner, cliPath, '2.1.250 (Claude Code)');

    await connection.check();

    expect(problems.current()?.problem).toEqual({ cause: 'agent', reason: 'update-required' });
  });

  it('작동 확인이 실패하면 점검 실행 실패 전역 문제다', async () => {
    const { runner, connection, cliPath, problems } = setupLoggedIn({}, { detectionStarted: true });
    answerCheckRun(runner, cliPath, exited(1, '', 'error: something broke'));

    await connection.check();

    expect(problems.current()?.problem).toEqual({ cause: 'agent', reason: 'check-failed' });
  });

  it('감지를 시작하기 전에는 실패해도 전역 문제를 띄우지 않는다(필수 설정 전 화면이 보여 준다)', async () => {
    const { runner, connection, problems, notifier } = setup();
    runner.respondWhen(isShellRequest, exited(0, shellOutput([], SHELL_PATH)));

    await connection.check();

    expect(connection.state().progress).toMatchObject({ status: 'failed' });
    expect(problems.current()).toBeNull();
    expect(notifier.sent).toEqual([]);
  });
});

/** 감지를 시작한 뒤 연결까지 마친 연결 확인. */
async function setupConnected() {
  const context = setupLoggedIn({}, { detectionStarted: true });
  answerCheckRun(context.runner, context.cliPath, exited(0, claudeSuccessStream({ ok: true })));
  await context.connection.check();
  expect(context.connection.state().progress).toEqual({ status: 'connected' });
  return context;
}

/** 요청이 부른 CLI 명령. 선택·초안 실행과 작동 확인(`-p`)은 `-p`로만 적는다. */
function cliCommandOf(request: ProcessRequest): string {
  return request.args[0] === '-p' ? '-p' : request.args.join(' ');
}

describe('실행 직전 확인', () => {
  it('CLI 버전이 작동 확인 때와 같으면 버전만 읽고 실행해도 된다고 답한다. 로그인 확인과 작동 확인은 다시 하지 않는다', async () => {
    const { runner, connection } = await setupConnected();
    /** 연결 확인까지 받은 요청 수. */
    const before = runner.requests.length;

    await expect(connection.confirmForRun()).resolves.toBe(true);

    expect(runner.requests.slice(before).map(cliCommandOf)).toEqual(['--version']);
  });

  it('CLI 버전이 바뀌었으면 로그인 확인과 작동 확인을 먼저 돌리고, 통과하면 실행해도 된다고 답한다', async () => {
    const { runner, connection, cliPath } = await setupConnected();
    runner.respond(cliPath, ['--version'], exited(0, '2.1.310 (Claude Code)\n'));
    answerCheckRun(runner, cliPath, exited(0, claudeSuccessStream({ ok: true }, '2.1.310')));
    /** 연결 확인까지 받은 요청 수. */
    const before = runner.requests.length;

    await expect(connection.confirmForRun()).resolves.toBe(true);

    /** 실행 직전 확인이 부른 명령. */
    const commands = runner.requests.slice(before).map(cliCommandOf);
    expect(commands[0]).toBe('--version');
    expect(commands).toEqual(expect.arrayContaining(['--restricted auth status', '-p']));
    expect(connection.state().details.version).toBe('2.1.310');
  });

  it('바뀐 버전에서 작동 확인이 실패하면 실행하면 안 된다고 답하고, 점검 실행 실패 전역 문제를 한 번 알린다', async () => {
    const { runner, connection, cliPath, problems, notifier } = await setupConnected();
    runner.respond(cliPath, ['--version'], exited(0, '2.1.310 (Claude Code)\n'));
    answerCheckRun(runner, cliPath, exited(1, '', 'error: something broke'));

    await expect(connection.confirmForRun()).resolves.toBe(false);

    expect(connection.isConnected()).toBe(false);
    expect(problems.current()?.problem).toEqual({ cause: 'agent', reason: 'check-failed' });
    expect(notifier.sent).toHaveLength(1);
  });

  it('CLI가 필수 플래그를 지원하지 않는 낮은 버전으로 바뀌었으면 실행하면 안 된다고 답하고, CLI 업데이트 필요 전역 문제로 알린다', async () => {
    const { runner, connection, cliPath, problems } = await setupConnected();
    runner.respond(cliPath, ['--version'], exited(0, '2.1.250 (Claude Code)\n'));

    await expect(connection.confirmForRun()).resolves.toBe(false);

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'version', reason: 'update-required' } });
    expect(problems.current()?.problem).toEqual({ cause: 'agent', reason: 'update-required' });
  });

  it('CLI가 지워져 버전을 읽지 못하면 연결 확인을 처음부터 다시 돌려 CLI 없음 전역 문제로 알리고, 실행하면 안 된다고 답한다', async () => {
    const { runner, connection, cliPath, problems } = await setupConnected();
    rmSync(cliPath);
    runner.respond(cliPath, ['--version'], { kind: 'spawn-failed', message: `spawn ${cliPath} ENOENT` });

    await expect(connection.confirmForRun()).resolves.toBe(false);

    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'find', reason: 'not-found' } });
    expect(problems.current()?.problem).toEqual({ cause: 'agent', reason: 'cli-missing' });
  });

  it('연결 확인이 돌고 있으면 끝나기를 기다렸다가 그 결과로 답한다', async () => {
    const { runner, connection, cliPath } = await setupConnected();
    /** 로그인 확인의 대답을 늦추는 장치. */
    let releaseLogin: () => void = () => {};
    const slowLogin = new Promise<void>((resolve) => (releaseLogin = resolve));
    runner.respond(cliPath, ['--restricted', 'auth', 'status'], async () => {
      await slowLogin;
      return exited(1, NOT_LOGGED_IN);
    });
    runner.respond(cliPath, ['auth', 'status'], exited(1, NOT_LOGGED_IN));
    /** 칸을 열어 다시 하는 연결 확인. */
    const recheck = connection.check();
    /** 실행 직전 확인의 대답. 답하기 전이면 `null`. */
    let answer: boolean | null = null;
    /** 실행 직전 확인. */
    const confirming = connection.confirmForRun().then((ready) => (answer = ready));
    for (let turn = 0; turn < 20; turn += 1) await new Promise((resolve) => setImmediate(resolve));

    expect(answer).toBeNull();

    releaseLogin();
    await Promise.all([recheck, confirming]);
    expect(answer).toBe(false);
  });

  it('연결되어 있지 않으면 CLI를 띄우지 않고 실행하면 안 된다고 답한다', async () => {
    const { runner, connection } = setup();

    await expect(connection.confirmForRun()).resolves.toBe(false);

    expect(runner.requests).toEqual([]);
  });
});

describe('작동 확인을 다시 도는 때', () => {
  /** 초안 실행 입력. */
  function draftRun() {
    return {
      kind: 'draft' as const,
      instructions: '가짜 지침',
      input: '가짜 맥락',
      outputSchema: { type: 'object' },
      readRoots: [home],
      secretPatterns: [],
      model: null,
      timeoutMs: 600_000,
      signal: new AbortController().signal,
      onProgress: () => {},
    };
  }

  /** 연결 확인이 `auth status`를 부른 횟수. 연결 확인을 처음부터 돌릴 때마다 는다. */
  function loginChecks(runner: FakeProcessRunner): number {
    return runner.requests.filter((request) => request.args.join(' ') === '--restricted auth status').length;
  }

  it('다시 확인하는 동안에도 앞 확인이 연결이었으면 실패하기 전까지 연결로 본다', async () => {
    const { runner, connection, cliPath } = await setupConnected();
    /** 버전 대답을 늦추는 장치. */
    let releaseVersion: () => void = () => {};
    const slowVersion = new Promise<void>((resolve) => {
      releaseVersion = resolve;
    });
    runner.respond(cliPath, ['--version'], async () => {
      await slowVersion;
      return exited(0, '2.1.250 (Claude Code)\n');
    });

    const recheck = connection.rediscover();
    await Promise.resolve();
    expect(connection.state().progress).toMatchObject({ status: 'checking' });
    expect(connection.isConnected()).toBe(true);

    releaseVersion();
    await recheck;
    expect(connection.isConnected()).toBe(false);
  });

  it('연결 확인이 찾은 CLI와 환경으로 초안 실행을 띄운다', async () => {
    const { runner, connection, cliPath } = await setupConnected();
    runner.respondWhen(isRunRequest(cliPath), exited(0, claudeSuccessStream({ requirement: '가짜 요구' })));

    const { outcome } = await connection.executor.run(draftRun());

    expect(outcome).toEqual({ type: 'completed', output: { requirement: '가짜 요구' } });
    expect(runner.requests.at(-1)).toMatchObject({ command: cliPath, cwd: home, env: { PATH: SHELL_PATH, HOME: home, LANG: 'ko_KR.UTF-8' } });
  });

  it('실행이 미로그인으로 끝나면 전역 실패를 의심해 연결 확인을 처음부터 다시 돌린다', async () => {
    const { runner, connection, cliPath, problems } = await setupConnected();
    runner.respondWhen(isRunRequest(cliPath), exited(1, claudeNotLoggedInStream()));
    runner.respond(cliPath, ['--restricted', 'auth', 'status'], exited(1, NOT_LOGGED_IN));
    runner.respond(cliPath, ['auth', 'status'], exited(1, NOT_LOGGED_IN));

    await connection.executor.run(draftRun());
    await connection.check();

    expect(loginChecks(runner)).toBe(2);
    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'login', reason: 'not-logged-in' } });
    expect(problems.current()?.problem).toEqual({ cause: 'agent', reason: 'not-logged-in' });
  });

  it('실행이 결과 메시지 없이 끝나면(지원하지 않는 플래그 등) 연결 확인을 다시 돌린다', async () => {
    const { runner, connection, cliPath } = await setupConnected();
    runner.respondWhen(isRunRequest(cliPath), exited(1, '', "error: unknown option '--permission-prompts'"));

    await connection.executor.run(draftRun());
    await connection.check();

    expect(loginChecks(runner)).toBe(2);
    expect(connection.state().progress).toEqual({ status: 'failed', failure: { step: 'run-check', reason: 'run-failed' } });
  });

  it('실행에서 본 CLI 버전이 작동 확인 때와 다르면 작동 확인을 다시 돈다', async () => {
    const { runner, connection, cliPath } = await setupConnected();
    runner.respond(cliPath, ['--version'], exited(0, '2.1.310 (Claude Code)\n'));
    runner.respondWhen(isRunRequest(cliPath), exited(0, claudeSuccessStream({ ok: true }, '2.1.310')));

    await connection.executor.run(draftRun());
    await connection.check();

    expect(loginChecks(runner)).toBe(2);
    expect(connection.state().details.version).toBe('2.1.310');
    expect(connection.state().progress).toEqual({ status: 'connected' });
  });

  it('같은 버전으로 성공하거나 일시적 실패(과부하)로 끝나면 다시 확인하지 않는다', async () => {
    const { runner, connection, cliPath } = await setupConnected();
    runner.respondWhen(isRunRequest(cliPath), exited(0, claudeSuccessStream({ requirement: '가짜 요구' })));
    await connection.executor.run(draftRun());

    runner.respondWhen(
      isRunRequest(cliPath),
      exited(
        1,
        claudeStream(
          fakeClaudeEvent.init(),
          fakeClaudeEvent.apiError('overloaded', 'API Error: 529 Overloaded'),
          fakeClaudeEvent.result({ is_error: true, api_error_status: 529, result: 'API Error: 529 Overloaded' }),
        ),
      ),
    );
    await connection.executor.run(draftRun());

    expect(loginChecks(runner)).toBe(1);
  });
});
