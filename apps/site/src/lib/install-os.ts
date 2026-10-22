// 첫 화면의 다운로드 링크와 설치 안내는 서로 다른 React 섬이라, 고른 OS를 페이지 이벤트로 주고받는다.

import type { InstallerOs } from './releases';

/** 받을 OS를 골랐다는 페이지 이벤트 이름. */
const INSTALL_OS_EVENT = 'stardraft:install-os';

/** 다운로드 링크를 눌러 받을 OS를 골랐다고 알린다. 설치 안내의 OS 탭이 따라 바뀐다. */
export function announceInstallOs(os: InstallerOs, page: EventTarget = window): void {
  page.dispatchEvent(new CustomEvent<InstallerOs>(INSTALL_OS_EVENT, { detail: os }));
}

/** 받을 OS를 고를 때마다 알린다. 돌려받은 함수를 부르면 그만 듣는다. */
export function onInstallOsChosen(listener: (os: InstallerOs) => void, page: EventTarget = window): () => void {
  const handle = (event: Event) => listener((event as CustomEvent<InstallerOs>).detail);
  page.addEventListener(INSTALL_OS_EVENT, handle);
  return () => page.removeEventListener(INSTALL_OS_EVENT, handle);
}
