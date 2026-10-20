import { join, resolve } from 'node:path';
import { errorFields, type Logger } from '../logging/logger';
import type { SettingsStore } from '../ports/settings-store';
import { SerialQueue } from '../serial-queue';
import { findRepoCandidates, rejectedFolderReason, type RejectedFolderReason, type RepoScanResult } from './repo-candidates';

/** 홈 폴더 아래에서 "이 PC에서 찾은 폴더"로 살펴볼 흔한 이름. 이 순서로 보인다. */
export const COMMON_WORK_FOLDER_NAMES: readonly string[] = [
  'workspace',
  'projects',
  'dev',
  'code',
  'src',
  'repos',
  'git',
  'Developer',
  'IdeaProjects',
  join('source', 'repos'),
  join('Documents', 'GitHub'),
];

/** 작업 폴더 하나를 훑은 상태. */
export type WorkFolderScan = { status: 'scanning' } | RepoScanResult;

/** 작업 폴더 하나. */
export interface WorkFolderState {
  /** 작업 폴더의 절대 경로. */
  path: string;
  /** 훑은 상태. */
  scan: WorkFolderScan;
}

/** "이 PC에서 찾은 폴더" 하나. */
export interface WorkFolderSuggestion {
  /** 폴더의 절대 경로. */
  path: string;
  /** 그 안에서 찾은 저장소 수. 1 이상이다. */
  repoCount: number;
}

/** 받지 않은 폴더 하나. */
export interface RejectedFolder {
  /** 고른 경로. */
  path: string;
  /** 받지 않은 이유. */
  reason: RejectedFolderReason;
}

/** 설정 "저장소" 칸의 작업 폴더 상태. */
export interface WorkFoldersState {
  /** 작업 폴더. 저장한 순서다. */
  folders: WorkFolderState[];
  /** 작업 폴더가 아닌 "이 PC에서 찾은 폴더". */
  suggestions: WorkFolderSuggestion[];
  /** 마지막 추가에서 받지 않은 폴더. 다음 추가 때 비운다. */
  rejected: RejectedFolder[];
}

/** 작업 폴더에 필요한 것. */
export interface WorkFoldersOptions {
  /** 작업 폴더 목록을 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. */
  logger: Logger;
  /** 사용자 홈 폴더. "이 PC에서 찾은 폴더"를 여기서 찾는다. */
  homeDir: string;
}

/**
 * 작업 폴더 목록과 그 안의 저장소 후보.
 * 추가하면 `settings.json`에 저장하고 바로 훑는다. 지워도 그 안을 가리키는 저장소 매핑은 건드리지 않는다.
 */
export class WorkFolders {
  /** 저장된 작업 폴더. */
  private folders: string[] = [];
  /** 작업 폴더별로 훑은 상태. */
  private readonly scans = new Map<string, WorkFolderScan>();
  /** 작업 폴더별 마지막 훑기 번호. 늦게 끝난 앞선 훑기의 결과를 버린다. */
  private readonly scanIds = new Map<string, number>();
  /** 훑기 번호를 매길 다음 값. */
  private nextScanId = 0;
  /** 홈 폴더 아래에서 저장소가 든 흔한 이름의 폴더. 작업 폴더인 것도 담고, 보일 때 거른다. */
  private commonFolders: WorkFolderSuggestion[] = [];
  /** 마지막 추가에서 받지 않은 폴더. */
  private rejected: RejectedFolder[] = [];
  /** 목록을 바꾸고 저장하는 일이 서로 끼어들지 않게 한다. */
  private readonly saving = new SerialQueue();
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: WorkFoldersOptions) {}

  /** 저장된 작업 폴더를 읽고, 작업 폴더와 홈 폴더 아래 흔한 폴더를 훑는다. */
  async load(): Promise<void> {
    /** 저장된 설정. */
    const settings = await this.options.settingsStore.load();
    this.folders = [...settings.workFolders];
    await this.refresh();
  }

  /** 지금 상태. */
  state(): WorkFoldersState {
    return {
      folders: this.folders.map((path) => ({ path, scan: this.scans.get(path) ?? { status: 'scanning' } })),
      suggestions: this.commonFolders.filter((suggestion) => !this.folders.includes(suggestion.path)),
      rejected: [...this.rejected],
    };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 모든 작업 폴더와 홈 폴더 아래 흔한 폴더를 다시 훑는다. */
  async refresh(): Promise<void> {
    await Promise.all([...this.folders.map((path) => this.scan(path)), this.findCommonFolders()]);
  }

  /**
   * 폴더 선택 창에서 고른 폴더를 작업 폴더로 더하고 바로 훑는다.
   * 네트워크·WSL 경로는 이유를 남기고 받지 않는다. 저장소가 없는 폴더도 받는다.
   */
  async add(paths: readonly string[]): Promise<void> {
    /** 받을 경로. OS 고유 형식의 절대 경로로 맞춘다. */
    const accepted: string[] = [];
    /** 받지 않은 경로. */
    const rejected: RejectedFolder[] = [];
    for (const path of paths) {
      /** 받지 않는 이유. */
      const reason = rejectedFolderReason(path);
      if (reason) rejected.push({ path, reason });
      else accepted.push(resolve(path));
    }
    this.rejected = rejected;
    if (rejected.length > 0) this.options.logger.info('work-folders.rejected', { count: rejected.length });

    /** 새로 더한 경로. */
    const added = await this.saving.run(async () => {
      /** 목록에 없는 경로. 같은 경로를 두 번 골라도 한 번만 더한다. */
      const fresh = [...new Set(accepted)].filter((path) => !this.folders.includes(path));
      if (fresh.length > 0 && !(await this.save([...this.folders, ...fresh]))) return [];
      return fresh;
    });
    this.emit();
    await Promise.all(added.map((path) => this.scan(path)));
  }

  /** "이 PC에서 찾은 폴더"의 [추가]. 지금 제안에 없는 경로는 받지 않는다. */
  async addSuggestion(path: string): Promise<void> {
    if (!this.state().suggestions.some((suggestion) => suggestion.path === path)) {
      this.options.logger.warn('work-folders.suggestion-rejected', {});
      return;
    }
    await this.add([path]);
  }

  /** 작업 폴더를 지운다. 저장소 매핑은 그대로 둔다. */
  async remove(path: string): Promise<void> {
    /** 지웠는지 여부. */
    const removed = await this.saving.run(async () => {
      if (!this.folders.includes(path)) return false;
      return this.save(this.folders.filter((folder) => folder !== path));
    });
    if (!removed) return;
    this.scans.delete(path);
    this.scanIds.delete(path);
    this.emit();
  }

  /** 작업 폴더 목록을 저장한다. 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다. */
  private async save(folders: string[]): Promise<boolean> {
    try {
      /** 저장 직전의 설정. */
      const settings = await this.options.settingsStore.load();
      await this.options.settingsStore.save({ ...settings, workFolders: folders });
    } catch (error) {
      this.options.logger.error('work-folders.save-failed', errorFields(error));
      return false;
    }
    this.folders = folders;
    return true;
  }

  /** 작업 폴더 하나를 훑는다. 그사이 지웠거나 다시 훑기 시작했으면 결과를 버린다. */
  private async scan(path: string): Promise<void> {
    /** 이번 훑기 번호. */
    const id = (this.nextScanId += 1);
    this.scanIds.set(path, id);
    this.scans.set(path, { status: 'scanning' });
    this.emit();
    /** 훑은 결과. */
    const result = await findRepoCandidates(path);
    if (this.scanIds.get(path) !== id) return;
    this.scans.set(path, result);
    this.emit();
  }

  /** 홈 폴더 아래 흔한 이름의 폴더 가운데 저장소가 든 폴더를 찾는다. */
  private async findCommonFolders(): Promise<void> {
    /** 흔한 이름 폴더별 결과. 없는 폴더는 `missing`이다. */
    const results = await Promise.all(
      COMMON_WORK_FOLDER_NAMES.map(async (name) => {
        /** 폴더 경로. */
        const path = join(this.options.homeDir, name);
        return { path, result: await findRepoCandidates(path) };
      }),
    );
    this.commonFolders = results.flatMap(({ path, result }) =>
      result.status === 'found' && result.repos.length > 0 ? [{ path, repoCount: result.repos.length }] : [],
    );
    this.emit();
  }

  /** 상태가 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
