import { app, Menu, nativeTheme, powerMonitor, systemPreferences, Tray, type MenuItemConstructorOptions, type Rectangle } from 'electron';
import type { TrayIndicator } from '../core/tray-indicator';
import type { GlobalProblemText } from '../shared/global-problem-text';
import type { SettingsSection } from '../shared/ipc';
import type { UpdateMenuAction, UpdateMenuItem } from '../shared/update-text';
import { TrayAnimation } from './tray-animation';
import { TrayImages } from './tray-images';

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
  /** 메뉴의 업데이트 항목. 항목마다 정한 일을 한다. */
  runUpdateAction: (action: UpdateMenuAction) => void;
  /** 메뉴 "종료". */
  quit: () => void;
}

/** 트레이에 보일 앱 상태. */
export interface TrayView {
  /** 아이콘의 형태와 알림 상태. */
  indicator: TrayIndicator;
  /** 오른쪽 클릭 메뉴 맨 위에 둘 전역 문제의 문구. 없으면 `null`. */
  problem: GlobalProblemText | null;
  /** 메뉴 "지금 확인"을 누를 수 있는지 여부. 감지를 시작하기 전에는 끈다. */
  canCheckNow: boolean;
}

/** 표시마다 툴팁에 덧붙이는 말. */
function tooltipNote({ indicator, problem }: TrayView): string | null {
  if (problem) return problem.title;
  if (indicator.kind === 'problem') return indicator.reason === 'setup-needed' ? '설정 필요' : '실패 있음';
  if (indicator.kind === 'review') return `검토 대기 ${indicator.count}건`;
  if (indicator.generating) return '초안 생성 중';
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
  private view: TrayView = { indicator: { kind: 'idle', generating: false }, problem: null, canCheckNow: false };
  /** 메뉴의 업데이트 항목. 없으면 `null`. 받는 동안 자주 바뀌므로 아이콘과 따로 두고 메뉴를 열 때 읽는다. */
  private updateItem: UpdateMenuItem | null = null;
  /** 모든 상태와 배율의 미리 만든 이미지. */
  private readonly images = new TrayImages();
  /** pulse 예약과 동작 줄이기를 관리한다. */
  private readonly animation: TrayAnimation;
  /** 폐기 후의 상태 통지를 무시한다. */
  private disposed = false;
  /** 테마 변경 구독. 같은 함수를 제거할 수 있도록 보관한다. */
  private readonly onTheme = (): void => this.animation.refresh();
  /** 절전 시 예약을 멈춘다. */
  private readonly onSuspend = (): void => this.animation.suspend();
  /** 복귀 시 설정을 다시 읽고 주기를 시작한다. */
  private readonly onResume = (): void => this.animation.resume();

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(this.images.get('idle', 0, nativeTheme.shouldUseDarkColorsForSystemIntegratedUI));
    this.animation = new TrayAnimation(
      (kind, frame) => this.tray.setImage(this.images.get(kind, frame, nativeTheme.shouldUseDarkColorsForSystemIntegratedUI)),
      () => systemPreferences.getAnimationSettings().prefersReducedMotion,
    );
    this.tray.setToolTip(app.name);
    if (process.platform === 'darwin') {
      this.tray.setTitle('');
      this.tray.setIgnoreDoubleClickEvents(true);
    }
    this.tray.on('click', actions.togglePopover);
    this.tray.on('right-click', () => this.tray.popUpContextMenu(this.buildMenu()));
    nativeTheme.on('updated', this.onTheme);
    powerMonitor.on('suspend', this.onSuspend);
    powerMonitor.on('resume', this.onResume);
  }

  /** 타이머와 운영체제 구독을 먼저 해제한 뒤 아이콘을 한 번만 없앤다. */
  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animation.destroy();
    nativeTheme.removeListener('updated', this.onTheme);
    powerMonitor.removeListener('suspend', this.onSuspend);
    powerMonitor.removeListener('resume', this.onResume);
    this.tray.destroy();
  }

  /** 트레이 아이콘의 화면 위치. 작은 창을 붙일 때 쓴다. */
  getBounds(): Rectangle {
    return this.tray.getBounds();
  }

  /** 아이콘 표시, 툴팁, 메뉴를 앱 상태에 맞춘다. */
  show(view: TrayView): void {
    if (this.disposed) return;
    this.view = view;
    /** 툴팁에 덧붙이는 말. */
    const note = tooltipNote(view);
    this.tray.setToolTip(note ? `${app.name} · ${note}` : app.name);
    this.animation.show(view.indicator.kind);
  }

  /** 메뉴의 업데이트 항목을 바꾼다. 업데이트 때문에 아이콘은 바꾸지 않는다. */
  setUpdateItem(item: UpdateMenuItem | null): void {
    if (this.disposed) return;
    this.updateItem = item;
  }

  /** 오른쪽 클릭 메뉴. 전역 문제가 있으면 맨 위에 그 항목을 두고, 업데이트 항목은 "설정…" 아래에 둔다. */
  private buildMenu(): Menu {
    /** 메뉴 항목이 부를 동작. */
    const { actions } = this;
    /** 맨 위에 둘 전역 문제. */
    const problem = this.view.problem;
    /** 업데이트 항목. */
    const update = this.updateItem;
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
      ...(update ? [updateMenuEntry(update, actions)] : []),
      { type: 'separator' },
      { label: '종료', click: actions.quit },
    ];
    return Menu.buildFromTemplate(items);
  }
}

/** 업데이트 항목의 메뉴 항목. 누를 일이 없으면 누를 수 없게 둔다. */
function updateMenuEntry({ label, action }: UpdateMenuItem, actions: TrayActions): MenuItemConstructorOptions {
  return action ? { label, click: () => actions.runUpdateAction(action) } : { label, enabled: false };
}
