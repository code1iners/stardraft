import { app } from 'electron';
import { join } from 'node:path';

/** 번들 ID이자 Windows AppUserModelID. 키체인 항목, 알림 권한, 로그인 항목이 이 값에 묶이므로 바꾸지 않는다. */
export const APP_ID = 'app.squadify.stardraft';
/** 소스에서 실행할 때 쓰는 앱 이름. */
export const DEV_APP_NAME = 'Stardraft Dev';

/**
 * 소스에서 실행하면(`app.isPackaged`가 false) 이름과 데이터 폴더를 설치본과 나눈다.
 * 데이터 폴더 경로는 시작할 때 정해지므로 `ready` 전에 불러야 한다.
 */
export function applyAppIdentity(): void {
  if (!app.isPackaged) {
    app.setName(DEV_APP_NAME);
    app.setPath('userData', join(app.getPath('appData'), DEV_APP_NAME));
  }

  // 개발 중 실행이 설치본의 알림·바로가기 등록을 건드리지 않게 AUMID도 나눈다.
  if (process.platform === 'win32') {
    app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.dev`);
  }
}
