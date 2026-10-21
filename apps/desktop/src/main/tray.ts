import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage, type Rectangle } from 'electron';
import trayIcon from '../../resources/tray.png?asset';
import trayTemplateIcon from '../../resources/trayTemplate.png?asset';
import type { TrayIndicator } from '../core/tray-indicator';
import type { GlobalProblemText } from '../shared/global-problem-text';
import type { SettingsSection } from '../shared/ipc';
import { drawAlertBadge, drawSetupDot } from './tray-badge';

/** 트레이 아이콘과 메뉴가 부르는 동작. */
export interface TrayActions {
  /** 아이콘 클릭. 작은 창을 열거나 닫는다. */
  togglePopover: () => void;
  /** 메뉴 "창 열기". */
  openPopover: () => void;
  /** 메뉴 "설정…"과 전역 문제 항목. 칸을 주면 그 칸을 연다. */
  openSettings: (section?: SettingsSection) => void;
  /** 메뉴 "지금 확인". Flow 알림을 바로 조회한다. */
  checkNow: () => void;
  /** 메뉴 "종료". */
  quit: () => void;
}

/** Windows 아이콘에 그려 넣는 표시와 그 표시를 비트맵에 그리는 함수. */
const WINDOWS_BADGES = { alert: drawAlertBadge, 'setup-needed': drawSetupDot } as const;

/** Windows 아이콘에 그려 넣는 표시. */
type WindowsBadge = keyof typeof WINDOWS_BADGES;

/** macOS 메뉴 막대 제목에 쓰는 노란 점. 제목 글자는 ANSI 색을 받는다. */
const MAC_SETUP_DOT = '\x1b[33m●\x1b[0m';

/** 아이콘에 그려 넣어 보이는 표시인지 본다. 숫자 배지는 아직 그리지 않는다. */
function isWindowsBadge(kind: TrayIndicator['kind']): kind is WindowsBadge {
  return Object.hasOwn(WINDOWS_BADGES, kind);
}

/** 트레이에 보일 앱 상태. */
export interface TrayView {
  /** 아이콘에 덧붙이는 표시. */
  indicator: TrayIndicator;
  /** 오른쪽 클릭 메뉴 맨 위에 둘 전역 문제의 문구. 없으면 `null`. */
  problem: GlobalProblemText | null;
  /** 메뉴 "지금 확인"을 누를 수 있는지 여부. 감지를 시작하기 전에는 끈다. */
  canCheckNow: boolean;
}

/** 표시마다 툴팁에 덧붙이는 말. */
function tooltipNote({ indicator, problem }: TrayView): string | null {
  if (problem) return problem.title;
  if (indicator.kind === 'setup-needed') return '설정 필요';
  // Windows는 아직 아이콘에 숫자를 그리지 않으므로 툴팁으로도 검토 대기 수를 알린다.
  if (indicator.kind === 'review-count') return `멘션 ${indicator.count}건`;
  return null;
}

/**
 * 메뉴 막대(트레이) 아이콘.
 * 왼쪽 클릭은 작은 창, 오른쪽 클릭은 메뉴다. 메뉴를 `setContextMenu`로 달면 macOS에서 왼쪽 클릭도 메뉴가 되므로 직접 띄운다.
 */
export class AppTray {
  /** 트레이 아이콘. 이 객체가 붙잡고 있어야 가비지 컬렉션으로 사라지지 않는다. */
  private readonly tray: Tray;
  /** 지금 보이는 상태. 오른쪽 클릭할 때 메뉴를 이 상태로 만든다. */
  private view: TrayView = { indicator: { kind: 'none' }, problem: null, canCheckNow: false };
  /** Windows 배지 아이콘. 표시마다 처음 쓸 때 만든다. */
  private readonly badgedIcons = new Map<WindowsBadge, NativeImage>();

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
    /** 툴팁에 덧붙이는 말. */
    const note = tooltipNote(view);
    this.tray.setToolTip(note ? `${app.name} · ${note}` : app.name);
    this.applyIndicator(view.indicator);
  }

  /**
   * 아이콘에 표시를 덧붙인다. macOS는 아이콘 옆 글자, Windows는 아이콘에 그린 배지다.
   * Windows 숫자 배지는 검토 대기를 더하는 티켓이 그린다. 그전까지 숫자는 macOS에만 보인다.
   */
  private applyIndicator(indicator: TrayIndicator): void {
    if (process.platform === 'darwin') {
      this.tray.setTitle(macTitle(indicator));
      return;
    }
    this.tray.setImage(isWindowsBadge(indicator.kind) ? this.windowsBadgedIcon(indicator.kind) : trayIcon);
  }

  /** 색 아이콘의 오른쪽 아래에 빨간 "!" 배지나 노란 점을 그린 아이콘. 고해상도 화면용 2배 이미지에도 그린다. */
  private windowsBadgedIcon(badge: WindowsBadge): NativeImage {
    /** 이미 만든 아이콘. */
    const cached = this.badgedIcons.get(badge);
    if (cached) return cached;
    /** 비트맵에 표시를 그리는 함수. */
    const draw = WINDOWS_BADGES[badge];

    /** 배지를 그릴 원래 아이콘. `@2x` 파일도 함께 읽힌다. */
    const base = nativeImage.createFromPath(trayIcon);
    /** 배지를 그린 아이콘. */
    const badged = nativeImage.createEmpty();
    for (const scaleFactor of base.getScaleFactors()) {
      /** 이 배율의 BGRA 비트맵. */
      const bitmap = base.toBitmap({ scaleFactor });
      /** 정사각형 아이콘의 한 변 픽셀 수. */
      const size = Math.round(Math.sqrt(bitmap.length / 4));
      badged.addRepresentation({ scaleFactor, width: size, height: size, buffer: Buffer.from(draw(bitmap, size)) });
    }
    this.badgedIcons.set(badge, badged);
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
      { label: '지금 확인', enabled: this.view.canCheckNow, click: actions.checkNow },
      { label: '설정…', click: () => actions.openSettings() },
      { type: 'separator' },
      { label: '종료', click: actions.quit },
    ];
    return Menu.buildFromTemplate(items);
  }
}

/** macOS 메뉴 막대에서 아이콘 옆에 보일 글자. */
function macTitle(indicator: TrayIndicator): string {
  switch (indicator.kind) {
    case 'alert':
      return '!';
    case 'review-count':
      return String(indicator.count);
    case 'setup-needed':
      return MAC_SETUP_DOT;
    case 'none':
      return '';
  }
}
