import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { errorFields, type Logger } from '../logging/logger';
import type { FlowApiFailure, FlowConnection, FlowProject } from '../ports/flow-api';
import type { SettingsStore } from '../ports/settings-store';
import { SerialQueue } from '../serial-queue';

/** 매핑된 저장소 폴더를 확인한 상태. */
export type MappedRepoStatus = 'checking' | 'found' | 'missing';

/** 매핑에 연결된 저장소 하나. */
export interface MappedRepoState {
  /** 저장소 폴더의 절대 경로. */
  path: string;
  /** 폴더가 있는지 확인한 상태. */
  status: MappedRepoStatus;
}

/** 저장소 매핑 하나. Flow 프로젝트 하나에 저장소 여러 개를 연결한다. */
export interface RepoMappingState {
  /** Flow 프로젝트 ID. 매핑의 키다. */
  projectId: string;
  /** 참여 목록에서 찾은 Flow 프로젝트 이름. 목록을 아직 받지 못했거나 목록에 없으면 `null`. */
  title: string | null;
  /** 연결된 저장소. 저장한 순서다. */
  repos: MappedRepoState[];
  /** 연결된 폴더 중 하나라도 없는지 여부. */
  missing: boolean;
}

/** 참여 Flow 프로젝트 목록을 받지 못한 이유. `no-key`는 쓸 키가 아직 없는 것이다. */
export type ParticipantProjectsFailure = 'no-key' | 'unauthorized' | 'network' | 'rate-limited' | 'unexpected';

/** 참여 Flow 프로젝트 목록의 상태. */
export type ParticipantProjectsState =
  /** 아직 받지 않았다. */
  | { status: 'idle' }
  /** 받고 있다. */
  | { status: 'loading' }
  /** 받았다. */
  | { status: 'loaded'; projects: FlowProject[] }
  /** 받지 못했다. */
  | { status: 'failed'; reason: ParticipantProjectsFailure };

/** 설정 "저장소" 칸의 저장소 매핑 상태. */
export interface RepoMappingsState {
  /** 저장된 매핑. */
  mappings: RepoMappingState[];
  /** 매핑에서 고를 참여 Flow 프로젝트 목록. */
  projects: ParticipantProjectsState;
}

/** Flow 프로젝트의 저장소 매핑을 지금 폴더 상태로 확인한 결과. 초안 실행에 넘길 읽기 범위를 정한다. */
export type RepoResolution =
  /** 저장소 매핑이 없다. */
  | { kind: 'unmapped' }
  /** 연결된 폴더 가운데 없는 것이 있다. 자동 선택으로 넘어가지 않고 저장소 확인 필요로 올린다. */
  | { kind: 'missing'; paths: string[] }
  /** 연결된 폴더가 모두 있다. 연결한 순서이고 첫 저장소가 작업 폴더가 된다. */
  | { kind: 'mapped'; repos: string[] };

/** 저장소 매핑에 필요한 것. */
export interface RepoMappingsOptions {
  /** 매핑을 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. 경로와 프로젝트 이름은 남기지 않는다. */
  logger: Logger;
  /** 지금 키로 부르는 Flow. 쓸 키가 없으면 `null`. */
  connectFlow: () => FlowConnection | null;
}

/**
 * 저장소 매핑 목록: Flow 프로젝트 ID → 저장소 절대 경로 목록.
 * 저장소 개수에 제한이 없고 git 저장소가 아닌 코드 폴더도 받는다. 작업 폴더와는 따로 저장하므로 작업 폴더를 지워도 남는다.
 */
export class RepoMappings {
  /** 저장된 매핑. */
  private mappings: Record<string, string[]> = {};
  /** 저장소 폴더별로 확인한 상태. 여러 매핑이 같은 폴더를 가리키면 하나를 같이 쓴다. */
  private readonly statuses = new Map<string, MappedRepoStatus>();
  /** 폴더별 마지막 확인 번호. 늦게 끝난 앞선 확인의 결과를 버린다. */
  private readonly checkIds = new Map<string, number>();
  /** 확인 번호를 매길 다음 값. */
  private nextCheckId = 0;
  /** 참여 Flow 프로젝트 목록. */
  private projects: ParticipantProjectsState = { status: 'idle' };
  /** 마지막 목록 조회 번호. 늦게 끝난 앞선 조회의 결과를 버린다. */
  private projectsLoadId = 0;
  /** 매핑을 읽고 바꾸는 일이 서로 끼어들지 않게 한다. */
  private readonly updates = new SerialQueue();
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: RepoMappingsOptions) {}

  /** 저장된 매핑을 읽는다. 폴더 확인과 목록 조회는 `refresh`가 한다. */
  async load(): Promise<void> {
    await this.updates.run(async () => {
      /** 저장된 설정. */
      const settings = await this.options.settingsStore.load();
      this.mappings = readMappings(settings.repoMappings);
    });
    this.emit();
  }

  /** 지금 상태. */
  state(): RepoMappingsState {
    /** 참여 목록에서 ID로 찾는 프로젝트 이름. */
    const titles = new Map(
      this.projects.status === 'loaded' ? this.projects.projects.map((project) => [project.projectId, project.title]) : [],
    );
    return {
      mappings: Object.entries(this.mappings).map(([projectId, paths]) => {
        /** 연결된 저장소의 확인 상태. */
        const repos = paths.map((path) => ({ path, status: this.statuses.get(path) ?? 'checking' }));
        return {
          projectId,
          title: titles.get(projectId) ?? null,
          repos,
          missing: repos.some((repo) => repo.status === 'missing'),
        };
      }),
      projects: this.projects.status === 'loaded' ? { status: 'loaded', projects: [...this.projects.projects] } : this.projects,
    };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 연결된 폴더가 있는지 다시 확인하고 참여 Flow 프로젝트 목록을 다시 받는다. */
  async refresh(): Promise<void> {
    await Promise.all([...this.allPaths()].map((path) => this.check(path)).concat(this.loadProjects()));
  }

  /** Flow 프로젝트에 연결된 저장소를 지금 폴더 상태로 확인한다. 멘션 묶음을 감지할 때와 초안 실행 직전에 쓴다. */
  async resolve(projectId: string): Promise<RepoResolution> {
    /** 연결된 폴더. */
    const paths = this.mappings[projectId] ?? [];
    if (paths.length === 0) return { kind: 'unmapped' };
    /** 폴더마다 있는지 여부. */
    const found = await Promise.all(paths.map((path) => isFolder(path)));
    /** 없는 폴더. */
    const missing = paths.filter((_, index) => !found[index]);
    return missing.length > 0 ? { kind: 'missing', paths: missing } : { kind: 'mapped', repos: [...paths] };
  }

  /**
   * 참여 목록에서 Flow 프로젝트 이름을 찾는다. 초안 실행의 입력 문서에 넣는다.
   * 목록을 아직 받지 않았거나 받지 못했으면 지금 받아 본다. 받지 못했거나 목록에 없으면 `null`.
   */
  async projectTitle(projectId: string): Promise<string | null> {
    if (this.projects.status !== 'loaded') await this.loadProjects();
    return this.loadedProjectTitle(projectId);
  }

  /** 받은 참여 목록에서 Flow 프로젝트 이름을 찾는다. 이름이 비어 있으면 모르는 것으로 본다. */
  private loadedProjectTitle(projectId: string): string | null {
    if (this.projects.status !== 'loaded') return null;
    return this.projects.projects.find((project) => project.projectId === projectId)?.title || null;
  }

  /**
   * 폴더 선택 창에서 고른 폴더를 Flow 프로젝트에 연결한다. 매핑이 없으면 새로 만들고, 이미 연결된 폴더는 다시 더하지 않는다.
   * 참여 목록에도 저장된 매핑에도 없는 Flow 프로젝트는 받지 않는다.
   */
  async addRepos(projectId: string, paths: readonly string[]): Promise<void> {
    /** 새로 연결한 폴더. OS 고유 형식의 절대 경로로 맞춘다. */
    const added = await this.updates.run(async () => {
      if (!this.isKnownProject(projectId)) {
        this.options.logger.warn('repo-mappings.unknown-project', {});
        return [];
      }
      /** 지금 연결된 폴더. */
      const current = this.mappings[projectId] ?? [];
      /** 아직 연결되지 않은 폴더. 같은 폴더를 두 번 골라도 한 번만 더한다. */
      const fresh = [...new Set(paths.map((path) => resolve(path)))].filter((path) => !current.includes(path));
      if (fresh.length === 0) return [];
      return (await this.save({ ...this.mappings, [projectId]: [...current, ...fresh] })) ? fresh : [];
    });
    if (added.length === 0) return;
    this.emit();
    await Promise.all(added.map((path) => this.check(path)));
  }

  /** 매핑에서 저장소 하나를 뺀다. 마지막 저장소를 빼면 매핑도 없앤다. */
  async removeRepo(projectId: string, path: string): Promise<void> {
    await this.change(() => {
      /** 지금 연결된 폴더. */
      const current = this.mappings[projectId];
      if (!current?.includes(path)) return null;
      /** 뺀 뒤의 폴더. */
      const rest = current.filter((repo) => repo !== path);
      return rest.length > 0 ? { ...this.mappings, [projectId]: rest } : withoutKey(this.mappings, projectId);
    });
  }

  /** 매핑을 통째로 지운다. */
  async removeMapping(projectId: string): Promise<void> {
    await this.change(() => (projectId in this.mappings ? withoutKey(this.mappings, projectId) : null));
  }

  /** 참여 Flow 프로젝트 목록을 받는다. 401이면 키 확인 필요를 알린다. */
  private async loadProjects(): Promise<void> {
    /** 이번 조회 번호. */
    const id = (this.projectsLoadId += 1);
    /** 지금 키로 부르는 Flow. */
    const flow = this.options.connectFlow();
    if (!flow) {
      this.setProjects({ status: 'failed', reason: 'no-key' });
      return;
    }
    this.setProjects({ status: 'loading' });
    /** 조회 결과. */
    const result = await flow.api.listParticipantProjects();
    if (this.projectsLoadId !== id) return;
    if (result.ok) {
      this.setProjects({ status: 'loaded', projects: result.value });
      return;
    }
    this.options.logger.warn('repo-mappings.projects-failed', { failure: result.failure.kind });
    if (result.failure.kind === 'unauthorized') flow.reportKeyRejected();
    this.setProjects({ status: 'failed', reason: projectsFailureOf(result.failure) });
  }

  /** 목록 상태를 바꾸고 알린다. */
  private setProjects(projects: ParticipantProjectsState): void {
    this.projects = projects;
    this.emit();
  }

  /** 참여 목록에 있거나 이미 매핑이 있는 Flow 프로젝트인지 본다. */
  private isKnownProject(projectId: string): boolean {
    if (projectId in this.mappings) return true;
    return this.projects.status === 'loaded' && this.projects.projects.some((project) => project.projectId === projectId);
  }

  /** `next`가 돌려준 매핑을 저장한다. `null`이면 바꾸지 않는다. */
  private async change(next: () => Record<string, string[]> | null): Promise<void> {
    /** 바꿨는지 여부. */
    const changed = await this.updates.run(async () => {
      /** 바꾼 뒤의 매핑. */
      const mappings = next();
      return mappings !== null && this.save(mappings);
    });
    if (changed) this.emit();
  }

  /** 매핑을 저장한다. 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다. */
  private async save(mappings: Record<string, string[]>): Promise<boolean> {
    try {
      /** 저장 직전의 설정. */
      const settings = await this.options.settingsStore.load();
      await this.options.settingsStore.save({ ...settings, repoMappings: mappings });
    } catch (error) {
      this.options.logger.error('repo-mappings.save-failed', errorFields(error));
      return false;
    }
    this.mappings = mappings;
    // 어느 매핑도 가리키지 않는 폴더의 확인 결과는 버린다.
    /** 남은 매핑이 가리키는 폴더. */
    const paths = this.allPaths();
    for (const path of [...this.statuses.keys()]) if (!paths.has(path)) this.statuses.delete(path);
    for (const path of [...this.checkIds.keys()]) if (!paths.has(path)) this.checkIds.delete(path);
    return true;
  }

  /** 매핑들이 가리키는 모든 폴더. */
  private allPaths(): Set<string> {
    return new Set(Object.values(this.mappings).flat());
  }

  /** 폴더 하나가 있는지 확인한다. 그사이 다시 확인하기 시작했으면 결과를 버린다. */
  private async check(path: string): Promise<void> {
    /** 이번 확인 번호. */
    const id = (this.nextCheckId += 1);
    this.checkIds.set(path, id);
    /** 확인 결과. */
    const status: MappedRepoStatus = (await isFolder(path)) ? 'found' : 'missing';
    if (this.checkIds.get(path) !== id) return;
    if (this.statuses.get(path) === status) return;
    this.statuses.set(path, status);
    this.emit();
  }

  /** 상태가 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 폴더가 있는지 본다. 없거나 폴더가 아니거나 읽을 수 없으면 `false`. */
export async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** `settings.json`의 매핑을 읽는다. 문자열 경로가 하나도 없는 매핑과 형식이 맞지 않는 값은 건너뛴다. */
function readMappings(stored: unknown): Record<string, string[]> {
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).flatMap(([projectId, paths]) => {
      /** 형식이 맞는 경로. */
      const valid = Array.isArray(paths) ? paths.filter((path): path is string => typeof path === 'string' && path !== '') : [];
      return valid.length > 0 ? [[projectId, valid]] : [];
    }),
  );
}

/** `key`를 뺀 새 객체. */
function withoutKey(mappings: Record<string, string[]>, key: string): Record<string, string[]> {
  return Object.fromEntries(Object.entries(mappings).filter(([projectId]) => projectId !== key));
}

/** Flow API 실패를 목록 조회 실패 이유로 바꾼다. */
function projectsFailureOf(failure: FlowApiFailure): ParticipantProjectsFailure {
  if (failure.kind === 'unauthorized' || failure.kind === 'network' || failure.kind === 'rate-limited') return failure.kind;
  return 'unexpected';
}
