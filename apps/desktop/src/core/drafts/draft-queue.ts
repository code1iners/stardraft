import type { AgentPreferencesState } from '../agent/agent-preferences';
import { suspectsGlobalFailure } from '../agent/run-failures';
import { withDefaultSecretPatterns } from '../agent/secret-patterns';
import { FETCHING_CONTEXT_STEP, WRITING_DRAFT_STEP } from '../agent/progress-steps';
import { activeMentions, mentionSetKey } from '../bundles/mention-bundle';
import type { MentionBundles, RunPreparation } from '../bundles/mention-bundles';
import { contextDocument, omittedItemCount } from '../flow/bundle-context';
import { errorFields, type Logger } from '../logging/logger';
import type { CancelScheduled, Clock } from '../ports/clock';
import type { Executor, ExecutorOutcome, ExecutorReport, ExecutorRunRequest } from '../ports/executor';
import type { SettingsStore } from '../ports/settings-store';
import {
  draftOutputSchema,
  readDraftOutput,
  sentenceCount,
  type DraftOutput,
  type RunFailureReason,
  type RunRecord,
  type RunResult,
} from './draft';
import { checkDraftOutput, type CheckedDraftOutput } from './draft-check';
import { draftInputDocument, draftInstructions } from './draft-input';

/** 초안 실행의 제한 시간(밀리초). 넘기면 프로세스 트리를 끝내고 "시간 초과"로 실패한다. 설정에서 바꿀 수 없다. */
export const DRAFT_TIMEOUT_MS = 10 * 60 * 1000;
/** 생성 한 번에 실행하는 최대 횟수. 처음 실행과 일시적 실패의 자동 재시도 1회다. */
const MAX_ATTEMPTS = 2;
/**
 * 일시적 실패. 자동으로 다시 실행하는 실패는 이것뿐이다. 구조 실패(구조화 출력 없음), 모델 과부하, 네트워크 오류다.
 * 시간 초과, 취소, 형식 위반(빈 초안, 비밀 파일을 근거로 듦)은 다시 실행해도 같을 가능성이 커 다시 실행하지 않는다.
 */
const TRANSIENT_FAILURES: readonly RunFailureReason[] = ['invalid-output', 'overloaded', 'network'];
/** Flow에 닿지 못해(네트워크 오류) 멈춘 대기열이 다시 조회하기까지 기다리는 시간(밀리초). 폴링이 다음 주기에 다시 조회하는 것과 같다. */
const FLOW_RETRY_DELAY_MS = 60_000;
/** 요청 한도에 걸려 멈춘 대기열이 기다리는 가장 짧은 시간(밀리초). Flow가 알려 준 시간이 이보다 짧아도 이만큼은 기다린다. */
const MIN_FLOW_RETRY_DELAY_MS = 1_000;

/** 초안 대기열이 실행에 쓰는 에이전트 연결 하나. 연결 확인이 만든 실행기와 실행 직전 확인을 준다. */
export interface RunnableAgent {
  /** 이 에이전트의 실행기. */
  readonly executor: Executor;
  /**
   * 실행 직전에 이 에이전트로 실행해도 되는지 확인한다. 진행 중인 연결 확인이 있으면 끝나기를 기다리고,
   * CLI 버전이 바뀌었으면 작동 확인을 먼저 돌린다. 실행해도 되면 참이다.
   */
  confirmForRun(): Promise<boolean>;
}

/** 초안 실행에 쓸 에이전트. 기본 에이전트의 연결과 그 에이전트에 고른 모델이다. 실행 직전 확인이 거짓이면 실행하지 않고 대기열을 멈춘다. */
export interface DraftAgent extends RunnableAgent {
  /** 고른 모델. 기본 모델(에이전트가 정함)이면 `null`. */
  model: string | null;
}

/**
 * 초안 실행에 쓸 에이전트를 고른다. 기본 에이전트의 연결이 만든 실행기와 실행 직전 확인, 그 에이전트에 고른 모델이다.
 * 연결된 에이전트가 없거나(기본 에이전트가 없음) 기본 에이전트의 연결이 없으면 `null`이고, 초안 대기열은 기다린다.
 */
export function draftAgentFrom(preferences: AgentPreferencesState, agents: readonly RunnableAgent[]): DraftAgent | null {
  /** 기본 에이전트. */
  const agent = preferences.defaultAgent;
  /** 기본 에이전트의 연결. */
  const connection = agent === null ? undefined : agents.find((candidate) => candidate.executor.agent === agent);
  if (agent === null || !connection) return null;
  return { executor: connection.executor, model: preferences.models[agent]?.selected ?? null, confirmForRun: () => connection.confirmForRun() };
}

/** 생성 중 묶음의 진행. 작은 창과 펼친 창에 진행 단계 한 줄과 읽은 파일 수로 보인다. */
export type DraftProgress =
  /** 대기열에서 차례를 기다린다. 에이전트 연결을 기다리는 것과 전역 실패로 멈춘 대기열에서 기다리는 것도 여기에 든다. */
  | { status: 'waiting' }
  /** 실행하고 있다. */
  | { status: 'running'; step: string; filesRead: number };

/** 초안 대기열에 필요한 것. */
export interface DraftQueueOptions {
  /** 생성 중 묶음을 찾고 실행 결과를 맡길 멘션 묶음. 실행 직전의 저장소 매핑 확인도 맡는다. */
  bundles: MentionBundles;
  /** 지금 실행에 쓸 에이전트. 에이전트 연결이 없으면 `null`이고, 대기열은 연결될 때까지 기다린다. */
  agent: () => DraftAgent | null;
  /** 에이전트 연결이나 기본 에이전트·모델이 바뀔 때마다 `listener`를 부르게 한다. 돌려준 함수를 부르면 그만 부른다. */
  onAgentChange: (listener: () => void) => () => void;
  /** Flow에 쓸 키가 있는지 본다. 키가 없거나 "키 확인 필요"면 거짓이고, 대기열은 키를 쓸 수 있게 될 때까지 멈춘다. */
  flowKeyUsable: () => boolean;
  /** Flow 키를 쓸 수 있는지가 바뀔 수 있을 때마다(계정, "키 확인 필요") `listener`를 부르게 한다. 돌려준 함수를 부르면 그만 부른다. */
  onFlowKeyChange: (listener: () => void) => () => void;
  /** 추가 지침과 추가 비밀 파일 패턴을 읽는 설정 저장소. 실행마다 새로 읽어 다음 실행부터 바뀐 값을 쓴다. */
  settingsStore: SettingsStore;
  /** 답변 명의자인 내 이름. 모르면 `null`. */
  myName: () => string | null;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: (projectId: string) => Promise<string | null>;
  /** 실행 시작·종료 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. ID와 개수만 남기고 Flow 글과 초안은 남기지 않는다. */
  logger: Logger;
}

/** 앱이 실행을 멈춘 까닭. `user`는 [취소], `bundle-changed`는 묶음이 바뀜, `app-quit`은 앱 종료다. */
type Interruption = 'user' | 'bundle-changed' | 'app-quit';

/** 대기열에서 묶음이 들어가는 자리. 앞 자리일수록 먼저 실행하고, 같은 자리끼리는 들어온 순서대로 실행한다. */
type QueuePriority =
  /** 바로 이어서 돌아야 하는 묶음. 끊긴 생성을 처음부터 다시 하는 묶음(실행 중에 새 멘션이 합쳐짐, 전역 실패나 Flow에 닿지 못해 멈춤)이다. 맨 앞이다. */
  | 'resume'
  /** 사용자가 누른 행동(다시 시도, 되돌리기)으로 생성 중이 된 묶음. 감지한 묶음보다 앞이다. */
  | 'user'
  /** 감지했거나 앱을 켤 때 이미 생성 중이던 묶음. 끝에 들어간다. */
  | 'auto';

/** 자리의 순서. 작을수록 앞이다. */
const PRIORITY_ORDER: Readonly<Record<QueuePriority, number>> = { resume: 0, user: 1, auto: 2 };

/** 차례를 기다리는 묶음. */
interface QueuedDraft {
  /** 묶음 ID. */
  bundleId: number;
  /** 들어간 자리. */
  priority: QueuePriority;
}

/**
 * 대기열을 멈추게 한 까닭. `agent`는 에이전트를 쓸 수 없음(전역 실패), `flow-key`는 Flow 키를 쓸 수 없음("키 확인 필요")이고,
 * 둘은 그 까닭이 바뀌었다는 알림이 오면 풀린다. `flow-unreachable`은 지금 Flow에 닿지 못함(네트워크 오류, 요청 한도)이고 시간이 지나면 풀린다.
 */
type PauseCause = 'agent' | 'flow-key' | 'flow-unreachable';

/** 그 까닭이 바뀌었다는 알림이 오면 풀리는 멈춤의 까닭. */
type NotifiedCause = Exclude<PauseCause, 'flow-unreachable'>;

/** 실행하고 있는 묶음. */
interface RunningDraft {
  /** 묶음 ID. */
  bundleId: number;
  /** 실행을 끊는 장치. 끊으면 실행기가 프로세스 트리를 끝낸다. */
  abort: AbortController;
  /** 앱이 실행을 멈춘 까닭. 멈추지 않았으면 `null`. */
  interruption: Interruption | null;
  /** 실행을 시작할 때 묶음에 든 멘션 위치(`mentionSetKey`). 실행 중에 바뀌면(새 멘션이 합쳐짐) 처음부터 다시 만든다. 시작하기 전이면 `null`. */
  mentionSet: string | null;
  /** 마지막 진행 단계. */
  step: string;
  /** 지금 실행에서 읽은 파일 수. */
  filesRead: number;
}

/** 실패한 실행의 결과. `retry`는 일시적 실패라 한 번 더 실행할 실패인지 여부다. */
type FailedVerdict = { kind: 'failed'; reason: RunFailureReason; detail: string | null; retry: boolean };

/** 에이전트 실행 한 번의 결과를 읽은 것. 초안은 에이전트가 낸 그대로다. */
type RunVerdict = { kind: 'draft'; output: DraftOutput } | FailedVerdict;

/** 출력 검증까지 마친 결과. 초안은 내용 불일치를 고치고 근거 위치를 확인한 것이다. */
type CheckedVerdict = { kind: 'draft'; output: CheckedDraftOutput } | FailedVerdict;

/**
 * 초안 대기열. 생성 중 묶음을 하나씩 꺼내 초안 실행을 돌리는 직렬 대기열이다(한 번에 하나만 실행한다).
 * 끊긴 생성과 사용자 행동은 감지한 묶음보다 앞에 넣는다. 실행마다 직전에 에이전트를 확인하고,
 * 실행 직전에 저장소 매핑과 "이미 답함"을 다시 확인하고, 맥락을 새로 조회해 입력 문서를 만든다.
 * 일시적 실패는 한 번 다시 실행하고, 전역 실패는 묶음을 실패로 두지 않고 대기열을 멈췄다가 원인이 풀리면 다시 돈다.
 * Flow에 닿지 못하면(네트워크 오류, 요청 한도) 묶음을 실패로 두지 않고 잠시 멈췄다가 다시 조회한다.
 * 결과는 멘션 묶음에 맡겨 준비됨이나 실패로 옮기고, 실행마다 실행 기록을 남긴다. 실행 중인 묶음의 진행 단계는 메모리에만 둔다.
 */
export class DraftQueue {
  /** 차례를 기다리는 생성 중 묶음. 자리 순서대로 서 있고 앞에서부터 꺼낸다. */
  private waiting: QueuedDraft[] = [];
  /** 사용자 행동으로 곧 생성 중이 될 묶음에 잡아 둔 자리. 묶음이 바뀌는 즉시 대기열을 맞추므로, 묶음을 바꾸기 전에 적어 둔다. */
  private readonly reservedPriorities = new Map<number, QueuePriority>();
  /** 다음 실행을 시작하는 중(실행 직전 확인)이거나 실행하고 있는지 여부. 한 번에 하나만 실행하게 한다. */
  private busy = false;
  /** 실행하고 있는 묶음. 없으면 `null`. */
  private running: RunningDraft | null = null;
  /** 대기열을 멈추게 한 까닭. 그 까닭이 바뀌었다는 알림이 오거나 기다릴 시간이 지나면 푼다. */
  private readonly paused = new Set<PauseCause>();
  /** 까닭마다 바뀌었다는 알림을 받은 횟수. 확인하는 사이에 알림이 왔는지 보려고 센다. */
  private readonly changeCounts: Record<NotifiedCause, number> = { agent: 0, 'flow-key': 0 };
  /** Flow에 닿지 못해 멈춘 대기열을 다시 보는 예약을 지우는 함수. 예약이 없으면 `null`. */
  private cancelFlowRetry: CancelScheduled | null = null;
  /** 대기열 상태. `stopped`면 새 실행을 시작하지 않는다. */
  private status: 'idle' | 'started' | 'stopped' = 'idle';
  /** 묶음, 에이전트 연결, Flow 키 구독을 끊는 함수. */
  private readonly unsubscribes: (() => void)[] = [];
  /** 진행이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: DraftQueueOptions) {}

  /**
   * 대기열을 시작한다. 이미 생성 중인 묶음을 작은 창 대기열 순서로 넣고, 묶음과 에이전트 연결, Flow 키가 바뀔 때마다 다시 본다.
   * 감지해서 새로 생성 중이 된 묶음은 대기열 끝에, 사용자 행동으로 생성 중이 된 묶음은 감지한 묶음보다 앞에 들어간다.
   */
  start(): void {
    if (this.status !== 'idle') return;
    this.status = 'started';
    this.unsubscribes.push(
      this.options.bundles.onChange(() => this.sync()),
      this.options.onAgentChange(() => this.conditionChanged('agent')),
      this.options.onFlowKeyChange(() => this.conditionChanged('flow-key')),
    );
    this.sync();
  }

  /** 대기열을 멈춘다. 앱을 끝낼 때 부른다. 실행 중인 실행은 끊어 프로세스 트리를 끝내고, 묶음은 생성 중으로 둔다. */
  stop(): void {
    if (this.status === 'stopped') return;
    this.status = 'stopped';
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.cancelFlowRetry?.();
    this.cancelFlowRetry = null;
    if (this.running) this.interrupt(this.running, 'app-quit');
  }

  /** 생성 중 묶음의 진행. 대기열에 없으면 `null`. */
  progress(bundleId: number): DraftProgress | null {
    if (this.running?.bundleId === bundleId) return { status: 'running', step: this.running.step, filesRead: this.running.filesRead };
    return this.isWaiting(bundleId) ? { status: 'waiting' } : null;
  }

  /** 진행(대기열, 진행 단계, 읽은 파일 수)이 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 생성 중 묶음을 취소한다. 실행 중이면 실행을 끊어 프로세스 트리를 끝내고, 기다리는 중이면 바로 "취소함" 실패로 둔다.
   * 실행을 끊은 묶음은 실행이 멈춘 뒤 마지막 단계와 함께 "취소함" 실패가 된다.
   * 대기열을 시작하기 전(저장된 키를 읽기 전)의 생성 중 묶음도 기다리는 묶음처럼 취소한다. 생성 중이 아닌 묶음은 그대로 둔다.
   */
  async cancel(bundleId: number): Promise<void> {
    if (this.running?.bundleId === bundleId) {
      this.interrupt(this.running, 'user');
      return;
    }
    await this.options.bundles.markFailed(bundleId, { reason: 'cancelled', detail: null, lastStep: null }, [], null);
  }

  /** 실패 묶음을 [다시 시도]한다. 사용자 행동이라 생성 중으로 돌아가면 감지해서 기다리는 묶음보다 앞에 들어간다. */
  async retry(bundleId: number): Promise<void> {
    await this.changeByUser(bundleId, () => this.options.bundles.retry(bundleId));
  }

  /** 처리됨 묶음을 되돌린다. 초안이 없어 새로 만들게 되면 사용자 행동이라 감지해서 기다리는 묶음보다 앞에 들어간다. */
  async restore(bundleId: number): Promise<void> {
    await this.changeByUser(bundleId, () => this.options.bundles.restore(bundleId));
  }

  /** 사용자 행동으로 묶음을 바꾼다. 바꾸는 사이에 묶음이 생성 중이 되면 사용자 행동 자리에 넣는다. */
  private async changeByUser(bundleId: number, change: () => Promise<void>): Promise<void> {
    this.reservedPriorities.set(bundleId, 'user');
    try {
      await change();
    } finally {
      this.reservedPriorities.delete(bundleId);
    }
  }

  /** 묶음 상태에 대기열을 맞추고, 실행 중인 묶음이 바뀌었으면 실행을 멈춘다. */
  private sync(): void {
    if (this.status !== 'started') return;
    /** 생성 중 묶음. 작은 창 대기열 순서다. */
    const generating = this.options.bundles.idsWithStatus('generating');
    /** 바꾸기 전의 대기열 순서. */
    const before = this.waitingOrder();
    // 생성 중이 아니게 된 묶음(취소함, 저장소 확인 필요 등)은 빼고, 새로 생성 중이 된 묶음은 그 까닭에 맞는 자리에 넣는다.
    this.waiting = this.waiting.filter((queued) => generating.includes(queued.bundleId));
    for (const bundleId of generating) {
      if (bundleId !== this.running?.bundleId) this.enqueue(bundleId, this.reservedPriorities.get(bundleId) ?? 'auto');
    }
    // 실행 중인 묶음에 새 멘션이 합쳐졌거나 묶음이 생성 중이 아니게 되었으면 실행을 멈춘다. 생성 중으로 남았으면 처음부터 다시 만든다.
    if (this.running && !this.isStillGenerating(this.running)) this.interrupt(this.running, 'bundle-changed');
    if (this.waitingOrder() !== before) this.emit();
    this.pump();
  }

  /** 묶음을 대기열의 `priority` 자리 맨 뒤에 넣는다. 이미 기다리고 있으면 그대로 둔다. */
  private enqueue(bundleId: number, priority: QueuePriority): void {
    if (this.isWaiting(bundleId)) return;
    /** 이 묶음 뒤에 설 첫 묶음의 위치. 없으면 맨 뒤다. */
    const index = this.waiting.findIndex((queued) => PRIORITY_ORDER[queued.priority] > PRIORITY_ORDER[priority]);
    this.waiting.splice(index === -1 ? this.waiting.length : index, 0, { bundleId, priority });
  }

  /** 묶음이 차례를 기다리는지 본다. */
  private isWaiting(bundleId: number): boolean {
    return this.waiting.some((queued) => queued.bundleId === bundleId);
  }

  /** 대기열 순서를 비교할 수 있게 묶음 ID를 이은 것. */
  private waitingOrder(): string {
    return this.waiting.map((queued) => queued.bundleId).join(',');
  }

  /** 실행 중인 묶음이 실행을 시작할 때 그대로 생성 중인지 본다. 멘션이 합쳐지면 멘션 위치가 달라진다. */
  private isStillGenerating(entry: RunningDraft): boolean {
    /** 지금 묶음. */
    const bundle = this.options.bundles.get(entry.bundleId);
    if (!bundle || bundle.status !== 'generating') return false;
    return entry.mentionSet === null || mentionSetKey(bundle) === entry.mentionSet;
  }

  /** 실행하고 있지 않고, 멈추지 않았고, Flow 키와 에이전트 연결이 있으면 대기열 맨 앞 묶음을 실행한다. */
  private pump(): void {
    if (!this.canStart()) return;
    /** 지금 실행에 쓸 에이전트. */
    const agent = this.options.agent();
    if (!agent) return;

    this.busy = true;
    void this.runNext(agent).finally(() => {
      this.busy = false;
      this.pump();
    });
  }

  /** 다음 묶음을 시작할 수 있는지 본다. 이미 실행 중이거나 기다리는 묶음이 없으면 거짓이다. */
  private canStart(): boolean {
    return !this.busy && this.waiting.length > 0 && this.isRunnable();
  }

  /** 대기열이 돌 수 있는지 본다. 멈췄거나(전역 실패, Flow에 닿지 못함) Flow 키를 쓸 수 없으면 거짓이다. */
  private isRunnable(): boolean {
    return this.status === 'started' && this.paused.size === 0 && this.options.flowKeyUsable();
  }

  /** 실행 직전 확인을 거쳐 대기열 맨 앞 묶음의 초안을 만든다. 확인하는 동안 묶음은 차례를 기다리는 것으로 보인다. */
  private async runNext(agent: DraftAgent): Promise<void> {
    if (!(await this.confirmAgent(agent))) return;
    // 확인하는 사이에 대기열이 바뀌었거나(취소, 사용자 행동) 멈출 까닭이 생겼을 수 있으므로 확인한 뒤에 다시 보고 꺼낸다.
    /** 다음에 실행할 묶음. */
    const next = this.isRunnable() ? this.waiting.shift() : undefined;
    if (!next) return;

    /** 실행하는 묶음. */
    const entry: RunningDraft = {
      bundleId: next.bundleId,
      abort: new AbortController(),
      interruption: null,
      mentionSet: null,
      step: FETCHING_CONTEXT_STEP,
      filesRead: 0,
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
  private async agentForRun(confirmed: DraftAgent | null): Promise<DraftAgent | null> {
    /** 지금의 기본 에이전트와 모델. */
    const agent = this.options.agent();
    if (!agent) return null;
    if (confirmed?.executor === agent.executor) return agent;
    return (await this.confirmAgent(agent)) ? agent : null;
  }

  /** 실행 직전에 에이전트를 확인한다. 쓸 수 없으면 에이전트 연결이 바뀌었다는 알림이 올 때까지 대기열을 멈춘다. */
  private async confirmAgent(agent: DraftAgent): Promise<boolean> {
    /** 확인을 시작할 때까지 받은 알림 수. */
    const changesBefore = this.changeCounts.agent;
    /** 실행해도 되는지 여부. 확인하다 예외가 나면 쓸 수 없는 것으로 본다. */
    const ready = await agent.confirmForRun().catch((error: unknown) => {
      this.options.logger.error('draft.agent-confirm-crashed', errorFields(error));
      return false;
    });
    if (!ready) this.pauseUntilChanged('agent', changesBefore);
    return ready;
  }

  /**
   * 그 까닭이 바뀌었다는 알림이 올 때까지 대기열을 멈춘다.
   * 확인하는 사이(`changesBefore` 뒤)에 알림이 왔으면 멈추지 않고 다시 본다. 그래야 그사이 풀린 것을 놓치지 않는다.
   */
  private pauseUntilChanged(cause: NotifiedCause, changesBefore: number): void {
    if (this.changeCounts[cause] === changesBefore) this.pause(cause);
  }

  /**
   * Flow에 닿지 못해 대기열을 멈추고, 기다릴 시간이 지나면 다시 본다. 요청 한도면 Flow가 알려 준 시간(`retryAfterMs`)을,
   * 모르면 폴링 주기만큼 기다린다. 이미 기다리고 있으면 새로 받은 시간으로 다시 잰다.
   */
  private pauseForFlowRetry(retryAfterMs: number | null): void {
    this.pause('flow-unreachable');
    this.cancelFlowRetry?.();
    this.cancelFlowRetry = this.options.clock.after(Math.max(retryAfterMs ?? FLOW_RETRY_DELAY_MS, MIN_FLOW_RETRY_DELAY_MS), () => {
      this.cancelFlowRetry = null;
      this.resume('flow-unreachable');
    });
  }

  /** 대기열을 멈춘다. 이미 멈췄으면 그대로 둔다. */
  private pause(cause: PauseCause): void {
    if (this.paused.has(cause)) return;
    this.paused.add(cause);
    this.options.logger.warn('draft.queue-paused', { cause });
  }

  /** 멈춘 까닭이 바뀌었다는 알림을 받는다. 그 까닭으로 멈췄으면 풀고 다시 본다. */
  private conditionChanged(cause: NotifiedCause): void {
    this.changeCounts[cause] += 1;
    this.resume(cause);
  }

  /** 그 까닭으로 멈췄으면 풀고, 다음 묶음을 실행할 수 있는지 다시 본다. */
  private resume(cause: PauseCause): void {
    if (this.paused.delete(cause)) this.options.logger.info('draft.queue-resumed', { cause });
    this.pump();
  }

  /**
   * 묶음 하나의 초안을 만든다. 저장소 매핑 확인 → 맥락 조회와 "이미 답함" 확인 → 초안 실행 순서다.
   * 일시적 실패는 종류가 달라도 한 번만 다시 실행하고, 그 밖의 실패는 다시 실행하지 않는다.
   * 전역 실패(에이전트를 쓸 수 없음, Flow 키를 쓸 수 없음)나 Flow에 닿지 못함이면 묶음을 실패로 두지 않고 대기열 맨 앞에 되돌려,
   * 대기열이 다시 돌 때 처음부터 만든다.
   */
  private async generate(entry: RunningDraft, agent: DraftAgent): Promise<void> {
    /** 실행할 묶음. */
    const bundle = this.options.bundles.get(entry.bundleId);
    if (!bundle || bundle.status !== 'generating') return;
    /** 실행을 시작할 때 묶음에 든 멘션 위치. */
    const mentionSet = mentionSetKey(bundle);
    entry.mentionSet = mentionSet;

    // 기다리는 사이에 저장소 매핑이 지워졌거나 폴더가 사라졌으면 멘션 묶음이 저장소 확인 필요로 올린다.
    /** 읽을 저장소. 저장소 확인 필요가 되었으면 `null`. */
    const repositories = await this.options.bundles.reposForRun(entry.bundleId);
    if (entry.interruption) return this.afterInterruption(entry, []);
    if (!repositories) return;

    // 맥락을 새로 조회하고, 그 사이 Flow에 내 답이 생겼으면 실행하지 않는다.
    /** 맥락을 조회하기 전까지 받은 Flow 키 변경 알림 수. */
    const flowKeyChangesBefore = this.changeCounts['flow-key'];
    /** 실행 직전 준비의 결과. */
    const prepared = await this.options.bundles.prepareRun(entry.bundleId);
    if (entry.interruption) return this.afterInterruption(entry, []);
    if (prepared.kind === 'skipped' || prepared.kind === 'answered') return;
    // 쓸 키가 없거나 Flow가 키를 거부했으면 묶음이 아니라 키의 문제다. 실패로 두지 않고 "키 확인 필요"가 풀릴 때까지 멈춘다.
    if (prepared.kind === 'key-unusable') {
      this.pauseUntilChanged('flow-key', flowKeyChangesBefore);
      return this.requeueFromStart(entry, []);
    }
    // 지금 Flow에 닿지 못했으면(네트워크 오류, 요청 한도) 다음 묶음도 같으므로, 실패로 두지 않고 잠시 멈췄다가 다시 조회한다.
    if (prepared.kind === 'flow-unreachable') {
      this.pauseForFlowRetry(prepared.retryAfterMs);
      return this.requeueFromStart(entry, []);
    }
    if (prepared.kind === 'unavailable') {
      /** 실패로 두었는지 여부. 그사이 새 멘션이 합쳐졌으면 처음부터 다시 만든다. */
      const failed = await this.options.bundles.markFailed(entry.bundleId, { reason: prepared.reason, detail: null, lastStep: entry.step }, [], mentionSet);
      if (!failed) await this.requeueFromStart(entry, []);
      return;
    }

    /** 입력 문서와 맥락에서 뺀 항목 수. 다시 실행해도 같은 입력을 넘긴다. */
    const { input, omitted } = await this.draftInput(prepared, repositories);
    /** 이번 생성에서 남긴 실행 기록. */
    const runs: RunRecord[] = [];
    /** 실행 직전 확인을 마친 에이전트. 대기열에서 꺼낼 때 확인했고, 다시 실행할 때는 새로 확인한다. */
    let confirmed: DraftAgent | null = agent;
    for (let attempt = 1; ; attempt += 1) {
      /** 이번 실행에 쓸 에이전트. 쓸 수 없으면 `null`. */
      const current = await this.agentForRun(confirmed);
      if (entry.interruption) return this.afterInterruption(entry, runs);
      if (!current) return this.requeueFromStart(entry, runs);
      confirmed = null;
      /** 실행기에 넘길 요청. 지침과 비밀 파일 패턴은 실행마다 설정에서 새로 읽는다. */
      const request = await this.runRequest(input, repositories, current);
      /** 실행 한 번의 결과와 실행 기록. */
      const ran = await this.runOnce(entry, current, request, omitted);
      if (entry.interruption) return this.afterInterruption(entry, [...runs, ran.record]);
      /** 전역 실패가 의심됐지만 다시 한 연결 확인이 통과했는지 여부. 실행하는 사이 CLI가 바뀐 경우 등이라 일시적 실패처럼 다룬다. */
      let recovered = false;
      // 전역 실패가 의심되면 에이전트가 다시 하는 연결 확인을 기다린다. 확인도 실패하면 전역 실패라 묶음을 실패로 두지 않고 대기열을 멈춘다.
      if (ran.verdict.kind === 'failed' && suspectsGlobalFailure(ran.verdict.reason)) {
        /** 연결 확인을 통과했는지 여부. */
        const healthy = await this.confirmAgent(current);
        if (entry.interruption) return this.afterInterruption(entry, [...runs, ran.record]);
        if (!healthy) {
          this.options.logger.warn('draft.global-failure', { bundleId: entry.bundleId, reason: ran.verdict.reason });
          return this.requeueFromStart(entry, [...runs, ran.record]);
        }
        recovered = true;
        confirmed = current;
      }
      // 일시적 실패는 한 번 더 실행한다. 다시 실행도 새 실행이라 실행 직전 확인을 다시 거친다.
      // 두 번째도 실패면 실패로 둔다. 연결 확인이 통과하는데도 같은 실패가 되풀이되며 대기열이 끝없이 돌지 않게 하려는 것이다.
      if (ran.verdict.kind === 'failed' && (ran.verdict.retry || recovered) && attempt < MAX_ATTEMPTS) {
        this.options.logger.info('draft.run-retrying', { bundleId: entry.bundleId, reason: ran.verdict.reason });
        runs.push(ran.record);
        continue;
      }
      /** 출력 검증까지 마친 결과와 실행 기록. */
      const { verdict, record } = await checkVerdict(ran, repositories, request.secretPatterns);
      // 검증하는 사이에 [취소]나 새 멘션으로 멈췄을 수 있으므로 기록의 결과는 검증 뒤에 정한다.
      runs.push({ ...record, result: runResultOf(entry.interruption, verdict) });
      if (entry.interruption) return this.afterInterruption(entry, runs);

      // 실행이 끝난 뒤 저장하기 전에도 새 멘션이 합쳐질 수 있으므로, 멘션 묶음이 저장하는 순간 멘션 위치를 다시 본다.
      /** 결과를 저장했는지 여부. */
      const finished =
        verdict.kind === 'draft'
          ? await this.options.bundles.saveDraft(
              entry.bundleId,
              { ...verdict.output, repositories: [...repositories], createdAt: this.options.clock.now() },
              runs,
              mentionSet,
            )
          : await this.options.bundles.markFailed(
              entry.bundleId,
              { reason: verdict.reason, detail: verdict.detail, lastStep: entry.step },
              runs,
              mentionSet,
            );
      if (!finished) await this.requeueFromStart(entry, [...runs.slice(0, -1), { ...record, result: 'bundle-changed' }]);
      return;
    }
  }

  /** 표준 입력으로 넘길 입력 문서와 맥락에서 길이 상한 때문에 뺀 항목 수를 만든다. 생성 한 번에 한 번 만든다. */
  private async draftInput(
    prepared: Extract<RunPreparation, { kind: 'prepared' }>,
    repositories: readonly string[],
  ): Promise<{ input: string; omitted: number }> {
    /** 길이 상한을 적용한 맥락 문서. */
    const document = contextDocument(prepared.context);
    /** 입력 문서. */
    const input = draftInputDocument({
      mentions: activeMentions(prepared.bundle),
      context: prepared.context,
      contextText: document.text,
      myName: this.options.myName(),
      projectTitle: await this.options.projectTitle(prepared.bundle.projectId).catch(() => null),
      repositories,
    });
    return { input, omitted: omittedItemCount(document.omissions) };
  }

  /**
   * 초안 실행 한 번의 요청을 만든다. 지침과 비밀 파일 패턴은 실행마다 설정에서 새로 읽고, 모델은 이 실행의 에이전트에 고른 것이다.
   * 그래서 설정을 바꾸면 실행 중인 실행은 그대로 끝나고 다음 실행부터 바뀐 값을 쓴다. 첫 저장소가 cwd가 된다.
   */
  private async runRequest(input: string, repositories: readonly string[], agent: DraftAgent): Promise<Omit<ExecutorRunRequest, 'signal' | 'onProgress'>> {
    /** 지금 설정. */
    const settings = await this.options.settingsStore.load();
    return {
      kind: 'draft',
      instructions: draftInstructions(settings.extraInstructions),
      input,
      outputSchema: draftOutputSchema(),
      readRoots: [...repositories],
      secretPatterns: [...settings.extraSecretPatterns],
      model: agent.model,
      timeoutMs: DRAFT_TIMEOUT_MS,
    };
  }

  /** 에이전트를 한 번 실행하고 결과와 실행 기록을 돌려준다. 진행 단계는 실행기가 알리는 대로 바꾼다. */
  private async runOnce(
    entry: RunningDraft,
    agent: DraftAgent,
    request: Omit<ExecutorRunRequest, 'signal' | 'onProgress'>,
    omitted: number,
  ): Promise<{ verdict: RunVerdict; record: RunRecord }> {
    this.setProgress(entry, WRITING_DRAFT_STEP, 0);
    /** 시작 시각. */
    const startedAt = this.options.clock.now();
    this.options.logger.info('draft.run-started', { bundleId: entry.bundleId, agent: agent.executor.agent });

    /** 실행기가 알려 준 것. 실행기가 예외를 던지면 `null`. */
    let report: ExecutorReport | null = null;
    try {
      report = await agent.executor.run({
        ...request,
        signal: entry.abort.signal,
        onProgress: ({ step, filesRead }) => this.setProgress(entry, step, filesRead),
      });
    } catch (error) {
      this.options.logger.error('draft.executor-crashed', { bundleId: entry.bundleId, ...errorFields(error) });
    }

    /** 결과를 읽은 것. */
    const verdict: RunVerdict = report ? readVerdict(report.outcome) : failedVerdict('app-error', null);
    /** 실행 기록. 앱이 실행을 멈췄으면 그 까닭이 결과다. */
    const record: RunRecord = {
      kind: 'draft',
      agent: agent.executor.agent,
      cliVersion: report?.cliVersion ?? null,
      model: report?.model ?? agent.model,
      startedAt,
      finishedAt: this.options.clock.now(),
      result: runResultOf(entry.interruption, verdict),
      detail: verdict.kind === 'draft' ? null : verdict.detail,
      lastStep: entry.step,
      fixes: [],
      omittedContextItems: omitted,
      usage: report?.usage ?? null,
    };
    this.options.logger.info('draft.run-finished', {
      bundleId: entry.bundleId,
      result: record.result,
      durationMs: record.finishedAt - record.startedAt,
      filesRead: entry.filesRead,
    });
    return { verdict, record };
  }

  /**
   * 앱이 멈춘 실행을 정리한다. [취소]면 "취소함" 실패, 묶음이 바뀌었으면 처음부터 다시 만든다.
   * 앱을 끝내는 중이면 상태 저장소를 건드리지 않는다.
   */
  private async afterInterruption(entry: RunningDraft, runs: RunRecord[]): Promise<void> {
    switch (entry.interruption) {
      case 'user':
        await this.options.bundles.markFailed(entry.bundleId, { reason: 'cancelled', detail: null, lastStep: entry.step }, runs, null);
        return;
      case 'bundle-changed':
        await this.requeueFromStart(entry, runs);
        return;
      case 'app-quit':
      case null:
        return;
    }
  }

  /**
   * 멈춘 생성을 처음부터 다시 하도록 정리한다. 실행 기록을 남기고, 묶음이 생성 중으로 남았으면 대기열 맨 앞에 되돌린다.
   * 묶음이 바뀌었을 때(새 멘션이 합쳐짐)와 전역 실패로 대기열을 멈출 때 쓴다.
   */
  private async requeueFromStart(entry: RunningDraft, runs: RunRecord[]): Promise<void> {
    await this.options.bundles.addRuns(entry.bundleId, runs);
    // 기록을 남기는 사이에 [취소]를 눌렀으면 다시 넣지 않고 "취소함" 실패로 둔다.
    if (entry.interruption === 'user') {
      await this.options.bundles.markFailed(entry.bundleId, { reason: 'cancelled', detail: null, lastStep: entry.step }, [], null);
      return;
    }
    if (this.status === 'started' && this.options.bundles.get(entry.bundleId)?.status === 'generating') this.enqueue(entry.bundleId, 'resume');
  }

  /** 예상하지 못한 오류로 실행이 끝나면 묶음을 실패로 두어 생성 중에 멈춰 있지 않게 한다. */
  private async failAfterCrash(entry: RunningDraft, error: unknown): Promise<void> {
    this.options.logger.error('draft.generation-crashed', { bundleId: entry.bundleId, ...errorFields(error) });
    if (this.status !== 'started') return;
    try {
      await this.options.bundles.markFailed(entry.bundleId, { reason: 'app-error', detail: null, lastStep: entry.step }, [], null);
    } catch (saveError) {
      this.options.logger.error('draft.failure-save-failed', { bundleId: entry.bundleId, ...errorFields(saveError) });
    }
  }

  /** 실행을 끊는다. 먼저 정한 까닭을 남긴다. */
  private interrupt(entry: RunningDraft, interruption: Interruption): void {
    entry.interruption ??= interruption;
    entry.abort.abort();
  }

  /** 실행 중인 묶음의 진행 단계를 바꾸고 알린다. 이미 끝난 실행이면 아무것도 하지 않는다. */
  private setProgress(entry: RunningDraft, step: string, filesRead: number): void {
    if (this.running !== entry) return;
    entry.step = step;
    entry.filesRead = filesRead;
    this.emit();
  }

  /** 듣는 쪽에 진행이 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 실행기의 결과를 읽는다. 구조화 출력은 초안 실행 스키마 모양인지와 문장이 있는지만 본다. 일시적 실패만 다시 실행한다. */
function readVerdict(outcome: ExecutorOutcome): RunVerdict {
  switch (outcome.type) {
    case 'completed': {
      /** 앱이 읽은 초안. 스키마 모양이 아니면 `null`. */
      const output = readDraftOutput(outcome.output);
      if (!output) return failedVerdict('invalid-output', '구조화 출력이 초안 실행 스키마 모양이 아닙니다.');
      if (sentenceCount(output) === 0) return failedVerdict('empty-draft', null);
      return { kind: 'draft', output };
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

/** 실패한 실행의 결과를 만든다. 일시적 실패면 한 번 더 실행할 실패로 둔다. */
function failedVerdict(reason: RunFailureReason, detail: string | null): FailedVerdict {
  return { kind: 'failed', reason, detail, retry: TRANSIENT_FAILURES.includes(reason) };
}

/**
 * 받은 초안에 출력 검증을 한다. 내용 불일치는 고친 초안으로 바꾸고 고친 내용을 실행 기록에 남긴다. 기록의 결과는 부르는 쪽이 정한다.
 * 근거가 비밀 파일이면 결과 전체를 버리고 "비밀 파일을 근거로 듦" 실패로 바꾼다. 다시 실행하지 않는다.
 * 초안이 아닌 결과는 그대로 돌려준다.
 */
async function checkVerdict(
  ran: { verdict: RunVerdict; record: RunRecord },
  repositories: readonly string[],
  extraSecretPatterns: readonly string[],
): Promise<{ verdict: CheckedVerdict; record: RunRecord }> {
  if (ran.verdict.kind !== 'draft') return { verdict: ran.verdict, record: ran.record };
  /** 출력 검증의 결과. 요구 고치기 재생성은 아직 없어 고친 요구가 없다. */
  const check = await checkDraftOutput(ran.verdict.output, {
    repositories,
    secretPatterns: withDefaultSecretPatterns(extraSecretPatterns),
    fixedRequirement: null,
  });
  if (check.kind === 'secret-evidence') {
    return { verdict: { kind: 'failed', reason: 'secret-evidence', detail: null, retry: false }, record: { ...ran.record, fixes: check.fixes } };
  }
  return { verdict: { kind: 'draft', output: check.output }, record: { ...ran.record, fixes: check.fixes } };
}

/** 실행 기록의 결과. 앱이 실행을 멈췄으면 그 까닭(묶음이 바뀜, 그 밖에는 취소함)이고, 아니면 실행의 결과다. */
function runResultOf(interruption: Interruption | null, verdict: RunVerdict | CheckedVerdict): RunResult {
  if (interruption) return interruption === 'bundle-changed' ? 'bundle-changed' : 'cancelled';
  return verdict.kind === 'draft' ? 'succeeded' : verdict.reason;
}
