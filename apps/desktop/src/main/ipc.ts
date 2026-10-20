import { app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import { mkdir } from 'node:fs/promises';
import type { AgentConnection, AgentConnectionState } from '../core/agent/agent-connection';
import type { AgentPreferences, AgentPreferencesState } from '../core/agent/agent-preferences';
import type { FlowAccount, FlowAccountState, FlowKeyCheckOutcome } from '../core/account/flow-account';
import { errorFields, type Logger } from '../core/logging/logger';
import type { FlowEmployee } from '../core/ports/flow-api';
import type { ActiveGlobalProblem, GlobalProblem, GlobalProblems } from '../core/problems/global-problems';
import { agentFixCommand } from '../shared/agent-fix-command';
import {
  IPC_CHANNELS,
  parseAppCommand,
  type AgentConnectionSnapshot,
  type AgentPreferencesSnapshot,
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
  /** "에이전트" 칸의 연결 확인. */
  agentConnection: AgentConnection;
  /** "에이전트" 칸의 기본 에이전트와 모델 선택. */
  agentPreferences: AgentPreferences;
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
  /** 기본 에이전트와 모델 선택을 열린 창에 알린다. */
  const broadcastPreferences = () =>
    services.windows.broadcast({
      type: 'agent-preferences-changed',
      agentPreferences: agentPreferencesSnapshot(services.agentPreferences.state()),
    });
  services.agentConnection.onChange((state) => {
    services.windows.broadcast({ type: 'agent-connection-changed', agentConnection: agentConnectionSnapshot(state) });
    // 연결되거나 끊기면 연결된 에이전트와 모델 선택 상자도 바뀐다.
    broadcastPreferences();
  });
  services.agentPreferences.onChange(broadcastPreferences);
}

/** 지금 앱 상태의 스냅숏. */
function currentSnapshot({ flowAccount, globalProblems, agentConnection, agentPreferences }: IpcServices): AppSnapshot {
  return {
    appName: app.name,
    version: app.getVersion(),
    platform: appPlatform(),
    flowAccount: flowAccountSnapshot(flowAccount.state()),
    globalProblem: activeProblemSnapshot(globalProblems.current()),
    agentConnection: agentConnectionSnapshot(agentConnection.state()),
    agentPreferences: agentPreferencesSnapshot(agentPreferences.state()),
  };
}

/** 검사를 통과한 명령을 실행한다. */
async function runCommand(
  { windows, logger, flowAccount, agentConnection, agentPreferences }: IpcServices,
  command: AppCommand,
): Promise<void> {
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
    case 'check-agent':
      await agentConnection.check();
      return;
    case 'rediscover-agent':
      await agentConnection.rediscover();
      return;
    case 'pick-agent-cli':
      await pickAgentCli(windows, agentConnection);
      return;
    case 'copy-agent-fix-command':
      copyAgentFixCommand(agentConnection);
      return;
    case 'set-default-agent':
      await agentPreferences.setDefaultAgent(command.agent);
      return;
    case 'set-agent-model':
      await agentPreferences.setModel(command.agent, command.model);
      return;
  }
}

/** 파일 선택 창으로 CLI를 받아 확인한다. 고르지 않고 닫으면 아무 일도 하지 않는다. */
async function pickAgentCli(windows: AppWindows, agentConnection: AgentConnection): Promise<void> {
  /** 파일 선택 창 설정. macOS는 `~/.local` 같은 숨김 폴더도 고를 수 있게 한다. */
  const options: OpenDialogOptions = {
    title: 'Claude Code CLI 직접 지정',
    buttonLabel: '선택',
    properties: ['openFile', 'showHiddenFiles'],
    ...(process.platform === 'win32' ? { filters: [{ name: 'Claude Code CLI', extensions: ['exe', 'cmd'] }] } : {}),
  };
  /** 설정 창. 있으면 그 위에 시트로 띄운다. */
  const parent = windows.settingsWindow();
  /** 고른 결과. */
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  /** 고른 파일. */
  const [picked] = result.filePaths;
  if (result.canceled || picked === undefined) return;
  await agentConnection.useCliPath(picked);
}

/** 지금 실패 카드의 명령을 클립보드에 넣는다. 명령으로 고칠 실패가 아니면 아무 일도 하지 않는다. */
function copyAgentFixCommand(agentConnection: AgentConnection): void {
  /** 지금 연결 상태. */
  const { progress, details } = agentConnection.state();
  if (progress.status !== 'failed') return;
  /** 복사할 명령. */
  const command = agentFixCommand(progress.failure, details, appPlatform());
  if (command) clipboard.writeText(command);
}

/** core의 에이전트 연결 상태를 렌더러에 넘길 모양으로 바꾼다. */
function agentConnectionSnapshot(state: AgentConnectionState): AgentConnectionSnapshot {
  return { progress: state.progress, details: { ...state.details, searchedDirs: [...state.details.searchedDirs] } };
}

/** core의 기본 에이전트와 모델 선택을 렌더러에 넘길 모양으로 바꾼다. */
function agentPreferencesSnapshot(state: AgentPreferencesState): AgentPreferencesSnapshot {
  return {
    connectedAgents: [...state.connectedAgents],
    defaultAgent: state.defaultAgent,
    models: Object.fromEntries(
      Object.entries(state.models).map(([agent, choice]) => [agent, { options: choice.options.map((option) => ({ ...option })), selected: choice.selected }]),
    ),
  };
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
  return problem.cause === 'agent' ? { cause: 'agent', reason: problem.reason } : { cause: 'flow-key', reason: problem.reason };
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
