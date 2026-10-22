import { useEffect, useState } from 'react';
import type { ReleasesPayload, ReleaseSummary } from '../lib/releases';

/** 최근 공개 Release를 받는 상태. */
export type ReleasesState = { status: 'loading' } | { status: 'ready'; releases: ReleaseSummary[] } | { status: 'failed' };

/** 페이지의 여러 섬이 함께 기다리는 `/api/releases` 요청. 한 페이지에서 한 번만 부른다. */
let pendingReleases: Promise<ReleaseSummary[]> | null = null;

/** `/api/releases`를 한 번 불러 최근 공개 Release를 받는다. */
function loadReleases(): Promise<ReleaseSummary[]> {
  pendingReleases ??= fetch('/api/releases').then(async (response) => {
    if (!response.ok) throw new Error(`/api/releases ${response.status}`);
    return ((await response.json()) as ReleasesPayload).releases;
  });
  return pendingReleases;
}

/** 최근 공개 Release. 정적 페이지라 브라우저에서 받는다. */
export function useReleases(): ReleasesState {
  /** 받는 상태. */
  const [state, setState] = useState<ReleasesState>({ status: 'loading' });

  useEffect(function fetchReleasesOnMount() {
    /** 화면을 떠난 뒤 늦게 온 응답을 버린다. */
    let active = true;
    loadReleases().then(
      (releases) => active && setState({ status: 'ready', releases }),
      () => active && setState({ status: 'failed' }),
    );
    return () => {
      active = false;
    };
  }, []);

  return state;
}
