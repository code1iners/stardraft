import { useEffect, useState } from 'react';
import type { AppSnapshot } from '../../shared/ipc';

/** main에서 받은 앱 상태 스냅숏. 받기 전에는 `null`이다. */
export function useSnapshot(): AppSnapshot | null {
  /** 받은 스냅숏. */
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);

  useEffect(function loadSnapshot() {
    /** 창이 닫힌 뒤에 도착한 응답을 버리기 위한 표시. */
    let active = true;
    void window.stardraft.getSnapshot().then((received) => {
      if (active) setSnapshot(received);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(function followFlowAccountChanges() {
    return window.stardraft.onEvent((event) => {
      if (event.type !== 'flow-account-changed') return;
      // 스냅숏을 받기 전에 온 변경은 버린다. 곧 받을 스냅숏이 그 변경을 담고 있다.
      setSnapshot((current) => current && { ...current, flowAccount: event.flowAccount });
    });
  }, []);

  useEffect(
    function applyPlatformToDocument() {
      if (snapshot) document.documentElement.dataset.platform = snapshot.platform;
    },
    [snapshot],
  );

  return snapshot;
}
