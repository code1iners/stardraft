import type { AgentId, ExecutorFailureReason, ExecutorUsage, RunKind } from '../ports/executor';

/**
 * 생성 대기열이 다루는 대상의 종류. 대상 어댑터 하나가 종류 하나를 맡는다. Flow 멘션 묶음은 `flow`다.
 * 대기열 표에 그대로 남으므로 한 번 쓴 값은 바꾸지 않는다.
 */
export type TargetKind = string;

/** 생성 대기열이 아는 대상. 대기열은 대상을 종류와 대상 ID로만 안다. 대상 ID는 그 종류의 어댑터가 저장한 행의 ID다. */
export interface TargetRef {
  /** 대상의 종류. */
  kind: TargetKind;
  /** 대상 ID. */
  targetId: number;
}

/** 대상 하나를 만들 때 돌리는 실행의 종류. 작동 확인은 대기열이 돌리지 않는다. */
export type GenerationRunKind = Exclude<RunKind, 'check'>;

/**
 * 폐지된 저장소 선택 실행. 새 실행은 이 종류를 돌리지 않고, 과거 실행 기록과 실패에 남은 값을 읽을 때만 허용한다.
 * 화면에는 "저장소 선택(폐지됨)"으로 보인다.
 */
export type RetiredRunKind = 'selection';

/** 저장된 실행 기록과 실패에서 읽을 수 있는 실행의 종류. 폐지된 저장소 선택 실행을 포함한다. */
export type RecordedRunKind = RunKind | RetiredRunKind;

/**
 * 생성 대기열에서 대상이 들어가는 자리. 앞 자리일수록 먼저 실행하고, 같은 자리끼리는 들어온 순서대로 실행한다.
 * - `resume`: 바로 이어서 돌아야 하는 대상. 끊긴 생성을 처음부터 다시 하는 대상(실행 중에 대상이 바뀜, 전역 실패나 어댑터 멈춤으로 멈춤,
 *   앱이 꺼지며 끊음)이다. 맨 앞이다.
 * - `user`: 사용자가 누른 행동(다시 시도, 되돌리기)으로 생성 중이 된 대상. 감지한 대상보다 앞이다.
 * - `auto`: 감지했거나 앱을 켤 때 이미 생성 중이던 대상. 끝에 들어간다.
 */
export const QUEUE_PRIORITIES = ['resume', 'user', 'auto'] as const;

/** 생성 대기열에서 대상이 들어가는 자리. */
export type QueuePriority = (typeof QUEUE_PRIORITIES)[number];

/** 대기열 자리인지 본다. 저장한 값을 읽을 때 쓴다. */
export function isQueuePriority(value: string): value is QueuePriority {
  return (QUEUE_PRIORITIES as readonly string[]).includes(value);
}

/** 생성 대기열에서 차례를 기다리는 대상. 앱이 꺼진 뒤 다시 켤 때 같은 순서로 돌도록 이 모양으로 남긴다. */
export interface QueuedTarget extends TargetRef {
  /** 들어간 자리. */
  priority: QueuePriority;
}

/**
 * 에이전트를 실행해서 생긴 실패 사유. 실행기가 알려 준 실패 이유(CLI 없음, 미로그인, 과부하 등)는 그대로 쓴다.
 * 대상마다 실행 전에 생기는 실패 사유(Flow 맥락 조회 실패 등)는 그 어댑터가 더한다.
 */
export type RunFailureReason =
  /** 취소함. 사용자가 생성을 취소했다. */
  | 'cancelled'
  /** 시간 초과. 실행이 그 실행의 제한 시간 안에 끝나지 않았다. */
  | 'timed-out'
  /** 구조 실패. 다시 시도해도 구조화 출력이 없거나 앱이 읽을 수 없었다. */
  | 'invalid-output'
  /** 빈 초안. 초안 문장이 하나도 없었다. */
  | 'empty-draft'
  /** 비밀 파일을 근거로 듦. 근거 경로가 비밀 파일 패턴에 맞아 결과 전체를 버렸다. */
  | 'secret-evidence'
  /** 앱 안에서 예상하지 못한 오류가 났다. */
  | 'app-error'
  | ExecutorFailureReason;

/**
 * 실행 하나의 결과. 성공, 대상이 바뀌어 멈춤, 비밀 파일 패턴을 추가해 멈춤, 앱 종료로 중단, 또는 실패 사유다.
 * `bundle-changed`는 실행 중에 대상이 바뀌었거나(Flow 묶음에 새 멘션이 합쳐짐 등) 더는 생성 중이 아니게 되어 앱이 실행을 멈춘 것이다.
 * 생성 중으로 남았으면 처음부터 다시 만든다. 저장한 실행 기록과 맞추려고 Flow 시절의 이름을 그대로 쓴다.
 * `secret-patterns-changed`는 실행 중에 비밀 파일 패턴을 추가해 앱이 실행을 멈춘 것이다. 대기열 맨 앞에서 새 패턴으로 처음부터 다시 만든다.
 * `app-quit`은 앱을 끄며 실행을 끊은 것이다. 자동 재시도 1회에 세지 않고, 다시 켜면 그 대상을 대기열 맨 앞에서 처음부터 다시 만든다.
 */
export type RunResult = 'succeeded' | 'bundle-changed' | 'secret-patterns-changed' | 'app-quit' | RunFailureReason;

/**
 * 실행 기록. 에이전트를 한 번 실행할 때마다 남긴다. 화면에는 상세 머리의 실행 줄만 보이고 비용은 보이지 않는다.
 * 대상의 전체 기록에 속해 대상과 함께 지운다.
 */
export interface RunRecord {
  /** 실행의 종류. 옛 기록은 폐지된 저장소 선택 실행일 수 있다. */
  kind: RecordedRunKind;
  /** 실행한 에이전트. */
  agent: AgentId;
  /** 실행에서 본 CLI 버전. 모르면 `null`. */
  cliVersion: string | null;
  /** 에이전트가 쓴 모델. 모르면 고른 모델이고, 기본 모델을 골랐으면 `null`일 수 있다. */
  model: string | null;
  /** 시작 시각(Unix epoch 밀리초). */
  startedAt: number;
  /** 끝난 시각(Unix epoch 밀리초). */
  finishedAt: number;
  /** 결과. */
  result: RunResult;
  /** 에이전트가 알려 준 오류 원문. 없으면 `null`. */
  detail: string | null;
  /** 마지막 진행 단계. */
  lastStep: string | null;
  /** 앱이 고친 내용 불일치. 화면에는 알리지 않는다. */
  fixes: string[];
  /** 입력의 맥락에서 길이 상한 때문에 뺀 항목 수. */
  omittedContextItems: number;
  /** 에이전트가 알려 준 비용과 토큰 수. 알려 주지 않았으면 `null`. */
  usage: ExecutorUsage | null;
}
