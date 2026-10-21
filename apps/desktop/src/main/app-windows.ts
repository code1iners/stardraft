import { app, BrowserWindow, screen, type Rectangle } from 'electron';
import type { AppEvent, SettingsSection } from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipc';
import { popoverAnchor, popoverPosition } from './popover-position';
import { loadRendererView, secureWebPreferences, type RendererView } from './renderer-page';

/** 작은 창 크기. */
const POPOVER_SIZE = { width: 380, height: 520 };
/** 설정 창 기본 크기. */
const SETTINGS_SIZE = { width: 820, height: 600 };
/** 펼친 창(목록+상세) 기본 크기. */
const REVIEW_SIZE = { width: 940, height: 640 };
/**
 * 작은 창이 포커스를 잃어 닫힌 직후의 트레이 클릭은 무시하는 시간(밀리초).
 * 열린 작은 창을 닫으려고 트레이를 누르면 blur가 먼저 와서 창이 닫히는데, 이어지는 클릭이 창을 다시 열지 않게 한다.
 */
const REOPEN_GUARD_MS = 300;

/** 창 관리자가 창의 일을 알릴 곳. */
export interface AppWindowsHooks {
  /** 설정 창이 닫혔다. 설정 창에서 시작한 일(키 확인 등)을 그만둘 때 쓴다. */
  onSettingsClosed: () => void;
}

/**
 * 트레이 옆 작은 창, 펼친 창, 설정 창을 연다.
 * 상태는 main에 있으므로 모든 창은 닫을 때 없애고, 열 때마다 새로 만든다.
 */
export class AppWindows {
  /** 열려 있는 작은 창. */
  private popover: BrowserWindow | null = null;
  /** 열려 있는 설정 창. */
  private settings: BrowserWindow | null = null;
  /** 열려 있는 펼친 창. */
  private review: BrowserWindow | null = null;
  /** 작은 창이 포커스를 잃어 닫힌 시각. */
  private popoverBlurClosedAt = 0;

  constructor(
    private readonly getTrayBounds: () => Rectangle,
    private readonly hooks: AppWindowsHooks,
  ) {}

  /** 열려 있는 설정 창. 파일 선택 창을 그 위에 띄울 때 쓴다. 없으면 `null`. */
  settingsWindow(): BrowserWindow | null {
    return this.settings;
  }

  /** 열려 있는 모든 창에 변경 이벤트를 보낸다. */
  broadcast(event: AppEvent): void {
    for (const window of [this.popover, this.settings, this.review]) {
      if (window) this.send(window, event);
    }
  }

  /** 트레이 아이콘 클릭. 작은 창이 열려 있으면 닫고, 닫혀 있으면 연다. */
  togglePopover(): void {
    if (this.popover) {
      this.popover.close();
      return;
    }
    if (Date.now() - this.popoverBlurClosedAt < REOPEN_GUARD_MS) return;
    this.openPopover();
  }

  /**
   * 작은 창을 트레이 근처에 연다. 이미 열려 있으면 앞으로 가져온다.
   * 묶음 ID를 주면 그 묶음을 연 작은 창이 된다(OS 알림 클릭, "접어 보기").
   */
  openPopover(bundleId: number | null = null): void {
    if (this.popover) {
      if (bundleId !== null) this.send(this.popover, { type: 'review-bundle-requested', bundleId });
      this.popover.show();
      this.popover.focus();
      return;
    }

    /** 트레이 아이콘의 화면 위치. */
    const trayBounds = this.getTrayBounds();
    /** 마우스 포인터 위치. 트레이 위치를 모를 때 대신 쓴다. */
    const cursor = screen.getCursorScreenPoint();
    /** 작은 창을 붙일 기준 사각형. */
    const anchor = popoverAnchor(trayBounds, cursor);
    /** 기준 사각형이 있는 모니터. */
    const display = screen.getDisplayNearestPoint({
      x: anchor.x + anchor.width / 2,
      y: anchor.y + anchor.height / 2,
    });
    /** 작은 창의 왼쪽 위 좌표. */
    const position = popoverPosition({ trayBounds, workArea: display.workArea, windowSize: POPOVER_SIZE, cursor });

    /** 새로 만든 작은 창. */
    const window = new BrowserWindow({
      ...position,
      ...POPOVER_SIZE,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#ffffff',
      webPreferences: secureWebPreferences(),
    });
    window.once('ready-to-show', () => {
      window.show();
      window.focus();
    });
    // 트레이 팝오버라 다른 곳을 누르면 닫는다.
    window.on('blur', () => {
      this.popoverBlurClosedAt = Date.now();
      window.close();
    });
    window.on('closed', () => {
      this.popover = null;
    });

    this.popover = window;
    this.load(window, 'popover', bundleParam(bundleId));
  }

  /** "펼쳐 보기". 작은 창을 닫고 목록+상세 창을 연다. 이미 열려 있으면 그 묶음을 보이고 앞으로 가져온다. */
  openReview(bundleId: number | null): void {
    this.popover?.close();

    if (this.review) {
      if (bundleId !== null) this.send(this.review, { type: 'review-bundle-requested', bundleId });
      void this.showWithDock(this.review);
      return;
    }

    /** 새로 만든 펼친 창. */
    const window = new BrowserWindow({
      ...REVIEW_SIZE,
      minWidth: 720,
      minHeight: 460,
      title: app.name,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: secureWebPreferences(),
    });
    window.on('page-title-updated', (event) => event.preventDefault());
    window.once('ready-to-show', () => void this.showWithDock(window));
    window.on('closed', () => {
      this.review = null;
      this.hideDockIfNoWindows();
    });

    this.review = window;
    this.load(window, 'review', bundleParam(bundleId));
  }

  /** "접어 보기". 펼친 창을 닫고, Dock 아이콘까지 숨긴 뒤에 그 묶음을 연 작은 창을 띄운다. */
  async collapseReview(bundleId: number | null): Promise<void> {
    await closeAndWait(this.review);
    this.openPopover(bundleId);
  }

  /** 설정 창을 연다. 칸을 주면 그 칸을 보인다. 작은 창은 닫는다. */
  openSettings(section?: SettingsSection): void {
    this.popover?.close();

    if (this.settings) {
      if (section) this.send(this.settings, { type: 'settings-section-requested', section });
      void this.showWithDock(this.settings);
      return;
    }

    /** 새로 만든 설정 창. */
    const window = new BrowserWindow({
      ...SETTINGS_SIZE,
      minWidth: 640,
      minHeight: 420,
      title: `${app.name} 설정`,
      show: false,
      backgroundColor: '#ffffff',
      webPreferences: secureWebPreferences(),
    });
    window.on('page-title-updated', (event) => event.preventDefault());
    window.once('ready-to-show', () => void this.showWithDock(window));
    window.on('closed', () => {
      this.settings = null;
      this.hideDockIfNoWindows();
      this.hooks.onSettingsClosed();
    });

    this.settings = window;
    this.load(window, 'settings', section ? { section } : {});
  }

  /** 설정 창이 열려 있으면 닫고, 다 닫혀 Dock 아이콘을 숨긴 뒤에 끝난다. */
  closeSettings(): Promise<void> {
    return closeAndWait(this.settings);
  }

  /** 설정 창이나 펼친 창을 보인다. 이런 일반 창이 열려 있는 동안만 macOS Dock 아이콘을 보인다. */
  private async showWithDock(window: BrowserWindow): Promise<void> {
    // Windows는 작업 표시줄을 건너뛰지 않는 창이라 창을 보이면 작업 표시줄 단추가 함께 생긴다.
    // 앱이 앞에 있을 때 dock.show()는 늦게 끝나고 그 사이에 부른 dock.hide()를 덮으므로, 이미 보이면 부르지 않는다.
    if (app.dock && !app.dock.isVisible()) await app.dock.show();

    // Dock 아이콘을 보이는 사이에 창이 닫혔으면, 남은 일반 창이 없을 때 다시 숨긴다.
    if (window.isDestroyed()) {
      this.hideDockIfNoWindows();
      return;
    }
    window.show();
    window.focus();
  }

  /** 설정 창과 펼친 창이 모두 닫혔으면 macOS Dock 아이콘을 숨긴다. */
  private hideDockIfNoWindows(): void {
    if (!this.settings && !this.review) app.dock?.hide();
  }

  /** 창에 렌더러 화면을 불러온다. 실패하면 창을 닫고 로그만 남긴다. */
  private load(window: BrowserWindow, view: RendererView, params: Record<string, string> = {}): void {
    loadRendererView(window, view, params).catch((error: unknown) => {
      console.error(`${view} 화면을 불러오지 못했습니다.`, error);
      if (!window.isDestroyed()) window.close();
    });
  }

  /** 창 하나에 변경 이벤트를 보낸다. */
  private send(window: BrowserWindow, event: AppEvent): void {
    if (!window.isDestroyed()) window.webContents.send(IPC_CHANNELS.event, event);
  }
}

/** 창 주소에 실을 묶음 ID. 없으면 싣지 않는다. */
function bundleParam(bundleId: number | null): Record<string, string> {
  return bundleId === null ? {} : { bundle: String(bundleId) };
}

/** 창이 열려 있으면 닫고, 다 닫힌 뒤에 끝난다. */
function closeAndWait(window: BrowserWindow | null): Promise<void> {
  if (!window || window.isDestroyed()) return Promise.resolve();
  return new Promise((resolve) => {
    window.once('closed', () => resolve());
    window.close();
  });
}
