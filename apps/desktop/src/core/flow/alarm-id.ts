import type { FlowAlarm } from '../ports/flow-api';

/**
 * 알림 가운데 가장 큰(가장 최근) `alarmId`. 없으면 `null`.
 * Flow의 `alarmId`는 숫자 문자열이라 길이가 긴 쪽이 크고, 길이가 같으면 글자 순서로 비교한다.
 */
export function latestAlarmId(alarms: readonly FlowAlarm[]): string | null {
  /** 지금까지 본 가장 큰 ID. */
  let latest: string | null = null;
  for (const { alarmId } of alarms) {
    if (latest === null || alarmId.length > latest.length || (alarmId.length === latest.length && alarmId > latest)) latest = alarmId;
  }
  return latest;
}
