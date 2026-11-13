import type { ManualRequestResult } from '../bundles/mention-bundles';
import type {
  ManualAssignmentCandidate,
  ManualCheckLoadFailure,
  ManualMentionCandidate,
  ManualMentionCheck,
} from './manual-mention-check';
import type { RecentAssignmentCursor } from './recent-assignments';
import type { RecentMentionCursor } from './recent-mentions';

/** 최근 멘션 확인 시트를 여는 창. 작은 창의 빈 화면(`popover`)이나 설정 "초안" 칸(`settings`)이다. */
export type ManualCheckWindow = 'popover' | 'settings';

/** 시트의 탭. 멘션이 기본이다. */
export type ManualCheckTab = 'mentions' | 'assignments';

/** 탭 하나의 목록 상태. */
export type ManualCheckTabState<T> =
  /** 아직 불러오지 않았다. 담당 업무 탭은 처음 열 때까지 이 상태다. */
  | { status: 'idle' }
  /** 처음 불러오는 중이다. */
  | { status: 'loading' }
  /** 불러왔다. 최신이 앞이다. `hasMore`면 [더 보기]로 이어 불러올 수 있고, `loadingMore`는 이어 불러오는 중, `moreFailure`는 이어 불러오지 못한 까닭이다. */
  | { status: 'loaded'; candidates: T[]; hasMore: boolean; loadingMore: boolean; moreFailure: ManualCheckLoadFailure | null }
  /** 불러오지 못했다. */
  | { status: 'failed'; reason: ManualCheckLoadFailure };

/** 열린 시트. 탭마다 자기 목록 상태를 가진다. */
export interface ManualCheckSheet {
  /** 시트를 연 창. */
  window: ManualCheckWindow;
  /** 지금 보는 탭. */
  tab: ManualCheckTab;
  /** 멘션 탭의 목록. */
  mentions: ManualCheckTabState<ManualMentionCandidate>;
  /** 담당 업무 탭의 목록. */
  assignments: ManualCheckTabState<ManualAssignmentCandidate>;
}

/** 최근 멘션 확인 시트의 상태. */
export interface ManualCheckState {
  /** 열린 시트. 닫혀 있으면 `null`. */
  sheet: ManualCheckSheet | null;
}

/** 최근 멘션 확인 시트에 필요한 것. */
export interface ManualCheckSessionOptions {
  /** 최근 멘션·담당 업무를 불러오고 고른 항목으로 수동 요청 묶음을 만드는 서비스. */
  check: Pick<ManualMentionCheck, 'listMentions' | 'listAssignments' | 'request' | 'requestAssignment'>;
  /** 지금 시트를 열 수 있는지 본다. 감지를 시작했고 쓸 수 있는 Flow 키가 있어야 한다. */
  canOpen: () => boolean;
  /** 고른 항목의 묶음(새로 만들었거나 이미 있던 묶음)을 사용자에게 보인다. */
  showBundle: (bundleId: number) => void;
}

/** 한 번 불러온 결과. 항목과, 이어 불러올 자리(끝이면 `null`)다. */
type PageResult<T, Cursor> = { ok: true; candidates: T[]; next: Cursor | null } | { ok: false; reason: ManualCheckLoadFailure };

/**
 * 탭 하나의 목록. 10건씩 이어 불러오고 상태를 든다. 이어 불러올 커서는 main 메모리에만 두고 화면에는 "더 있음"만 알린다.
 * 상태가 바뀔 때마다 `onChange`를 부른다.
 */
class TabList<T, Cursor> {
  /** 지금 상태. */
  state: ManualCheckTabState<T> = { status: 'idle' };
  /** 다음 더 보기가 이어 갈 자리. 끝이면 `null`. */
  private next: Cursor | null = null;
  /** 마지막으로 시작한 불러오기의 번호. 늦게 끝난 옛 불러오기가 새 결과를 덮지 않게 한다. */
  private request = 0;

  constructor(
    private readonly fetchPage: (from: Cursor | null) => Promise<PageResult<T, Cursor>>,
    private readonly onChange: () => void,
  ) {}

  /** 처음부터 불러온다. */
  async load(): Promise<void> {
    /** 이 불러오기의 번호. */
    const request = ++this.request;
    this.next = null;
    this.set({ status: 'loading' });
    /** 불러온 결과. */
    const result = await this.fetchPage(null);
    if (request !== this.request) return;
    if (!result.ok) {
      this.set({ status: 'failed', reason: result.reason });
      return;
    }
    this.next = result.next;
    this.set({ status: 'loaded', candidates: result.candidates, hasMore: result.next !== null, loadingMore: false, moreFailure: null });
  }

  /** 끝에서 10건을 이어 불러온다. 이어 불러올 자리가 없거나 이미 불러오는 중이면 아무것도 하지 않는다. */
  async more(): Promise<void> {
    /** 지금 목록. */
    const current = this.state;
    if (current.status !== 'loaded' || !current.hasMore || current.loadingMore || this.next === null) return;
    /** 이 불러오기의 번호. */
    const request = ++this.request;
    this.set({ ...current, loadingMore: true, moreFailure: null });
    /** 불러온 결과. */
    const result = await this.fetchPage(this.next);
    if (request !== this.request) return;
    if (!result.ok) {
      this.set({ ...current, loadingMore: false, moreFailure: result.reason });
      return;
    }
    this.next = result.next;
    this.set({ ...current, candidates: [...current.candidates, ...result.candidates], hasMore: result.next !== null, loadingMore: false, moreFailure: null });
  }

  /** 불러오던 것을 버리고 처음 상태로 돌린다. */
  reset(): void {
    this.request += 1;
    this.next = null;
    this.state = { status: 'idle' };
  }

  /** 목록 상태를 바꾸고 알린다. */
  private set(state: ManualCheckTabState<T>): void {
    this.state = state;
    this.onChange();
  }
}

/**
 * 최근 멘션 확인 시트의 열림·탭·불러오기 상태를 든다. 멘션 탭이 기본이고 담당 업무 탭은 처음 열 때 불러온다.
 * 탭마다 "더 보기" 커서와 불러오기 상태를 따로 가지며, 하나를 고르면 수동 요청 묶음을 만들어 시트를 닫는다.
 */
export class ManualCheckSession {
  /** 시트를 연 창과 지금 탭. 닫혀 있으면 `null`. */
  private opened: { window: ManualCheckWindow; tab: ManualCheckTab } | null = null;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();
  /** 멘션 탭의 목록. */
  private readonly mentions = new TabList<ManualMentionCandidate, RecentMentionCursor>(
    (from): Promise<PageResult<ManualMentionCandidate, RecentMentionCursor>> => this.options.check.listMentions(from),
    () => this.notify(),
  );
  /** 담당 업무 탭의 목록. */
  private readonly assignments = new TabList<ManualAssignmentCandidate, RecentAssignmentCursor>(
    (from): Promise<PageResult<ManualAssignmentCandidate, RecentAssignmentCursor>> => this.options.check.listAssignments(from),
    () => this.notify(),
  );

  constructor(private readonly options: ManualCheckSessionOptions) {}

  /** 지금 상태. */
  state(): ManualCheckState {
    if (!this.opened) return { sheet: null };
    return { sheet: structuredClone({ ...this.opened, mentions: this.mentions.state, assignments: this.assignments.state }) };
  }

  /** 지금 시트를 열 수 있는지 여부. */
  canOpen(): boolean {
    return this.options.canOpen();
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** `window` 창에 시트를 열고 멘션 탭의 최근 멘션을 불러온다. 열 수 없는 때에는 아무것도 하지 않는다. */
  async open(window: ManualCheckWindow): Promise<void> {
    if (!this.options.canOpen()) return;
    this.assignments.reset();
    this.opened = { window, tab: 'mentions' };
    await this.mentions.load();
  }

  /** 탭을 바꾼다. 담당 업무 탭은 아직 불러오지 않았을 때만 처음 불러온다. 닫혀 있으면 아무것도 하지 않는다. */
  async selectTab(tab: ManualCheckTab): Promise<void> {
    if (!this.opened) return;
    this.opened.tab = tab;
    if (tab === 'assignments' && this.assignments.state.status === 'idle') await this.assignments.load();
    else this.notify();
  }

  /** 지금 보는 탭의 목록을 처음부터 다시 불러온다. 닫혀 있으면 아무것도 하지 않는다. */
  async reload(): Promise<void> {
    if (!this.opened) return;
    await (this.opened.tab === 'mentions' ? this.mentions : this.assignments).load();
  }

  /** 시트를 닫는다. */
  close(): void {
    this.mentions.reset();
    this.assignments.reset();
    this.opened = null;
    this.notify();
  }

  /** 지금 보는 탭의 목록 끝에서 10건을 이어 불러온다. */
  async more(): Promise<void> {
    if (!this.opened) return;
    await (this.opened.tab === 'mentions' ? this.mentions : this.assignments).more();
  }

  /**
   * 지금 보는 탭에서 알림 `alarmId`의 항목을 골라 시트를 닫고 수동 요청 묶음을 만든 뒤 그 묶음을 보인다.
   * 이미 묶음이 있으면 새로 만들지 않고 그 묶음을 보인다. 목록에 없는 항목이면 아무것도 하지 않는다.
   */
  async pick(alarmId: string): Promise<ManualRequestResult | null> {
    if (!this.opened) return null;
    /** 고른 항목으로 묶음을 만드는 일. 목록에 없으면 `null`. */
    const request = this.requestOf(this.opened.tab, alarmId);
    if (!request) return null;
    this.close();
    /** 만들거나 찾은 묶음. */
    const result = await request();
    this.options.showBundle(result.bundleId);
    return result;
  }

  /** `tab`의 목록에서 `alarmId` 항목으로 묶음을 만드는 일을 돌려준다. 목록에 없으면 `null`. */
  private requestOf(tab: ManualCheckTab, alarmId: string): (() => Promise<ManualRequestResult>) | null {
    if (tab === 'mentions') {
      /** 멘션 목록. */
      const list = this.mentions.state;
      /** 고른 멘션. */
      const chosen = list.status === 'loaded' ? list.candidates.find((candidate) => candidate.mention.alarmId === alarmId) : undefined;
      return chosen ? () => this.options.check.request(chosen) : null;
    }
    /** 담당 업무 목록. */
    const list = this.assignments.state;
    /** 고른 업무. */
    const chosen = list.status === 'loaded' ? list.candidates.find((candidate) => candidate.alarm.alarmId === alarmId) : undefined;
    return chosen ? () => this.options.check.requestAssignment(chosen) : null;
  }

  /** 듣는 쪽에 상태가 바뀌었음을 알린다. */
  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}
