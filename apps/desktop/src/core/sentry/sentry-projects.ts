import { resolve } from 'node:path';
import { errorFields, type Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { ConnectSentry, SentryApiFailure, SentryOrganization } from '../ports/sentry-api';
import type { SentryLevel, SentryProjectRegistration, SettingsStore } from '../ports/settings-store';
import { isFolder, type MappedRepoStatus } from '../repos/repo-mappings';
import { rejectedFolderReason, type RejectedFolder } from '../repos/folder-rules';
import { SerialQueue } from '../serial-queue';
import type { SentryConnectionState } from './sentry-connection';

/** 프로젝트를 등록할 때 `event:read`를 확인하는 scope 이름. 실패하면 이 이름을 짚어 알린다. */
export const SENTRY_EVENT_SCOPE = 'event:read';

/** 레벨 필터로 고를 수 있는 레벨. 심각한 순서다. */
export const SENTRY_LEVELS: readonly SentryLevel[] = ['fatal', 'error', 'warning', 'info', 'debug'];

/** 레벨 필터의 기본값. */
export const DEFAULT_SENTRY_LEVELS: readonly SentryLevel[] = ['error', 'fatal'];

/** 환경 필터의 기본값으로 고르는 환경 이름. */
export const DEFAULT_SENTRY_ENVIRONMENT = 'production';

/** 환경 이름의 최대 길이. 이보다 긴 값은 환경 이름이 아니다. */
const ENVIRONMENT_MAX_LENGTH = 64;

/** 등록할 수 있는 Sentry 프로젝트 하나. 조직 목록과 프로젝트 목록에서 읽은 값이다. */
export interface SentryProjectCandidate {
  /** 프로젝트 ID. */
  projectId: string;
  /** 프로젝트 slug. */
  projectSlug: string;
  /** 화면에 보일 프로젝트 이름. */
  projectName: string;
  /** 프로젝트가 속한 조직 ID. */
  organizationId: string;
  /** 조직 slug. */
  organizationSlug: string;
  /** 화면에 보일 조직 이름. */
  organizationName: string;
  /** 프로젝트에 이벤트가 들어온 환경. */
  environments: string[];
}

/** 등록할 프로젝트 목록을 받지 못한 이유. */
export type SentryCandidatesFailure =
  /** 연결한 토큰이 없거나 "토큰 확인 필요"다. */
  | 'no-token'
  /** 토큰이 거부됐다(`401`). */
  | 'unauthorized'
  /** 토큰에 `org:read` scope가 없다(`403`). */
  | 'scope-missing'
  | 'network'
  | 'rate-limited'
  | 'unexpected';

/** 등록할 프로젝트 목록의 상태. */
export type SentryCandidatesState =
  /** 아직 받지 않았다. */
  | { status: 'idle' }
  /** 받고 있다. */
  | { status: 'loading' }
  /** 받았다. `incomplete`는 일부 조직의 목록을 받지 못했다는 뜻이다. */
  | { status: 'loaded'; projects: SentryProjectCandidate[]; incomplete: boolean }
  /** 받지 못했다. */
  | { status: 'failed'; reason: SentryCandidatesFailure };

/** 등록한 프로젝트에 닿는지 확인한 상태. */
export type SentryProjectAccess =
  /** 아직 확인하지 못했다. 닿는 것으로 보인다. */
  | 'unchecked'
  /** 오류 이슈 목록을 읽을 수 있다. */
  | 'ok'
  /** `404`이거나 접근이 거부됐다. 그 프로젝트만 멈춘다. */
  | 'inaccessible';

/** 등록한 프로젝트의 Sentry 저장소 매핑. */
export interface SentryRepoState {
  /** 저장소 폴더의 절대 경로. */
  path: string;
  /** 폴더가 있는지 확인한 상태. */
  status: MappedRepoStatus;
}

/** 등록한 프로젝트 하나와 그 상태. */
export interface SentryProjectState {
  /** 등록. */
  registration: SentryProjectRegistration;
  /** 프로젝트에 닿는지 확인한 상태. */
  access: SentryProjectAccess;
  /** 매핑된 저장소. 매핑이 없으면 `null`. */
  repo: SentryRepoState | null;
}

/** 설정 창이 보일 Sentry 프로젝트 등록과 저장소 매핑의 상태. */
export interface SentryProjectsState {
  /** 등록한 프로젝트. 등록한 순서다. */
  projects: SentryProjectState[];
  /** 등록할 수 있는 프로젝트 목록. */
  candidates: SentryCandidatesState;
}

/** 프로젝트 등록과 편집이 받는 값. */
export interface SentryProjectInput {
  /** 환경 필터. `null`이면 모든 환경이다. */
  environment: string | null;
  /** 레벨 필터. 하나 이상이다. */
  levels: readonly SentryLevel[];
  /** 저장소 폴더. 매핑하지 않으면 `null`. */
  repoPath: string | null;
}

/** 프로젝트를 등록하지 못한 이유. */
export type SentryRegisterFailure =
  /** 연결한 토큰이 없다. */
  | 'no-token'
  /** "토큰 확인 필요"라 등록할 수 없다. */
  | 'token-problem'
  /** 등록할 수 있는 프로젝트 목록에 없다. */
  | 'unknown-project'
  /** 이미 등록했다. */
  | 'already-registered'
  /** 필터 값이 맞지 않는다. */
  | 'invalid-filter'
  /** 토큰이 거부됐다(`401`). */
  | 'unauthorized'
  /** 토큰에 `event:read` scope가 없다(`403`). */
  | 'scope-missing'
  /** 프로젝트를 찾을 수 없거나 이 토큰으로 볼 수 없다(`404`). */
  | 'project-unavailable'
  | 'network'
  | 'rate-limited'
  | 'unexpected'
  /** 확인은 됐지만 설정에 저장하지 못했다. */
  | 'save-failed';

/** 프로젝트 등록의 결과. */
export type SentryRegisterOutcome =
  /** 등록했다. `rejected`는 받지 않은 저장소 폴더(네트워크·WSL)다. 이 경우 저장소 없이 등록한다. */
  | { kind: 'registered'; rejected: RejectedFolder | null }
  /** 등록하지 못했다. 아무것도 바꾸지 않았다. */
  | { kind: 'failed'; reason: SentryRegisterFailure };

/** 프로젝트 편집의 결과. */
export type SentryUpdateOutcome =
  /** 저장했다. `rejected`는 받지 않은 저장소 폴더다. 이 경우 저장소는 그대로 둔다. */
  | { kind: 'updated'; rejected: RejectedFolder | null }
  /** 저장하지 못했다. 아무것도 바꾸지 않았다. */
  | { kind: 'failed'; reason: 'not-registered' | 'invalid-filter' | 'save-failed' };

/** Sentry 프로젝트 등록에 필요한 것. */
export interface SentryProjectsOptions {
  /** 토큰 하나로 Sentry API를 부르는 클라이언트를 만든다. */
  connectSentry: ConnectSentry;
  /** 지금 쓰는 토큰과 조직, "토큰 확인 필요", 거절 보고를 가진 Sentry 연결. */
  connection: {
    token(): string | null;
    state(): SentryConnectionState;
    reportApiFailure(token: string, failure: SentryApiFailure): void;
  };
  /** 등록과 매핑을 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 기준 시각을 재는 시계. */
  clock: Clock;
  /** 진단 로그. 토큰, 프로젝트와 조직 이름, 경로는 남기지 않는다. */
  logger: Logger;
}

/**
 * 진단할 Sentry 프로젝트의 등록과 저장소 매핑. 등록은 프로젝트 ID가 키이고, 등록한 시각이 기준 시각이다.
 * 등록은 토큰이 `event:read`로 그 프로젝트의 오류 이슈를 읽을 수 있을 때만 한다. 이 모듈은 감지를 돌리지 않는다.
 */
export class SentryProjects {
  /** 등록한 프로젝트. 키는 프로젝트 ID다. */
  private registrations: Record<string, SentryProjectRegistration> = {};
  /** Sentry 저장소 매핑. 키는 프로젝트 ID다. */
  private mappings: Record<string, string[]> = {};
  /** 프로젝트마다 닿는지 확인한 상태. */
  private readonly access = new Map<string, SentryProjectAccess>();
  /** 저장소 폴더마다 확인한 상태. 여러 프로젝트가 같은 폴더를 가리키면 하나를 같이 쓴다. */
  private readonly folderStatuses = new Map<string, MappedRepoStatus>();
  /** 폴더별 마지막 확인 번호. 늦게 끝난 앞선 확인의 결과를 버린다. */
  private readonly checkIds = new Map<string, number>();
  /** 확인 번호를 매길 다음 값. */
  private nextCheckId = 0;
  /** 등록할 수 있는 프로젝트 목록. */
  private candidates: SentryCandidatesState = { status: 'idle' };
  /** 마지막 목록 조회 번호. 늦게 끝난 앞선 조회의 결과를 버린다. */
  private candidatesLoadId = 0;
  /** 등록과 매핑을 읽고 바꾸는 일이 서로 끼어들지 않게 한다. */
  private readonly updates = new SerialQueue();
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: SentryProjectsOptions) {}

  /** 설정의 등록과 매핑을 읽는다. 폴더와 접근 확인은 `refresh`가 한다. */
  async load(): Promise<void> {
    await this.updates.run(async () => {
      /** 저장된 설정. */
      const settings = await this.options.settingsStore.load();
      this.registrations = readRegistrations(settings.sentryProjects);
      this.mappings = readMappings(settings.sentryRepoMappings, this.registrations);
    });
    this.emit();
  }

  /** 지금 상태. */
  state(): SentryProjectsState {
    return {
      projects: Object.values(this.registrations).map((registration) => {
        /** 매핑된 저장소 폴더. */
        const path = this.mappings[registration.projectId]?.[0];
        return {
          registration: { ...registration, levels: [...registration.levels] },
          access: this.access.get(registration.projectId) ?? 'unchecked',
          repo: path === undefined ? null : { path, status: this.folderStatuses.get(path) ?? 'checking' },
        };
      }),
      candidates: this.candidates.status === 'loaded' ? { ...this.candidates, projects: [...this.candidates.projects] } : this.candidates,
    };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 등록한 프로젝트에 닿는지 다시 확인하고, 매핑된 폴더가 있는지 다시 본다. 설정 "Sentry"·"저장소" 칸을 열 때 부른다. */
  async refresh(): Promise<void> {
    await Promise.all([this.checkAccess(), ...[...this.allPaths()].map((path) => this.checkFolder(path))]);
  }

  /** 등록할 수 있는 프로젝트 목록을 조직마다 받는다. 이미 등록한 프로젝트도 목록에 담고, 거르는 것은 화면이 한다. */
  async loadCandidates(): Promise<void> {
    /** 이번 조회 번호. */
    const id = (this.candidatesLoadId += 1);
    /** 쓸 토큰. 토큰이 없거나 "토큰 확인 필요"면 부르지 않는다. */
    const token = this.usableToken();
    if (token === null) {
      this.setCandidates({ status: 'failed', reason: 'no-token' });
      return;
    }
    this.setCandidates({ status: 'loading' });
    /** 토큰으로 보이는 조직. */
    const { organizations } = this.options.connection.state();
    /** 조직마다 프로젝트를 읽은 결과. 조직을 하나씩 차례로 부른다. */
    const projects: SentryProjectCandidate[] = [];
    /** 읽지 못한 조직의 실패. */
    const failures: SentryApiFailure[] = [];
    for (const organization of organizations) {
      /** 이 조직의 프로젝트를 읽은 결과. */
      const result = await this.options.connectSentry(token).listProjects(organization);
      if (id !== this.candidatesLoadId) return;
      if (!result.ok) {
        failures.push(result.failure);
        continue;
      }
      for (const project of result.value) {
        projects.push({
          projectId: project.id,
          projectSlug: project.slug,
          projectName: project.name,
          organizationId: organization.id,
          organizationSlug: organization.slug,
          organizationName: organization.name,
          environments: project.environments,
        });
      }
    }
    for (const failure of failures) this.options.connection.reportApiFailure(token, failure);
    /** 이 조회의 첫 실패. */
    const first = failures[0];
    if (first && failures.length === organizations.length) {
      this.options.logger.warn('sentry-projects.candidates-failed', { failure: first.kind });
      this.setCandidates({ status: 'failed', reason: candidatesFailureOf(first) });
      return;
    }
    this.setCandidates({ status: 'loaded', projects, incomplete: failures.length > 0 });
  }

  /**
   * 목록에서 고른 프로젝트를 등록한다. 그 프로젝트의 오류 이슈 목록을 한 건 읽어 `event:read`를 확인하고,
   * 읽히면 지금 시각을 기준 시각으로 저장한다. 저장소 매핑은 정하지 않아도 된다.
   * 확인이 실패하면 아무것도 저장하지 않는다.
   */
  async register(projectId: string, input: SentryProjectInput): Promise<SentryRegisterOutcome> {
    /** 쓸 토큰. */
    const token = this.options.connection.token();
    if (token === null) return failedRegister('no-token');
    if (this.options.connection.state().problem !== null) return failedRegister('token-problem');
    if (projectId in this.registrations) return failedRegister('already-registered');
    /** 목록에서 찾은 프로젝트. 화면이 보낸 이름은 믿지 않고 받아 둔 목록의 값을 쓴다. */
    const candidate = this.candidates.status === 'loaded' ? this.candidates.projects.find((item) => item.projectId === projectId) : undefined;
    if (!candidate) return failedRegister('unknown-project');
    /** 정리한 필터. */
    const filters = readFilters(input);
    if (!filters || (filters.environment !== null && !candidate.environments.includes(filters.environment))) return failedRegister('invalid-filter');

    /** 조직. 지역 주소는 설정에 저장해 둔 값이다. */
    const organization = this.options.connection.state().organizations.find((item) => item.id === candidate.organizationId);
    if (!organization) return failedRegister('unknown-project');
    /** `event:read`를 확인한 결과. */
    const probe = await this.options.connectSentry(token).probeErrorIssues(organization, candidate.projectId);
    if (!probe.ok) {
      this.options.logger.warn('sentry-projects.register-failed', { failure: probe.failure.kind });
      // 토큰이 거부됐거나 `event:read`가 없으면 토큰을 바꿔야 하므로 "토큰 확인 필요"를 올린다(다른 실패는 무시된다).
      this.options.connection.reportApiFailure(token, probe.failure);
      return failedRegister(registerFailureOf(probe.failure));
    }

    /** 저장소로 받지 않는 폴더. */
    const repo = input.repoPath === null ? null : acceptRepoPath(input.repoPath);
    /** 등록한 결과. */
    const outcome = await this.updates.run(async (): Promise<SentryRegisterOutcome> => {
      // 확인하는 사이에 같은 프로젝트가 등록됐을 수 있다.
      if (projectId in this.registrations) return failedRegister('already-registered');
      /** 새 등록. 기준 시각은 등록을 확인한 지금이다. */
      const registration: SentryProjectRegistration = {
        projectId: candidate.projectId,
        organizationId: candidate.organizationId,
        organizationSlug: candidate.organizationSlug,
        organizationName: candidate.organizationName,
        projectSlug: candidate.projectSlug,
        projectName: candidate.projectName,
        environment: filters.environment,
        levels: filters.levels,
        registeredAt: new Date(this.options.clock.now()).toISOString(),
      };
      /** 저장할 매핑. */
      const mappings = repo?.path ? { ...this.mappings, [projectId]: [repo.path] } : this.mappings;
      if (!(await this.save({ ...this.registrations, [projectId]: registration }, mappings))) return failedRegister('save-failed');
      this.access.set(projectId, 'ok');
      return { kind: 'registered', rejected: repo?.rejected ?? null };
    });
    if (outcome.kind === 'registered') {
      this.options.logger.info('sentry-projects.registered');
      this.emit();
      if (repo?.path) await this.checkFolder(repo.path);
    }
    return outcome;
  }

  /**
   * 등록한 프로젝트의 필터와 저장소를 바꾼다. 기준 시각은 그대로다. `repoPath`가 `null`이면 저장소 매핑을 지운다.
   * 환경은 등록할 때와 달리 목록과 견주지 않는다. 그 사이 환경이 목록에서 빠져도 고른 값은 남겨야 하기 때문이다.
   */
  async update(projectId: string, input: SentryProjectInput): Promise<SentryUpdateOutcome> {
    /** 정리한 필터. */
    const filters = readFilters(input);
    if (!filters) return { kind: 'failed', reason: 'invalid-filter' };
    /** 저장소로 받지 않는 폴더. */
    const repo = input.repoPath === null ? null : acceptRepoPath(input.repoPath);
    /** 저장한 결과. */
    const outcome = await this.updates.run(async (): Promise<SentryUpdateOutcome> => {
      /** 지금 등록. */
      const current = this.registrations[projectId];
      if (!current) return { kind: 'failed', reason: 'not-registered' };
      /** 바꾼 뒤의 매핑. 받지 않은 폴더를 골랐으면 저장소는 그대로 둔다. */
      let mappings = this.mappings;
      if (input.repoPath === null) mappings = withoutKey(this.mappings, projectId);
      else if (repo?.path) mappings = { ...this.mappings, [projectId]: [repo.path] };
      if (!(await this.save({ ...this.registrations, [projectId]: { ...current, ...filters } }, mappings))) return { kind: 'failed', reason: 'save-failed' };
      return { kind: 'updated', rejected: repo?.rejected ?? null };
    });
    if (outcome.kind === 'updated') {
      this.emit();
      if (repo?.path) await this.checkFolder(repo.path);
    }
    return outcome;
  }

  /**
   * 폴더 선택 창에서 고른 폴더를 프로젝트의 저장소로 정한다. 저장소 칸의 [바꾸기…]·[폴더 고르기…]가 쓴다.
   * 등록하지 않은 프로젝트나 받지 않는 폴더(네트워크·WSL)면 바꾸지 않고 받지 않은 폴더를 돌려준다.
   */
  async setRepo(projectId: string, path: string): Promise<RejectedFolder | null> {
    /** 저장소로 받는 폴더. */
    const repo = acceptRepoPath(path);
    if (repo.path === null) return repo.rejected;
    /** 저장한 결과. */
    const saved = await this.updates.run(async () => {
      if (!(projectId in this.registrations)) return false;
      return this.save(this.registrations, { ...this.mappings, [projectId]: [repo.path!] });
    });
    if (saved) {
      this.emit();
      await this.checkFolder(repo.path);
    }
    return null;
  }

  /**
   * 등록을 푼다. 그 프로젝트의 등록과 저장소 매핑을 지운다. 다시 등록하면 기준 시각을 새로 잡는다.
   * 지우지 못하면 `false`다.
   */
  async unregister(projectId: string): Promise<boolean> {
    /** 지웠는지 여부. */
    const removed = await this.updates.run(async () => {
      if (!(projectId in this.registrations)) return true;
      return this.save(withoutKey(this.registrations, projectId), withoutKey(this.mappings, projectId));
    });
    if (removed) this.emit();
    return removed;
  }

  /** 등록한 프로젝트마다 오류 이슈 목록을 한 건 읽어 닿는지 본다. 하나씩 차례로 부른다. */
  private async checkAccess(): Promise<void> {
    /** 쓸 토큰. */
    const token = this.usableToken();
    if (token === null) return;
    for (const registration of Object.values(this.registrations)) {
      /** 이 프로젝트의 조직. */
      const organization = this.organizationOf(registration);
      if (!organization) continue;
      /** 읽은 결과. */
      const result = await this.options.connectSentry(token).probeErrorIssues(organization, registration.projectId);
      // 확인하는 사이에 등록이 풀렸으면 결과를 버린다.
      if (!(registration.projectId in this.registrations)) continue;
      if (result.ok) {
        this.setAccess(registration.projectId, 'ok');
      } else if (result.failure.kind === 'not-found' || result.failure.kind === 'forbidden') {
        // 등록할 때 `event:read`가 확인됐으므로 그 뒤의 `403`은 그 프로젝트의 접근 거부로 본다.
        this.setAccess(registration.projectId, 'inaccessible');
      } else if (result.failure.kind === 'unauthorized') {
        this.options.connection.reportApiFailure(token, result.failure);
      }
    }
  }

  /** 쓸 수 있는 토큰. 토큰이 없거나 "토큰 확인 필요"면 `null`. */
  private usableToken(): string | null {
    return this.options.connection.state().problem === null ? this.options.connection.token() : null;
  }

  /** 등록이 속한 조직. 조직 목록에 없으면 `null`. */
  private organizationOf(registration: SentryProjectRegistration): SentryOrganization | null {
    return this.options.connection.state().organizations.find((organization) => organization.id === registration.organizationId) ?? null;
  }

  /** 닿는지 확인한 상태를 바꾸고, 바뀌었으면 알린다. */
  private setAccess(projectId: string, access: SentryProjectAccess): void {
    if (this.access.get(projectId) === access) return;
    this.access.set(projectId, access);
    this.emit();
  }

  /** 등록할 수 있는 프로젝트 목록 상태를 바꾸고 알린다. */
  private setCandidates(candidates: SentryCandidatesState): void {
    this.candidates = candidates;
    this.emit();
  }

  /** 등록과 매핑을 저장한다. 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다. */
  private async save(registrations: Record<string, SentryProjectRegistration>, mappings: Record<string, string[]>): Promise<boolean> {
    try {
      /** 저장 직전의 설정. */
      const settings = await this.options.settingsStore.load();
      await this.options.settingsStore.save({ ...settings, sentryProjects: registrations, sentryRepoMappings: mappings });
    } catch (error) {
      this.options.logger.error('sentry-projects.save-failed', errorFields(error));
      return false;
    }
    this.registrations = registrations;
    this.mappings = mappings;
    // 풀린 등록의 확인 결과와 어느 매핑도 가리키지 않는 폴더의 확인 결과는 버린다.
    for (const projectId of [...this.access.keys()]) if (!(projectId in registrations)) this.access.delete(projectId);
    /** 남은 매핑이 가리키는 폴더. */
    const paths = this.allPaths();
    for (const path of [...this.folderStatuses.keys()]) if (!paths.has(path)) this.folderStatuses.delete(path);
    for (const path of [...this.checkIds.keys()]) if (!paths.has(path)) this.checkIds.delete(path);
    return true;
  }

  /** 매핑들이 가리키는 모든 폴더. */
  private allPaths(): Set<string> {
    return new Set(Object.values(this.mappings).flat());
  }

  /** 폴더 하나가 있는지 확인한다. 그사이 다시 확인하기 시작했으면 결과를 버린다. */
  private async checkFolder(path: string): Promise<void> {
    /** 이번 확인 번호. */
    const id = (this.nextCheckId += 1);
    this.checkIds.set(path, id);
    /** 확인 결과. */
    const status: MappedRepoStatus = (await isFolder(path)) ? 'found' : 'missing';
    if (this.checkIds.get(path) !== id) return;
    if (this.folderStatuses.get(path) === status) return;
    this.folderStatuses.set(path, status);
    this.emit();
  }

  /** 상태가 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 등록하지 못한 결과. */
function failedRegister(reason: SentryRegisterFailure): SentryRegisterOutcome {
  return { kind: 'failed', reason };
}

/** 정리한 필터. */
interface Filters {
  /** 환경 필터. `null`이면 모든 환경이다. */
  environment: string | null;
  /** 레벨 필터. 심각한 순서이고 겹치지 않는다. */
  levels: SentryLevel[];
}

/** 필터를 정리한다. 환경 이름이 맞지 않거나 레벨이 비었거나 모르는 레벨이 있으면 `null`. */
function readFilters(input: SentryProjectInput): Filters | null {
  if (input.environment !== null && (input.environment === '' || input.environment.length > ENVIRONMENT_MAX_LENGTH)) return null;
  if (input.levels.length === 0 || input.levels.some((level) => !SENTRY_LEVELS.includes(level))) return null;
  return { environment: input.environment, levels: SENTRY_LEVELS.filter((level) => input.levels.includes(level)) };
}

/** 고른 폴더를 저장소로 받는다. 받지 않는 폴더(네트워크·WSL)면 `path`가 `null`이고 이유를 `rejected`에 담는다. */
function acceptRepoPath(path: string): { path: string | null; rejected: RejectedFolder | null } {
  /** 받지 않는 이유. */
  const reason = rejectedFolderReason(path);
  return reason ? { path: null, rejected: { path, reason } } : { path: resolve(path), rejected: null };
}

/** 프로젝트 확인 실패를 등록 실패 이유로 바꾼다. */
function registerFailureOf(failure: SentryApiFailure): SentryRegisterFailure {
  switch (failure.kind) {
    case 'unauthorized':
      return 'unauthorized';
    case 'forbidden':
      return 'scope-missing';
    case 'not-found':
      return 'project-unavailable';
    case 'network':
      return 'network';
    case 'rate-limited':
      return 'rate-limited';
    case 'http':
    case 'unexpected-response':
      return 'unexpected';
  }
}

/** 프로젝트 목록 실패를 목록 실패 이유로 바꾼다. */
function candidatesFailureOf(failure: SentryApiFailure): SentryCandidatesFailure {
  switch (failure.kind) {
    case 'unauthorized':
      return 'unauthorized';
    case 'forbidden':
      return 'scope-missing';
    case 'network':
      return 'network';
    case 'rate-limited':
      return 'rate-limited';
    case 'http':
    case 'not-found':
    case 'unexpected-response':
      return 'unexpected';
  }
}

/** `settings.json`의 등록을 읽는다. 형식이 맞지 않는 항목은 건너뛴다. */
function readRegistrations(stored: unknown): Record<string, SentryProjectRegistration> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  /** 읽은 등록. */
  const registrations: Record<string, SentryProjectRegistration> = {};
  for (const [projectId, value] of Object.entries(stored)) {
    /** 객체로 본 값. */
    const item = value as Record<string, unknown> | null;
    if (typeof item !== 'object' || item === null) continue;
    if (item.projectId !== projectId) continue;
    /** 형식이 맞는 레벨. */
    const levels = Array.isArray(item.levels) ? SENTRY_LEVELS.filter((level) => (item.levels as unknown[]).includes(level)) : [];
    if (
      levels.length === 0 ||
      !isNonEmptyString(item.organizationId) ||
      !isNonEmptyString(item.organizationSlug) ||
      !isNonEmptyString(item.organizationName) ||
      !isNonEmptyString(item.projectSlug) ||
      !isNonEmptyString(item.projectName) ||
      !isNonEmptyString(item.registeredAt) ||
      Number.isNaN(Date.parse(item.registeredAt)) ||
      (item.environment !== null && !isNonEmptyString(item.environment))
    ) {
      continue;
    }
    registrations[projectId] = {
      projectId,
      organizationId: item.organizationId,
      organizationSlug: item.organizationSlug,
      organizationName: item.organizationName,
      projectSlug: item.projectSlug,
      projectName: item.projectName,
      environment: item.environment as string | null,
      levels,
      registeredAt: item.registeredAt,
    };
  }
  return registrations;
}

/** `settings.json`의 Sentry 매핑을 읽는다. 등록이 없는 프로젝트의 매핑과 형식이 맞지 않는 값은 건너뛴다. */
function readMappings(stored: unknown, registrations: Record<string, SentryProjectRegistration>): Record<string, string[]> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).flatMap(([projectId, paths]) => {
      /** 형식이 맞는 경로. */
      const valid = Array.isArray(paths) ? paths.filter((path): path is string => isNonEmptyString(path)) : [];
      return projectId in registrations && valid.length > 0 ? [[projectId, valid]] : [];
    }),
  );
}

/** 값이 빈 문자열이 아닌 문자열인지 본다. */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

/** `key`를 뺀 새 객체. */
function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
}
