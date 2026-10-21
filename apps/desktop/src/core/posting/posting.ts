import type { MentionBundles } from '../bundles/mention-bundles';
import { isPostBody } from '../flow/mention-place';
import type { Logger } from '../logging/logger';
import type { CancelScheduled, Clock } from '../ports/clock';
import type { FlowApiFailure, FlowApiResult, FlowConnection } from '../ports/flow-api';

/** 게시 취소 카운트다운(밀리초). [게시]를 누르고 이만큼 지나야 게시 요청을 보낸다. 설정에서 바꿀 수 없다. */
export const POST_COUNTDOWN_MS = 5_000;

/** 게시에 필요한 것. */
export interface PostingOptions {
  /** 게시할 멘션 묶음. 게시 중·게시됨 상태와 게시 기록을 맡는다. */
  bundles: MentionBundles;
  /** 지금 키로 Flow 연결을 만든다. 쓸 키가 없으면 `null`. */
  connectFlow: () => FlowConnection | null;
  /** 카운트다운을 재는 시계. */
  clock: Clock;
  /** 진단 로그. 묶음 ID와 결과만 남기고 게시 본문은 남기지 않는다. */
  logger: Logger;
}

/** 진행 중인 카운트다운. */
interface Countdown {
  /** 게시 요청을 보낼 시각(Unix epoch 밀리초). */
  endsAt: number;
  /** 게시 요청 예약을 지운다. */
  cancel: CancelScheduled;
}

/**
 * 게시. [게시]를 누르면 묶음을 게시 중으로 두고 5초 카운트다운을 시작하며, 그동안 취소할 수 있다. 확인 단계는 없다.
 * 카운트다운이 끝나면 게시 요청을 보내기 직전에 게시 본문을 먼저 기록하고, 본문 묶음은 게시물의 새 댓글로, 댓글 스레드 묶음은 그 댓글의 대댓글로 올린다.
 * 성공하면 올라간 글의 ID를 기록하고 게시됨으로 둔다. 올라가지 않은 것이 확실하면 준비됨으로 돌리고,
 * 올라갔는지 알 수 없으면(응답 없음, `5xx`) 다시 게시하지 못하게 보내기 전 기록을 둔 채 게시 중으로 둔다.
 */
export class Posting {
  /** 묶음마다 진행 중인 카운트다운. */
  private readonly countdowns = new Map<number, Countdown>();
  /** 카운트다운이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: PostingOptions) {}

  /**
   * [게시]. 준비됨 묶음을 게시 중으로 두고 5초 뒤 게시 요청을 보내도록 예약한다.
   * 준비됨이 아니거나 게시할 수 없는 글(빈 편집기 텍스트, 4,000자 초과)이면 아무것도 하지 않는다.
   */
  async post(bundleId: number): Promise<void> {
    if (this.countdowns.has(bundleId)) return;
    // 게시 중이 되었다는 묶음 변경을 받은 화면이 카운트다운도 함께 보도록, 상태를 바꾸기 전에 카운트다운을 먼저 둔다.
    /** 이 묶음의 카운트다운. */
    const countdown: Countdown = {
      endsAt: this.options.clock.now() + POST_COUNTDOWN_MS,
      cancel: this.options.clock.after(POST_COUNTDOWN_MS, () => void this.sendSafely(bundleId)),
    };
    this.countdowns.set(bundleId, countdown);

    if (await this.options.bundles.startPosting(bundleId)) {
      this.options.logger.info('posting.countdown-started', { bundleId });
      this.emit();
      return;
    }
    countdown.cancel();
    this.countdowns.delete(bundleId);
  }

  /** 카운트다운 중인 게시를 취소한다. 묶음은 준비됨으로 돌아간다. 카운트다운이 끝나 게시 요청을 보냈으면 아무것도 하지 않는다. */
  async cancel(bundleId: number): Promise<void> {
    /** 취소할 카운트다운. */
    const countdown = this.countdowns.get(bundleId);
    if (!countdown) return;
    countdown.cancel();
    this.countdowns.delete(bundleId);
    this.emit();
    await this.options.bundles.cancelPosting(bundleId);
  }

  /** 카운트다운이 끝나 게시 요청을 보낼 시각. 카운트다운 중이 아니면 `null`. */
  countdownEndsAt(bundleId: number): number | null {
    return this.countdowns.get(bundleId)?.endsAt ?? null;
  }

  /** 카운트다운이 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 앱을 끝낼 때 카운트다운을 모두 멈춘다. 예약된 게시 요청은 보내지 않는다. */
  stop(): void {
    for (const countdown of this.countdowns.values()) countdown.cancel();
    this.countdowns.clear();
  }

  /**
   * 카운트다운이 끝난 묶음의 게시 요청을 보내고, 도중에 예외가 나면 로그만 남긴다.
   * 보내기 전 기록을 남긴 뒤라면 묶음은 그 기록을 둔 채 게시 중으로 남는다. 올라갔는지 알 수 없기 때문이다.
   */
  private async sendSafely(bundleId: number): Promise<void> {
    try {
      await this.send(bundleId);
    } catch {
      // 예외 문구에 게시 본문이나 Flow 글이 섞일 수 있어 로그에는 남기지 않는다.
      this.options.logger.error('posting.crashed', { bundleId });
    }
  }

  /**
   * 카운트다운이 끝난 묶음의 게시 요청을 보낸다. 보내기 직전에 게시 본문을 먼저 기록하고,
   * 본문 묶음은 `POST /user/comments/{postId}`, 댓글 스레드 묶음은 `POST /user/comments/{postId}/replies/{remarkId}`로 보낸다.
   */
  private async send(bundleId: number): Promise<void> {
    this.countdowns.delete(bundleId);
    this.emit();

    /** 게시할 묶음. */
    const bundle = this.options.bundles.get(bundleId);
    if (!bundle) return;
    /** 지금 키로 만든 Flow 연결. */
    const flow = this.options.connectFlow();
    if (!flow) {
      this.options.logger.warn('posting.no-key', { bundleId });
      await this.options.bundles.returnToReady(bundleId);
      return;
    }
    /** 기록한 게시 본문. 그사이 취소했으면 `null`. */
    const body = await this.options.bundles.recordPostRequest(bundleId);
    if (body === null) return;

    /** 게시 요청의 결과. 올라간 글의 ID다. */
    const result: FlowApiResult<string> = isPostBody(bundle)
      ? mapResult(await flow.api.createComment(bundle.postId, body), (created) => created.commentId)
      : mapResult(await flow.api.createReply(bundle.postId, bundle.remarkId, body), (created) => created.replyId);
    if (result.ok) {
      this.options.logger.info('posting.posted', { bundleId });
      await this.options.bundles.markPosted(bundleId, result.value);
      return;
    }

    if (isOutcomeUnknown(result.failure)) {
      // REST에는 댓글 삭제가 없어 그대로 다시 보내면 중복 댓글이 남을 수 있다. 보내기 전 기록을 둔 채 게시 중으로 두어 [게시]를 막는다.
      this.options.logger.warn('posting.outcome-unknown', { bundleId, reason: result.failure.kind });
      return;
    }
    this.options.logger.warn('posting.failed', { bundleId, reason: result.failure.kind });
    if (result.failure.kind === 'unauthorized') flow.reportKeyRejected();
    await this.options.bundles.returnToReady(bundleId);
  }

  /** 듣는 쪽에 카운트다운이 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/**
 * 게시 요청이 올라갔는지 알 수 없는 실패인지 본다. 응답을 받지 못했거나(`5xx` 포함),
 * 성공 응답인데 만든 글의 ID를 읽을 수 없는 경우다. 요청 한도(`429`)와 그 밖의 거절은 처리되지 않은 것이 확실하다.
 */
function isOutcomeUnknown(failure: FlowApiFailure): boolean {
  return failure.kind === 'network' || failure.kind === 'unexpected-response' || (failure.kind === 'http' && failure.status >= 500);
}

/** 성공한 결과의 값을 바꾼다. 실패는 그대로 둔다. */
function mapResult<T, U>(result: FlowApiResult<T>, map: (value: T) => U): FlowApiResult<U> {
  return result.ok ? { ok: true, value: map(result.value) } : result;
}
