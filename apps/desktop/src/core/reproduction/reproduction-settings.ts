import { isAbsolute } from 'node:path';
import type { ProcessRunner } from '../agent/process-runner';
import type { Logger } from '../logging/logger';
import type { AgentId } from '../ports/executor';
import { DEFAULT_SETTINGS, type ReproductionRepoSetting, type ReproductionToolMode, type Settings, type SettingsStore } from '../ports/settings-store';
import { SerialQueue } from '../serial-queue';
import { CODEX_MCP_CONFIG_ARGS, parseClaudeMcpServers, parseCodexMcpServers, type McpServerEntry } from './mcp-servers';

/** `codex mcp list --json`을 기다리는 시간(밀리초). 이 명령은 stdio 서버를 띄우지 않는다. */
const CODEX_LIST_TIMEOUT_MS = 15_000;

/** 재현 설정 화면의 저장소 한 줄. */
export interface ReproductionRepoState {
  /** 저장소 절대 경로. */
  path: string;
  /** 재현 허용 여부. */
  enabled: boolean;
  /** 재현용 환경 파일 절대 경로. `null`이면 지정하지 않은 것이라 원본 `.env`를 쓴다. */
  envFile: string | null;
  /** 지정한 환경 파일이 없어진 것을 마지막 확인에서 봤는지 여부. */
  envFileMissing: boolean;
}

/** 목록의 MCP 서버 한 줄과 `직접 선택`에서 켠 상태. */
export interface ReproductionServerState extends McpServerEntry {
  /** `직접 선택`에서 이 서버를 켰는지 여부. 새로 등록된 서버는 꺼진 채로 나타난다. */
  enabled: boolean;
}

/** MCP 서버 목록을 읽은 상태. */
export type ReproductionServersStatus = 'idle' | 'loading' | 'loaded';

/** 설정 창이 보일 재현 설정 상태. */
export interface ReproductionState {
  /** 재현을 지원하는 OS인지 여부. macOS만 참이고, 아니면 재현 항목과 `재현` 탭이 보이지 않는다. */
  supported: boolean;
  /** 재현 허용을 정할 수 있는 저장소. 매핑된 저장소마다 한 줄이다. */
  repos: ReproductionRepoState[];
  /** 재현 도구 권한. */
  tools: {
    /** 방식. */
    mode: ReproductionToolMode;
    /** MCP 서버 목록을 읽은 상태. */
    status: ReproductionServersStatus;
    /** 목록의 서버. Claude Code가 먼저, Codex가 다음이다. */
    servers: ReproductionServerState[];
    /** Codex 목록 명령이 실패해 Codex 서버를 읽지 못했는지 여부. */
    codexListFailed: boolean;
  };
}

/** 재현 허용이나 환경 파일을 바꾼 결과. */
export type ReproductionChangeOutcome =
  /** 저장했다. */
  | { kind: 'saved' }
  /** 이 OS는 재현을 지원하지 않는다. */
  | { kind: 'unsupported' }
  /** 매핑된 저장소가 아니다. */
  | { kind: 'not-mapped' }
  /** 환경 파일로 받을 수 없다(절대 경로가 아니거나 파일이 없다). */
  | { kind: 'invalid-env-file' };

/** 재현 설정에 필요한 것. */
export interface ReproductionSettingsOptions {
  /** 재현 허용과 재현 도구 권한을 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. 경로·서버 이름·서버 정의의 값은 남기지 않는다. */
  logger: Logger;
  /** 지금 OS. `darwin`만 재현을 지원한다. */
  platform: NodeJS.Platform;
  /** 지금 매핑된 저장소 절대 경로(Flow와 Sentry 매핑 모두). 중복은 이 모듈이 합친다. */
  mappedRepoPaths: () => string[];
  /** Claude Code 설정 파일(`~/.claude.json`)을 JSON으로 읽는다. 파일이 없거나 읽을 수 없으면 `null`. */
  readClaudeConfig: () => Promise<unknown | null>;
  /** 서버를 띄우지 않는 목록 명령을 돌릴 프로세스 실행기. */
  runner: ProcessRunner;
  /** Codex CLI와 자식 환경. 아직 찾지 못했으면 `null`이고, 이때 Codex 서버는 목록에 없다. */
  codexLaunch: () => { cliPath: string; env: Record<string, string> } | null;
  /** 목록 명령을 돌릴 작업 폴더. 저장소 안에서 돌리지 않는다. */
  cwd: string;
  /** 경로가 파일인지 본다. */
  isFile: (path: string) => Promise<boolean>;
}

/**
 * 저장소별 재현 허용과 재현용 환경 파일, 재현 도구 권한(MCP 서버 목록과 `직접 선택`)을 다루는 설정.
 * 실제 실행은 하지 않는다. 설정은 바꾸는 즉시 `settings.json`에 저장하고, MCP 서버 정의의 값은 읽자마자 버려
 * 화면·설정 파일·로그·메모리 어디에도 남기지 않는다. 서버 이름·종류·출처·앱이 뺀 도구만 쓴다.
 */
export class ReproductionSettings {
  /** 설정에서 읽어 둔 저장소별 설정. */
  private repos: Settings['reproductionRepos'] = {};
  /** 설정에서 읽어 둔 재현 도구 권한. */
  private tools: Settings['reproductionTools'] = structuredClone(DEFAULT_SETTINGS.reproductionTools);
  /** 마지막으로 읽은 MCP 서버 목록. 이름·종류·출처·앱이 뺀 도구만 있다. */
  private servers: McpServerEntry[] = [];
  /** 서버 목록을 읽은 상태. */
  private serversStatus: ReproductionServersStatus = 'idle';
  /** Codex 목록 명령이 마지막에 실패했는지 여부. */
  private codexListFailed = false;
  /** 마지막 목록 조회 번호. 늦게 끝난 앞선 조회의 결과를 버린다. */
  private serversLoadId = 0;
  /** 없어진 것으로 확인한 환경 파일. */
  private readonly missingEnvFiles = new Set<string>();
  /** 설정을 읽고 바꾸는 일이 서로 끼어들지 않게 한다. */
  private readonly updates = new SerialQueue();
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: ReproductionSettingsOptions) {}

  /** 재현을 지원하는 OS인지 여부. */
  get supported(): boolean {
    return this.options.platform === 'darwin';
  }

  /** 저장된 재현 설정을 읽는다. 서버 목록과 환경 파일 확인은 `refresh*`가 한다. */
  async load(): Promise<void> {
    await this.updates.run(async () => {
      /** 저장된 설정. */
      const settings = await this.options.settingsStore.load();
      this.repos = settings.reproductionRepos;
      this.tools = settings.reproductionTools;
    });
    this.emit();
  }

  /** 지금 상태. 매핑된 저장소가 없어진 설정은 보이지 않는다(설정은 지우지 않고 다시 매핑하면 살아난다). */
  state(): ReproductionState {
    /** 켜 둔 서버 이름의 집합. 에이전트별이다. */
    const enabled = (agent: AgentId): ReadonlySet<string> => new Set(this.tools.enabledServers[agent] ?? []);
    return {
      supported: this.supported,
      repos: this.supported
        ? [...new Set(this.options.mappedRepoPaths())].map((path) => {
            /** 이 저장소의 설정. */
            const setting = this.repos[path];
            /** 지정한 환경 파일. */
            const envFile = setting?.envFile ?? null;
            return {
              path,
              enabled: setting?.enabled ?? false,
              envFile,
              envFileMissing: envFile !== null && this.missingEnvFiles.has(envFile),
            };
          })
        : [],
      tools: {
        mode: this.tools.mode,
        status: this.serversStatus,
        servers: this.servers.map((server) => ({ ...server, deniedTools: [...server.deniedTools], enabled: enabled(server.agent).has(server.name) })),
        codexListFailed: this.codexListFailed,
      },
    };
  }

  /**
   * 저장소의 재현 허용과 재현용 환경 파일. 진단을 시작할 때 쓴다. 재현을 지원하지 않는 OS이거나 설정한 적 없으면 `null`.
   * 환경 파일이 없어졌는지는 보지 않는다(없으면 사본을 만들지 못해 그 진단의 재현이 불가(환경 실패)가 된다).
   */
  settingFor(path: string): ReproductionRepoSetting | null {
    /** 저장소의 설정. */
    const setting = this.supported ? this.repos[path] : undefined;
    return setting ? { enabled: setting.enabled, envFile: setting.envFile ?? null } : null;
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 저장소 칸을 열 때 지정한 환경 파일이 아직 있는지 다시 확인한다. */
  async refreshRepos(): Promise<void> {
    if (!this.supported) return;
    /** 확인할 환경 파일. */
    const envFiles = [...new Set(Object.values(this.repos).flatMap((setting) => (setting.envFile === null ? [] : [setting.envFile])))];
    /** 확인 결과. */
    const found = await Promise.all(envFiles.map(async (path) => [path, await this.options.isFile(path)] as const));
    for (const [path, exists] of found) {
      if (exists) this.missingEnvFiles.delete(path);
      else this.missingEnvFiles.add(path);
    }
    this.emit();
  }

  /**
   * 에이전트 칸 `재현` 탭을 열 때 MCP 서버 목록을 다시 읽는다. Claude Code는 설정 파일을 직접 읽고,
   * Codex는 서버를 띄우지 않는 목록 명령을 쓴다. 읽은 정의의 값은 버리고 이름·종류·출처·앱이 뺀 도구만 남긴다.
   */
  async refreshServers(): Promise<void> {
    if (!this.supported) return;
    /** 이 조회의 번호. */
    const loadId = ++this.serversLoadId;
    this.serversStatus = 'loading';
    this.emit();

    /** 읽은 서버. */
    const [claude, codex] = await Promise.all([this.readClaudeServers(), this.readCodexServers()]);
    // 더 늦게 시작한 조회가 있으면 이 결과는 버린다.
    if (loadId !== this.serversLoadId) return;
    this.servers = [...claude, ...(codex?.servers ?? [])];
    this.codexListFailed = codex !== null && !codex.ok;
    this.serversStatus = 'loaded';
    this.emit();
  }

  /**
   * 저장소의 재현 허용을 켜거나 끈다. 켤 때 `envFile`을 함께 주면 재현용 환경 파일로 저장한다(`undefined`면 저장해 둔 값을 그대로 둔다).
   * 끄면 환경 파일 지정은 남겨 두어, 다시 켤 때 이어서 쓴다.
   */
  async setRepoEnabled(path: string, enabled: boolean, envFile?: string | null): Promise<ReproductionChangeOutcome> {
    if (!this.supported) return { kind: 'unsupported' };
    if (!this.options.mappedRepoPaths().includes(path)) return { kind: 'not-mapped' };
    if (enabled && envFile && !(await this.acceptableEnvFile(envFile))) return { kind: 'invalid-env-file' };
    await this.save((settings) => {
      /** 지금 이 저장소의 설정. */
      const current = settings.reproductionRepos[path] ?? { enabled: false, envFile: null };
      return {
        ...settings,
        reproductionRepos: {
          ...settings.reproductionRepos,
          [path]: { enabled, envFile: enabled && envFile !== undefined ? envFile : current.envFile },
        },
      };
    });
    return { kind: 'saved' };
  }

  /** 재현을 켠 저장소의 재현용 환경 파일을 바꾼다. `null`은 지정 해제(원본 `.env` 사용)다. */
  async setEnvFile(path: string, envFile: string | null): Promise<ReproductionChangeOutcome> {
    if (!this.supported) return { kind: 'unsupported' };
    if (!this.options.mappedRepoPaths().includes(path)) return { kind: 'not-mapped' };
    if (envFile !== null && !(await this.acceptableEnvFile(envFile))) return { kind: 'invalid-env-file' };
    await this.save((settings) => {
      /** 지금 이 저장소의 설정. */
      const current = settings.reproductionRepos[path] ?? { enabled: false, envFile: null };
      return { ...settings, reproductionRepos: { ...settings.reproductionRepos, [path]: { ...current, envFile } } };
    });
    return { kind: 'saved' };
  }

  /** 재현 도구 권한의 방식을 바꾼다. */
  async setToolMode(mode: ReproductionToolMode): Promise<void> {
    if (!this.supported) return;
    await this.save((settings) => ({ ...settings, reproductionTools: { ...settings.reproductionTools, mode } }));
  }

  /**
   * `직접 선택`에서 서버 하나를 켜거나 끈다. 에이전트별로 서버 **이름**만 저장한다.
   * 목록에 없는 서버는 켜지 못하고, 이미 저장된 이름(목록에서 사라진 서버)은 끌 수 있다.
   */
  async setServerEnabled(agent: AgentId, name: string, enabled: boolean): Promise<void> {
    if (!this.supported) return;
    /** 이 서버가 지금 목록에 있는지 여부. */
    const listed = this.servers.some((server) => server.agent === agent && server.name === name);
    if (enabled && !listed) {
      this.options.logger.warn('reproduction.server-rejected', { agent });
      return;
    }
    await this.save((settings) => {
      /** 이 에이전트에서 켠 서버 이름. */
      const current = settings.reproductionTools.enabledServers[agent] ?? [];
      /** 바꾼 이름 목록. */
      const names = enabled ? [...new Set([...current, name])] : current.filter((existing) => existing !== name);
      /** 바꾼 에이전트별 목록. 비면 그 에이전트의 값을 지운다. */
      const enabledServers = { ...settings.reproductionTools.enabledServers };
      if (names.length === 0) delete enabledServers[agent];
      else enabledServers[agent] = names;
      return { ...settings, reproductionTools: { ...settings.reproductionTools, enabledServers } };
    });
  }

  /** 환경 파일로 받을 수 있는지 본다. 절대 경로이고 파일이어야 한다. */
  private async acceptableEnvFile(path: string): Promise<boolean> {
    return isAbsolute(path) && (await this.options.isFile(path));
  }

  /** Claude Code 설정 파일에서 서버를 읽는다. 읽지 못하면 비어 있다. */
  private async readClaudeServers(): Promise<McpServerEntry[]> {
    try {
      return parseClaudeMcpServers(await this.options.readClaudeConfig(), [...new Set(this.options.mappedRepoPaths())]);
    } catch {
      // 깨진 JSON의 오류 메시지에는 파일 내용 조각(환경 변수, 헤더)이 들어갈 수 있어 오류 원문은 남기지 않는다.
      this.options.logger.warn('reproduction.claude-config-unreadable');
      return [];
    }
  }

  /** `codex mcp list --json`으로 Codex 서버를 읽는다. Codex를 찾지 못했으면 `null`이다. */
  private async readCodexServers(): Promise<{ ok: boolean; servers: McpServerEntry[] } | null> {
    /** Codex CLI와 자식 환경. */
    const launch = this.options.codexLaunch();
    if (!launch) return null;
    /** 명령 결과. */
    const result = await this.options.runner.run({
      command: launch.cliPath,
      args: ['mcp', 'list', '--json', ...CODEX_MCP_CONFIG_ARGS],
      env: launch.env,
      cwd: this.options.cwd,
      timeoutMs: CODEX_LIST_TIMEOUT_MS,
    });
    if (result.kind !== 'exited' || result.exitCode !== 0) {
      // 출력에 서버 정의의 평문 값이 있을 수 있어 로그에는 끝난 방식만 남긴다.
      this.options.logger.warn('reproduction.codex-list-failed', { kind: result.kind });
      return { ok: false, servers: [] };
    }
    try {
      return { ok: true, servers: parseCodexMcpServers(JSON.parse(result.stdout)) };
    } catch {
      this.options.logger.warn('reproduction.codex-list-failed', { kind: 'unparsable' });
      return { ok: false, servers: [] };
    }
  }

  /** 설정을 다시 읽어 `change`로 바꿔 저장한 뒤 알린다. 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 읽는다. */
  private async save(change: (settings: Settings) => Settings): Promise<void> {
    await this.updates.run(async () => {
      /** 저장 직전의 설정. */
      const current = await this.options.settingsStore.load();
      /** 바꾼 설정. */
      const next = change(current);
      await this.options.settingsStore.save(next);
      this.repos = next.reproductionRepos;
      this.tools = next.reproductionTools;
    });
    this.emit();
  }

  /** 구독자에게 알린다. */
  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
