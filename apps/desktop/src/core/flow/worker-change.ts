/** 담당 변경 시스템 기록의 종류. */
export const WORKER_CHANGE_CODE = 'S41';

/**
 * 담당 변경 시스템 기록의 이전·이후 담당자 표시 이름. 실응답에서 관측한 두 형식만 읽는다. 이름은 사용자 ID가 아니므로 쓰는 쪽이 ID와 교차 확인한다.
 * `S41^^'이전들'^^'이후들'`와 최초 지정의 `S41^^'이후들'@$%`다. 다른 형식은 `null`이다.
 */
export function parseWorkerChange(systemCode: string): { before: string[]; after: string[] } | null {
  /** `^^`로 나눈 조각. */
  const parts = systemCode.split('^^');
  if (parts[0] !== WORKER_CHANGE_CODE) return null;
  if (parts.length === 3) {
    /** 이전과 이후 이름. */
    const [before, after] = [quotedNames(parts[1]!), quotedNames(parts[2]!)];
    return before && after ? { before, after } : null;
  }
  if (parts.length === 2 && parts[1]!.endsWith('@$%')) {
    /** 최초 지정의 이름. */
    const after = quotedNames(parts[1]!.slice(0, -'@$%'.length));
    return after ? { before: [], after } : null;
  }
  return null;
}

/** `'이름', '이름'` 목록. 따옴표나 구분이 맞지 않으면 `null`이다. */
function quotedNames(list: string): string[] | null {
  if (!/^'[^']+'(\s*,\s*'[^']+')*$/.test(list.trim())) return null;
  return [...list.matchAll(/'([^']+)'/g)].map((match) => match[1]!.trim());
}
