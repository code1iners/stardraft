import { app } from 'electron';
import { join } from 'node:path';

/** 번들 ID이자 Windows AppUserModelID. 키체인 항목, 알림 권한, 로그인 항목이 이 값에 묶이므로 바꾸지 않는다. */
export const APP_ID = 'app.squadify.stardraft';
/** 설치본의 앱 이름. 데이터 폴더 이름이기도 하다. */
export const APP_NAME = 'Stardraft';
/** 소스에서 실행할 때 쓰는 앱 이름. */
export const DEV_APP_NAME = 'Stardraft Dev';

/**
 * 앱 이름과 데이터·로그 폴더를 정한다. 경로는 시작할 때 정해지므로 `ready` 전에 불러야 한다.
 * 데이터 폴더는 OS 표준 앱 데이터 폴더 아래 앱 이름 폴더로 고정한다(macOS `~/Library/Application Support/Stardraft`, Windows `%APPDATA%\Stardraft`).
 * 소스에서 실행하면(`app.isPackaged`가 false) 이름과 폴더를 `Stardraft Dev`로 나눠 설치본의 데이터를 건드리지 않는다.
 */
export function applyAppIdentity(): void {
  /** 이 실행의 앱 이름. */
  const name = app.isPackaged ? APP_NAME : DEV_APP_NAME;
  app.setName(name);
  // 실행 인수(--user-data-dir 등)로 위치가 바뀌지 않게 명시적으로 고정한다.
  app.setPath('userData', join(app.getPath('appData'), name));
  // OS 표준 로그 폴더: macOS는 ~/Library/Logs/<앱 이름>, Windows는 데이터 폴더 안 logs다.
  // 인수 없이 부르면 소스 실행에서 번들 이름(Electron)을 쓰므로 경로를 직접 넘긴다.
  app.setAppLogsPath(
    process.platform === 'darwin'
      ? join(app.getPath('home'), 'Library', 'Logs', name)
      : join(app.getPath('userData'), 'logs'),
  );

  // 개발 중 실행이 설치본의 알림·바로가기 등록을 건드리지 않게 AUMID도 나눈다.
  if (process.platform === 'win32') {
    app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.dev`);
  }
}

/** 데이터 폴더(`settings.json`, `state.db`가 있는 곳). */
export function dataFolderPath(): string {
  return app.getPath('userData');
}

/** 진단 로그 폴더. */
export function logsFolderPath(): string {
  return app.getPath('logs');
}
