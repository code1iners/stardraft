import { mentionLocationOf } from '../detection/mention';
import { errorFields, type Logger } from '../logging/logger';
import type { CancelScheduled, Clock } from '../ports/clock';
import { isProcessed, type MentionBundle, type MinimalRecord } from './mention-bundle';
import type { MentionBundles } from './mention-bundles';

/** 하루(밀리초). */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 처리됨 목록에 남기는 기간. 처리한 때부터 센다. 설정에서 바꿀 수 없다. */
export const RETENTION_MS = 7 * DAY_MS;

/** 켜 둔 앱이 처리됨 목록을 정리하는 간격. */
export const CLEANUP_INTERVAL_MS = DAY_MS;

/**
 * 처리됨 목록에서 빠질 때가 됐는지 본다. 처리한 지 7일이 된 처리됨 묶음이다. 대기 중인 묶음은 기한이 없다.
 * 되돌리면 처리한 시각이 지워지고 다시 처리할 때 새로 적히므로, 7일은 마지막으로 처리한 때부터 센다.
 */
export function isExpired(bundle: Pick<MentionBundle, 'status' | 'processedAt' | 'createdAt'>, now: number): boolean {
  return isProcessed(bundle.status) && now - processedAtOf(bundle) >= RETENTION_MS;
}

/** 처리됨 묶음의 최소 기록. 묶음 자리, 멘션 위치, 상태와 처리한 시각, 이 PC가 게시한 글과 그 글이 답한 범위만 옮긴다. */
export function minimalRecordOf(bundle: MentionBundle): MinimalRecord {
  if (!isProcessed(bundle.status)) throw new Error(`처리됨이 아닌 묶음 ${bundle.id}입니다.`);
  /** 이 PC가 게시한 글의 ID. */
  const postedId = bundle.posting?.postedId ?? null;
  return {
    bundleId: bundle.id,
    postId: bundle.postId,
    remarkId: bundle.remarkId,
    mentions: bundle.mentions.map(mentionLocationOf),
    status: bundle.status,
    processedAt: processedAtOf(bundle),
    postedId,
    answeredMentions: postedId === null ? [] : bundle.posting!.answeredMentions.map(mentionLocationOf),
  };
}

/** 처리한 시각. 처리한 시각 없이 처리됨이 된 묶음은 없어야 하지만, 있으면 영영 남지 않게 만든 시각으로 센다. */
function processedAtOf(bundle: Pick<MentionBundle, 'processedAt' | 'createdAt'>): number {
  return bundle.processedAt ?? bundle.createdAt;
}

/** 처리됨 목록 정리에 필요한 것. */
export interface BundleRetentionOptions {
  /** 정리할 멘션 묶음. */
  bundles: Pick<MentionBundles, 'archiveExpired'>;
  /** 하루마다 정리를 예약하는 시계. */
  clock: Clock;
  /** 진단 로그. */
  logger: Logger;
}

/** 처리됨 목록 정리. 앱을 켤 때와 그 뒤 하루에 한 번, 처리한 지 7일이 된 묶음을 최소 기록만 남기고 지운다. */
export class BundleRetention {
  /** 다음 정리 예약을 취소하는 함수. 멈춰 있으면 `null`. */
  private cancelScheduled: CancelScheduled | null = null;

  constructor(private readonly options: BundleRetentionOptions) {}

  /** 지금 정리하고 하루마다 다시 정리한다. 이미 돌고 있으면 아무것도 하지 않는다. */
  start(): void {
    if (this.cancelScheduled) return;
    this.cleanUpAndSchedule();
  }

  /** 다음 정리를 멈춘다. 앱을 끝낼 때 부른다. 진행 중인 정리는 끝까지 간다. */
  stop(): void {
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  /** 지금 정리하고 다음 정리를 예약한다. 정리가 실패해도 다음 날 다시 한다. */
  private cleanUpAndSchedule(): void {
    void this.options.bundles
      .archiveExpired()
      .catch((error: unknown) => this.options.logger.error('retention.cleanup-failed', errorFields(error)));
    this.cancelScheduled = this.options.clock.after(CLEANUP_INTERVAL_MS, () => this.cleanUpAndSchedule());
  }
}
