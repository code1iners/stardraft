import { app, session } from 'electron';
import { devServerUrl, isAppRendererUrl } from './renderer-page';

/**
 * 렌더러가 앱 밖으로 나가지 못하게 막는다. `ready` 뒤에 한 번 부른다.
 * 새 창, 다른 주소로의 이동, webview, 권한 요청, 원격 네트워크 요청을 모두 거절한다.
 */
export function hardenRenderers(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', blockLeavingApp);
    contents.on('will-redirect', blockLeavingApp);
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  /** 모든 창이 함께 쓰는 기본 세션. */
  const { defaultSession } = session;
  defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  defaultSession.setPermissionCheckHandler(() => false);

  // 렌더러에서 나간 네트워크 요청만 막는다. main의 요청(Flow API, 업데이트 확인)은 webContents가 없어 걸리지 않는다.
  /** 렌더러가 닿아도 되는 유일한 출처. 소스 실행 때의 개발 서버이고, 설치본이면 없다. */
  const allowedOrigin = devServerUrl()?.origin ?? null;
  defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      /** 렌더러에서 나간 요청인지 여부. */
      const fromRenderer = details.webContentsId !== undefined;
      /** 개발 서버로 가는 요청인지 여부. */
      const allowed = allowedOrigin !== null && isSameOrigin(details.url, allowedOrigin);
      callback({ cancel: fromRenderer && !allowed });
    },
  );
}

/** 앱의 렌더러 화면이 아닌 주소로 이동하거나 리디렉트하려 하면 막는다. */
function blockLeavingApp(event: Electron.Event, url: string): void {
  if (!isAppRendererUrl(url)) event.preventDefault();
}

/** `rawUrl`의 출처가 `origin`과 같은지 확인한다. ws 요청은 같은 호스트의 http 출처로 본다. */
function isSameOrigin(rawUrl: string, origin: string): boolean {
  try {
    /** 검사할 주소. */
    const url = new URL(rawUrl);
    /** ws·wss를 http·https로 바꾼 프로토콜. */
    const protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
    return `${protocol}//${url.host}` === origin;
  } catch {
    return false;
  }
}
