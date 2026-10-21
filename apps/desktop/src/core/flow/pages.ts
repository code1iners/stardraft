import type { FlowApiFailure, FlowApiResult } from '../ports/flow-api';

/** 커서로 나뉜 목록을 넘기는 최대 쪽 수. 서버가 다음 쪽이 있다고 계속 답해도 여기서 멈춘다. */
const MAX_PAGES = 50;

/** 쪽 넘기기를 마친 결과. */
export type PageWalk =
  /** 끝까지 넘겼거나 받는 쪽이 멈췄다. `pageLimitReached`면 쪽 수 상한에서 멈췄다. */
  | { ok: true; pageLimitReached: boolean }
  /** 어느 쪽을 받지 못했다. */
  | { ok: false; failure: FlowApiFailure };

/**
 * 커서로 나뉜 목록을 첫 쪽부터 차례로 받아 `onPage`에 넘긴다. `onPage`가 `false`를 돌려주면 멈춘다.
 * 마지막 쪽(다음 커서 없음), 같은 커서가 다시 온 때, 쪽 수 상한에서도 멈춘다. 받지 못한 쪽이 있으면 그 실패를 돌려준다.
 */
export async function walkPages<P extends { nextCursor: string | null }>(
  fetchPage: (cursor: string | null) => Promise<FlowApiResult<P>>,
  onPage: (page: P) => boolean,
): Promise<PageWalk> {
  /** 다음 쪽 커서. 첫 쪽은 `null`. */
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    /** 이번 쪽. */
    const result = await fetchPage(cursor);
    if (!result.ok) return result;
    if (!onPage(result.value)) return { ok: true, pageLimitReached: false };

    /** 다음 쪽 커서. */
    const next = result.value.nextCursor;
    if (next === null || next === cursor) return { ok: true, pageLimitReached: false };
    cursor = next;
  }
  return { ok: true, pageLimitReached: true };
}
