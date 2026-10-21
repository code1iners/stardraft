import type { ExecutorFailureReason, ExecutorOutcome } from '../ports/executor';

/**
 * 실행기들이 CLI 출력을 읽을 때 같이 쓰는 도우미. 이벤트 줄을 JSON 객체로 풀고, 실패 결과를 만든다.
 */

/** 오류 원문의 최대 길이. 넘으면 앞부분만 남긴다. */
const DETAIL_MAX_LENGTH = 2_000;

/** 실패 결과를 만든다. 오류 원문은 길이 상한까지만 남긴다. */
export function failedOutcome(reason: ExecutorFailureReason, detail: string): ExecutorOutcome {
  return { type: 'failed', reason, detail: detail.slice(0, DETAIL_MAX_LENGTH) };
}

/** 배열이 아닌 객체면 필드를 읽을 수 있게, 아니면 `null`. */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** JSON 객체 한 줄을 푼다. 객체가 아니면 `null`. */
export function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

/** 유한한 숫자면 그 값, 아니면 `null`. */
export function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
