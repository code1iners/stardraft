import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import type { FlowAccount, FlowAccountState, FlowKeyCheckOutcome } from '../core/account/flow-account';
import { errorFields, type Logger } from '../core/logging/logger';
import type { FlowEmployee } from '../core/ports/flow-api';
import type { ActiveGlobalProblem, GlobalProblem, GlobalProblems } from '../core/problems/global-problems';
import {
  IPC_CHANNELS,
  parseAppCommand,
  type AppCommand,
  type AppFolder,
  type AppSnapshot,
  type FlowAccountProfile,
  type FlowAccountSnapshot,
  type GlobalProblemSnapshot,
} from '../shared/ipc';
import { appPlatform, dataFolderPath, logsFolderPath } from './app-identity';
import type { AppWindows } from './app-windows';
import { isAppRendererUrl } from './renderer-page';

/** IPC가 부르는 main의 일. */
export interface IpcServices {
  /** 작은 창과 설정 창. */
  windows: AppWindows;
  /** 진단 로그. */
  logger: Logger;
  /** "Flow 계정" 칸의 키 확인과 계정. */
  flowAccount: FlowAccount;
  /** 작은 창 띠에 보일 전역 문제. */
  globalProblems: GlobalProblems;
}

/** 렌더러가 보내는 스냅숏 요청과 명령을 처리하고, main의 상태 변경을 열린 창에 알린다. */
export function registerIpc(services: IpcServices): void {
  ipcMain.handle(IPC_CHANNELS.getSnapshot, (event) => {
    assertFromAppRenderer(event);
    return currentSnapshot(services);
  });

  ipcMain.handle(IPC_CHANNELS.command, (event, payload: unknown) => {
    assertFromAppRenderer(event);
    const command = parseAppCommand(payload);
    if (!command) throw new Error('알 수 없는 명령입니다.');
    return runCommand(services, command);
  });

  services.flowAccount.onChange((state) =>
    services.windows.broadcast({ type: 'flow-account-changed', flowAccount: flowAccountSnapshot(state) }),
  );
  services.globalProblems.onChange((current) =>
    services.windows.broadcast({ type: 'global-problem-changed', globalProblem: activeProblemSnapshot(current) }),
  );
}

/** 지금 앱 상태의 스냅숏. */
function currentSnapshot({ flowAccount, globalProblems }: IpcServices): AppSnapshot {
  return {
    appName: app.name,
    version: app.getVersion(),
    platform: appPlatform(),
    flowAccount: flowAccountSnapshot(flowAccount.state()),
    globalProblem: activeProblemSnapshot(globalProblems.current()),
  };
}

/** 검사를 통과한 명령을 실행한다. */
async function runCommand({ windows, logger, flowAccount }: IpcServices, command: AppCommand): Promise<void> {
  switch (command.type) {
    case 'open-settings':
      windows.openSettings(command.section);
      return;
    case 'open-folder':
      await openAppFolder(command.folder, logger);
      return;
    case 'check-flow-key':
      announceKeyCheckOutcome(windows, await flowAccount.checkKey(command.apiKey));
      return;
    case 'confirm-flow-account-switch':
      announceKeyCheckOutcome(windows, await flowAccount.confirmSwitch());
      return;
    case 'cancel-flow-key-check':
      flowAccount.cancelKeyCheck();
      return;
  }
}

/** 키 확인이 연결이나 실패로 끝났으면 열린 창에 알린다. 확인을 기다리거나 그만둔 경우는 상태 변경으로 충분하다. */
function announceKeyCheckOutcome(windows: AppWindows, outcome: FlowKeyCheckOutcome): void {
  if (outcome.kind === 'connected') windows.broadcast({ type: 'flow-key-check-finished', result: 'connected' });
  if (outcome.kind === 'failed') windows.broadcast({ type: 'flow-key-check-finished', result: outcome.reason });
}

/** core의 Flow 계정 상태를 렌더러에 넘길 모양으로 바꾼다. */
function flowAccountSnapshot(state: FlowAccountState): FlowAccountSnapshot {
  return {
    account: state.account && accountProfile(state.account),
    keyCheck:
      state.keyCheck.status === 'awaiting-confirmation'
        ? { status: 'awaiting-confirmation', account: accountProfile(state.keyCheck.account) }
        : { status: state.keyCheck.status },
  };
}

/** core의 전역 문제를 렌더러·트레이·알림 문구가 쓰는 모양으로 바꾼다. */
export function globalProblemSnapshot(problem: GlobalProblem): GlobalProblemSnapshot {
  return { cause: problem.cause, reason: problem.reason };
}

/** 지금 보일 전역 문제를 렌더러에 넘길 모양으로 바꾼다. 없으면 `null`. */
function activeProblemSnapshot(current: ActiveGlobalProblem | null): GlobalProblemSnapshot | null {
  return current && globalProblemSnapshot(current.problem);
}

/** 계정 카드에 보일 값. 사용자 ID는 화면에 쓰지 않으므로 렌더러에 넘기지 않는다. */
function accountProfile(account: FlowEmployee): FlowAccountProfile {
  return { name: account.name, division: account.division, email: account.email };
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
