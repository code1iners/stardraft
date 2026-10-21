import type { ExecutorFailureReason } from '../ports/executor';

/**
 * 전역 실패를 의심할 실행 실패. CLI를 띄우지 못했거나, 로그인되어 있지 않거나, 결과 메시지 없이 끝난(지원하지 않는 플래그 등) 실행이다.
 * 이런 실패로 끝나면 연결 확인을 처음부터 다시 돌려 전역 실패인지 가린다. 과부하·네트워크 같은 일시적 실패는 넣지 않는다.
 */
const SUSPECTED_GLOBAL_FAILURES: ReadonlySet<string> = new Set<ExecutorFailureReason>(['cli-missing', 'cli-error', 'not-logged-in']);

/** 실행이 끝난 실패 사유가 전역 실패를 의심할 실패인지 본다. */
export function suspectsGlobalFailure(reason: string): boolean {
  return SUSPECTED_GLOBAL_FAILURES.has(reason);
}
