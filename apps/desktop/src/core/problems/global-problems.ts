import type { Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { AppNotification, Notifier } from '../ports/notifier';

/** "키 확인 필요"가 생긴 이유. 띠 문구가 이유마다 다르다. */
export type FlowKeyProblemReason =
  /** Flow가 키를 거부했다(`401`). */
  | 'rejected'
  /** 저장된 키를 읽을 수 없다(키체인 거부, 항목 삭제, 다른 PC로 복사, 키 파일 없음). */
  | 'unreadable';

/**
 * 감지를 멈추게 하는 전역 문제. 원인(`cause`)마다 하나만 있다.
 * 에이전트 전역 실패(CLI 없음, 미로그인, CLI 업데이트 필요, 점검 실행 실패)는 뒤 티켓이 원인으로 더한다.
 */
export type GlobalProblem =
  /** 키 확인 필요. */
  { cause: 'flow-key'; reason: FlowKeyProblemReason };

/** 전역 문제의 원인. */
export type GlobalProblemCause = GlobalProblem['cause'];

/** 지금 있는 전역 문제 하나. */
export interface ActiveGlobalProblem {
  /** 문제. */
  problem: GlobalProblem;
  /** 이 원인이 처음 생긴 시각(Unix epoch 밀리초). 해결되기 전에 같은 원인이 다시 와도 바뀌지 않는다. */
  since: number;
}

/**
 * 띠·트레이 메뉴에 하나만 보일 때의 원인 순서. 앞이 먼저 보인다.
 * 키가 없으면 에이전트를 고쳐도 감지할 수 없으므로 키 문제가 맨 앞이다.
 */
const CAUSE_ORDER: readonly GlobalProblemCause[] = ['flow-key'];

/** 전역 문제에 필요한 포트. */
export interface GlobalProblemsOptions {
  /** 문제가 새로 생길 때 OS 알림을 보낼 곳. */
  notifier: Notifier;
  /** 문제가 생긴 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. */
  logger: Logger;
  /** 문제의 OS 알림 문구. 문구는 OS마다 달라 main이 정한다. */
  notificationFor: (problem: GlobalProblem) => AppNotification;
}

/**
 * 전역 문제 상태. 트레이 "!", 작은 창 띠, 오른쪽 클릭 메뉴 맨 위 항목, OS 알림이 이 상태를 따른다.
 * OS 알림은 원인이 새로 생길 때만 띄운다. 해결되기 전에 같은 원인이 다시 와도 띄우지 않고, 해결된 뒤 다시 생기면 띄운다.
 */
export class GlobalProblems {
  /** 원인별로 지금 있는 문제. */
  private readonly active = new Map<GlobalProblemCause, ActiveGlobalProblem>();
  /** 맨 앞 전역 문제가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(current: ActiveGlobalProblem | null) => void>();

  constructor(private readonly options: GlobalProblemsOptions) {}

  /** 지금 보일 맨 앞 전역 문제. 없으면 `null`. */
  current(): ActiveGlobalProblem | null {
    for (const cause of CAUSE_ORDER) {
      /** 이 원인의 문제. */
      const found = this.active.get(cause);
      if (found) return found;
    }
    return null;
  }

  /** 맨 앞 전역 문제가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: (current: ActiveGlobalProblem | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 문제가 생겼다. 같은 원인이 이미 있으면 이유만 바꾸고 알림은 다시 띄우지 않는다. */
  raise(problem: GlobalProblem): void {
    /** 같은 원인으로 이미 있는 문제. */
    const existing = this.active.get(problem.cause);
    if (existing && isSameProblem(existing.problem, problem)) return;

    this.update(() => this.active.set(problem.cause, { problem, since: existing?.since ?? this.options.clock.now() }));
    if (existing) return;

    this.options.logger.warn('global-problem.raised', { cause: problem.cause, reason: problem.reason });
    this.options.notifier.notify(this.options.notificationFor(problem));
  }

  /** 원인이 해결됐다. 그 원인의 문제를 지운다. */
  resolve(cause: GlobalProblemCause): void {
    if (!this.active.has(cause)) return;
    this.update(() => this.active.delete(cause));
    this.options.logger.info('global-problem.resolved', { cause });
  }

  /** 상태를 바꾸고, 맨 앞 전역 문제가 바뀌었으면 듣는 쪽에 알린다. */
  private update(change: () => void): void {
    /** 바꾸기 전 맨 앞 전역 문제. */
    const before = this.current();
    change();
    /** 바꾼 뒤 맨 앞 전역 문제. */
    const after = this.current();
    if (before === after) return;
    for (const listener of this.listeners) listener(after);
  }
}

/** 두 문제가 같은 원인과 같은 이유인지 본다. */
function isSameProblem(a: GlobalProblem, b: GlobalProblem): boolean {
  return a.cause === b.cause && a.reason === b.reason;
}
