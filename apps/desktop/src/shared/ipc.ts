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

/** 작업 폴더·저장소 매핑 명령이 받는 경로의 최대 길이. */
export const WORK_FOLDER_PATH_MAX_LENGTH = 4096;

/** 저장소 매핑 명령이 받는 Flow 프로젝트 ID의 최대 길이. */
export const FLOW_PROJECT_ID_MAX_LENGTH = 64;

/** 초안 편집 명령이 받는 편집기 텍스트의 최대 길이. 게시 본문 상한(4,000)을 넘긴 텍스트도 저장해 안내를 보여야 하므로 그보다 넉넉하다. */
export const DRAFT_TEXT_MAX_LENGTH = 100_000;

/** 에디터 직접 지정 명령이 받는 명령 한 줄의 최대 길이. */
export const EDITOR_COMMAND_MAX_LENGTH = 2_000;

/** 에디터 고르기 명령이 받는 에디터 ID의 최대 길이. JetBrains IDE는 ID에 앱 이름이 든다. */
export const EDITOR_APP_ID_MAX_LENGTH = 200;

/** 받는 사람 빼기 명령이 받는 이름의 최대 길이. */
export const RECIPIENT_NAME_MAX_LENGTH = 200;

/** 지시를 덧붙여 다시 만들기와 요구 고치기 명령이 받는 글의 최대 길이. */
export const REGENERATION_TEXT_MAX_LENGTH = 2_000;

/** 추가 지침 저장 명령이 받는 글의 최대 길이. core의 상한과 같다. */
export const EXTRA_INSTRUCTIONS_MAX_LENGTH = 4_000;

/** 비밀 파일 패턴 추가 명령이 받는 패턴의 최대 길이. core의 상한과 같다. */
export const SECRET_PATTERN_MAX_LENGTH = 200;

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

/** 작업 폴더에서 찾은 저장소 하나. */
export interface RepoCandidateSnapshot {
  /** 화면에 보일 이름. 작업 폴더에서의 상대 경로이고, 작업 폴더 자체가 저장소면 폴더 이름이다. */
  name: string;
  /** 저장소의 절대 경로. */
  path: string;
}

/** 작업 폴더 하나를 훑은 상태. */
export type WorkFolderScanSnapshot =
  /** 훑고 있다. */
  | { status: 'scanning' }
  /** 훑기를 마쳤다. 저장소가 없으면 빈 목록이다. */
  | { status: 'found'; repos: RepoCandidateSnapshot[] }
  /** 폴더가 없거나 읽을 수 없다. */
  | { status: 'missing' };

/** 작업 폴더로 받지 않은 이유. `network`는 네트워크 경로, `wsl`은 WSL 경로다. */
export type RejectedFolderReason = 'network' | 'wsl';

/** 작업 폴더 하나. */
export interface WorkFolderSnapshot {
  /** 작업 폴더의 절대 경로. */
  path: string;
  /** 훑은 상태. */
  scan: WorkFolderScanSnapshot;
}

/** "이 PC에서 찾은 폴더" 하나. */
export interface WorkFolderSuggestionSnapshot {
  /** 폴더의 절대 경로. */
  path: string;
  /** 그 안에서 찾은 저장소 수. */
  repoCount: number;
}

/** 작업 폴더로 받지 않은 폴더 하나. */
export interface RejectedFolderSnapshot {
  /** 고른 경로. */
  path: string;
  /** 받지 않은 이유. */
  reason: RejectedFolderReason;
}

/** 설정 "저장소" 칸의 작업 폴더. */
export interface WorkFoldersSnapshot {
  /** 작업 폴더. 저장한 순서다. */
  folders: WorkFolderSnapshot[];
  /** 작업 폴더가 아닌 "이 PC에서 찾은 폴더". */
  suggestions: WorkFolderSuggestionSnapshot[];
  /** 마지막 추가에서 받지 않은 폴더. */
  rejected: RejectedFolderSnapshot[];
}

/** 매핑된 저장소 폴더를 확인한 상태. `missing`은 폴더를 찾을 수 없는 것이다. */
export type MappedRepoStatus = 'checking' | 'found' | 'missing';

/** 매핑에 연결된 저장소 하나. */
export interface MappedRepoSnapshot {
  /** 저장소 폴더의 절대 경로. */
  path: string;
  /** 폴더가 있는지 확인한 상태. */
  status: MappedRepoStatus;
}

/** 저장소 매핑 하나. */
export interface RepoMappingSnapshot {
  /** Flow 프로젝트 ID. 매핑의 키다. */
  projectId: string;
  /** 참여 목록에서 찾은 Flow 프로젝트 이름. 모르면 `null`. */
  title: string | null;
  /** 연결된 저장소. */
  repos: MappedRepoSnapshot[];
  /** 연결된 폴더 중 하나라도 없는지 여부. */
  missing: boolean;
}

/** 매핑에서 고를 참여 Flow 프로젝트 하나. */
export interface ParticipantProjectSnapshot {
  /** Flow 프로젝트 ID. */
  projectId: string;
  /** Flow 프로젝트 이름. 비어 있을 수 있다. */
  title: string;
}

/** 참여 Flow 프로젝트 목록을 받지 못한 이유. `no-key`는 쓸 키가 아직 없는 것이다. */
export type ParticipantProjectsFailure = 'no-key' | 'unauthorized' | 'network' | 'rate-limited' | 'unexpected';

/** 참여 Flow 프로젝트 목록의 상태. */
export type ParticipantProjectsSnapshot =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; projects: ParticipantProjectSnapshot[] }
  | { status: 'failed'; reason: ParticipantProjectsFailure };

/** 설정 "저장소" 칸의 저장소 매핑. */
export interface RepoMappingsSnapshot {
  /** 저장된 매핑. */
  mappings: RepoMappingSnapshot[];
  /** 매핑에서 고를 참여 Flow 프로젝트 목록. */
  projects: ParticipantProjectsSnapshot;
}

/** 감지를 시작하기 전에 필요한 필수 세 가지. 작은 창과 설정 창 띠에 이 순서로 보인다. */
export const SETUP_REQUIREMENTS = ['flow-key', 'agent', 'work-folders'] as const;

/** 필수 설정 하나. `flow-key`는 확인된 키, `agent`는 에이전트 연결, `work-folders`는 작업 폴더 1개 이상이다. */
export type SetupRequirement = (typeof SETUP_REQUIREMENTS)[number];

/** 필수 설정 하나의 상태. `checking`은 에이전트 연결을 확인하는 중이다. */
export type SetupRequirementStatus = 'done' | 'needed' | 'checking';

/** [감지 시작]이 실패한 이유. `no-key`는 쓸 키가 없는 것, `save-failed`는 기준점이나 설정을 저장하지 못한 것이다. */
export type DetectionStartFailure = 'no-key' | 'unauthorized' | 'network' | 'rate-limited' | 'unexpected' | 'save-failed';

/** [감지 시작]의 진행 상태. */
export type DetectionStartSnapshot =
  | { status: 'idle' }
  | { status: 'starting' }
  | { status: 'failed'; reason: DetectionStartFailure };

/** 작은 창의 필수 설정 전 화면과 설정 창 첫 설정 띠가 그릴 온보딩 상태. */
export interface OnboardingSnapshot {
  /** 감지를 시작했는지 여부. 시작한 뒤에는 첫 설정 띠와 필수 설정 전 화면이 나오지 않는다. */
  detectionStarted: boolean;
  /** 필수 세 가지의 상태. */
  requirements: Record<SetupRequirement, SetupRequirementStatus>;
  /** 필수 세 가지가 모두 되어 [감지 시작]을 보일 수 있는지 여부. */
  ready: boolean;
  /** [감지 시작]의 진행 상태. */
  start: DetectionStartSnapshot;
}

/** 멘션 고르기 목록을 여는 창. 작은 창의 빈 화면(`popover`)이나 설정 "초안" 칸(`settings`)이다. */
export const TRIAL_WINDOWS = ['popover', 'settings'] as const;

/** 멘션 고르기 목록을 여는 창 하나. */
export type TrialWindowSnapshot = (typeof TRIAL_WINDOWS)[number];

/** 최근 멘션을 불러오지 못한 까닭. 쓸 키 없음, 키 거부, 연결 실패, 요청 한도, 그 밖이다. */
export type TrialLoadFailureSnapshot = 'no-key' | 'unauthorized' | 'network' | 'rate-limited' | 'unexpected';

/** 멘션 고르기 목록의 멘션 하나. */
export interface TrialCandidateSnapshot {
  /** 고를 때 보내는 알림 ID. */
  alarmId: string;
  /** 송신자 이름. 비어 있을 수 있다. */
  senderName: string;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: string | null;
  /** 멘션 글의 첫 줄. 멘션 표기는 `@이름`으로 바꿨다. */
  firstLine: string;
  /** 멘션 시각(Unix epoch 밀리초). */
  at: number;
  /** 멘션보다 나중에 쓴 내 답이 있는지 여부. "답함"을 붙이지만 고를 수 있다. */
  answered: boolean;
}

/** 열린 멘션 고르기 목록. */
export type TrialPickerSnapshot =
  /** 최근 멘션을 불러오는 중이다. */
  | { window: TrialWindowSnapshot; status: 'loading' }
  /** 불러왔다. 최신이 앞이다. */
  | { window: TrialWindowSnapshot; status: 'loaded'; candidates: TrialCandidateSnapshot[] }
  /** 불러오지 못했다. */
  | { window: TrialWindowSnapshot; status: 'failed'; reason: TrialLoadFailureSnapshot };

/** 설정 "초안" 칸의 추가 지침과 비밀 파일 패턴. */
export interface DraftSettingsSnapshot {
  /** 모든 초안에 적용할 추가 지침. 기본 지침 뒤에 붙는다. */
  extraInstructions: string;
  /** 앱에 넣어 둔 비밀 파일 패턴. 읽기 전용이다. */
  defaultSecretPatterns: string[];
  /** 사용자가 추가한 비밀 파일 패턴. 추가한 순서이고 뺄 수 없다. */
  extraSecretPatterns: string[];
}

/** 최근 멘션으로 시험의 상태. */
export interface TrialSnapshot {
  /** 지금 시험을 시작할 수 있는지 여부. 감지를 시작했고 시험 묶음이 없어야 한다. */
  canStart: boolean;
  /** 지금 있는 시험 묶음의 ID. 없으면 `null`. */
  bundleId: number | null;
  /** 열린 멘션 고르기 목록. 닫혀 있으면 `null`. */
  picker: TrialPickerSnapshot | null;
}

/** 멘션 묶음의 상태. 생성 중, 준비됨, 저장소 확인 필요, 게시 중, 실패, 게시 실패, 게시됨, 무시함, 이미 답함, 원문 사라짐이다. */
export type BundleStatusSnapshot =
  | 'generating'
  | 'ready'
  | 'repo-check-needed'
  | 'posting'
  | 'failed'
  | 'post-failed'
  | 'posted'
  | 'ignored'
  | 'already-answered'
  | 'source-gone';

/**
 * 게시 실패의 사유. 권한 없음(`403`), 지워짐(`404`, `412`), 받지 않음(`400`, `422` 등), 요청 한도 초과(`429` 두 번),
 * 응답 없음(응답이 없거나 `5xx`였고 다시 조회해도 올라간 글이 없음), 앱 종료(응답을 받기 전에 앱이 꺼졌고 다시 켜 조회해도 올라간 글이 없음)다.
 */
export type PostFailureSnapshot = 'forbidden' | 'gone' | 'rejected' | 'rate-limited' | 'no-response' | 'app-quit';

/**
 * 게시를 누를 때의 확인이 게시를 멈춘 까닭. 이미 답함, 원문 사라짐, 또는 [게시]를 누를 때 화면에 없던 변화다.
 * 변화면 확인이 끝나기 전에 합쳐진 새 멘션 수, 새로 생긴 글 수(나를 멘션한 글 포함), 원문 수정 여부, 새로 사라진 멘션 수를 넘긴다.
 */
export type PostStopSnapshot =
  | { kind: 'already-answered' }
  | { kind: 'source-gone' }
  | { kind: 'changed'; newMentionCount: number; newWritingCount: number; edited: boolean; goneMentionCount: number }
  /** 카운트다운 중에 추가한 비밀 파일 패턴에 초안의 근거가 맞아 결과를 버렸다. */
  | { kind: 'secret-evidence' };

/** 게시 중 묶음의 단계. */
export type PostingSnapshot =
  /** 게시 취소 카운트다운 중이다. `endsAt`(Unix epoch 밀리초)에 게시 요청을 보내고, 그 전까지 취소할 수 있다. */
  | { phase: 'countdown'; endsAt: number }
  /** 게시 요청을 보냈고 결과를 기다린다. 취소할 수 없다. */
  | { phase: 'sending' };

/** 펼친 창 목록의 묶음. 목록에 이 순서로 보인다. 검토 대기·생성 중·실패·처리됨이다. */
export const BUNDLE_GROUPS = ['awaiting-review', 'generating', 'failed', 'processed'] as const;

/** 펼친 창 목록의 묶음 하나. */
export type BundleGroup = (typeof BUNDLE_GROUPS)[number];

/** 멘션이 일어난 글의 종류. 게시물 본문, 댓글, 대댓글이다. */
export type MentionPlaceSnapshot = 'post' | 'comment' | 'reply';

/** 원문 글의 한 조각. 멘션 표기는 `@이름`으로 바꾸어 넘기고 Flow 사용자 ID는 넘기지 않는다. */
export interface TextPartSnapshot {
  /** 글. */
  text: string;
  /** 멘션 표기(`@이름`)인지 여부. 화면이 강조한다. */
  mention: boolean;
}

/** 원문 영역의 멘션 하나. */
export interface BundleMentionSnapshot {
  /** 송신자 이름. 비어 있을 수 있다. */
  senderName: string;
  /** 멘션이 일어난 글의 종류. */
  place: MentionPlaceSnapshot;
  /** 멘션 시각(Unix epoch 밀리초). */
  at: number;
  /** Flow 원문. 준비된 뒤의 변화 감시가 조회했으면 지금 내용이다. */
  text: TextPartSnapshot[];
  /** 초안을 만든 뒤 수정됐는지 여부. 참이면 "수정됨"을 표시한다. */
  edited: boolean;
}

/** 원문 영역의 글이 초안을 만든 뒤 바뀐 것. 새로 달린 글(`new`)과 수정된 글(`edited`)이다. */
export type WritingChangeSnapshot = 'new' | 'edited';

/** 원문 영역의 "스레드 보기"로 펼치는 글 하나. 맥락에서 읽는다. */
export interface ThreadEntrySnapshot {
  /** 쓴 사람 이름. 비어 있을 수 있다. */
  authorName: string;
  /** 글의 종류. 게시물 본문, 댓글, 대댓글이다. */
  place: MentionPlaceSnapshot;
  /** 쓴 시각(Unix epoch 밀리초). 모르면 `null`. */
  at: number | null;
  /** 글. */
  text: TextPartSnapshot[];
  /** 첨부 파일 이름. */
  attachments: string[];
  /** 묶음의 멘션인지 여부. 화면이 표시한다. */
  mention: boolean;
  /** 초안을 만든 뒤 새로 달렸거나 수정됐으면 그 변화. "새 글"·"수정됨"을 표시한다. 바뀌지 않았거나 지켜볼 범위 밖이면 `null`. */
  change: WritingChangeSnapshot | null;
}

/** 준비된 뒤의 변화 감시가 찾은 변화. 초안 위 알림 줄에 보인다. 트레이 숫자와 점은 바꾸지 않는다. */
export interface BundleChangesSnapshot {
  /** 초안을 만든 뒤 지켜볼 범위에 새로 달린 글 수. */
  newWritingCount: number;
  /** 초안을 만든 뒤 지켜볼 범위의 글이 수정됐는지 여부. */
  edited: boolean;
  /** Flow에서 사라져 묶음에서 빠진 멘션 수. */
  goneMentionCount: number;
}

/** 초안 문장 하나. */
export interface DraftSentenceSnapshot {
  /** 문장. */
  text: string;
  /** 이 문장을 뒷받침하는 근거 번호. 비어 있으면 "근거 없음"이다. */
  evidence: number[];
  /** 문체 검사에 걸린 말. 나온 순서다. 있으면 문장 옆에 "개발자 용어가 있을 수 있음"을 작게 보인다. */
  developerTerms: string[];
}

/** 초안 문단 하나. */
export interface DraftParagraphSnapshot {
  /** 문단의 문장. 나온 순서다. */
  sentences: DraftSentenceSnapshot[];
}

/** 근거 하나. 자연어 설명과 파일·줄 위치다. */
export interface EvidenceSnapshot {
  /** 근거 번호. 초안 문장의 번호가 이것을 가리킨다. */
  id: number;
  /** 근거를 쉬운 말로 적은 설명. */
  explanation: string;
  /** 저장소 이름(폴더 이름). */
  repositoryName: string;
  /** 저장소 루트 기준 상대 경로. */
  path: string;
  /** 시작 줄. 1부터 센다. */
  startLine: number;
  /** 끝 줄. 이 줄까지 포함한다. */
  endLine: number;
  /** 근거 위치를 찾았는지 여부. 거짓이면 위치 대신 "위치를 찾을 수 없음"을 보이고 "에디터에서 열기"를 끈다. */
  located: boolean;
  /** 근거 설명에서 문체 검사에 걸린 말. 나온 순서다. 있으면 설명 옆에 "개발자 용어가 있을 수 있음"을 작게 보인다. */
  developerTerms: string[];
}

/** 초안을 만들 때 읽기 범위로 넘긴 저장소 하나. */
export interface RepositorySnapshot {
  /** 폴더 이름. */
  name: string;
  /** 절대 경로. */
  path: string;
}

/** 자동 선택으로 초안의 저장소를 정한 내력. 저장소 영역에 자동으로 고른 이유로 보인다. */
export type AutoSelectionSnapshot =
  /** 작업 폴더에서 찾은 후보가 하나라 선택 실행 없이 그 저장소를 썼다. */
  | { kind: 'single-candidate' }
  /** 선택 실행이 골랐다. `reason`이 비어 있으면 "이유 없음"으로 보인다. */
  | { kind: 'chosen'; reason: string };

/** 초안 실행이 만든 초안. */
export interface DraftSnapshot {
  /** 에이전트가 이해한 요구. `summary`는 목록 행에 보인다. */
  requirement: { text: string; summary: string };
  /** 초안 문단. 문장마다 근거 번호가 붙는다. */
  paragraphs: DraftParagraphSnapshot[];
  /** 근거. 에이전트가 낸 순서다. */
  evidence: EvidenceSnapshot[];
  /** 쓴 저장소. 첫 저장소가 실행의 cwd였다. */
  repositories: RepositorySnapshot[];
  /** 저장소를 자동 선택으로 정했으면 그 내력. 저장소 매핑이나 사용자가 고른 구성으로 정했으면 `null`. */
  autoSelection: AutoSelectionSnapshot | null;
  /** 쓴 저장소 구성을 그 Flow 프로젝트의 저장소 매핑과 견준 것. 저장소 영역의 연결 버튼 문구를 정한다. */
  mapping: MappingMatchSnapshot;
  /** 편집기 텍스트. 편집했으면 편집본, 아니면 원래 초안의 문장을 이은 것이다(근거 번호 없음). */
  editorText: string;
  /** 편집했는지 여부. 참이면 근거 번호를 감추고 "원래 초안으로 되돌리기"를 보인다. */
  edited: boolean;
  /** 편집기를 고치고 받는 사람을 뺄 수 있는지 여부. 준비됨과 게시 실패 묶음만 참이다. */
  canEdit: boolean;
  /** 요구를 고쳐 다시 만들 수 있는지 여부(망치 아이콘). 준비됨 묶음만 참이다. */
  canRegenerate: boolean;
  /** 받는 사람. 처음 멘션한 순서다. 사용자 ID는 main이 가지고 있다. */
  recipients: RecipientSnapshot[];
  /**
   * 게시 본문에서 편집기 텍스트 앞에 붙는 받는 사람 표기와 공백의 길이(`String.length`). 받는 사람이 없으면 0이다.
   * 글자 수는 이 값에 앞뒤 공백을 뗀 편집기 텍스트의 길이를 더한 것이다.
   */
  postBodyPrefixLength: number;
  /** [게시]·[다시 게시]를 켤지 여부. 준비됨이나 게시 실패 묶음이고, 편집기 텍스트가 비지 않았고, 게시 본문이 4,000자를 넘지 않을 때만 참이다. */
  canPost: boolean;
}

/** 받는 사람 한 명. */
export interface RecipientSnapshot {
  /** 이름. 비어 있을 수 있다. */
  name: string;
}

/** 게시 본문 길이 상한(`String.length`). Flow 댓글 `contents`의 상한이고, 넘으면 편집기 아래에 안내를 보인다. */
export const POST_BODY_CHAR_LIMIT = 4_000;

/**
 * 저장소 구성을 Flow 프로젝트의 저장소 매핑과 견준 결과. `unmapped`면 "이 Flow 프로젝트에 연결",
 * `different`면 "매핑을 이 구성으로 바꾸기", `same`이면 이미 이 구성이 매핑이다. 순서까지 같아야 같은 구성이다.
 */
export type MappingMatchSnapshot = 'unmapped' | 'same' | 'different';

/** 저장소 선택 창의 후보 무리. 지금 쓰는 저장소, 작업 폴더에서 찾은 저장소, 매핑에 쓰인 저장소, "폴더 직접 고르기"로 더한 폴더 순서다. */
export type RepoChoiceGroupSnapshot = 'current' | 'work-folder' | 'mapping' | 'added';

/** 저장소 선택 창의 후보 하나. */
export interface RepoChoiceSnapshot {
  /** 화면에 보일 이름. */
  name: string;
  /** 저장소 폴더의 절대 경로. 체크 명령에 실어 보낸다. */
  path: string;
  /** 든 무리. */
  group: RepoChoiceGroupSnapshot;
  /** 체크했는지 여부. */
  checked: boolean;
}

/** 열린 저장소 선택 창. "저장소를 골라 만들기"와 "다른 저장소로 다시 만들기"가 같이 쓴다. */
export type RepoPickerSnapshot =
  /** 작업 폴더를 훑고 있다. */
  | { bundleId: number; status: 'loading' }
  /** 후보를 보이고 있다. `mapping`은 체크한 구성을 그 묶음 Flow 프로젝트의 저장소 매핑과 견준 것이다. */
  | { bundleId: number; status: 'ready'; choices: RepoChoiceSnapshot[]; mapping: MappingMatchSnapshot };

/** 상세 머리의 실행 줄. "Claude Code · 2분 14초 · 맥락 일부 생략"처럼 보인다. 비용은 넘기지 않는다. */
export interface RunLineSnapshot {
  /** 실행한 에이전트. */
  agent: AgentId;
  /** 걸린 시간(밀리초). */
  durationMs: number;
  /** 맥락 길이 상한 때문에 뺀 것이 있는지 여부. */
  contextOmitted: boolean;
}

/** 생성 중 묶음의 진행. */
export type GenerationSnapshot =
  /** 대기열에서 차례를 기다린다. */
  | { status: 'waiting' }
  /** 실행하고 있다. 마지막 진행 단계 한 줄과 읽은 파일 수다. */
  | { status: 'running'; step: string; filesRead: number };

/** 생성이 실패한 사유. */
export type DraftFailureReasonSnapshot =
  | 'cancelled'
  | 'timed-out'
  | 'invalid-output'
  | 'empty-draft'
  | 'secret-evidence'
  | 'flow-unavailable'
  | 'source-gone'
  | 'app-error'
  | 'cli-missing'
  | 'cli-error'
  | 'not-logged-in'
  | 'overloaded'
  | 'network'
  | 'max-turns'
  | 'agent-error';

/** 묶음 하나를 만들 때 돌리는 실행의 종류. 선택 실행과 초안 실행이다. */
export type GenerationRunKindSnapshot = 'selection' | 'draft';

/** 생성이 실패한 까닭. 실패 화면에 오류와 마지막 단계로 보인다. */
export interface FailureSnapshot {
  /** 사유. */
  reason: DraftFailureReasonSnapshot;
  /** 에이전트가 알려 준 오류 원문. 없으면 `null`. */
  detail: string | null;
  /** 실패할 때의 마지막 진행 단계. 없으면 `null`. */
  lastStep: string | null;
  /** 실패한 실행의 종류. 실행을 시작하기 전에 실패했으면 `null`. */
  runKind: GenerationRunKindSnapshot | null;
}

/** 저장소 확인 필요의 사유. */
export type RepoCheckSnapshot =
  /**
   * 연결된 저장소 폴더를 찾을 수 없음. `paths`는 찾을 수 없는 폴더의 절대 경로다.
   * `chosenByUser`면 저장소 매핑이 아니라 저장소 선택 창에서 고른 구성의 폴더라 "고른 저장소 폴더를 찾을 수 없음"으로 보인다.
   */
  | { kind: 'missing-folders'; paths: string[]; chosenByUser: boolean }
  /** 자동 선택을 하려 했지만 작업 폴더에서 저장소를 찾지 못함. */
  | { kind: 'no-candidates' }
  /**
   * 선택 실행이 저장소를 확신하지 못했거나 코드와 무관한 멘션이라고 판정함. 사유와 작업 폴더의 후보(작업 폴더 안의 이름과 경로)다.
   * 후보는 에이전트가 짚은 것(`picked`, 짚은 순서)과 나머지(`others`, 찾은 순서)로 나눈다.
   */
  | { kind: 'unsure' | 'unrelated'; reason: string; picked: RepositorySnapshot[]; others: RepositorySnapshot[] };

/** 작은 창과 펼친 창이 그릴 멘션 묶음 하나. */
export interface BundleSnapshot {
  /** 묶음 ID. 명령에 실어 보낸다. */
  id: number;
  /** 상태. */
  status: BundleStatusSnapshot;
  /** 펼친 창 목록의 묶음. 처리됨이면 작은 창 대기열에 없다. */
  group: BundleGroup;
  /** 본문 묶음(`post`)인지 댓글 스레드 묶음(`thread`)인지. */
  place: 'post' | 'thread';
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: string | null;
  /** 게시물 제목. 모르면 빈 문자열. */
  postTitle: string;
  /** 원문 영역에 보일 멘션. 시간순이다. */
  mentions: BundleMentionSnapshot[];
  /** 송신자 이름. 중복 없이 처음 멘션한 순서다. */
  senderNames: string[];
  /** 합쳐진 새 멘션 수. 0보다 크면 "새 멘션 N건"을 보인다. */
  newMentionCount: number;
  /** 이 묶음에 지금까지 덧붙인 지시. 덧붙인 순서다. 지시를 덧붙여 다시 만들면 이것도 함께 넘긴다. */
  directives: string[];
  /** 목록 행에 보일 시각. 가장 최근 멘션의 시각(Unix epoch 밀리초)이다. */
  lastMentionAt: number;
  /** 처리한 시각(Unix epoch 밀리초). 처리됨이 아니면 `null`. */
  processedAt: number | null;
  /** 처리됨에서 되돌릴 수 있는지 여부. */
  canRestore: boolean;
  /** "Flow에서 열기"로 열 주소가 있는지 여부. 주소는 main이 가지고 있다. */
  canOpenInFlow: boolean;
  /**
   * "스레드 보기"로 펼칠 글. 시간순이고 묶음의 멘션도 들어 있다. 맥락을 아직 조회하지 않았으면 비어 있다.
   * 준비된 뒤의 변화 감시가 조회했으면 지금 내용이고, 초안을 만든 뒤 새로 달렸거나 수정된 글에 변화가 붙는다.
   * 댓글 스레드 묶음은 게시물 본문과 대상 댓글 스레드, 본문 묶음은 본문과 다른 댓글(대댓글 포함)이다.
   */
  thread: ThreadEntrySnapshot[];
  /** 초안 실행이 만든 초안. 아직 없으면 `null`. */
  draft: DraftSnapshot | null;
  /** 상세 머리의 실행 줄. 초안을 만든 실행이나 실패한 실행이 없으면 `null`. */
  run: RunLineSnapshot | null;
  /** 생성 중 묶음의 진행. 생성 중이 아니면 `null`. */
  generation: GenerationSnapshot | null;
  /** 생성이 실패한 까닭. 실패가 아니면 `null`. */
  failure: FailureSnapshot | null;
  /** 저장소 확인 필요의 사유. 저장소 확인 필요가 아니거나, 자동 선택이 생기기 전에 사유 없이 저장소 확인 필요가 되었으면 `null`. */
  repoCheck: RepoCheckSnapshot | null;
  /** 게시 중 묶음의 단계. 게시 중이 아니면 `null`. */
  posting: PostingSnapshot | null;
  /** 게시 실패의 사유. 상세 머리에 한 줄로 보인다. 게시 실패가 아니면 `null`. */
  postFailure: PostFailureSnapshot | null;
  /** 카운트다운 중에 앱이 꺼져 게시하지 않고 준비됨으로 돌아왔는지 여부. 참이면 상세 머리에 "앱이 꺼져서 게시하지 않았습니다"를 보인다. */
  quitDuringCountdown: boolean;
  /** 준비된 뒤의 변화 감시가 찾은 변화. 변화가 없으면 모두 0과 거짓이다. */
  changes: BundleChangesSnapshot;
  /** 최근 멘션으로 시험하는 시험 묶음인지 여부. 참이면 "시험" 표시와 안내를 붙이고 [게시] 대신 [시험 끝내기]를 둔다. */
  trial: boolean;
}

/** 묶음을 보는 창. 작은 창(`compact`)과 펼친 창(`expanded`)이다. */
export const REVIEW_WINDOWS = ['compact', 'expanded'] as const;

/** 묶음을 보는 창 하나. */
export type ReviewWindow = (typeof REVIEW_WINDOWS)[number];

/** 머리를 눌러 접고 펴는 상세 영역. 원문, 에이전트가 이해한 요구, 초안, 근거, 저장소, 진행(생성 중의 진행 단계와 실패의 오류)이다. */
export const REVIEW_SECTIONS = ['original', 'requirement', 'draft', 'evidence', 'repository', 'progress'] as const;

/** 접고 펴는 상세 영역 하나. */
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

/** 작은 창과 펼친 창이 그릴 멘션 묶음 상태. */
export interface ReviewSnapshot {
  /** 묶음. 처리되지 않은 묶음이 작은 창 대기열 순서(가장 오래된 미처리 멘션 순)로 먼저 오고, 처리됨 묶음이 최근에 처리한 것부터 뒤에 온다. */
  bundles: BundleSnapshot[];
  /** 창마다 영역의 펼침 상태. 다른 묶음으로 넘어가도 유지한다. */
  sections: Record<ReviewWindow, Record<ReviewSection, boolean>>;
  /** 열린 저장소 선택 창. 닫혀 있으면 `null`. */
  repoPicker: RepoPickerSnapshot | null;
}

/** 에디터에서 열기에 쓸 에디터. 찾은 에디터를 고르거나, `{file}`·`{line}` 자리를 넣은 명령 한 줄을 직접 지정한다. */
export type EditorChoiceSnapshot = { kind: 'app'; appId: string } | { kind: 'command'; command: string };

/** 이 PC에서 찾은 에디터 하나. */
export interface InstalledEditorSnapshot {
  /** 고를 때 보내는 ID. */
  appId: string;
  /** 화면에 보일 이름. */
  name: string;
}

/** 에디터에서 열기의 상태. 설정 "일반"의 에디터 칸과 처음 열 때의 에디터 고르기 창이 그린다. */
export interface EditorSnapshot {
  /** 기억한 에디터. 아직 고르지 않았으면 `null`이고, 처음 열 때 고르게 한다. */
  choice: EditorChoiceSnapshot | null;
  /** 이 PC에서 찾은 에디터. VS Code, Cursor, JetBrains IDE, Zed, Sublime Text 순서다. */
  installed: InstalledEditorSnapshot[];
  /** 열린 에디터 고르기 창. 닫혀 있으면 `null`. */
  picker: { editors: InstalledEditorSnapshot[] } | null;
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
  /** 작업 폴더와 "이 PC에서 찾은 폴더". */
  workFolders: WorkFoldersSnapshot;
  /** 저장소 매핑과 고를 참여 Flow 프로젝트 목록. */
  repoMappings: RepoMappingsSnapshot;
  /** 필수 세 가지와 감지 시작 여부. */
  onboarding: OnboardingSnapshot;
  /** 로그인 시 자동 시작이 켜져 있는지 여부. */
  launchAtLogin: boolean;
  /** 에디터에서 열기에 쓸 에디터와 에디터 고르기 창. */
  editor: EditorSnapshot;
  /** 멘션 묶음과 창마다 영역 펼침 상태. */
  review: ReviewSnapshot;
  /** 최근 멘션으로 시험. */
  trial: TrialSnapshot;
  /** 설정 "초안" 칸의 추가 지침과 비밀 파일 패턴. */
  draftSettings: DraftSettingsSnapshot;
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
  | { type: 'agent-preferences-changed'; agentPreferences: AgentPreferencesSnapshot }
  /** 작업 폴더나 그 훑은 결과, "이 PC에서 찾은 폴더"가 바뀌었다. */
  | { type: 'work-folders-changed'; workFolders: WorkFoldersSnapshot }
  /** 저장소 매핑이나 그 폴더 확인 결과, 참여 Flow 프로젝트 목록이 바뀌었다. */
  | { type: 'repo-mappings-changed'; repoMappings: RepoMappingsSnapshot }
  /** 필수 세 가지의 상태나 감지 시작 여부, [감지 시작]의 진행 상태가 바뀌었다. */
  | { type: 'onboarding-changed'; onboarding: OnboardingSnapshot }
  /** 로그인 시 자동 시작이 켜지거나 꺼졌다. */
  | { type: 'launch-at-login-changed'; launchAtLogin: boolean }
  /** 기억한 에디터, 찾은 에디터, 에디터 고르기 창이 바뀌었다. */
  | { type: 'editor-changed'; editor: EditorSnapshot }
  /** 멘션 묶음이나 영역 펼침 상태가 바뀌었다. */
  | { type: 'review-changed'; review: ReviewSnapshot }
  /** 시험을 시작할 수 있는지, 시험 묶음, 멘션 고르기 목록이 바뀌었다. */
  | { type: 'trial-changed'; trial: TrialSnapshot }
  /** 설정 "초안" 칸의 추가 지침이나 비밀 파일 패턴이 바뀌었다. */
  | { type: 'draft-settings-changed'; draftSettings: DraftSettingsSnapshot }
  /** 이미 열린 창에 이 묶음을 보이라고 알린다. OS 알림을 눌렀을 때 온다. */
  | { type: 'review-bundle-requested'; bundleId: number }
  /** 묶음의 게시가 실패했다. 다른 묶음을 보고 있어도 토스트를 한 번 띄운다. */
  | { type: 'post-failed'; bundleId: number }
  /** 게시를 누를 때의 확인이 묶음의 게시를 멈췄다. 카운트다운 토스트 대신 "게시하지 않았습니다: …" 토스트를 한 번 띄운다. */
  | { type: 'post-stopped'; bundleId: number; stop: PostStopSnapshot };

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
  | { type: 'set-agent-model'; agent: AgentId; model: string | null }
  /** 폴더 선택 창으로 작업 폴더를 여러 개 고른다. 경로는 main이 받으므로 렌더러는 보내지 않는다. */
  | { type: 'pick-work-folders' }
  /** "이 PC에서 찾은 폴더"를 작업 폴더로 더한다. 지금 제안에 없는 경로는 main이 받지 않는다. */
  | { type: 'add-suggested-work-folder'; path: string }
  /** 작업 폴더를 지운다. 그 안을 가리키는 저장소 매핑은 그대로 둔다. */
  | { type: 'remove-work-folder'; path: string }
  /** 작업 폴더와 "이 PC에서 찾은 폴더"를 다시 훑는다. "저장소" 칸을 열 때 보낸다. */
  | { type: 'refresh-work-folders' }
  /** 연결된 폴더를 다시 확인하고 참여 Flow 프로젝트 목록을 다시 받는다. "저장소" 칸을 열 때와 [다시 불러오기]에 보낸다. */
  | { type: 'refresh-repo-mappings' }
  /** 폴더 선택 창으로 고른 폴더를 Flow 프로젝트에 연결한다. 경로는 main이 받으므로 렌더러는 보내지 않는다. */
  | { type: 'pick-mapping-repos'; projectId: string }
  /** 매핑에서 저장소 하나를 뺀다. 마지막 저장소를 빼면 매핑도 없어진다. */
  | { type: 'remove-mapping-repo'; projectId: string; path: string }
  /** 매핑을 통째로 지운다. */
  | { type: 'remove-repo-mapping'; projectId: string }
  /** [감지 시작]. 필수 세 가지가 다 되기 전이거나 이미 시작했으면 main이 무시한다. */
  | { type: 'start-detection' }
  /** 로그인 시 자동 시작을 켜거나 끈다. */
  | { type: 'set-launch-at-login'; enabled: boolean }
  /** 묶음을 무시한다. 처리됨이면 main이 무시한다. */
  | { type: 'ignore-bundle'; bundleId: number }
  /** 처리됨 묶음을 되돌린다. 되돌릴 수 없는 묶음이면 main이 무시한다. */
  | { type: 'restore-bundle'; bundleId: number }
  /** 생성 중 묶음의 초안 실행을 취소한다. 생성 중이 아니면 main이 무시한다. */
  | { type: 'cancel-generation'; bundleId: number }
  /** 실패 묶음을 다시 시도한다. 실패가 아니면 main이 무시한다. */
  | { type: 'retry-bundle'; bundleId: number }
  /** 묶음의 게시물을 Flow에서 연다. 주소는 main이 정한다. */
  | { type: 'open-bundle-in-flow'; bundleId: number }
  /** 준비됨 묶음의 저장소 영역 연결 버튼. 그 초안의 구성으로 Flow 프로젝트의 저장소 매핑을 덮어쓴다. 구성은 main이 묶음에서 읽는다. */
  | { type: 'link-bundle-repos'; bundleId: number }
  /** 묶음의 저장소 선택 창을 연다. 준비됨이나 저장소 확인 필요 묶음이 아니면 main이 무시한다. */
  | { type: 'open-repo-picker'; bundleId: number }
  /** 준비됨 묶음의 편집기 텍스트를 편집본으로 저장한다. 원래 초안과 같으면 편집본을 지운다. 준비됨이 아니면 main이 무시한다. */
  | { type: 'edit-draft'; bundleId: number; text: string }
  /** "원래 초안으로 되돌리기". 준비됨 묶음의 편집본을 버린다. */
  | { type: 'revert-draft-edit'; bundleId: number }
  /**
   * 준비됨 묶음의 받는 사람에서 한 사람을 뺀다. `index`는 화면에 보인 받는 사람 목록의 위치, `name`은 그 사람의 이름이다.
   * 그사이 목록이 바뀌어 그 위치의 이름이 다르면 main이 무시한다. 사용자 ID는 main이 묶음에서 찾는다.
   */
  | { type: 'remove-recipient'; bundleId: number; index: number; name: string }
  /** 준비됨 묶음을 처음과 같은 구성의 입력으로 다시 만든다. 준비됨이 아니면 main이 무시한다. */
  | { type: 'regenerate-bundle'; bundleId: number }
  /** 준비됨 묶음에 지시를 덧붙여 다시 만든다. 직전 결과와 지금까지 덧붙인 지시 전부를 넘긴다. */
  | { type: 'regenerate-with-directive'; bundleId: number; directive: string }
  /** 준비됨 묶음의 요구를 고쳐 "이 요구로 재생성"한다. 그때까지의 지시는 지운다. */
  | { type: 'fix-requirement'; bundleId: number; requirement: string }
  /** 저장소 선택 창의 후보 하나를 체크하거나 뺀다. 후보에 없는 경로는 main이 받지 않는다. */
  | { type: 'set-repo-picker-checked'; path: string; checked: boolean }
  /** 저장소 선택 창의 "폴더 직접 고르기". 폴더 선택 창의 경로는 main이 받으므로 렌더러는 보내지 않는다. */
  | { type: 'pick-repo-picker-folders' }
  /** 저장소 선택 창의 연결 버튼. 체크한 구성으로 저장소 매핑을 덮어쓴다. */
  | { type: 'link-repo-picker' }
  /** 저장소 선택 창에서 체크한 구성으로 초안을 만들고 창을 닫는다. */
  | { type: 'generate-with-repo-picker' }
  /** 저장소 선택 창을 닫는다. */
  | { type: 'close-repo-picker' }
  /** 작은 창을 닫고 펼친 창을 연다. 보고 있던 묶음을 고른 채로 연다. */
  | { type: 'expand-review'; bundleId: number | null }
  /** 펼친 창을 닫고 작은 창을 연다. 보고 있던 묶음을 고른 채로 연다. */
  | { type: 'collapse-review'; bundleId: number | null }
  /** 창의 영역을 접거나 편다. */
  | { type: 'set-review-section'; window: ReviewWindow; section: ReviewSection; open: boolean }
  /** [게시]. 준비됨 묶음의 5초 카운트다운을 시작한다. 게시할 수 없는 묶음이면 main이 무시한다. 게시 본문은 main이 묶음에서 만든다. */
  | { type: 'post-bundle'; bundleId: number }
  /** 카운트다운 중인 게시를 취소한다. 카운트다운이 끝났으면 main이 무시한다. */
  | { type: 'cancel-posting'; bundleId: number }
  /** 근거의 "에디터에서 열기". 근거는 초안 근거 목록의 위치로 가리키고, 파일 경로는 main이 정한다. */
  | { type: 'open-evidence-in-editor'; bundleId: number; evidenceIndex: number }
  /** 에디터 고르기 창에서 에디터를 골랐다. 기억하고 그 파일을 연다. */
  | { type: 'choose-editor'; appId: string }
  /** 에디터 고르기 창을 고르지 않고 닫는다. */
  | { type: 'close-editor-picker' }
  /** 설정 "일반"에서 에디터를 고르거나 명령을 직접 지정한다. `null`이면 다음에 열 때 다시 고른다. */
  | { type: 'set-editor'; choice: EditorChoiceSnapshot | null }
  /** [최근 멘션으로 시험]. 그 창에 멘션 고르기 목록을 열고 최근 멘션을 불러온다. 감지 전이거나 시험 묶음이 있으면 main이 무시한다. */
  | { type: 'open-trial-picker'; window: TrialWindowSnapshot }
  /** 멘션 고르기 목록의 최근 멘션을 다시 불러온다. */
  | { type: 'reload-trial-picker' }
  /** 멘션 고르기 목록을 닫는다. */
  | { type: 'close-trial-picker' }
  /** 멘션 고르기 목록에서 고른 멘션으로 시험을 시작한다. 목록에 없는 알림 ID는 main이 받지 않는다. */
  | { type: 'start-trial'; alarmId: string }
  /** [시험 끝내기]. 시험 묶음과 실행 기록을 지운다. 시험 묶음이 아니면 main이 무시한다. */
  | { type: 'end-trial'; bundleId: number }
  /** 추가 지침을 저장한다. 여러 줄 입력이라 칸을 벗어날 때 보낸다. 다음 실행부터 쓴다. */
  | { type: 'set-extra-instructions'; text: string }
  /**
   * 비밀 파일 패턴을 추가한다. 빈 패턴은 받지 않고, 앞뒤 공백 정리, 쓸 수 없는 글자와 이미 있는 패턴 판단은 main이 한다.
   * 실행 중인 실행을 새 패턴으로 다시 돌리고, 게시하지 않은 초안의 근거를 다시 검사한다.
   */
  | { type: 'add-secret-pattern'; pattern: string }
  /** 설정 "일반"의 [알림 시험]. 시험 알림을 하나 띄운다. */
  | { type: 'test-notification' };

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

/** 작업 폴더·저장소 매핑 명령에 실을 수 있는 경로인지 확인한다. 목록이나 제안에 있는 경로인지는 main이 본다. */
function isWorkFolderPathInput(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= WORK_FOLDER_PATH_MAX_LENGTH;
}

/** 저장소 매핑 명령에 실을 수 있는 Flow 프로젝트 ID인지 확인한다. 참여 목록이나 매핑에 있는 ID인지는 main이 본다. */
function isFlowProjectIdInput(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= FLOW_PROJECT_ID_MAX_LENGTH;
}

/** 묶음 명령에 실을 수 있는 묶음 ID인지 확인한다. 있는 묶음인지는 main이 본다. */
function isBundleIdInput(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** 초안 편집 명령에 실을 수 있는 편집기 텍스트인지 확인한다. 빈 텍스트도 받는다. */
function isDraftTextInput(value: unknown): value is string {
  return typeof value === 'string' && value.length <= DRAFT_TEXT_MAX_LENGTH;
}

/** 받는 사람 빼기 명령에 실을 수 있는 이름인지 확인한다. 이름이 비어 있는 받는 사람도 있으므로 빈 이름도 받는다. */
function isRecipientNameInput(value: unknown): value is string {
  return typeof value === 'string' && value.length <= RECIPIENT_NAME_MAX_LENGTH;
}

/** 지시나 고친 요구로 실을 수 있는 글인지 확인한다. 공백만 있는 글은 받지 않는다. */
function isRegenerationTextInput(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= REGENERATION_TEXT_MAX_LENGTH;
}

/** 에디터 고르기 명령에 실을 수 있는 에디터 ID인지 확인한다. 찾은 에디터인지는 main이 본다. */
function isEditorAppIdInput(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= EDITOR_APP_ID_MAX_LENGTH;
}

/** 에디터 직접 지정 명령에 실을 수 있는 값인지 확인한다. `{file}` 자리가 있는지와 따옴표는 main이 본다. */
function isEditorChoiceInput(value: unknown): value is EditorChoiceSnapshot | null {
  if (value === null) return true;
  if (typeof value !== 'object') return false;
  /** 필드를 읽기 위해 객체로 본 값. */
  const choice = value as Record<string, unknown>;
  if (choice.kind === 'app') return isEditorAppIdInput(choice.appId);
  return choice.kind === 'command' && typeof choice.command === 'string' && choice.command.trim() !== '' && choice.command.length <= EDITOR_COMMAND_MAX_LENGTH;
}

/** 멘션 고르기 목록을 여는 창 이름인지 확인한다. */
function isTrialWindow(value: unknown): value is TrialWindowSnapshot {
  return typeof value === 'string' && (TRIAL_WINDOWS as readonly string[]).includes(value);
}

/** 시험 시작 명령에 실을 수 있는 알림 ID인지 확인한다. 목록에 있는 알림인지는 main이 본다. */
function isAlarmIdInput(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,32}$/.test(value);
}

/** 묶음을 보는 창 이름인지 확인한다. */
function isReviewWindow(value: unknown): value is ReviewWindow {
  return typeof value === 'string' && (REVIEW_WINDOWS as readonly string[]).includes(value);
}

/** 접고 펴는 영역 이름인지 확인한다. */
function isReviewSection(value: unknown): value is ReviewSection {
  return typeof value === 'string' && (REVIEW_SECTIONS as readonly string[]).includes(value);
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
    case 'add-suggested-work-folder':
    case 'remove-work-folder':
      return isWorkFolderPathInput(candidate.path) ? { type: candidate.type, path: candidate.path } : null;
    case 'pick-mapping-repos':
    case 'remove-repo-mapping':
      return isFlowProjectIdInput(candidate.projectId) ? { type: candidate.type, projectId: candidate.projectId } : null;
    case 'remove-mapping-repo':
      return isFlowProjectIdInput(candidate.projectId) && isWorkFolderPathInput(candidate.path)
        ? { type: 'remove-mapping-repo', projectId: candidate.projectId, path: candidate.path }
        : null;
    case 'set-repo-picker-checked':
      return isWorkFolderPathInput(candidate.path) && typeof candidate.checked === 'boolean'
        ? { type: 'set-repo-picker-checked', path: candidate.path, checked: candidate.checked }
        : null;
    case 'set-launch-at-login':
      return typeof candidate.enabled === 'boolean' ? { type: 'set-launch-at-login', enabled: candidate.enabled } : null;
    case 'edit-draft':
      return isBundleIdInput(candidate.bundleId) && isDraftTextInput(candidate.text) ? { type: 'edit-draft', bundleId: candidate.bundleId, text: candidate.text } : null;
    case 'remove-recipient':
      return isBundleIdInput(candidate.bundleId) && Number.isSafeInteger(candidate.index) && (candidate.index as number) >= 0 && isRecipientNameInput(candidate.name)
        ? { type: 'remove-recipient', bundleId: candidate.bundleId, index: candidate.index as number, name: candidate.name }
        : null;
    case 'regenerate-with-directive':
      return isBundleIdInput(candidate.bundleId) && isRegenerationTextInput(candidate.directive)
        ? { type: 'regenerate-with-directive', bundleId: candidate.bundleId, directive: candidate.directive }
        : null;
    case 'fix-requirement':
      return isBundleIdInput(candidate.bundleId) && isRegenerationTextInput(candidate.requirement)
        ? { type: 'fix-requirement', bundleId: candidate.bundleId, requirement: candidate.requirement }
        : null;
    case 'ignore-bundle':
    case 'restore-bundle':
    case 'regenerate-bundle':
    case 'revert-draft-edit':
    case 'cancel-generation':
    case 'retry-bundle':
    case 'open-bundle-in-flow':
    case 'link-bundle-repos':
    case 'open-repo-picker':
    case 'post-bundle':
    case 'cancel-posting':
    case 'end-trial':
      return isBundleIdInput(candidate.bundleId) ? { type: candidate.type, bundleId: candidate.bundleId } : null;
    case 'expand-review':
    case 'collapse-review':
      return candidate.bundleId === null || isBundleIdInput(candidate.bundleId) ? { type: candidate.type, bundleId: candidate.bundleId } : null;
    case 'set-review-section':
      return isReviewWindow(candidate.window) && isReviewSection(candidate.section) && typeof candidate.open === 'boolean'
        ? { type: 'set-review-section', window: candidate.window, section: candidate.section, open: candidate.open }
        : null;
    case 'open-evidence-in-editor':
      return isBundleIdInput(candidate.bundleId) && Number.isSafeInteger(candidate.evidenceIndex) && (candidate.evidenceIndex as number) >= 0
        ? { type: 'open-evidence-in-editor', bundleId: candidate.bundleId, evidenceIndex: candidate.evidenceIndex as number }
        : null;
    case 'open-trial-picker':
      return isTrialWindow(candidate.window) ? { type: 'open-trial-picker', window: candidate.window } : null;
    case 'set-extra-instructions':
      return typeof candidate.text === 'string' && candidate.text.length <= EXTRA_INSTRUCTIONS_MAX_LENGTH ? { type: 'set-extra-instructions', text: candidate.text } : null;
    case 'add-secret-pattern':
      return typeof candidate.pattern === 'string' && candidate.pattern.trim() !== '' && candidate.pattern.length <= SECRET_PATTERN_MAX_LENGTH
        ? { type: 'add-secret-pattern', pattern: candidate.pattern }
        : null;
    case 'start-trial':
      return isAlarmIdInput(candidate.alarmId) ? { type: 'start-trial', alarmId: candidate.alarmId } : null;
    case 'choose-editor':
      return isEditorAppIdInput(candidate.appId) ? { type: 'choose-editor', appId: candidate.appId } : null;
    case 'set-editor': {
      if (!isEditorChoiceInput(candidate.choice)) return null;
      /** 받은 에디터. 렌더러가 덧붙인 다른 필드는 버린다. */
      const choice = candidate.choice;
      return {
        type: 'set-editor',
        choice: choice === null ? null : choice.kind === 'app' ? { kind: 'app', appId: choice.appId } : { kind: 'command', command: choice.command },
      };
    }
    case 'close-editor-picker':
    case 'confirm-flow-account-switch':
    case 'cancel-flow-key-check':
    case 'check-agent':
    case 'rediscover-agent':
    case 'pick-agent-cli':
    case 'copy-agent-fix-command':
    case 'pick-work-folders':
    case 'refresh-work-folders':
    case 'refresh-repo-mappings':
    case 'start-detection':
    case 'pick-repo-picker-folders':
    case 'link-repo-picker':
    case 'generate-with-repo-picker':
    case 'close-repo-picker':
    case 'reload-trial-picker':
    case 'close-trial-picker':
    case 'test-notification':
      return { type: candidate.type };
    default:
      return null;
  }
}
