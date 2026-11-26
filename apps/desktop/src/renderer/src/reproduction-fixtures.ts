import type { ReproductionSnapshot } from '../../shared/ipc';

/** 재현을 지원하지 않는 OS(Windows)의 재현 상태. 재현 항목과 `재현` 탭이 보이지 않는다. */
export const UNSUPPORTED_REPRODUCTION: ReproductionSnapshot = {
  supported: false,
  repos: [],
  tools: { mode: 'auto', status: 'idle', servers: [], codexListFailed: false },
};

/** 재현을 지원하는 OS(macOS)의 재현 상태. 저장소와 서버를 `overrides`로 채운다. */
export function reproductionSnapshot(overrides: Partial<Omit<ReproductionSnapshot, 'tools'>> & { tools?: Partial<ReproductionSnapshot['tools']> } = {}): ReproductionSnapshot {
  return {
    supported: true,
    repos: [],
    ...overrides,
    tools: { mode: 'auto', status: 'loaded', servers: [], codexListFailed: false, ...overrides.tools },
  };
}
