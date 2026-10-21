import { useEffect, useState } from 'react';
import type { BundleSnapshot } from '../../shared/ipc';

/** 무시 토스트를 보이는 시간(밀리초). */
const TOAST_MS = 5_000;

/** 창에서 고른 묶음. */
interface Selection {
  /** 고른 묶음 ID. 고르지 않았으면 `null`이고 대기열 첫 묶음을 보인다. */
  id: number | null;
  /** 막 떠난 묶음 ID. 처리됐다는 상태가 오기 전에 그 묶음을 다시 고르지 않는다. */
  skip: number | null;
}

/** 창에서 고른 묶음과 대기열. */
export interface BundleSelection {
  /** 작은 창 대기열. 처리되지 않은 묶음이고 순서는 main이 정한다. */
  queue: BundleSnapshot[];
  /** 보이는 묶음. 고른 묶음이 없거나 사라졌으면 대기열 첫 묶음이다. 보일 묶음이 없으면 `null`. */
  selected: BundleSnapshot | null;
  /** 묶음을 고른다. */
  select: (bundleId: number) => void;
  /** 무시한 묶음을 떠나 대기열의 다음 묶음으로 넘어간다. 다음이 없으면 앞 묶음, 그것도 없으면 빈 화면이다. */
  leave: (bundleId: number) => void;
}

/**
 * 창에서 고른 묶음. 묶음 상태는 main의 스냅숏에서 읽고, 무엇을 보고 있는지만 창이 기억한다.
 * 창을 열 때 주소에 실린 묶음을 먼저 고르고, OS 알림을 눌러 main이 묶음을 보내면 그 묶음으로 바꾼다.
 */
export function useBundleSelection(bundles: readonly BundleSnapshot[], initialBundleId: number | null): BundleSelection {
  /** 고른 묶음. */
  const [selection, setSelection] = useState<Selection>({ id: initialBundleId, skip: null });

  useEffect(function followRequestedBundle() {
    return window.stardraft.onEvent((event) => {
      if (event.type === 'review-bundle-requested') setSelection({ id: event.bundleId, skip: null });
    });
  }, []);

  /** 작은 창 대기열. */
  const queue = bundles.filter((bundle) => bundle.group !== 'processed');
  /** 보이는 묶음. */
  const selected = bundles.find((bundle) => bundle.id === selection.id) ?? queue.find((bundle) => bundle.id !== selection.skip) ?? null;

  return {
    queue,
    selected,
    select: (bundleId) => setSelection({ id: bundleId, skip: null }),
    leave: (bundleId) => {
      /** 떠나는 묶음의 대기열 위치. */
      const index = queue.findIndex((bundle) => bundle.id === bundleId);
      /** 넘어갈 묶음. */
      const next = index >= 0 ? (queue[index + 1] ?? queue[index - 1]) : undefined;
      setSelection({ id: next?.id ?? null, skip: bundleId });
    },
  };
}

/** 무시 토스트. 되돌리기로 살릴 묶음과 문구다. */
export interface IgnoreToastState {
  /** 무시한 묶음 ID. */
  bundleId: number;
  /** 토스트 문구. */
  text: string;
}

/** 무시 토스트. 띄운 뒤 5초가 지나면 저절로 사라진다. */
export function useIgnoreToast(): [IgnoreToastState | null, (toast: IgnoreToastState | null) => void] {
  /** 보이는 토스트. */
  const [toast, setToast] = useState<IgnoreToastState | null>(null);

  useEffect(
    function hideToastLater() {
      if (!toast) return;
      /** 토스트를 지우는 예약. */
      const timer = setTimeout(() => setToast(null), TOAST_MS);
      return () => clearTimeout(timer);
    },
    [toast],
  );

  return [toast, setToast];
}
