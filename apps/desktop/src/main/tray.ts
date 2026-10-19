import { app, Menu, Tray } from 'electron';
import trayIcon from '../../resources/tray.png?asset';
import trayTemplateIcon from '../../resources/trayTemplate.png?asset';

/** 트레이 아이콘과 메뉴가 부르는 동작. */
export interface TrayActions {
  /** 아이콘 클릭. 작은 창을 열거나 닫는다. */
  togglePopover: () => void;
  /** 메뉴 "창 열기". */
  openPopover: () => void;
  /** 메뉴 "설정…". */
  openSettings: () => void;
  /** 메뉴 "종료". */
  quit: () => void;
}

/**
 * 메뉴 막대(트레이) 아이콘을 만든다.
 * 왼쪽 클릭은 작은 창, 오른쪽 클릭은 메뉴다. 메뉴를 `setContextMenu`로 달면 macOS에서 왼쪽 클릭도 메뉴가 되므로 직접 띄운다.
 */
export function createTray(actions: TrayActions): Tray {
  // macOS는 메뉴 막대 색에 맞춰 칠해지는 템플릿 이미지, Windows는 색이 있는 이미지를 쓴다.
  const tray = new Tray(process.platform === 'darwin' ? trayTemplateIcon : trayIcon);
  tray.setToolTip(app.name);
  tray.setIgnoreDoubleClickEvents(true);

  const menu = Menu.buildFromTemplate([
    { label: '창 열기', click: actions.openPopover },
    { label: '설정…', click: actions.openSettings },
    { type: 'separator' },
    { label: '종료', click: actions.quit },
  ]);

  tray.on('click', actions.togglePopover);
  tray.on('right-click', () => tray.popUpContextMenu(menu));
  return tray;
}
