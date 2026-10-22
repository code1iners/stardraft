import { app, dialog, Menu, net, powerMonitor, safeStorage } from 'electron';
import { autoUpdater } from 'electron-updater';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { AgentConnections } from '../core/agent/agent-connections';
import { AgentPreferences } from '../core/agent/agent-preferences';
import { NodeProcessRunner } from '../core/agent/node-process-runner';
import { FlowAccount } from '../core/account/flow-account';
import { MentionBundles } from '../core/bundles/mention-bundles';
import { BundleRetention } from '../core/bundles/retention';
import { EditorOpener } from '../core/editors/editor-opener';
import { collectBundleContext } from '../core/flow/bundle-context';
import { MentionDetection } from '../core/detection/mention-detection';
import { draftAgentFrom, DraftQueue } from '../core/drafts/draft-queue';
import { DraftSettings } from '../core/drafts/draft-settings';
import { HttpFlowApi } from '../core/flow/http-flow-api';
import { MentionJudge } from '../core/flow/mention-judgement';
import { errorFields } from '../core/logging/logger';
import { LaunchAtLogin } from '../core/onboarding/launch-at-login';
import { Onboarding } from '../core/onboarding/onboarding';
import { Posting } from '../core/posting/posting';
import type { FlowConnection } from '../core/ports/flow-api';
import { findSelectionScope } from '../core/repos/repo-candidates';
import { RepoMappings } from '../core/repos/repo-mappings';
import { RepoPicker } from '../core/repos/repo-picker';
import { WorkFolders } from '../core/repos/work-folders';
import { GlobalProblems, type ActiveGlobalProblem, type GlobalProblem } from '../core/problems/global-problems';
import { TrialRun } from '../core/trial/trial-run';
import { openAppData, type AppData } from '../core/storage/app-data';
import { MigrationBackups } from '../core/storage/migration-backups';
import { trayIndicator, type TrayIndicatorInput } from '../core/tray-indicator';
import { InAppUpdate } from '../core/update/in-app-update';
import { UpdateRestart } from '../core/update/update-restart';
import { checkInstallLocation, macBundlePathOf, type BlockedLocationReason } from '../core/update/install-location';
import { UPDATE_PUBLIC_KEYS } from '../core/update/update-public-keys.mts';
import { globalProblemText, type GlobalProblemText } from '../shared/global-problem-text';
import { updateMenuItem } from '../shared/update-text';
import { APP_ID, appPlatform, applyAppIdentity, dataFolderPath, logsFolderPath } from './app-identity';
import { createAppLogger } from './app-logger';
import { AppWindows } from './app-windows';
import { editorSystem } from './editor-system';
import { globalProblemSnapshot, openSite, registerIpc } from './ipc';
import { OsNotifier } from './os-notifier';
import { ReviewSections } from './review-sections';
import { hardenRenderers } from './security';
import { systemClock } from './system-clock';
import { AppTray, type TrayView } from './tray';
import { electronUpdateFeed } from './update-feed';

/** 트레이 아이콘. 변수로 붙잡아 두지 않으면 가비지 컬렉션으로 사라진다. */
let tray: AppTray | null = null;
/** 작은 창과 설정 창. */
let windows: AppWindows | null = null;
/** 형식 검사를 마친 설정과 상태 저장소. */
let appData: AppData | null = null;
/** 멘션 묶음. 끝낼 때 맡긴 저장(편집기 내용 등)이 끝나기를 기다린다. */
let bundles: MentionBundles | null = null;
/** 멘션 감지. 끝낼 때 폴링을 멈춘다. */
let detection: MentionDetection | null = null;
/** 초안 대기열. 끝낼 때 실행 중인 에이전트의 프로세스 트리를 끝낸다. */
let drafts: DraftQueue | null = null;
/** 게시. 끝낼 때 카운트다운을 멈춘다. */
let posting: Posting | null = null;
/** 처리됨 목록 정리. 끝낼 때 다음 정리를 멈춘다. */
let retention: BundleRetention | null = null;
/** 앱 내 업데이트. 끝낼 때 다음 확인을 멈춘다. 소스 실행에서는 없다. */
let appUpdate: InAppUpdate | null = null;
/** 앱 내 업데이트의 다시 시작. 작은 창이 닫히면 다시 시작 확인 화면을 거둔다. 소스 실행에서는 없다. */
let appRestart: UpdateRestart | null = null;
/** 마이그레이션 전 사본 정리. 끝낼 때 다음 정리를 멈춘다. */
let migrationBackups: MigrationBackups | null = null;

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
  /** 끝내기 전 정리의 단계. 정리를 마치면 종료를 더 막지 않는다. */
  let quitStage: 'running' | 'preparing' | 'prepared' = 'running';
  // 확인 창 없이 끝내되, 끊을 일을 정리할 때까지 종료를 미룬다. 정리하는 사이에 다시 끝내려 해도 한 번만 정리하고, 마치면 다시 끝낸다.
  app.on('before-quit', (event) => {
    if (quitStage === 'prepared') return;
    event.preventDefault();
    if (quitStage === 'preparing') return;
    quitStage = 'preparing';
    void prepareQuit().finally(() => {
      quitStage = 'prepared';
      app.quit();
    });
  });
  // 정리를 마친 뒤 state.db를 닫아 WAL 내용을 본 파일에 반영한다.
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

    /** OS 알림. 누르면 작은 창을 띄우고, 알림이 가리키는 멘션 묶음이 있으면 그 묶음을 연다. */
    const notifier = new OsNotifier((bundleId) => windows?.openPopover(bundleId), logger);
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

    /** 작은 창과 설정 창. 콜백 안에서 `null` 검사를 하지 않으려고 지역 상수로도 잡는다. */
    const appWindows = new AppWindows(() => tray?.getBounds() ?? { x: 0, y: 0, width: 0, height: 0 }, {
      // 설정 창을 닫으면 그 창에서 시작한 키 확인과 확인을 기다리던 계정 바꾸기를 그만둔다.
      onSettingsClosed: () => flowAccount.cancelKeyCheck(),
      // 다시 시작 확인 화면을 띄운 작은 창을 닫으면 [나중에]와 같다.
      onPopoverClosed: () => appRestart?.cancelConfirm(),
    });
    windows = appWindows;
    /**
     * 에이전트 연결 확인. 이 OS의 후보 에이전트(macOS는 Claude Code와 Codex, Windows는 Claude Code)마다 하나씩 두고,
     * 앱을 시작할 때와 설정 "에이전트" 칸을 열 때 돈다. 실행기도 각 확인이 찾은 CLI와 환경을 쓴다.
     */
    const agentConnections = new AgentConnections({
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
      connectedAgents: () => agentConnections.connectedAgents(),
      listedModels: (agent) => agentConnections.models(agent),
    });
    await agentPreferences.load();
    /** 설정 "저장소" 칸의 작업 폴더와 "이 PC에서 찾은 폴더". */
    const workFolders = new WorkFolders({ settingsStore: appData.settingsStore, logger, homeDir: app.getPath('home') });
    await workFolders.load();
    /** 설정 "저장소" 칸의 저장소 매핑. 참여 Flow 프로젝트 목록은 지금 쓰는 키로 받는다. */
    /** 지금 쓰는 키로 Flow 연결을 만든다. 쓸 키가 없으면 `null`. */
    const connectCurrentFlow = (): FlowConnection | null => {
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
    /** 감지한 멘션 묶음. 작은 창 대기열, 펼친 창 목록, 트레이 표시, 초안 준비됨·저장소 확인 필요 OS 알림이 따른다. */
    const mentionBundles = new MentionBundles({
      stateStore: appData.stateStore,
      notifier,
      clock: systemClock,
      logger,
      // 이미 답함에서 되돌릴 때 그때 Flow에 있는 내 답을 지금 키로 조회한다.
      findMyAnswers: async (place) => {
        /** 지금 키로 만든 Flow 연결. */
        const flow = connectCurrentFlow();
        /** 키 확인에 성공한 계정. */
        const account = flowAccount.state().account;
        if (!flow || !account) return null;
        return new MentionJudge(flow.api, account.userId).myAnswers(place, [account.userId]);
      },
      // 초안을 만들거나 변화를 감시할 묶음의 맥락과 묶음 자리의 내 답을 지금 키로 새로 조회한다.
      collectContext: async (bundle) => {
        /** 지금 키로 만든 Flow 연결. */
        const flow = connectCurrentFlow();
        /** 키 확인에 성공한 계정. 내 답을 찾을 때 쓴다. */
        const account = flowAccount.state().account;
        if (!flow || !account) return null;
        /** 조회한 결과. */
        const result = await collectBundleContext(flow.api, bundle, systemClock.now(), [account.userId]);
        if (!result.ok && result.failure.kind === 'unauthorized') flow.reportKeyRejected();
        return result;
      },
      resolveRepos: (projectId) => repoMappings.resolve(projectId),
    });
    await mentionBundles.load();
    bundles = mentionBundles;
    // 앱이 꺼지며 끊긴 묶음을 정리한다. 카운트다운 중이던 게시는 준비됨으로 돌리고, 진행 중이던 시험 묶음은 지운다.
    await mentionBundles.recoverAfterRestart().catch((error: unknown) => logger.error('bundle.restart-recovery-failed', errorFields(error)));
    // 처리한 지 7일이 된 묶음을 지금 정리하고, 그 뒤 하루에 한 번 정리한다.
    retention = new BundleRetention({ bundles: mentionBundles, clock: systemClock, logger });
    retention.start();
    /**
     * 초안 대기열. 생성 중 묶음을 기본 에이전트로 하나씩 실행한다. 실행마다 직전에 CLI 버전을 확인하고,
     * 에이전트 연결이 없거나 전역 실패면 연결될 때까지 멈춘다.
     */
    const draftQueue = new DraftQueue({
      bundles: mentionBundles,
      // 연결된 에이전트가 없으면 기본 에이전트가 없어 기다린다.
      agent: () => draftAgentFrom(agentPreferences.state(), agentConnections.all),
      onAgentChange: (listener) => unsubscribeAll([agentConnections.onChange(listener), agentPreferences.onChange(listener)]),
      // "키 확인 필요"인 동안은 맥락을 조회할 수 없어 대기열을 멈춘다. 키를 다시 넣어 풀리면 다시 돈다.
      flowKeyUsable: () => flowAccount.apiKey() !== null && !globalProblems.has('flow-key'),
      onFlowKeyChange: (listener) => unsubscribeAll([globalProblems.onChange(listener), flowAccount.onChange(listener)]),
      settingsStore: appData.settingsStore,
      // 대기열을 바뀔 때마다 남겨, 앱이 꺼진 뒤 다시 켤 때 그 순서와 자리로 돈다.
      stateStore: appData.stateStore,
      myName: () => flowAccount.state().account?.name || null,
      projectTitle: (projectId) => repoMappings.projectTitle(projectId),
      clock: systemClock,
      logger,
    });
    drafts = draftQueue;
    /** 설정 "초안" 칸의 추가 지침과 비밀 파일 패턴. 패턴을 추가하면 실행 중인 실행을 다시 돌리고 게시하지 않은 초안을 다시 검사한다. */
    const draftSettings = new DraftSettings({ settingsStore: appData.settingsStore, logger, drafts: draftQueue, bundles: mentionBundles });
    await draftSettings.load();
    /** 저장소 선택 창. "저장소를 골라 만들기"와 "다른 저장소로 다시 만들기"가 같이 쓴다. 창을 열 때마다 설정의 작업 폴더를 새로 훑는다. */
    const repoPicker = new RepoPicker({
      bundle: (bundleId) => mentionBundles.get(bundleId),
      mappings: repoMappings,
      findWorkFolderRepos: async () => (await findSelectionScope((await appData!.settingsStore.load()).workFolders)).candidates,
      regenerate: (bundleId, repos) => draftQueue.regenerateWithRepos(bundleId, repos),
    });
    mentionBundles.onChange(() => repoPicker.bundlesChanged());
    /** [게시]. 5초 카운트다운 뒤 지금 키로 묶음 자리에 댓글이나 대댓글을 단다. */
    const bundlePosting = new Posting({
      bundles: mentionBundles,
      connectFlow: connectCurrentFlow,
      myUserId: () => flowAccount.state().account?.userId ?? null,
      clock: systemClock,
      logger,
    });
    posting = bundlePosting;
    // 키를 처음 연결하거나 다른 계정으로 바꾸면 그 계정의 참여 Flow 프로젝트 목록을 다시 받는다.
    // 다른 계정으로 바꾸며 기록을 비웠으면 옛 계정의 묶음이 남아 보이지 않게 묶음도 다시 읽는다.
    /** 목록을 받은 계정의 사용자 ID. */
    let projectsAccountId = flowAccount.state().account?.userId ?? null;
    flowAccount.onChange(({ account }) => {
      if ((account?.userId ?? null) === projectsAccountId) return;
      projectsAccountId = account?.userId ?? null;
      void repoMappings.refresh();
      void mentionBundles.load();
    });
    /** 설정 "일반" 칸의 로그인 시 자동 시작. [감지 시작]이 켠다. */
    const launchAtLogin = new LaunchAtLogin({ settingsStore: appData.settingsStore, logger, applyToSystem: applyLoginItem });
    await launchAtLogin.load();
    /** 근거의 "에디터에서 열기". 기억한 에디터를 읽고 이 PC의 에디터를 찾아 둔다. */
    const editorOpener = new EditorOpener({ settingsStore: appData.settingsStore, logger, system: editorSystem() });
    void editorOpener.refresh().catch((error: unknown) => logger.warn('editor.refresh-failed', errorFields(error)));
    /** 필수 세 가지와 [감지 시작]. 각 칸의 모듈이 저장한 상태에서 필수 항목을 읽는다. */
    const onboarding = new Onboarding({
      settingsStore: appData.settingsStore,
      stateStore: appData.stateStore,
      notifier,
      logger,
      launchAtLogin,
      connectFlow: connectCurrentFlow,
      // 설정 창을 닫을 때 Dock 아이콘을 숨기므로, 작은 창은 설정 창이 다 닫힌 뒤에 띄운다.
      showDetectionStarted: async () => {
        await appWindows.closeSettings();
        appWindows.openPopover();
      },
      setupInputs: () => ({
        keyVerified: flowAccount.state().account !== null && !globalProblems.has('flow-key'),
        // 하나라도 연결되면 연결됨이다. 시작할 때 연결 확인이 돌기 전도 확인 중으로 본다.
        agent: agentConnections.setupStatus(),
        workFolderCount: workFolders.state().folders.length,
      }),
    });
    await onboarding.load();
    // 필수 세 가지의 입력이 바뀔 때마다 온보딩 상태를 다시 본다.
    /** 온보딩 상태를 다시 본다. */
    const refreshOnboarding = () => onboarding.refresh();
    flowAccount.onChange(refreshOnboarding);
    globalProblems.onChange(refreshOnboarding);
    agentConnections.onChange(refreshOnboarding);
    workFolders.onChange(refreshOnboarding);
    /** 최근 멘션으로 시험. 감지를 시작한 뒤 지금 키로 최근 멘션을 불러오고, 고른 멘션으로 시험 묶음을 만든다. */
    const trialRun = new TrialRun({
      bundles: mentionBundles,
      connectFlow: connectCurrentFlow,
      myUserId: () => flowAccount.state().account?.userId ?? null,
      detectionStarted: () => onboarding.state().detectionStarted,
      projectTitle: (projectId) => repoMappings.projectTitle(projectId),
      clock: systemClock,
      logger,
    });
    /**
     * 앱 내 업데이트. 공개 Release에서 새 버전을 확인해 받고, 서명을 확인한 뒤 설치 준비됨으로 둔다.
     * 소스에서 실행할 때는 끈다. electron-updater도 설치본에서만 확인한다.
     */
    const updateFeed = app.isPackaged ? electronUpdateFeed(autoUpdater, logger) : null;
    const inAppUpdate = updateFeed
      ? new InAppUpdate({
          feed: updateFeed,
          currentVersion: app.getVersion(),
          publicKeys: UPDATE_PUBLIC_KEYS,
          checkLocation: checkAppLocation,
          stateStore: appData.stateStore,
          clock: systemClock,
          logger,
        })
      : null;
    appUpdate = inAppUpdate;
    /**
     * 앱 내 업데이트의 다시 시작. 사용자가 [다시 시작]을 누를 때만 설치한다. macOS는 먼저 작은 창에 확인 화면을 띄우고,
     * 에이전트 실행·게시 카운트다운·게시 요청이 끝날 때까지 미룬다. 켤 때 앞선 업데이트 시도로 설치 실패와 업데이트 직후 첫 실행을 정한다.
     */
    const updateRestart =
      updateFeed && inAppUpdate
        ? new UpdateRestart({
            update: inAppUpdate,
            feed: updateFeed,
            currentVersion: app.getVersion(),
            confirmsBeforeRestart: process.platform === 'darwin',
            activity: {
              blockers: () => ({ drafting: draftQueue.isRunning(), posting: bundlePosting.isActive() }),
              onChange: (listener) => unsubscribeAll([draftQueue.onChange(listener), bundlePosting.onChange(listener)]),
              holdDrafts: (held) => draftQueue.holdForRestart(held),
            },
            // 편집기 내용은 바뀔 때마다 묶음에 맡겨 저장하므로, 맡긴 저장이 끝나기를 기다린다.
            saveEdits: () => mentionBundles.whenIdle(),
            stateStore: appData.stateStore,
            clock: systemClock,
            logger,
          })
        : null;
    await updateRestart?.load();
    appRestart = updateRestart;
    // 메뉴나 설정 창에서 [다시 시작]을 눌러도 확인 화면은 작은 창에 띄운다. 메뉴 막대 앱이라 앞으로 가져와야 작은 창이 바로 닫히지 않는다.
    /** 작은 창에 띄운 확인 화면의 버전. 같은 확인 화면을 거듭 띄우지 않으려고 둔다. */
    let shownConfirm: string | null = null;
    updateRestart?.onChange(({ restartConfirm }) => {
      if (restartConfirm && restartConfirm !== shownConfirm) {
        if (process.platform === 'darwin') app.focus({ steal: true });
        appWindows.openPopover();
      }
      shownConfirm = restartConfirm;
    });
    registerIpc({
      windows: appWindows,
      logger,
      flowAccount,
      globalProblems,
      agentConnections,
      agentPreferences,
      workFolders,
      repoMappings,
      onboarding,
      launchAtLogin,
      bundles: mentionBundles,
      drafts: draftQueue,
      posting: bundlePosting,
      repoPicker,
      reviewSections: new ReviewSections(),
      editorOpener,
      trialRun,
      draftSettings,
      notifier,
      inAppUpdate,
      updateRestart,
    });
    /**
     * 알림 폴링과 멘션 판정. 감지를 시작한 뒤 쓸 수 있는 키가 있을 때만 돈다. 판정을 통과한 멘션은 멘션 묶음에 넣고,
     * 폴링마다 사용자 행동을 기다리는 묶음의 Flow 내용을 다시 조회한다(준비된 뒤의 변화 감시).
     */
    const mentionDetection = new MentionDetection({
      stateStore: appData.stateStore,
      bundles: mentionBundles,
      clock: systemClock,
      logger,
      connectFlow: connectCurrentFlow,
    });
    detection = mentionDetection;
    /** 폴링을 마지막으로 시작한 키. 같은 키로 거듭 시작하지 않으려고 둔다. */
    let detectionKey: string | null = null;
    /**
     * 감지를 시작했고 쓸 수 있는 키가 있으면 폴링을 시작한다. [감지 시작] 직후, 앱 시작 때 저장된 키를 읽은 뒤,
     * 키를 새로 확인했을 때(다른 계정이면 기준점을 다시 잡음), "키 확인 필요"가 풀렸을 때 바로 조회하며 시작한다.
     */
    const syncDetection = () => {
      /** 지금 쓰는 키. "키 확인 필요"가 있으면 쓰지 않는다. */
      const apiKey = globalProblems.has('flow-key') ? null : flowAccount.apiKey();
      if (!onboarding.state().detectionStarted || apiKey === null) {
        detectionKey = null;
        return;
      }
      if (apiKey === detectionKey) return;
      detectionKey = apiKey;
      void mentionDetection.start();
    };
    onboarding.onChange(syncDetection);
    flowAccount.onChange(syncDetection);
    globalProblems.onChange(syncDetection);
    // 잠자기에서 깨어나면 밀린 멘션을 바로 조회하고, 잠든 동안 멈춘 하루 타이머 대신 처리됨 목록도 정리한다.
    // 앱 내 업데이트는 마지막 확인이 4시간보다 오래됐을 때만 바로 확인한다.
    powerMonitor.on('resume', () => {
      void mentionDetection.checkNow();
      retention?.cleanUpNow();
      void inAppUpdate?.checkIfDue();
    });

    // 폴더 훑기는 시작을 늦추지 않게 기다리지 않는다. 훑는 대로 열린 창에 알린다.
    // 참여 Flow 프로젝트 목록은 "저장소" 칸을 열 때 받는다.
    void workFolders.refresh();

    /** 만든 트레이. 전역 문제를 따라 표시를 바꿀 때 `null` 검사를 하지 않으려고 지역 상수로 잡는다. */
    const appTray = new AppTray({
      togglePopover: () => appWindows.togglePopover(),
      openPopover: () => appWindows.openPopover(),
      openSettings: (section) => appWindows.openSettings(section),
      checkNow: () => void mentionDetection.checkNow(),
      runUpdateAction: (action) => {
        switch (action) {
          case 'restart':
            void updateRestart?.requestRestart();
            return;
          case 'open-popover':
            appWindows.openPopover();
            return;
          case 'open-site':
            void openSite('update', logger);
            return;
        }
      },
      quit: () => app.quit(),
    });
    tray = appTray;
    // 업데이트 상태는 메뉴 항목으로만 보이고 아이콘은 바꾸지 않는다.
    /** 메뉴의 업데이트 항목을 지금 상태에 맞춘다. */
    const refreshUpdateItem = () => appTray.setUpdateItem(updateRestart && updateMenuItem(updateRestart.state().status));
    refreshUpdateItem();
    updateRestart?.onChange(refreshUpdateItem);
    /** 전역 문제, 감지 시작 여부, 묶음 상태(검토 대기 수, 실패·게시 실패, 생성 중)에 맞춰 트레이 표시를 바꾼다. */
    const refreshTray = () =>
      appTray.show(
        trayView(globalProblems.current(), {
          setupNeeded: !onboarding.state().detectionStarted,
          reviewCount: mentionBundles.reviewCount(),
          hasFailure: mentionBundles.hasFailure(),
          generating: mentionBundles.idsWithStatus('generating').length > 0,
        }),
      );
    refreshTray();
    globalProblems.onChange(refreshTray);
    onboarding.onChange(refreshTray);
    mentionBundles.onChange(refreshTray);
    // 감지를 시작하기 전이면 첫 실행처럼 필수 설정 전 작은 창을 트레이 옆에 띄운다. 메뉴 막대 앱이라 창이 없으면 앱을 놓친다.
    // 앱이 앞에 오지 않은 채 열면 작은 창이 포커스를 잃어 바로 닫히므로, 사용자가 직접 켠 이 경우에는 앞으로 가져온다.
    if (!onboarding.state().detectionStarted) {
      if (process.platform === 'darwin') app.focus({ steal: true });
      appWindows.openPopover();
    }

    // 저장된 키는 트레이를 띄운 뒤에 읽는다. 업데이트 뒤에는 키체인 재허용을 묻고 답할 때까지 끝나지 않기 때문이다.
    // 키를 읽으면 감지를 시작한 앱은 바로 알림을 조회한다.
    // 초안 대기열도 키를 읽은 뒤에 시작한다. 키를 읽었다는 알림은 따로 없고, 읽기 전에는 맥락을 조회할 수 없기 때문이다.
    // 키를 읽지 못했으면 "키 확인 필요"가 풀릴 때까지 대기열은 멈춰 있다.
    // 응답을 받지 못하고 꺼진 게시도 키를 읽은 뒤에 그 자리를 조회해 올라갔는지 확인한다.
    flowAccount
      .checkStoredKey()
      .then(syncDetection)
      .catch((error: unknown) => logger.error('flow-account.stored-key-check-failed', errorFields(error)))
      .finally(() => {
        void draftQueue.start();
        bundlePosting.recoverAfterRestart();
      });
    // 앱을 시작할 때 후보 에이전트의 연결을 확인한다(작동 확인 포함). 쓸 에이전트가 없으면 전역 문제가 트레이에 뜬다. 실패도 상태로 남기고 던지지 않는다.
    void agentConnections.checkAll();
    // 켜고 1분 뒤 처음 확인하고, 그 뒤 4시간마다 확인한다.
    inAppUpdate?.start();
    // 여기까지 왔으면 이 버전이 정상으로 뜬 것이다. 마이그레이션 전 사본은 그때부터 7일 뒤 지운다.
    migrationBackups = new MigrationBackups({ dataDir: dataFolderPath(), clock: systemClock, logger });
    void migrationBackups.start();
  });
}

/**
 * 앱을 끝내기 전 정리. 확인 창은 띄우지 않는다.
 * 폴링과 정리 예약을 멈추고, 에이전트 실행을 끊어 프로세스 트리를 끝내며(그 실행은 "앱 종료로 중단"으로 남고 대기열은 다시 켤 때 그 순서로 돈다),
 * 게시 요청이 진행 중이면 응답을 최대 5초 기다린다. 마지막으로 편집기 내용 같은 묶음 저장이 끝나기를 기다려 state.db를 닫을 수 있게 한다.
 */
async function prepareQuit(): Promise<void> {
  // state.db를 닫은 뒤에 예약된 조회가 돌지 않게 폴링을 먼저 멈춘다.
  detection?.stop();
  retention?.stop();
  appUpdate?.stop();
  migrationBackups?.stop();
  try {
    // 에이전트 CLI는 새 프로세스 그룹으로 띄워 앱과 함께 끝나지 않으므로 실행을 끊어 프로세스 트리를 끝낸다.
    // 카운트다운 중이던 게시는 보내지 않고 게시 중으로 남아, 다시 켤 때 준비됨으로 돌아간다.
    await Promise.all([drafts?.stop(), posting?.stop()]);
    await bundles?.whenIdle();
  } catch (error) {
    logger.error('app.quit-cleanup-failed', errorFields(error));
  }
}

/** 구독을 끊는 함수 여럿을 한 번에 부르는 함수 하나로 묶는다. */
function unsubscribeAll(unsubscribes: readonly (() => void)[]): () => void {
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

/**
 * 앱이 스스로 바꿀 수 없는 위치인지 본다. Windows는 사용자별 설치라 늘 바꿀 수 있다.
 * macOS 실행 파일이 앱 번들 안에 있지 않으면 위치를 알 수 없으므로 던진다(앱 내 업데이트는 받지 않는다).
 */
async function checkAppLocation(): Promise<BlockedLocationReason | null> {
  if (process.platform !== 'darwin') return null;
  /** 실행 중인 앱 번들. */
  const bundlePath = macBundlePathOf(process.execPath);
  if (!bundlePath) throw new Error('실행 파일이 앱 번들 안에 있지 않습니다.');
  return checkInstallLocation(bundlePath);
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

/** 전역 문제와 앱 상태(감지 시작 여부, 묶음 상태)에 맞춘 트레이 표시. */
function trayView(current: ActiveGlobalProblem | null, state: Omit<TrayIndicatorInput, 'hasGlobalProblem'>): TrayView {
  return {
    indicator: trayIndicator({ hasGlobalProblem: current !== null, ...state }),
    problem: current && problemText(current.problem),
    canCheckNow: !state.setupNeeded,
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
