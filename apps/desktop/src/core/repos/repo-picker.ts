import { basename, resolve } from 'node:path';
import { canPickRepos, type MentionBundle } from '../bundles/mention-bundle';
import type { RepoCandidate } from './repo-candidates';
import type { MappingMatch, RepoMappings } from './repo-mappings';

/**
 * 저장소 선택 창의 후보가 든 무리. 화면에 이 순서로 보인다.
 * `current`는 지금 쓰는 저장소, `work-folder`는 작업 폴더에서 찾은 저장소, `mapping`은 다른 Flow 프로젝트의 저장소 매핑에 쓰인 저장소, `added`는 "폴더 직접 고르기"로 더한 폴더다.
 */
export type RepoChoiceGroup = 'current' | 'work-folder' | 'mapping' | 'added';

/** 저장소 선택 창의 후보 하나. */
export interface RepoChoice {
  /** 화면에 보일 이름. 작업 폴더에서 찾은 저장소는 작업 폴더 안의 상대 경로, 그 밖에는 폴더 이름이다. */
  name: string;
  /** 저장소 폴더의 절대 경로. */
  path: string;
  /** 든 무리. 같은 저장소는 앞 무리에 한 번만 든다. */
  group: RepoChoiceGroup;
  /** 체크했는지 여부. */
  checked: boolean;
}

/** 열린 저장소 선택 창의 상태. 닫혀 있으면 `null`이다. */
export type RepoPickerState =
  /** 작업 폴더를 훑고 있다. */
  | { bundleId: number; status: 'loading' }
  /** 후보를 보이고 있다. `mapping`은 체크한 구성을 그 묶음 Flow 프로젝트의 저장소 매핑과 견준 것이다. */
  | { bundleId: number; status: 'ready'; choices: RepoChoice[]; mapping: MappingMatch };

/** 저장소 선택 창에 필요한 것. */
export interface RepoPickerOptions {
  /** 묶음 하나. 없으면 `null`. */
  bundle: (bundleId: number) => MentionBundle | null;
  /** 다른 매핑에 쓰인 저장소를 후보로 보이고, 연결 버튼으로 덮어쓸 저장소 매핑. */
  mappings: Pick<RepoMappings, 'state' | 'replaceRepos' | 'matchOf'>;
  /** 지금 설정의 작업 폴더를 훑어 찾은 저장소. 창을 열 때마다 새로 훑는다. */
  findWorkFolderRepos: () => Promise<RepoCandidate[]>;
  /** 묶음을 고른 구성으로 다시 만든다. 사용자 행동이라 대기열 앞에 든다. */
  regenerate: (bundleId: number, repos: readonly string[]) => Promise<void>;
}

/** 열린 창의 내부 상태. */
type OpenPicker = { bundleId: number; status: 'loading' } | { bundleId: number; status: 'ready'; choices: RepoChoice[] };

/**
 * 저장소 선택 창. "저장소를 골라 만들기"(저장소 확인 필요)와 "다른 저장소로 다시 만들기"(준비됨)가 같이 쓴다. 한 번에 하나만 연다.
 * 처음에는 지금 쓰는 저장소를 체크해 두고, 작업 폴더에서 찾은 저장소와 다른 매핑에 쓰인 저장소를 후보로 보인다. 여러 개를 고를 수 있다.
 * 고른 구성으로 초안을 다시 만들거나, 그 구성으로 저장소 매핑을 덮어쓴다(연결 버튼). 고른 구성을 저절로 매핑으로 저장하지는 않는다.
 */
export class RepoPicker {
  /** 열린 창. 닫혀 있으면 `null`. */
  private current: OpenPicker | null = null;
  /** 창을 연 번호. 작업 폴더를 훑는 사이 다시 열거나 닫았으면 늦게 끝난 훑기의 결과를 버린다. */
  private openId = 0;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: RepoPickerOptions) {}

  /** 지금 상태. 닫혀 있으면 `null`. 연결 버튼 문구가 매핑에 따라 바뀌므로 매핑은 읽을 때마다 견준다. */
  state(): RepoPickerState | null {
    /** 열린 창. */
    const current = this.current;
    if (!current || current.status === 'loading') return current && { ...current };
    /** 창을 연 묶음. */
    const bundle = this.options.bundle(current.bundleId);
    return {
      bundleId: current.bundleId,
      status: 'ready',
      choices: current.choices.map((choice) => ({ ...choice })),
      mapping: bundle ? this.options.mappings.matchOf(bundle.projectId, checkedPaths(current.choices)) : 'unmapped',
    };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 묶음의 저장소 선택 창을 연다. 준비됨이나 저장소 확인 필요 묶음만 연다. 이미 열린 창이 있으면 바꾼다. */
  async open(bundleId: number): Promise<void> {
    /** 열 묶음. */
    const bundle = this.options.bundle(bundleId);
    if (!bundle || !canPickRepos(bundle.status)) return;
    /** 이번에 연 번호. */
    const id = (this.openId += 1);
    this.set({ bundleId, status: 'loading' });
    /** 작업 폴더에서 찾은 저장소. */
    const found = await this.options.findWorkFolderRepos().catch((): RepoCandidate[] => []);
    if (this.openId !== id) return;
    this.set({ bundleId, status: 'ready', choices: this.choicesFor(bundle, found) });
  }

  /** 후보 하나를 체크하거나 뺀다. 후보에 없는 경로는 받지 않는다. */
  setChecked(path: string, checked: boolean): void {
    this.updateChoices((choices) =>
      choices.some((choice) => choice.path === path) ? choices.map((choice) => (choice.path === path ? { ...choice, checked } : choice)) : null,
    );
  }

  /** "폴더 직접 고르기"로 고른 폴더를 체크한 채 더한다. 이미 후보인 폴더는 체크만 한다. */
  addFolders(paths: readonly string[]): void {
    this.updateChoices((choices) => {
      /** 고른 폴더. OS 고유 형식의 절대 경로로 맞춘다. */
      const picked = new Set(paths.map((path) => resolve(path)));
      /** 이미 후보인 폴더는 체크한 후보. */
      const marked = choices.map((choice) => (picked.has(choice.path) ? { ...choice, checked: true } : choice));
      /** 새로 더할 폴더. */
      const added = [...picked].filter((path) => !choices.some((choice) => choice.path === path));
      return [...marked, ...added.map((path): RepoChoice => ({ name: basename(path), path, group: 'added', checked: true }))];
    });
  }

  /** 고른 구성으로 묶음을 다시 만들고 창을 닫는다. 고른 것이 없으면 아무것도 하지 않는다. */
  async generate(): Promise<void> {
    /** 열린 창. */
    const current = this.current;
    if (current?.status !== 'ready') return;
    /** 고른 구성. 후보 순서대로이고 첫 저장소가 cwd가 된다. */
    const repos = checkedPaths(current.choices);
    if (repos.length === 0) return;
    this.close();
    await this.options.regenerate(current.bundleId, repos);
  }

  /** 창의 연결 버튼. 고른 구성으로 그 묶음 Flow 프로젝트의 저장소 매핑을 덮어쓴다. 창은 그대로 둔다. */
  async link(): Promise<void> {
    /** 열린 창. */
    const current = this.current;
    if (current?.status !== 'ready') return;
    /** 창을 연 묶음. */
    const bundle = this.options.bundle(current.bundleId);
    /** 고른 구성. */
    const repos = checkedPaths(current.choices);
    if (!bundle || repos.length === 0) return;
    await this.options.mappings.replaceRepos(bundle.projectId, repos);
    this.emit();
  }

  /**
   * 준비됨 묶음 저장소 영역의 연결 버튼. 그 초안을 만든 구성으로 Flow 프로젝트의 저장소 매핑을 덮어쓴다.
   * 구성은 렌더러가 아니라 묶음에서 읽는다. 초안이 없으면 아무것도 하지 않는다.
   */
  async linkBundle(bundleId: number): Promise<void> {
    /** 연결할 묶음. */
    const bundle = this.options.bundle(bundleId);
    if (!bundle?.draft) return;
    await this.options.mappings.replaceRepos(bundle.projectId, bundle.draft.repositories);
  }

  /** 창을 닫는다. */
  close(): void {
    if (!this.current) return;
    this.openId += 1;
    this.set(null);
  }

  /** 묶음이 바뀌었을 때 부른다. 창을 연 묶음이 사라졌거나 더는 고를 수 없는 상태(생성 중, 처리됨 등)가 되면 닫는다. */
  bundlesChanged(): void {
    if (!this.current) return;
    /** 창을 연 묶음. */
    const bundle = this.options.bundle(this.current.bundleId);
    if (!bundle || !canPickRepos(bundle.status)) this.close();
  }

  /**
   * 묶음의 후보를 만든다. 지금 쓰는 저장소(체크함), 작업 폴더에서 찾은 저장소, 다른 Flow 프로젝트의 매핑에 쓰인 저장소 순서이고
   * 같은 저장소는 한 번만 든다. 폴더를 찾을 수 없는 매핑 저장소는 넣지 않는다.
   */
  private choicesFor(bundle: MentionBundle, found: readonly RepoCandidate[]): RepoChoice[] {
    /** 저장소 매핑. */
    const mappings = this.options.mappings.state().mappings;
    /** 경로마다 작업 폴더 안의 이름. */
    const foundNames = new Map(found.map((candidate) => [candidate.path, candidate.name]));
    /** 모은 후보. 경로로 거른다. */
    const choices = new Map<string, RepoChoice>();
    /** 후보를 더한다. 이미 든 저장소는 그대로 둔다. */
    const add = (path: string, group: RepoChoiceGroup) => {
      if (!choices.has(path)) choices.set(path, { name: foundNames.get(path) ?? basename(path), path, group, checked: group === 'current' });
    };
    for (const path of currentRepos(bundle, mappings.find((mapping) => mapping.projectId === bundle.projectId)?.repos.map((repo) => repo.path) ?? [])) {
      add(path, 'current');
    }
    for (const candidate of found) add(candidate.path, 'work-folder');
    for (const mapping of mappings) {
      if (mapping.projectId === bundle.projectId) continue;
      for (const repo of mapping.repos) if (repo.status !== 'missing') add(repo.path, 'mapping');
    }
    return [...choices.values()];
  }

  /** 열린 창의 후보를 `update`로 바꾼다. `null`을 돌려주면 바꾸지 않는다. */
  private updateChoices(update: (choices: RepoChoice[]) => RepoChoice[] | null): void {
    /** 열린 창. */
    const current = this.current;
    if (current?.status !== 'ready') return;
    /** 바꾼 후보. */
    const next = update(current.choices);
    if (next) this.set({ ...current, choices: next });
  }

  /** 상태를 바꾸고 알린다. */
  private set(next: OpenPicker | null): void {
    this.current = next;
    this.emit();
  }

  /** 듣는 쪽에 상태가 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * 묶음이 지금 쓰는 저장소. 창을 열 때 체크해 둔다. 초안이 있으면 그 초안을 만든 저장소이고,
 * 선택 실행이 고르지 않았으면 에이전트가 짚은 후보, 연결된 폴더가 사라졌으면 고른 구성이나 매핑에서 남은 폴더다.
 */
function currentRepos(bundle: MentionBundle, mappedRepos: readonly string[]): string[] {
  if (bundle.draft) return [...bundle.draft.repositories];
  switch (bundle.repoCheck?.kind) {
    case 'unsure':
    case 'unrelated':
      return [...bundle.repoCheck.picked];
    case 'missing-folders': {
      /** 찾을 수 없는 폴더. */
      const missing = bundle.repoCheck.paths;
      return (bundle.userRepos ?? mappedRepos).filter((path) => !missing.includes(path));
    }
    default:
      return [];
  }
}

/** 체크한 후보의 경로. 후보 순서다. */
function checkedPaths(choices: readonly RepoChoice[]): string[] {
  return choices.filter((choice) => choice.checked).map((choice) => choice.path);
}
