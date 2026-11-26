import type { AgentPreferencesState } from '../agent/agent-preferences';
import { suspectsGlobalFailure } from '../agent/run-failures';
import { errorFields, type Logger } from '../logging/logger';
import { waitAtMost, type CancelScheduled, type Clock } from '../ports/clock';
import type { Executor, ExecutorOutcome, ExecutorReport } from '../ports/executor';
import type { GenerationQueueStore } from '../ports/generation-queue-store';
import type {
  GenerationRunKind,
  QueuedTarget,
  QueuePriority,
  RunFailureReason,
  RunRecord,
  RunResult,
  TargetKind,
  TargetRef,
} from './generation-run';
import type { NextStep, TargetAdapter, TargetFailure, TargetRun, TargetRunRequest, TargetTypes } from './target-adapter';

/** 실행 단계마다 실행하는 최대 횟수. 처음 실행과 일시적 실패의 자동 재시도 1회다. */
const MAX_ATTEMPTS = 2;
/**
 * 일시적 실패. 자동으로 다시 실행하는 실패는 이것뿐이다. 구조 실패(구조화 출력 없음), 모델 과부하, 네트워크 오류다.
 * 시간 초과, 취소, 형식 위반(빈 초안, 비밀 파일을 근거로 듦)은 다시 실행해도 같을 가능성이 커 다시 실행하지 않는다.
 */
const TRANSIENT_FAILURES: readonly RunFailureReason[] = ['invalid-output', 'overloaded', 'network'];
/**
 * 앱을 끌 때 끊은 실행이 멈춰 "앱 종료로 중단" 기록을 남기기를 기다려 주는 가장 긴 시간(밀리초).
 * 실행기는 프로세스 트리를 끝낸 뒤 늦어도 몇 초 안에 돌아오지만, 준비(프로바이더 조회) 중에 끊겼으면 조회가 끝날 때까지 기다리지 않는다.
 */
const QUIT_RECORD_WAIT_MS = 5_000;

/** 생성 대기열이 실행에 쓰는 에이전트 연결 하나. 연결 확인이 만든 실행기와 실행 직전 확인을 준다. */
export interface RunnableAgent {
  /** 이 에이전트의 실행기. */
  readonly executor: Executor;
  /**
   * 실행 직전에 이 에이전트로 실행해도 되는지 확인한다. 진행 중인 연결 확인이 있으면 끝나기를 기다리고,
   * CLI 버전이 바뀌었으면 작동 확인을 먼저 돌린다. 실행해도 되면 참이다.
   */
  confirmForRun(): Promise<boolean>;
}

/** 실행에 쓸 에이전트. 기본 에이전트의 연결과 그 에이전트에 고른 모델이다. 실행 직전 확인이 거짓이면 실행하지 않고 대기열을 멈춘다. */
export interface QueueAgent extends RunnableAgent {
  /** 고른 모델. 기본 모델(에이전트가 정함)이면 `null`. */
  model: string | null;
}

/**
 * 실행에 쓸 에이전트를 고른다. 기본 에이전트의 연결이 만든 실행기와 실행 직전 확인, 그 에이전트에 고른 모델이다.
 * 연결된 에이전트가 없거나(기본 에이전트가 없음) 기본 에이전트의 연결이 없으면 `null`이고, 생성 대기열은 기다린다.
 */
export function queueAgentFrom(preferences: AgentPreferencesState, agents: readonly RunnableAgent[]): QueueAgent | null {
  /** 기본 에이전트. */
  const agent = preferences.defaultAgent;
  /** 기본 에이전트의 연결. */
  const connection = agent === null ? undefined : agents.find((candidate) => candidate.executor.agent === agent);
  if (agent === null || !connection) return null;
  return { executor: connection.executor, model: preferences.models[agent]?.selected ?? null, confirmForRun: () => connection.confirmForRun() };
}

/** 생성 중 대상의 진행. 작은 창과 펼친 창에 진행 단계 한 줄과 읽은 파일 수로 보인다. */
export type GenerationProgress =
  /** 대기열에서 차례를 기다린다. 에이전트 연결을 기다리는 것과 멈춘 대기열·어댑터에서 기다리는 것도 여기에 든다. */
  | { status: 'waiting' }
  /** 실행하고 있다. */
  | { status: 'running'; step: string; filesRead: number };

/** 생성 대기열에 필요한 것. */
export interface GenerationQueueOptions {
  /** 대상 어댑터. 종류마다 하나다. 같은 차례의 대상끼리는 여기 둔 순서로 대기열에 들어간다. */
  adapters: readonly TargetAdapter[];
  /** 지금 실행에 쓸 에이전트. 에이전트 연결이 없으면 `null`이고, 대기열은 연결될 때까지 기다린다. */
  agent: () => QueueAgent | null;
  /** 에이전트 연결이나 기본 에이전트·모델이 바뀔 때마다 `listener`를 부르게 한다. 돌려준 함수를 부르면 그만 부른다. */
  onAgentChange: (listener: () => void) => () => void;
  /** 대기열이 바뀔 때마다 남기고 다시 켤 때 읽는 저장소. */
  store: GenerationQueueStore;
  /** 실행 시작·종료 시각을 읽고 어댑터 멈춤의 기다림을 재는 시계. */
  clock: Clock;
  /** 진단 로그. 종류·ID와 개수만 남기고 대상의 내용은 남기지 않는다. */
  logger: Logger;
}

/**
 * 앱이 실행을 멈춘 까닭. `user`는 [취소], `target-changed`는 대상이 바뀜, `secret-patterns-changed`는 비밀 파일 패턴 추가,
 * `app-quit`은 앱 종료다.
 */
type Interruption = 'user' | 'target-changed' | 'secret-patterns-changed' | 'app-quit';

/** 자리의 순서. 작을수록 앞이다. */
const PRIORITY_ORDER: Readonly<Record<QueuePriority, number>> = { resume: 0, user: 1, auto: 2 };

/**
 * 모든 대상을 멈추게 한 까닭(전역 멈춤). `agent`는 에이전트를 쓸 수 없음(전역 실패)이고 연결이 바뀌었다는 알림이 오면 풀린다.
 * `restart`는 앱 내 업데이트의 다시 시작을 기다림이고, 다시 시작을 거두면 풀린다.
 */
type GlobalPause = 'agent' | 'restart';

/**
 * 한 어댑터의 대상만 멈추게 한 까닭(어댑터 멈춤). `connection`은 그 어댑터의 연결 문제(Flow 키 거부 등)이고 연결이 바뀌었다는 알림이 오면 풀린다.
 * `retry`는 지금 프로바이더에 닿지 못함(네트워크 오류, 요청 한도)이고 기다릴 시간이 지나면 풀린다.
 */
type AdapterPause = 'connection' | 'retry';

/** 어댑터 하나와 그 멈춤 상태. 실행 자리(병렬 작업 수)와는 상관없다. */
interface AdapterState {
  /** 어댑터. */
  adapter: TargetAdapter;
  /** 이 어댑터를 멈추게 한 까닭. */
  paused: Set<AdapterPause>;
  /** 연결이 바뀌었다는 알림을 받은 횟수. 준비하는 사이에 알림이 왔는지 보려고 센다. */
  connectionChanges: number;
  /** 다시 보는 예약을 지우는 함수. 예약이 없으면 `null`. */
  cancelRetry: CancelScheduled | null;
}

/** 실행하고 있는 대상. */
interface RunningTarget extends TargetRef {
  /** 대상의 어댑터. */
  slot: AdapterState;
  /** 실행을 끊는 장치. 끊으면 실행기가 프로세스 트리를 끝낸다. */
  abort: AbortController;
  /** 앱이 실행을 멈춘 까닭. 멈추지 않았으면 `null`. */
  interruption: Interruption | null;
  /** 생성을 시작할 때 어댑터가 만든 시작 표식. 시작하기 전이면 `null`. */
  job: unknown;
  /** 시작 표식을 받았는지 여부. 표식 자체는 어댑터마다 `null`일 수도 있어 따로 둔다. */
  begun: boolean;
  /** 마지막 진행 단계. */
  step: string;
  /** 지금 실행에서 읽은 파일 수. */
  filesRead: number;
  /** 마지막으로 시작한 실행 단계의 종류. 실행 단계를 시작하기 전이면 `null`. 실패에 남긴다. */
  runKind: GenerationRunKind | null;
}

/** 대상 하나를 만드는 생성 한 번. */
interface Generation {
  /** 실행하는 대상. */
  entry: RunningTarget;
  /** 이번 생성에서 남긴 실행 기록. 실행한 순서다. */
  runs: RunRecord[];
}

/** 실패한 실행의 결과. `retry`는 일시적 실패라 한 번 더 실행할 실패인지 여부다. */
type FailedVerdict = { kind: 'failed'; reason: RunFailureReason; detail: string | null; retry: boolean };

/** 에이전트 실행 한 번의 결과를 읽은 것. */
type RunVerdict = { kind: 'output'; output: unknown } | FailedVerdict;

/** 출력 검증까지 마친 실행의 결과. 쓸 수 있으면 다음 일, 아니면 실패다. `fixes`는 실행 기록에 남길 고친 내용이다. */
type CheckedRun = { kind: 'passed'; fixes: string[]; next: NextStep<TargetTypes> } | { kind: 'failed'; fixes: string[]; verdict: FailedVerdict };

/** 실행 단계의 끝. */
type PhaseResult =
  /** 마지막 실행의 결과와 실행 기록, 그 실행의 요청. 기록은 아직 실행 기록에 넣지 않았다. */
  | { kind: 'ran'; verdict: RunVerdict; record: RunRecord; request: TargetRunRequest }
  /** 앱이 실행을 멈췄거나 전역 실패로 대상을 대기열에 되돌려 이번 생성이 끝났다. */
  | { kind: 'stopped' };

/**
 * 생성 대기열. 프로바이더와 무관하게 대상을 하나씩 꺼내 에이전트 실행을 돌리는 직렬 대기열이다(한 번에 하나만 실행한다).
 * 대상은 `(종류, 대상 ID)`로만 알고, 대상마다 다른 일(준비, 결과 읽기, 저장, 실패·저장소 대기 기록)은 대상 어댑터에 맡긴다.
 * 끊긴 생성과 사용자 행동은 감지한 대상보다 앞에 넣는다. 실행마다 직전에 에이전트를 확인한다.
 * 일시적 실패는 한 번 다시 실행하고, 전역 실패는 대상을 실패로 두지 않고 대기열 전체를 멈췄다가 원인이 풀리면 다시 돈다.
 * 어댑터의 연결 문제는 그 어댑터의 대상만 멈추고, 멈춘 대상은 순서를 지킨 채 기다리며 다른 어댑터의 대상이 그 앞으로 지나간다.
 * 실행 중인 대상의 진행 단계는 메모리에만 둔다.
 */
export class GenerationQueue {
  /** 차례를 기다리는 대상. 자리 순서대로 서 있고 앞에서부터 꺼낸다. */
  private waiting: QueuedTarget[] = [];
  /** 사용자 행동으로 곧 생성 중이 될 대상에 잡아 둔 자리. 대상이 바뀌는 즉시 대기열을 맞추므로, 대상을 바꾸기 전에 적어 둔다. */
  private readonly reservedPriorities = new Map<string, QueuePriority>();
  /** 다음 실행을 시작하는 중(실행 직전 확인)이거나 실행하고 있는지 여부. 한 번에 하나만 실행하게 한다. */
  private busy = false;
  /** 실행하고 있는 대상. 없으면 `null`. */
  private running: RunningTarget | null = null;
  /** 모든 대상을 멈추게 한 까닭. */
  private readonly paused = new Set<GlobalPause>();
  /** 에이전트 연결이 바뀌었다는 알림을 받은 횟수. 확인하는 사이에 알림이 왔는지 보려고 센다. */
  private agentChanges = 0;
  /** 종류마다 어댑터와 그 멈춤 상태. */
  private readonly slots: ReadonlyMap<TargetKind, AdapterState>;
  /** 대기열 상태. `starting`은 앱이 꺼지기 전에 남긴 대기열을 읽는 중이고, `stopped`면 새 실행을 시작하지 않는다. */
  private status: 'idle' | 'starting' | 'started' | 'stopped' = 'idle';
  /** 실행 직전 확인부터 생성이 끝날 때까지의 일. 앱을 끌 때 끊은 실행의 기록을 기다린다. 없으면 `null`. */
  private runTask: Promise<void> | null = null;
  /** 마지막으로 남긴 대기열의 JSON. 대기열이 바뀐 때만 다시 남긴다. */
  private savedQueueJson: string | null = null;
  /** 어댑터와 에이전트 연결 구독을 끊는 함수. */
  private readonly unsubscribes: (() => void)[] = [];
  /** 진행이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: GenerationQueueOptions) {
    this.slots = new Map(options.adapters.map((adapter) => [adapter.kind, { adapter, paused: new Set(), connectionChanges: 0, cancelRetry: null }]));
  }

  /**
   * 대기열을 시작한다. 앱이 꺼지기 전에 남긴 대기열이 있으면 그 순서와 자리 그대로 먼저 넣는다(끊긴 실행의 대상이 맨 앞이다).
   * 남긴 대기열에 없는 생성 중 대상은 어댑터 순서와 각 어댑터의 화면 순서로 끝에 넣고, 그 뒤 대상과 연결이 바뀔 때마다 다시 본다.
   * 대기열은 바뀔 때마다 남겨, 끌 때의 정리 없이 꺼져도(강제 종료, Windows 종료·로그아웃) 다시 켤 때 같은 순서로 돈다.
   */
  async start(): Promise<void> {
    if (this.status !== 'idle') return;
    this.status = 'starting';
    /** 앱이 꺼지기 전에 남긴 대기열. 읽지 못하면 없는 것으로 보고 화면 순서로 넣는다. */
    const saved = await this.options.store.getGenerationQueue().catch((error: unknown) => {
      this.options.logger.error('generation.saved-queue-read-failed', errorFields(error));
      return [];
    });
    // 읽는 사이에 앱을 끝냈으면 남긴 대기열을 쓰지 않았으므로 다음에 켤 때 쓰도록 그대로 둔다.
    if (this.status !== 'starting') return;
    this.status = 'started';
    // 더는 생성 중이 아닌 대상과 모르는 종류의 대상은 바로 아래 `sync`가 뺀다.
    for (const queued of saved) this.enqueue(queued, queued.priority);
    this.unsubscribes.push(this.options.onAgentChange(() => this.agentChanged()));
    for (const slot of this.slots.values()) {
      this.unsubscribes.push(
        slot.adapter.onTargetsChange(() => this.sync()),
        slot.adapter.onConnectionChange(() => this.connectionChanged(slot)),
      );
    }
    this.sync();
    this.saveQueueIfChanged();
  }

  /**
   * 대기열을 멈춘다. 앱을 끝낼 때 부른다. 실행 중인 실행은 끊어 프로세스 트리를 끝내고, 대상은 생성 중으로 둔다.
   * 멈출 때의 대기열을 남겨 다시 켤 때 그 순서와 자리로 돌게 한다. 끊은 실행의 대상은 맨 앞이다.
   * 끊은 실행이 "앱 종료로 중단" 기록을 남기기를 최대 5초 기다린다.
   */
  async stop(): Promise<void> {
    /** 멈추기 전 상태. */
    const before = this.status;
    if (before === 'stopped') return;
    this.status = 'stopped';
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    for (const slot of this.slots.values()) {
      slot.cancelRetry?.();
      slot.cancelRetry = null;
    }
    // 시작하기 전이면 앞서 남긴 대기열을 아직 쓰지 않았으므로 그대로 둔다.
    if (before !== 'started') return;

    // 멈춘 뒤에는 대기열을 다시 남기지 않으므로, 끊은 실행이 끝나 실행 중인 대상이 비기 전에 지금 대기열을 남긴다.
    this.saveQueue(this.currentQueue());
    if (this.running) this.interrupt(this.running, 'app-quit');
    if (this.runTask) await waitAtMost(this.options.clock, this.runTask, QUIT_RECORD_WAIT_MS);
  }

  /** 생성 중 대상의 진행. 대기열에 없으면 `null`. */
  progress(target: TargetRef): GenerationProgress | null {
    if (this.running && sameTarget(this.running, target)) return { status: 'running', step: this.running.step, filesRead: this.running.filesRead };
    return this.isWaiting(target) ? { status: 'waiting' } : null;
  }

  /** 에이전트 실행이 진행 중인지 본다. 앱 내 업데이트는 실행이 끝날 때까지 다시 시작을 미룬다. */
  isRunning(): boolean {
    return this.running !== null;
  }

  /**
   * 참이면 앱 내 업데이트의 다시 시작을 기다리는 동안 다음 실행을 시작하지 않는다. 실행 중인 실행은 끝까지 가고 대상은 대기열에서 기다린다.
   * 거짓이면(다시 시작을 거둠) 다시 돈다.
   */
  holdForRestart(held: boolean): void {
    if (held) this.pause('restart');
    else this.resume('restart');
  }

  /** 진행(대기열, 진행 단계, 읽은 파일 수)이 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 생성 중 대상을 취소한다. 실행 중이면 실행을 끊어 프로세스 트리를 끝내고, 기다리는 중이면 바로 "취소함" 실패로 둔다.
   * 실행을 끊은 대상은 실행이 멈춘 뒤 마지막 단계와 함께 "취소함" 실패가 된다.
   * 대기열을 시작하기 전의 생성 중 대상도 기다리는 대상처럼 취소한다. 생성 중이 아닌 대상은 어댑터가 그대로 둔다.
   */
  async cancel(target: TargetRef): Promise<void> {
    if (this.running && sameTarget(this.running, target)) {
      this.interrupt(this.running, 'user');
      return;
    }
    await this.slots.get(target.kind)?.adapter.fail(target.targetId, null, { reason: 'cancelled', detail: null, lastStep: null, runKind: null }, []);
  }

  /**
   * 비밀 파일 패턴을 추가했다. 실행 중인 실행이 있으면 끊어 프로세스 트리를 끝내고, 그 대상을 대기열 맨 앞에 다시 넣어 새 패턴으로 처음부터 다시 만든다.
   * 옛 패턴으로는 새 패턴에 맞는 파일을 읽을 수 있기 때문이다. 기다리는 대상은 실행할 때 설정을 새로 읽으므로 그대로 둔다.
   */
  restartForSecretPatterns(): void {
    if (this.running) this.interrupt(this.running, 'secret-patterns-changed');
  }

  /** 사용자 행동으로 대상을 바꾼다. 바꾸는 사이에 대상이 생성 중이 되면 감지한 대상보다 앞인 `user` 자리에 넣는다. */
  async changeByUser(target: TargetRef, change: () => Promise<void>): Promise<void> {
    /** 자리를 적어 둘 키. */
    const key = targetKey(target);
    this.reservedPriorities.set(key, 'user');
    try {
      await change();
    } finally {
      this.reservedPriorities.delete(key);
    }
  }

  /** 대상 상태에 대기열을 맞추고, 실행 중인 대상이 바뀌었으면 실행을 멈춘다. */
  private sync(): void {
    if (this.status !== 'started') return;
    /** 바꾸기 전의 대기열 순서. */
    const before = this.waitingOrder();
    /** 어댑터마다 생성 중 대상. 화면 순서다. */
    const generating = new Map([...this.slots].map(([kind, slot]) => [kind, slot.adapter.generatingTargets()]));
    // 생성 중이 아니게 된 대상(취소함, 저장소 대기 등)과 모르는 종류의 대상은 빼고, 새로 생성 중이 된 대상은 그 까닭에 맞는 자리에 넣는다.
    // 사용자가 요청한 대상은 감지해서 기다리는 대상보다 앞에 든다.
    this.waiting = this.waiting.filter((queued) => generating.get(queued.kind)?.includes(queued.targetId) === true);
    for (const [kind, targetIds] of generating) {
      /** 이 종류의 어댑터. */
      const adapter = this.slots.get(kind)!.adapter;
      for (const targetId of targetIds) {
        /** 대상. */
        const target = { kind, targetId };
        if (this.running && sameTarget(this.running, target)) continue;
        this.enqueue(target, this.reservedPriorities.get(targetKey(target)) ?? (adapter.requestedByUser(targetId) ? 'user' : 'auto'));
      }
    }
    // 실행 중인 대상이 바뀌었거나(새 멘션이 합쳐짐 등) 생성 중이 아니게 되었으면 실행을 멈춘다. 생성 중으로 남았으면 처음부터 다시 만든다.
    if (this.running && !this.isStillGenerating(this.running)) this.interrupt(this.running, 'target-changed');
    if (this.waitingOrder() !== before) this.emit();
    this.pump();
  }

  /** 대상을 대기열의 `priority` 자리 맨 뒤에 넣는다. 이미 기다리고 있으면 그대로 둔다. */
  private enqueue(target: TargetRef, priority: QueuePriority): void {
    if (this.isWaiting(target)) return;
    /** 이 대상 뒤에 설 첫 대상의 위치. 없으면 맨 뒤다. */
    const index = this.waiting.findIndex((queued) => PRIORITY_ORDER[queued.priority] > PRIORITY_ORDER[priority]);
    this.waiting.splice(index === -1 ? this.waiting.length : index, 0, { kind: target.kind, targetId: target.targetId, priority });
  }

  /** 대상이 차례를 기다리는지 본다. */
  private isWaiting(target: TargetRef): boolean {
    return this.waiting.some((queued) => sameTarget(queued, target));
  }

  /** 대기열 순서를 비교할 수 있게 대상을 이은 것. */
  private waitingOrder(): string {
    return this.waiting.map(targetKey).join(',');
  }

  /** 실행 중인 대상이 실행을 시작할 때 그대로 생성 중인지 본다. 시작 표식을 받기 전이면 생성 중인지만 본다. */
  private isStillGenerating(entry: RunningTarget): boolean {
    return entry.slot.adapter.isGenerating(entry.targetId, entry.begun ? entry.job : null);
  }

  /** 실행하고 있지 않고, 전역 멈춤이 아니고, 시작할 수 있는 대상이 있고, 에이전트 연결이 있으면 그 대상을 실행한다. */
  private pump(): void {
    if (!this.canStart()) return;
    /** 지금 실행에 쓸 에이전트. */
    const agent = this.options.agent();
    if (!agent) return;

    this.busy = true;
    /** 이번 실행. */
    const task = this.runNext(agent).finally(() => {
      if (this.runTask === task) this.runTask = null;
      this.busy = false;
      this.pump();
    });
    this.runTask = task;
  }

  /** 지금 대기열. 실행 중인 대상이 맨 앞(바로 이어서 돌 자리)이고 기다리는 대상이 그 뒤다. */
  private currentQueue(): QueuedTarget[] {
    /** 실행 중인 대상의 자리. */
    const running: QueuedTarget[] = this.running ? [{ kind: this.running.kind, targetId: this.running.targetId, priority: 'resume' }] : [];
    return [...running, ...this.waiting];
  }

  /** 대기열이 돌고 있고 마지막으로 남긴 뒤에 바뀌었으면 남긴다. */
  private saveQueueIfChanged(): void {
    if (this.status !== 'started') return;
    /** 지금 대기열. */
    const queue = this.currentQueue();
    if (JSON.stringify(queue) === this.savedQueueJson) return;
    this.saveQueue(queue);
  }

  /** 대기열을 남긴다. 남기지 못하면 로그만 남기고, 다시 켤 때 화면 순서로 넣는다. */
  private saveQueue(queue: readonly QueuedTarget[]): void {
    this.savedQueueJson = JSON.stringify(queue);
    this.options.store.setGenerationQueue(queue).catch((error: unknown) => this.options.logger.error('generation.queue-save-failed', errorFields(error)));
  }

  /** 다음 대상을 시작할 수 있는지 본다. 이미 실행 중이거나 시작할 수 있는 대상이 없으면 거짓이다. */
  private canStart(): boolean {
    return !this.busy && this.isRunnable() && this.nextStartable() !== -1;
  }

  /** 대기열이 돌 수 있는지 본다. 시작하지 않았거나 전역 멈춤이면 거짓이다. */
  private isRunnable(): boolean {
    return this.status === 'started' && this.paused.size === 0;
  }

  /** 시작할 수 있는 첫 대상의 위치. 어댑터가 멈췄거나 연결을 쓸 수 없는 대상은 자리를 지킨 채 건너뛴다. 없으면 -1이다. */
  private nextStartable(): number {
    return this.waiting.findIndex((queued) => {
      /** 대상의 어댑터. */
      const slot = this.slots.get(queued.kind);
      return slot !== undefined && slot.paused.size === 0 && slot.adapter.connectionUsable();
    });
  }

  /** 실행 직전 확인을 거쳐 시작할 수 있는 첫 대상을 만든다. 확인하는 동안 대상은 차례를 기다리는 것으로 보인다. */
  private async runNext(agent: QueueAgent): Promise<void> {
    if (!(await this.confirmAgent(agent))) return;
    // 확인하는 사이에 대기열이 바뀌었거나(취소, 사용자 행동) 멈출 까닭이 생겼을 수 있으므로 확인한 뒤에 다시 보고 꺼낸다.
    /** 다음에 실행할 대상의 위치. */
    const index = this.isRunnable() ? this.nextStartable() : -1;
    if (index === -1) return;
    /** 다음에 실행할 대상. */
    const [next] = this.waiting.splice(index, 1);
    /** 대상의 어댑터. 시작할 수 있는 대상은 어댑터가 있다. */
    const slot = this.slots.get(next!.kind)!;

    /** 실행하는 대상. */
    const entry: RunningTarget = {
      kind: next!.kind,
      targetId: next!.targetId,
      slot,
      abort: new AbortController(),
      interruption: null,
      job: null,
      begun: false,
      step: slot.adapter.preparingStep,
      filesRead: 0,
      runKind: null,
    };
    this.running = entry;
    this.emit();
    try {
      await this.generate(entry, agent);
    } catch (error) {
      await this.failAfterCrash(entry, error);
    } finally {
      this.running = null;
      this.emit();
    }
  }

  /**
   * 에이전트를 띄우기 직전에 이 실행에 쓸 에이전트를 정한다. 그때의 기본 에이전트와 모델을 읽으므로, 설정을 바꾸면 다음 실행부터 바뀐 값을 쓴다.
   * 실행 직전 확인을 이미 마친 에이전트(`confirmed`)와 같은 실행기면 다시 확인하지 않는다. 연결이 없거나 확인이 실패하면 `null`.
   */
  private async agentForRun(confirmed: QueueAgent | null): Promise<QueueAgent | null> {
    /** 지금의 기본 에이전트와 모델. */
    const agent = this.options.agent();
    if (!agent) return null;
    if (confirmed?.executor === agent.executor) return agent;
    return (await this.confirmAgent(agent)) ? agent : null;
  }

  /** 실행 직전에 에이전트를 확인한다. 쓸 수 없으면 에이전트 연결이 바뀌었다는 알림이 올 때까지 대기열 전체를 멈춘다. */
  private async confirmAgent(agent: QueueAgent): Promise<boolean> {
    /** 확인을 시작할 때까지 받은 알림 수. */
    const changesBefore = this.agentChanges;
    /** 실행해도 되는지 여부. 확인하다 예외가 나면 쓸 수 없는 것으로 본다. */
    const ready = await agent.confirmForRun().catch((error: unknown) => {
      this.options.logger.error('generation.agent-confirm-crashed', errorFields(error));
      return false;
    });
    // 확인하는 사이에 알림이 왔으면 멈추지 않고 다시 본다. 그래야 그사이 풀린 것을 놓치지 않는다.
    if (!ready && this.agentChanges === changesBefore) this.pause('agent');
    return ready;
  }

  /** 대기열 전체를 멈춘다. 이미 멈췄으면 그대로 둔다. */
  private pause(cause: GlobalPause): void {
    if (this.paused.has(cause)) return;
    this.paused.add(cause);
    this.options.logger.warn('generation.queue-paused', { cause });
  }

  /** 그 까닭으로 멈췄으면 풀고, 다음 대상을 실행할 수 있는지 다시 본다. */
  private resume(cause: GlobalPause): void {
    if (this.paused.delete(cause)) this.options.logger.info('generation.queue-resumed', { cause });
    this.pump();
  }

  /** 에이전트 연결이 바뀌었다는 알림을 받는다. 그 까닭으로 멈췄으면 풀고 다시 본다. */
  private agentChanged(): void {
    this.agentChanges += 1;
    this.resume('agent');
  }

  /**
   * 어댑터 하나의 대상만 멈춘다. `connection`은 연결이 바뀌었다는 알림이 올 때까지,
   * `retry`는 `afterMs`가 지날 때까지다. 이미 기다리고 있으면 새로 받은 시간으로 다시 잰다.
   */
  private pauseAdapter(slot: AdapterState, cause: AdapterPause, afterMs?: number): void {
    if (!slot.paused.has(cause)) this.options.logger.warn('generation.adapter-paused', { kind: slot.adapter.kind, cause });
    slot.paused.add(cause);
    if (cause !== 'retry') return;
    slot.cancelRetry?.();
    slot.cancelRetry = this.options.clock.after(afterMs ?? 0, () => {
      slot.cancelRetry = null;
      this.resumeAdapter(slot, 'retry');
    });
  }

  /** 어댑터를 그 까닭으로 멈췄으면 풀고, 다음 대상을 실행할 수 있는지 다시 본다. */
  private resumeAdapter(slot: AdapterState, cause: AdapterPause): void {
    if (slot.paused.delete(cause)) this.options.logger.info('generation.adapter-resumed', { kind: slot.adapter.kind, cause });
    this.pump();
  }

  /** 어댑터의 연결이 바뀌었다는 알림을 받는다. 연결 문제로 멈췄으면 풀고 다시 본다. */
  private connectionChanged(slot: AdapterState): void {
    slot.connectionChanges += 1;
    this.resumeAdapter(slot, 'connection');
  }

  /**
   * 대상 하나를 만든다. 시작 표식 → 어댑터의 준비 → 이어서 할 일(실행, 저장, 실패, 저장소 대기) 순서다.
   * 실행 뒤에 다른 실행이 이어지면(Flow의 선택 실행 → 초안 실행) 다른 대상에 차례를 넘기지 않고 바로 잇는다.
   * 전역 실패나 어댑터 멈춤이면 대상을 실패로 두지 않고 대기열 맨 앞에 되돌려, 다시 돌 때 처음부터 만든다.
   */
  private async generate(entry: RunningTarget, agent: QueueAgent): Promise<void> {
    /** 대상의 어댑터. */
    const { adapter } = entry.slot;
    /** 시작 표식. 대상이 더는 생성 중이 아니면 `null`. */
    const job = adapter.begin(entry.targetId);
    if (job === null) return;
    entry.job = job;
    entry.begun = true;

    /** 준비하기 전까지 받은 연결 변경 알림 수. */
    const connectionChangesBefore = entry.slot.connectionChanges;
    /** 준비의 결과. */
    const prepared = await adapter.prepare(entry.targetId, job, { stopped: () => entry.interruption !== null });
    if (entry.interruption) return this.afterInterruption(entry, []);
    switch (prepared.kind) {
      case 'skipped':
        return;
      // 대상이 아니라 어댑터 연결의 문제다. 실패로 두지 않고 연결이 바뀌었다는 알림이 올 때까지 이 어댑터만 멈춘다.
      // 준비하는 사이(`connectionChangesBefore` 뒤)에 알림이 왔으면 멈추지 않고 다시 본다.
      case 'adapter-paused':
        if (entry.slot.connectionChanges === connectionChangesBefore) this.pauseAdapter(entry.slot, 'connection');
        return this.requeueFromStart(entry, []);
      // 지금 프로바이더에 닿지 못했으면 다음 대상도 같으므로, 실패로 두지 않고 잠시 이 어댑터만 멈췄다가 다시 준비한다.
      case 'retry-later':
        this.pauseAdapter(entry.slot, 'retry', prepared.afterMs);
        return this.requeueFromStart(entry, []);
      case 'ready':
        return this.follow({ entry, runs: [] }, prepared.next, agent);
    }
  }

  /**
   * 준비나 실행 뒤에 어댑터가 정한 일을 한다. 실행이면 실행 단계를 돌려 그 결과로 다음 일을 받고, 저장·실패·저장소 대기면 어댑터에 기록한다.
   * 기록하는 순간 대상이 바뀌어 기록하지 못했으면 처음부터 다시 만든다.
   * @param confirmed 대기열에서 꺼낼 때 실행 직전 확인을 마친 에이전트. 이번 생성의 첫 실행은 다시 확인하지 않는다.
   */
  private async follow(generation: Generation, next: NextStep<TargetTypes>, confirmed: QueueAgent): Promise<void> {
    /** 실행하는 대상과 이번 생성의 실행 기록. */
    const { entry, runs } = generation;
    /** 대상의 어댑터. */
    const { adapter } = entry.slot;
    /** 지금 할 일. */
    let step = next;
    for (;;) {
      switch (step.kind) {
        case 'save':
          return this.restartUnlessFinished(entry, runs, await adapter.save(entry.targetId, entry.job, step.result, runs));
        case 'fail':
          return this.restartUnlessFinished(entry, runs, await adapter.fail(entry.targetId, entry.job, failureOf(entry, step.reason, null), runs));
        case 'repo-wait':
          return this.restartUnlessFinished(entry, runs, await adapter.needsRepoCheck(entry.targetId, entry.job, step.wait, runs));
        case 'run': {
          /** 실행 다음에 할 일. 앱이 실행을 멈췄거나 대상을 정리했으면 `null`. */
          const after = await this.runStep(generation, step.run, runs.length === 0 ? confirmed : null);
          if (!after) return;
          step = after;
        }
      }
    }
  }

  /**
   * 실행 하나를 돌리고 결과를 검증해 다음 일을 받는다. 실행 기록은 결과를 정해 이번 생성의 실행 기록에 넣는다.
   * 실행이 실패로 끝났거나 결과를 버렸으면 대상을 실패로 기록하고, 앱이 실행을 멈췄거나 대기열에 되돌렸으면 정리한다. 이때는 `null`이다.
   */
  private async runStep(generation: Generation, run: TargetRun<TargetTypes>, confirmed: QueueAgent | null): Promise<NextStep<TargetTypes> | null> {
    /** 실행하는 대상과 이번 생성의 실행 기록. */
    const { entry, runs } = generation;
    /** 실행 단계의 마지막 실행. */
    const ran = await this.runPhase(generation, confirmed, run);
    if (ran.kind === 'stopped') return null;
    /** 출력 검증까지 마친 결과. */
    const checked: CheckedRun =
      ran.verdict.kind === 'failed'
        ? { kind: 'failed', fixes: ran.record.fixes, verdict: ran.verdict }
        : await run.check(ran.verdict.output, ran.request).then((check) =>
            check.kind === 'passed' ? check : { kind: 'failed' as const, fixes: check.fixes, verdict: failedVerdict(check.reason, null) },
          );
    // 검증하는 사이에 [취소]나 대상이 바뀌어 멈췄을 수 있으므로 기록의 결과는 검증 뒤에 정한다.
    runs.push({
      ...ran.record,
      fixes: checked.fixes,
      result: runResultOf(entry.interruption, checked.kind === 'passed' ? { kind: 'output' } : checked.verdict),
    });
    if (entry.interruption) {
      await this.afterInterruption(entry, runs);
      return null;
    }
    if (checked.kind === 'passed') return checked.next;

    /** 실패를 기록했는지 여부. */
    const failed = await entry.slot.adapter.fail(entry.targetId, entry.job, failureOf(entry, checked.verdict.reason, checked.verdict.detail), runs);
    await this.restartUnlessFinished(entry, runs, failed);
    return null;
  }

  /**
   * 기록을 끝내지 못했으면(기록하는 순간 대상이 바뀌어 있었음) 처음부터 다시 만든다.
   * 마지막 실행은 끝났지만 그 결과를 쓰지 못했으므로 실행 기록에는 대상이 바뀌어 멈춘 것으로 남긴다.
   */
  private async restartUnlessFinished(entry: RunningTarget, runs: readonly RunRecord[], finished: boolean): Promise<void> {
    if (!finished) await this.requeueFromStart(entry, withLastResult(runs, 'bundle-changed'));
  }

  /**
   * 실행 단계 하나를 돌린다. 실행마다 직전에 에이전트를 확인하고, 일시적 실패는 종류가 달라도 한 번만 다시 실행한다.
   * 전역 실패가 의심되면 에이전트가 다시 하는 연결 확인을 기다려, 확인도 실패하면 대상을 실패로 두지 않고 대기열 맨 앞에 되돌린다.
   * 마지막 실행의 기록은 부르는 쪽이 결과를 정해 실행 기록에 넣는다. 앱이 실행을 멈췄거나 대기열에 되돌렸으면 `stopped`다.
   * @param confirmed 실행 직전 확인을 이미 마친 에이전트. 그 실행기로 하는 첫 실행은 다시 확인하지 않는다.
   */
  private async runPhase(generation: Generation, confirmed: QueueAgent | null, run: TargetRun<TargetTypes>): Promise<PhaseResult> {
    /** 실행하는 대상과 이번 생성의 실행 기록. */
    const { entry, runs } = generation;
    entry.runKind = run.kind;
    for (let attempt = 1; ; attempt += 1) {
      // 실행마다 그 단계의 첫 줄과 읽은 파일 0개로 시작한다. 앞 실행 뒤 다음 실행으로 넘어가면 실행 직전 확인을 기다리는 동안에도 다음 단계로 보인다.
      this.setProgress(entry, run.step, 0);
      /** 이번 실행에 쓸 에이전트. 쓸 수 없으면 `null`. */
      const current = await this.agentForRun(confirmed);
      if (entry.interruption) return stopAfter(this.afterInterruption(entry, runs));
      if (!current) return stopAfter(this.requeueFromStart(entry, runs));
      confirmed = null;
      /** 어댑터가 만든 요청. */
      const request = await run.request(current.model);
      /** 실행 한 번의 결과와 실행 기록. */
      const ran = await this.runOnce(entry, current, request, run);
      if (entry.interruption) return stopAfter(this.afterInterruption(entry, [...runs, ran.record]));
      /** 전역 실패가 의심됐지만 다시 한 연결 확인이 통과했는지 여부. 실행하는 사이 CLI가 바뀐 경우 등이라 일시적 실패처럼 다룬다. */
      let recovered = false;
      // 전역 실패가 의심되면 에이전트가 다시 하는 연결 확인을 기다린다. 확인도 실패하면 전역 실패라 대상을 실패로 두지 않고 대기열을 멈춘다.
      if (ran.verdict.kind === 'failed' && suspectsGlobalFailure(ran.verdict.reason)) {
        /** 연결 확인을 통과했는지 여부. */
        const healthy = await this.confirmAgent(current);
        if (entry.interruption) return stopAfter(this.afterInterruption(entry, [...runs, ran.record]));
        if (!healthy) {
          this.options.logger.warn('generation.global-failure', { kind: entry.kind, targetId: entry.targetId, runKind: run.kind, reason: ran.verdict.reason });
          return stopAfter(this.requeueFromStart(entry, [...runs, ran.record]));
        }
        recovered = true;
        confirmed = current;
      }
      // 일시적 실패는 한 번 더 실행한다. 다시 실행도 새 실행이라 실행 직전 확인을 다시 거친다.
      // 두 번째도 실패면 실패로 둔다. 연결 확인이 통과하는데도 같은 실패가 되풀이되며 대기열이 끝없이 돌지 않게 하려는 것이다.
      if (ran.verdict.kind === 'failed' && (ran.verdict.retry || recovered) && attempt < MAX_ATTEMPTS) {
        this.options.logger.info('generation.run-retrying', { kind: entry.kind, targetId: entry.targetId, runKind: run.kind, reason: ran.verdict.reason });
        runs.push(ran.record);
        continue;
      }
      return { kind: 'ran', ...ran, request };
    }
  }

  /** 에이전트를 한 번 실행하고 결과와 실행 기록을 돌려준다. 진행 단계는 실행기가 알리는 대로 바꾸고, 구조화 출력은 어댑터가 읽는다. */
  private async runOnce(
    entry: RunningTarget,
    agent: QueueAgent,
    request: TargetRunRequest,
    run: TargetRun<TargetTypes>,
  ): Promise<{ verdict: RunVerdict; record: RunRecord }> {
    /** 시작 시각. */
    const startedAt = this.options.clock.now();
    this.options.logger.info('generation.run-started', { kind: entry.kind, targetId: entry.targetId, runKind: run.kind, agent: agent.executor.agent });

    /** 실행기가 알려 준 것. 실행기가 예외를 던지면 `null`. */
    let report: ExecutorReport | null = null;
    try {
      report = await agent.executor.run({
        kind: run.kind,
        ...request,
        signal: entry.abort.signal,
        onProgress: ({ step, filesRead }) => this.setProgress(entry, step, filesRead),
      });
    } catch (error) {
      this.options.logger.error('generation.executor-crashed', { kind: entry.kind, targetId: entry.targetId, ...errorFields(error) });
    }

    /** 결과를 읽은 것. */
    const verdict: RunVerdict = report ? verdictOf(report.outcome, run) : failedVerdict('app-error', null);
    /** 실행 기록. 앱이 실행을 멈췄으면 그 까닭이 결과다. */
    const record: RunRecord = {
      kind: run.kind,
      agent: agent.executor.agent,
      cliVersion: report?.cliVersion ?? null,
      model: report?.model ?? agent.model,
      startedAt,
      finishedAt: this.options.clock.now(),
      result: runResultOf(entry.interruption, verdict),
      detail: verdict.kind === 'output' ? null : verdict.detail,
      lastStep: entry.step,
      fixes: [],
      omittedContextItems: run.omittedContextItems,
      usage: report?.usage ?? null,
    };
    this.options.logger.info('generation.run-finished', {
      kind: entry.kind,
      targetId: entry.targetId,
      runKind: run.kind,
      result: record.result,
      durationMs: record.finishedAt - record.startedAt,
      filesRead: entry.filesRead,
    });
    return { verdict, record };
  }

  /**
   * 앱이 멈춘 실행을 정리한다. [취소]면 "취소함" 실패, 대상이 바뀌었거나 비밀 파일 패턴을 추가했으면 처음부터 다시 만든다.
   * 앱을 끝내는 중이면 대상을 생성 중으로 둔 채 실행 기록만 더한다. 끊은 실행은 "앱 종료로 중단"으로 남는다.
   */
  private async afterInterruption(entry: RunningTarget, runs: RunRecord[]): Promise<void> {
    switch (entry.interruption) {
      case 'user':
        await entry.slot.adapter.fail(entry.targetId, null, failureOf(entry, 'cancelled', null), runs);
        return;
      case 'target-changed':
      case 'secret-patterns-changed':
        await this.requeueFromStart(entry, runs);
        return;
      case 'app-quit':
        await entry.slot.adapter.addRuns(entry.targetId, runs);
        return;
      case null:
        return;
    }
  }

  /**
   * 멈춘 생성을 처음부터 다시 하도록 정리한다. 실행 기록을 남기고, 대상이 생성 중으로 남았으면 대기열 맨 앞에 되돌린다.
   * 대상이 바뀌었을 때, 전역 실패로 대기열을 멈출 때, 어댑터를 멈출 때 쓴다.
   */
  private async requeueFromStart(entry: RunningTarget, runs: readonly RunRecord[]): Promise<void> {
    /** 대상의 어댑터. */
    const { adapter } = entry.slot;
    await adapter.addRuns(entry.targetId, runs);
    // 기록을 남기는 사이에 [취소]를 눌렀으면 다시 넣지 않고 "취소함" 실패로 둔다.
    if (entry.interruption === 'user') {
      await adapter.fail(entry.targetId, null, failureOf(entry, 'cancelled', null), []);
      return;
    }
    if (this.status === 'started' && adapter.isGenerating(entry.targetId, null)) this.enqueue(entry, 'resume');
  }

  /** 예상하지 못한 오류로 실행이 끝나면 대상을 실패로 두어 생성 중에 멈춰 있지 않게 한다. */
  private async failAfterCrash(entry: RunningTarget, error: unknown): Promise<void> {
    this.options.logger.error('generation.crashed', { kind: entry.kind, targetId: entry.targetId, ...errorFields(error) });
    if (this.status !== 'started') return;
    try {
      await entry.slot.adapter.fail(entry.targetId, null, failureOf(entry, 'app-error', null), []);
    } catch (saveError) {
      this.options.logger.error('generation.failure-save-failed', { kind: entry.kind, targetId: entry.targetId, ...errorFields(saveError) });
    }
  }

  /** 실행을 끊는다. 먼저 정한 까닭을 남긴다. */
  private interrupt(entry: RunningTarget, interruption: Interruption): void {
    entry.interruption ??= interruption;
    entry.abort.abort();
  }

  /** 실행 중인 대상의 진행 단계를 바꾸고 알린다. 이미 끝난 실행이면 아무것도 하지 않는다. */
  private setProgress(entry: RunningTarget, step: string, filesRead: number): void {
    if (this.running !== entry) return;
    entry.step = step;
    entry.filesRead = filesRead;
    this.emit();
  }

  /** 듣는 쪽에 진행이 바뀌었다고 알린다. 실행 중인 대상이나 기다리는 순서가 바뀌었으면 대기열을 남긴다. */
  private emit(): void {
    this.saveQueueIfChanged();
    for (const listener of this.listeners) listener();
  }
}

/** 두 대상이 같은지 본다. */
function sameTarget(a: TargetRef, b: TargetRef): boolean {
  return a.kind === b.kind && a.targetId === b.targetId;
}

/** 대상을 한 문자열로 나타낸 키. */
function targetKey(target: TargetRef): string {
  return `${target.kind}:${target.targetId}`;
}

/** 실행기의 결과를 읽는다. 구조화 출력은 어댑터가 읽는다. 일시적 실패만 다시 실행한다. */
function verdictOf(outcome: ExecutorOutcome, run: TargetRun<TargetTypes>): RunVerdict {
  switch (outcome.type) {
    case 'completed': {
      /** 어댑터가 읽은 출력. */
      const reading = run.read(outcome.output);
      return reading.kind === 'output' ? reading : failedVerdict(reading.reason, reading.detail);
    }
    case 'invalid-output':
      return failedVerdict('invalid-output', outcome.detail);
    case 'timed-out':
      return failedVerdict('timed-out', null);
    case 'cancelled':
      return failedVerdict('cancelled', null);
    case 'failed':
      return failedVerdict(outcome.reason, outcome.detail);
  }
}

/** 실행하던 대상의 실패. 마지막 진행 단계와 마지막으로 시작한 실행 단계의 종류를 함께 남긴다. */
function failureOf<Reason extends string>(entry: RunningTarget, reason: Reason | RunFailureReason, detail: string | null): TargetFailure<Reason> {
  return { reason, detail, lastStep: entry.step, runKind: entry.runKind };
}

/** 실패한 실행의 결과를 만든다. 일시적 실패면 한 번 더 실행할 실패로 둔다. */
function failedVerdict(reason: RunFailureReason, detail: string | null): FailedVerdict {
  return { kind: 'failed', reason, detail, retry: TRANSIENT_FAILURES.includes(reason) };
}

/** 실행 기록의 결과. 앱이 실행을 멈췄으면 그 까닭(취소함, 대상이 바뀜, 비밀 파일 패턴 추가, 앱 종료로 중단)이고, 아니면 실행의 결과다. */
function runResultOf(interruption: Interruption | null, verdict: { kind: 'output' } | FailedVerdict): RunResult {
  switch (interruption) {
    case 'user':
      return 'cancelled';
    case 'target-changed':
      return 'bundle-changed';
    case 'secret-patterns-changed':
    case 'app-quit':
      return interruption;
    case null:
      return verdict.kind === 'output' ? 'succeeded' : verdict.reason;
  }
}

/** 마지막 실행 기록의 결과만 바꾼 실행 기록. 실행이 끝난 뒤 기록하기 전에 대상이 바뀐 실행을 남길 때 쓴다. */
function withLastResult(runs: readonly RunRecord[], result: RunResult): RunRecord[] {
  return runs.map((run, index) => (index === runs.length - 1 ? { ...run, result } : run));
}

/** 정리할 일을 마친 뒤 실행 단계가 멈췄다고 돌려준다. */
async function stopAfter(cleanup: Promise<void>): Promise<{ kind: 'stopped' }> {
  await cleanup;
  return { kind: 'stopped' };
}
