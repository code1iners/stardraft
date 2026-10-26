import { bundlePlaceKey } from '../bundles/mention-bundle';
import type { MentionBundles } from '../bundles/mention-bundles';
import { compareAlarmIds, latestAlarmId } from '../flow/alarm-id';
import { listMentionAlarmsAfter } from '../flow/mention-alarms';
import { MentionJudge, type MentionJudgement, type PlaceLookup } from '../flow/mention-judgement';
import { isSameFlowUser } from '../flow/user-id';
import { errorFields, type Logger } from '../logging/logger';
import type { CancelScheduled, Clock } from '../ports/clock';
import type { FlowAlarm, FlowApiFailure, FlowConnection } from '../ports/flow-api';
import type { StateStore } from '../ports/state-store';
import { mentionLocationKey, type Mention } from './mention';

/** 알림 목록을 조회하는 주기(밀리초). 설정에서 바꿀 수 없다. */
export const POLL_INTERVAL_MS = 60_000;
/** 가져오는 멘션의 범위(밀리초). 이보다 오래된 알림은 건너뛴다. 설정에서 바꿀 수 없다. */
export const LOOKBACK_MS = 72 * 60 * 60 * 1000;
/**
 * 같은 알림의 판정을 시도하는 최대 횟수. 서버 오류나 모르는 응답처럼 그 글에서만 생기는 실패가 이만큼 이어지면 버리고 넘어간다.
 * 판정은 실패한 알림에서 멈추므로, 한 글 때문에 뒤의 멘션이 72시간 동안 막히지 않게 한다.
 */
const MAX_JUDGE_ATTEMPTS = 3;
/** 요청 한도(`429`)에 걸린 뒤 다시 조회하기까지 기다리는 가장 짧은 시간(밀리초). */
const MIN_RETRY_DELAY_MS = 1_000;

/** 멘션 감지에 필요한 포트. */
export interface MentionDetectionOptions {
  /** 기준점과 계정을 두는 상태 저장소. */
  stateStore: StateStore;
  /** 감지한 멘션을 넣을 멘션 묶음. 묶음이 트레이 검토 수와 OS 알림을 올린다. */
  bundles: MentionBundles;
  /** 폴링 주기와 72시간 범위를 재는 시계. */
  clock: Clock;
  /** 진단 로그. ID와 개수만 남긴다. */
  logger: Logger;
  /** 지금 키로 Flow 연결을 만든다. 쓸 키가 없으면 `null`. */
  connectFlow: () => FlowConnection | null;
}

/** 조회 한 번이 끝난 뒤 다음 조회를 언제 할지. */
type NextPoll =
  /** 다음 주기(60초 뒤). */
  | { kind: 'interval' }
  /** 요청 한도에 걸려 `delayMs` 뒤. */
  | { kind: 'retry-after'; delayMs: number }
  /** Flow가 키를 거부해 멈춘다. */
  | { kind: 'stop' };

/** 다음 주기에 다시 조회한다. */
const NEXT_INTERVAL: NextPoll = { kind: 'interval' };

/**
 * 멘션 감지: Flow 알림 목록을 60초마다 조회해 나를 직접 지목한 업무 멘션만 골라 멘션 묶음에 넣는다.
 * 묶음 자리마다 Flow에 이미 내 답이 있는지도 조회해 함께 넘긴다. Flow의 읽음 상태는 바꾸지 않는다(조회만 한다).
 * 조회를 마칠 때마다 사용자 행동을 기다리는 묶음의 변화를 감시한다.
 */
export class MentionDetection {
  /** 감지 상태. `key-rejected`는 Flow가 키를 거부해 폴링을 멈춘 상태다. */
  private status: 'stopped' | 'running' | 'key-rejected' = 'stopped';
  /**
   * `start`를 부른 횟수. 조회하는 사이에 키를 새로 확인해 다시 시작했으면,
   * 그 조회가 옛 키로 받은 `401`로 폴링을 멈추지 않게 조회를 시작한 때의 값과 비교한다.
   */
  private generation = 0;
  /** 진행 중인 조회. */
  private inFlight: Promise<void> | null = null;
  /** 진행 중인 조회가 끝난 뒤 바로 할 조회. */
  private queued: Promise<void> | null = null;
  /** 예약한 다음 조회를 지우는 함수. */
  private cancelScheduled: CancelScheduled | null = null;
  /** 요청 한도에 걸려 이 시각(Unix epoch 밀리초) 전에는 조회하지 않는다. */
  private notBefore = 0;
  /** 그 글에서만 생기는 실패로 판정하지 못한 알림마다 이어진 실패 횟수. */
  private readonly judgeFailures = new Map<string, number>();

  constructor(private readonly options: MentionDetectionOptions) {}

  /**
   * 감지를 시작한다. 바로 조회하고 그 뒤 60초마다 조회한다. 돌려준 약속은 이번 조회가 끝나면 풀린다.
   * 앱 시작, [감지 시작], 키를 새로 확인했을 때 부른다. 키 거부로 멈췄던 폴링도 이것으로 다시 시작한다.
   */
  start(): Promise<void> {
    this.status = 'running';
    this.generation += 1;
    return this.pollNow();
  }

  /** 지금 바로 조회한다. 잠자기에서 깨어났을 때와 트레이 메뉴 "지금 확인"에서 부른다. 감지 중이 아니면 아무것도 하지 않는다. */
  checkNow(): Promise<void> {
    return this.pollNow();
  }

  /** 폴링을 멈춘다. 앱을 끝낼 때 부른다. 진행 중인 조회는 끝까지 간다. */
  stop(): void {
    this.status = 'stopped';
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  /** 지금 조회한다. 진행 중인 조회가 있으면 그것이 끝난 뒤 한 번 더 조회한다. */
  private pollNow(): Promise<void> {
    if (this.status !== 'running') return Promise.resolve();
    // 요청 한도에 걸린 동안은 앞당기지 않고 Retry-After가 지난 때로 미룬다.
    /** 한도가 풀리기까지 남은 시간. */
    const wait = this.notBefore - this.options.clock.now();
    if (wait > 0) {
      this.schedule(wait);
      return Promise.resolve();
    }
    if (this.inFlight) {
      this.queued ??= this.inFlight.then(() => {
        this.queued = null;
        return this.pollNow();
      });
      return this.queued;
    }

    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.inFlight = this.pollAndSchedule().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** 한 번 조회하고 다음 조회를 예약한다. */
  private async pollAndSchedule(): Promise<void> {
    /** 이 조회를 시작한 때의 `start` 횟수. */
    const generation = this.generation;
    /** 다음 조회. */
    let next: NextPoll;
    try {
      next = await this.poll();
    } catch (error) {
      this.options.logger.error('detection.poll-failed', errorFields(error));
      next = NEXT_INTERVAL;
    }

    if (this.status !== 'running') return;
    if (next.kind === 'stop' && generation === this.generation) {
      this.status = 'key-rejected';
      return;
    }
    if (next.kind === 'retry-after') this.notBefore = this.options.clock.now() + next.delayMs;
    // 다시 시작한 뒤라 멈추지 않은 조회는, 이어지는 새 조회가 결과를 정하므로 다음 주기로 둔다.
    this.schedule(next.kind === 'retry-after' ? next.delayMs : POLL_INTERVAL_MS);
  }

  /** `delayMs` 뒤에 조회하도록 예약한다. 앞서 예약한 조회는 지운다. */
  private schedule(delayMs: number): void {
    this.cancelScheduled?.();
    this.cancelScheduled = this.options.clock.after(delayMs, () => {
      this.cancelScheduled = null;
      void this.pollNow();
    });
  }

  /**
   * 알림 목록을 조회해 기준점 뒤의 새 멘션을 판정하고 저장한다.
   * 판정하지 못한 알림(연결 실패 등)을 만나면 거기서 멈추고, 기준점은 그 앞까지만 옮겨 다음 조회에서 다시 판정한다.
   */
  private async poll(): Promise<NextPoll> {
    /** 지금 키로 만든 Flow 연결. */
    const flow = this.options.connectFlow();
    /** 키 확인 때 저장한 계정. 내 ID를 여기서 읽는다. */
    const account = await this.options.stateStore.getAccount();
    if (!flow || !account) {
      this.options.logger.info('detection.poll-skipped', { hasFlowConnection: flow !== null, hasAccount: account !== null });
      return NEXT_INTERVAL;
    }

    /** 이미 본 가장 큰 alarmId. */
    const baseline = await this.options.stateStore.getBaselineAlarmId();
    if (baseline === null) return this.setFreshBaseline(flow);

    /** 기준점 뒤의 새 알림. 72시간보다 먼저 온 알림은 모으지 않는다. */
    const collected = await listMentionAlarmsAfter(flow.api, baseline, this.options.clock.now() - LOOKBACK_MS);
    if (!collected.ok) return this.nextAfterFailure(flow, collected.failure);
    if (collected.value.pageLimitReached) this.options.logger.warn('detection.page-limit', { alarmCount: collected.value.alarms.length });

    // 판정은 오래된 알림부터 한다. 중간에 멈춰도 그 앞까지는 모두 판정을 마친 상태가 된다.
    // 쪽을 넘기는 사이에 새 알림이 와서 같은 알림이 두 번 오거나, 같은 멘션 위치에서 알림이 여럿 와도 멘션 위치로 한 번만 판정한다.
    /** 판정할 알림. alarmId 오름차순, 같은 알림은 하나만. */
    const alarms = [...new Map(collected.value.alarms.map((alarm) => [alarm.alarmId, alarm])).values()].sort((a, b) =>
      compareAlarmIds(a.alarmId, b.alarmId),
    );
    /** 이번 조회에서 판정을 마친 멘션 위치. */
    const decided = new Set<string>();
    /** 판정을 통과한 멘션. */
    const mentions: Mention[] = [];
    /** 판정을 마친 가장 큰 alarmId. 새 기준점이 된다. */
    let decidedUpTo: string | null = null;
    /** 판정하지 못하게 한 실패. */
    let stoppedBy: FlowApiFailure | null = null;
    /** 알림의 receiverId가 키 확인 때 얻은 내 사용자 ID와 다른 알림 수. */
    let receiverMismatches = 0;
    /** 내 사용자 ID들. 키 확인 때 얻은 ID와 판정을 통과한 알림의 receiverId다. 묶음 자리에서 내 답을 찾을 때 쓴다. */
    const myIds = new Set([account.userId]);
    /** 멘션된 글을 조회해 판정한다. 같은 게시물의 댓글은 이번 조회에서 한 번만 받는다. */
    const judge = new MentionJudge(flow.api, account.userId);

    for (const alarm of alarms) {
      /** 이 알림의 멘션 위치. */
      const location = mentionLocationKey(alarm);
      if (!decided.has(location)) {
        if (alarm.receiverId && !isSameFlowUser(alarm.receiverId, account.userId)) receiverMismatches += 1;
        /** 판정 결과. */
        const judgement = await this.judgeAlarm(judge, alarm);
        if (judgement.kind === 'undecided' && !this.giveUp(alarm, judgement.failure)) {
          stoppedBy = judgement.failure;
          break;
        }
        decided.add(location);
        this.judgeFailures.delete(alarm.alarmId);
        if (judgement.kind === 'mention') {
          mentions.push(mentionOf(alarm, judgement.text, this.options.clock.now()));
          if (alarm.receiverId) myIds.add(alarm.receiverId);
        }
        else if (judgement.kind === 'dropped') this.options.logger.info('detection.alarm-dropped', { alarmId: alarm.alarmId, reason: judgement.reason });
      }
      decidedUpTo = alarm.alarmId;
    }

    // 내 ID는 알림의 receiverId로 판정한다. 키 확인 때 얻은 사용자 ID와 달라도 멘션을 잃지 않게 버리지 않고 알아챌 수 있게만 남긴다.
    if (receiverMismatches > 0) this.options.logger.warn('detection.receiver-mismatch', { alarmCount: receiverMismatches });

    if (decidedUpTo !== null) await this.save(mentions, await lookupPlaces(judge, mentions, [...myIds]), decidedUpTo, account.userId);
    this.options.logger.info('detection.poll-finished', {
      alarmCount: alarms.length,
      mentionCount: mentions.length,
      stopped: stoppedBy?.kind ?? null,
    });
    if (stoppedBy) return this.nextAfterFailure(flow, stoppedBy);
    await this.watchBundles();
    return NEXT_INTERVAL;
  }

  /**
   * 준비된 뒤의 변화 감시를 한다. 알림 조회를 마친 뒤 사용자 행동을 기다리는 묶음의 Flow 내용을 다시 조회한다.
   * 알림을 끝까지 판정하지 못한 조회(키 거부, 연결 실패, 요청 한도)에서는 부르지 않는다. 감시가 실패해도 폴링은 이어 간다.
   */
  private async watchBundles(): Promise<void> {
    try {
      await this.options.bundles.watchWaiting();
    } catch (error) {
      this.options.logger.error('detection.watch-failed', errorFields(error));
    }
  }

  /**
   * 기준점이 없다(다른 계정의 키로 바꿔 기록을 비움). 첫 실행처럼 가장 최근 알림의 alarmId를 기준점으로 잡고,
   * 과거 멘션은 가져오지 않는다. 기록을 비웠으므로 트레이 검토 수도 다시 센다.
   */
  private async setFreshBaseline(flow: FlowConnection): Promise<NextPoll> {
    /** 가장 최근 쪽의 알림 목록. */
    const page = await flow.api.listMentionAlarms(null);
    if (!page.ok) return this.nextAfterFailure(flow, page.failure);

    await this.options.stateStore.setBaselineAlarmId(latestAlarmId(page.value.alarms) ?? '0');
    this.options.logger.info('detection.baseline-set', { alarmCount: page.value.alarms.length });
    return NEXT_INTERVAL;
  }

  /** 판정을 통과한 멘션을 묶음에 넣고 기준점을 옮긴다. 묶음이 트레이 검토 수를 바꾸고 OS 알림을 띄운다. */
  private async save(mentions: Mention[], lookups: ReadonlyMap<string, PlaceLookup>, baseline: string, userId: string): Promise<void> {
    // 조회하는 사이에 다른 계정의 키로 바뀌어 기록을 비웠으면, 옛 계정의 결과를 남기지 않는다.
    /** 지금 계정. */
    const current = await this.options.stateStore.getAccount();
    if (!current || !isSameFlowUser(current.userId, userId)) {
      this.options.logger.info('detection.account-changed-during-poll');
      return;
    }

    await this.options.bundles.addDetected(mentions, lookups, baseline);
  }

  /** 알림 하나를 판정한다. 이미 기록한 멘션 위치에서 다시 온 알림은 글을 조회하지 않고 버린다(최소 기록 입구). */
  private async judgeAlarm(judge: MentionJudge, alarm: FlowAlarm): Promise<MentionJudgement | { kind: 'dropped'; reason: 'already-recorded' }> {
    if (await this.options.stateStore.hasMentionLocation(alarm)) return { kind: 'dropped', reason: 'already-recorded' };
    return judge.judge(alarm);
  }

  /**
   * 판정하지 못한 알림을 버리고 넘어갈지 정한다. 서버 오류나 모르는 응답처럼 그 글에서만 생기는 실패가
   * `MAX_JUDGE_ATTEMPTS`번 이어지면 버린다. 키 거부, 연결 실패, 요청 한도는 모든 글에 같으므로 버리지 않고 기다린다.
   */
  private giveUp(alarm: FlowAlarm, failure: FlowApiFailure): boolean {
    if (failure.kind !== 'http' && failure.kind !== 'unexpected-response') return false;
    /** 이번까지 이어진 실패 횟수. */
    const attempts = (this.judgeFailures.get(alarm.alarmId) ?? 0) + 1;
    if (attempts < MAX_JUDGE_ATTEMPTS) {
      this.judgeFailures.set(alarm.alarmId, attempts);
      return false;
    }
    this.options.logger.warn('detection.alarm-given-up', {
      alarmId: alarm.alarmId,
      failure: failure.kind,
      status: failure.kind === 'http' ? failure.status : null,
      attempts,
    });
    return true;
  }

  /** 조회가 실패한 뒤 다음 조회를 정한다. */
  private nextAfterFailure(flow: FlowConnection, failure: FlowApiFailure): NextPoll {
    this.options.logger.warn('detection.flow-failed', {
      failure: failure.kind,
      status: failure.kind === 'http' ? failure.status : null,
    });
    switch (failure.kind) {
      case 'unauthorized':
        // 폴링을 멈추고 "키 확인 필요"를 띄운다. 키를 다시 확인하면 start()로 다시 시작한다.
        flow.reportKeyRejected();
        return { kind: 'stop' };
      case 'rate-limited':
        return { kind: 'retry-after', delayMs: Math.max(MIN_RETRY_DELAY_MS, failure.retryAfterMs ?? POLL_INTERVAL_MS) };
      default:
        return NEXT_INTERVAL;
    }
  }

}

/**
 * 멘션이 든 묶음 자리마다 게시물 제목·주소와 내 답을 조회한다. 판정이 받은 글을 다시 쓴다.
 * 조회하지 못한 자리는 내 답이 없는 것으로 넘기지 않고 모른다고(`null`) 넘긴다. 묶음은 그때 아는 답으로만 판정한다.
 */
async function lookupPlaces(judge: MentionJudge, mentions: readonly Mention[], myIds: readonly string[]): Promise<Map<string, PlaceLookup>> {
  /** 자리마다 조회한 결과. */
  const lookups = new Map<string, PlaceLookup>();
  for (const mention of mentions) {
    /** 묶음 자리. */
    const place = bundlePlaceKey(mention);
    if (!lookups.has(place)) lookups.set(place, await judge.lookupPlace(mention, myIds));
  }
  return lookups;
}

/** 판정을 통과한 알림과 멘션된 글의 내용으로 저장할 멘션을 만든다. */
function mentionOf(alarm: FlowAlarm, text: string, detectedAt: number): Mention {
  return {
    postId: alarm.postId,
    remarkId: alarm.remarkId,
    replyId: alarm.replyId,
    projectId: alarm.projectId,
    alarmId: alarm.alarmId,
    senderId: alarm.registerId,
    senderName: alarm.registerName,
    registeredDateTime: alarm.registeredDateTime,
    detectedAt,
    text,
  };
}
