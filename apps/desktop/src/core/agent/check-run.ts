/**
 * 점검 실행(화면 이름 "작동 확인")의 고정 입력. 실제 실행과 같은 플래그 묶음으로 최소 스키마 결과를 받아,
 * 로그인과 실행 계약이 이 PC의 CLI에서 실제로 도는지 확인한다. 저장소는 읽지 않는다.
 */

/** 점검 실행의 출력 스키마. Codex의 `--output-schema`에도 맞게 모든 속성을 `required`로 둔다. */
export const CHECK_RUN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
};

/** 점검 실행의 지침. 파일을 읽지 않고 바로 끝내게 해 사용량을 줄인다. */
export const CHECK_RUN_INSTRUCTIONS = 'Stardraft 작동 확인입니다. 파일을 읽거나 검색하지 말고, 구조화 출력의 ok에 true를 넣어 바로 끝내세요.';

/** 점검 실행의 표준 입력. */
export const CHECK_RUN_INPUT = '작동 확인: ok에 true를 넣어 답하세요.';

/** 점검 실행의 제한 시간(밀리초). 보통 10초쯤 걸린다. */
export const CHECK_RUN_TIMEOUT_MS = 60_000;

/** 점검 실행 결과가 성공인지 본다. */
export function isCheckRunPassed(output: unknown): boolean {
  return typeof output === 'object' && output !== null && (output as Record<string, unknown>).ok === true;
}
