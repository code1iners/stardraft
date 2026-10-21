import type { FlowAlarm } from '../ports/flow-api';

/**
 * 두 `alarmId`를 크기로 비교한다. `a`가 작으면 음수, 같으면 0, 크면 양수다.
 * Flow의 `alarmId`는 숫자 문자열이라 길이가 긴 쪽이 크고, 길이가 같으면 글자 순서로 비교한다.
 */
export function compareAlarmIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** 알림 가운데 가장 큰(가장 최근) `alarmId`. 없으면 `null`. */
export function latestAlarmId(alarms: readonly FlowAlarm[]): string | null {
  /** 지금까지 본 가장 큰 ID. */
  let latest: string | null = null;
  for (const { alarmId } of alarms) {
    if (latest === null || compareAlarmIds(alarmId, latest) > 0) latest = alarmId;
  }
  return latest;
}
