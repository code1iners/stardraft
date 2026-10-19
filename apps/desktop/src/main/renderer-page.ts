import { app, type BrowserWindow, type WebPreferences } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** 렌더러가 그리는 화면 종류. */
export type RendererView = 'popover' | 'settings';

/** 빌드된 렌더러 HTML 파일 경로. */
const rendererIndexPath = join(__dirname, '../renderer/index.html');

/** 소스에서 실행할 때 electron-vite가 띄운 개발 서버 주소. 로컬 주소가 아니면 쓰지 않는다. */
function devServerUrl(): URL | null {
  const raw = process.env.ELECTRON_RENDERER_URL;
  if (app.isPackaged || !raw) return null;
  const url = new URL(raw);
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' ? url : null;
}

/** 모든 창이 쓰는 렌더러 보안 설정. */
export function secureWebPreferences(): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    webSecurity: true,
    spellcheck: false,
  };
}

/** 창에 렌더러 화면을 불러온다. 설치본은 앱 안의 파일만, 소스 실행은 로컬 개발 서버만 연다. */
export function loadRendererView(
  window: BrowserWindow,
  view: RendererView,
  params: Record<string, string> = {},
): Promise<void> {
  const query = { ...params, view };
  const devUrl = devServerUrl();
  if (!devUrl) return window.loadFile(rendererIndexPath, { query });

  for (const [key, value] of Object.entries(query)) devUrl.searchParams.set(key, value);
  return window.loadURL(devUrl.toString());
}

/** 이 앱의 렌더러 화면 주소인지 확인한다. IPC 발신자와 페이지 이동을 검사할 때 쓴다. */
export function isAppRendererUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  const devUrl = devServerUrl();
  if (devUrl) return url.origin === devUrl.origin;
  return url.protocol === 'file:' && url.pathname === pathToFileURL(rendererIndexPath).pathname;
}

/** 소스 실행 때 렌더러가 닿아도 되는 개발 서버 출처. 설치본이면 `null`. */
export function devServerOrigin(): string | null {
  return devServerUrl()?.origin ?? null;
}
