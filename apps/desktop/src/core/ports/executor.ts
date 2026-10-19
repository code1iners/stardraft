/** 앱이 실행할 수 있는 에이전트. Codex는 macOS에서만 허용한다. */
export type AgentId = 'claude-code' | 'codex';

/** 에이전트 실행의 종류. 선택 실행은 저장소를 고르고, 초안 실행은 초안을 쓴다. */
export type RunKind = 'selection' | 'draft';

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
  /** 지침과 맥락을 합친 입력. */
  prompt: string;
  /** 구조화 출력이 따라야 하는 JSON 스키마. */
  outputSchema: Record<string, unknown>;
  /** 에이전트가 읽을 수 있는 디렉터리의 절대 경로 목록. 이 밖은 읽지 못하게 한다. */
  readRoots: string[];
  /** 읽지 못하게 할 비밀 파일 패턴(기본 목록과 추가 패턴을 합친 것). */
  secretPatterns: string[];
  /** 고른 모델. 없으면 에이전트 기본값을 쓴다. */
  model: string | null;
  /** 실행 제한 시간(밀리초). */
  timeoutMs: number;
  /** 사용자가 취소하거나 앱이 실행을 끊을 때 중단 신호를 보낸다. */
  signal: AbortSignal;
  /** 진행 단계가 바뀔 때마다 부른다. */
  onProgress: (progress: ExecutorProgress) => void;
}

/** 실행 하나의 결과. */
export type ExecutorOutcome =
  /** 스키마에 맞는 구조화 출력을 받았다. 내용 검사는 core가 한다. */
  | { type: 'completed'; output: unknown }
  /** 실행은 끝났지만 구조화 출력이 없거나 스키마에 맞지 않았다. */
  | { type: 'invalid-output'; detail: string }
  /** 에이전트가 오류로 끝났다. */
  | { type: 'failed'; detail: string }
  /** 제한 시간을 넘겼다. */
  | { type: 'timed-out' }
  /** 중단 신호로 끊었다. */
  | { type: 'cancelled' };

/**
 * 실행기 포트.
 * 에이전트마다 하나씩 두며, 에이전트 실행 계약을 지키는 한 교체할 수 있다.
 */
export interface Executor {
  /** 이 실행기가 부르는 에이전트. */
  readonly agent: AgentId;
  /** 에이전트를 한 번 실행한다. */
  run(request: ExecutorRunRequest): Promise<ExecutorOutcome>;
}
