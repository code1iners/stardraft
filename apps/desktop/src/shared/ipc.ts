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
export const SETTINGS_SECTIONS = ['flow-account', 'sentry', 'agent', 'repositories', 'drafts', 'general'] as const;

/** 설정 창의 칸 하나. */
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

/** 설정 "일반" 칸에서 여는 폴더. 경로는 main이 정하고 렌더러는 이름만 보낸다. */
export const APP_FOLDERS = ['data', 'logs'] as const;

/** 여는 폴더 하나. `data`는 데이터 폴더, `logs`는 진단 로그 폴더다. */
export type AppFolder = (typeof APP_FOLDERS)[number];

/** 앱이 여는 다운로드 사이트의 섹션. 주소는 main이 정하고 렌더러는 이름만 보낸다. */
export const SITE_SECTIONS = ['update', 'changelog'] as const;

/** 다운로드 사이트의 섹션 하나. `update`는 업데이트 섹션([사이트에서 받기]), `changelog`는 변경 내역 섹션([변경 내역])이다. */
export type SiteSection = (typeof SITE_SECTIONS)[number];

/** 키 확인 명령이 받는 키의 최대 길이. 이보다 긴 값은 키가 아니므로 main에 보내지 않는다. */
export const FLOW_API_KEY_MAX_LENGTH = 512;

/** 토큰 확인 명령이 받는 Sentry 토큰의 최대 길이. 이보다 긴 값은 토큰이 아니므로 main에 보내지 않는다. */
export const SENTRY_TOKEN_MAX_LENGTH = 512;

/** 앱이 실행할 수 있는 에이전트. */
export const AGENT_IDS = ['claude-code', 'codex'] as const;

/** 에이전트 하나. */
export type AgentId = (typeof AGENT_IDS)[number];

/** 모델 고르기 명령이 받는 모델 이름의 최대 길이. */
export const AGENT_MODEL_MAX_LENGTH = 200;

/** 저장소 매핑 명령이 받는 경로의 최대 길이. */
export const REPO_FOLDER_PATH_MAX_LENGTH = 4096;

/** 저장소 매핑 명령이 받는 Flow 프로젝트 ID의 최대 길이. */
export const FLOW_PROJECT_ID_MAX_LENGTH = 64;

/** Sentry 프로젝트 명령이 받는 프로젝트 ID의 최대 길이. */
export const SENTRY_PROJECT_ID_MAX_LENGTH = 64;

/** Sentry 프로젝트의 환경 필터 이름의 최대 길이. */
export const SENTRY_ENVIRONMENT_MAX_LENGTH = 64;

/** 재현 도구 권한 명령이 받는 MCP 서버 이름의 최대 길이. */
export const REPRODUCTION_SERVER_NAME_MAX_LENGTH = 200;

/** 재현 도구 권한의 방식. `auto`는 범위의 MCP 서버를 모두 싣고 `manual`은 사용자가 켠 서버만 싣는다. */
export const REPRODUCTION_TOOL_MODES = ['auto', 'manual'] as const;

/** 재현 도구 권한의 방식 하나. */
export type ReproductionToolModeId = (typeof REPRODUCTION_TOOL_MODES)[number];

/** 레벨 필터로 고를 수 있는 Sentry 레벨. 심각한 순서다. */
export const SENTRY_LEVEL_IDS = ['fatal', 'error', 'warning', 'info', 'debug'] as const;

/** Sentry 오류 이슈 레벨 하나. */
export type SentryLevelId = (typeof SENTRY_LEVEL_IDS)[number];

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

/** 업데이트 띠 닫기 명령이 받는 띠 이름의 최대 길이. 띠 이름은 상태와 버전(`signature-failed:0.2.0`)이다. */
export const UPDATE_BANNER_MAX_LENGTH = 100;

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
  /** 다른 계정의 키라서, 지금 계정의 기록을 보관하고 바꿀지 확인을 기다린다. `stored`는 그 계정의 기록을 보관해 두었는지 여부다. */
  | { status: 'awaiting-confirmation'; account: FlowAccountProfile; stored: boolean };

/** 키 확인이 실패한 이유. */
export type FlowKeyCheckFailure = 'unauthorized' | 'network' | 'rate-limited' | 'unexpected' | 'save-failed';

/** "Flow 계정" 칸이 그릴 상태. */
export interface FlowAccountSnapshot {
  /** 키 확인에 성공한 계정. 아직 없으면 `null`. */
  account: FlowAccountProfile | null;
  /** 키 확인의 진행 상태. */
  keyCheck: FlowKeyCheckState;
}

/** "Sentry" 칸의 토큰 카드에 보일 조직. 지역 주소는 화면에 쓰지 않으므로 넘기지 않는다. */
export interface SentryOrganizationSnapshot {
  /** 조직 이름. */
  name: string;
}

/** 토큰 확인의 진행 상태. */
export type SentryTokenCheckState = { status: 'idle' } | { status: 'checking' };

/** 토큰 확인이 실패한 이유. `scope-missing`은 `org:read`가 빠진 것, `no-organizations`는 보이는 조직이 없는 것이다. */
export type SentryTokenCheckFailure =
  | 'unauthorized'
  | 'scope-missing'
  | 'no-organizations'
  | 'network'
  | 'rate-limited'
  | 'unexpected'
  | 'save-failed';

/** "Sentry" 칸이 그릴 상태. */
export interface SentryConnectionSnapshot {
  /** 토큰을 연결했는지 여부. 거부됐거나 읽을 수 없는 토큰도 연결한 것으로 본다. 아니면 토큰 입력만 보인다. */
  connected: boolean;
  /** 토큰으로 보이는 조직. */
  organizations: SentryOrganizationSnapshot[];
  /** 토큰 확인의 진행 상태. */
  tokenCheck: SentryTokenCheckState;
  /** "토큰 확인 필요"의 이유. 문제가 없으면 `null`. 다른 전역 문제에 가려도 토큰 카드는 이 값으로 이유를 보인다. */
  tokenProblem: SentryTokenProblemReason | null;
}

/** 등록한 Sentry 프로젝트에 닿는지 확인한 상태. `inaccessible`이면 그 프로젝트 줄만 "접근 불가"를 보인다. */
export type SentryProjectAccessSnapshot = 'unchecked' | 'ok' | 'inaccessible';

/** 등록한 Sentry 프로젝트의 저장소 매핑. */
export interface SentryRepoSnapshot {
  /** 저장소 폴더의 절대 경로. */
  path: string;
  /** 폴더가 있는지 확인한 상태. */
  status: MappedRepoStatus;
}

/** 진단하려고 등록한 Sentry 프로젝트 하나. */
export interface SentryProjectSnapshot {
  /** 프로젝트 ID. 편집·등록 해제·저장소 명령에 실어 보낸다. */
  projectId: string;
  /** 화면에 보일 조직 이름. */
  organizationName: string;
  /** 화면에 보일 프로젝트 이름. */
  projectName: string;
  /** 환경 필터. `null`이면 모든 환경이다. */
  environment: string | null;
  /** 레벨 필터. */
  levels: SentryLevelId[];
  /** 매핑된 저장소. 매핑이 없으면 `null`. */
  repo: SentryRepoSnapshot | null;
  /** 프로젝트에 닿는지 확인한 상태. */
  access: SentryProjectAccessSnapshot;
  /** 저장소 매핑이 없어 기다리는 진단 수. "저장소 매핑 없음 · n건 대기"의 n이다. */
  waitingCount: number;
}

/** 등록할 수 있는 Sentry 프로젝트 하나. */
export interface SentryCandidateSnapshot {
  /** 프로젝트 ID. */
  projectId: string;
  /** 화면에 보일 조직 이름. */
  organizationName: string;
  /** 화면에 보일 프로젝트 이름. */
  projectName: string;
  /** 프로젝트에 이벤트가 들어온 환경. 환경 필터를 이 목록에서 고른다. */
  environments: string[];
}

/** 등록할 프로젝트 목록을 받지 못한 이유. `no-token`은 토큰이 없거나 "토큰 확인 필요"인 것이다. */
export type SentryCandidatesFailure = 'no-token' | 'unauthorized' | 'scope-missing' | 'network' | 'rate-limited' | 'unexpected';

/** 등록할 프로젝트 목록의 상태. `incomplete`는 일부 조직의 목록을 받지 못했다는 뜻이다. */
export type SentryCandidatesSnapshot =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; projects: SentryCandidateSnapshot[]; incomplete: boolean }
  | { status: 'failed'; reason: SentryCandidatesFailure };

/** 설정 "Sentry" 칸의 프로젝트 목록과 "저장소" 칸 `Sentry` 탭이 그릴 상태. */
export interface SentryProjectsSnapshot {
  /** 등록한 프로젝트. 등록한 순서다. */
  projects: SentryProjectSnapshot[];
  /** 등록할 수 있는 프로젝트 목록. */
  candidates: SentryCandidatesSnapshot;
}

/** 프로젝트 등록이나 편집이 끝난 결과. 모달이 닫히거나 이유를 보인다. */
export type SentryProjectSaveResult =
  | 'registered'
  | 'updated'
  | 'no-token'
  | 'token-problem'
  | 'unknown-project'
  | 'already-registered'
  | 'not-registered'
  | 'invalid-filter'
  | 'unauthorized'
  | 'scope-missing'
  | 'project-unavailable'
  | 'network'
  | 'rate-limited'
  | 'unexpected'
  | 'save-failed';

/** 재현 설정 화면의 저장소 한 줄. */
export interface ReproductionRepoSnapshot {
  /** 저장소 절대 경로. 명령에 실어 보낸다. */
  path: string;
  /** 재현 허용 여부. */
  enabled: boolean;
  /** 재현용 환경 파일 절대 경로. `null`이면 지정 안 함(원본 `.env` 사용)이다. */
  envFile: string | null;
  /** 지정한 환경 파일이 없어졌는지 여부. */
  envFileMissing: boolean;
}

/** MCP 서버의 연결 종류. */
export type ReproductionServerKind = 'stdio' | 'http' | 'sse' | 'ws' | 'unknown';

/** 재현 도구 권한 목록의 MCP 서버 한 줄. 서버 정의의 값(환경 변수, 헤더)은 담지 않는다. */
export interface ReproductionServerSnapshot {
  /** 서버가 등록된 CLI. */
  agent: AgentId;
  /** 서버 이름. */
  name: string;
  /** 연결 종류. */
  kind: ReproductionServerKind;
  /** 외부로 보낼 수 있는 서버인지 여부. "외부로 보냄" 꼬리표를 붙인다. */
  external: boolean;
  /** 앱이 고정으로 뺀 위험 도구. */
  deniedTools: string[];
  /** `직접 선택`에서 켠 서버인지 여부. */
  enabled: boolean;
}

/** 설정 "저장소" 칸의 재현 항목과 "에이전트" 칸 `재현` 탭이 그릴 상태. */
export interface ReproductionSnapshot {
  /** 재현을 지원하는 OS인지 여부. 거짓이면 재현 항목과 `재현` 탭을 그리지 않는다. */
  supported: boolean;
  /** 재현 허용을 정할 수 있는 저장소. 매핑된 저장소마다 한 줄이다. */
  repos: ReproductionRepoSnapshot[];
  /** 재현 도구 권한. */
  tools: {
    /** 방식. */
    mode: ReproductionToolModeId;
    /** MCP 서버 목록을 읽은 상태. */
    status: 'idle' | 'loading' | 'loaded';
    /** 목록의 서버. */
    servers: ReproductionServerSnapshot[];
    /** Codex 목록 명령이 실패해 Codex 서버를 읽지 못했는지 여부. */
    codexListFailed: boolean;
  };
}

/** 재현을 켜거나 환경 파일을 정한 결과. 확인 모달이 닫히거나 이유를 보인다. */
export type ReproductionSaveResult = 'saved' | 'invalid-env-file' | 'not-mapped' | 'unsupported';

/** 감지를 멈추게 하는 전역 문제. 작은 창 띠, 트레이 메뉴, OS 알림에 하나만 보인다. */
export type GlobalProblemSnapshot =
  /** 키 확인 필요. */
  | { cause: 'flow-key'; reason: FlowKeyProblemReason }
  /** 토큰 확인 필요. Sentry 감지만 멈춘다. */
  | { cause: 'sentry-token'; reason: SentryTokenProblemReason }
  /** 에이전트 확인 필요. `agent`는 실패한 에이전트다. */
  | { cause: 'agent'; agent: AgentId; reason: AgentProblemReason };

/** "키 확인 필요"가 생긴 이유. `rejected`는 Flow가 키를 거부한 것(`401`), `unreadable`은 저장된 키를 읽을 수 없는 것이다. */
export type FlowKeyProblemReason = 'rejected' | 'unreadable';

/** "토큰 확인 필요"가 생긴 이유. 거부(`401`), scope 부족(`403`), 저장된 토큰을 읽을 수 없음이다. */
export type SentryTokenProblemReason = 'rejected' | 'scope-missing' | 'unreadable';

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
  /** `apiKeyHelper`로만 인증한다(Claude Code). 앱은 이 방식을 지원하지 않는다. */
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
  /** 터미널에서 이 CLI를 부르는 말(`claude`·`codex` 또는 따옴표로 감싼 절대 경로). */
  cliCommand: string;
  /** 이 CLI를 업데이트하는 명령. Homebrew 설치본은 brew 명령이다. */
  updateCommand: string;
  /** 읽은 CLI 버전. */
  version: string | null;
  /** 필요한 가장 낮은 버전. */
  requiredVersion: string;
  /** 로그인 방식(Claude Code의 `claude.ai`·`api_key_helper`, Codex의 `chatgpt`·`api-key` 등). */
  authMethod: string | null;
  /** 자식 프로세스 PATH의 출처. 아직 읽지 않았으면 `null`. */
  pathSource: PathSource | null;
  /** PATH 말고 찾아본 알려진 설치 위치. */
  searchedDirs: string[];
  /** 실패한 CLI 명령의 오류 원문. */
  errorOutput: string | null;
}

/** 설정 "에이전트" 칸의 연결 표시가 그릴 에이전트 하나의 상태. */
export interface AgentConnectionSnapshot {
  /** 확인하는 에이전트. */
  agent: AgentId;
  /** 진행 상태. */
  progress: AgentCheckProgress;
  /** 마지막으로 끝난 찾기 단계가 CLI를 찾았는지 여부. 다시 확인하는 동안에도 앞 확인의 값이다. */
  cliFound: boolean;
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

/** 저장소 매핑이 없어 묶음이 기다리는 Flow 프로젝트 하나. 설정 "저장소" 칸 맨 위에 "저장소 매핑 없음 · n건 대기"로 보인다. */
export interface WaitingRepoProjectSnapshot {
  /** Flow 프로젝트 ID. [폴더 고르기…] 명령에 실어 보낸다. */
  projectId: string;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  title: string | null;
  /** 저장소 매핑 필요로 기다리는 묶음 수. */
  waitingCount: number;
}

/** 설정 "저장소" 칸의 저장소 매핑. */
export interface RepoMappingsSnapshot {
  /** 저장된 매핑. */
  mappings: RepoMappingSnapshot[];
  /** 매핑이 없어 묶음이 기다리는 Flow 프로젝트. 대기 건수가 많은 순이다. */
  waiting: WaitingRepoProjectSnapshot[];
  /** 매핑에서 고를 참여 Flow 프로젝트 목록. */
  projects: ParticipantProjectsSnapshot;
}

/** 감지를 시작하기 전에 필요한 필수 설정. 에이전트 연결 하나다. */
export const SETUP_REQUIREMENTS = ['agent'] as const;

/** 필수 설정 하나. `agent`는 에이전트 연결이다. */
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
  /** 필수 설정의 상태. */
  requirements: Record<SetupRequirement, SetupRequirementStatus>;
  /** 필수 설정이 모두 되어 [감지 시작]을 보일 수 있는지 여부. */
  ready: boolean;
  /** 감지할 대상(Flow 계정, Sentry)을 하나라도 연결했는지 여부. 없으면 [감지 시작] 위에 안내 문구를 보인다. */
  hasDetectionTarget: boolean;
  /** Flow 계정이 연결되어 있고 "키 확인 필요"가 없는지 여부. 체크리스트 Flow 줄이 `✓`나 "연결 안 함"을 보인다. */
  flowConnected: boolean;
  /** Sentry 토큰이 연결되어 있고 "토큰 확인 필요"가 없는지 여부. 체크리스트 Sentry 줄이 `✓`나 "연결 안 함"을 보인다. */
  sentryConnected: boolean;
  /** [감지 시작]의 진행 상태. */
  start: DetectionStartSnapshot;
}

/** 설정 "초안" 칸의 추가 지침과 비밀 파일 패턴. */
export interface DraftSettingsSnapshot {
  /** 모든 초안에 적용할 추가 지침. 기본 지침 뒤에 붙는다. */
  extraInstructions: string;
  /** 앱에 넣어 둔 비밀 파일 패턴. 읽기 전용이다. */
  defaultSecretPatterns: string[];
  /** 사용자가 추가한 비밀 파일 패턴. 추가한 순서이고 뺄 수 없다. */
  extraSecretPatterns: string[];
}

/** 최근 멘션 확인 시트를 여는 창. 작은 창의 빈 화면(`popover`)이나 설정 "초안" 칸(`settings`)이다. */
export const MANUAL_CHECK_WINDOWS = ['popover', 'settings'] as const;

/** 최근 멘션 확인 시트를 여는 창 하나. */
export type ManualCheckWindowSnapshot = (typeof MANUAL_CHECK_WINDOWS)[number];

/** 최근 멘션을 불러오지 못한 까닭. 쓸 키 없음, 키 거부, 연결 실패, 요청 한도, 그 밖이다. */
export type ManualCheckLoadFailureSnapshot = 'no-key' | 'unauthorized' | 'network' | 'rate-limited' | 'unexpected';

/**
 * 줄에 붙는 상태 태그. 여러 개가 함께 붙을 수 있다.
 * - `answered`: 멘션보다 나중에 쓴 내 답이 묶음 자리에 있다("답함"). 그래도 고를 수 있다.
 * - `bundle`: 그 위치에 이미 묶음이 있다("이미 묶음 있음"과 그 묶음의 상태). 고르면 그 묶음으로 이동한다.
 * - `archived`: 처리한 지 7일이 지나 최소 기록만 남았다("처리됨"). 고르면 새 묶음을 만든다.
 */
export type ManualCheckRowTagSnapshot = { kind: 'answered' } | { kind: 'bundle'; bundleId: number; status: BundleStatusSnapshot } | { kind: 'archived' };

/** 최근 멘션 확인 시트의 탭. 멘션이 기본이다. */
export const MANUAL_CHECK_TABS = ['mentions', 'assignments'] as const;

/** 최근 멘션 확인 시트의 탭 하나. */
export type ManualCheckTabSnapshot = (typeof MANUAL_CHECK_TABS)[number];

/**
 * 담당 업무 감지가 자동으로 가져오지 않은 까닭. 담당 업무 줄에 태그로 보인다.
 * 기능 시작 전 업무, 기능 시작 전 배정, 자기 작성 업무, 배정 근거 없음이다.
 */
export type ManualCheckMissReasonSnapshot = 'pre-feature-task' | 'pre-feature-assignment' | 'self-authored' | 'no-evidence';

/** 최근 멘션 확인 시트의 줄 하나. 멘션 줄과 담당 업무 줄이 있다. */
export interface ManualCheckRowSnapshot {
  /** 항목 종류. 멘션이거나 담당 업무다. */
  kind: 'mention' | 'assignment';
  /** 고를 때 보내는 알림 ID. 지금 보는 탭의 목록에서 찾는다. */
  alarmId: string;
  /** 멘션이면 송신자, 담당 업무면 업무 작성자의 이름. 비어 있을 수 있다. */
  senderName: string;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: string | null;
  /** 멘션이면 글의 첫 줄(멘션 표기는 `@이름`), 담당 업무면 업무 제목. */
  firstLine: string;
  /** 멘션이면 멘션 시각, 담당 업무면 가장 최근 알림 시각(Unix epoch 밀리초). */
  at: number;
  /** 줄 상태 태그. 없으면 빈 배열. */
  tags: ManualCheckRowTagSnapshot[];
  /** 담당 업무 줄에서 감지에서 빠진 이유. 없으면 빈 배열이고, 멘션 줄은 항상 빈 배열이다. */
  missReasons: ManualCheckMissReasonSnapshot[];
}

/**
 * 열린 최근 멘션 확인 시트. 지금 보는 탭(`tab`)의 목록 상태를 담는다. 다른 탭의 상태는 main이 들고 탭을 바꾸면 그 탭의 상태가 온다.
 * 담당 업무 탭을 처음 열기 전에는 곧바로 불러오기 시작하므로 `loading`이다.
 */
export type ManualCheckSheetSnapshot =
  /** 처음 불러오는 중이다. */
  | { window: ManualCheckWindowSnapshot; tab: ManualCheckTabSnapshot; status: 'loading' }
  /** 불러왔다. 최신이 앞이다. `hasMore`면 [더 보기]를 보이고, `loadingMore`는 이어 불러오는 중, `moreFailure`는 이어 불러오지 못한 까닭이다. */
  | {
      window: ManualCheckWindowSnapshot;
      tab: ManualCheckTabSnapshot;
      status: 'loaded';
      rows: ManualCheckRowSnapshot[];
      hasMore: boolean;
      loadingMore: boolean;
      moreFailure: ManualCheckLoadFailureSnapshot | null;
    }
  /** 불러오지 못했다. */
  | { window: ManualCheckWindowSnapshot; tab: ManualCheckTabSnapshot; status: 'failed'; reason: ManualCheckLoadFailureSnapshot };

/** 최근 멘션 확인의 상태. */
export interface ManualCheckSnapshot {
  /** 지금 시트를 열 수 있는지 여부. 감지를 시작했고 쓸 수 있는 Flow 키가 있어야 한다. */
  canOpen: boolean;
  /** 열린 시트. 닫혀 있으면 `null`. */
  sheet: ManualCheckSheetSnapshot | null;
}

/** 멘션 묶음의 상태. 생성 중, 준비됨, 저장소 확인 필요, 게시 중, 실패, 게시 실패, 게시됨, 무시함, 이미 답함, 원문 사라짐, 담당 해제다. */
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
  | 'source-gone'
  | 'unassigned';

/**
 * 게시 실패의 사유. 권한 없음(`403`), 지워짐(`404`, `412`), 받지 않음(`400`, `422` 등), 요청 한도 초과(`429` 두 번),
 * 응답 없음(응답이 없거나 `5xx`였고 다시 조회해도 올라간 글이 없음), 앱 종료(응답을 받기 전에 앱이 꺼졌고 다시 켜 조회해도 올라간 글이 없음)다.
 */
export type PostFailureSnapshot = 'forbidden' | 'gone' | 'rejected' | 'rate-limited' | 'no-response' | 'app-quit';

/**
 * 게시를 누를 때의 확인이 게시를 멈춘 까닭. 이미 답함, 원문 사라짐, 담당 해제, 또는 [게시]를 누를 때 화면에 없던 변화다.
 * 변화면 확인이 끝나기 전에 합쳐진 새 멘션 수, 새로 생긴 글 수(나를 멘션한 글 포함), 원문 수정 여부, 새로 사라진 멘션 수를 넘긴다.
 */
export type PostStopSnapshot =
  | { kind: 'already-answered' }
  | { kind: 'source-gone' }
  /** 담당자에서 빠진 것을 확인해 준비됨으로 돌리고 게시를 막았다. */
  | { kind: 'unassigned' }
  | { kind: 'changed'; newMentionCount: number; newWritingCount: number; edited: boolean; goneMentionCount: number }
  /** 카운트다운 중에 추가한 비밀 파일 패턴에 초안의 근거가 맞아 결과를 버렸다. */
  | { kind: 'secret-evidence' };

/** 게시 중 묶음의 단계. */
export type PostingSnapshot =
  /** 게시 취소 카운트다운 중이다. `endsAt`(Unix epoch 밀리초)에 게시 요청을 보내고, 그 전까지 취소할 수 있다. */
  | { phase: 'countdown'; endsAt: number }
  /** 게시 요청을 보냈고 결과를 기다린다. 취소할 수 없다. */
  | { phase: 'sending' };

/** 묶음이 상태로 든 그룹. 검토 대기·생성 중·실패·처리됨이다. 바닥 줄과 처리됨 구분에 쓰고, 펼친 창 목록은 종류별로 묶는다. */
export const BUNDLE_GROUPS = ['awaiting-review', 'generating', 'failed', 'processed'] as const;

/** 묶음의 상태 그룹 하나. */
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

/** 준비된 뒤의 변화 감시가 찾은 변화. 초안 위 알림 줄에 보인다. 트레이 상태는 바꾸지 않는다. */
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
  /** 쓴 저장소 구성을 그 Flow 프로젝트의 저장소 매핑과 견준 것. 저장소 영역의 연결 버튼 문구를 정한다. */
  mapping: MappingMatchSnapshot;
  /** 편집기 텍스트. 편집했으면 편집본, 아니면 원래 초안의 문장을 이은 것이다(근거 번호 없음). */
  editorText: string;
  /** 편집했는지 여부. 참이면 근거 번호를 감추고 "원래 초안으로 되돌리기"를 보인다. */
  edited: boolean;
  /** 편집기를 고치고 받는 사람을 뺄 수 있는지 여부. 준비됨과 게시 실패 묶음만 참이다. */
  canEdit: boolean;
  /** 요구를 고쳐 다시 만들 수 있는지 여부(망치 아이콘). 준비됨 묶음만 참이다. 저장소가 정해지지 않은 초안은 거짓이다. */
  canRegenerate: boolean;
  /**
   * 저장소가 정해지지 않은 초안인지 여부. 사용자가 고른 저장소도 Flow 프로젝트의 저장소 매핑도 없다.
   * 참이면 "다시 만들기"와 "지시를 덧붙여 다시 만들기"가 꺼지고 "다른 저장소로 다시 만들기"만 된다. 게시와 무시는 된다.
   */
  repoUndetermined: boolean;
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

/** 저장소 선택 창의 후보 무리. 지금 쓰는 저장소, 다른 매핑에 쓰인 저장소, "폴더 직접 고르기"로 더한 폴더 순서다. */
export type RepoChoiceGroupSnapshot = 'current' | 'mapping' | 'added';

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
export interface RepoPickerSnapshot {
  /** 창을 연 묶음 ID. */
  bundleId: number;
  /** 후보. */
  choices: RepoChoiceSnapshot[];
  /** 체크한 구성을 그 묶음 Flow 프로젝트의 저장소 매핑과 견준 것. */
  mapping: MappingMatchSnapshot;
}

/** 상세 머리의 실행 줄. "Claude Code · 2분 14초 · 맥락 일부 생략"처럼 보인다. 비용은 넘기지 않는다. */
export interface RunLineSnapshot {
  /** 실행의 종류. 과거 기록의 저장소 선택 실행은 `selection`이고 "저장소 선택(폐지됨)"으로 보인다. */
  kind: GenerationRunKindSnapshot;
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

/** 대상 하나를 만들 때 돌리는 실행의 종류. 초안 실행, 진단 실행과, 과거 기록에만 있는 폐지된 저장소 선택 실행(`selection`)이다. */
export type GenerationRunKindSnapshot = 'selection' | 'draft' | 'diagnosis';

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

/** 저장소 대기의 사유. 저장소 매핑 필요(`unmapped`)와 저장소 확인 필요(`missing-folders`)다. */
export type RepoCheckSnapshot =
  /** 저장소 매핑 필요. 매핑도 사용자가 고른 저장소도 없어 기다린다. */
  | { kind: 'unmapped' }
  /**
   * 연결된 저장소 폴더를 찾을 수 없음. `paths`는 찾을 수 없는 폴더의 절대 경로다.
   * `chosenByUser`면 저장소 매핑이 아니라 저장소 선택 창에서 고른 구성의 폴더라 "고른 저장소 폴더를 찾을 수 없음"으로 보인다.
   */
  | { kind: 'missing-folders'; paths: string[]; chosenByUser: boolean };

/**
 * 저장소 대기 묶음이 바닥 줄에 쓰는 값. 사유와 같은 프로젝트에서 같은 사유로 기다리는 묶음 수(`waitingCount`, 이 묶음 포함)다.
 * 상세에 이유 상자를 두지 않고 노란 바닥 줄 글이 이 값으로 쓰인다.
 */
export type RepoWaitSnapshot = RepoCheckSnapshot & { waitingCount: number };

/** 작은 창과 펼친 창이 그릴 멘션 묶음 하나. */
export interface BundleSnapshot {
  /** 담당 업무 초안의 원문. 직접 멘션과 별도 표시한다. */
  assignment?: {
    text: BundleMentionSnapshot['text'];
    /** 담당자에서 제외된 것을 확인해 게시와 다시 만들기를 막았는지 여부. 직접 멘션이 남은 합친 묶음은 막지 않아 거짓이다. */
    blockedByUnassignment?: boolean;
    /** 배정 시각(Unix epoch 밀리초). 모르면 없다. */
    assignedAt?: number;
    /** 배정 시각이 배정 근거 없이 알림 시각으로 대신한 추정인지 여부. 참이면 상세가 "추정"으로 보인다. */
    assignedAtEstimated?: boolean;
  };
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
  /** 저장소 대기의 사유와 같은 프로젝트에서 같은 사유로 기다리는 묶음 수. 저장소 대기가 아니면 `null`. */
  repoCheck: RepoWaitSnapshot | null;
  /** 게시 중 묶음의 단계. 게시 중이 아니면 `null`. */
  posting: PostingSnapshot | null;
  /** 게시 실패의 사유. 상세 머리에 한 줄로 보인다. 게시 실패가 아니면 `null`. */
  postFailure: PostFailureSnapshot | null;
  /** 카운트다운 중에 앱이 꺼져 게시하지 않고 준비됨으로 돌아왔는지 여부. 참이면 상세 머리에 "앱이 꺼져서 게시하지 않았습니다"를 보인다. */
  quitDuringCountdown: boolean;
  /** 준비된 뒤의 변화 감시가 찾은 변화. 변화가 없으면 모두 0과 거짓이다. */
  changes: BundleChangesSnapshot;
  /** 최근 멘션 확인으로 만든 수동 요청 묶음인지 여부. 참이면 상세 머리에 "수동 요청" 태그를 보인다. */
  manual: boolean;
}

/** 묶음을 보는 창. 작은 창(`compact`)과 펼친 창(`expanded`)이다. */
export const REVIEW_WINDOWS = ['compact', 'expanded'] as const;

/** 묶음을 보는 창 하나. */
export type ReviewWindow = (typeof REVIEW_WINDOWS)[number];

/** 머리를 눌러 접고 펴는 상세 영역. 원문, 에이전트가 이해한 요구, 초안, 근거, 저장소, 진행(생성 중의 진행 단계와 실패의 오류)이다. */
export const REVIEW_SECTIONS = ['original', 'requirement', 'draft', 'evidence', 'repository', 'progress'] as const;

/** 접고 펴는 상세 영역 하나. */
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

/** 진단의 상태. 진행 중(`running`)은 대기 가운데 생성 대기열이 진행하고 있는 진단이다. */
export type DiagnosisStatusSnapshot = 'queued' | 'running' | 'repo-check-needed' | 'ready' | 'failed' | 'completed';

/** 대기·진행 중 진단의 진행. 대기면 앞에 있는 수, 진행 중이면 단계와 읽은 파일 수, 시작한 시각이다. */
export type DiagnosisProgressSnapshot =
  /** 차례를 기다린다. `ahead`는 앞에 있는 대상 수다. 대기열이 아직 넣지 않았으면 `null`. */
  | { status: 'waiting'; ahead: number | null }
  /** 진행 중이다. */
  | { status: 'running'; step: string; filesRead: number; startedAt: number };

/** 재현 칸. 읽기 전용 진단은 앱이 "불가(허용 안 됨)"로 채운다. */
export interface DiagnosisReproductionSnapshot {
  /** 결과. */
  result: 'success' | 'failure' | 'impossible';
  /** 불가의 까닭. 불가가 아니면 `null`. */
  impossibleReason: 'no-tool' | 'insufficient-data' | 'env-failed' | 'not-allowed' | 'timed-out' | null;
  /** 재현에 쓴 방법. */
  method: string;
  /** 재현 순서 또는 시도한 것. */
  steps: string[];
}

/** 진단 보고서. 에이전트가 쓴 칸과 앱이 채운 오류 이슈 정보·실행 정보다. */
export interface DiagnosisReportSnapshot {
  /** 요약. */
  summary: string;
  /** 재현. */
  reproduction: DiagnosisReproductionSnapshot;
  /** 원인과 확신도. 원인 글은 근거를 `[근거 n]`으로 가리킨다. */
  cause: { text: string; confidence: 'high' | 'medium' | 'low' };
  /** 개선 방향. */
  improvements: string[];
  /** 남은 의문. */
  openQuestions: string[];
  /** 근거. Flow 초안의 근거와 같은 필드다. */
  evidence: { id: number; explanation: string; repository: string; path: string; startLine: number; endLine: number; located: boolean }[];
  /** 앱이 Sentry에서 받은 오류 이슈 정보. */
  event: {
    /** 최신 이벤트의 release. */
    release: string | null;
    /** 최초 release. */
    firstRelease: string | null;
    /** 최근 release. */
    lastRelease: string | null;
    /** 소스맵 적용 여부. */
    sourceMaps: 'applied' | 'failed' | 'unknown';
    /** 없는 데이터 항목. */
    missingData: string[];
    /** 스택 앞부분. */
    stackHead: string[];
  };
  /** 실행 정보. */
  run: {
    /** 저장소 경로. */
    repository: string;
    /** HEAD 해시. 모르면 `null`. */
    headCommit: string | null;
    /** 커밋하지 않은 변경 유무. 모르면 `null`. */
    uncommittedChanges: boolean | null;
    /** 에이전트. */
    agent: AgentId;
    /** 에이전트 CLI 버전. 모르면 `null`. */
    cliVersion: string | null;
    /** 재현 허용 여부. */
    reproductionAllowed: boolean;
    /** 걸린 시간(밀리초). */
    durationMs: number;
    /** 생성 시각(Unix epoch 밀리초). */
    createdAt: number;
  };
  /**
   * 같은 오류 이슈의 앞선 진단. 없으면 `null`. 오류 이슈 정보에 적힌다.
   * `in-review`는 앞선 보고서가 검토 대기 중이었던 것, `completed`는 완료한 뒤의 재발이다(완료한 시각과 마지막으로 내보낸 파일 경로, 없으면 `null`).
   */
  priorDiagnosis: { kind: 'in-review' } | { kind: 'completed'; completedAt: number; exportPath: string | null } | null;
  /** 종류나 한도를 넘어 옮기지 않은 첨부 수. 0보다 크면 "첨부 n개 생략"으로 보인다. */
  omittedAttachments: number;
}

/** 진단 실패의 까닭. Flow 초안과 같은 빨간 상자에 사유와 마지막 단계로 보인다. */
export interface DiagnosisFailureSnapshot {
  /**
   * 사유. `sentry-unavailable`은 Sentry에서 오류 데이터를 가져오지 못한 것이고,
   * `repository-unavailable`은 다시 진단하려는데 저장소 매핑이나 폴더가 사라진 것이다.
   */
  reason: DraftFailureReasonSnapshot | 'sentry-unavailable' | 'repository-unavailable';
  /** 에이전트가 알려 준 오류 원문. 없으면 `null`. */
  detail: string | null;
  /** 마지막 단계. 없으면 `null`. */
  lastStep: string | null;
}

/** 저장소 대기 진단의 사유와 바닥 줄 글의 "기다리는 n건". */
export type DiagnosisRepoWaitSnapshot =
  /** 저장소 매핑 필요. `waitingCount`는 같은 프로젝트에서 매핑을 기다리는 진단 수다. */
  | { kind: 'unmapped'; waitingCount: number }
  /** 저장소 확인 필요. `path`는 찾을 수 없는 폴더다. */
  | { kind: 'missing-folder'; path: string; waitingCount: number };

/** 진단에 딸린 첨부 파일 하나. 파일 이름과 크기만 넘긴다. */
export interface DiagnosisAttachmentSnapshot {
  /** 파일 이름. */
  name: string;
  /** 파일 크기(바이트). */
  sizeBytes: number;
}

/** 검토 화면이 그릴 Sentry 진단 하나. */
export interface DiagnosisSnapshot {
  /** 진단 ID. */
  id: number;
  /** 등록한 Sentry 프로젝트 ID. [저장소 매핑하기]가 짚는다. */
  projectId: string;
  /** 신규인지 재발인지. */
  origin: 'new' | 'regression';
  /** 오류 제목. */
  title: string;
  /** 감지한 시각(Unix epoch 밀리초). */
  detectedAt: number;
  /** 상태. */
  status: DiagnosisStatusSnapshot;
  /** 저장소 대기의 사유. 저장소 대기가 아니면 `null`. */
  repoWait: DiagnosisRepoWaitSnapshot | null;
  /** 대기·진행 중의 진행. 대기·진행 중이 아니면 `null`. */
  progress: DiagnosisProgressSnapshot | null;
  /** 진단 보고서. 검토 대기가 아니면 `null`. */
  report: DiagnosisReportSnapshot | null;
  /** 진단 실패의 까닭. 진단 실패가 아니면 `null`. */
  failure: DiagnosisFailureSnapshot | null;
  /**
   * 다시 진단하는 중인지 여부. 대기·진행 중인데 앞선 보고서(`report`)와 첨부를 보관하고 있다.
   * 이 동안 내보내기와 완료를 할 수 없고 목록 태그는 `다시 진단 중`이다.
   */
  rediagnosing: boolean;
  /** 다시 진단에서 쌓인 지시. 덧붙인 순서다. 지시 입력이 "앞서 덧붙인 지시"로 보인다. */
  directives: string[];
  /** 마지막 다시 진단이 실패하거나 취소해 앞선 보고서로 돌아왔다는 사유. 보고서 위 알림 줄과 [다시 걸기]가 보인다. 없으면 `null`. */
  rediagnosisFailure: DiagnosisFailureSnapshot | null;
  /** 완료한 시각. 완료가 아니면 `null`. */
  completedAt: number | null;
  /** 지금 보이는 보고서를 내보낸 적이 있는지 여부. 거짓이면 [완료]가 "내보내지 않았습니다" 확인을 거친다. */
  exported: boolean;
  /** 마지막으로 내보낸 파일의 경로. 내보낸 적 없으면 `null`. 완료함의 `기록`에 보인다. */
  lastExportedPath: string | null;
  /** [Sentry에서 열기]로 열 주소가 있는지 여부. 주소는 main이 가지고 있다. */
  canOpenInSentry: boolean;
  /** 보고서의 첨부 파일. 보고서가 없으면 비어 있다. 첨부는 재현하는 진단이 만들므로 읽기 전용 진단의 보고서에는 없다. */
  attachments: DiagnosisAttachmentSnapshot[];
  /** 이 진단의 저장소가 지금 재현을 허용하는지 여부(macOS). 참일 때만 지시 입력에 "재현도 다시 하기" 체크가 보인다. */
  reproductionAllowed: boolean;
  /** 오류 정보. 감지할 때 오류 이슈 목록에서 받은 값이다. */
  issue: {
    /** 짧은 ID. 없으면 빈 문자열. */
    shortId: string;
    /** 오류가 난 자리. 없으면 빈 문자열. */
    culprit: string;
    /** 레벨. 없으면 빈 문자열. */
    level: string;
    /** 등록의 환경 필터. `null`이면 모든 환경이다. */
    environment: string | null;
    /** 처음 보인 시각. */
    firstSeen: number;
    /** 마지막으로 보인 시각. 모르면 `null`. */
    lastSeen: number | null;
    /** 발생 수. 모르면 `null`. */
    count: number | null;
    /** 사용자 수. 모르면 `null`. */
    userCount: number | null;
    /** 플랫폼. 없으면 `null`. */
    platform: string | null;
    /** 조직 이름. */
    organizationName: string;
    /** 프로젝트 이름. */
    projectName: string;
  };
}

/** 작은 창과 펼친 창이 그릴 멘션 묶음과 진단 상태. */
export interface ReviewSnapshot {
  /** 묶음. 처리되지 않은 묶음이 작은 창 대기열 순서(가장 오래된 미처리 멘션 순)로 먼저 오고, 처리됨 묶음이 최근에 처리한 것부터 뒤에 온다. */
  bundles: BundleSnapshot[];
  /** Sentry 진단. 묶음 배열과 따로 둔다. 감지한 순서다. */
  diagnoses: DiagnosisSnapshot[];
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

/** 앱이 스스로 바꿀 수 없는 위치의 까닭. `read-only`는 읽기 전용 볼륨(DMG 안, App Translocation), `no-permission`은 번들이나 부모 폴더에 쓸 권한이 없는 것이다. */
export type BlockedLocationReasonSnapshot = 'read-only' | 'no-permission';

/** 앱 내 업데이트의 상태. 설정 "일반"의 업데이트 칸이 그린다. */
export type UpdateSnapshot =
  /** 이번 실행에서 아직 확인하지 않았다. */
  | { kind: 'idle' }
  /** 새 버전을 확인하고 있다. */
  | { kind: 'checking' }
  /** 지금 버전이 최신이다. `checkedAt`은 마지막으로 확인한 시각(Unix epoch 밀리초)이다. */
  | { kind: 'up-to-date'; checkedAt: number }
  /** 확인이나 다운로드가 실패했다(네트워크 등). 다음 확인에서 저절로 다시 시도한다. `failedAt`은 실패한 시각이다. */
  | { kind: 'check-failed'; failedAt: number }
  /** 새 버전을 받고 있다. `percent`는 받은 비율(0~100의 정수)이다. */
  | { kind: 'downloading'; version: string; percent: number }
  /** 받은 파일의 서명을 확인했다. 사용자가 [다시 시작]을 누르면 설치한다. */
  | { kind: 'ready'; version: string }
  /** 받은 파일의 서명이 맞지 않아 지우고 설치하지 않았다. */
  | { kind: 'signature-failed'; version: string }
  /** 앱이 스스로 바꿀 수 없는 위치라 새 버전을 받지 않았다. */
  | { kind: 'location-blocked'; version: string; reason: BlockedLocationReasonSnapshot }
  /** [다시 시작]을 눌렀지만 진행 중인 일이 끝나기를 기다린다. */
  | { kind: 'restart-pending'; version: string; waitingFor: RestartWaitSnapshot }
  /** 새 버전으로 업데이트하지 못했다. */
  | { kind: 'install-failed'; version: string; reason: InstallFailureReasonSnapshot };

/**
 * 새 버전으로 업데이트하지 못한 까닭. `not-applied`는 다시 켰는데 버전이 그대로이거나 설치 중 오류가 난 것이고,
 * `rejected`는 Squirrel.Mac이 앱 안에서 거부한 것이라 다시 시도할 수 없다.
 */
export type InstallFailureReasonSnapshot = 'not-applied' | 'rejected';

/** 다시 시작이 기다리는 일. */
export interface RestartWaitSnapshot {
  /** 에이전트 실행(초안 생성)이 끝나기를 기다린다. */
  drafting: boolean;
  /** 게시 카운트다운이나 게시 요청이 끝나기를 기다린다. */
  posting: boolean;
}

/** 앱 내 업데이트의 화면 상태. 작은 창 띠와 다시 시작 확인 화면, 설정 "일반"이 그린다. */
export interface UpdateStateSnapshot {
  /** 업데이트 상태. */
  status: UpdateSnapshot;
  /** 업데이트 직후 첫 실행이면 업데이트한 버전. 아니면 `null`. */
  justUpdated: string | null;
  /** macOS 다시 시작 확인 화면에 보일 새 버전. 확인 화면을 띄우지 않았으면 `null`. */
  restartConfirm: string | null;
  /** 작은 창에서 닫은 띠의 이름들. 같은 이름의 띠는 다시 보이지 않는다. */
  dismissedBanners: string[];
}

/** 병렬 작업 수 슬라이더의 가장 작은 값. main의 생성 대기열과 같은 범위인지는 테스트가 확인한다. */
export const PARALLEL_WORK_COUNT_MIN = 1;
/** 병렬 작업 수 슬라이더의 가장 큰 값. */
export const PARALLEL_WORK_COUNT_MAX = 5;

/** 설정 "에이전트" 칸 `병렬 작업` 탭의 상태. */
export interface ParallelWorkSnapshot {
  /** 고른 병렬 작업 수(1~5). */
  count: number;
  /** 지금 진행 중인 초안·진단 수. 고른 값보다 많을 때만 "진행 중인 n개가 끝나면" 띠가 보인다. */
  running: number;
}

/** 진단 보고서를 내보낼 폴더. */
export interface ReportFolderSnapshot {
  /** 폴더 경로. 고르지 않았으면 기본 폴더(사용자 문서 폴더 아래 `Stardraft/Reports/Sentry`)다. */
  path: string;
  /** 기본 폴더를 쓰는 중인지 여부. */
  isDefault: boolean;
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
  /** "Sentry" 칸의 상태. */
  sentry: SentryConnectionSnapshot;
  /** 등록한 Sentry 프로젝트와 등록할 수 있는 프로젝트 목록. */
  sentryProjects: SentryProjectsSnapshot;
  /** 저장소별 재현 허용과 재현 도구 권한. */
  reproduction: ReproductionSnapshot;
  /** 지금 보일 전역 문제. 없으면 `null`. */
  globalProblem: GlobalProblemSnapshot | null;
  /** 이 OS의 후보 에이전트마다의 연결 확인 상태. 후보 순서다(macOS는 Claude Code와 Codex, Windows는 Claude Code). */
  agentConnections: AgentConnectionSnapshot[];
  /** 기본 에이전트와 모델 선택. */
  agentPreferences: AgentPreferencesSnapshot;
  /** 저장소 매핑과 고를 참여 Flow 프로젝트 목록. */
  repoMappings: RepoMappingsSnapshot;
  /** 필수 설정와 감지 시작 여부. */
  onboarding: OnboardingSnapshot;
  /** 로그인 시 자동 시작이 켜져 있는지 여부. */
  launchAtLogin: boolean;
  /** 에디터에서 열기에 쓸 에디터와 에디터 고르기 창. */
  editor: EditorSnapshot;
  /** 멘션 묶음과 창마다 영역 펼침 상태. */
  review: ReviewSnapshot;
  /** 최근 멘션 확인. */
  manualCheck: ManualCheckSnapshot;
  /** 설정 "초안" 칸의 추가 지침과 비밀 파일 패턴. */
  draftSettings: DraftSettingsSnapshot;
  /** 설정 "에이전트" 칸의 병렬 작업 수와 진행 중인 수. */
  parallelWork: ParallelWorkSnapshot;
  /** 설정 "Sentry" 칸의 "보고서를 내보낼 폴더". */
  reportFolder: ReportFolderSnapshot;
  /** 앱 내 업데이트의 화면 상태. 소스에서 실행하면 업데이트를 끄므로 `null`이다. */
  update: UpdateStateSnapshot | null;
}

/** main → 렌더러 변경 이벤트. */
export type AppEvent =
  /**
   * 이미 열린 설정 창에 이 칸을 보이라고 알린다. `projectId`가 있으면 그 Flow 프로젝트의 저장소 매핑을,
   * `sentryProjectId`가 있으면 `Sentry` 탭에서 그 Sentry 프로젝트의 저장소 매핑을 짚어 보인다.
   */
  | { type: 'settings-section-requested'; section: SettingsSection; projectId?: string; sentryProjectId?: string }
  /** "Flow 계정" 칸의 상태가 바뀌었다. */
  | { type: 'flow-account-changed'; flowAccount: FlowAccountSnapshot }
  /** 키 확인 하나가 연결이나 실패로 끝났다. 그만둔 확인과 확인을 기다리는 경우는 알리지 않는다. */
  | { type: 'flow-key-check-finished'; result: 'connected' | FlowKeyCheckFailure }
  /** "Sentry" 칸의 상태가 바뀌었다. */
  | { type: 'sentry-changed'; sentry: SentryConnectionSnapshot }
  /** 토큰 확인 하나가 연결이나 실패로 끝났다. 그만둔 확인은 알리지 않는다. */
  | { type: 'sentry-token-check-finished'; result: 'connected' | SentryTokenCheckFailure }
  /** 등록한 Sentry 프로젝트, 그 저장소 매핑, 등록할 수 있는 프로젝트 목록이 바뀌었다. */
  | { type: 'sentry-projects-changed'; sentryProjects: SentryProjectsSnapshot }
  /** 프로젝트 등록이나 편집이 끝났다. 등록·편집 모달이 닫히거나 이유를 보인다. */
  | { type: 'sentry-project-saved'; result: SentryProjectSaveResult }
  /** 프로젝트 모달의 [폴더 고르기…]로 폴더를 골랐다. 모달이 이 경로를 보이고 [등록]·[저장]에 싣는다. */
  | { type: 'sentry-draft-folder-picked'; path: string }
  /** 재현 허용, 환경 파일, 재현 도구 권한, MCP 서버 목록이 바뀌었다. */
  | { type: 'reproduction-changed'; reproduction: ReproductionSnapshot }
  /** 재현을 켜는 확인 모달의 저장이 끝났다. 모달이 닫히거나 이유를 보인다. */
  | { type: 'reproduction-saved'; result: ReproductionSaveResult }
  /** 재현을 켜는 확인 모달의 [파일 고르기…]로 환경 파일을 골랐다. 모달이 이 경로를 보이고 [켜기]에 싣는다. */
  | { type: 'reproduction-env-file-picked'; path: string }
  /** 보일 전역 문제가 바뀌었다. */
  | { type: 'global-problem-changed'; globalProblem: GlobalProblemSnapshot | null }
  /** 에이전트 연결 확인 상태가 바뀌었다. */
  | { type: 'agent-connections-changed'; agentConnections: AgentConnectionSnapshot[] }
  /** 기본 에이전트나 모델 선택이 바뀌었다. 연결된 에이전트가 바뀔 때도 온다. */
  | { type: 'agent-preferences-changed'; agentPreferences: AgentPreferencesSnapshot }
  /** 저장소 매핑이나 그 폴더 확인 결과, 참여 Flow 프로젝트 목록이 바뀌었다. */
  | { type: 'repo-mappings-changed'; repoMappings: RepoMappingsSnapshot }
  /** 필수 설정의 상태나 감지 시작 여부, [감지 시작]의 진행 상태가 바뀌었다. */
  | { type: 'onboarding-changed'; onboarding: OnboardingSnapshot }
  /** 로그인 시 자동 시작이 켜지거나 꺼졌다. */
  | { type: 'launch-at-login-changed'; launchAtLogin: boolean }
  /** 기억한 에디터, 찾은 에디터, 에디터 고르기 창이 바뀌었다. */
  | { type: 'editor-changed'; editor: EditorSnapshot }
  /** 멘션 묶음이나 영역 펼침 상태가 바뀌었다. */
  | { type: 'review-changed'; review: ReviewSnapshot }
  /** 최근 멘션 확인 시트를 열 수 있는지, 시트의 상태가 바뀌었다. */
  | { type: 'manual-check-changed'; manualCheck: ManualCheckSnapshot }
  /** 설정 "초안" 칸의 추가 지침이나 비밀 파일 패턴이 바뀌었다. */
  | { type: 'draft-settings-changed'; draftSettings: DraftSettingsSnapshot }
  /** 보고서를 내보낼 폴더가 바뀌었다. */
  | { type: 'report-folder-changed'; reportFolder: ReportFolderSnapshot }
  /** 진단 보고서를 내보냈다. 토스트가 파일 이름을 보인다. */
  | { type: 'diagnosis-exported'; diagnosisId: number; fileName: string }
  /** 진단 보고서를 내보내지 못했다. 토스트가 알린다. */
  | { type: 'diagnosis-export-failed'; diagnosisId: number }
  /** 병렬 작업 수나 진행 중인 수가 바뀌었다. */
  | { type: 'parallel-work-changed'; parallelWork: ParallelWorkSnapshot }
  /** 앱 내 업데이트의 상태가 바뀌었다. */
  | { type: 'update-changed'; update: UpdateStateSnapshot }
  /** 이미 열린 창에 이 묶음을 보이라고 알린다. OS 알림을 눌렀을 때 온다. */
  | { type: 'review-bundle-requested'; bundleId: number }
  /** 이미 열린 펼친 창에 이 진단을 보이라고 알린다(진단 알림을 눌렀을 때). */
  | { type: 'review-diagnosis-requested'; diagnosisId: number }
  /** 묶음의 게시가 실패했다. 다른 묶음을 보고 있어도 토스트를 한 번 띄운다. */
  | { type: 'post-failed'; bundleId: number }
  /** 게시를 누를 때의 확인이 묶음의 게시를 멈췄다. 카운트다운 토스트 대신 "게시하지 않았습니다: …" 토스트를 한 번 띄운다. */
  | { type: 'post-stopped'; bundleId: number; stop: PostStopSnapshot };

/** 렌더러 → main 명령. */
export type AppCommand =
  /** 설정 창을 연다. 칸을 주면 그 칸을 보인다. */
  | { type: 'open-settings'; section?: SettingsSection }
  /** 묶음의 Flow 프로젝트 저장소 매핑 편집으로 간다. 설정 "저장소" 칸을 열고 그 프로젝트의 줄을 짚어 보인다. */
  | { type: 'open-repo-mapping'; bundleId: number }
  /** 저장소 대기 진단의 [저장소 매핑하기]·[매핑 고치기]. 설정 "저장소" 칸 `Sentry` 탭에서 그 프로젝트를 짚는다. */
  | { type: 'open-sentry-repo-mapping'; diagnosisId: number }
  /** 줄 서 있거나 진행 중인 진단을 취소한다. 진단 실패(취소함)가 된다. */
  | { type: 'cancel-diagnosis'; diagnosisId: number }
  /** 진단 실패를 [다시 시도]한다. 생성 대기열의 `user` 칸에 선다. */
  | { type: 'retry-diagnosis'; diagnosisId: number }
  /** 검토 대기 보고서를 지시 없이 [다시 진단]한다. 앞선 보고서를 넘기지 않고 쌓인 지시를 비운다. 생성 대기열의 `user` 칸에 선다. */
  | { type: 'rediagnose'; diagnosisId: number }
  /**
   * 검토 대기 보고서를 지시를 덧붙여 다시 진단한다. 앞선 보고서와 쌓인 지시 전부를 넘긴다. 생성 대기열의 `user` 칸에 선다.
   * `reproduce`는 "재현도 다시 하기"다. 끄면 읽기 전용으로 돌고 앞선 재현 칸과 첨부를 그대로 옮긴다. 재현을 허용하지 않은 저장소에서는 쓰이지 않는다.
   */
  | { type: 'rediagnose-with-directive'; diagnosisId: number; directive: string; reproduce: boolean }
  /** 진단을 [완료]한다. 진단 실패와 검토 대기 보고서가 대상이고, 최소 기록만 남기고 본문과 첨부를 지운다. Sentry에는 요청하지 않는다. */
  | { type: 'complete-diagnosis'; diagnosisId: number }
  /** 검토 대기 보고서를 설정의 폴더에 마크다운 파일로 내보낸다. 끝나면 `diagnosis-exported`나 `diagnosis-export-failed`로 알린다. 상태는 바뀌지 않는다. */
  | { type: 'export-diagnosis'; diagnosisId: number }
  /** 보고서를 내보낼 폴더를 폴더 선택 창으로 바꾼다. */
  | { type: 'pick-report-folder' }
  /** 보고서를 내보낼 폴더를 OS 파일 관리자로 연다. 아직 없으면 만들어서 연다. */
  | { type: 'open-report-folder' }
  /** 진단의 오류 이슈를 Sentry에서 연다. 주소는 main이 정한다. */
  | { type: 'open-diagnosis-in-sentry'; diagnosisId: number }
  /** 진단 보고서의 근거 하나를 에디터에서 연다. `evidenceIndex`는 보고서 근거 목록의 위치다. */
  | { type: 'open-diagnosis-evidence-in-editor'; diagnosisId: number; evidenceIndex: number }
  /** 데이터 폴더나 로그 폴더를 OS 파일 관리자로 연다. */
  | { type: 'open-folder'; folder: AppFolder }
  /** 붙여 넣은 Flow 개인 API 키를 확인한다. 성공하면 main이 키를 저장한다. */
  | { type: 'check-flow-key'; apiKey: string }
  /** 다른 계정의 키로 바꾸는 것을 확인했다. 지금 계정의 기록을 보관하고 새 계정의 기록으로 바꾼다. */
  | { type: 'confirm-flow-account-switch' }
  /** 진행 중인 키 확인이나 확인을 기다리는 계정 바꾸기를 그만둔다. */
  | { type: 'cancel-flow-key-check' }
  /** 붙여 넣은 Sentry 개인 토큰을 조직 목록으로 확인한다. 성공하면 main이 토큰을 저장한다. */
  | { type: 'check-sentry-token'; token: string }
  /** 진행 중인 토큰 확인을 그만둔다. */
  | { type: 'cancel-sentry-token-check' }
  /** Sentry 연결을 끊는다. 토큰만 지운다. */
  | { type: 'disconnect-sentry' }
  /** 이 OS의 후보 에이전트를 모두 확인한다. 에이전트 칸을 열 때 쓴다. 저장한 CLI 경로가 있으면 그대로 쓴다. */
  | { type: 'check-agents' }
  /** 에이전트 하나의 연결을 확인한다. [다시 확인]에 쓴다. */
  | { type: 'check-agent'; agent: AgentId }
  /** 저장한 CLI 경로를 무시하고 다시 찾는다. */
  | { type: 'rediscover-agent'; agent: AgentId }
  /** 파일 선택 창으로 CLI를 직접 지정한다. 경로는 main이 받으므로 렌더러는 보내지 않는다. */
  | { type: 'pick-agent-cli'; agent: AgentId }
  /** 실패 카드의 명령을 클립보드에 복사한다. 명령은 main이 지금 상태에서 정한다. */
  | { type: 'copy-agent-fix-command'; agent: AgentId }
  /** 기본 에이전트를 고른다. 연결되지 않은 에이전트는 main이 받지 않는다. */
  | { type: 'set-default-agent'; agent: AgentId }
  /** 에이전트의 모델을 고른다. `null`은 기본 모델(에이전트가 정함)이다. 목록에 없는 모델은 main이 받지 않는다. */
  | { type: 'set-agent-model'; agent: AgentId; model: string | null }
  /** 연결된 폴더를 다시 확인하고 참여 Flow 프로젝트 목록을 다시 받는다. "저장소" 칸을 열 때와 [다시 불러오기]에 보낸다. */
  | { type: 'refresh-repo-mappings' }
  /** 폴더 선택 창으로 고른 폴더를 Flow 프로젝트에 연결한다. 경로는 main이 받으므로 렌더러는 보내지 않는다. */
  | { type: 'pick-mapping-repos'; projectId: string }
  /** 매핑에서 저장소 하나를 뺀다. 마지막 저장소를 빼면 매핑도 없어진다. */
  | { type: 'remove-mapping-repo'; projectId: string; path: string }
  /** 매핑을 통째로 지운다. */
  | { type: 'remove-repo-mapping'; projectId: string }
  /** 등록한 Sentry 프로젝트에 닿는지, 매핑된 폴더가 있는지 다시 확인한다. "Sentry"·"저장소" 칸을 열 때 보낸다. */
  | { type: 'refresh-sentry-projects' }
  /** 등록할 수 있는 Sentry 프로젝트 목록을 조직마다 받는다. 프로젝트 모달을 열 때 보낸다. */
  | { type: 'load-sentry-candidates' }
  /** 목록에서 고른 Sentry 프로젝트를 등록한다. `event:read`를 확인한 뒤 저장하고 `sentry-project-saved`로 알린다. */
  | { type: 'register-sentry-project'; projectId: string; environment: string | null; levels: SentryLevelId[]; repoPath: string | null }
  /** 등록한 Sentry 프로젝트의 필터와 저장소를 바꾼다. `repoPath`가 `null`이면 저장소 매핑을 지운다. */
  | { type: 'update-sentry-project'; projectId: string; environment: string | null; levels: SentryLevelId[]; repoPath: string | null }
  /** Sentry 프로젝트 등록을 푼다. 그 프로젝트의 저장소 매핑도 지워진다. */
  | { type: 'unregister-sentry-project'; projectId: string }
  /** 프로젝트 모달의 저장소로 쓸 폴더를 폴더 선택 창으로 고른다. 고르면 `sentry-draft-folder-picked`로 알린다. */
  | { type: 'pick-sentry-draft-folder' }
  /** 폴더 선택 창으로 고른 폴더를 등록한 Sentry 프로젝트의 저장소로 정한다. "저장소" 칸의 [바꾸기…]·[폴더 고르기…]가 보낸다. */
  | { type: 'pick-sentry-project-repo'; projectId: string }
  /** 저장소 칸의 재현 항목을 열 때 지정한 환경 파일이 아직 있는지 다시 확인한다. */
  | { type: 'refresh-reproduction-repos' }
  /** 에이전트 칸 `재현` 탭을 열 때 MCP 서버 목록을 다시 읽는다. */
  | { type: 'refresh-reproduction-servers' }
  /**
   * 저장소의 재현 허용을 켜거나 끈다. 켤 때 `envFile`(확인 모달에서 고른 값, `null`은 지정 안 함)을 함께 보내고,
   * 끌 때는 보내지 않아 저장해 둔 환경 파일을 그대로 둔다. 켜는 요청의 결과는 `reproduction-saved`로 알린다.
   */
  | { type: 'set-reproduction-enabled'; repoPath: string; enabled: boolean; envFile?: string | null }
  /** 재현을 켠 저장소의 재현용 환경 파일을 파일 선택 창으로 고른다. */
  | { type: 'pick-reproduction-env-file'; repoPath: string }
  /** 재현을 켜는 확인 모달의 환경 파일을 파일 선택 창으로 고른다. 고르면 `reproduction-env-file-picked`로 알린다. */
  | { type: 'pick-reproduction-env-file-draft' }
  /** 재현 도구 권한의 방식을 바꾼다. */
  | { type: 'set-reproduction-tool-mode'; mode: ReproductionToolModeId }
  /** `직접 선택`에서 MCP 서버 하나를 켜거나 끈다. 에이전트별로 서버 이름만 저장한다. */
  | { type: 'set-reproduction-server-enabled'; agent: AgentId; name: string; enabled: boolean }
  /** [감지 시작]. 필수 설정가 다 되기 전이거나 이미 시작했으면 main이 무시한다. */
  | { type: 'start-detection' }
  /** 로그인 시 자동 시작을 켜거나 끈다. */
  | { type: 'set-launch-at-login'; enabled: boolean }
  /** 병렬 작업 수를 바꾼다. 1~5의 정수만 받는다. 돌던 실행은 그대로 두고 다음 실행을 꺼낼 때부터 쓴다. */
  | { type: 'set-parallel-work-count'; count: number }
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
  | { type: 'expand-review'; bundleId: number | null; diagnosisId?: number | null }
  /** 펼친 창을 닫고 작은 창을 연다. 보고 있던 묶음을 고른 채로 연다. */
  | { type: 'collapse-review'; bundleId: number | null; diagnosisId?: number | null }
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
  /** [최근 멘션 확인]. 그 창에 확인 시트를 열고 최근 멘션을 불러온다. 감지 전이거나 쓸 수 있는 Flow 키가 없으면 main이 무시한다. */
  | { type: 'open-manual-check'; window: ManualCheckWindowSnapshot }
  /** 확인 시트를 닫는다. */
  | { type: 'close-manual-check' }
  /** 확인 시트의 탭을 바꾼다. 담당 업무 탭은 처음 열 때 불러온다. */
  | { type: 'select-manual-check-tab'; tab: ManualCheckTabSnapshot }
  /** 확인 시트에서 지금 보는 탭의 목록을 처음부터 다시 불러온다. */
  | { type: 'reload-manual-check' }
  /** [더 보기]. 확인 시트에서 지금 보는 탭의 목록을 10건 더 불러온다. */
  | { type: 'load-more-manual-check' }
  /** 확인 시트에서 고른 멘션이나 담당 업무로 수동 요청 묶음을 만들고 시트를 닫는다. 이미 묶음이 있으면 그 묶음을 연다. 지금 보는 탭의 목록에 없는 알림 ID는 main이 받지 않는다. */
  | { type: 'pick-manual-check'; alarmId: string }
  /** 추가 지침을 저장한다. 여러 줄 입력이라 칸을 벗어날 때 보낸다. 다음 실행부터 쓴다. */
  | { type: 'set-extra-instructions'; text: string }
  /**
   * 비밀 파일 패턴을 추가한다. 빈 패턴은 받지 않고, 앞뒤 공백 정리, 쓸 수 없는 글자와 이미 있는 패턴 판단은 main이 한다.
   * 실행 중인 실행을 새 패턴으로 다시 돌리고, 게시하지 않은 초안의 근거를 다시 검사한다.
   */
  | { type: 'add-secret-pattern'; pattern: string }
  /** 설정 "일반"의 [알림 시험]. 시험 알림을 하나 띄운다. */
  | { type: 'test-notification' }
  /** 설정 "일반"의 업데이트 [지금 확인]. 업데이트를 끈 소스 실행에서는 main이 무시한다. */
  | { type: 'check-for-update' }
  /** 서명 검증 실패 뒤의 [다시 시도]. 실패한 버전을 다시 받는다. 서명 검증 실패가 아니면 main이 무시한다. */
  | { type: 'retry-update' }
  /** 다운로드 사이트의 섹션을 기본 브라우저로 연다. [사이트에서 받기]는 업데이트 섹션, [변경 내역]은 변경 내역 섹션이다. 주소는 main이 정한다. */
  | { type: 'open-site'; section: SiteSection }
  /** 설치 준비됨의 [다시 시작]. macOS는 작은 창에 확인 화면을 먼저 띄운다. 설치 준비됨이 아니면 main이 무시한다. */
  | { type: 'restart-to-update' }
  /** 다시 시작 확인 화면의 [다시 시작]. */
  | { type: 'confirm-update-restart' }
  /** 다시 시작 확인 화면의 [나중에]. */
  | { type: 'cancel-update-restart-confirm' }
  /** "다시 시작 대기"의 [지금 다시 시작]. 진행 중인 에이전트 실행을 끊고 다시 시작한다. */
  | { type: 'restart-update-now' }
  /** "다시 시작 대기"의 [취소]. 대기를 푼다. */
  | { type: 'cancel-update-restart' }
  /** 설치 실패의 [다시 시도]. 받아 둔 업데이트를 다시 확인하고 다시 시작한다. */
  | { type: 'retry-update-install' }
  /** 작은 창의 업데이트 띠를 닫는다. `banner`는 띠 이름이다. */
  | { type: 'dismiss-update-banner'; banner: string };

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

/** 다운로드 사이트의 섹션 이름인지 확인한다. */
function isSiteSection(value: unknown): value is SiteSection {
  return typeof value === 'string' && (SITE_SECTIONS as readonly string[]).includes(value);
}

/** 업데이트 띠 이름으로 받을 수 있는 값인지 확인한다. 상태 이름과 버전을 쌍점으로 이은 것이다. */
function isUpdateBannerInput(value: unknown): value is string {
  return typeof value === 'string' && value.length <= UPDATE_BANNER_MAX_LENGTH && /^[a-z-]+:[0-9A-Za-z.+-]+$/.test(value);
}

/** 앱이 아는 에이전트인지 확인한다. */
function isAgentId(value: unknown): value is AgentId {
  return typeof value === 'string' && (AGENT_IDS as readonly string[]).includes(value);
}

/** 모델 고르기 명령에 실을 수 있는 값인지 확인한다. 목록에 있는 모델인지는 main이 본다. */
function isAgentModelInput(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value !== '' && value.length <= AGENT_MODEL_MAX_LENGTH);
}

/** 저장소 매핑 명령에 실을 수 있는 경로인지 확인한다. 목록에 있는 경로인지는 main이 본다. */
function isFolderPathInput(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= REPO_FOLDER_PATH_MAX_LENGTH;
}

/** 저장소 매핑 명령에 실을 수 있는 Flow 프로젝트 ID인지 확인한다. 참여 목록이나 매핑에 있는 ID인지는 main이 본다. */
function isFlowProjectIdInput(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= FLOW_PROJECT_ID_MAX_LENGTH;
}

/** Sentry 프로젝트 명령에 실을 수 있는 프로젝트 ID인지 확인한다. 등록할 수 있는 프로젝트인지는 main이 본다. */
function isSentryProjectIdInput(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && value.length <= SENTRY_PROJECT_ID_MAX_LENGTH;
}

/** 환경 필터로 실을 수 있는 값인지 확인한다. `null`은 모든 환경이다. */
function isSentryEnvironmentInput(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value !== '' && value.length <= SENTRY_ENVIRONMENT_MAX_LENGTH);
}

/** 레벨 필터로 실을 수 있는 값인지 확인한다. 하나 이상이고 모두 아는 레벨이다. */
function isSentryLevelsInput(value: unknown): value is SentryLevelId[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= SENTRY_LEVEL_IDS.length &&
    value.every((level) => (SENTRY_LEVEL_IDS as readonly unknown[]).includes(level))
  );
}

/** 저장소 폴더로 실을 수 있는 값인지 확인한다. `null`은 저장소 없음이다. */
function isOptionalFolderPathInput(value: unknown): value is string | null {
  return value === null || isFolderPathInput(value);
}

/** 묶음 명령에 실을 수 있는 묶음 ID인지 확인한다. 있는 묶음인지는 main이 본다. */
function isBundleIdInput(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/** 진단 ID인지 확인한다. 진단 ID는 `sentry_diagnosis` 행의 ID라 양의 정수다. */
function isDiagnosisIdInput(value: unknown): value is number {
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

/** 최근 멘션 확인 시트를 여는 창 이름인지 확인한다. */
function isManualCheckWindow(value: unknown): value is ManualCheckWindowSnapshot {
  return typeof value === 'string' && (MANUAL_CHECK_WINDOWS as readonly string[]).includes(value);
}

/** 최근 멘션 확인 시트의 탭 이름인지 확인한다. */
function isManualCheckTab(value: unknown): value is ManualCheckTabSnapshot {
  return (MANUAL_CHECK_TABS as readonly unknown[]).includes(value);
}

/** 최근 멘션 확인에서 고르는 명령에 실을 수 있는 알림 ID인지 확인한다. 목록에 있는 알림인지는 main이 본다. */
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

/** 토큰 확인 명령에 실을 수 있는 토큰인지 확인한다. 앞뒤 공백 정리는 main이 한다. */
function isSentryTokenInput(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= SENTRY_TOKEN_MAX_LENGTH;
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
    case 'open-site':
      return isSiteSection(candidate.section) ? { type: 'open-site', section: candidate.section } : null;
    case 'dismiss-update-banner':
      return isUpdateBannerInput(candidate.banner) ? { type: 'dismiss-update-banner', banner: candidate.banner } : null;
    case 'check-flow-key':
      return isFlowApiKeyInput(candidate.apiKey) ? { type: 'check-flow-key', apiKey: candidate.apiKey } : null;
    case 'check-sentry-token':
      return isSentryTokenInput(candidate.token) ? { type: 'check-sentry-token', token: candidate.token } : null;
    case 'set-default-agent':
      return isAgentId(candidate.agent) ? { type: 'set-default-agent', agent: candidate.agent } : null;
    case 'check-agent':
    case 'rediscover-agent':
    case 'pick-agent-cli':
    case 'copy-agent-fix-command':
      return isAgentId(candidate.agent) ? { type: candidate.type, agent: candidate.agent } : null;
    case 'set-agent-model':
      return isAgentId(candidate.agent) && isAgentModelInput(candidate.model)
        ? { type: 'set-agent-model', agent: candidate.agent, model: candidate.model }
        : null;
    case 'pick-mapping-repos':
    case 'remove-repo-mapping':
      return isFlowProjectIdInput(candidate.projectId) ? { type: candidate.type, projectId: candidate.projectId } : null;
    case 'register-sentry-project':
    case 'update-sentry-project':
      return isSentryProjectIdInput(candidate.projectId) &&
        isSentryEnvironmentInput(candidate.environment) &&
        isSentryLevelsInput(candidate.levels) &&
        isOptionalFolderPathInput(candidate.repoPath)
        ? {
            type: candidate.type,
            projectId: candidate.projectId,
            environment: candidate.environment,
            levels: [...candidate.levels],
            repoPath: candidate.repoPath,
          }
        : null;
    case 'unregister-sentry-project':
    case 'pick-sentry-project-repo':
      return isSentryProjectIdInput(candidate.projectId) ? { type: candidate.type, projectId: candidate.projectId } : null;
    case 'remove-mapping-repo':
      return isFlowProjectIdInput(candidate.projectId) && isFolderPathInput(candidate.path)
        ? { type: 'remove-mapping-repo', projectId: candidate.projectId, path: candidate.path }
        : null;
    case 'set-repo-picker-checked':
      return isFolderPathInput(candidate.path) && typeof candidate.checked === 'boolean'
        ? { type: 'set-repo-picker-checked', path: candidate.path, checked: candidate.checked }
        : null;
    case 'set-launch-at-login':
      return typeof candidate.enabled === 'boolean' ? { type: 'set-launch-at-login', enabled: candidate.enabled } : null;
    case 'set-reproduction-enabled':
      if (!isFolderPathInput(candidate.repoPath) || typeof candidate.enabled !== 'boolean') return null;
      if (candidate.envFile === undefined) return { type: 'set-reproduction-enabled', repoPath: candidate.repoPath, enabled: candidate.enabled };
      return isOptionalFolderPathInput(candidate.envFile)
        ? { type: 'set-reproduction-enabled', repoPath: candidate.repoPath, enabled: candidate.enabled, envFile: candidate.envFile }
        : null;
    case 'pick-reproduction-env-file':
      return isFolderPathInput(candidate.repoPath) ? { type: 'pick-reproduction-env-file', repoPath: candidate.repoPath } : null;
    case 'set-reproduction-tool-mode':
      return (REPRODUCTION_TOOL_MODES as readonly unknown[]).includes(candidate.mode)
        ? { type: 'set-reproduction-tool-mode', mode: candidate.mode as ReproductionToolModeId }
        : null;
    case 'set-reproduction-server-enabled':
      return isAgentId(candidate.agent) &&
        typeof candidate.name === 'string' &&
        candidate.name !== '' &&
        candidate.name.length <= REPRODUCTION_SERVER_NAME_MAX_LENGTH &&
        typeof candidate.enabled === 'boolean'
        ? { type: 'set-reproduction-server-enabled', agent: candidate.agent, name: candidate.name, enabled: candidate.enabled }
        : null;
    case 'set-parallel-work-count':
      return isParallelWorkCount(candidate.count) ? { type: 'set-parallel-work-count', count: candidate.count } : null;
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
    case 'rediagnose-with-directive':
      return isDiagnosisIdInput(candidate.diagnosisId) && isRegenerationTextInput(candidate.directive) && typeof candidate.reproduce === 'boolean'
        ? { type: 'rediagnose-with-directive', diagnosisId: candidate.diagnosisId, directive: candidate.directive, reproduce: candidate.reproduce }
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
    case 'open-repo-mapping':
    case 'link-bundle-repos':
    case 'open-repo-picker':
    case 'post-bundle':
    case 'cancel-posting':
      return isBundleIdInput(candidate.bundleId) ? { type: candidate.type, bundleId: candidate.bundleId } : null;
    case 'open-sentry-repo-mapping':
    case 'cancel-diagnosis':
    case 'retry-diagnosis':
    case 'rediagnose':
    case 'complete-diagnosis':
    case 'export-diagnosis':
    case 'open-diagnosis-in-sentry':
      return isDiagnosisIdInput(candidate.diagnosisId) ? { type: candidate.type, diagnosisId: candidate.diagnosisId } : null;
    case 'open-diagnosis-evidence-in-editor':
      return isDiagnosisIdInput(candidate.diagnosisId) && Number.isSafeInteger(candidate.evidenceIndex) && (candidate.evidenceIndex as number) >= 0
        ? { type: 'open-diagnosis-evidence-in-editor', diagnosisId: candidate.diagnosisId, evidenceIndex: candidate.evidenceIndex as number }
        : null;
    case 'expand-review':
    case 'collapse-review': {
      if (candidate.bundleId !== null && !isBundleIdInput(candidate.bundleId)) return null;
      // 진단 ID는 없을 수 있다. 있으면 진단 ID여야 하고, 없으면 싣지 않는다.
      if (candidate.diagnosisId === undefined || candidate.diagnosisId === null) return { type: candidate.type, bundleId: candidate.bundleId };
      return isDiagnosisIdInput(candidate.diagnosisId) ? { type: candidate.type, bundleId: candidate.bundleId, diagnosisId: candidate.diagnosisId } : null;
    }
    case 'set-review-section':
      return isReviewWindow(candidate.window) && isReviewSection(candidate.section) && typeof candidate.open === 'boolean'
        ? { type: 'set-review-section', window: candidate.window, section: candidate.section, open: candidate.open }
        : null;
    case 'open-evidence-in-editor':
      return isBundleIdInput(candidate.bundleId) && Number.isSafeInteger(candidate.evidenceIndex) && (candidate.evidenceIndex as number) >= 0
        ? { type: 'open-evidence-in-editor', bundleId: candidate.bundleId, evidenceIndex: candidate.evidenceIndex as number }
        : null;
    case 'open-manual-check':
      return isManualCheckWindow(candidate.window) ? { type: 'open-manual-check', window: candidate.window } : null;
    case 'select-manual-check-tab':
      return isManualCheckTab(candidate.tab) ? { type: 'select-manual-check-tab', tab: candidate.tab } : null;
    // 아래 인자 없는 명령 묶음에 더하면 유니온이 너무 커져 TypeScript가 맞춰 보지 못하므로, 최근 멘션 확인의 인자 없는 명령은 따로 돌려준다.
    case 'close-manual-check':
    case 'reload-manual-check':
    case 'load-more-manual-check':
      return { type: candidate.type };
    case 'pick-manual-check':
      return isAlarmIdInput(candidate.alarmId) ? { type: 'pick-manual-check', alarmId: candidate.alarmId } : null;
    case 'set-extra-instructions':
      return typeof candidate.text === 'string' && candidate.text.length <= EXTRA_INSTRUCTIONS_MAX_LENGTH ? { type: 'set-extra-instructions', text: candidate.text } : null;
    case 'add-secret-pattern':
      return typeof candidate.pattern === 'string' && candidate.pattern.trim() !== '' && candidate.pattern.length <= SECRET_PATTERN_MAX_LENGTH
        ? { type: 'add-secret-pattern', pattern: candidate.pattern }
        : null;
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
    case 'cancel-sentry-token-check':
    case 'disconnect-sentry':
    case 'check-agents':
    case 'refresh-repo-mappings':
    case 'refresh-sentry-projects':
    case 'load-sentry-candidates':
    case 'pick-sentry-draft-folder':
    case 'start-detection':
    case 'pick-repo-picker-folders':
    case 'link-repo-picker':
    case 'generate-with-repo-picker':
    case 'close-repo-picker':
    case 'test-notification':
    case 'check-for-update':
    case 'retry-update':
    case 'restart-to-update':
    case 'confirm-update-restart':
    case 'cancel-update-restart-confirm':
    case 'restart-update-now':
    case 'cancel-update-restart':
    case 'retry-update-install':
      return { type: candidate.type };
    // 인자 없는 명령이 한 갈래에 너무 많으면 TypeScript가 합집합 대입을 검사하지 못해 갈래를 나눈다.
    case 'pick-report-folder':
    case 'open-report-folder':
    case 'refresh-reproduction-repos':
    case 'refresh-reproduction-servers':
    case 'pick-reproduction-env-file-draft':
      return { type: candidate.type };
    default:
      return null;
  }
}

/** 병렬 작업 수로 받을 수 있는 값(1~5의 정수)인지 본다. */
function isParallelWorkCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= PARALLEL_WORK_COUNT_MIN && (value as number) <= PARALLEL_WORK_COUNT_MAX;
}
