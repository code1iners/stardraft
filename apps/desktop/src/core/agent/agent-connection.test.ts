import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { exited, FakeProcessRunner } from '../fakes/fake-process-runner';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { createLogger } from '../logging/logger';
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
const LOGGED_IN = JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' });

/** 로그인되지 않았을 때 `claude auth status`의 실제 출력 모양(2.1.303, 종료 코드 1). */
const NOT_LOGGED_IN = JSON.stringify({ loggedIn: false, authMethod: 'none', apiProvider: 'firstParty' });

/** `apiKeyHelper`만 설정했을 때 `claude auth status`의 실제 출력 모양(2.1.303, 종료 코드 0). */
const API_KEY_HELPER = JSON.stringify({ loggedIn: true, authMethod: 'api_key_helper', apiProvider: 'firstParty', apiKeySource: 'apiKeyHelper' });

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
function setup(overrides: Partial<AgentConnectionOptions> = {}) {
  const runner = new FakeProcessRunner();
  const settingsStore = new MemorySettingsStore();
  const connection = new AgentConnection({
    platform: 'darwin',
    env: { PATH: '/usr/bin:/bin', HOME: home, ANTHROPIC_API_KEY: 'sk-fake-key', CODEX_API_KEY: 'fake-codex-key', LANG: 'ko_KR.UTF-8' },
    homeDir: home,
    loginShell: SHELL,
    runner,
    settingsStore,
    logger: silentLogger,
    isExecutableFile: async (filePath) => filePath.startsWith(home) && isExecutableFileOnDisk(filePath),
    ...overrides,
  });
  /** 상태가 바뀔 때마다 기록한 진행 상태. */
  const progress: AgentCheckProgress[] = [];
  connection.onChange((state) => progress.push(state.progress));
  return { runner, settingsStore, connection, progress };
}

/** 버전과 로그인이 통과하도록 가짜 CLI의 대답을 정한다. */
function answerHealthyCli(runner: FakeProcessRunner, cliPath: string, version = '2.1.303 (Claude Code)'): void {
  runner.respond(cliPath, ['--version'], exited(0, `${version}\n`));
  runner.respond(cliPath, ['--restricted', 'auth', 'status'], exited(0, LOGGED_IN));
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
      'awaiting-run-check',
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
    expect(connection.state().progress).toEqual({ status: 'awaiting-run-check' });
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
    expect(connection.state().progress).toEqual({ status: 'awaiting-run-check' });
    expect(settingsStore.settings.agentCliPaths['claude-code']).toBe(newPath);
  });

  it('직접 지정한 실행 파일을 저장하고 확인을 이어 간다', async () => {
    const cliPath = installCli('picked');
    const { runner, settingsStore, connection } = setup();
    runner.respondWhen(isShellRequest, exited(0, shellOutput([], SHELL_PATH)));
    answerHealthyCli(runner, cliPath);

    await connection.useCliPath(cliPath);

    expect(settingsStore.settings.agentCliPaths['claude-code']).toBe(cliPath);
    expect(connection.state().progress).toEqual({ status: 'awaiting-run-check' });
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

    expect(connection.state().progress).toEqual({ status: 'awaiting-run-check' });
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

    await connection.check();

    expect(connection.state().progress).toEqual({ status: 'awaiting-run-check' });
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
