/** 앱이 실행할 수 있는 에이전트. Codex는 macOS에서만 허용한다. */
export type AgentId = 'claude-code' | 'codex';

/**
 * 에이전트 실행의 종류. 초안 실행은 초안을 쓴다. 진단 실행은 Sentry 오류 이슈의 진단 보고서를 쓴다.
 * 점검 실행(화면 이름 "작동 확인")은 로그인과 실행 계약이 실제로 도는지 최소 스키마로 확인한다.
 * 실행기는 이 값으로 턴 상한을 정한다. 진단 실행은 요청에 재현 경계(`reproduction`)가 있을 때만 재현 경계로 돌고, 아니면 초안 실행과 같은 읽기 전용 경계로 돈다.
 */
export type RunKind = 'draft' | 'diagnosis' | 'check';

/** 실행 중에 에이전트가 하고 있는 일. 상세 화면의 진행 단계 한 줄이 된다. */
export interface ExecutorProgress {
  /** 지금 단계를 사람이 읽을 수 있게 적은 한 줄. */
  step: string;
  /** 지금까지 읽은 파일 수. */
  filesRead: number;
}

/** 실행기에 넘기는 실행 하나의 입력. */
export interface ExecutorRunRequest {
  /** 실행의 종류. */
  kind: RunKind;
  /** 앱에 넣어 둔 지침. 시스템 프롬프트 자리에 넣는다. */
  instructions: string;
  /** 표준 입력으로 넘길 문서. Flow 내용은 이 문서의 데이터 구획에 담는다. */
  input: string;
  /** 구조화 출력이 따라야 하는 JSON 스키마. */
  outputSchema: Record<string, unknown>;
  /** 에이전트가 읽을 수 있는 디렉터리의 절대 경로 목록. 이 밖은 읽지 못하게 한다. */
  readRoots: string[];
  /** 읽지 못하게 할 비밀 파일 패턴. 실행기는 앱의 기본 목록을 늘 함께 넣으므로 사용자가 추가한 패턴만 넘겨도 된다. */
  secretPatterns: string[];
  /** 고른 모델. 없으면 에이전트 기본값을 쓴다. */
  model: string | null;
  /** 실행 제한 시간(밀리초). */
  timeoutMs: number;
  /** 사용자가 취소하거나 앱이 실행을 끊을 때 중단 신호를 보낸다. */
  signal: AbortSignal;
  /** 진행 단계가 바뀔 때마다 부른다. */
  onProgress: (progress: ExecutorProgress) => void;
  /** 재현 경계로 돌릴 때만 있다. 없으면 읽기 전용 경계로 돈다. */
  reproduction?: ReproductionBoundary | null;
}

/**
 * 재현하는 진단의 경계. 셸과 사본 쓰기, 네트워크를 열고 사용자 설정은 끌어오지 않는다.
 * `.env` 계열만 사본에서 읽게 하고, 다른 비밀 파일 패턴과 저장소 밖 개인 비밀은 계속 막는다. 환경 변수는 최소 목록만 넘긴다.
 * 이때 `readRoots`는 사본 하나이고 실행의 cwd다.
 */
export interface ReproductionBoundary {
  /** 사본의 실제 경로(심볼릭 링크를 푼 절대 경로). 쓰기는 이 아래만 허용한다. */
  copyRoot: string;
  /** 사본을 만든 원본 저장소의 절대 경로. 원본 경로로 원본의 비밀 파일을 읽지 못하게 사본과 같은 비밀 패턴으로 막는다. */
  sourceRoot: string;
  /** 실을 MCP 서버. 없거나 서버가 비어 있으면 MCP를 싣지 않는다. */
  mcp?: ReproductionMcp | null;
}

/** 재현에서 MCP 서버가 빠진 까닭. */
export type McpSkipReason =
  /** 사용자가 CLI에서 꺼 두었거나 `직접 선택`에서 켜지 않았다. */
  | 'disabled'
  /** 정의가 참조한 환경 변수를 로그인 셸에서 찾지 못했다. */
  | 'missing-variable'
  /** 정의의 평문 값이 실행 환경의 같은 이름 변수와 겹쳐 환경 변수로 넘길 수 없다(Codex). */
  | 'variable-conflict'
  /** 서버 정의를 읽거나 옮기지 못했다(Codex 상세 명령 실패, 헤더 값을 계산하는 명령이 있음). 꺼 둔 도구나 인증을 잃은 채 싣지 않으려고 뺀다. */
  | 'unreadable'
  /** CLI가 서버에 연결하지 못했다(뜨지 않음, 로그인 필요 등). */
  | 'connection-failed';

/** 재현에서 빠진 MCP 서버 하나. 이름과 까닭만 있다. */
export interface McpServerSkip {
  /** 서버 이름. */
  name: string;
  /** 빠진 까닭. */
  reason: McpSkipReason;
}

/**
 * 재현에 실을 MCP 서버 하나. 정의는 실행하는 CLI의 형식이고 평문 값(환경 변수, 헤더)이 들어 있을 수 있어
 * 메모리에서만 다룬다. 로그·설정·보고서에 남기지 않는다. 이름은 사용자가 등록한 이름 그대로다(CLI가 저장한 로그인을 이름으로 찾는다).
 */
export interface ReproductionMcpServer {
  /** 서버 이름. */
  name: string;
  /** 서버 정의. */
  definition: Record<string, unknown>;
}

/** 재현에 실을 MCP. 실행할 때마다 실행하는 CLI의 정의를 다시 읽어 만든다. */
export interface ReproductionMcp {
  /** 실을 서버. */
  servers: ReproductionMcpServer[];
  /** 실행 환경에 더할 변수. 정의가 참조한 변수의 값(로그인 셸에서 읽음)과, Codex는 정의의 평문 값을 옮긴 변수다. */
  env: Record<string, string>;
  /** 싣기 전에 빠진 서버. 연결 실패는 실행이 끝난 뒤 실행기가 알린다. */
  skipped: McpServerSkip[];
}

/** 실행 하나의 결과. */
export type ExecutorOutcome =
  /** 스키마에 맞는 구조화 출력을 받았다. 내용 검사는 core가 한다. */
  | { type: 'completed'; output: unknown }
  /** 실행은 끝났지만 구조화 출력이 없거나 스키마에 맞지 않았다. */
  | { type: 'invalid-output'; detail: string }
  /** 에이전트가 오류로 끝났다. `detail`은 CLI가 알려 준 오류 원문이다. */
  | { type: 'failed'; reason: ExecutorFailureReason; detail: string }
  /** 제한 시간을 넘겼다. */
  | { type: 'timed-out' }
  /** 중단 신호로 끊었다. */
  | { type: 'cancelled' };

/** 실행이 실패한 이유. 대기열은 이 값으로 전역 실패와 일시적 실패를 가린다. */
export type ExecutorFailureReason =
  /** CLI를 띄우지 못했다(파일 없음, 실행 권한 없음, 아직 찾지 못함). */
  | 'cli-missing'
  /** 결과 메시지 없이 끝났다(지원하지 않는 플래그, CLI 충돌 등). */
  | 'cli-error'
  /** 로그인되어 있지 않거나 로그인이 만료됐다. */
  | 'not-logged-in'
  /** 모델이 과부하 상태다. */
  | 'overloaded'
  /** 모델 API에 연결하지 못했다. */
  | 'network'
  /** 턴 수 상한에 닿았다. */
  | 'max-turns'
  /** 그 밖에 에이전트가 오류로 끝냈다(사용량 한도, 모델 없음 등). */
  | 'agent-error';

/** 에이전트가 알려 준 사용량. 알려 주지 않은 값은 `null`이다. */
export interface ExecutorUsage {
  /** 비용(미국 달러). */
  costUsd: number | null;
  /** 입력 토큰 수. 캐시에 쓰거나 캐시에서 읽은 토큰도 더한다. */
  inputTokens: number | null;
  /** 출력 토큰 수. */
  outputTokens: number | null;
}

/** 실행 하나가 끝났을 때 실행기가 알려 주는 것. 실행 기록에 남긴다. */
export interface ExecutorReport {
  /** 실행 결과. */
  outcome: ExecutorOutcome;
  /** 실행에서 본 CLI 버전. 알기 전에 끝났으면 `null`. */
  cliVersion: string | null;
  /** 에이전트가 이 실행에 쓴 모델. 알기 전에 끝났으면 `null`. */
  model: string | null;
  /** 에이전트가 알려 준 사용량. 결과를 알리지 않고 끝났으면 `null`. */
  usage: ExecutorUsage | null;
  /** 재현에 실었지만 CLI가 연결하지 못한 MCP 서버 이름. MCP를 싣지 않은 실행에는 없다. */
  mcpFailedServers?: string[];
}

/**
 * 실행기 포트.
 * 에이전트마다 하나씩 두며, 에이전트 실행 계약을 지키는 한 교체할 수 있다.
 */
export interface Executor {
  /** 이 실행기가 부르는 에이전트. */
  readonly agent: AgentId;
  /** 에이전트를 한 번 실행한다. 실패도 실행 보고로 돌려준다. */
  run(request: ExecutorRunRequest): Promise<ExecutorReport>;
}
