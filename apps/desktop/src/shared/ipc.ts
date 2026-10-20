/**
 * main과 렌더러 사이의 IPC 계약.
 * main → 렌더러로는 상태 스냅숏과 변경 이벤트가, 렌더러 → main으로는 명령이 간다.
 * 렌더러는 이 계약을 preload의 `window.stardraft`로만 쓴다.
 */

/** IPC 채널 이름. */
export const IPC_CHANNELS = {
  /** 렌더러가 전체 상태 스냅숏을 요청한다. */
  getSnapshot: 'stardraft:get-snapshot',
  /** 렌더러가 main에 명령을 보낸다. */
  command: 'stardraft:command',
  /** main이 렌더러에 변경 이벤트를 보낸다. */
  event: 'stardraft:event',
} as const;

/** 설정 창의 칸. 왼쪽 칸 목록에 이 순서로 보인다. */
export const SETTINGS_SECTIONS = ['flow-account', 'agent', 'repositories', 'drafts', 'general'] as const;

/** 설정 창의 칸 하나. */
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** 설정 "일반" 칸에서 여는 폴더. 경로는 main이 정하고 렌더러는 이름만 보낸다. */
export const APP_FOLDERS = ['data', 'logs'] as const;

/** 여는 폴더 하나. `data`는 데이터 폴더, `logs`는 진단 로그 폴더다. */
export type AppFolder = (typeof APP_FOLDERS)[number];

/** 키 확인 명령이 받는 키의 최대 길이. 이보다 긴 값은 키가 아니므로 main에 보내지 않는다. */
export const FLOW_API_KEY_MAX_LENGTH = 512;

/** 앱이 실행할 수 있는 에이전트. */
export const AGENT_IDS = ['claude-code', 'codex'] as const;

/** 에이전트 하나. */
export type AgentId = (typeof AGENT_IDS)[number];

/** 모델 고르기 명령이 받는 모델 이름의 최대 길이. */
export const AGENT_MODEL_MAX_LENGTH = 200;

/** "Flow 계정" 칸의 계정 카드에 보일 계정. */
export interface FlowAccountProfile {
  /** 이름. */
  name: string;
  /** 소속. 모르면 빈 문자열이다. */
  division: string;
  /** 이메일. */
  email: string;
}

/** 키 확인의 진행 상태. */
export type FlowKeyCheckState =
  /** 진행 중인 확인이 없다. */
  | { status: 'idle' }
  /** Flow에 키를 확인하거나 확인한 키를 저장하고 있다. */
  | { status: 'checking' }
  /** 요청 한도에 걸려 잠시 뒤 자동으로 다시 확인한다. */
  | { status: 'waiting-retry' }
  /** 다른 계정의 키라서, 지금까지의 기록을 지우고 바꿀지 확인을 기다린다. */
  | { status: 'awaiting-confirmation'; account: FlowAccountProfile };

/** 키 확인이 실패한 이유. */
export type FlowKeyCheckFailure = 'unauthorized' | 'network' | 'rate-limited' | 'unexpected' | 'save-failed';

/** "Flow 계정" 칸이 그릴 상태. */
export interface FlowAccountSnapshot {
  /** 키 확인에 성공한 계정. 아직 없으면 `null`. */
  account: FlowAccountProfile | null;
  /** 키 확인의 진행 상태. */
  keyCheck: FlowKeyCheckState;
}

/** 감지를 멈추게 하는 전역 문제. 작은 창 띠, 트레이 메뉴, OS 알림에 하나만 보인다. */
export type GlobalProblemSnapshot =
  /** 키 확인 필요. */
  | { cause: 'flow-key'; reason: FlowKeyProblemReason }
  /** 에이전트 확인 필요. */
  | { cause: 'agent'; reason: AgentProblemReason };

/** "키 확인 필요"가 생긴 이유. `rejected`는 Flow가 키를 거부한 것(`401`), `unreadable`은 저장된 키를 읽을 수 없는 것이다. */
export type FlowKeyProblemReason = 'rejected' | 'unreadable';

/** 에이전트 전역 실패의 이유. CLI 없음, 미로그인, CLI 업데이트 필요, 점검 실행(작동 확인) 실패다. */
export type AgentProblemReason = 'cli-missing' | 'not-logged-in' | 'update-required' | 'check-failed';

/** 에이전트 연결 확인의 네 단계. 화면의 연결선 네 마디다. */
export type AgentCheckStep = 'find' | 'version' | 'login' | 'run-check';

/** 에이전트 연결 확인이 멈춘 이유. 단계마다 고치는 법이 다르다. */
export type AgentCheckFailure =
  /** 찾아본 곳 어디에도 CLI가 없다. */
  | { step: 'find'; reason: 'not-found' }
  /** 직접 지정한 파일을 실행할 수 없다. */
  | { step: 'find'; reason: 'picked-invalid' }
  /** 필수 플래그를 지원하지 않는 낮은 버전이다. */
  | { step: 'version'; reason: 'update-required' }
  /** 버전을 읽지 못했다. */
  | { step: 'version'; reason: 'unreadable' }
  /** 로그인되어 있지 않다. */
  | { step: 'login'; reason: 'not-logged-in' }
  /** `apiKeyHelper`로만 인증한다. 앱은 이 방식을 지원하지 않는다. */
  | { step: 'login'; reason: 'api-key-helper' }
  /** 로그인 상태를 읽지 못했다. */
  | { step: 'login'; reason: 'unreadable' }
  /** 점검 실행(작동 확인)이 실패했다. */
  | { step: 'run-check'; reason: 'run-failed' };

/** 에이전트 연결 확인의 진행 상태. */
export type AgentCheckProgress =
  /** 아직 확인하지 않았다. */
  | { status: 'idle' }
  /** 이 단계를 확인하고 있다. */
  | { status: 'checking'; step: AgentCheckStep }
  /** 이 단계에서 멈췄다. */
  | { status: 'failed'; failure: AgentCheckFailure }
  /** 네 단계를 모두 통과했다. 에이전트 연결이다. */
  | { status: 'connected' };

/** 자식 프로세스 PATH의 출처. `login-shell`은 로그인 셸에서 읽은 PATH, `app`은 앱이 받은 PATH다. */
export type PathSource = 'login-shell' | 'app';

/** "자세히"에만 보이는 확인 내용. */
export interface AgentCheckDetails {
  /** 찾은 CLI의 절대 경로. */
  cliPath: string | null;
  /** 터미널에서 이 CLI를 부르는 말(`claude` 또는 따옴표로 감싼 절대 경로). */
  cliCommand: string;
  /** 이 CLI를 업데이트하는 명령. Homebrew 설치본은 brew 명령이다. */
  updateCommand: string;
  /** 읽은 CLI 버전. */
  version: string | null;
  /** 필요한 가장 낮은 버전. */
  requiredVersion: string;
  /** 로그인 방식. */
  authMethod: string | null;
  /** 자식 프로세스 PATH의 출처. 아직 읽지 않았으면 `null`. */
  pathSource: PathSource | null;
  /** PATH 말고 찾아본 알려진 설치 위치. */
  searchedDirs: string[];
  /** 실패한 CLI 명령의 오류 원문. */
  errorOutput: string | null;
}

/** 설정 "에이전트" 칸의 연결 표시가 그릴 상태. */
export interface AgentConnectionSnapshot {
  /** 진행 상태. */
  progress: AgentCheckProgress;
  /** "자세히" 내용. */
  details: AgentCheckDetails;
}

/** 모델 선택 상자의 항목 하나. */
export interface ModelOptionSnapshot {
  /** CLI에 넘길 모델 값. */
  id: string;
  /** 화면에 보일 이름. */
  label: string;
  /** 저장한 모델이 목록에서 사라져 "(목록에 없음)"을 붙여 보일 항목인지 여부. */
  unlisted: boolean;
}

/** 에이전트 하나의 모델 선택 상자. 첫 항목 "기본 모델(에이전트가 정함)"은 화면이 붙인다. */
export interface ModelChoiceSnapshot {
  /** 고를 수 있는 모델. */
  options: ModelOptionSnapshot[];
  /** 고른 모델. 기본 모델이면 `null`. */
  selected: string | null;
}

/** 설정 "에이전트" 칸의 기본 에이전트와 모델 선택. */
export interface AgentPreferencesSnapshot {
  /** 연결된 에이전트. 둘 이상이면 기본 에이전트를 고르는 칸이 보인다. */
  connectedAgents: AgentId[];
  /** 실행에 쓸 기본 에이전트. 연결된 에이전트가 없으면 `null`. */
  defaultAgent: AgentId | null;
  /** 연결된 에이전트별 모델 선택 상자. */
  models: Partial<Record<AgentId, ModelChoiceSnapshot>>;
}

/** 렌더러가 그릴 앱 상태 전체. */
export interface AppSnapshot {
  /** 화면에 보일 앱 이름. 소스에서 실행하면 `Stardraft Dev`다. */
  appName: string;
  /** 앱 버전. */
  version: string;
  /** 실행 중인 OS. 문구와 배치를 OS에 맞출 때 쓴다. */
  platform: 'darwin' | 'win32' | 'other';
  /** "Flow 계정" 칸의 상태. */
  flowAccount: FlowAccountSnapshot;
  /** 지금 보일 전역 문제. 없으면 `null`. */
  globalProblem: GlobalProblemSnapshot | null;
  /** Claude Code 연결 확인 상태. */
  agentConnection: AgentConnectionSnapshot;
  /** 기본 에이전트와 모델 선택. */
  agentPreferences: AgentPreferencesSnapshot;
}

/** main → 렌더러 변경 이벤트. */
export type AppEvent =
  /** 이미 열린 설정 창에 이 칸을 보이라고 알린다. */
  | { type: 'settings-section-requested'; section: SettingsSection }
  /** "Flow 계정" 칸의 상태가 바뀌었다. */
  | { type: 'flow-account-changed'; flowAccount: FlowAccountSnapshot }
  /** 키 확인 하나가 연결이나 실패로 끝났다. 그만둔 확인과 확인을 기다리는 경우는 알리지 않는다. */
  | { type: 'flow-key-check-finished'; result: 'connected' | FlowKeyCheckFailure }
  /** 보일 전역 문제가 바뀌었다. */
  | { type: 'global-problem-changed'; globalProblem: GlobalProblemSnapshot | null }
  /** 에이전트 연결 확인 상태가 바뀌었다. */
  | { type: 'agent-connection-changed'; agentConnection: AgentConnectionSnapshot }
  /** 기본 에이전트나 모델 선택이 바뀌었다. 연결된 에이전트가 바뀔 때도 온다. */
  | { type: 'agent-preferences-changed'; agentPreferences: AgentPreferencesSnapshot };

/** 렌더러 → main 명령. */
export type AppCommand =
  /** 설정 창을 연다. 칸을 주면 그 칸을 보인다. */
  | { type: 'open-settings'; section?: SettingsSection }
  /** 데이터 폴더나 로그 폴더를 OS 파일 관리자로 연다. */
  | { type: 'open-folder'; folder: AppFolder }
  /** 붙여 넣은 Flow 개인 API 키를 확인한다. 성공하면 main이 키를 저장한다. */
  | { type: 'check-flow-key'; apiKey: string }
  /** 다른 계정의 키로 바꾸는 것을 확인했다. 지금까지의 기록을 지우고 새 계정으로 시작한다. */
  | { type: 'confirm-flow-account-switch' }
  /** 진행 중인 키 확인이나 확인을 기다리는 계정 바꾸기를 그만둔다. */
  | { type: 'cancel-flow-key-check' }
  /** 에이전트 연결을 확인한다. 칸을 열 때와 [다시 확인]에 쓴다. 저장한 CLI 경로가 있으면 그대로 쓴다. */
  | { type: 'check-agent' }
  /** 저장한 CLI 경로를 무시하고 다시 찾는다. */
  | { type: 'rediscover-agent' }
  /** 파일 선택 창으로 CLI를 직접 지정한다. 경로는 main이 받으므로 렌더러는 보내지 않는다. */
  | { type: 'pick-agent-cli' }
  /** 실패 카드의 명령을 클립보드에 복사한다. 명령은 main이 지금 상태에서 정한다. */
  | { type: 'copy-agent-fix-command' }
  /** 기본 에이전트를 고른다. 연결되지 않은 에이전트는 main이 받지 않는다. */
  | { type: 'set-default-agent'; agent: AgentId }
  /** 에이전트의 모델을 고른다. `null`은 기본 모델(에이전트가 정함)이다. 목록에 없는 모델은 main이 받지 않는다. */
  | { type: 'set-agent-model'; agent: AgentId; model: string | null };

/** preload가 렌더러에 `window.stardraft`로 노출하는 IPC. */
export interface StardraftBridge {
  /** 전체 상태 스냅숏을 받는다. */
  getSnapshot(): Promise<AppSnapshot>;
  /** main에 명령을 보낸다. */
  send(command: AppCommand): Promise<void>;
  /** 변경 이벤트를 구독한다. 돌려준 함수를 부르면 구독을 끝낸다. */
  onEvent(listener: (event: AppEvent) => void): () => void;
}

/** 설정 창 칸 이름인지 확인한다. */
export function isSettingsSection(value: unknown): value is SettingsSection {
  return typeof value === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(value);
}

/** 여는 폴더 이름인지 확인한다. */
function isAppFolder(value: unknown): value is AppFolder {
  return typeof value === 'string' && (APP_FOLDERS as readonly string[]).includes(value);
}

/** 앱이 아는 에이전트인지 확인한다. */
function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

/** 모델 고르기 명령에 실을 수 있는 값인지 확인한다. 목록에 있는 모델인지는 main이 본다. */
function isAgentModelInput(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value !== '' && value.length <= AGENT_MODEL_MAX_LENGTH);
}

/** 키 확인 명령에 실을 수 있는 키인지 확인한다. 앞뒤 공백 정리와 키 형식 판단은 main이 한다. */
function isFlowApiKeyInput(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= FLOW_API_KEY_MAX_LENGTH;
}

/**
 * 렌더러가 보낸 값을 명령으로 해석한다. 형식이 맞지 않으면 `null`이다.
 * 렌더러는 믿지 않으므로 main은 이 검사를 통과한 명령만 처리한다.
 */
export function parseAppCommand(value: unknown): AppCommand | null {
  if (typeof value !== 'object' || value === null) return null;
  /** 필드를 읽기 위해 객체로 본 값. */
  const candidate = value as Record<string, unknown>;

  switch (candidate.type) {
    case 'open-settings': {
      if (candidate.section === undefined) return { type: 'open-settings' };
      return isSettingsSection(candidate.section) ? { type: 'open-settings', section: candidate.section } : null;
    }
    case 'open-folder':
      return isAppFolder(candidate.folder) ? { type: 'open-folder', folder: candidate.folder } : null;
    case 'check-flow-key':
      return isFlowApiKeyInput(candidate.apiKey) ? { type: 'check-flow-key', apiKey: candidate.apiKey } : null;
    case 'set-default-agent':
      return isAgentId(candidate.agent) ? { type: 'set-default-agent', agent: candidate.agent } : null;
    case 'set-agent-model':
      return isAgentId(candidate.agent) && isAgentModelInput(candidate.model)
        ? { type: 'set-agent-model', agent: candidate.agent, model: candidate.model }
        : null;
    case 'confirm-flow-account-switch':
    case 'cancel-flow-key-check':
    case 'check-agent':
    case 'rediscover-agent':
    case 'pick-agent-cli':
    case 'copy-agent-fix-command':
      return { type: candidate.type };
    default:
      return null;
  }
}
