import { mkdir, realpath } from 'node:fs/promises';
import { errorFields, type Logger } from '../logging/logger';
import type { AgentId, Executor, ExecutorFailureReason, ExecutorOutcome } from '../ports/executor';
import type { SettingsStore } from '../ports/settings-store';
import type { AgentProblemReason, GlobalProblems } from '../problems/global-problems';
import { CHECK_RUN_INPUT, CHECK_RUN_INSTRUCTIONS, CHECK_RUN_SCHEMA, CHECK_RUN_TIMEOUT_MS, isCheckRunPassed } from './check-run';
import {
  CLAUDE_COMMAND_NAME,
  claudeUpdateCommand,
  CLI_COMMAND_TIMEOUT_MS,
  compareVersions,
  MIN_CLAUDE_VERSION,
  parseClaudeAuthStatus,
  parseCliVersion,
} from './claude-cli';
import { ClaudeCodeExecutor, type ClaudeLaunch, type ClaudeRunReport } from './claude-code-executor';
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

/** 에이전트 연결 확인의 네 단계. 화면의 연결선 네 마디다. 넷째 `run-check`는 점검 실행(화면 이름 "작동 확인")이다. */
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
  | { step: 'login'; reason: 'unreadable' }
  /** 점검 실행이 실패했다(시간 초과, 사용량 한도, 스키마에 맞지 않는 결과 등). */
  | { step: 'run-check'; reason: 'run-failed' };

/** 연결 확인의 진행 상태. */
export type AgentCheckProgress =
  /** 아직 확인하지 않았다. */
  | { status: 'idle' }
  /** 이 단계를 확인하고 있다. */
  | { status: 'checking'; step: AgentCheckStep }
  /** 이 단계에서 멈췄다. */
  | { status: 'failed'; failure: AgentCheckFailure }
  /** 네 단계를 모두 통과했다. 에이전트 연결이다. */
  | { status: 'connected' };

/** 자식 프로세스 PATH의 출처. `login-shell`은 로그인 셸에서 읽은 PATH, `app`은 앱이 받은 PATH다. */
export type PathSource = 'login-shell' | 'app';

/** "자세히"에만 보이는 확인 내용. */
export interface AgentCheckDetails {
  /** 찾은 CLI의 절대 경로. */
  cliPath: string | null;
  /** 터미널에서 이 CLI를 부르는 말. 명령 카드의 명령 앞에 붙는다. */
  cliCommand: string;
  /** 이 CLI를 업데이트하는 명령. 설치 방법(Homebrew 등)에 따라 다르다. */
  updateCommand: string;
  /** 읽은 CLI 버전. */
  version: string | null;
  /** 필요한 가장 낮은 버전. */
  requiredVersion: string;
  /** 로그인 방식(`claude.ai`, `api_key_helper` 등). */
  authMethod: string | null;
  /** 자식 프로세스 PATH를 어디서 얻었는지. 아직 읽지 않았으면 `null`. */
  pathSource: PathSource | null;
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
  /** 감지를 시작한 뒤 연결이 끊기면 알릴 전역 문제. */
  problems: Pick<GlobalProblems, 'raise' | 'resolve'>;
  /** 점검 실행의 작업 폴더. 앱 전용 빈 폴더라 에이전트가 읽을 것이 없다. 없으면 만든다. */
  checkDir: string;
  /** 실행마다 지침 파일을 둘 임시 폴더를 만들 곳. 없으면 OS 임시 폴더다. */
  tempRoot?: string;
  /** 실행할 수 있는 파일인지 본다. 테스트가 Windows 경로를 흉내 낼 때만 바꾼다. */
  isExecutableFile?: (filePath: string) => Promise<boolean>;
}

/** 자식 프로세스에 쓸 PATH와 그 출처. */
interface ChildPath {
  /** PATH 값. */
  path: string;
  /** 어디서 얻었는지. */
  source: PathSource;
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

/** 전역 실패를 의심할 실행 실패. 이 실패로 끝나면 연결 확인을 처음부터 다시 돌린다. 과부하·네트워크 같은 일시적 실패는 넣지 않는다. */
const SUSPECTED_GLOBAL_FAILURES: readonly ExecutorFailureReason[] = ['cli-missing', 'cli-error', 'not-logged-in'];

/**
 * 에이전트 연결 확인. Claude Code CLI를 찾고, 버전, 로그인, 작동 확인(점검 실행)을 차례로 확인한다.
 * 앱을 시작할 때와 설정 "에이전트" 칸을 열 때 돌고, 실행이 전역 실패를 의심하게 끝나거나 CLI 버전이 바뀐 것을 알아채면 다시 돈다.
 * 찾은 절대 경로는 `settings.json`에 두고, 그 경로가 사라졌거나 다시 찾을 때만 다시 찾는다.
 * 로그인 셸에서 읽은 PATH는 자식 프로세스 환경에 쓰려고 들고 있는다.
 */
export class AgentConnection {
  /** Claude Code 실행기. 점검 실행과 선택·초안 실행이 이 연결 확인이 찾은 CLI와 환경으로 돈다. */
  readonly executor: Executor;
  /** 지금 상태. */
  private current: AgentConnectionState;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(state: AgentConnectionState) => void>();
  /** 마지막으로 읽은 자식 프로세스 PATH. 로그인 셸은 필요할 때만 다시 띄운다. */
  private childPath: ChildPath | null = null;
  /** 마지막 확인이 찾은 CLI 경로. 실행기가 이 경로로 띄운다. */
  private cliPath: string | null = null;
  /** 작동 확인을 통과한 CLI 버전. 연결되지 않았으면 `null`. 실행에서 다른 버전을 보면 다시 확인한다. */
  private confirmedVersion: string | null = null;
  /** 진행 중인 확인의 점검 실행을 끊는 장치. 새 확인이 시작되면 앞 확인의 점검 실행을 끊는다. */
  private runAbort: AbortController | null = null;
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
    this.executor = new ClaudeCodeExecutor({
      runner: options.runner,
      launch: () => this.launch(),
      ...(options.tempRoot === undefined ? {} : { tempRoot: options.tempRoot }),
      onRunFinished: (report) => this.recheckAfterRun(report),
    });
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

  /** 저장한 경로로 확인한다. 앱 시작, 칸을 열 때, [다시 확인]에 쓴다. 이미 확인 중이면 그 확인을 기다린다. */
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

  /**
   * 에이전트 연결인지 여부. 마지막으로 끝난 확인이 네 단계를 모두 통과했으면 참이다.
   * 칸을 열 때마다 다시 확인하므로, 다시 확인하는 동안에도 실패하기 전까지는 연결로 본다.
   */
  isConnected(): boolean {
    return this.confirmedVersion !== null;
  }

  /** 에이전트 CLI 자식 프로세스의 환경 변수. 아직 PATH를 읽지 않았으면 `null`. */
  processEnv(): Record<string, string> | null {
    return this.childPath && agentProcessEnv(this.options.env, this.childPath.path, this.options.platform);
  }

  /** 실행기가 띄울 CLI와 자식 환경. 아직 CLI를 찾지 못했으면 `null`. */
  private launch(): ClaudeLaunch | null {
    /** 자식 환경. */
    const env = this.processEnv();
    return this.cliPath !== null && env ? { cliPath: this.cliPath, env } : null;
  }

  /** 선택·초안 실행이 끝나면 결과를 보고, 전역 실패가 의심되거나 CLI 버전이 바뀌었으면 연결 확인을 다시 돌린다. */
  private recheckAfterRun({ kind, cliVersion, outcome }: ClaudeRunReport): void {
    if (kind === 'check') return;
    if (outcome.type === 'failed' && SUSPECTED_GLOBAL_FAILURES.includes(outcome.reason)) {
      this.options.logger.warn('agent.global-failure-suspected', { agent: AGENT, reason: outcome.reason });
      void this.check();
      return;
    }
    if (cliVersion !== null && this.confirmedVersion !== null && cliVersion !== this.confirmedVersion) {
      this.options.logger.info('agent.cli-version-changed', { agent: AGENT, from: this.confirmedVersion, to: cliVersion });
      void this.check();
    }
  }

  /** 새 확인을 시작한다. 진행 중이던 확인의 결과는 버리고 점검 실행은 끊는다. */
  private start(how: CheckStart): Promise<void> {
    this.generation += 1;
    /** 이번 확인의 번호. */
    const generation = this.generation;
    this.runAbort?.abort();
    /** 이번 확인의 점검 실행을 끊는 장치. */
    const abort = new AbortController();
    this.runAbort = abort;
    /** 이번 확인. */
    const run = this.runCheck(how, generation, abort.signal)
      .catch((error: unknown) => this.options.logger.error('agent.check-crashed', { agent: AGENT, ...errorFields(error) }))
      .finally(() => {
        if (this.running === run) this.running = null;
      });
    this.running = run;
    return run;
  }

  /** 찾기 → 버전 → 로그인 → 작동 확인을 차례로 확인하고, 실패한 단계에서 멈춘다. */
  private async runCheck(how: CheckStart, generation: number, signal: AbortSignal): Promise<void> {
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
    if (!found.ok) return this.fail(publish, found.failure, isCurrent);
    // 앞 확인이 늦게 끝나 새 확인의 경로를 덮지 않게, 마지막 확인일 때만 PATH를 들고 경로를 저장한다.
    this.childPath = found.childPath;
    this.cliPath = found.cliPath;
    if (found.changed) await this.saveCliPath(found.cliPath);
    if (!isCurrent()) return;

    // 2. 버전
    publish({ status: 'checking', step: 'version' });
    /** 버전 확인 결과. */
    const version = await this.checkVersion(found.cliPath, details);
    if (!isCurrent()) return;
    if (!version.ok) return this.fail(publish, version.failure, isCurrent);

    // 3. 로그인
    publish({ status: 'checking', step: 'login' });
    /** 로그인 확인 결과. */
    const login = await this.checkLogin(found.cliPath, details);
    if (!isCurrent()) return;
    if (!login.ok) return this.fail(publish, login.failure, isCurrent);

    // 4. 작동 확인
    publish({ status: 'checking', step: 'run-check' });
    /** 작동 확인 결과. */
    const working = await this.checkWorking(details, signal);
    if (!isCurrent()) return;
    if (!working.ok) return this.fail(publish, working.failure, isCurrent);

    this.confirmedVersion = details.version;
    this.options.logger.info('agent.connected', { agent: AGENT, version: details.version, authMethod: details.authMethod });
    publish({ status: 'connected' });
    this.options.problems.resolve('agent');
  }

  /** 실패를 알리고 로그에 남긴다. 감지를 시작한 뒤면 전역 문제로도 알린다. */
  private async fail(
    publish: (progress: AgentCheckProgress) => void,
    failure: AgentCheckFailure,
    isCurrent: () => boolean,
  ): Promise<void> {
    this.confirmedVersion = null;
    this.options.logger.warn('agent.check-failed', { agent: AGENT, step: failure.step, reason: failure.reason });
    publish({ status: 'failed', failure });

    // 감지를 시작하기 전에는 필수 설정 전 화면이 에이전트 상태를 보여 주므로 전역 문제로 띄우지 않는다.
    /** 감지를 시작했는지 여부. */
    const { detectionStarted } = await this.options.settingsStore.load();
    if (!isCurrent()) return;
    if (detectionStarted) this.options.problems.raise({ cause: 'agent', reason: agentProblemReason(failure) });
    else this.options.problems.resolve('agent');
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
    details.updateCommand = claudeUpdateCommand(await realpath(cliPath).catch(() => cliPath), details.cliCommand);
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
  private async checkVersion(cliPath: string, details: AgentCheckDetails): Promise<StepResult> {
    /** 버전 명령 결과. */
    const result = await this.runCli(cliPath, ['--version']);
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
  private async checkLogin(cliPath: string, details: AgentCheckDetails): Promise<StepResult> {
    /** 실제 실행과 같은 조건의 로그인 상태. */
    const restricted = await this.runCli(cliPath, ['--restricted', 'auth', 'status']);
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
    const unrestricted = await this.runCli(cliPath, ['auth', 'status']);
    /** 사용자 설정의 로그인 방식. */
    const userAuthMethod = unrestricted.kind === 'exited' ? parseClaudeAuthStatus(unrestricted.stdout)?.authMethod ?? null : null;
    details.authMethod = userAuthMethod ?? status.authMethod;
    if (userAuthMethod === 'api_key_helper') return { ok: false, failure: { step: 'login', reason: 'api-key-helper' } };
    return { ok: false, failure: { step: 'login', reason: 'not-logged-in' } };
  }

  /**
   * 점검 실행을 한 번 돌린다. 실제 실행과 같은 플래그 묶음과 비밀 파일 패턴으로 최소 스키마 결과를 받는다.
   * 모델은 넘기지 않는다. 고른 모델 하나의 문제(사용량 한도 등)는 전역 실패가 아니고, 연결이 끊기면 모델 선택 상자도 사라져 되돌릴 수 없기 때문이다.
   * 로그인 상태 명령은 로컬 기록만 보므로, 여기서 로그인 만료가 드러나면 로그인 필요로 멈춘다.
   */
  private async checkWorking(details: AgentCheckDetails, signal: AbortSignal): Promise<StepResult> {
    /** 추가 비밀 파일 패턴을 읽을 설정. */
    const settings = await this.options.settingsStore.load();
    await mkdir(this.options.checkDir, { recursive: true });
    /** 점검 실행 결과. */
    const outcome = await this.executor.run({
      kind: 'check',
      instructions: CHECK_RUN_INSTRUCTIONS,
      input: CHECK_RUN_INPUT,
      outputSchema: CHECK_RUN_SCHEMA,
      readRoots: [this.options.checkDir],
      secretPatterns: settings.extraSecretPatterns,
      model: null,
      timeoutMs: CHECK_RUN_TIMEOUT_MS,
      signal,
      onProgress: () => {},
    });
    if (outcome.type === 'completed' && isCheckRunPassed(outcome.output)) return { ok: true };

    details.errorOutput = checkRunErrorOutput(outcome);
    if (outcome.type === 'failed' && outcome.reason === 'not-logged-in') return { ok: false, failure: { step: 'login', reason: 'not-logged-in' } };
    return { ok: false, failure: { step: 'run-check', reason: 'run-failed' } };
  }

  /** 찾은 CLI를 앱이 실제로 쓰는 환경 변수로 실행한다. 찾기 단계를 통과한 뒤에만 부른다. */
  private runCli(cliPath: string, args: string[]): Promise<ProcessResult> {
    return this.options.runner.run({
      command: cliPath,
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
      updateCommand: `${CLAUDE_COMMAND_NAME} update`,
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
    result.kind === 'exited'
      ? `종료 코드 ${String(result.exitCode)}로 끝났습니다.`
      : result.kind === 'timed-out'
        ? `${CLI_COMMAND_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`
        : '확인을 중단했습니다.';
  return (output || fallback).slice(0, ERROR_OUTPUT_MAX_LENGTH);
}

/** 점검 실행이 통과하지 못한 까닭. "자세히"에만 보인다. */
function checkRunErrorOutput(outcome: ExecutorOutcome): string {
  switch (outcome.type) {
    case 'completed':
      return '작동 확인 결과가 ok가 아닙니다.';
    case 'invalid-output':
    case 'failed':
      return outcome.detail;
    case 'timed-out':
      return `${CHECK_RUN_TIMEOUT_MS / 1000}초 안에 끝나지 않았습니다.`;
    case 'cancelled':
      return '작동 확인을 중단했습니다.';
  }
}

/** 연결 확인이 멈춘 이유를 전역 문제의 이유로 바꾼다. 버전·로그인 상태를 읽지 못한 것은 점검 실행 실패로 본다. */
function agentProblemReason(failure: AgentCheckFailure): AgentProblemReason {
  switch (failure.step) {
    case 'find':
      return 'cli-missing';
    case 'version':
      return failure.reason === 'update-required' ? 'update-required' : 'check-failed';
    case 'login':
      return failure.reason === 'unreadable' ? 'check-failed' : 'not-logged-in';
    case 'run-check':
      return 'check-failed';
  }
}

/** 값이 있는 환경 변수만 남긴다. */
function definedEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
}
