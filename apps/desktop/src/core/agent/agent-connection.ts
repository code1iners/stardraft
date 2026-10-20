import { errorFields, type Logger } from '../logging/logger';
import type { AgentId } from '../ports/executor';
import type { SettingsStore } from '../ports/settings-store';
import {
  CLAUDE_COMMAND_NAME,
  CLI_COMMAND_TIMEOUT_MS,
  compareVersions,
  MIN_CLAUDE_VERSION,
  parseClaudeAuthStatus,
  parseCliVersion,
} from './claude-cli';
import {
  agentProcessEnv,
  envValue,
  findInDirs,
  findOnPath,
  isExcludedCandidate,
  isExecutableFileOnDisk,
  knownInstallDirs,
  parentDir,
  prependPathEntry,
  readLoginShell,
  terminalCommand,
  type CliSearchContext,
} from './cli-discovery';
import type { ProcessResult, ProcessRunner } from './process-runner';

/** 에이전트 연결 확인의 네 단계. 화면의 연결선 네 마디다. 작동 확인(`run-check`)은 다음 단계에서 더한다. */
export type AgentCheckStep = 'find' | 'version' | 'login' | 'run-check';

/** 연결 확인이 멈춘 이유. 단계마다 고치는 법이 다르다. */
export type AgentCheckFailure =
  /** 찾아본 곳 어디에도 CLI가 없다. 설치 명령과 "직접 지정"으로 고친다. */
  | { step: 'find'; reason: 'not-found' }
  /** 직접 지정한 파일을 실행할 수 없다. */
  | { step: 'find'; reason: 'picked-invalid' }
  /** 필수 플래그를 지원하지 않는 낮은 버전이다. 업데이트 명령으로 고친다. */
  | { step: 'version'; reason: 'update-required' }
  /** 버전 명령이 실패했거나 출력에서 버전을 읽지 못했다. */
  | { step: 'version'; reason: 'unreadable' }
  /** 로그인되어 있지 않다. 로그인 명령으로 고친다. */
  | { step: 'login'; reason: 'not-logged-in' }
  /** `apiKeyHelper`로만 인증한다. 실행 계약의 `--restricted`가 이 방식을 무시하므로 Claude 계정으로 로그인해야 한다. */
  | { step: 'login'; reason: 'api-key-helper' }
  /** 로그인 상태 명령이 실패했거나 출력을 읽지 못했다. */
  | { step: 'login'; reason: 'unreadable' };

/** 연결 확인의 진행 상태. */
export type AgentCheckProgress =
  /** 아직 확인하지 않았다. */
  | { status: 'idle' }
  /** 이 단계를 확인하고 있다. */
  | { status: 'checking'; step: AgentCheckStep }
  /** 이 단계에서 멈췄다. */
  | { status: 'failed'; failure: AgentCheckFailure }
  /** 찾기·버전·로그인을 통과했고 작동 확인이 남았다. */
  | { status: 'awaiting-run-check' };

/** "자세히"에만 보이는 확인 내용. */
export interface AgentCheckDetails {
  /** 찾은 CLI의 절대 경로. */
  cliPath: string | null;
  /** 터미널에서 이 CLI를 부르는 말. 명령 카드의 명령 앞에 붙는다. */
  cliCommand: string;
  /** 읽은 CLI 버전. */
  version: string | null;
  /** 필요한 가장 낮은 버전. */
  requiredVersion: string;
  /** 로그인 방식(`claude.ai`, `api_key_helper` 등). */
  authMethod: string | null;
  /** 자식 프로세스 PATH를 어디서 얻었는지. `login-shell`은 로그인 셸, `app`은 앱이 받은 PATH다. */
  pathSource: 'login-shell' | 'app' | null;
  /** PATH 말고 찾아본 알려진 설치 위치. */
  searchedDirs: string[];
  /** 실패한 CLI 명령의 오류 원문. */
  errorOutput: string | null;
}

/** 에이전트 칸이 그릴 연결 상태. */
export interface AgentConnectionState {
  /** 확인하는 에이전트. */
  agent: AgentId;
  /** 진행 상태. */
  progress: AgentCheckProgress;
  /** "자세히" 내용. */
  details: AgentCheckDetails;
}

/** 연결 확인에 필요한 OS 사실과 포트. */
export interface AgentConnectionOptions {
  /** 실행 중인 OS. */
  platform: NodeJS.Platform;
  /** 앱이 받은 환경 변수. */
  env: Readonly<Record<string, string | undefined>>;
  /** 사용자 홈 폴더. CLI 명령의 작업 폴더로도 쓴다. */
  homeDir: string;
  /** macOS의 로그인 셸 절대 경로(`$SHELL`). */
  loginShell: string;
  /** CLI와 로그인 셸을 띄우는 실행기. */
  runner: ProcessRunner;
  /** 찾은 CLI 경로를 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. CLI 출력 원문은 남기지 않는다. */
  logger: Logger;
  /** 실행할 수 있는 파일인지 본다. 테스트가 Windows 경로를 흉내 낼 때만 바꾼다. */
  isExecutableFile?: (filePath: string) => Promise<boolean>;
}

/** 자식 프로세스에 쓸 PATH와 그 출처. */
interface ChildPath {
  /** PATH 값. */
  path: string;
  /** 어디서 얻었는지. */
  source: 'login-shell' | 'app';
  /** 로그인 셸의 `command -v` 결과. */
  commandPath: string | null;
}

/** 확인 하나를 어떻게 시작했는지. */
type CheckStart =
  /** 저장한 경로가 있으면 그대로 쓴다(칸을 열 때, 다시 확인). */
  | { kind: 'saved' }
  /** 저장한 경로를 무시하고 다시 찾는다. */
  | { kind: 'rediscover' }
  /** 사용자가 고른 파일을 쓴다. */
  | { kind: 'picked'; cliPath: string };

/** 단계 하나의 결과. 통과하면 다음 단계로 간다. */
type StepResult = { ok: true } | { ok: false; failure: AgentCheckFailure };

/** 찾기 단계의 결과. 찾았으면 CLI 경로와 그 CLI에 쓸 PATH, 저장한 경로와 다른지를 담는다. */
type FindResult =
  | { ok: true; cliPath: string; childPath: ChildPath; changed: boolean }
  | { ok: false; failure: AgentCheckFailure };

/** 연결 확인하는 에이전트. Codex는 뒤 티켓이 더한다. */
const AGENT: AgentId = 'claude-code';

/**
 * 에이전트 연결 확인. 설정 "에이전트" 칸을 열면 Claude Code CLI를 찾고, 버전과 로그인을 차례로 확인한다.
 * 찾은 절대 경로는 `settings.json`에 두고, 그 경로가 사라졌거나 다시 찾을 때만 다시 찾는다.
 * 로그인 셸에서 읽은 PATH는 자식 프로세스 환경에 쓰려고 들고 있는다.
 */
export class AgentConnection {
  /** 지금 상태. */
  private current: AgentConnectionState;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(state: AgentConnectionState) => void>();
  /** 마지막으로 읽은 자식 프로세스 PATH. 로그인 셸은 필요할 때만 다시 띄운다. */
  private childPath: ChildPath | null = null;
  /** 진행 중인 확인. 칸을 다시 열어도 같은 확인을 기다린다. */
  private running: Promise<void> | null = null;
  /** 확인마다 올리는 번호. 새 확인이 시작되면 앞 확인의 결과를 버린다. */
  private generation = 0;
  /** CLI 찾기에 쓰는 OS 사실. */
  private readonly search: CliSearchContext;

  constructor(private readonly options: AgentConnectionOptions) {
    this.search = {
      platform: options.platform,
      env: options.env,
      homeDir: options.homeDir,
      isExecutableFile: options.isExecutableFile ?? isExecutableFileOnDisk,
    };
    this.current = { agent: AGENT, progress: { status: 'idle' }, details: this.emptyDetails() };
  }

  /** 지금 연결 상태. */
  state(): AgentConnectionState {
    return this.current;
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: (state: AgentConnectionState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 저장한 경로로 확인한다. 칸을 열 때와 [다시 확인]에 쓴다. 이미 확인 중이면 그 확인을 기다린다. */
  check(): Promise<void> {
    return this.running ?? this.start({ kind: 'saved' });
  }

  /** 저장한 경로를 무시하고 로그인 셸부터 다시 찾는다. */
  rediscover(): Promise<void> {
    return this.start({ kind: 'rediscover' });
  }

  /** 사용자가 직접 지정한 파일로 확인한다. 실행할 수 있으면 저장한다. */
  useCliPath(cliPath: string): Promise<void> {
    return this.start({ kind: 'picked', cliPath });
  }

  /** 찾은 CLI 경로. 아직 못 찾았으면 `null`. */
  cliPath(): string | null {
    return this.current.details.cliPath;
  }

  /** 에이전트 CLI 자식 프로세스의 환경 변수. 아직 PATH를 읽지 않았으면 `null`. */
  processEnv(): Record<string, string> | null {
    return this.childPath && agentProcessEnv(this.options.env, this.childPath.path, this.options.platform);
  }

  /** 새 확인을 시작한다. 진행 중이던 확인의 결과는 버린다. */
  private start(how: CheckStart): Promise<void> {
    this.generation += 1;
    /** 이번 확인의 번호. */
    const generation = this.generation;
    /** 이번 확인. */
    const run = this.runCheck(how, generation)
      .catch((error: unknown) => this.options.logger.error('agent.check-crashed', { agent: AGENT, ...errorFields(error) }))
      .finally(() => {
        if (this.running === run) this.running = null;
      });
    this.running = run;
    return run;
  }

  /** 찾기 → 버전 → 로그인을 차례로 확인하고, 실패한 단계에서 멈춘다. */
  private async runCheck(how: CheckStart, generation: number): Promise<void> {
    /** 이 확인이 아직 마지막 확인인지 본다. 아니면 결과를 버린다. */
    const isCurrent = () => generation === this.generation;
    /** 이번 확인에서 모은 "자세히" 내용. */
    const details = this.emptyDetails();
    /** 상태를 바꾼다. 앞 확인이면 바꾸지 않는다. */
    const publish = (progress: AgentCheckProgress) => {
      if (isCurrent()) this.setState({ agent: AGENT, progress, details: { ...details } });
    };

    // 1. 찾기
    publish({ status: 'checking', step: 'find' });
    /** 찾기 결과. */
    const found = await this.find(how, details);
    if (!isCurrent()) return;
    if (!found.ok) return this.fail(publish, found.failure);
    // 앞 확인이 늦게 끝나 새 확인의 경로를 덮지 않게, 마지막 확인일 때만 PATH를 들고 경로를 저장한다.
    this.childPath = found.childPath;
    if (found.changed) await this.saveCliPath(found.cliPath);
    if (!isCurrent()) return;

    // 2. 버전
    publish({ status: 'checking', step: 'version' });
    /** 버전 확인 결과. */
    const version = await this.checkVersion(details);
    if (!isCurrent()) return;
    if (!version.ok) return this.fail(publish, version.failure);

    // 3. 로그인
    publish({ status: 'checking', step: 'login' });
    /** 로그인 확인 결과. */
    const login = await this.checkLogin(details);
    if (!isCurrent()) return;
    if (!login.ok) return this.fail(publish, login.failure);

    this.options.logger.info('agent.check-passed', { agent: AGENT, version: details.version, authMethod: details.authMethod });
    publish({ status: 'awaiting-run-check' });
  }

  /** 실패를 알리고 로그에 남긴다. */
  private fail(publish: (progress: AgentCheckProgress) => void, failure: AgentCheckFailure): void {
    this.options.logger.warn('agent.check-failed', { agent: AGENT, step: failure.step, reason: failure.reason });
    publish({ status: 'failed', failure });
  }

  /** CLI의 절대 경로와 자식 프로세스 PATH를 정한다. 상태와 설정은 바꾸지 않는다. */
  private async find(how: CheckStart, details: AgentCheckDetails): Promise<FindResult> {
    /** 저장된 설정. */
    const settings = await this.options.settingsStore.load();
    /** 저장된 CLI 경로. */
    const saved = settings.agentCliPaths[AGENT] ?? null;

    /** 정한 CLI 경로. */
    let cliPath: string | null = null;
    if (how.kind === 'picked') {
      if (isExcludedCandidate(how.cliPath, this.options.platform) || !(await this.search.isExecutableFile(how.cliPath))) {
        details.cliPath = how.cliPath;
        return { ok: false, failure: { step: 'find', reason: 'picked-invalid' } };
      }
      cliPath = how.cliPath;
    } else if (how.kind === 'saved' && saved !== null && (await this.search.isExecutableFile(saved))) {
      cliPath = saved;
    }

    // 저장한 경로를 그대로 쓰면 로그인 셸은 처음 한 번만 띄운다. 다시 찾을 때는 설치 뒤 바뀐 PATH를 읽으려고 다시 띄운다.
    /** 자식 프로세스 PATH. */
    const childPath = cliPath !== null && this.childPath ? this.childPath : await this.readChildPath();
    if (cliPath === null) cliPath = await this.searchCli(childPath, details);

    details.pathSource = childPath.source;
    if (cliPath === null) return { ok: false, failure: { step: 'find', reason: 'not-found' } };

    // 로그인 셸을 읽지 못하면 npm 설치본이 옆의 node를 찾을 수 있게 CLI 폴더를 PATH 앞에 붙인다.
    /** 이 CLI로 자식 프로세스를 띄울 때 쓸 PATH. */
    const usedPath: ChildPath =
      childPath.source === 'app'
        ? { ...childPath, path: prependPathEntry(childPath.path, parentDir(cliPath, this.options.platform), this.options.platform) }
        : childPath;
    details.cliPath = cliPath;
    details.cliCommand = await this.terminalCommandFor(cliPath, childPath);
    return { ok: true, cliPath, childPath: usedPath, changed: cliPath !== saved };
  }

  /** PATH와 알려진 설치 위치에서 CLI를 찾는다. 못 찾으면 `null`이다. */
  private async searchCli(childPath: ChildPath, details: AgentCheckDetails): Promise<string | null> {
    // 로그인 셸의 `command -v`가 가리킨 파일이 CLI면 그것을 쓴다.
    if (
      childPath.commandPath !== null &&
      !isExcludedCandidate(childPath.commandPath, this.options.platform) &&
      (await this.search.isExecutableFile(childPath.commandPath))
    ) {
      return childPath.commandPath;
    }

    /** PATH에서 찾은 파일. */
    const onPath = await findOnPath(CLAUDE_COMMAND_NAME, childPath.path, this.search, { skipExcluded: true });
    if (onPath !== null) return onPath;

    /** 알려진 설치 위치. */
    const dirs = knownInstallDirs(this.search);
    details.searchedDirs = dirs;
    return findInDirs(CLAUDE_COMMAND_NAME, dirs, this.search);
  }

  /** 자식 프로세스 PATH를 읽는다. macOS는 로그인 셸을 한 번 띄우고, Windows와 셸 읽기 실패는 앱이 받은 PATH를 쓴다. */
  private async readChildPath(): Promise<ChildPath> {
    /** 앱이 받은 PATH. */
    const appPath: ChildPath = { path: envValue(this.options.env, 'PATH', this.options.platform) ?? '', source: 'app', commandPath: null };
    if (this.options.platform === 'win32') return appPath;

    /** 로그인 셸을 읽은 결과. */
    const read = await readLoginShell({
      runner: this.options.runner,
      shell: this.options.loginShell,
      env: definedEnv(this.options.env),
      cwd: this.options.homeDir,
      commandName: CLAUDE_COMMAND_NAME,
    });
    if (read.kind === 'read') return { path: read.path, source: 'login-shell', commandPath: read.commandPath };

    this.options.logger.warn('agent.login-shell-unreadable', {
      shell: this.options.loginShell,
      result: read.kind,
      ...(read.kind === 'failed' ? { detail: read.detail } : {}),
    });
    return appPath;
  }

  /** 터미널에서 이 CLI를 부르는 말. 터미널에서 이름만 쳤을 때 같은 파일이 실행되면 이름을 쓴다. */
  private async terminalCommandFor(cliPath: string, childPath: ChildPath): Promise<string> {
    /** 터미널에서 이름만 쳤을 때 실행될 파일. Windows 데스크톱 앱처럼 CLI가 아닌 파일이 앞서도 그대로 찾는다. */
    const resolved =
      childPath.source === 'login-shell' && childPath.commandPath !== null
        ? childPath.commandPath
        : await findOnPath(CLAUDE_COMMAND_NAME, childPath.path, this.search, { skipExcluded: false });
    return terminalCommand(cliPath, CLAUDE_COMMAND_NAME, resolved === cliPath, this.options.platform);
  }

  /** 찾은 CLI 경로를 설정에 저장한다. 저장하지 못해도 이번 확인은 이어 간다. */
  private async saveCliPath(cliPath: string): Promise<void> {
    try {
      /** 저장 직전의 설정. 다른 칸의 변경을 덮지 않게 다시 읽는다. */
      const settings = await this.options.settingsStore.load();
      await this.options.settingsStore.save({ ...settings, agentCliPaths: { ...settings.agentCliPaths, [AGENT]: cliPath } });
    } catch (error) {
      this.options.logger.error('agent.cli-path-save-failed', { agent: AGENT, ...errorFields(error) });
    }
  }

  /** `claude --version`으로 필수 플래그를 지원하는 버전인지 본다. */
  private async checkVersion(details: AgentCheckDetails): Promise<StepResult> {
    /** 버전 명령 결과. */
    const result = await this.runCli(details, ['--version']);
    /** 출력에서 읽은 버전. */
    const version = result.kind === 'exited' && result.exitCode === 0 ? parseCliVersion(result.stdout) : null;
    if (version === null) {
      details.errorOutput = errorOutputOf(result);
      return { ok: false, failure: { step: 'version', reason: 'unreadable' } };
    }

    details.version = version;
    if (compareVersions(version, MIN_CLAUDE_VERSION) < 0) return { ok: false, failure: { step: 'version', reason: 'update-required' } };
    return { ok: true };
  }

  /**
   * 로그인을 확인한다. 실제 실행처럼 `--restricted`를 붙여, 앱 실행에서 무시되는 `apiKeyHelper`를 로그인으로 치지 않는다.
   * 로그인이 안 되어 있으면 `--restricted` 없이 한 번 더 물어 `apiKeyHelper` 방식인지 가린다.
   */
  private async checkLogin(details: AgentCheckDetails): Promise<StepResult> {
    /** 실제 실행과 같은 조건의 로그인 상태. */
    const restricted = await this.runCli(details, ['--restricted', 'auth', 'status']);
    /** 읽은 로그인 상태. 로그인되지 않았으면 종료 코드 1로 끝나므로 종료 코드는 보지 않는다. */
    const status = restricted.kind === 'exited' ? parseClaudeAuthStatus(restricted.stdout) : null;
    if (status === null) {
      details.errorOutput = errorOutputOf(restricted);
      return { ok: false, failure: { step: 'login', reason: 'unreadable' } };
    }
    if (status.loggedIn) {
      details.authMethod = status.authMethod;
      return { ok: true };
    }

    /** 사용자 설정까지 본 로그인 상태. */
    const unrestricted = await this.runCli(details, ['auth', 'status']);
    /** 사용자 설정의 로그인 방식. */
    const userAuthMethod = unrestricted.kind === 'exited' ? parseClaudeAuthStatus(unrestricted.stdout)?.authMethod ?? null : null;
    details.authMethod = userAuthMethod ?? status.authMethod;
    if (userAuthMethod === 'api_key_helper') return { ok: false, failure: { step: 'login', reason: 'api-key-helper' } };
    return { ok: false, failure: { step: 'login', reason: 'not-logged-in' } };
  }

  /** 이번 확인에서 찾은 CLI를 앱이 실제로 쓰는 환경 변수로 실행한다. 찾기 단계를 통과한 뒤에만 부른다. */
  private runCli(details: AgentCheckDetails, args: string[]): Promise<ProcessResult> {
    return this.options.runner.run({
      command: details.cliPath ?? '',
      args,
      env: this.processEnv() ?? {},
      cwd: this.options.homeDir,
      timeoutMs: CLI_COMMAND_TIMEOUT_MS,
    });
  }

  /** 아직 아무것도 확인하지 않은 "자세히" 내용. */
  private emptyDetails(): AgentCheckDetails {
    return {
      cliPath: null,
      cliCommand: CLAUDE_COMMAND_NAME,
      version: null,
      requiredVersion: MIN_CLAUDE_VERSION,
      authMethod: null,
      pathSource: null,
      searchedDirs: [],
      errorOutput: null,
    };
  }

  /** 상태를 바꾸고 듣는 쪽에 알린다. */
  private setState(state: AgentConnectionState): void {
    this.current = state;
    for (const listener of this.listeners) listener(state);
  }
}

/** 오류 원문의 최대 길이. 넘으면 앞부분만 보인다. */
const ERROR_OUTPUT_MAX_LENGTH = 2_000;

/** 실패한 CLI 명령의 오류 원문. "자세히"에만 보인다. */
function errorOutputOf(result: ProcessResult): string {
  if (result.kind === 'spawn-failed') return result.message;
  /** 받은 출력 전체. */
  const output = [result.stderr.trim(), result.stdout.trim()].filter((part) => part !== '').join('\n');
  /** 출력이 없을 때 남길 한 줄. */
  const fallback =
    result.kind === 'timed-out'
      ? `${CLI_COMMAND_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`
      : `종료 코드 ${String(result.exitCode)}로 끝났습니다.`;
  return (output || fallback).slice(0, ERROR_OUTPUT_MAX_LENGTH);
}

/** 값이 있는 환경 변수만 남긴다. */
function definedEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
