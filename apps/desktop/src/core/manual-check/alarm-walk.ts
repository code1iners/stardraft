import { compareAlarmIds } from '../flow/alarm-id';
import { flowTimeToEpochMs } from '../flow/flow-time';
import type { FlowAlarm, FlowAlarmPage, FlowApiFailure, FlowApiResult } from '../ports/flow-api';

/** 최근 멘션 확인 목록을 한 번에 불러오는 개수. 설정에서 바꿀 수 없다. */
export const MANUAL_CHECK_PAGE_SIZE = 10;

/** 한 번 불러올 때 넘기는 알림 목록의 최대 쪽 수. 후보가 되지 않는 알림만 이어져도 여기서 멈추고 이어 불러오기로 넘긴다. */
const MAX_ALARM_PAGES = 10;

/** 이어 불러오기가 시작할 자리. */
export interface AlarmWalkCursor {
  /** 다시 받을 알림 쪽의 커서. 첫 쪽이면 `null`. */
  pageCursor: string | null;
  /** 이 알림까지는 앞서 판정했다. 그 쪽을 처음부터 볼 것이면 `null`. */
  afterAlarmId: string | null;
  /** 앞서 판정한 자리의 키. 같은 자리의 더 오래된 알림을 다시 판정하지 않는다. */
  decidedKeys: string[];
}

/** 알림 하나를 판정한 결과. 후보, 후보 아님, 실패다. */
export type AlarmVerdict<T> = { kind: 'found'; value: T } | { kind: 'skip' } | { kind: 'failed'; failure: FlowApiFailure };

/**
 * 최신 알림부터(`from`이 있으면 그 자리부터) 쪽을 넘기며 `judge`가 후보로 본 것을 `MANUAL_CHECK_PAGE_SIZE`건까지 모은다.
 * 알림 쪽은 최신이 앞이므로 같은 키의 알림은 가장 최근 것 하나만 판정한다. `keyOf`가 `null`인 알림은 판정하지 않고 건너뛴다.
 * 쪽 커서는 Flow가 준 값이라, 그사이 새 알림이 앞에 더 와 쪽이 밀려도 `afterAlarmId`보다 오래된 알림만 보아 같은 알림을 다시 판정하지 않는다.
 * 그 글에서만 생기는 실패(서버 오류, 모르는 응답)는 그 알림만 건너뛰고, 모든 글에 같은 실패(키 거부, 연결 실패, 요청 한도)면 그 실패를 돌려준다.
 */
export async function collectFromAlarms<T>(
  listPage: (cursor: string | null) => Promise<FlowApiResult<FlowAlarmPage>>,
  from: AlarmWalkCursor | null,
  keyOf: (alarm: FlowAlarm) => string | null,
  judge: (alarm: FlowAlarm) => Promise<AlarmVerdict<T>>,
): Promise<FlowApiResult<{ found: T[]; next: AlarmWalkCursor | null }>> {
  /** 모은 후보. 최신이 앞이다. */
  const found: T[] = [];
  /** 이미 판정한 자리. 앞선 불러오기에서 판정한 자리도 넣는다. */
  const decided = new Set(from?.decidedKeys ?? []);
  /** 이어 불러올 자리. */
  let next: AlarmWalkCursor | null = null;
  /** `pageCursor` 쪽을 다시 받아 `afterAlarmId` 뒤부터 이어 갈 자리. 지금까지 판정한 자리를 함께 넘긴다. */
  const cursorAt = (pageCursor: string | null, afterAlarmId: string | null): AlarmWalkCursor => ({
    pageCursor,
    afterAlarmId,
    decidedKeys: [...decided],
  });

  // 쪽을 받을 때마다 판정해야 10건을 모은 뒤 더 오래된 쪽을 받지 않는다. walkPages는 쪽마다 바로 답해야 하므로 직접 넘긴다.
  /** 받을 쪽의 커서. */
  let cursor = from?.pageCursor ?? null;
  /** 이 알림까지는 앞서 판정했다. 첫 쪽에만 쓴다. */
  let after = from?.afterAlarmId ?? null;
  for (let page = 0; ; page += 1) {
    if (page === MAX_ALARM_PAGES) {
      next = cursorAt(cursor, null);
      break;
    }
    /** 이번 쪽. */
    const result = await listPage(cursor);
    if (!result.ok) return result;
    /** 이번 쪽에서 아직 판정하지 않은 알림. 최신이 앞이다. */
    const alarms = after === null ? result.value.alarms : result.value.alarms.filter((alarm) => compareAlarmIds(alarm.alarmId, after!) < 0);
    after = null;
    /** 이번 쪽에서 판정한 알림 수. */
    let judged = 0;
    for (const alarm of alarms) {
      if (found.length >= MANUAL_CHECK_PAGE_SIZE) break;
      judged += 1;
      /** 판정할 자리. */
      const key = keyOf(alarm);
      if (key === null || decided.has(key)) continue;
      decided.add(key);
      /** 판정 결과. */
      const verdict = await judge(alarm);
      if (verdict.kind === 'found') found.push(verdict.value);
      else if (verdict.kind === 'failed' && isSharedFailure(verdict.failure)) return { ok: false, failure: verdict.failure };
    }
    /** 다음 쪽 커서. 같은 커서를 다시 주면 끝으로 본다. */
    const nextCursor: string | null = result.value.nextCursor === cursor ? null : result.value.nextCursor;
    if (judged < alarms.length) {
      // 10건을 채워 이 쪽의 남은 알림을 판정하지 않았다. 다음에는 이 쪽을 다시 받아 마지막으로 판정한 알림 뒤부터 본다.
      next = cursorAt(cursor, alarms[judged - 1]!.alarmId);
      break;
    }
    if (nextCursor === null) break;
    cursor = nextCursor;
    if (found.length >= MANUAL_CHECK_PAGE_SIZE) {
      next = cursorAt(cursor, null);
      break;
    }
  }
  return { ok: true, value: { found, next } };
}

/** 모든 글에 같아 다음 알림을 판정해도 같을 실패인지 본다. 키 거부, 연결 실패, 요청 한도다. */
function isSharedFailure(failure: FlowApiFailure): boolean {
  return failure.kind === 'unauthorized' || failure.kind === 'network' || failure.kind === 'rate-limited';
}

/** 멘션 시각보다 나중에 쓴 답이 있는지 본다. 시각은 Flow 시각끼리 비교하고, 읽을 수 없으면 답하지 않은 것으로 본다. */
export function answeredAfter(mentionTime: string, answers: readonly { registeredDateTime: string }[]): boolean {
  /** 멘션 시각. */
  const at = flowTimeToEpochMs(mentionTime);
  if (at === null) return false;
  return answers.some((answer) => {
    /** 답을 쓴 시각. */
    const answeredAt = flowTimeToEpochMs(answer.registeredDateTime);
    return answeredAt !== null && answeredAt > at;
  });
}
