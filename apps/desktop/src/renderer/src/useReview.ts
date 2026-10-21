import { useEffect, useState } from 'react';
import type { BundleSnapshot } from '../../shared/ipc';
import { ignoredText } from './review-text';

/** 무시 토스트를 보이는 시간(밀리초). */
const TOAST_MS = 5_000;

/** 카운트다운의 남은 초를 다시 셀 간격(밀리초). 초가 바뀌는 때를 크게 놓치지 않을 만큼 짧다. */
const COUNTDOWN_TICK_MS = 250;

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
  /** 게시하거나 무시한 묶음을 떠나 다음 준비된 묶음으로 넘어간다. 넘어갈 묶음은 `nextBundleAfter`가 고르고, 없으면 빈 화면이다. */
  leave: (bundleId: number) => void;
}

/** 게시하거나 무시한 뒤 넘어가도 검토할 것이 있는 상태. 준비됨과 저장소 확인 필요다. */
const REVIEWABLE: readonly BundleSnapshot['status'][] = ['ready', 'repo-check-needed'];

/**
 * 게시하거나 무시한 묶음을 떠날 때 넘어갈 묶음. 대기열에서 떠나는 묶음 뒤의 첫 준비된 묶음(준비됨, 저장소 확인 필요)이고, 뒤에 없으면 앞에서 찾는다.
 * 준비된 묶음이 없으면 바로 뒤, 그것도 없으면 바로 앞 묶음이다. 넘어갈 묶음이 없으면 `null`.
 */
export function nextBundleAfter(queue: readonly BundleSnapshot[], bundleId: number): BundleSnapshot | null {
  /** 떠나는 묶음의 대기열 위치. */
  const index = queue.findIndex((bundle) => bundle.id === bundleId);
  /** 떠나는 묶음 뒤와 앞의 묶음. 뒤가 먼저다. */
  const others = index >= 0 ? [...queue.slice(index + 1), ...queue.slice(0, index)] : queue.filter((bundle) => bundle.id !== bundleId);
  /** 바로 뒤나 바로 앞 묶음. */
  const adjacent = index >= 0 ? (queue[index + 1] ?? queue[index - 1]) : others[0];
  return others.find((bundle) => REVIEWABLE.includes(bundle.status)) ?? adjacent ?? null;
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
      setSelection({ id: nextBundleAfter(queue, bundleId)?.id ?? null, skip: bundleId });
    },
  };
}

/** 게시 실패 토스트 하나. 같은 묶음이 거듭 실패하면 토스트도 따로 뜬다. */
export interface FailedToastState {
  /** 토스트를 가려내는 번호. */
  key: number;
  /** 게시하지 못한 묶음 ID. */
  bundleId: number;
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
  /** 보이는 게시 실패 토스트. 띄운 순서다. */
  failedToasts: FailedToastState[];
  /** 묶음을 무시하고 다음 묶음으로 넘어가며, 되돌릴 수 있는 토스트를 띄운다. */
  ignore: (bundle: BundleSnapshot) => void;
  /** 처리됨 묶음을 되돌리고 그 묶음을 보인다. */
  restore: (bundleId: number) => void;
  /** 생성 중 묶음의 초안 실행을 취소한다. 묶음은 "취소함" 실패가 되어 그대로 보인다. */
  cancel: (bundleId: number) => void;
  /** 실패 묶음을 다시 시도한다. 묶음은 생성 중이 되어 그대로 보인다. */
  retry: (bundleId: number) => void;
  /** [게시]·[다시 게시]. 5초 카운트다운을 시작하고 다음 준비된 묶음으로 넘어간다. 카운트다운은 게시 토스트에 보인다. */
  post: (bundle: BundleSnapshot) => void;
  /** 카운트다운 중인 게시를 취소하고 그 묶음을 보인다. */
  cancelPost: (bundleId: number) => void;
}

/**
 * 작은 창과 펼친 창이 같이 쓰는 [무시]·[되돌리기]·[취소]·[다시 시도]·[게시]. 묶음 상태는 main이 바꾸고, 창은 보이는 묶음과 토스트만 바꾼다.
 * 생성 취소와 다시 시도는 묶음이 대기열에 남으므로 보고 있는 묶음을 바꾸지 않는다. 게시하거나 무시하면 다음 준비된 묶음으로 넘어간다.
 */
export function useBundleActions({ select, leave }: Pick<BundleSelection, 'select' | 'leave'>): BundleActions {
  /** 무시 토스트. */
  const [toast, setToast] = useIgnoreToast();
  /** 게시 실패 토스트. */
  const failedToasts = useFailedToasts();

  return {
    toast,
    failedToasts,
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
    post: (bundle) => {
      leave(bundle.id);
      void window.stardraft.send({ type: 'post-bundle', bundleId: bundle.id });
    },
    cancelPost: (bundleId) => {
      select(bundleId);
      void window.stardraft.send({ type: 'cancel-posting', bundleId });
    },
  };
}

/** 카운트다운이 `endsAt`(Unix epoch 밀리초)까지 남은 초. 올림해서 세고 0 아래로 내려가지 않는다. 카운트다운 중이 아니면(`null`) `null`이다. */
export function useSecondsLeft(endsAt: number | null): number | null {
  /** 지금 시각. 카운트다운 동안 주기적으로 다시 읽는다. */
  const [now, setNow] = useState(() => Date.now());

  useEffect(
    function tickCountdown() {
      if (endsAt === null) return;
      /** 지금 시각을 다시 읽는 예약. */
      const timer = setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
      return () => clearInterval(timer);
    },
    [endsAt],
  );

  return endsAt === null ? null : Math.max(0, Math.ceil((endsAt - now) / 1_000));
}

/**
 * 게시 실패 토스트. main이 게시 실패를 알릴 때마다 하나씩 띄우고, 띄운 뒤 5초가 지나면 저절로 사라진다.
 * 묶음 상태가 아니라 알림을 따르므로 실패한 순간에 한 번만 뜨고, 창을 다시 열어도 다시 뜨지 않는다.
 */
function useFailedToasts(): FailedToastState[] {
  /** 보이는 토스트. */
  const [toasts, setToasts] = useState<FailedToastState[]>([]);

  useEffect(function showPostFailures() {
    /** 다음 토스트 번호. */
    let nextKey = 1;
    /** 토스트마다 지우는 예약. */
    const timers = new Set<ReturnType<typeof setTimeout>>();
    /** 알림 구독을 푼다. */
    const unsubscribe = window.stardraft.onEvent((event) => {
      if (event.type !== 'post-failed') return;
      /** 띄울 토스트. */
      const toast = { key: nextKey++, bundleId: event.bundleId };
      setToasts((current) => [...current, toast]);
      /** 토스트를 지우는 예약. */
      const timer = setTimeout(() => {
        timers.delete(timer);
        setToasts((current) => current.filter((item) => item.key !== toast.key));
      }, TOAST_MS);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);

  return toasts;
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
