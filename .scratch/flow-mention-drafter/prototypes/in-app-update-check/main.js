// 앱 내 업데이트 macOS 실기 검증용 최소 Electron 앱. 구현 코드로 재사용하지 않는다.
// 실험 설계는 research/in-app-update.md 6절을 따른다.
// 모든 관찰은 ~/Library/Logs/UpdateProbe/probe.log 에 JSON 한 줄씩 남긴다.

const { app, Menu, Notification, Tray, nativeImage, safeStorage, shell, autoUpdater: nativeUpdater } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');

/** 시작 알림을 띄우기까지 기다리는 시간(밀리초). */
const START_NOTIFICATION_DELAY_MS = 3000;
/** Keychain 대화상자가 떴다고 볼 복호화 소요 시간(밀리초). 사람이 누르는 시간은 이보다 길다. */
const KEYCHAIN_PROMPT_SUSPECT_MS = 1500;
/** 셸에서 업데이트 확인을 시킬 때 두 번째 실행에 넘기는 인자. */
const CHECK_UPDATE_ARG = '--check-update';

/** 관찰 기록 파일 경로. */
const logPath = path.join(app.getPath('logs'), 'probe.log');
/** safeStorage로 암호화한 값을 두는 파일. 시작할 때마다 복호화해 Keychain 반응을 본다. */
const secretPath = path.join(app.getPath('userData'), 'secret.bin');
/** 트레이 아이콘. 지역 변수로 두면 가비지 컬렉션으로 사라진다. */
let tray = null;
/** 띄운 알림 객체. 참조를 잃으면 이벤트를 받지 못하므로 보관한다. */
const liveNotifications = new Set();

/** 사건 하나를 JSON 한 줄로 기록하고 콘솔에도 찍는다. */
function log(event, detail = {}) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    pid: process.pid,
    version: app.getVersion(),
    event,
    ...detail,
  });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${line}\n`);
  console.log(line);
}

/** electron-updater 내부 로그를 같은 파일로 모으는 로거. */
const updaterLogger = {
  info: (message) => log('updater-log', { level: 'info', message: String(message) }),
  warn: (message) => log('updater-log', { level: 'warn', message: String(message) }),
  error: (message) => log('updater-log', { level: 'error', message: String(message?.stack ?? message) }),
  debug: (message) => log('updater-log', { level: 'debug', message: String(message) }),
};

/** 로그인 항목 상태를 기록한다. */
function logLoginItem(reason) {
  const { openAtLogin, wasOpenedAtLogin, status } = app.getLoginItemSettings();
  log('login-item', { reason, openAtLogin, wasOpenedAtLogin, status });
}

/** 알림을 띄우고 show/failed/click을 기록한다. */
function sendNotification(reason) {
  /** 알림 식별자. */
  const id = `${reason}-${Date.now()}`;
  const notification = new Notification({
    id,
    title: `UpdateProbe ${app.getVersion()}`,
    subtitle: reason,
    body: '이 알림이 보이면 알림 권한이 살아 있습니다.',
  });
  notification.on('show', () => log('notification-show', { id }));
  notification.on('failed', (_event, error) => log('notification-failed', { id, error }));
  notification.on('click', () => log('notification-click', { id }));
  notification.on('close', () => liveNotifications.delete(notification));
  liveNotifications.add(notification);
  log('notification-requested', { id });
  notification.show();
}

/**
 * safeStorage로 Keychain 반응을 본다.
 * 값이 없으면 새로 암호화해 두고(첫 실행), 있으면 복호화한다(재실행·업데이트 뒤).
 * 대화상자는 호출을 막으므로 소요 시간이 길면 사람이 응답한 것으로 본다.
 */
async function probeKeychain() {
  /** 호출 시작 시각. */
  const startedAt = Date.now();
  try {
    // 처음 실행이면 Keychain 항목이 새로 만들어진다.
    if (!fs.existsSync(secretPath)) {
      const encrypted = await safeStorage.encryptStringAsync(`written-by-${app.getVersion()}`);
      fs.mkdirSync(path.dirname(secretPath), { recursive: true });
      fs.writeFileSync(secretPath, encrypted);
      /** 소요 시간(밀리초). */
      const elapsedMs = Date.now() - startedAt;
      log('keychain-encrypt', { elapsedMs, promptSuspected: elapsedMs > KEYCHAIN_PROMPT_SUSPECT_MS });
      return;
    }
    // 이미 있으면 기존 Keychain 항목을 읽어야 한다. 서명이 바뀌었으면 여기서 묻는다.
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(fs.readFileSync(secretPath));
    /** 소요 시간(밀리초). */
    const elapsedMs = Date.now() - startedAt;
    log('keychain-decrypt', {
      elapsedMs,
      promptSuspected: elapsedMs > KEYCHAIN_PROMPT_SUSPECT_MS,
      result,
      shouldReEncrypt,
    });
  } catch (error) {
    log('keychain-error', { elapsedMs: Date.now() - startedAt, error: String(error?.stack ?? error) });
  }
}

/** 업데이트 확인을 시작한다. 받기와 설치는 이벤트에서 이어진다. */
function checkForUpdates(reason) {
  log('update-check-requested', { reason });
  autoUpdater.checkForUpdates().catch((error) => log('update-check-rejected', { error: String(error?.stack ?? error) }));
}

/** electron-updater와 Electron 내장 autoUpdater(Squirrel.Mac)의 이벤트를 모두 기록한다. */
function wireUpdater() {
  autoUpdater.logger = updaterLogger;
  // Stardraft 추천안처럼 받은 뒤 확인을 거쳐 quitAndInstall을 직접 부른다.
  autoUpdater.autoInstallOnAppQuit = false;
  // 추천안대로 처음에는 차등 다운로드를 끈다. 피드에 옛 blockmap이 없어도 된다.
  autoUpdater.disableDifferentialDownload = true;

  autoUpdater.on('checking-for-update', () => log('updater-checking'));
  autoUpdater.on('update-available', (info) => log('updater-available', { version: info.version }));
  autoUpdater.on('update-not-available', (info) => log('updater-not-available', { version: info.version }));
  autoUpdater.on('download-progress', (progress) =>
    log('updater-progress', { percent: Math.round(progress.percent), transferred: progress.transferred }),
  );
  autoUpdater.on('error', (error) => log('updater-error', { error: String(error?.stack ?? error) }));
  autoUpdater.on('update-downloaded', (info) => {
    log('updater-downloaded', { version: info.version, downloadedFile: info.downloadedFile });
    // 실험에서는 확인 단계 없이 바로 설치한다.
    autoUpdater.quitAndInstall();
  });

  nativeUpdater.on('checking-for-update', () => log('squirrel-checking'));
  nativeUpdater.on('update-available', () => log('squirrel-available'));
  nativeUpdater.on('update-downloaded', (_event, releaseNotes, releaseName) =>
    log('squirrel-downloaded', { releaseName }),
  );
  nativeUpdater.on('before-quit-for-update', () => log('squirrel-before-quit-for-update'));
  nativeUpdater.on('error', (error) => log('squirrel-error', { error: String(error?.stack ?? error) }));
}

/** 트레이 아이콘과 메뉴를 만든다. */
function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle(`UP ${app.getVersion()}`);
  tray.setToolTip(`UpdateProbe ${app.getVersion()}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `UpdateProbe ${app.getVersion()}`, enabled: false },
      { type: 'separator' },
      { label: '업데이트 확인', click: () => checkForUpdates('menu') },
      { type: 'separator' },
      { label: '알림 보내기', click: () => sendNotification('menu') },
      {
        label: '로그인 항목 켜기',
        click: () => {
          app.setLoginItemSettings({ openAtLogin: true });
          logLoginItem('enable');
        },
      },
      {
        label: '로그인 항목 끄기',
        click: () => {
          app.setLoginItemSettings({ openAtLogin: false });
          logLoginItem('disable');
        },
      },
      { label: '상태 기록', click: () => logLoginItem('menu') },
      { type: 'separator' },
      { label: '기록 파일 열기', click: () => shell.openPath(logPath) },
      { label: '종료', click: () => app.quit() },
    ]),
  );
  log('tray-created');
}

// 같은 앱이 두 번 뜨면 나중 것은 인자만 넘기고 끝낸다. Keychain에 닿기 전에 끝내야 한다.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  log('start', {
    argv: process.argv,
    execPath: process.execPath,
    translocated: process.execPath.includes('/AppTranslocation/'),
    ppid: process.ppid,
    electron: process.versions.electron,
  });

  app.on('second-instance', (_event, argv) => {
    log('second-instance', { argv });
    // 셸에서 `UpdateProbe --check-update`로 띄우면 업데이트 확인을 대신 누른다.
    if (argv.includes(CHECK_UPDATE_ARG)) {
      checkForUpdates('second-instance');
    }
  });
  // 창이 없어도 트레이 앱은 살아 있어야 한다.
  app.on('window-all-closed', () => {});
  app.on('before-quit', () => log('before-quit'));

  app.whenReady().then(async function onReady() {
    logLoginItem('start');
    wireUpdater();
    createTray();
    await probeKeychain();
    setTimeout(() => sendNotification('start'), START_NOTIFICATION_DELAY_MS);
  });
}
