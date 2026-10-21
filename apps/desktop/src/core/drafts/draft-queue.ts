import type { AgentPreferencesState } from '../agent/agent-preferences';
import { suspectsGlobalFailure } from '../agent/run-failures';
import { withDefaultSecretPatterns } from '../agent/secret-patterns';
import { CHOOSING_REPO_STEP, FETCHING_CONTEXT_STEP, WRITING_DRAFT_STEP } from '../agent/progress-steps';
import { activeMentions, mentionSetKey, type MentionBundle, type RepoCheck } from '../bundles/mention-bundle';
import type { MentionBundles, RegenerationRequest, RunPreparation } from '../bundles/mention-bundles';
import { contextDocument, omittedItemCount } from '../flow/bundle-context';
import { errorFields, type Logger } from '../logging/logger';
import { waitAtMost, type CancelScheduled, type Clock } from '../ports/clock';
import type { Executor, ExecutorOutcome, ExecutorReport, ExecutorRunRequest } from '../ports/executor';
import type { SettingsStore } from '../ports/settings-store';
import type { StateStore } from '../ports/state-store';
import { findSelectionScope } from '../repos/repo-candidates';
import {
  draftOutputSchema,
  readDraftOutput,
  sentenceCount,
  type AutoSelection,
  type DraftFailure,
  type DraftFailureReason,
  type DraftOutput,
  type GenerationRunKind,
  type QueuedDraft,
  type QueuePriority,
  type RunFailureReason,
  type RunRecord,
  type RunResult,
} from './draft';
import { checkDraftOutput, type CheckedDraftOutput } from './draft-check';
import { draftInputDocument, draftInstructions, type RegenerationInput, type RunDataSource } from './draft-input';
import { readSelectionOutput, SELECTION_INSTRUCTIONS, selectionInputDocument, selectionOutputSchema, type SelectionOutput } from './repo-selection';

/** 초안 실행의 제한 시간(밀리초). 넘기면 프로세스 트리를 끝내고 "시간 초과"로 실패한다. 설정에서 바꿀 수 없다. */
export const DRAFT_TIMEOUT_MS = 10 * 60 * 1000;
/** 선택 실행의 제한 시간(밀리초). 넘기면 프로세스 트리를 끝내고 "시간 초과"로 실패한다. 설정에서 바꿀 수 없다. */
export const SELECTION_TIMEOUT_MS = 5 * 60 * 1000;
/** 실행 단계(선택 실행, 초안 실행)마다 실행하는 최대 횟수. 처음 실행과 일시적 실패의 자동 재시도 1회다. */
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
/**
 * 앱을 끌 때 끊은 실행이 멈춰 "앱 종료로 중단" 기록을 남기기를 기다려 주는 가장 긴 시간(밀리초).
 * 실행기는 프로세스 트리를 끝낸 뒤 늦어도 몇 초 안에 돌아오지만, Flow 조회 중에 끊겼으면 조회가 끝날 때까지 기다리지 않는다.
 */
const QUIT_RECORD_WAIT_MS = 5_000;

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

/** 선택 실행과 초안 실행에 쓸 에이전트. 기본 에이전트의 연결과 그 에이전트에 고른 모델이다. 실행 직전 확인이 거짓이면 실행하지 않고 대기열을 멈춘다. */
export interface DraftAgent extends RunnableAgent {
  /** 고른 모델. 기본 모델(에이전트가 정함)이면 `null`. */
  model: string | null;
}

/**
 * 선택 실행과 초안 실행에 쓸 에이전트를 고른다. 기본 에이전트의 연결이 만든 실행기와 실행 직전 확인, 그 에이전트에 고른 모델이다.
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
  /** 대기열이 바뀔 때마다 남기고 다시 켤 때 읽는 상태 저장소. */
  stateStore: Pick<StateStore, 'getDraftQueue' | 'setDraftQueue'>;
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

/** 자리의 순서. 작을수록 앞이다. */
const PRIORITY_ORDER: Readonly<Record<QueuePriority, number>> = { resume: 0, user: 1, auto: 2 };

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
  /** 마지막으로 시작한 실행 단계의 종류. 실행 단계를 시작하기 전(맥락 조회 등)이면 `null`. 실패에 남긴다. */
  runKind: GenerationRunKind | null;
}

/** 초안 실행에 넘길 저장소와, 그 저장소를 자동 선택으로 정했으면 그 내력. */
interface SelectedRepos {
  /** 읽을 저장소(절대 경로). 첫 저장소가 cwd가 된다. */
  repositories: string[];
  /** 자동 선택의 내력. 저장소 매핑이나 사용자가 고른 구성으로 정했으면 `null`. */
  autoSelection: AutoSelection | null;
}

/** 실패한 실행의 결과. `retry`는 일시적 실패라 한 번 더 실행할 실패인지 여부다. */
type FailedVerdict = { kind: 'failed'; reason: RunFailureReason; detail: string | null; retry: boolean };

/** 에이전트 실행 한 번의 결과를 읽은 것. 출력은 앱이 읽은 모양이고, 초안이면 에이전트가 낸 그대로다. */
type RunVerdict<T> = { kind: 'output'; output: T } | FailedVerdict;

/** 출력 검증까지 마친 초안 실행의 결과. 초안은 내용 불일치를 고치고 근거 위치를 확인한 것이다. */
type CheckedVerdict = RunVerdict<CheckedDraftOutput>;

/** 실행기에 넘길 실행 하나의 요청. 중단 신호와 진행 알림은 대기열이 실행할 때 붙인다. */
type RunRequest = Omit<ExecutorRunRequest, 'signal' | 'onProgress'>;

/** 실행 단계가 만드는 요청. 실행의 종류는 실행 단계가 붙인다. */
type PhaseRequest = Omit<RunRequest, 'kind'>;

/** 실행 단계 하나. 선택 실행이나 초안 실행이고, 일시적 실패의 재시도와 전역 실패 확인을 함께 거친다. */
interface RunPhase<T> {
  /** 실행의 종류. */
  kind: GenerationRunKind;
  /** 실행을 시작할 때의 진행 단계. 도구를 부르기 전까지 보인다. */
  step: string;
  /** 이번 실행에 쓸 에이전트로 실행 요청을 만든다. 설정은 실행마다 새로 읽는다. */
  request: (agent: DraftAgent) => Promise<PhaseRequest>;
  /** 구조화 출력을 읽는다. 읽을 수 없으면 구조 실패다. */
  read: (output: unknown) => RunVerdict<T>;
}

/** 실행 단계의 끝. */
type PhaseResult<T> =
  /** 마지막 실행의 결과와 실행 기록, 그 실행의 요청. 기록은 아직 실행 기록에 넣지 않았다. */
  | { kind: 'ran'; verdict: RunVerdict<T>; record: RunRecord; request: RunRequest }
  /** 앱이 실행을 멈췄거나 전역 실패로 묶음을 대기열에 되돌려 이번 생성이 끝났다. */
  | { kind: 'stopped' };

/** 묶음 하나를 만드는 생성 한 번. 선택 실행과 초안 실행이 함께 쓴다. */
interface Generation {
  /** 실행하는 묶음. */
  entry: RunningDraft;
  /** 생성을 시작할 때 묶음에 든 멘션 위치. 결과를 저장하는 순간 다르면 새 멘션이 합쳐진 것이라 처음부터 다시 만든다. */
  mentionSet: string;
  /** 이번 생성에서 남긴 실행 기록. 실행한 순서다. */
  runs: RunRecord[];
  /** 입력 문서의 데이터 구획에 넣을 Flow 내용. 선택 실행과 초안 실행에 같은 것을 넘긴다. */
  data: RunDataSource;
  /** 맥락에서 길이 상한 때문에 뺀 항목 수. 실행 기록에 남긴다. */
  omitted: number;
}

/**
 * 초안 대기열. 생성 중 묶음을 하나씩 꺼내 초안 실행을 돌리는 직렬 대기열이다(한 번에 하나만 실행한다).
 * 저장소 매핑이 없는 묶음은 작업 폴더에서 자동 선택으로 저장소를 정하고, 선택 실행이 고르면 그 묶음의 초안 실행을 바로 잇는다.
 * 끊긴 생성과 사용자 행동은 감지한 묶음보다 앞에 넣는다. 실행마다 직전에 에이전트를 확인하고,
 * 실행 직전에 저장소 매핑과 "이미 답함"을 다시 확인하고, 맥락을 새로 조회해 입력 문서를 만든다.
 * 일시적 실패는 한 번 다시 실행하고, 전역 실패는 묶음을 실패로 두지 않고 대기열을 멈췄다가 원인이 풀리면 다시 돈다.
 * Flow에 닿지 못하면(네트워크 오류, 요청 한도) 묶음을 실패로 두지 않고 잠시 멈췄다가 다시 조회한다.
 * 결과는 멘션 묶음에 맡겨 준비됨, 실패, 저장소 확인 필요로 옮기고, 실행마다 실행 기록을 남긴다. 실행 중인 묶음의 진행 단계는 메모리에만 둔다.
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
  /** 대기열 상태. `starting`은 앱이 꺼지기 전에 남긴 대기열을 읽는 중이고, `stopped`면 새 실행을 시작하지 않는다. */
  private status: 'idle' | 'starting' | 'started' | 'stopped' = 'idle';
  /** 실행 직전 확인부터 생성이 끝날 때까지의 일. 앱을 끌 때 끊은 실행의 기록을 기다린다. 없으면 `null`. */
  private runTask: Promise<void> | null = null;
  /** 마지막으로 남긴 대기열의 JSON. 대기열이 바뀐 때만 다시 남긴다. */
  private savedQueueJson: string | null = null;
  /** 묶음, 에이전트 연결, Flow 키 구독을 끊는 함수. */
  private readonly unsubscribes: (() => void)[] = [];
  /** 진행이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: DraftQueueOptions) {}

  /**
   * 대기열을 시작한다. 앱이 꺼지기 전에 남긴 대기열이 있으면 그 순서와 자리 그대로 먼저 넣는다(끊긴 실행의 묶음이 맨 앞이다).
   * 남긴 대기열에 없는 생성 중 묶음은 작은 창 대기열 순서로 끝에 넣고, 그 뒤 묶음과 에이전트 연결, Flow 키가 바뀔 때마다 다시 본다.
   * 감지해서 새로 생성 중이 된 묶음은 대기열 끝에, 사용자 행동으로 생성 중이 된 묶음은 감지한 묶음보다 앞에 들어간다.
   * 대기열은 바뀔 때마다 남겨, 끌 때의 정리 없이 꺼져도(강제 종료, Windows 종료·로그아웃) 다시 켤 때 같은 순서로 돈다.
   */
  async start(): Promise<void> {
    if (this.status !== 'idle') return;
    this.status = 'starting';
    /** 앱이 꺼지기 전에 남긴 대기열. 읽지 못하면 없는 것으로 보고 작은 창 순서로 넣는다. */
    const saved = await this.options.stateStore.getDraftQueue().catch((error: unknown) => {
      this.options.logger.error('draft.saved-queue-read-failed', errorFields(error));
      return [];
    });
    // 읽는 사이에 앱을 끝냈으면 남긴 대기열을 쓰지 않았으므로 다음에 켤 때 쓰도록 그대로 둔다.
    if (this.status !== 'starting') return;
    this.status = 'started';
    // 더는 생성 중이 아닌 묶음은 바로 아래 `sync`가 뺀다.
    for (const { bundleId, priority } of saved) this.enqueue(bundleId, priority);
    this.unsubscribes.push(
      this.options.bundles.onChange(() => this.sync()),
      this.options.onAgentChange(() => this.conditionChanged('agent')),
      this.options.onFlowKeyChange(() => this.conditionChanged('flow-key')),
    );
    this.sync();
    this.saveQueueIfChanged();
  }

  /**
   * 대기열을 멈춘다. 앱을 끝낼 때 부른다. 실행 중인 실행은 끊어 프로세스 트리를 끝내고, 묶음은 생성 중으로 둔다.
   * 멈출 때의 대기열을 남겨 다시 켤 때 그 순서와 자리로 돌게 한다. 끊은 실행의 묶음은 맨 앞이다.
   * 끊은 실행이 "앱 종료로 중단" 기록을 남기기를 최대 5초 기다린다.
   */
  async stop(): Promise<void> {
    /** 멈추기 전 상태. */
    const before = this.status;
    if (before === 'stopped') return;
    this.status = 'stopped';
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    this.cancelFlowRetry?.();
    this.cancelFlowRetry = null;
    // 시작하기 전이면 앞서 남긴 대기열을 아직 쓰지 않았으므로 그대로 둔다.
    if (before !== 'started') return;

    // 멈춘 뒤에는 대기열을 다시 남기지 않으므로, 끊은 실행이 끝나 실행 중인 묶음이 비기 전에 지금 대기열을 남긴다.
    this.saveQueue(this.currentQueue());
    if (this.running) this.interrupt(this.running, 'app-quit');
    if (this.runTask) await waitAtMost(this.options.clock, this.runTask, QUIT_RECORD_WAIT_MS);
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
    await this.options.bundles.markFailed(bundleId, { reason: 'cancelled', detail: null, lastStep: null, runKind: null }, [], null);
  }

  /** 실패 묶음을 [다시 시도]한다. 사용자 행동이라 생성 중으로 돌아가면 감지해서 기다리는 묶음보다 앞에 들어간다. */
  async retry(bundleId: number): Promise<void> {
    await this.changeByUser(bundleId, () => this.options.bundles.retry(bundleId));
  }

  /**
   * 준비됨이나 저장소 확인 필요 묶음을 저장소 선택 창에서 고른 구성으로 다시 만든다. "다른 저장소로 다시 만들기"와 "저장소를 골라 만들기"다.
   * 매번 새 실행이고, 처음 입력에 읽을 저장소만 바꿔 넘긴다(직전 결과는 넘기지 않는다). 매핑이 없어도 선택 실행은 돌리지 않는다.
   * 사용자 행동이라 감지해서 기다리는 묶음보다 앞에 들어간다.
   */
  async regenerateWithRepos(bundleId: number, repos: readonly string[]): Promise<void> {
    await this.changeByUser(bundleId, () => this.options.bundles.regenerateWithRepos(bundleId, repos));
  }

  /**
   * 준비됨 묶음을 다시 만든다. 다시 만들기, 지시를 덧붙여 다시 만들기, 요구 고치기다.
   * 매번 새 실행이고 사용자 행동이라 감지해서 기다리는 묶음보다 앞에 들어간다. 자동 선택으로 저장소를 정한 묶음도 선택 실행은 다시 돌리지 않는다.
   */
  async regenerate(bundleId: number, request: RegenerationRequest): Promise<void> {
    await this.changeByUser(bundleId, () => this.options.bundles.regenerate(bundleId, request));
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
    /** 이번 실행. */
    const task = this.runNext(agent).finally(() => {
      if (this.runTask === task) this.runTask = null;
      this.busy = false;
      this.pump();
    });
    this.runTask = task;
  }

  /** 지금 대기열. 실행 중인 묶음이 맨 앞(바로 이어서 돌 자리)이고 기다리는 묶음이 그 뒤다. */
  private currentQueue(): QueuedDraft[] {
    return [...(this.running ? [{ bundleId: this.running.bundleId, priority: 'resume' as const }] : []), ...this.waiting];
  }

  /** 대기열이 돌고 있고 마지막으로 남긴 뒤에 바뀌었으면 남긴다. */
  private saveQueueIfChanged(): void {
    if (this.status !== 'started') return;
    /** 지금 대기열. */
    const queue = this.currentQueue();
    /** 지금 대기열의 JSON. */
    const json = JSON.stringify(queue);
    if (json === this.savedQueueJson) return;
    this.saveQueue(queue);
  }

  /** 대기열을 남긴다. 남기지 못하면 로그만 남기고, 다시 켤 때 작은 창 순서로 넣는다. */
  private saveQueue(queue: readonly QueuedDraft[]): void {
    this.savedQueueJson = JSON.stringify(queue);
    this.options.stateStore.setDraftQueue(queue).catch((error: unknown) => this.options.logger.error('draft.queue-save-failed', errorFields(error)));
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
   * 묶음 하나의 초안을 만든다. 읽을 저장소(고른 구성이나 저장소 매핑) 확인 → 맥락 조회와 "이미 답함" 확인 → (매핑이 없으면) 자동 선택 → 초안 실행 순서다.
   * 자동 선택의 선택 실행이 고르면 다른 묶음에 차례를 넘기지 않고 이 묶음의 초안 실행을 바로 잇는다.
   * 실행마다 일시적 실패는 종류가 달라도 한 번만 다시 실행하고, 그 밖의 실패는 다시 실행하지 않는다.
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

    // 기다리는 사이에 매핑된 폴더가 사라졌으면 멘션 묶음이 저장소 확인 필요로 올린다.
    /** 읽을 저장소(고른 구성이나 저장소 매핑)를 확인한 결과. 저장소 확인 필요가 되었으면 `null`. */
    const runRepos = await this.options.bundles.reposForRun(entry.bundleId);
    if (entry.interruption) return this.afterInterruption(entry, []);
    if (!runRepos) return;

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
      return this.restartUnlessFinished(entry, [], await this.options.bundles.markFailed(entry.bundleId, failureOf(entry, prepared.reason, null), [], mentionSet));
    }

    /** 이번 생성. 맥락 문서는 한 번 만들어 선택 실행과 초안 실행에 같은 것을 넘긴다. */
    const generation: Generation = { entry, mentionSet, runs: [], ...(await this.runData(prepared)) };
    /** 초안 실행에 넘길 저장소와 자동 선택의 내력. 고른 구성도 매핑도 없으면 자동 선택으로 정하고, 정하지 못했으면 `null`이다. */
    const selected: SelectedRepos | null =
      runRepos.kind === 'unmapped'
        ? await this.selectRepos(generation, agent)
        : { repositories: runRepos.repos, autoSelection: runRepos.kind === 'auto-selected' ? runRepos.autoSelection : null };
    if (!selected) return;
    /** 초안 실행에 넘길 저장소. 첫 저장소가 cwd가 된다. */
    const { repositories } = selected;
    /** 재생성 입력. 처음 입력만 넘기면 `null`. */
    const regeneration = regenerationInputOf(prepared.bundle);
    /** 입력 문서. 다시 실행해도 같은 입력을 넘긴다. */
    const input = draftInputDocument({ ...generation.data, repositories, regeneration });

    // 대기열에서 꺼낼 때 실행 직전 확인을 마쳤다. 선택 실행을 돌렸으면 초안 실행도 새 실행이라 다시 확인한다.
    /** 초안 실행 단계의 마지막 실행. */
    const ran = await this.runPhase(generation, generation.runs.length === 0 ? agent : null, {
      kind: 'draft',
      step: WRITING_DRAFT_STEP,
      request: (current) => this.draftRequest(input, repositories, current),
      read: readDraftVerdict,
    });
    if (ran.kind === 'stopped') return;
    /** 출력 검증까지 마친 결과와 실행 기록. */
    const { verdict, record } = await checkVerdict(ran, repositories, ran.request.secretPatterns, regeneration?.path === 'requirement' ? regeneration.requirement : null);
    // 검증하는 사이에 [취소]나 새 멘션으로 멈췄을 수 있으므로 기록의 결과는 검증 뒤에 정한다.
    generation.runs.push({ ...record, result: runResultOf(entry.interruption, verdict) });
    if (entry.interruption) return this.afterInterruption(entry, generation.runs);

    // 실행이 끝난 뒤 저장하기 전에도 새 멘션이 합쳐질 수 있으므로, 멘션 묶음이 저장하는 순간 멘션 위치를 다시 본다.
    /** 결과를 저장했는지 여부. */
    const finished =
      verdict.kind === 'output'
        ? await this.options.bundles.saveDraft(
            entry.bundleId,
            { ...verdict.output, repositories: [...repositories], autoSelection: selected.autoSelection, createdAt: this.options.clock.now() },
            generation.runs,
            mentionSet,
          )
        : await this.options.bundles.markFailed(entry.bundleId, failureOf(entry, verdict.reason, verdict.detail), generation.runs, mentionSet);
    await this.restartUnlessFinished(entry, generation.runs, finished);
  }

  /**
   * 저장소 매핑이 없는 묶음의 저장소를 자동 선택으로 정한다. 작업 폴더는 이때 설정에서 읽어, 바꾸면 다음 생성부터 쓴다.
   * 후보가 1개면 선택 실행 없이 그 저장소를 쓰고, 여럿이면 선택 실행이 고른다.
   * 후보가 0개이거나 선택 실행이 고르지 않았으면 묶음을 저장소 확인 필요로, 선택 실행이 실패했으면 실패로 옮기고 `null`을 돌려준다.
   * 앱이 실행을 멈췄거나 전역 실패로 대기열에 되돌렸을 때도 `null`이다.
   * @param agent 대기열에서 꺼낼 때 실행 직전 확인을 마친 에이전트. 선택 실행의 첫 실행은 다시 확인하지 않는다.
   */
  private async selectRepos(generation: Generation, agent: DraftAgent): Promise<SelectedRepos | null> {
    /** 실행하는 묶음과 이번 생성의 실행 기록. */
    const { entry, runs } = generation;
    /** 지금 설정. */
    const settings = await this.options.settingsStore.load();
    /** 자동 선택의 범위. */
    const scope = await findSelectionScope(settings.workFolders);
    if (entry.interruption) {
      await this.afterInterruption(entry, runs);
      return null;
    }
    if (scope.candidates.length === 0) {
      await this.finishWithRepoCheck(generation, { kind: 'no-candidates' });
      return null;
    }
    if (scope.candidates.length === 1) return { repositories: [scope.candidates[0]!.path], autoSelection: { kind: 'single-candidate' } };

    /** 후보의 절대 경로. 출력 스키마의 `enum`이다. */
    const candidates = scope.candidates.map((candidate) => candidate.path);
    /** 입력 문서. 다시 실행해도 같은 입력을 넘긴다. */
    const input = selectionInputDocument({ ...generation.data, candidates });
    /** 선택 실행 단계의 마지막 실행. */
    const ran = await this.runPhase(generation, agent, {
      kind: 'selection',
      step: CHOOSING_REPO_STEP,
      request: (current) => this.selectionRequest(input, scope.workFolders, candidates, current),
      read: (output) => readSelectionVerdict(output, candidates),
    });
    if (ran.kind === 'stopped') return null;
    if (ran.verdict.kind === 'failed') {
      runs.push({ ...ran.record, result: runResultOf(entry.interruption, ran.verdict) });
      /** 실패로 두었는지 여부. */
      const failed = await this.options.bundles.markFailed(entry.bundleId, failureOf(entry, ran.verdict.reason, ran.verdict.detail), runs, generation.mentionSet);
      await this.restartUnlessFinished(entry, runs, failed);
      return null;
    }

    /** 선택 실행의 판정. 내용 불일치는 고쳤다. */
    const selection = ran.verdict.output;
    runs.push({ ...ran.record, fixes: selection.fixes, result: 'succeeded' });
    if (selection.verdict !== 'chosen') {
      await this.finishWithRepoCheck(generation, { kind: selection.verdict, reason: selection.reason, candidates: scope.candidates, picked: selection.repositories });
      return null;
    }
    return { repositories: selection.repositories, autoSelection: { kind: 'chosen', reason: selection.reason } };
  }

  /** 묶음을 저장소 확인 필요로 옮긴다. 그사이 새 멘션이 합쳐져 옮기지 못했으면 처음부터 다시 만든다. */
  private async finishWithRepoCheck({ entry, runs, mentionSet }: Generation, repoCheck: RepoCheck): Promise<void> {
    await this.restartUnlessFinished(entry, runs, await this.options.bundles.markRepoCheckNeeded(entry.bundleId, repoCheck, runs, mentionSet));
  }

  /**
   * 생성을 끝내지 못했으면(결과를 저장하는 순간 새 멘션이 합쳐져 있었음) 처음부터 다시 만든다.
   * 마지막 실행은 끝났지만 그 결과를 쓰지 못했으므로 실행 기록에는 묶음이 바뀌어 멈춘 것으로 남긴다.
   */
  private async restartUnlessFinished(entry: RunningDraft, runs: readonly RunRecord[], finished: boolean): Promise<void> {
    if (!finished) await this.requeueFromStart(entry, withLastResult(runs, 'bundle-changed'));
  }

  /** 데이터 구획에 넣을 Flow 내용과 맥락에서 길이 상한 때문에 뺀 항목 수를 만든다. 생성 한 번에 한 번 만든다. */
  private async runData(prepared: Extract<RunPreparation, { kind: 'prepared' }>): Promise<Pick<Generation, 'data' | 'omitted'>> {
    /** 길이 상한을 적용한 맥락 문서. */
    const document = contextDocument(prepared.context);
    return {
      data: {
        mentions: activeMentions(prepared.bundle),
        context: prepared.context,
        contextText: document.text,
        myName: this.options.myName(),
        projectTitle: await this.options.projectTitle(prepared.bundle.projectId).catch(() => null),
      },
      omitted: omittedItemCount(document.omissions),
    };
  }

  /**
   * 선택 실행 한 번의 요청을 만든다. 작업 폴더 전부를 읽기 범위로 넘기고(첫 폴더가 cwd), 비밀 파일 패턴은 실행마다 설정에서 새로 읽는다.
   * 추가 지침은 초안 문체를 바꾸는 것이라 넘기지 않는다. 모델은 초안 실행과 같이 이 실행의 에이전트에 고른 것이다.
   */
  private async selectionRequest(input: string, workFolders: readonly string[], candidates: readonly string[], agent: DraftAgent): Promise<PhaseRequest> {
    /** 지금 설정. */
    const settings = await this.options.settingsStore.load();
    return {
      instructions: SELECTION_INSTRUCTIONS,
      input,
      outputSchema: selectionOutputSchema(candidates),
      readRoots: [...workFolders],
      secretPatterns: [...settings.extraSecretPatterns],
      model: agent.model,
      timeoutMs: SELECTION_TIMEOUT_MS,
    };
  }

  /**
   * 초안 실행 한 번의 요청을 만든다. 지침과 비밀 파일 패턴은 실행마다 설정에서 새로 읽고, 모델은 이 실행의 에이전트에 고른 것이다.
   * 그래서 설정을 바꾸면 실행 중인 실행은 그대로 끝나고 다음 실행부터 바뀐 값을 쓴다. 첫 저장소가 cwd가 된다.
   */
  private async draftRequest(input: string, repositories: readonly string[], agent: DraftAgent): Promise<PhaseRequest> {
    /** 지금 설정. */
    const settings = await this.options.settingsStore.load();
    return {
      instructions: draftInstructions(settings.extraInstructions),
      input,
      outputSchema: draftOutputSchema(),
      readRoots: [...repositories],
      secretPatterns: [...settings.extraSecretPatterns],
      model: agent.model,
      timeoutMs: DRAFT_TIMEOUT_MS,
    };
  }

  /**
   * 실행 단계 하나(선택 실행이나 초안 실행)를 돌린다. 실행마다 직전에 에이전트를 확인하고, 일시적 실패는 종류가 달라도 한 번만 다시 실행한다.
   * 전역 실패가 의심되면 에이전트가 다시 하는 연결 확인을 기다려, 확인도 실패하면 묶음을 실패로 두지 않고 대기열 맨 앞에 되돌린다.
   * 마지막 실행의 기록은 부르는 쪽이 결과를 정해 실행 기록에 넣는다. 앱이 실행을 멈췄거나 대기열에 되돌렸으면 `stopped`다.
   * @param confirmed 실행 직전 확인을 이미 마친 에이전트. 그 실행기로 하는 첫 실행은 다시 확인하지 않는다.
   */
  private async runPhase<T>(generation: Generation, confirmed: DraftAgent | null, phase: RunPhase<T>): Promise<PhaseResult<T>> {
    /** 실행하는 묶음과 이번 생성의 실행 기록. */
    const { entry, runs } = generation;
    entry.runKind = phase.kind;
    for (let attempt = 1; ; attempt += 1) {
      // 실행마다 그 단계의 첫 줄과 읽은 파일 0개로 시작한다. 선택 실행 뒤 초안 실행으로 넘어가면 실행 직전 확인을 기다리는 동안에도 "초안 쓰는 중"으로 보인다.
      this.setProgress(entry, phase.step, 0);
      /** 이번 실행에 쓸 에이전트. 쓸 수 없으면 `null`. */
      const current = await this.agentForRun(confirmed);
      if (entry.interruption) return stopAfter(this.afterInterruption(entry, runs));
      if (!current) return stopAfter(this.requeueFromStart(entry, runs));
      confirmed = null;
      /** 실행기에 넘길 요청. */
      const request: RunRequest = { kind: phase.kind, ...(await phase.request(current)) };
      /** 실행 한 번의 결과와 실행 기록. */
      const ran = await this.runOnce(entry, current, request, phase.read, generation.omitted);
      if (entry.interruption) return stopAfter(this.afterInterruption(entry, [...runs, ran.record]));
      /** 전역 실패가 의심됐지만 다시 한 연결 확인이 통과했는지 여부. 실행하는 사이 CLI가 바뀐 경우 등이라 일시적 실패처럼 다룬다. */
      let recovered = false;
      // 전역 실패가 의심되면 에이전트가 다시 하는 연결 확인을 기다린다. 확인도 실패하면 전역 실패라 묶음을 실패로 두지 않고 대기열을 멈춘다.
      if (ran.verdict.kind === 'failed' && suspectsGlobalFailure(ran.verdict.reason)) {
        /** 연결 확인을 통과했는지 여부. */
        const healthy = await this.confirmAgent(current);
        if (entry.interruption) return stopAfter(this.afterInterruption(entry, [...runs, ran.record]));
        if (!healthy) {
          this.options.logger.warn('draft.global-failure', { bundleId: entry.bundleId, kind: request.kind, reason: ran.verdict.reason });
          return stopAfter(this.requeueFromStart(entry, [...runs, ran.record]));
        }
        recovered = true;
        confirmed = current;
      }
      // 일시적 실패는 한 번 더 실행한다. 다시 실행도 새 실행이라 실행 직전 확인을 다시 거친다.
      // 두 번째도 실패면 실패로 둔다. 연결 확인이 통과하는데도 같은 실패가 되풀이되며 대기열이 끝없이 돌지 않게 하려는 것이다.
      if (ran.verdict.kind === 'failed' && (ran.verdict.retry || recovered) && attempt < MAX_ATTEMPTS) {
        this.options.logger.info('draft.run-retrying', { bundleId: entry.bundleId, kind: request.kind, reason: ran.verdict.reason });
        runs.push(ran.record);
        continue;
      }
      return { kind: 'ran', ...ran, request };
    }
  }

  /** 에이전트를 한 번 실행하고 결과와 실행 기록을 돌려준다. 진행 단계는 실행기가 알리는 대로 바꾸고, 구조화 출력은 `read`로 읽는다. */
  private async runOnce<T>(
    entry: RunningDraft,
    agent: DraftAgent,
    request: RunRequest,
    read: RunPhase<T>['read'],
    omitted: number,
  ): Promise<{ verdict: RunVerdict<T>; record: RunRecord }> {
    /** 시작 시각. */
    const startedAt = this.options.clock.now();
    this.options.logger.info('draft.run-started', { bundleId: entry.bundleId, kind: request.kind, agent: agent.executor.agent });

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
    const verdict: RunVerdict<T> = report ? verdictOf(report.outcome, read) : failedVerdict('app-error', null);
    /** 실행 기록. 앱이 실행을 멈췄으면 그 까닭이 결과다. */
    const record: RunRecord = {
      kind: request.kind,
      agent: agent.executor.agent,
      cliVersion: report?.cliVersion ?? null,
      model: report?.model ?? agent.model,
      startedAt,
      finishedAt: this.options.clock.now(),
      result: runResultOf(entry.interruption, verdict),
      detail: verdict.kind === 'output' ? null : verdict.detail,
      lastStep: entry.step,
      fixes: [],
      omittedContextItems: omitted,
      usage: report?.usage ?? null,
    };
    this.options.logger.info('draft.run-finished', {
      bundleId: entry.bundleId,
      kind: request.kind,
      result: record.result,
      durationMs: record.finishedAt - record.startedAt,
      filesRead: entry.filesRead,
    });
    return { verdict, record };
  }

  /**
   * 앱이 멈춘 실행을 정리한다. [취소]면 "취소함" 실패, 묶음이 바뀌었으면 처음부터 다시 만든다.
   * 앱을 끝내는 중이면 묶음을 생성 중으로 둔 채 실행 기록만 더한다. 끊은 실행은 "앱 종료로 중단"으로 남는다.
   */
  private async afterInterruption(entry: RunningDraft, runs: RunRecord[]): Promise<void> {
    switch (entry.interruption) {
      case 'user':
        await this.options.bundles.markFailed(entry.bundleId, failureOf(entry, 'cancelled', null), runs, null);
        return;
      case 'bundle-changed':
        await this.requeueFromStart(entry, runs);
        return;
      case 'app-quit':
        await this.options.bundles.addRuns(entry.bundleId, runs);
        return;
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
      await this.options.bundles.markFailed(entry.bundleId, failureOf(entry, 'cancelled', null), [], null);
      return;
    }
    if (this.status === 'started' && this.options.bundles.get(entry.bundleId)?.status === 'generating') this.enqueue(entry.bundleId, 'resume');
  }

  /** 예상하지 못한 오류로 실행이 끝나면 묶음을 실패로 두어 생성 중에 멈춰 있지 않게 한다. */
  private async failAfterCrash(entry: RunningDraft, error: unknown): Promise<void> {
    this.options.logger.error('draft.generation-crashed', { bundleId: entry.bundleId, ...errorFields(error) });
    if (this.status !== 'started') return;
    try {
      await this.options.bundles.markFailed(entry.bundleId, failureOf(entry, 'app-error', null), [], null);
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

  /** 듣는 쪽에 진행이 바뀌었다고 알린다. 실행 중인 묶음이나 기다리는 순서가 바뀌었으면 대기열을 남긴다. */
  private emit(): void {
    this.saveQueueIfChanged();
    for (const listener of this.listeners) listener();
  }
}

/** 실행기의 결과를 읽는다. 구조화 출력은 `read`로 읽는다. 일시적 실패만 다시 실행한다. */
function verdictOf<T>(outcome: ExecutorOutcome, read: (output: unknown) => RunVerdict<T>): RunVerdict<T> {
  switch (outcome.type) {
    case 'completed':
      return read(outcome.output);
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

/** 초안 실행의 구조화 출력을 읽는다. 초안 실행 스키마 모양인지와 문장이 있는지만 본다. */
function readDraftVerdict(output: unknown): RunVerdict<DraftOutput> {
  /** 앱이 읽은 초안. 스키마 모양이 아니면 `null`. */
  const draft = readDraftOutput(output);
  if (!draft) return failedVerdict('invalid-output', '구조화 출력이 초안 실행 스키마 모양이 아닙니다.');
  if (sentenceCount(draft) === 0) return failedVerdict('empty-draft', null);
  return { kind: 'output', output: draft };
}

/** 선택 실행의 구조화 출력을 읽는다. 판정과 후보 안의 저장소, 이유가 있는지 보고 내용 불일치를 고친다. */
function readSelectionVerdict(output: unknown, candidates: readonly string[]): RunVerdict<SelectionOutput> {
  /** 앱이 읽은 판정. 스키마 모양이 아니면 `null`. */
  const selection = readSelectionOutput(output, candidates);
  if (!selection) return failedVerdict('invalid-output', '구조화 출력이 선택 실행 스키마 모양이 아닙니다.');
  return { kind: 'output', output: selection };
}

/** 실행하던 묶음의 실패. 마지막 진행 단계와 마지막으로 시작한 실행 단계의 종류를 함께 남긴다. */
function failureOf(entry: RunningDraft, reason: DraftFailureReason, detail: string | null): DraftFailure {
  return { reason, detail, lastStep: entry.step, runKind: entry.runKind };
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
  ran: { verdict: RunVerdict<DraftOutput>; record: RunRecord },
  repositories: readonly string[],
  extraSecretPatterns: readonly string[],
  fixedRequirement: string | null,
): Promise<{ verdict: CheckedVerdict; record: RunRecord }> {
  if (ran.verdict.kind !== 'output') return { verdict: ran.verdict, record: ran.record };
  /** 출력 검증의 결과. 요구를 고쳐 다시 만들었으면 에이전트가 낸 요구를 고친 요구로 덮어쓴다. */
  const check = await checkDraftOutput(ran.verdict.output, {
    repositories,
    secretPatterns: withDefaultSecretPatterns(extraSecretPatterns),
    fixedRequirement,
  });
  if (check.kind === 'secret-evidence') {
    return { verdict: { kind: 'failed', reason: 'secret-evidence', detail: null, retry: false }, record: { ...ran.record, fixes: check.fixes } };
  }
  return { verdict: { kind: 'output', output: check.output }, record: { ...ran.record, fixes: check.fixes } };
}

/**
 * 묶음의 재생성에서 초안 실행에 더해 넘길 재생성 입력을 만든다. 지시를 덧붙였으면 직전 결과와 지금까지 덧붙인 지시 전부,
 * 요구를 고쳤으면 고친 요구다. 다시 만들기와 처음 만드는 묶음은 처음 입력만 넘기므로 `null`이다.
 */
function regenerationInputOf(bundle: MentionBundle): RegenerationInput | null {
  /** 묶음의 재생성. */
  const regeneration = bundle.regeneration;
  if (regeneration?.path === 'directive' && regeneration.previous) {
    return { path: 'directive', previous: regeneration.previous, directives: bundle.directives };
  }
  if (regeneration?.path === 'requirement' && bundle.fixedRequirement !== null) return { path: 'requirement', requirement: bundle.fixedRequirement };
  return null;
}

/** 실행 기록의 결과. 앱이 실행을 멈췄으면 그 까닭(취소함, 묶음이 바뀜, 앱 종료로 중단)이고, 아니면 실행의 결과다. */
function runResultOf(interruption: Interruption | null, verdict: RunVerdict<unknown>): RunResult {
  switch (interruption) {
    case 'user':
      return 'cancelled';
    case 'bundle-changed':
    case 'app-quit':
      return interruption;
    case null:
      return verdict.kind === 'output' ? 'succeeded' : verdict.reason;
  }
}

/** 마지막 실행 기록의 결과만 바꾼 실행 기록. 실행이 끝난 뒤 저장하기 전에 묶음이 바뀐 실행을 남길 때 쓴다. */
function withLastResult(runs: readonly RunRecord[], result: RunResult): RunRecord[] {
  return runs.map((run, index) => (index === runs.length - 1 ? { ...run, result } : run));
}

/** 정리할 일을 마친 뒤 실행 단계가 멈췄다고 돌려준다. */
async function stopAfter(cleanup: Promise<void>): Promise<{ kind: 'stopped' }> {
  await cleanup;
  return { kind: 'stopped' };
}
