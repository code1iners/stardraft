import { app, session } from 'electron';
import { devServerOrigin, isAppRendererUrl } from './renderer-page';

/**
 * 렌더러가 앱 밖으로 나가지 못하게 막는다. `ready` 뒤에 한 번 부른다.
 * 새 창, 다른 주소로의 이동, webview, 권한 요청, 원격 네트워크 요청을 모두 거절한다.
 */
export function hardenRenderers(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', (event, url) => {
      if (!isAppRendererUrl(url)) event.preventDefault();
    });
    contents.on('will-redirect', (event, url) => {
      if (!isAppRendererUrl(url)) event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => event.preventDefault());
  });

  const { defaultSession } = session;
  defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  defaultSession.setPermissionCheckHandler(() => false);

  // 렌더러에서 나간 네트워크 요청만 막는다. main의 요청(Flow API, 업데이트 확인)은 webContents가 없어 걸리지 않는다.
  const allowedOrigin = devServerOrigin();
  defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const fromRenderer = details.webContentsId !== undefined;
      const allowed = allowedOrigin !== null && isSameOrigin(details.url, allowedOrigin);
      callback({ cancel: fromRenderer && !allowed });
    },
  );
}

/** `rawUrl`의 출처가 `origin`과 같은지 확인한다. ws 요청은 같은 호스트의 http 출처로 본다. */
function isSameOrigin(rawUrl: string, origin: string): boolean {
  try {
    const url = new URL(rawUrl);
    const protocol = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
    return `${protocol}//${url.host}` === origin;
  } catch {
    return false;
  }
}
