import { app, dialog, Menu, type Tray } from 'electron';
import { join } from 'node:path';
import { errorFields } from '../core/logging/logger';
import { openAppData, type AppData } from '../core/storage/app-data';
import { APP_ID, applyAppIdentity, dataFolderPath, logsFolderPath } from './app-identity';
import { createAppLogger } from './app-logger';
import { AppWindows } from './app-windows';
import { registerIpc } from './ipc';
import { hardenRenderers } from './security';
import { createTray } from './tray';

/** 트레이 아이콘. 변수로 붙잡아 두지 않으면 가비지 컬렉션으로 사라진다. */
let tray: Tray | null = null;
/** 작은 창과 설정 창. */
let windows: AppWindows | null = null;
/** 형식 검사를 마친 설정과 상태 저장소. */
let appData: AppData | null = null;

applyAppIdentity();

/** 진단 로거. 로그 폴더가 정해진 뒤에 만든다. */
const logger = createAppLogger();

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
  // 끝낼 때 state.db를 닫아 WAL 내용을 본 파일에 반영한다.
  app.on('will-quit', () => {
    appData?.close();
    appData = null;
  });

  void app.whenReady().then(async () => {
    hardenRenderers();
    applyApplicationMenu();
    // 설치본은 LSUIElement로 Dock 아이콘이 없다. 소스 실행도 같게 맞춘다.
    app.dock?.hide();
    logStartup();

    appData = await openDataOrQuit();
    if (!appData) return;

    windows = new AppWindows(() => tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 });
    registerIpc(windows, logger);

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

/** 시작할 때 버전과 폴더 위치를 로그에 남긴다. macOS는 업데이트 설치 기록(ShipIt 로그) 위치도 남긴다. */
function logStartup(): void {
  logger.info('app.started', {
    appName: app.name,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    dataDir: dataFolderPath(),
    logsDir: logsFolderPath(),
    shipItLogDir: process.platform === 'darwin' ? join(app.getPath('home'), 'Library', 'Caches', `${APP_ID}.ShipIt`) : null,
  });
}

/**
 * 데이터 폴더를 연다. 더 새 버전의 데이터이거나 열 수 없으면 안내 창을 띄우고 앱을 끝낸다.
 * 어느 경우에도 데이터는 지우지 않는다.
 */
async function openDataOrQuit(): Promise<AppData | null> {
  try {
    /** 데이터 폴더를 연 결과. */
    const result = await openAppData({ dataDir: dataFolderPath(), appVersion: app.getVersion(), logger });
    if (result.kind === 'ready') return result;
    await showStartupProblem(result.message);
  } catch (error) {
    await showStartupProblem(
      '데이터를 열 수 없어 Stardraft를 시작하지 못했습니다.',
      `데이터 폴더: ${dataFolderPath()}\n로그 폴더: ${logsFolderPath()}\n\n${errorFields(error).errorMessage ?? ''}`,
    );
  }
  app.quit();
  return null;
}

/** 시작을 막는 문제를 창으로 알린다. 메뉴 막대 앱이라 창이 다른 앱 뒤에 숨지 않게 앞으로 가져온다. */
async function showStartupProblem(message: string, detail?: string): Promise<void> {
  app.focus({ steal: true });
  await dialog.showMessageBox({
    type: 'warning',
    title: app.name,
    message,
    ...(detail ? { detail } : {}),
    buttons: ['종료'],
    noLink: true,
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
