import type { ManualRequestResult } from '../bundles/mention-bundles';
import type { ManualCheckLoadFailure, ManualMentionCandidate, ManualMentionCheck } from './manual-mention-check';
import type { RecentMentionCursor } from './recent-mentions';

/** 최근 멘션 확인 시트를 여는 창. 작은 창의 빈 화면(`popover`)이나 설정 "초안" 칸(`settings`)이다. */
export type ManualCheckWindow = 'popover' | 'settings';

/** 열린 시트. */
export type ManualCheckSheet =
  /** 처음 불러오는 중이다. */
  | { window: ManualCheckWindow; status: 'loading' }
  /** 불러왔다. 최신이 앞이다. `hasMore`면 [더 보기]로 이어 불러올 수 있고, `loadingMore`는 이어 불러오는 중, `moreFailure`는 이어 불러오지 못한 까닭이다. */
  | { window: ManualCheckWindow; status: 'loaded'; candidates: ManualMentionCandidate[]; hasMore: boolean; loadingMore: boolean; moreFailure: ManualCheckLoadFailure | null }
  /** 불러오지 못했다. */
  | { window: ManualCheckWindow; status: 'failed'; reason: ManualCheckLoadFailure };

/** 최근 멘션 확인 시트의 상태. */
export interface ManualCheckState {
  /** 열린 시트. 닫혀 있으면 `null`. */
  sheet: ManualCheckSheet | null;
}

/** 최근 멘션 확인 시트에 필요한 것. */
export interface ManualCheckSessionOptions {
  /** 최근 멘션을 불러오고 고른 멘션으로 수동 요청 묶음을 만드는 서비스. */
  check: Pick<ManualMentionCheck, 'listMentions' | 'request'>;
  /** 지금 시트를 열 수 있는지 본다. 감지를 시작했고 쓸 수 있는 Flow 키가 있어야 한다. */
  canOpen: () => boolean;
  /** 고른 항목의 묶음(새로 만들었거나 이미 있던 묶음)을 사용자에게 보인다. */
  showBundle: (bundleId: number) => void;
}

/**
 * 최근 멘션 확인 시트의 열림과 불러오기 상태를 든다. 멘션 목록은 "더 보기"로 10건씩 이어 불러오고, 하나를 고르면 수동 요청 묶음을 만들어 시트를 닫는다.
 * 이어 불러올 커서는 main 메모리에만 두고 화면에는 "더 있음"만 알린다.
 */
export class ManualCheckSession {
  /** 열린 시트. */
  private sheet: ManualCheckSheet | null = null;
  /** 다음 더 보기가 이어 갈 자리. 끝이면 `null`. */
  private next: RecentMentionCursor | null = null;
  /** 마지막으로 시작한 불러오기의 번호. 늦게 끝난 옛 불러오기가 새 결과를 덮지 않게 한다. */
  private loadRequest = 0;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: ManualCheckSessionOptions) {}

  /** 지금 상태. */
  state(): ManualCheckState {
    return { sheet: this.sheet && structuredClone(this.sheet) };
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

  /** `window` 창에 시트를 열고 최근 멘션을 불러온다. 열 수 없는 때에는 아무것도 하지 않는다. */
  async open(window: ManualCheckWindow): Promise<void> {
    if (!this.options.canOpen()) return;
    await this.load(window);
  }

  /** 열린 시트의 목록을 처음부터 다시 불러온다. 닫혀 있으면 아무것도 하지 않는다. */
  async reload(): Promise<void> {
    if (this.sheet) await this.load(this.sheet.window);
  }

  /** 시트를 닫는다. */
  close(): void {
    this.loadRequest += 1;
    this.next = null;
    this.set(null);
  }

  /** 목록 끝에서 10건을 이어 불러온다. 이어 불러올 자리가 없거나 이미 불러오는 중이면 아무것도 하지 않는다. */
  async more(): Promise<void> {
    /** 열린 시트. */
    const sheet = this.sheet;
    if (sheet?.status !== 'loaded' || !sheet.hasMore || sheet.loadingMore || this.next === null) return;
    /** 이 불러오기의 번호. */
    const request = ++this.loadRequest;
    this.set({ ...sheet, loadingMore: true, moreFailure: null });
    /** 불러온 결과. */
    const result = await this.options.check.listMentions(this.next);
    if (request !== this.loadRequest) return;
    if (!result.ok) {
      this.set({ ...sheet, loadingMore: false, moreFailure: result.reason });
      return;
    }
    this.next = result.next;
    this.set({ ...sheet, candidates: [...sheet.candidates, ...result.candidates], hasMore: result.next !== null, loadingMore: false, moreFailure: null });
  }

  /**
   * 목록에서 알림 `alarmId`의 멘션을 골라 시트를 닫고 수동 요청 묶음을 만든 뒤 그 묶음을 보인다.
   * 이미 묶음이 있으면 새로 만들지 않고 그 묶음을 보인다. 목록에 없는 멘션이면 아무것도 하지 않는다.
   */
  async pick(alarmId: string): Promise<ManualRequestResult | null> {
    /** 고른 멘션. */
    const chosen = this.sheet?.status === 'loaded' ? this.sheet.candidates.find((candidate) => candidate.mention.alarmId === alarmId) : undefined;
    if (!chosen) return null;
    this.close();
    /** 만들거나 찾은 묶음. */
    const result = await this.options.check.request(chosen);
    this.options.showBundle(result.bundleId);
    return result;
  }

  /** 최근 멘션을 처음부터 불러와 `window` 창의 시트에 둔다. */
  private async load(window: ManualCheckWindow): Promise<void> {
    /** 이 불러오기의 번호. */
    const request = ++this.loadRequest;
    this.next = null;
    this.set({ window, status: 'loading' });
    /** 불러온 결과. */
    const result = await this.options.check.listMentions(null);
    if (request !== this.loadRequest) return;
    if (!result.ok) {
      this.set({ window, status: 'failed', reason: result.reason });
      return;
    }
    this.next = result.next;
    this.set({ window, status: 'loaded', candidates: result.candidates, hasMore: result.next !== null, loadingMore: false, moreFailure: null });
  }

  /** 시트를 바꾸고 듣는 쪽에 알린다. */
  private set(sheet: ManualCheckSheet | null): void {
    this.sheet = sheet;
    for (const listener of this.listeners) listener();
  }
}
