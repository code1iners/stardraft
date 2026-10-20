import { app, Menu, type Tray } from 'electron';
import { applyAppIdentity } from './app-identity';
import { AppWindows } from './app-windows';
import { registerIpc } from './ipc';
import { hardenRenderers } from './security';
import { createTray } from './tray';

/** 트레이 아이콘. 변수로 붙잡아 두지 않으면 가비지 컬렉션으로 사라진다. */
let tray: Tray | null = null;
/** 작은 창과 설정 창. */
let windows: AppWindows | null = null;

applyAppIdentity();

// 이미 켜진 앱이 있으면 그 앱의 작은 창을 띄우고 이 실행은 끝낸다.
if (app.requestSingleInstanceLock()) {
  start();
} else {
  app.quit();
}

/** 앱을 트레이 상주 앱으로 시작한다. */
function start(): void {
  app.enableSandbox();

  app.on('second-instance', () => windows?.openPopover());
  // 트레이 앱이라 창이 모두 닫혀도 종료하지 않는다. 종료는 트레이 메뉴의 "종료"로만 한다.
  app.on('window-all-closed', () => {});

  void app.whenReady().then(() => {
    hardenRenderers();
    applyApplicationMenu();
    // 설치본은 LSUIElement로 Dock 아이콘이 없다. 소스 실행도 같게 맞춘다.
    app.dock?.hide();

    windows = new AppWindows(() => tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 });
    registerIpc(windows);

    /** 트레이 동작이 부를 창 관리자. 콜백 안에서 `null` 검사를 하지 않으려고 지역 상수로 잡는다. */
    const appWindows = windows;
    tray = createTray({
      togglePopover: () => appWindows.togglePopover(),
      openPopover: () => appWindows.openPopover(),
      openSettings: () => appWindows.openSettings(),
      quit: () => app.quit(),
    });
  });
}

/**
 * 앱 메뉴를 정한다. 기본 메뉴의 새로고침·개발자 도구 단축키를 없앤다.
 * macOS는 입력 칸의 복사·붙여넣기 단축키가 메뉴를 거치므로 편집 메뉴를 남긴다.
 */
function applyApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}
