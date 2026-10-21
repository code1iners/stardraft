import { useEffect, useState } from 'react';
import type { BundleSnapshot } from '../../shared/ipc';
import { ignoredText } from './review-text';

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

/** 묶음에 하는 행동과 무시 토스트. */
export interface BundleActions {
  /** 보이는 무시 토스트. 없으면 `null`. */
  toast: IgnoreToastState | null;
  /** 묶음을 무시하고 다음 묶음으로 넘어가며, 되돌릴 수 있는 토스트를 띄운다. */
  ignore: (bundle: BundleSnapshot) => void;
  /** 처리됨 묶음을 되돌리고 그 묶음을 보인다. */
  restore: (bundleId: number) => void;
  /** 생성 중 묶음의 초안 실행을 취소한다. 묶음은 "취소함" 실패가 되어 그대로 보인다. */
  cancel: (bundleId: number) => void;
  /** 실패 묶음을 다시 시도한다. 묶음은 생성 중이 되어 그대로 보인다. */
  retry: (bundleId: number) => void;
}

/**
 * 작은 창과 펼친 창이 같이 쓰는 [무시]·[되돌리기]·[취소]·[다시 시도]. 묶음 상태는 main이 바꾸고, 창은 보이는 묶음과 토스트만 바꾼다.
 * 취소와 다시 시도는 묶음이 대기열에 남으므로 보고 있는 묶음을 바꾸지 않는다.
 */
export function useBundleActions({ select, leave }: Pick<BundleSelection, 'select' | 'leave'>): BundleActions {
  /** 무시 토스트. */
  const [toast, setToast] = useIgnoreToast();

  return {
    toast,
    ignore: (bundle) => {
      leave(bundle.id);
      setToast({ bundleId: bundle.id, text: ignoredText(bundle) });
      void window.stardraft.send({ type: 'ignore-bundle', bundleId: bundle.id });
    },
    restore: (bundleId) => {
      setToast(null);
      select(bundleId);
      void window.stardraft.send({ type: 'restore-bundle', bundleId });
    },
    cancel: (bundleId) => {
      void window.stardraft.send({ type: 'cancel-generation', bundleId });
    },
    retry: (bundleId) => {
      void window.stardraft.send({ type: 'retry-bundle', bundleId });
    },
  };
}

/** 무시 토스트. 띄운 뒤 5초가 지나면 저절로 사라진다. */
function useIgnoreToast(): [IgnoreToastState | null, (toast: IgnoreToastState | null) => void] {
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
