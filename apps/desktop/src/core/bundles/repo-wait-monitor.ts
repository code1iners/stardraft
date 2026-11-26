import type { CancelScheduled, Clock } from '../ports/clock';
import { errorFields, type Logger } from '../logging/logger';
import type { MentionBundles } from './mention-bundles';

/** 정해 둔 저장소의 폴더가 돌아왔는지 다시 확인하는 주기(밀리초). 저장소 확인 필요인 묶음이 있는 동안만 돈다. */
export const REPO_WAIT_RECHECK_MS = 60_000;

/** 저장소 대기 감시에 필요한 것. */
export interface RepoWaitMonitorOptions {
  /** 저장소 대기(저장소 매핑 필요, 저장소 확인 필요) 묶음을 다시 판정할 멘션 묶음. */
  bundles: Pick<MentionBundles, 'resumeRepoWaiting' | 'hasMissingFolderWaiting' | 'onChange'>;
  /** 60초마다 다시 확인하도록 예약하는 시계. */
  clock: Clock;
  /** 진단 로그. 묶음 ID와 개수만 남긴다. */
  logger: Logger;
}

/**
 * 저장소 대기 감시. 저장소 매핑 필요나 저장소 확인 필요로 기다리는 묶음이 읽을 저장소를 얻었는지 다시 확인해 저절로 재개한다.
 * 다시 확인하는 때는 앱을 켤 때(`start`), 절전에서 깰 때와 저장소 매핑이 바뀔 때(`checkNow`), 그리고
 * 저장소 확인 필요(폴더 없음)인 묶음이 있는 동안 60초마다다. 저장소 매핑 필요는 매핑이 바뀔 때만 풀리므로 주기로 다시 확인하지 않는다.
 * 같은 확인이 겹치면 하나로 모아, 확인이 끝난 뒤 한 번 더 한다.
 */
export class RepoWaitMonitor {
  /** 다음 주기 확인의 예약을 취소하는 함수. 예약이 없으면 `null`. */
  private cancelScheduled: CancelScheduled | null = null;
  /** 지금 확인하는 중인지 여부. */
  private running = false;
  /** 확인하는 사이에 다시 확인을 요청받았는지 여부. */
  private rerun = false;
  /** 멈췄는지 여부. */
  private stopped = true;
  /** 묶음 변화 구독을 끊는 함수. */
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly options: RepoWaitMonitorOptions) {}

  /** 지금 한 번 확인하고, 이후 저장소 확인 필요 묶음이 생기면 60초마다 확인한다. 이미 돌고 있으면 아무것도 하지 않는다. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    // 묶음이 저장소 확인 필요가 되는 순간부터 주기를 센다.
    this.unsubscribe = this.options.bundles.onChange(() => this.schedule());
    this.checkNow();
  }

  /** 예약과 구독을 멈춘다. 앱을 끝낼 때 부른다. 진행 중인 확인은 끝까지 간다. */
  stop(): void {
    this.stopped = true;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** 지금 확인한다. 저장소 매핑이 바뀔 때와 절전에서 깰 때 부른다. 확인이 진행 중이면 끝난 뒤 한 번 더 한다. */
  checkNow(): void {
    if (this.stopped) return;
    if (this.running) {
      this.rerun = true;
      return;
    }
    void this.run();
  }

  /** 읽을 저장소가 생긴 묶음을 재개하고 다음 주기 확인을 예약한다. */
  private async run(): Promise<void> {
    this.running = true;
    try {
      do {
        this.rerun = false;
        /** 생성 중으로 올린 묶음 수. */
        const resumed = await this.options.bundles.resumeRepoWaiting();
        if (resumed > 0) this.options.logger.info('repo-wait.resumed', { count: resumed });
      } while (this.rerun && !this.stopped);
    } catch (error) {
      // 다음 확인에서 다시 한다.
      this.options.logger.error('repo-wait.recheck-failed', errorFields(error));
    } finally {
      this.running = false;
    }
    this.schedule();
  }

  /** 저장소 확인 필요 묶음이 있고 예약이 없으면 60초 뒤 확인을 예약한다. 없으면 예약하지 않는다. */
  private schedule(): void {
    if (this.stopped || this.cancelScheduled || !this.options.bundles.hasMissingFolderWaiting()) return;
    this.cancelScheduled = this.options.clock.after(REPO_WAIT_RECHECK_MS, () => {
      this.cancelScheduled = null;
      this.checkNow();
    });
  }
}
