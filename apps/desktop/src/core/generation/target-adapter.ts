import type { AgentId, ExecutorReport, ExecutorRunRequest } from '../ports/executor';
import type { GenerationRunKind, RunFailureReason, RunRecord, TargetKind } from './generation-run';

/**
 * 대상 어댑터마다 다른 타입의 묶음. 생성 대기열은 이 타입의 값을 들고 다니기만 하고 안을 보지 않는다.
 */
export interface TargetTypes {
  /** 생성을 시작할 때 어댑터가 만든 시작 표식. "아직 생성 중인가"를 판정하고 결과를 저장할 때 다시 넘긴다. */
  job: unknown;
  /** 저장할 결과. 마지막 실행의 출력을 어댑터가 검증해 만든다. */
  result: unknown;
  /** 저장소 대기 기록에 남길 내용. */
  repoWait: unknown;
  /** 어댑터가 실행 전에 남기는 실패 사유(Flow 맥락 조회 실패 등). 에이전트 실행의 실패 사유에 더해진다. */
  failureReason: string;
}

/** 대상의 실패. 실패 화면에 오류와 마지막 단계로 보인다. */
export interface TargetFailure<Reason extends string = never> {
  /** 사유. */
  reason: Reason | RunFailureReason;
  /** 에이전트가 알려 준 오류 원문. 없으면 `null`. */
  detail: string | null;
  /** 실패할 때의 마지막 진행 단계. 실행을 시작하기 전이면 `null`. */
  lastStep: string | null;
  /** 실패한 실행의 종류. 실행을 시작하기 전에 실패했으면 `null`. */
  runKind: GenerationRunKind | null;
}

/** 실행기에 넘길 실행 하나의 요청 가운데 어댑터가 정하는 것. 실행의 종류, 중단 신호, 진행 알림은 대기열이 붙인다. */
export type TargetRunRequest = Omit<ExecutorRunRequest, 'kind' | 'signal' | 'onProgress'>;

/** 구조화 출력을 읽은 결과. 읽을 수 없으면 실패 사유를 돌려주고, 일시적 실패(구조 실패 등)면 대기열이 한 번 더 실행한다. */
export type RunReading<Output> =
  /** 앱이 읽은 출력. */
  | { kind: 'output'; output: Output }
  /** 읽지 못했거나 쓸 수 없는 출력. */
  | { kind: 'failed'; reason: RunFailureReason; detail: string | null };

/** 읽은 출력을 검증한 결과. 다시 실행하지 않는다. `fixes`는 앱이 고친 내용 불일치로, 실행 기록에만 남는다. */
export type RunCheck<T extends TargetTypes> =
  /** 쓸 수 있는 출력이다. 다음에 할 일을 함께 돌려준다. */
  | { kind: 'passed'; fixes: string[]; next: NextStep<T> }
  /** 결과 전체를 버렸다(비밀 파일을 근거로 듦 등). 대상은 이 사유로 실패한다. */
  | { kind: 'rejected'; fixes: string[]; reason: RunFailureReason };

/**
 * 에이전트 실행 하나. 대상 하나를 만드는 동안 여러 실행이 이어질 수 있다(실행이 이어지는 대상).
 * 대기열이 실행 직전 확인, 일시적 실패 재시도, 전역 실패 판정, 실행 기록을 맡고 어댑터는 요청과 결과 읽기만 맡는다.
 */
export interface TargetRun<T extends TargetTypes, Output = unknown> {
  /** 실행의 종류. */
  kind: GenerationRunKind;
  /** 실행을 시작할 때의 진행 단계. 도구를 부르기 전까지 보인다. */
  step: string;
  /** 입력의 맥락에서 길이 상한 때문에 뺀 항목 수. 실행 기록에 남긴다. */
  omittedContextItems: number;
  /**
   * 이번 실행에 쓸 모델과 에이전트로 실행 요청을 만든다. 지침·입력·출력 스키마·읽을 저장소·시간 상한을 담는다. 설정은 실행마다 새로 읽는다.
   * 에이전트는 그 CLI 자신의 설정을 읽어야 하는 요청(재현에 싣는 MCP 등)만 쓴다.
   */
  request(model: string | null, agent: AgentId): Promise<TargetRunRequest>;
  /** 결과 읽기. 구조화 출력의 모양을 읽는다. */
  read(output: unknown): RunReading<Output>;
  /** 읽은 출력을 검증하고 다음에 할 일을 정한다. `request`는 이 출력을 낸 실행의 요청이고, `report`는 그 실행에서 실행기가 알려 준 것이다. */
  check(output: Output, request: TargetRunRequest, report: ExecutorReport): Promise<RunCheck<T>>;
  /**
   * 생성이 끝난 뒤(결과 저장, 실패 기록, 취소, 대기열에 되돌림, 앱 종료 모두) 한 번 부르는 정리. 실행 전후에 만들고 치울 것(재현 사본,
   * 실행이 새로 켠 시뮬레이터 등)이 있는 실행만 둔다. 대기열은 이 정리가 끝난 뒤에 함께 돌 수 없는 자원을 놓는다. 던져도 생성 결과는 바뀌지 않는다.
   */
  release?(): Promise<void>;
}

/** 준비나 실행 뒤에 이어서 할 일. 대기열이 실행 기록과 함께 어댑터의 저장·실패 기록·저장소 대기 기록을 부른다. */
export type NextStep<T extends TargetTypes> =
  /** 에이전트를 한 번 실행한다. 출력의 타입은 그 실행만 알고, 대기열은 `read`가 낸 것을 `check`에 그대로 넘긴다. */
  | { kind: 'run'; run: TargetRun<T> }
  /** 결과를 저장한다. */
  | { kind: 'save'; result: T['result'] }
  /** 실행 없이 실패로 둔다(맥락을 조회하지 못함 등). */
  | { kind: 'fail'; reason: T['failureReason'] | RunFailureReason }
  /** 저장소를 정하지 못해 저장소 대기로 둔다. */
  | { kind: 'repo-wait'; wait: T['repoWait'] };

/** 준비의 결과. */
export type Preparation<T extends TargetTypes> =
  /** 준비했다. 이어서 할 일이다. */
  | { kind: 'ready'; next: NextStep<T> }
  /** 건너뜀. 대상이 더는 생성 중이 아니거나 어댑터가 이미 다른 상태로 옮겼다(저장소 대기, 이미 답함 등). */
  | { kind: 'skipped' }
  /** 어댑터 멈춤. 어댑터의 연결 문제(Flow 키 거부 등)라 연결이 바뀌었다는 알림이 올 때까지 이 어댑터의 대상만 멈춘다. */
  | { kind: 'adapter-paused' }
  /** 잠시 뒤 다시. 지금 프로바이더에 닿지 못해 `afterMs` 동안 이 어댑터의 대상만 멈춘다. */
  | { kind: 'retry-later'; afterMs: number };

/** 준비가 대기열에서 받는 것. */
export interface PrepareContext {
  /** 앱이 생성을 멈췄는지(취소, 대상이 바뀜, 앱 종료 등) 본다. 참이면 남은 준비를 하지 않고 아무 결과나 돌려줘도 된다. */
  stopped(): boolean;
}

/**
 * 대상 어댑터. 생성 대기열에서 대상의 종류마다 다른 부분을 맡는다.
 * 대상 목록과 연결 상태, 준비(지침·입력·출력 스키마·저장소·시간 상한·실행 종류), 결과 읽기, 저장, 실패 기록, 저장소 대기 기록,
 * "아직 생성 중인가" 판정이다. 대기열은 대상을 `(kind, targetId)`로만 안다.
 */
export interface TargetAdapter<T extends TargetTypes = TargetTypes> {
  /** 이 어댑터가 맡는 대상의 종류. */
  readonly kind: TargetKind;
  /** 준비하는 동안 보일 진행 단계. */
  readonly preparingStep: string;
  /** 생성할 차례를 기다려야 하는 대상 ID. 화면의 대기열 순서다. */
  generatingTargets(): readonly number[];
  /** 사용자가 요청해 생성 중이 된 대상인지 본다. 참이면 `user` 칸에 선다. */
  requestedByUser(targetId: number): boolean;
  /** 대상이 바뀔 때마다 `listener`를 부르게 한다. 돌려준 함수를 부르면 그만 부른다. */
  onTargetsChange(listener: () => void): () => void;
  /** 이 어댑터의 연결을 지금 쓸 수 있는지 본다. 거짓이면 이 어댑터의 대상은 시작하지 않고 순서를 지킨 채 기다린다. */
  connectionUsable(): boolean;
  /** 연결을 쓸 수 있는지가 바뀔 수 있을 때마다 `listener`를 부르게 한다. 어댑터 멈춤이 풀린다. 돌려준 함수를 부르면 그만 부른다. */
  onConnectionChange(listener: () => void): () => void;
  /**
   * 대상이 쓸, 다른 실행과 함께 돌 수 없는 자원(재현 등). 같은 자원을 쓰는 대상은 한 번에 하나만 돌고, 기다리는 대상은 자리를 지키며
   * 대기열은 그 뒤에서 돌 수 있는 대상을 꺼낸다. 자원은 생성이 끝날 때(어댑터의 정리까지) 놓는다. 없으면 `null`이고, 이 메서드가 없으면 제한이 없다.
   */
  exclusiveResource?(targetId: number): string | null;
  /** 생성을 시작한다. 시작할 수 있으면 시작 표식을, 대상이 더는 생성 중이 아니면 `null`을 돌려준다. */
  begin(targetId: number): T['job'] | null;
  /** "아직 생성 중인가". `job`이 있으면 그 표식을 만들 때와 같은 대상인지도 본다. */
  isGenerating(targetId: number, job: T['job'] | null): boolean;
  /** 실행 직전 준비. 저장소를 확인하고 입력을 모아 이어서 할 일을 정한다. */
  prepare(targetId: number, job: T['job'], context: PrepareContext): Promise<Preparation<T>>;
  /** 결과를 저장한다. 그사이 대상이 바뀌어 저장하지 못했으면 거짓이다. */
  save(targetId: number, job: T['job'], result: T['result'], runs: readonly RunRecord[]): Promise<boolean>;
  /** 실패를 기록한다. `job`이 `null`이면(취소, 앱 오류) 대상이 바뀌었는지 보지 않는다. 기록하지 못했으면 거짓이다. */
  fail(targetId: number, job: T['job'] | null, failure: TargetFailure<T['failureReason']>, runs: readonly RunRecord[]): Promise<boolean>;
  /** 저장소 대기를 기록한다. 기록하지 못했으면 거짓이다. */
  needsRepoCheck(targetId: number, job: T['job'], wait: T['repoWait'], runs: readonly RunRecord[]): Promise<boolean>;
  /** 대상을 그대로 두고 실행 기록만 더한다. */
  addRuns(targetId: number, runs: readonly RunRecord[]): Promise<void>;
}
