import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage, type Rectangle } from 'electron';
import trayIcon from '../../resources/tray.png?asset';
import trayTemplateIcon from '../../resources/trayTemplate.png?asset';
import type { TrayIndicator } from '../core/tray-indicator';
import type { GlobalProblemText } from '../shared/global-problem-text';
import type { SettingsSection } from '../shared/ipc';
import { drawAlertBadge } from './tray-badge';

/** 트레이 아이콘과 메뉴가 부르는 동작. */
export interface TrayActions {
  /** 아이콘 클릭. 작은 창을 열거나 닫는다. */
  togglePopover: () => void;
  /** 메뉴 "창 열기". */
  openPopover: () => void;
  /** 메뉴 "설정…"과 전역 문제 항목. 칸을 주면 그 칸을 연다. */
  openSettings: (section?: SettingsSection) => void;
  /** 메뉴 "종료". */
  quit: () => void;
}

/** 트레이에 보일 앱 상태. */
export interface TrayView {
  /** 아이콘에 덧붙이는 표시. */
  indicator: TrayIndicator;
  /** 오른쪽 클릭 메뉴 맨 위에 둘 전역 문제의 문구. 없으면 `null`. */
  problem: GlobalProblemText | null;
}

/**
 * 메뉴 막대(트레이) 아이콘.
 * 왼쪽 클릭은 작은 창, 오른쪽 클릭은 메뉴다. 메뉴를 `setContextMenu`로 달면 macOS에서 왼쪽 클릭도 메뉴가 되므로 직접 띄운다.
 */
export class AppTray {
  /** 트레이 아이콘. 이 객체가 붙잡고 있어야 가비지 컬렉션으로 사라지지 않는다. */
  private readonly tray: Tray;
  /** 지금 보이는 상태. 오른쪽 클릭할 때 메뉴를 이 상태로 만든다. */
  private view: TrayView = { indicator: { kind: 'none' }, problem: null };
  /** Windows "!" 배지 아이콘. 처음 쓸 때 만든다. */
  private alertIcon: NativeImage | null = null;

  constructor(private readonly actions: TrayActions) {
    // macOS는 메뉴 막대 색에 맞춰 칠해지는 템플릿 이미지, Windows는 색이 있는 이미지를 쓴다.
    this.tray = new Tray(process.platform === 'darwin' ? trayTemplateIcon : trayIcon);
    this.tray.setToolTip(app.name);
    this.tray.setIgnoreDoubleClickEvents(true);
    this.tray.on('click', actions.togglePopover);
    this.tray.on('right-click', () => this.tray.popUpContextMenu(this.buildMenu()));
  }

  /** 트레이 아이콘의 화면 위치. 작은 창을 붙일 때 쓴다. */
  getBounds(): Rectangle {
    return this.tray.getBounds();
  }

  /** 아이콘 표시, 툴팁, 메뉴를 앱 상태에 맞춘다. */
  show(view: TrayView): void {
    this.view = view;
    this.tray.setToolTip(view.problem ? `${app.name} · ${view.problem.title}` : app.name);
    this.applyIndicator(view.indicator);
  }

  /**
   * 아이콘에 표시를 덧붙인다. macOS는 아이콘 옆 글자, Windows는 아이콘에 그린 배지다.
   * Windows 숫자 배지는 검토 대기를 더하는 티켓이 그린다. 그전까지 숫자는 macOS에만 보인다.
   */
  private applyIndicator(indicator: TrayIndicator): void {
    if (process.platform === 'darwin') {
      this.tray.setTitle(indicator.kind === 'alert' ? '!' : indicator.kind === 'review-count' ? String(indicator.count) : '');
      return;
    }
    this.tray.setImage(indicator.kind === 'alert' ? this.windowsAlertIcon() : trayIcon);
  }

  /** 색 아이콘의 오른쪽 아래에 빨간 "!" 배지를 그린 아이콘. 고해상도 화면용 2배 이미지에도 그린다. */
  private windowsAlertIcon(): NativeImage {
    if (this.alertIcon) return this.alertIcon;

    /** 배지를 그릴 원래 아이콘. `@2x` 파일도 함께 읽힌다. */
    const base = nativeImage.createFromPath(trayIcon);
    /** 배지를 그린 아이콘. */
    const badged = nativeImage.createEmpty();
    for (const scaleFactor of base.getScaleFactors()) {
      /** 이 배율의 BGRA 비트맵. */
      const bitmap = base.toBitmap({ scaleFactor });
      /** 정사각형 아이콘의 한 변 픽셀 수. */
      const size = Math.round(Math.sqrt(bitmap.length / 4));
      badged.addRepresentation({ scaleFactor, width: size, height: size, buffer: Buffer.from(drawAlertBadge(bitmap, size)) });
    }
    this.alertIcon = badged;
    return badged;
  }

  /** 오른쪽 클릭 메뉴. 전역 문제가 있으면 맨 위에 그 항목을 둔다. */
  private buildMenu(): Menu {
    /** 메뉴 항목이 부를 동작. */
    const { actions } = this;
    /** 맨 위에 둘 전역 문제. */
    const problem = this.view.problem;
    /** 메뉴 항목. */
    const items: MenuItemConstructorOptions[] = [
      ...(problem
        ? ([
            { label: `${problem.title}: ${problem.actionLabel}…`, click: () => actions.openSettings(problem.actionSection) },
            { type: 'separator' },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      { label: '창 열기', click: actions.openPopover },
      { label: '설정…', click: () => actions.openSettings() },
      { type: 'separator' },
      { label: '종료', click: actions.quit },
    ];
    return Menu.buildFromTemplate(items);
  }
}
