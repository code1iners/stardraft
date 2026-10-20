import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import { errorFields, type Logger } from '../core/logging/logger';
import { IPC_CHANNELS, parseAppCommand, type AppCommand, type AppFolder, type AppSnapshot } from '../shared/ipc';
import { dataFolderPath, logsFolderPath } from './app-identity';
import type { AppWindows } from './app-windows';
import { isAppRendererUrl } from './renderer-page';

/** 렌더러가 보내는 스냅숏 요청과 명령을 처리한다. */
export function registerIpc(windows: AppWindows, logger: Logger): void {
  ipcMain.handle(IPC_CHANNELS.getSnapshot, (event) => {
    assertFromAppRenderer(event);
    return currentSnapshot();
  });

  ipcMain.handle(IPC_CHANNELS.command, (event, payload: unknown) => {
    assertFromAppRenderer(event);
    const command = parseAppCommand(payload);
    if (!command) throw new Error('알 수 없는 명령입니다.');
    return runCommand(windows, logger, command);
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
async function runCommand(windows: AppWindows, logger: Logger, command: AppCommand): Promise<void> {
  switch (command.type) {
    case 'open-settings':
      windows.openSettings(command.section);
      return;
    case 'open-folder':
      await openAppFolder(command.folder, logger);
      return;
  }
}

/** 데이터 폴더나 로그 폴더를 OS 파일 관리자로 연다. 아직 없으면 만들어서 연다. */
async function openAppFolder(folder: AppFolder, logger: Logger): Promise<void> {
  /** 열 폴더 경로. */
  const path = folder === 'data' ? dataFolderPath() : logsFolderPath();
  try {
    await mkdir(path, { recursive: true });
    /** 실패했을 때 OS가 돌려준 오류 문구. 성공하면 빈 문자열이다. */
    const failure = await shell.openPath(path);
    if (failure) logger.warn('folder.open-failed', { folder, errorMessage: failure });
  } catch (error) {
    logger.warn('folder.open-failed', { folder, ...errorFields(error) });
  }
}

/** 이 앱의 렌더러 화면에서 온 요청이 아니면 거절한다. */
function assertFromAppRenderer(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url;
  if (!url || !isAppRendererUrl(url)) throw new Error('앱 화면이 아닌 곳에서 온 요청입니다.');
}
