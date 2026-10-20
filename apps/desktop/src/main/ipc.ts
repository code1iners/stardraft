import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, parseAppCommand, type AppCommand, type AppSnapshot } from '../shared/ipc';
import type { AppWindows } from './app-windows';
import { isAppRendererUrl } from './renderer-page';

/** 렌더러가 보내는 스냅숏 요청과 명령을 처리한다. */
export function registerIpc(windows: AppWindows): void {
  ipcMain.handle(IPC_CHANNELS.getSnapshot, (event) => {
    assertFromAppRenderer(event);
    return currentSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.command, (event, payload: unknown) => {
    assertFromAppRenderer(event);
    const command = parseAppCommand(payload);
    if (!command) throw new Error('알 수 없는 명령입니다.');
    runCommand(windows, command);
  });
}

/** 지금 앱 상태의 스냅숏. */
function currentSnapshot(): AppSnapshot {
  return {
    appName: app.name,
    version: app.getVersion(),
    platform: process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'other',
  };
}

/** 검사를 통과한 명령을 실행한다. */
function runCommand(windows: AppWindows, command: AppCommand): void {
  switch (command.type) {
    case 'open-settings':
      windows.openSettings(command.section);
      return;
  }
}

/** 이 앱의 렌더러 화면에서 온 요청이 아니면 거절한다. */
function assertFromAppRenderer(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url;
  if (!url || !isAppRendererUrl(url)) throw new Error('앱 화면이 아닌 곳에서 온 요청입니다.');
}
