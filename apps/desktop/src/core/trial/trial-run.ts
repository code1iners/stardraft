import type { MentionBundles } from '../bundles/mention-bundles';
import { errorFields, type Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { FlowConnection } from '../ports/flow-api';
import { listRecentMentions, type RecentMention } from './recent-mentions';

/** 멘션 고르기 목록을 연 창. 작은 창의 빈 화면이나 설정 "초안" 칸이다. */
export type TrialWindow = 'popover' | 'settings';

/** 최근 멘션을 불러오지 못한 까닭. */
export type TrialLoadFailure = 'no-key' | 'unauthorized' | 'network' | 'rate-limited' | 'unexpected';

/** 멘션 고르기 목록에 보이는 멘션 하나. */
export interface TrialCandidate extends RecentMention {
  /** 멘션이 온 Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: string | null;
}

/** 멘션 고르기 목록. */
export type TrialPicker =
  /** 최근 멘션을 불러오는 중이다. */
  | { window: TrialWindow; status: 'loading' }
  /** 불러왔다. 최신이 앞이다. */
  | { window: TrialWindow; status: 'loaded'; candidates: TrialCandidate[] }
  /** 불러오지 못했다. */
  | { window: TrialWindow; status: 'failed'; reason: TrialLoadFailure };

/** 최근 멘션으로 시험의 상태. */
export interface TrialRunState {
  /** 열린 멘션 고르기 목록. 닫혀 있으면 `null`. */
  picker: TrialPicker | null;
}

/** 최근 멘션으로 시험에 필요한 것. */
export interface TrialRunOptions {
  /** 시험 묶음을 만들 멘션 묶음. 시험 묶음이 있는지도 여기서 본다. */
  bundles: Pick<MentionBundles, 'startTrial' | 'trialId'>;
  /** 지금 키로 Flow 연결을 만든다. 쓸 키가 없으면 `null`. */
  connectFlow: () => FlowConnection | null;
  /** 키 확인 때 얻은 내 사용자 ID. 모르면 `null`. */
  myUserId: () => string | null;
  /** 감지를 시작했는지 본다. 대기열이 돌아야 시험이 진행되므로 시작한 뒤에만 쓸 수 있다. */
  detectionStarted: () => boolean;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: (projectId: string) => Promise<string | null>;
  /** 멘션을 감지한 시각으로 쓸 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. ID와 개수만 남긴다. */
  logger: Logger;
}

/**
 * 최근 멘션으로 시험. 판정 규칙을 통과한 최근 멘션 10건을 멘션 고르기 목록으로 보이고, 사용자가 고른 멘션으로 시험 묶음을 만든다.
 * 자동으로 고르지 않는다. 감지를 시작한 뒤에만, 시험 묶음이 없을 때만 연다(한 번에 하나만).
 */
export class TrialRun {
  /** 열린 멘션 고르기 목록. */
  private picker: TrialPicker | null = null;
  /** 마지막으로 시작한 불러오기의 번호. 늦게 끝난 옛 불러오기가 새 결과를 덮지 않게 한다. */
  private loadRequest = 0;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: TrialRunOptions) {}

  /** 지금 상태. */
  state(): TrialRunState {
    return { picker: this.picker && structuredClone(this.picker) };
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** `window` 창에 멘션 고르기 목록을 열고 최근 멘션을 불러온다. 감지를 시작하기 전이거나 시험 묶음이 이미 있으면 열지 않는다. */
  async open(window: TrialWindow): Promise<void> {
    if (!this.options.detectionStarted() || this.options.bundles.trialId() !== null) return;
    await this.load(window);
  }

  /** 열린 목록의 최근 멘션을 다시 불러온다. 닫혀 있으면 아무것도 하지 않는다. */
  async reload(): Promise<void> {
    if (this.picker) await this.load(this.picker.window);
  }

  /** 멘션 고르기 목록을 닫는다. */
  close(): void {
    this.loadRequest += 1;
    this.set(null);
  }

  /** 목록에서 알림 `alarmId`의 멘션을 골라 목록을 닫고 시험 묶음을 만든다. 목록에 없는 멘션이면 아무것도 하지 않는다. */
  async start(alarmId: string): Promise<void> {
    /** 고른 멘션. */
    const chosen = this.picker?.status === 'loaded' ? this.picker.candidates.find((candidate) => candidate.mention.alarmId === alarmId) : undefined;
    if (!chosen) return;
    this.close();
    /** 만든 시험 묶음 ID. 그사이 다른 시험이 시작됐으면 `null`. */
    const bundleId = await this.options.bundles.startTrial(chosen);
    this.options.logger.info(bundleId === null ? 'trial.start-skipped' : 'trial.started', { bundleId, alarmId });
  }

  /** 최근 멘션을 불러와 `window` 창의 목록에 둔다. */
  private async load(window: TrialWindow): Promise<void> {
    /** 이 불러오기의 번호. */
    const request = ++this.loadRequest;
    this.set({ window, status: 'loading' });
    /** 불러온 목록. */
    const picker = await this.fetchPicker(window);
    if (request !== this.loadRequest) return;
    this.set(picker);
  }

  /** 최근 멘션을 불러와 목록으로 만든다. 불러오지 못하면 그 까닭이다. */
  private async fetchPicker(window: TrialWindow): Promise<TrialPicker> {
    /** 지금 키로 만든 Flow 연결. */
    const flow = this.options.connectFlow();
    /** 내 사용자 ID. */
    const myUserId = this.options.myUserId();
    if (!flow || myUserId === null) return { window, status: 'failed', reason: 'no-key' };
    try {
      /** 불러온 결과. */
      const result = await listRecentMentions(flow.api, myUserId, this.options.clock.now());
      if (!result.ok) {
        this.options.logger.warn('trial.load-failed', { reason: result.failure.kind });
        if (result.failure.kind === 'unauthorized') flow.reportKeyRejected();
        return { window, status: 'failed', reason: loadFailureOf(result.failure.kind) };
      }
      /** 프로젝트 이름을 붙인 멘션. 같은 프로젝트는 한 번만 찾는다. */
      const titles = new Map<string, Promise<string | null>>();
      /** 목록에 보일 멘션. */
      const candidates = await Promise.all(
        result.value.map(async (recent): Promise<TrialCandidate> => {
          /** 멘션이 온 Flow 프로젝트. */
          const { projectId } = recent.mention;
          if (!titles.has(projectId)) titles.set(projectId, this.options.projectTitle(projectId).catch(() => null));
          return { ...recent, projectTitle: await titles.get(projectId)! };
        }),
      );
      this.options.logger.info('trial.loaded', { count: candidates.length });
      return { window, status: 'loaded', candidates };
    } catch (error) {
      this.options.logger.error('trial.load-crashed', errorFields(error));
      return { window, status: 'failed', reason: 'unexpected' };
    }
  }

  /** 목록을 바꾸고 듣는 쪽에 알린다. */
  private set(picker: TrialPicker | null): void {
    this.picker = picker;
    for (const listener of this.listeners) listener();
  }
}

/** Flow 실패의 종류를 불러오지 못한 까닭으로 바꾼다. */
function loadFailureOf(kind: string): TrialLoadFailure {
  return kind === 'unauthorized' || kind === 'network' || kind === 'rate-limited' ? kind : 'unexpected';
}
