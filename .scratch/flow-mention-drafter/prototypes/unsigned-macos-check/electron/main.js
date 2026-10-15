// 미서명 앱 macOS 실기 검증용 최소 Electron 앱.
// 트레이, 알림, 로그인 시 자동 시작만 넣었다. 구현 코드로 재사용하지 않는다.
// 모든 관찰은 ~/Library/Logs/UnsignedCheck Electron/check.log 에 JSON 한 줄씩 남긴다.

const { app, BrowserWindow, Menu, Notification, Tray, nativeImage, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

/** 시작 직후 자동으로 알림을 띄우지 않게 하는 환경 변수. 개발 모드 점검에서만 쓴다. */
const SKIP_START_NOTIFICATION = process.env.UNSIGNED_CHECK_NO_NOTIFY === '1';
/** 시작 알림을 띄우기까지 기다리는 시간(밀리초). */
const START_NOTIFICATION_DELAY_MS = 3000;

/** 검증 기록 파일 경로. */
const logPath = path.join(app.getPath('logs'), 'check.log');
/** 트레이 아이콘. 지역 변수로 두면 가비지 컬렉션으로 사라진다. */
let tray = null;
/** 알림 클릭으로 여는 가짜 검토 창. */
let reviewWindow = null;
/** 띄운 알림 객체. 참조를 잃으면 클릭 이벤트를 받지 못하므로 보관한다. */
const liveNotifications = new Set();

/** 사건 하나를 JSON 한 줄로 기록하고 콘솔에도 찍는다. */
function log(event, detail = {}) {
  const line = JSON.stringify({ at: new Date().toISOString(), pid: process.pid, event, ...detail });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `${line}\n`);
  console.log(line);
}

/** 로그인 항목 상태를 기록한다. */
function logLoginItem(reason) {
  const { openAtLogin, wasOpenedAtLogin, status } = app.getLoginItemSettings();
  log('login-item', { reason, openAtLogin, wasOpenedAtLogin, status });
}

/** 알림 하나에 이벤트 기록과 클릭 처리를 붙인다. */
function watchNotification(notification, id) {
  notification.on('show', () => log('notification-show', { id }));
  notification.on('failed', (_event, error) => log('notification-failed', { id, error }));
  notification.on('click', () => {
    log('notification-click', { id });
    openReviewWindow(`알림 클릭: ${id}`);
  });
  notification.on('close', (details) => {
    log('notification-close', { id, reason: details?.reason });
    liveNotifications.delete(notification);
  });
  liveNotifications.add(notification);
}

/** 알림을 띄운다. */
function sendNotification(reason) {
  /** 알림 식별자. 알림 센터에서 다시 찾을 때 쓴다. */
  const id = `${reason}-${Date.now()}`;
  const notification = new Notification({
    id,
    title: 'UnsignedCheck Electron',
    subtitle: reason,
    body: '클릭하면 검토 창이 열려야 합니다.',
  });
  watchNotification(notification, id);
  log('notification-requested', { id });
  notification.show();
}

/** 이전 실행에서 띄워 알림 센터에 남은 알림에 클릭 처리를 다시 붙인다. */
async function reattachHistory() {
  const history = await Notification.getHistory();
  log('notification-history', { count: history.length, ids: history.map((n) => n.id) });
  for (const notification of history) {
    watchNotification(notification, notification.id);
  }
}

/** 가짜 검토 창을 열고 앞으로 가져온다. */
function openReviewWindow(reason) {
  // 창이 없으면 새로 만든다.
  if (!reviewWindow || reviewWindow.isDestroyed()) {
    reviewWindow = new BrowserWindow({ width: 440, height: 260, title: '검토 화면(가짜)' });
  }
  reviewWindow.loadFile(path.join(__dirname, 'index.html'), { query: { reason } });
  reviewWindow.show();
  // 메뉴바 전용 앱은 창을 띄워도 앞으로 오지 않을 수 있어 강제로 활성화한다.
  app.focus({ steal: true });
  log('review-window-open', { reason });
}

/** 트레이 아이콘과 메뉴를 만든다. */
function createTray() {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('UC');
  tray.setToolTip('UnsignedCheck Electron');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '알림 보내기', click: () => sendNotification('menu') },
      { label: '검토 창 열기', click: () => openReviewWindow('트레이 메뉴') },
      { type: 'separator' },
      {
        label: '자동 시작 켜기 (setLoginItemSettings)',
        click: () => {
          app.setLoginItemSettings({ openAtLogin: true });
          logLoginItem('enable');
        },
      },
      {
        label: '자동 시작 끄기',
        click: () => {
          app.setLoginItemSettings({ openAtLogin: false });
          logLoginItem('disable');
        },
      },
      { label: '로그인 항목 상태 기록', click: () => logLoginItem('menu') },
      { type: 'separator' },
      { label: '기록 파일 열기', click: () => shell.openPath(logPath) },
      { label: '종료', click: () => app.quit() },
    ]),
  );
  log('tray-created');
}

log('start', {
  argv: process.argv,
  execPath: process.execPath,
  ppid: process.ppid,
  isPackaged: app.isPackaged,
  electron: process.versions.electron,
  notificationSupported: Notification.isSupported(),
});

// 같은 앱이 두 번 뜨면 나중 것을 끝낸다. 시작 기록은 위에서 이미 남겼다.
if (!app.requestSingleInstanceLock()) {
  log('second-instance-quit');
  app.quit();
}

app.on('second-instance', () => openReviewWindow('두 번째 실행'));
// 창을 모두 닫아도 트레이 앱은 살아 있어야 한다.
app.on('window-all-closed', () => log('window-all-closed'));

app.whenReady().then(async function onReady() {
  logLoginItem('start');
  createTray();
  await reattachHistory();
  // 설치 직후 한 번 실행으로 알림 표시까지 보려고 시작 알림을 띄운다.
  if (!SKIP_START_NOTIFICATION) {
    setTimeout(() => sendNotification('start'), START_NOTIFICATION_DELAY_MS);
  }
});
