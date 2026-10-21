import { app, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions } from 'electron';
import { mkdir } from 'node:fs/promises';
import type { MentionBundles } from '../core/bundles/mention-bundles';
import { evidenceFileOf, type EditorOpener, type EditorOpenerState } from '../core/editors/editor-opener';
import type { DraftQueue } from '../core/drafts/draft-queue';
import type { DraftSettings, DraftSettingsState } from '../core/drafts/draft-settings';
import type { Posting } from '../core/posting/posting';
import type { AgentConnection, AgentConnectionState } from '../core/agent/agent-connection';
import type { AgentPreferences, AgentPreferencesState } from '../core/agent/agent-preferences';
import type { FlowAccount, FlowAccountState, FlowKeyCheckOutcome } from '../core/account/flow-account';
import { errorFields, type Logger } from '../core/logging/logger';
import type { FlowEmployee } from '../core/ports/flow-api';
import type { Notifier } from '../core/ports/notifier';
import type { RepoMappings, RepoMappingsState } from '../core/repos/repo-mappings';
import type { RepoPicker } from '../core/repos/repo-picker';
import type { WorkFolders, WorkFoldersState } from '../core/repos/work-folders';
import type { LaunchAtLogin } from '../core/onboarding/launch-at-login';
import type { Onboarding, OnboardingState } from '../core/onboarding/onboarding';
import type { ActiveGlobalProblem, GlobalProblem, GlobalProblems } from '../core/problems/global-problems';
import type { TrialRun } from '../core/trial/trial-run';
import { agentFixCommand } from '../shared/agent-fix-command';
import {
  IPC_CHANNELS,
  parseAppCommand,
  type AgentConnectionSnapshot,
  type AgentPreferencesSnapshot,
  type AppCommand,
  type AppFolder,
  type AppSnapshot,
  type DraftSettingsSnapshot,
  type EditorSnapshot,
  type FlowAccountProfile,
  type FlowAccountSnapshot,
  type GlobalProblemSnapshot,
  type OnboardingSnapshot,
  type RepoMappingsSnapshot,
  type WorkFoldersSnapshot,
} from '../shared/ipc';
import { appPlatform, dataFolderPath, logsFolderPath } from './app-identity';
import type { AppWindows } from './app-windows';
import { isAppRendererUrl } from './renderer-page';
import type { ReviewSections } from './review-sections';
import { flowUrlOf, reviewSnapshot, trialSnapshot, type ProjectLookup } from './review-snapshot';

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
  /** "저장소" 칸의 작업 폴더. */
  workFolders: WorkFolders;
  /** "저장소" 칸의 저장소 매핑. */
  repoMappings: RepoMappings;
  /** 필수 세 가지와 [감지 시작]. */
  onboarding: Onboarding;
  /** "일반" 칸의 로그인 시 자동 시작. */
  launchAtLogin: LaunchAtLogin;
  /** 작은 창과 펼친 창의 멘션 묶음. */
  bundles: MentionBundles;
  /** 생성 중 묶음의 진행과 취소, 생성을 다시 시작하는 사용자 행동(다시 시도, 되돌리기). */
  drafts: DraftQueue;
  /** [게시]의 카운트다운과 취소, 게시 요청. */
  posting: Posting;
  /** 저장소 선택 창. */
  repoPicker: RepoPicker;
  /** 작은 창과 펼친 창의 영역 펼침 상태. */
  reviewSections: ReviewSections;
  /** 근거의 "에디터에서 열기"와 설정 "일반"의 에디터. */
  editorOpener: EditorOpener;
  /** 최근 멘션으로 시험의 멘션 고르기 목록. */
  trialRun: TrialRun;
  /** 설정 "초안" 칸의 추가 지침과 비밀 파일 패턴. */
  draftSettings: DraftSettings;
  /** 설정 "일반"의 [알림 시험]이 띄우는 OS 알림. */
  notifier: Notifier;
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
  services.workFolders.onChange(() =>
    services.windows.broadcast({ type: 'work-folders-changed', workFolders: workFoldersSnapshot(services.workFolders.state()) }),
  );
  services.repoMappings.onChange(() =>
    services.windows.broadcast({ type: 'repo-mappings-changed', repoMappings: repoMappingsSnapshot(services.repoMappings.state()) }),
  );
  services.onboarding.onChange((state) => services.windows.broadcast({ type: 'onboarding-changed', onboarding: onboardingSnapshot(state) }));
  services.launchAtLogin.onChange((enabled) => services.windows.broadcast({ type: 'launch-at-login-changed', launchAtLogin: enabled }));
  services.editorOpener.onChange(() => services.windows.broadcast({ type: 'editor-changed', editor: editorSnapshot(services.editorOpener.state()) }));
  // 묶음이나 생성 중 묶음의 진행, 게시 카운트다운이 바뀌거나 영역을 접고 펼 때, 그리고 참여 Flow 프로젝트 목록(프로젝트 이름과 주소)이 바뀔 때 묶음 상태를 다시 보낸다.
  /** 묶음 상태를 열린 창에 알린다. */
  const broadcastReview = () => services.windows.broadcast({ type: 'review-changed', review: currentReviewSnapshot(services) });
  services.bundles.onChange(broadcastReview);
  services.drafts.onChange(broadcastReview);
  services.posting.onChange(broadcastReview);
  // 게시 실패는 그 순간 한 번만 토스트로 알린다. 묶음 상태에는 남지만 토스트는 다시 띄우지 않는다.
  services.posting.onFailed((bundleId) => services.windows.broadcast({ type: 'post-failed', bundleId }));
  // 게시를 누를 때의 확인이 게시를 멈춘 것도 그 순간 한 번만 토스트로 알린다.
  services.bundles.onPostStopped((bundleId, stop) => services.windows.broadcast({ type: 'post-stopped', bundleId, stop }));
  services.reviewSections.onChange(broadcastReview);
  // 멘션 고르기 목록이 바뀌거나, 시험 묶음이 생기거나 지워지거나, 감지를 시작하면 시험을 시작할 수 있는지가 바뀐다.
  /** 시험 상태를 열린 창에 알린다. */
  const broadcastTrial = () => services.windows.broadcast({ type: 'trial-changed', trial: currentTrialSnapshot(services) });
  services.trialRun.onChange(broadcastTrial);
  services.bundles.onChange(broadcastTrial);
  services.onboarding.onChange(broadcastTrial);
  services.repoMappings.onChange(broadcastReview);
  services.repoPicker.onChange(broadcastReview);
  services.draftSettings.onChange(() =>
    services.windows.broadcast({ type: 'draft-settings-changed', draftSettings: draftSettingsSnapshot(services.draftSettings.state()) }),
  );
}

/** 지금 묶음 상태의 스냅숏. 생성 중 묶음의 진행은 초안 대기열에서, 게시 카운트다운은 게시에서 읽는다. */
function currentReviewSnapshot({ bundles, drafts, posting, reviewSections, repoMappings, repoPicker }: IpcServices) {
  return reviewSnapshot(
    bundles.state(),
    reviewSections.state(),
    projectLookup(repoMappings),
    (bundleId) => drafts.progress(bundleId),
    (projectId, repos) => repoMappings.matchOf(projectId, repos),
    repoPicker.state(),
    (bundleId) => posting.countdownEndsAt(bundleId),
  );
}

/** 지금 시험 상태의 스냅숏. */
function currentTrialSnapshot({ trialRun, bundles, onboarding }: IpcServices) {
  return trialSnapshot(trialRun.state(), bundles.trialId(), onboarding.state().detectionStarted);
}

/** 참여 Flow 프로젝트 목록에서 Flow 프로젝트를 찾는 함수. 목록을 아직 받지 않았으면 언제나 `null`이다. */
function projectLookup(repoMappings: RepoMappings): ProjectLookup {
  /** 참여 Flow 프로젝트 목록의 상태. */
  const projects = repoMappings.state().projects;
  /** 받은 프로젝트. */
  const loaded = projects.status === 'loaded' ? projects.projects : [];
  return (projectId) => {
    /** 찾은 프로젝트. */
    const project = loaded.find((item) => item.projectId === projectId);
    return project ? { title: project.title, projectUrl: project.projectUrl } : null;
  };
}

/** 지금 앱 상태의 스냅숏. */
function currentSnapshot(services: IpcServices): AppSnapshot {
  /** 상태를 읽을 main의 일. */
  const { flowAccount, globalProblems, agentConnection, agentPreferences, workFolders, repoMappings, onboarding, launchAtLogin } = services;
  return {
    appName: app.name,
    version: app.getVersion(),
    platform: appPlatform(),
    flowAccount: flowAccountSnapshot(flowAccount.state()),
    globalProblem: activeProblemSnapshot(globalProblems.current()),
    agentConnection: agentConnectionSnapshot(agentConnection.state()),
    agentPreferences: agentPreferencesSnapshot(agentPreferences.state()),
    workFolders: workFoldersSnapshot(workFolders.state()),
    repoMappings: repoMappingsSnapshot(repoMappings.state()),
    onboarding: onboardingSnapshot(onboarding.state()),
    launchAtLogin: launchAtLogin.enabled(),
    editor: editorSnapshot(services.editorOpener.state()),
    review: currentReviewSnapshot(services),
    trial: currentTrialSnapshot(services),
    draftSettings: draftSettingsSnapshot(services.draftSettings.state()),
  };
}

/** 검사를 통과한 명령을 실행한다. */
async function runCommand(services: IpcServices, command: AppCommand): Promise<void> {
  /** 명령을 처리할 main의 일. */
  const {
    windows,
    logger,
    flowAccount,
    agentConnection,
    agentPreferences,
    workFolders,
    repoMappings,
    onboarding,
    launchAtLogin,
    bundles,
    drafts,
    posting,
    repoPicker,
    reviewSections,
    editorOpener,
    trialRun,
    draftSettings,
    notifier,
  } = services;
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
    case 'pick-work-folders':
      await pickWorkFolders(windows, workFolders);
      return;
    case 'add-suggested-work-folder':
      await workFolders.addSuggestion(command.path);
      return;
    case 'remove-work-folder':
      await workFolders.remove(command.path);
      return;
    case 'refresh-work-folders':
      await workFolders.refresh();
      return;
    case 'refresh-repo-mappings':
      await repoMappings.refresh();
      return;
    case 'pick-mapping-repos':
      await pickMappingRepos(windows, repoMappings, command.projectId);
      return;
    case 'remove-mapping-repo':
      await repoMappings.removeRepo(command.projectId, command.path);
      return;
    case 'remove-repo-mapping':
      await repoMappings.removeMapping(command.projectId);
      return;
    case 'start-detection':
      await onboarding.startDetection();
      return;
    case 'set-launch-at-login':
      await launchAtLogin.set(command.enabled);
      return;
    case 'ignore-bundle':
      await bundles.ignore(command.bundleId);
      return;
    // 되돌리기와 [다시 시도]는 사용자 행동이라, 새로 만들게 되면 초안 대기열이 감지한 묶음보다 앞에 넣는다.
    case 'restore-bundle':
      await drafts.restore(command.bundleId);
      return;
    case 'cancel-generation':
      await drafts.cancel(command.bundleId);
      return;
    case 'retry-bundle':
      await drafts.retry(command.bundleId);
      return;
    case 'open-bundle-in-flow':
      await openBundleInFlow(services, command.bundleId);
      return;
    case 'edit-draft':
      await bundles.editDraft(command.bundleId, command.text);
      return;
    case 'revert-draft-edit':
      await bundles.revertDraftEdit(command.bundleId);
      return;
    case 'remove-recipient':
      await bundles.removeRecipient(command.bundleId, command.index, command.name);
      return;
    case 'post-bundle':
      await posting.post(command.bundleId);
      return;
    case 'cancel-posting':
      await posting.cancel(command.bundleId);
      return;
    // 재생성은 사용자 행동이라 초안 대기열이 감지한 묶음보다 앞에 넣는다.
    case 'regenerate-bundle':
      await drafts.regenerate(command.bundleId, { path: 'again' });
      return;
    case 'regenerate-with-directive':
      await drafts.regenerate(command.bundleId, { path: 'directive', directive: command.directive });
      return;
    case 'fix-requirement':
      await drafts.regenerate(command.bundleId, { path: 'requirement', requirement: command.requirement });
      return;
    case 'link-bundle-repos':
      await repoPicker.linkBundle(command.bundleId);
      return;
    case 'open-repo-picker':
      await repoPicker.open(command.bundleId);
      return;
    case 'set-repo-picker-checked':
      repoPicker.setChecked(command.path, command.checked);
      return;
    case 'pick-repo-picker-folders':
      await pickRepoPickerFolders(windows, repoPicker);
      return;
    case 'link-repo-picker':
      await repoPicker.link();
      return;
    case 'generate-with-repo-picker':
      await repoPicker.generate();
      return;
    case 'close-repo-picker':
      repoPicker.close();
      return;
    case 'expand-review':
      windows.openReview(command.bundleId);
      return;
    case 'collapse-review':
      await windows.collapseReview(command.bundleId);
      return;
    case 'set-review-section':
      reviewSections.set(command.window, command.section, command.open);
      return;
    case 'open-evidence-in-editor':
      await openEvidenceInEditor(services, command.bundleId, command.evidenceIndex);
      return;
    case 'choose-editor':
      await editorOpener.choose(command.appId);
      return;
    case 'close-editor-picker':
      editorOpener.closePicker();
      return;
    case 'set-editor':
      await editorOpener.setChoice(command.choice);
      return;
    case 'open-trial-picker':
      await trialRun.open(command.window);
      return;
    case 'reload-trial-picker':
      await trialRun.reload();
      return;
    case 'close-trial-picker':
      trialRun.close();
      return;
    case 'start-trial':
      await trialRun.start(command.alarmId);
      return;
    case 'end-trial':
      await bundles.endTrial(command.bundleId);
      return;
    case 'set-extra-instructions':
      await draftSettings.setExtraInstructions(command.text);
      return;
    case 'add-secret-pattern': {
      /** 추가한 결과. 받지 않은 패턴은 화면이 먼저 알리므로 로그만 남긴다. 패턴의 글은 남기지 않는다. */
      const result = await draftSettings.addSecretPattern(command.pattern);
      if (result !== 'added') logger.warn('draft-settings.pattern-rejected', { result });
      return;
    }
    case 'test-notification':
      notifier.notify(testNotification(app.name));
      return;
  }
}

/** [알림 시험]이 띄우는 알림. 초안 준비됨 알림처럼 보이되 묶음을 가리키지 않아 누르면 작은 창만 띄운다. */
function testNotification(appName: string) {
  return { title: `${appName} 알림 시험`, body: '알림이 이렇게 보입니다. 초안이 준비되면 같은 방식으로 알려 드립니다.' };
}

/** core의 설정 "초안" 칸 상태를 렌더러에 넘길 모양으로 바꾼다. */
function draftSettingsSnapshot(state: DraftSettingsState): DraftSettingsSnapshot {
  return {
    extraInstructions: state.extraInstructions,
    defaultSecretPatterns: [...state.defaultSecretPatterns],
    extraSecretPatterns: [...state.extraSecretPatterns],
  };
}

/** 초안 근거의 파일을 에디터에서 연다. 위치를 찾지 못한 근거나 저장소 밖 경로는 열지 않고 로그만 남긴다. 경로는 로그에 남기지 않는다. */
async function openEvidenceInEditor({ bundles, editorOpener, logger }: IpcServices, bundleId: number, evidenceIndex: number): Promise<void> {
  /** 근거가 든 초안. */
  const draft = bundles.get(bundleId)?.draft;
  /** 열 파일과 줄. */
  const target = draft && evidenceFileOf(draft, evidenceIndex);
  if (!target) {
    logger.warn('editor.open-skipped', { bundleId, evidenceIndex });
    return;
  }
  await editorOpener.open(target);
}

/** core의 에디터 열기 상태를 렌더러에 넘길 모양으로 바꾼다. */
function editorSnapshot(state: EditorOpenerState): EditorSnapshot {
  return {
    choice: state.choice && { ...state.choice },
    installed: state.installed.map((editor) => ({ ...editor })),
    picker: state.picker && { editors: state.picker.editors.map((editor) => ({ ...editor })) },
  };
}

/** 묶음의 게시물을 기본 브라우저로 Flow에서 연다. 열 주소가 없거나 열지 못하면 로그만 남긴다. 주소는 로그에 남기지 않는다. */
async function openBundleInFlow({ bundles, repoMappings, logger }: IpcServices, bundleId: number): Promise<void> {
  /** 열 묶음. */
  const bundle = bundles.get(bundleId);
  /** 열 주소. */
  const url = bundle && flowUrlOf(bundle, projectLookup(repoMappings));
  if (!url) {
    logger.warn('flow.open-skipped', { bundleId });
    return;
  }
  try {
    await shell.openExternal(url);
  } catch (error) {
    logger.warn('flow.open-failed', { bundleId, ...errorFields(error) });
  }
}

/** 저장소 선택 창의 "폴더 직접 고르기". 폴더 선택 창으로 받은 폴더를 체크한 후보로 더한다. 고르지 않고 닫으면 아무 일도 하지 않는다. */
async function pickRepoPickerFolders(windows: AppWindows, repoPicker: RepoPicker): Promise<void> {
  if (!repoPicker.state()) return;
  /** 폴더 선택 창 설정. git 저장소가 아닌 코드 폴더도 고를 수 있다. */
  const options: OpenDialogOptions = {
    title: '저장소 폴더 고르기',
    buttonLabel: '고르기',
    properties: ['openDirectory', 'multiSelections'],
  };
  /** 고른 폴더. */
  const paths = await windows.pickFoldersOverReview(options);
  if (paths.length > 0) repoPicker.addFolders(paths);
}

/** core의 온보딩 상태를 렌더러에 넘길 모양으로 바꾼다. */
function onboardingSnapshot(state: OnboardingState): OnboardingSnapshot {
  return { ...state, requirements: { ...state.requirements } };
}

/** 폴더 선택 창으로 저장소 폴더를 여러 개 받아 Flow 프로젝트에 연결한다. 고르지 않고 닫으면 아무 일도 하지 않는다. */
async function pickMappingRepos(windows: AppWindows, repoMappings: RepoMappings, projectId: string): Promise<void> {
  /** 폴더 선택 창 설정. git 저장소가 아닌 코드 폴더도 고를 수 있다. */
  const options: OpenDialogOptions = {
    title: '연결할 저장소 폴더 고르기',
    buttonLabel: '연결',
    properties: ['openDirectory', 'multiSelections'],
  };
  /** 설정 창. 있으면 그 위에 시트로 띄운다. */
  const parent = windows.settingsWindow();
  /** 고른 결과. */
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return;
  await repoMappings.addRepos(projectId, result.filePaths);
}

/** core의 저장소 매핑 상태를 렌더러에 넘길 모양으로 바꾼다. 프로젝트 주소는 화면에 쓰지 않으므로 넘기지 않는다. */
function repoMappingsSnapshot(state: RepoMappingsState): RepoMappingsSnapshot {
  return {
    mappings: state.mappings.map((mapping) => ({ ...mapping, repos: mapping.repos.map((repo) => ({ ...repo })) })),
    projects:
      state.projects.status === 'loaded'
        ? { status: 'loaded', projects: state.projects.projects.map(({ projectId, title }) => ({ projectId, title })) }
        : state.projects,
  };
}

/** 폴더 선택 창으로 작업 폴더를 여러 개 받아 더한다. 고르지 않고 닫으면 아무 일도 하지 않는다. */
async function pickWorkFolders(windows: AppWindows, workFolders: WorkFolders): Promise<void> {
  /** 폴더 선택 창 설정. */
  const options: OpenDialogOptions = {
    title: '작업 폴더 추가',
    buttonLabel: '추가',
    properties: ['openDirectory', 'multiSelections'],
  };
  /** 설정 창. 있으면 그 위에 시트로 띄운다. */
  const parent = windows.settingsWindow();
  /** 고른 결과. */
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) return;
  await workFolders.add(result.filePaths);
}

/** core의 작업 폴더 상태를 렌더러에 넘길 모양으로 바꾼다. */
function workFoldersSnapshot(state: WorkFoldersState): WorkFoldersSnapshot {
  return {
    folders: state.folders.map(({ path, scan }) => ({
      path,
      scan: scan.status === 'found' ? { status: 'found', repos: scan.repos.map((repo) => ({ ...repo })) } : { status: scan.status },
    })),
    suggestions: state.suggestions.map((suggestion) => ({ ...suggestion })),
    rejected: state.rejected.map((folder) => ({ ...folder })),
  };
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
