/** Flow 시각의 UTC 차이(밀리초). 한국 표준시(UTC+9)이고 일광 절약 시간이 없다. */
const FLOW_UTC_OFFSET_MS = 9 * 60 * 60 * 1000;
/** Flow 시각 형식(`yyyyMMddHHmmss`). */
const FLOW_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;

/**
 * Flow 시각(`yyyyMMddHHmmss`)을 Unix epoch 밀리초로 바꾼다. 읽을 수 없으면 `null`.
 * Flow는 시간대를 붙이지 않는다. 실호출에서 방금 온 알림의 시각이 조회 시각(UTC)보다 9시간 앞서 있어 한국 표준시로 읽는다.
 */
export function flowTimeToEpochMs(value: string): number | null {
  /** 형식에 맞춰 읽은 결과. 형식이 다르면 `null`. */
  const match = FLOW_TIME.exec(value);
  if (!match) return null;
  /** 연, 월(1부터), 일, 시, 분, 초. */
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number) as [number, number, number, number, number, number];

  /** 그 시각을 UTC로 읽은 값. */
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // 13월이나 32일처럼 넘친 값은 Date가 다음 달로 넘기므로, 되돌려 보아 같은지로 거른다.
  /** 되돌려 본 시각. */
  const check = new Date(asUtc);
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || check.getUTCHours() !== hour || check.getUTCMinutes() !== minute) {
    return null;
  }
  return asUtc - FLOW_UTC_OFFSET_MS;
}
