import { app, dialog, Menu, net, safeStorage } from 'electron';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { AgentConnection } from '../core/agent/agent-connection';
import { AgentPreferences } from '../core/agent/agent-preferences';
import { NodeProcessRunner } from '../core/agent/node-process-runner';
import { FlowAccount } from '../core/account/flow-account';
import { HttpFlowApi } from '../core/flow/http-flow-api';
import { errorFields } from '../core/logging/logger';
import { LaunchAtLogin } from '../core/onboarding/launch-at-login';
import { Onboarding, type OnboardingFlowConnection } from '../core/onboarding/onboarding';
import { RepoMappings } from '../core/repos/repo-mappings';
import { WorkFolders } from '../core/repos/work-folders';
import { GlobalProblems, type ActiveGlobalProblem, type GlobalProblem } from '../core/problems/global-problems';
import { openAppData, type AppData } from '../core/storage/app-data';
import { trayIndicator } from '../core/tray-indicator';
import { globalProblemText, type GlobalProblemText } from '../shared/global-problem-text';
import { APP_ID, appPlatform, applyAppIdentity, dataFolderPath, logsFolderPath } from './app-identity';
import { createAppLogger } from './app-logger';
import { AppWindows } from './app-windows';
import { globalProblemSnapshot, registerIpc } from './ipc';
import { OsNotifier } from './os-notifier';
import { hardenRenderers } from './security';
import { systemClock } from './system-clock';
import { AppTray, type TrayView } from './tray';

/** 트레이 아이콘. 변수로 붙잡아 두지 않으면 가비지 컬렉션으로 사라진다. */
let tray: AppTray | null = null;
/** 작은 창과 설정 창. */
let windows: AppWindows | null = null;
/** 형식 검사를 마친 설정과 상태 저장소. */
let appData: AppData | null = null;

applyAppIdentity();

/** 진단 로거. 로그 폴더가 정해진 뒤에 만든다. */
const logger = createAppLogger();

// 이미 켜진 앱이 있으면 그 앱의 작은 창을 띄우고 이 실행은 끝낸다.
if (app.requestSingleInstanceLock()) {
  start();
} else {
  app.quit();
}

/** 앱을 트레이 상주 앱으로 시작한다. */
function start(): void {
  app.enableSandbox();

  app.on('second-instance', () => windows?.openPopover());
  // 트레이 앱이라 창이 모두 닫혀도 종료하지 않는다. 종료는 트레이 메뉴의 "종료"로만 한다.
  app.on('window-all-closed', () => {});
  // 끝낼 때 state.db를 닫아 WAL 내용을 본 파일에 반영한다.
  app.on('will-quit', () => {
    appData?.close();
    appData = null;
  });

  void app.whenReady().then(async () => {
    hardenRenderers();
    applyApplicationMenu();
    // 설치본은 LSUIElement로 Dock 아이콘이 없다. 소스 실행도 같게 맞춘다.
    app.dock?.hide();
    logStartup();

    appData = await openDataOrQuit();
    if (!appData) return;

    /** OS 알림. 누르면 작은 창을 띄운다. */
    const notifier = new OsNotifier(() => windows?.openPopover(), logger);
    /** 감지를 멈추게 하는 전역 문제. 알림을 누르면 띠가 보이는 작은 창을 띄운다. */
    const globalProblems = new GlobalProblems({
      notifier,
      clock: systemClock,
      logger,
      notificationFor: (problem) => {
        /** 띠와 같은 문구. */
        const text = problemText(problem);
        return { title: text.title, body: text.message };
      },
    });

    /** 설정 창 "Flow 계정" 칸의 키 확인과 계정. Flow 요청은 OS 프록시와 인증서 설정을 따르는 Chromium 네트워크로 보낸다. */
    const flowAccount = new FlowAccount({
      connectFlow: (apiKey) => new HttpFlowApi({ apiKey, fetch: net.fetch, clock: systemClock }),
      secretStore: appData.secretStore,
      stateStore: appData.stateStore,
      clock: systemClock,
      logger,
      problems: globalProblems,
    });
    await flowAccount.load();

    windows = new AppWindows(() => tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }, {
      // 설정 창을 닫으면 그 창에서 시작한 키 확인과 확인을 기다리던 계정 바꾸기를 그만둔다.
      onSettingsClosed: () => flowAccount.cancelKeyCheck(),
    });
    /** 에이전트 연결 확인. 앱을 시작할 때와 설정 "에이전트" 칸을 열 때 돈다. 실행기도 이 확인이 찾은 CLI와 환경을 쓴다. */
    const agentConnection = new AgentConnection({
      platform: process.platform,
      env: process.env,
      homeDir: app.getPath('home'),
      loginShell: loginShellPath(),
      runner: new NodeProcessRunner(),
      settingsStore: appData.settingsStore,
      logger,
      problems: globalProblems,
      checkDir: join(dataFolderPath(), 'agent-check'),
    });
    /** 설정 "에이전트" 칸의 기본 에이전트와 모델 선택. 연결된 에이전트는 연결 확인에서 읽는다. */
    const agentPreferences = new AgentPreferences({
      settingsStore: appData.settingsStore,
      logger,
      connectedAgents: () => (agentConnection.isConnected() ? [agentConnection.state().agent] : []),
    });
    await agentPreferences.load();
    /** 설정 "저장소" 칸의 작업 폴더와 "이 PC에서 찾은 폴더". */
    const workFolders = new WorkFolders({ settingsStore: appData.settingsStore, logger, homeDir: app.getPath('home') });
    await workFolders.load();
    /** 설정 "저장소" 칸의 저장소 매핑. 참여 Flow 프로젝트 목록은 지금 쓰는 키로 받는다. */
    /** 지금 쓰는 키로 Flow 연결을 만든다. 쓸 키가 없으면 `null`. */
    const connectCurrentFlow = (): OnboardingFlowConnection | null => {
      /** 지금 쓰는 키. */
      const apiKey = flowAccount.apiKey();
      if (apiKey === null) return null;
      return {
        api: new HttpFlowApi({ apiKey, fetch: net.fetch, clock: systemClock }),
        reportKeyRejected: () => flowAccount.reportKeyRejected(apiKey),
      };
    };
    const repoMappings = new RepoMappings({ settingsStore: appData.settingsStore, logger, connectFlow: connectCurrentFlow });
    await repoMappings.load();
    // 키를 처음 연결하거나 다른 계정으로 바꾸면 그 계정의 참여 Flow 프로젝트 목록을 다시 받는다.
    /** 목록을 받은 계정의 사용자 ID. */
    let projectsAccountId = flowAccount.state().account?.userId ?? null;
    flowAccount.onChange(({ account }) => {
      if ((account?.userId ?? null) === projectsAccountId) return;
      projectsAccountId = account?.userId ?? null;
      void repoMappings.refresh();
    });
    /** 설정 "일반" 칸의 로그인 시 자동 시작. [감지 시작]이 켠다. */
    const launchAtLogin = new LaunchAtLogin({ settingsStore: appData.settingsStore, logger, applyToSystem: applyLoginItem });
    await launchAtLogin.load();
    /** 필수 세 가지와 [감지 시작]. 각 칸의 모듈이 저장한 상태에서 필수 항목을 읽는다. */
    const onboarding = new Onboarding({
      settingsStore: appData.settingsStore,
      stateStore: appData.stateStore,
      notifier,
      logger,
      launchAtLogin,
      connectFlow: connectCurrentFlow,
      setupInputs: () => {
        /** 에이전트 연결 확인의 진행 상태. */
        const agentProgress = agentConnection.state().progress.status;
        return {
          keyVerified: flowAccount.state().account !== null && globalProblems.current()?.problem.cause !== 'flow-key',
          // 시작할 때 연결 확인이 돌기 전(idle)도 확인 중으로 본다.
          agent: agentProgress === 'connected' ? 'connected' : agentProgress === 'failed' ? 'not-connected' : 'checking',
          workFolderCount: workFolders.state().folders.length,
        };
      },
    });
    await onboarding.load();
    // 필수 세 가지의 입력이 바뀔 때마다 온보딩 상태를 다시 본다.
    /** 온보딩 상태를 다시 본다. */
    const refreshOnboarding = () => onboarding.refresh();
    flowAccount.onChange(refreshOnboarding);
    globalProblems.onChange(refreshOnboarding);
    agentConnection.onChange(refreshOnboarding);
    workFolders.onChange(refreshOnboarding);
    registerIpc({
      windows,
      logger,
      flowAccount,
      globalProblems,
      agentConnection,
      agentPreferences,
      workFolders,
      repoMappings,
      onboarding,
      launchAtLogin,
    });
    // 폴더 훑기는 시작을 늦추지 않게 기다리지 않는다. 훑는 대로 열린 창에 알린다.
    // 참여 Flow 프로젝트 목록은 "저장소" 칸을 열 때 받는다.
    void workFolders.refresh();

    /** 트레이 동작이 부를 창 관리자. 콜백 안에서 `null` 검사를 하지 않으려고 지역 상수로 잡는다. */
    const appWindows = windows;
    /** 만든 트레이. 전역 문제를 따라 표시를 바꿀 때 `null` 검사를 하지 않으려고 지역 상수로 잡는다. */
    const appTray = new AppTray({
      togglePopover: () => appWindows.togglePopover(),
      openPopover: () => appWindows.openPopover(),
      openSettings: (section) => appWindows.openSettings(section),
      quit: () => app.quit(),
    });
    tray = appTray;
    /** 전역 문제와 감지 시작 여부에 맞춰 트레이 표시를 바꾼다. */
    const refreshTray = () => appTray.show(trayView(globalProblems.current(), !onboarding.state().detectionStarted));
    refreshTray();
    globalProblems.onChange(refreshTray);
    onboarding.onChange(refreshTray);
    // 감지를 시작하기 전이면 첫 실행처럼 필수 설정 전 작은 창을 트레이 옆에 띄운다. 메뉴 막대 앱이라 창이 없으면 앱을 놓친다.
    if (!onboarding.state().detectionStarted) appWindows.openPopover();

    // 저장된 키는 트레이를 띄운 뒤에 읽는다. 업데이트 뒤에는 키체인 재허용을 묻고 답할 때까지 끝나지 않기 때문이다.
    flowAccount.checkStoredKey().catch((error: unknown) => logger.error('flow-account.stored-key-check-failed', errorFields(error)));
    // 앱을 시작할 때 에이전트 연결을 확인한다(작동 확인 포함). 끊겨 있으면 전역 문제가 트레이에 뜬다. 실패도 상태로 남기고 던지지 않는다.
    void agentConnection.check();
  });
}

/** 사용자의 로그인 셸. Finder에서 켠 앱도 `$SHELL`을 받지만, 없으면 계정 정보의 셸을 쓴다. */
function loginShellPath(): string {
  if (process.env.SHELL) return process.env.SHELL;
  try {
    return userInfo().shell ?? '/bin/zsh';
  } catch {
    return '/bin/zsh';
  }
}

/** 전역 문제와 감지 시작 여부에 맞춘 트레이 표시. 검토 대기 수는 멘션 묶음을 더하는 티켓이 넘긴다. */
function trayView(current: ActiveGlobalProblem | null, setupNeeded: boolean): TrayView {
  return {
    indicator: trayIndicator({ hasGlobalProblem: current !== null, reviewCount: 0, setupNeeded }),
    problem: current && problemText(current.problem),
  };
}

/**
 * OS 로그인 항목에 이 앱을 등록하거나 뺀다.
 * 소스 실행은 Electron 실행 파일이 등록되므로 바꾸지 않고 로그만 남긴다. 설정에는 그대로 저장한다.
 */
function applyLoginItem(enabled: boolean): void {
  if (!app.isPackaged) {
    logger.info('launch-at-login.skipped-in-dev', { enabled });
    return;
  }
  app.setLoginItemSettings({ openAtLogin: enabled });
}

/** 작은 창 띠와 같은 전역 문제 문구. 트레이 메뉴와 OS 알림에 쓴다. */
function problemText(problem: GlobalProblem): GlobalProblemText {
  return globalProblemText(globalProblemSnapshot(problem), appPlatform());
}

/** 시작할 때 버전과 폴더 위치를 로그에 남긴다. macOS는 업데이트 설치 기록(ShipIt 로그) 위치도 남긴다. */
function logStartup(): void {
  logger.info('app.started', {
    appName: app.name,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    dataDir: dataFolderPath(),
    logsDir: logsFolderPath(),
    shipItLogDir: process.platform === 'darwin' ? join(app.getPath('home'), 'Library', 'Caches', `${APP_ID}.ShipIt`) : null,
  });
}

/**
 * 데이터 폴더를 연다. 더 새 버전의 데이터이거나 열 수 없으면 안내 창을 띄우고 앱을 끝낸다.
 * 어느 경우에도 데이터는 지우지 않는다.
 */
async function openDataOrQuit(): Promise<AppData | null> {
  try {
    /** 데이터 폴더를 연 결과. */
    // 키는 safeStorage의 비동기 API로만 암호화한다. 푸는 열쇠는 macOS 키체인 항목(앱 이름 + " Safe Storage")이나 Windows DPAPI에 있다.
    const result = await openAppData({ dataDir: dataFolderPath(), appVersion: app.getVersion(), logger, encryption: safeStorage });
    if (result.kind === 'ready') return result;
    await showStartupProblem(result.message);
  } catch (error) {
    await showStartupProblem(
      '데이터를 열 수 없어 Stardraft를 시작하지 못했습니다.',
      `데이터 폴더: ${dataFolderPath()}\n로그 폴더: ${logsFolderPath()}\n\n${errorFields(error).errorMessage ?? ''}`,
    );
  }
  app.quit();
  return null;
}

/** 시작을 막는 문제를 창으로 알린다. 메뉴 막대 앱이라 창이 다른 앱 뒤에 숨지 않게 앞으로 가져온다. */
async function showStartupProblem(message: string, detail?: string): Promise<void> {
  app.focus({ steal: true });
  await dialog.showMessageBox({
    type: 'warning',
    title: app.name,
    message,
    ...(detail ? { detail } : {}),
    buttons: ['종료'],
    noLink: true,
  });
}

/**
 * 앱 메뉴를 정한다. 기본 메뉴의 새로고침·개발자 도구 단축키를 없앤다.
 * macOS는 입력 칸의 복사·붙여넣기 단축키가 메뉴를 거치므로 편집 메뉴를 남긴다.
 */
function applyApplicationMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]));
}
