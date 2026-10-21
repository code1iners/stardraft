import { isPostOutcomePending, type MentionBundle, type PostFailureReason, type UnconfirmedPostReason } from '../bundles/mention-bundle';
import type { MentionBundles } from '../bundles/mention-bundles';
import { MentionJudge, type MyWritingsLookup } from '../flow/mention-judgement';
import { isPostBody } from '../flow/mention-place';
import type { Logger } from '../logging/logger';
import { waitAtMost, type CancelScheduled, type Clock } from '../ports/clock';
import type { FlowApiFailure, FlowApiResult, FlowConnection } from '../ports/flow-api';

/** 게시 취소 카운트다운(밀리초). [게시]를 누르고 이만큼 지나야 게시 요청을 보낸다. 설정에서 바꿀 수 없다. */
export const POST_COUNTDOWN_MS = 5_000;
/** 카운트다운이 끝난 뒤 게시를 누를 때의 확인이 끝나기를 기다려 주는 시간(밀리초). 이만큼 지나도 끝나지 않으면 그대로 게시한다. */
export const POST_CHECK_GRACE_MS = 5_000;

/** `429`에 `Retry-After`가 없을 때 다시 보내기 전에 기다리는 시간(밀리초). */
const DEFAULT_RATE_LIMIT_DELAY_MS = 10_000;
/** `429` 뒤 다시 보내기 전에 기다리는 가장 짧은 시간(밀리초). */
const MIN_RETRY_DELAY_MS = 1_000;
/** `429` 뒤 자동으로 기다려 줄 가장 긴 시간(밀리초). 더 기다려야 하면 다시 보내지 않고 게시 실패로 끝내, 묶음이 오래 게시 중에 묶이지 않게 한다. */
const MAX_RATE_LIMIT_DELAY_MS = 60_000;
/** 올라갔는지 확인하는 조회가 실패했을 때 다시 확인하기까지 기다리는 시간(밀리초). 폴링 주기와 같다. */
const CHECK_RETRY_MS = 60_000;
/** 앱을 끌 때 진행 중인 게시 요청의 응답을 기다려 주는 가장 긴 시간(밀리초). 설정에서 바꿀 수 없다. */
const QUIT_RESPONSE_WAIT_MS = 5_000;

/** 게시에 필요한 것. */
export interface PostingOptions {
  /** 게시할 멘션 묶음. 게시 중·게시됨 상태와 게시 기록을 맡는다. */
  bundles: MentionBundles;
  /** 지금 키로 Flow 연결을 만든다. 쓸 키가 없으면 `null`. */
  connectFlow: () => FlowConnection | null;
  /** 키 확인에 성공한 계정(나)의 사용자 ID. 올라갔는지 확인할 때 내 글을 가려낸다. 모르면 `null`. */
  myUserId: () => string | null;
  /** 카운트다운을 재는 시계. */
  clock: Clock;
  /** 진단 로그. 묶음 ID와 결과만 남기고 게시 본문은 남기지 않는다. */
  logger: Logger;
}

/** [게시]를 누른 뒤 게시 요청을 보내기 전까지의 한 번의 시도. */
interface Attempt {
  /** 카운트다운이 끝나는 시각(Unix epoch 밀리초). */
  endsAt: number;
  /** 단계. 카운트다운 중(`countdown`)이거나, 카운트다운이 끝나 게시를 누를 때의 확인을 기다리는 중(`waiting`)이다. 취소는 카운트다운 중에만 된다. */
  stage: 'countdown' | 'waiting';
  /** 게시를 누를 때의 확인이 끝나 그대로 게시해도 되는지 여부. */
  checked: boolean;
  /** 지금 단계의 예약(카운트다운의 끝, 확인을 기다리는 시간의 끝)을 지운다. */
  cancel: CancelScheduled;
}

/**
 * 게시. [게시]를 누르면 묶음을 게시 중으로 두고 5초 카운트다운을 시작하며, 그동안 취소할 수 있다. 확인 창은 없다.
 * 누르는 순간 게시를 누를 때의 확인(`MentionBundles.checkBeforePost`)을 시작한다. 확인이 게시를 멈추면 카운트다운도 멈춘다.
 * 카운트다운이 끝날 때 확인이 끝나지 않았으면 5초를 더 기다리고, 그래도 끝나지 않으면 그대로 게시한다.
 * 게시 요청을 보내기 직전에 게시 본문을 먼저 기록하고, 본문 묶음은 게시물의 새 댓글로, 댓글 스레드 묶음은 그 댓글의 대댓글로 올린다.
 * 성공하면 올라간 글의 ID를 기록하고 게시됨으로 둔다. 실패하면 응답에 따라 게시 실패로 두고 사유를 기록한다.
 * 올라갔는지 알 수 없으면(응답 없음, `5xx`) 그대로 다시 보내지 않고 그 자리를 다시 조회해 정한다(`checkOutcome`).
 */
export class Posting {
  /** 묶음마다 게시 요청을 보내기 전의 시도. */
  private readonly attempts = new Map<number, Attempt>();
  /** 카운트다운이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();
  /** 게시 실패가 될 때 부를 함수. */
  private readonly failureListeners = new Set<(bundleId: number) => void>();
  /** 묶음마다 기다렸다가 할 일(`429` 뒤 다시 보내기, 올라갔는지 다시 확인하기)의 예약. */
  private readonly waits = new Map<number, CancelScheduled>();
  /** 보낸 게시 요청마다 응답을 받아 결과를 기록하기까지의 일. 앱을 끌 때 응답을 기다린다. */
  private readonly pendingSends = new Set<Promise<void>>();
  /** 앱을 끝내며 멈췄는지 여부. 멈춘 뒤에는 새 카운트다운과 기다렸다가 할 일을 두지 않는다. */
  private stopped = false;

  constructor(private readonly options: PostingOptions) {
    // 게시를 누를 때의 확인이 멈춘 게시(새 멘션이 합쳐진 경우 포함)는 보내지 않고 바로 다시 누를 수 있게 시도를 지운다.
    options.bundles.onPostStopped((bundleId) => this.drop(bundleId));
  }

  /**
   * [게시]. 준비됨 묶음을 게시 중으로 두고 5초 뒤 게시 요청을 보내도록 예약하며, 게시를 누를 때의 확인을 시작한다.
   * 준비됨이 아니거나 게시할 수 없는 글(빈 편집기 텍스트, 4,000자 초과)이면 아무것도 하지 않는다.
   */
  async post(bundleId: number): Promise<void> {
    if (this.stopped || this.attempts.has(bundleId)) return;
    // 게시 중이 되었다는 묶음 변경을 받은 화면이 카운트다운도 함께 보도록, 상태를 바꾸기 전에 카운트다운을 먼저 둔다.
    /** 이번 시도. */
    const attempt: Attempt = {
      endsAt: this.options.clock.now() + POST_COUNTDOWN_MS,
      stage: 'countdown',
      checked: false,
      cancel: this.options.clock.after(POST_COUNTDOWN_MS, () => this.countdownEnded(bundleId, attempt)),
    };
    this.attempts.set(bundleId, attempt);

    if (await this.options.bundles.startPosting(bundleId)) {
      this.options.logger.info('posting.countdown-started', { bundleId });
      this.emit();
      void this.check(bundleId, attempt);
      return;
    }
    attempt.cancel();
    if (this.attempts.get(bundleId) === attempt) this.attempts.delete(bundleId);
  }

  /** 카운트다운 중인 게시를 취소한다. 묶음은 준비됨으로 돌아간다. 카운트다운이 끝났으면 아무것도 하지 않는다. */
  async cancel(bundleId: number): Promise<void> {
    /** 취소할 시도. */
    const attempt = this.attempts.get(bundleId);
    if (attempt?.stage !== 'countdown') return;
    this.drop(bundleId);
    await this.options.bundles.cancelPosting(bundleId);
  }

  /** 카운트다운이 끝나 게시 요청을 보낼 시각. 카운트다운 중이 아니면 `null`. */
  countdownEndsAt(bundleId: number): number | null {
    /** 묶음의 시도. */
    const attempt = this.attempts.get(bundleId);
    return attempt?.stage === 'countdown' ? attempt.endsAt : null;
  }

  /** 카운트다운이 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 앱을 끝낼 때 카운트다운과 기다리던 일(`429` 뒤 다시 보내기, 올라갔는지 다시 확인하기)을 모두 멈춘다. 예약된 게시 요청은 보내지 않는다.
   * 카운트다운 중이던 묶음은 게시 중으로 남고, 다시 켤 때 준비됨으로 돌아간다.
   * 게시 요청을 보내고 응답을 기다리는 중이면 응답을 받아 기록하기를 최대 5초 기다린다. 그래도 없으면 보내기 전 기록을 둔 채 끝내고,
   * 다시 켤 때 올라갔는지 확인한다.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    for (const attempt of this.attempts.values()) attempt.cancel();
    this.attempts.clear();
    for (const cancel of this.waits.values()) cancel();
    this.waits.clear();
    if (this.pendingSends.size === 0) return;

    this.options.logger.info('posting.waiting-before-quit', { count: this.pendingSends.size });
    await waitAtMost(this.options.clock, Promise.all(this.pendingSends), QUIT_RESPONSE_WAIT_MS);
  }

  /**
   * 앱을 다시 켤 때, 게시 요청의 응답을 받지 못하고 꺼진 게시(보내기 전 기록만 있고 결과가 없는 게시 중 묶음)를 확인한다.
   * 저장된 키를 읽은 뒤에 부른다. 확인이 끝날 때까지 묶음은 게시 중("게시 결과 확인 중")으로 남고,
   * 같은 글을 찾지 못하면 게시 실패("앱이 꺼져서 게시하지 못했습니다")다.
   */
  recoverAfterRestart(): void {
    for (const bundle of this.options.bundles.state()) {
      if (!isPostOutcomePending(bundle)) continue;
      this.options.logger.info('posting.check-after-restart', { bundleId: bundle.id });
      this.checkOutcome(bundle.id, 'app-quit').catch(() => this.options.logger.error('posting.crashed', { bundleId: bundle.id }));
    }
  }

  /**
   * 올라갔는지 알 수 없는 게시(보내기 전 기록만 있고 결과가 없는 게시 중 묶음)를 정한다.
   * 그 자리(본문 묶음은 게시물의 댓글, 댓글 스레드 묶음은 그 스레드의 대댓글)를 다시 조회해, 이 PC가 기록한 적 없는 내 글 가운데
   * 게시 본문과 똑같은 글을 찾는다. Flow는 보낸 문자열을 그대로 저장하므로 시각이 아니라 내용으로 찾는다.
   * 찾으면 그 ID로 게시됨, 못 찾으면 `notFoundReason` 사유로 게시 실패다. 자리가 지워졌거나 볼 수 없게 되었으면 그 사유로 게시 실패다.
   * 조회하지 못하면 게시 중으로 둔 채 잠시 뒤 다시 확인한다. 그대로 다시 보내면 중복 댓글이 남을 수 있고 REST에는 댓글 삭제가 없기 때문이다.
   * @param notFoundReason 같은 글을 못 찾았을 때의 사유. 응답이 없었으면 "Flow가 응답하지 않았습니다", 응답을 받기 전에 앱이 꺼졌으면 "앱이 꺼져서 게시하지 못했습니다"다.
   */
  async checkOutcome(bundleId: number, notFoundReason: UnconfirmedPostReason = 'no-response'): Promise<void> {
    this.cancelWait(bundleId);
    /** 확인할 묶음. */
    const bundle = this.options.bundles.get(bundleId);
    // 결과를 모르는 게시가 아니면 확인하지 않는다.
    if (!bundle || !isPostOutcomePending(bundle)) return;
    /** 보낸 게시 본문. */
    const body = bundle.posting.body;

    /** 지금 키로 만든 Flow 연결. */
    const flow = this.options.connectFlow();
    /** 키 확인에 성공한 계정의 사용자 ID. 내 글을 가려낸다. */
    const myUserId = this.options.myUserId();
    if (!flow || !myUserId) {
      this.options.logger.warn('posting.check-postponed', { bundleId, reason: 'no-key' });
      this.waitThen(bundleId, CHECK_RETRY_MS, () => this.checkOutcome(bundleId, notFoundReason));
      return;
    }
    /** 그 자리의 내 글. 조회가 예외로 끝나면 조회하지 못한 것으로 본다. */
    const lookup: MyWritingsLookup = await new MentionJudge(flow.api, myUserId)
      .myWritings(bundle, [myUserId])
      .catch(() => ({ kind: 'undecided' as const, failure: { kind: 'network' as const } }));
    switch (lookup.kind) {
      case 'found': {
        /** 이 PC가 이미 기록한 글의 ID. 다른 묶음이 같은 본문을 올렸어도 그 글로 정하지 않는다. */
        const recorded = this.options.bundles.postedIds();
        /** 게시 본문과 똑같은 내 글. 여럿이면 가장 나중 글이다. */
        const match = lookup.writings.filter((writing) => writing.contents === body && !recorded.has(writing.answerId)).at(-1);
        if (match) {
          this.options.logger.info('posting.posted-after-check', { bundleId });
          await this.options.bundles.markPosted(bundleId, match.answerId);
          return;
        }
        await this.fail(bundleId, notFoundReason);
        return;
      }
      case 'dropped':
        await this.fail(bundleId, lookup.reason === 'forbidden' ? 'forbidden' : 'gone');
        return;
      case 'undecided': {
        /** 조회하지 못한 까닭. */
        const failure = lookup.failure;
        this.options.logger.warn('posting.check-postponed', { bundleId, reason: failure.kind });
        if (failure.kind === 'unauthorized') flow.reportKeyRejected();
        this.waitThen(bundleId, checkRetryDelayMs(failure), () => this.checkOutcome(bundleId, notFoundReason));
        return;
      }
    }
  }

  /** 게시 실패가 될 때마다 `listener`를 그 묶음 ID로 부른다. 한 번의 실패에 한 번 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onFailed(listener: (bundleId: number) => void): () => void {
    this.failureListeners.add(listener);
    return () => {
      this.failureListeners.delete(listener);
    };
  }

  /**
   * 게시를 누를 때의 확인을 하고 결과에 따라 시도를 이어 간다. 멈췄으면 시도는 멈춤 알림을 받을 때 지워진다.
   * 그대로 게시해도 되면 카운트다운이 이미 끝나 기다리던 시도는 바로 게시 요청을 보낸다. 그사이 취소했거나 늦어서 결과 없이 게시했으면 아무것도 하지 않는다.
   */
  private async check(bundleId: number, attempt: Attempt): Promise<void> {
    /** 확인 결과. 확인하다 예외가 나면 조회하지 못한 것으로 본다. */
    const outcome = await this.options.bundles.checkBeforePost(bundleId).catch(() => 'unchecked' as const);
    if (this.attempts.get(bundleId) !== attempt || (outcome !== 'passed' && outcome !== 'unchecked')) return;
    attempt.checked = true;
    if (attempt.stage === 'waiting') {
      this.drop(bundleId);
      await this.sendSafely(bundleId);
    }
  }

  /** 카운트다운이 끝났다. 게시를 누를 때의 확인이 끝났으면 게시 요청을 보내고, 아니면 확인을 5초 더 기다린다. */
  private countdownEnded(bundleId: number, attempt: Attempt): void {
    if (this.attempts.get(bundleId) !== attempt) return;
    if (attempt.checked) {
      this.drop(bundleId);
      void this.sendSafely(bundleId);
      return;
    }
    attempt.stage = 'waiting';
    attempt.cancel = this.options.clock.after(POST_CHECK_GRACE_MS, () => this.checkTimedOut(bundleId, attempt));
    this.emit();
  }

  /** 카운트다운이 끝난 뒤 5초가 지나도 게시를 누를 때의 확인이 끝나지 않았다. 확인의 결과를 버리고 그대로 게시한다. */
  private checkTimedOut(bundleId: number, attempt: Attempt): void {
    if (this.attempts.get(bundleId) !== attempt) return;
    this.options.logger.warn('posting.check-timed-out', { bundleId });
    this.options.bundles.endPostCheck(bundleId);
    this.drop(bundleId);
    void this.sendSafely(bundleId);
  }

  /** 묶음의 시도를 지운다. 남은 예약도 지우고 듣는 쪽에 카운트다운이 바뀌었다고 알린다. */
  private drop(bundleId: number): void {
    /** 지울 시도. */
    const attempt = this.attempts.get(bundleId);
    if (!attempt) return;
    attempt.cancel();
    this.attempts.delete(bundleId);
    this.emit();
  }

  /**
   * 카운트다운이 끝난 묶음의 게시 요청을 보내고, 도중에 예외가 나면 로그만 남긴다.
   * 보내기 전 기록을 남긴 뒤라면 묶음은 그 기록을 둔 채 게시 중으로 남는다. 올라갔는지 알 수 없기 때문이다.
   */
  private sendSafely(bundleId: number): Promise<void> {
    /** 게시 요청을 보내고 결과를 기록하는 일. */
    const task = this.send(bundleId)
      .catch(() => {
        // 예외 문구에 게시 본문이나 Flow 글이 섞일 수 있어 로그에는 남기지 않는다.
        this.options.logger.error('posting.crashed', { bundleId });
      })
      .finally(() => this.pendingSends.delete(task));
    this.pendingSends.add(task);
    return task;
  }

  /** 카운트다운이 끝난 묶음의 게시 요청을 보낸다. 보내기 직전에 게시 본문을 먼저 기록한다. */
  private async send(bundleId: number): Promise<void> {
    if (!this.options.bundles.get(bundleId)) return;
    if (!this.options.connectFlow()) {
      await this.returnWithoutKey(bundleId);
      return;
    }
    /** 기록한 게시 본문. 그사이 취소했으면 `null`. */
    const body = await this.options.bundles.recordPostRequest(bundleId);
    if (body === null) return;
    await this.deliver(bundleId, body, false);
  }

  /**
   * 게시 요청을 보내고 응답에 따라 정한다. 본문 묶음은 `POST /user/comments/{postId}`, 댓글 스레드 묶음은 `POST /user/comments/{postId}/replies/{remarkId}`다.
   * - 성공: 올라간 글의 ID를 기록하고 게시됨이다.
   * - `401`: 묶음의 실패가 아니다. "키 확인 필요"를 올리고 준비됨으로 둔다.
   * - 응답 없음·`5xx`·모르는 응답: 올라갔는지 알 수 없어 `checkOutcome`으로 확인한다.
   * - `429`: 처리되지 않은 것이 확실하다. `Retry-After`만큼 기다렸다가 한 번 더 보내고(`retried`가 거짓일 때만), 또 오면 게시 실패다.
   * - 그 밖의 거절: 그 사유로 게시 실패다.
   */
  private async deliver(bundleId: number, body: string, retried: boolean): Promise<void> {
    /** 게시할 묶음. */
    const bundle = this.options.bundles.get(bundleId);
    if (bundle?.status !== 'posting') return;
    /** 지금 키로 만든 Flow 연결. */
    const flow = this.options.connectFlow();
    if (!flow) {
      // 429 뒤 기다리는 사이에 키가 지워졌다. 앞선 요청은 처리되지 않았으므로 준비됨으로 돌린다.
      await this.returnWithoutKey(bundleId);
      return;
    }

    /** 게시 요청의 결과. 올라간 글의 ID다. */
    const result = await this.write(flow, bundle, body);
    if (result.ok) {
      this.options.logger.info('posting.posted', { bundleId });
      await this.options.bundles.markPosted(bundleId, result.value);
      return;
    }

    /** 실패한 까닭. */
    const failure = result.failure;
    if (failure.kind === 'unauthorized') {
      this.options.logger.warn('posting.key-rejected', { bundleId });
      flow.reportKeyRejected();
      await this.options.bundles.returnToReady(bundleId);
      return;
    }
    if (isOutcomeUnknown(failure)) {
      this.options.logger.warn('posting.outcome-unknown', { bundleId, reason: failure.kind });
      await this.checkOutcome(bundleId);
      return;
    }
    if (failure.kind === 'rate-limited' && !retried) {
      /** 다시 보내기 전에 기다릴 시간. 너무 오래 기다려야 하면 `null`이다. */
      const delay = rateLimitDelayMs(failure.retryAfterMs);
      if (delay !== null) {
        this.options.logger.warn('posting.rate-limited', { bundleId, delayMs: delay });
        this.waitThen(bundleId, delay, () => this.deliver(bundleId, body, true));
        return;
      }
    }
    await this.fail(bundleId, refusalReasonOf(failure));
  }

  /** 쓸 키가 없어 보내지 못한 게시 중 묶음을 준비됨으로 돌린다. */
  private async returnWithoutKey(bundleId: number): Promise<void> {
    this.options.logger.warn('posting.no-key', { bundleId });
    await this.options.bundles.returnToReady(bundleId);
  }

  /** 게시 본문을 묶음 자리에 올린다. 요청이 예외로 끝나면 응답을 받지 못한 것으로 본다. */
  private async write(flow: FlowConnection, bundle: MentionBundle, body: string): Promise<FlowApiResult<string>> {
    try {
      return isPostBody(bundle)
        ? mapResult(await flow.api.createComment(bundle.postId, body), (created) => created.commentId)
        : mapResult(await flow.api.createReply(bundle.postId, bundle.remarkId, body), (created) => created.replyId);
    } catch {
      // 예외 문구에 게시 본문이나 Flow 글이 섞일 수 있어 로그에는 남기지 않는다.
      this.options.logger.error('posting.crashed', { bundleId: bundle.id });
      return { ok: false, failure: { kind: 'network' } };
    }
  }

  /** 게시 요청을 보낸 묶음을 게시 실패로 두고, 실패를 듣는 쪽에 한 번 알린다. */
  private async fail(bundleId: number, reason: PostFailureReason): Promise<void> {
    this.options.logger.warn('posting.failed', { bundleId, reason });
    if (!(await this.options.bundles.markPostFailed(bundleId, reason))) return;
    for (const listener of this.failureListeners) listener(bundleId);
  }

  /** `delayMs` 뒤에 묶음의 일을 한다. 같은 묶음에 기다리던 일이 있으면 지운다. 앱을 끝낼 때(`stop`) 모두 지우고, 그 뒤에는 새로 두지 않는다. */
  private waitThen(bundleId: number, delayMs: number, task: () => Promise<void>): void {
    this.cancelWait(bundleId);
    // 앱을 끝내는 중이면 기다리지 않는다. 결과가 없는 게시는 다시 켤 때 확인한다.
    if (this.stopped) return;
    this.waits.set(
      bundleId,
      this.options.clock.after(delayMs, () => {
        this.waits.delete(bundleId);
        task().catch(() => this.options.logger.error('posting.crashed', { bundleId }));
      }),
    );
  }

  /** 묶음에 기다리던 일을 지운다. */
  private cancelWait(bundleId: number): void {
    this.waits.get(bundleId)?.();
    this.waits.delete(bundleId);
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

/** 처리되지 않은 것이 확실한 실패의 사유. `403`은 권한 없음, `404`·`412`는 지워짐, 그 밖의 거절(`400`, `422` 등)은 받지 않음이다. */
function refusalReasonOf(failure: FlowApiFailure): PostFailureReason {
  if (failure.kind === 'rate-limited') return 'rate-limited';
  if (failure.kind === 'http' && failure.status === 403) return 'forbidden';
  if (failure.kind === 'http' && (failure.status === 404 || failure.status === 412)) return 'gone';
  return 'rejected';
}

/** `429`의 `Retry-After`(밀리초)를 다시 보내기 전에 기다릴 시간으로 바꾼다. 너무 오래 기다려야 하면 `null`이다. */
function rateLimitDelayMs(retryAfterMs: number | null): number | null {
  if (retryAfterMs === null) return DEFAULT_RATE_LIMIT_DELAY_MS;
  if (retryAfterMs > MAX_RATE_LIMIT_DELAY_MS) return null;
  return Math.max(MIN_RETRY_DELAY_MS, retryAfterMs);
}

/** 올라갔는지 확인하는 조회가 실패했을 때 다시 확인하기까지 기다릴 시간. 요청 한도면 `Retry-After`를, 아니면 폴링 주기를 쓴다. */
function checkRetryDelayMs(failure: FlowApiFailure): number {
  return failure.kind === 'rate-limited' ? Math.max(failure.retryAfterMs ?? CHECK_RETRY_MS, MIN_RETRY_DELAY_MS) : CHECK_RETRY_MS;
}

/** 성공한 결과의 값을 바꾼다. 실패는 그대로 둔다. */
function mapResult<T, U>(result: FlowApiResult<T>, map: (value: T) => U): FlowApiResult<U> {
  return result.ok ? { ok: true, value: map(result.value) } : result;
}
