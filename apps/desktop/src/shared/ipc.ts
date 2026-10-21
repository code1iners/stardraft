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

/** 멘션 묶음의 상태. 생성 중, 준비됨, 저장소 확인 필요, 실패, 무시함, 이미 답함이다. */
export type BundleStatusSnapshot = 'generating' | 'ready' | 'repo-check-needed' | 'failed' | 'ignored' | 'already-answered';

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
  /** Flow 원문. */
  text: TextPartSnapshot[];
}

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
}

/** 초안 문장 하나. */
export interface DraftSentenceSnapshot {
  /** 문장. */
  text: string;
  /** 이 문장을 뒷받침하는 근거 번호. 비어 있으면 "근거 없음"이다. */
  evidence: number[];
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
  /** 저장소를 자동 선택으로 정했으면 그 내력. 저장소 매핑으로 정했으면 `null`. */
  autoSelection: AutoSelectionSnapshot | null;
}

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
  /** 연결된 저장소 폴더를 찾을 수 없음. `paths`는 찾을 수 없는 폴더의 절대 경로다. */
  | { kind: 'missing-folders'; paths: string[] }
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
  /** 멘션 묶음과 창마다 영역 펼침 상태. */
  review: ReviewSnapshot;
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
  /** 멘션 묶음이나 영역 펼침 상태가 바뀌었다. */
  | { type: 'review-changed'; review: ReviewSnapshot }
  /** 이미 열린 창에 이 묶음을 보이라고 알린다. OS 알림을 눌렀을 때 온다. */
  | { type: 'review-bundle-requested'; bundleId: number };

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
  /** 작은 창을 닫고 펼친 창을 연다. 보고 있던 묶음을 고른 채로 연다. */
  | { type: 'expand-review'; bundleId: number | null }
  /** 펼친 창을 닫고 작은 창을 연다. 보고 있던 묶음을 고른 채로 연다. */
  | { type: 'collapse-review'; bundleId: number | null }
  /** 창의 영역을 접거나 편다. */
  | { type: 'set-review-section'; window: ReviewWindow; section: ReviewSection; open: boolean };

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
    case 'set-launch-at-login':
      return typeof candidate.enabled === 'boolean' ? { type: 'set-launch-at-login', enabled: candidate.enabled } : null;
    case 'ignore-bundle':
    case 'restore-bundle':
    case 'cancel-generation':
    case 'retry-bundle':
    case 'open-bundle-in-flow':
      return isBundleIdInput(candidate.bundleId) ? { type: candidate.type, bundleId: candidate.bundleId } : null;
    case 'expand-review':
    case 'collapse-review':
      return candidate.bundleId === null || isBundleIdInput(candidate.bundleId) ? { type: candidate.type, bundleId: candidate.bundleId } : null;
    case 'set-review-section':
      return isReviewWindow(candidate.window) && isReviewSection(candidate.section) && typeof candidate.open === 'boolean'
        ? { type: 'set-review-section', window: candidate.window, section: candidate.section, open: candidate.open }
        : null;
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
      return { type: candidate.type };
    default:
      return null;
  }
}
