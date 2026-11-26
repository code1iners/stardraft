import type { MentionBundles, RegenerationRequest } from '../bundles/mention-bundles';
import type { TargetRef } from '../generation/generation-run';
import { GenerationQueue, queueAgentFrom, type GenerationProgress, type QueueAgent } from '../generation/generation-queue';
import type { Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { GenerationQueueStore } from '../ports/generation-queue-store';
import type { SettingsStore } from '../ports/settings-store';
import { FLOW_TARGET_KIND, FlowTargetAdapter } from './flow-target-adapter';

export type { RunnableAgent } from '../generation/generation-queue';

/** 선택 실행과 초안 실행에 쓸 에이전트. 생성 대기열의 에이전트와 같다. */
export type DraftAgent = QueueAgent;

/** 생성 중 묶음의 진행. 생성 대기열의 진행과 같다. */
export type DraftProgress = GenerationProgress;

/**
 * 선택 실행과 초안 실행에 쓸 에이전트를 고른다. 기본 에이전트의 연결이 만든 실행기와 실행 직전 확인, 그 에이전트에 고른 모델이다.
 * 연결된 에이전트가 없거나(기본 에이전트가 없음) 기본 에이전트의 연결이 없으면 `null`이고, 초안 대기열은 기다린다.
 */
export const draftAgentFrom = queueAgentFrom;

/** 초안 대기열에 필요한 것. */
export interface DraftQueueOptions {
  /** 생성 중 묶음을 찾고 실행 결과를 맡길 멘션 묶음. 실행 직전의 저장소 매핑 확인도 맡는다. */
  bundles: MentionBundles;
  /** 지금 실행에 쓸 에이전트. 에이전트 연결이 없으면 `null`이고, 대기열은 연결될 때까지 기다린다. */
  agent: () => DraftAgent | null;
  /** 에이전트 연결이나 기본 에이전트·모델이 바뀔 때마다 `listener`를 부르게 한다. 돌려준 함수를 부르면 그만 부른다. */
  onAgentChange: (listener: () => void) => () => void;
  /** Flow에 쓸 키가 있는지 본다. 키가 없거나 "키 확인 필요"면 거짓이고, Flow 묶음은 키를 쓸 수 있게 될 때까지 멈춘다. */
  flowKeyUsable: () => boolean;
  /** Flow 키를 쓸 수 있는지가 바뀔 수 있을 때마다(계정, "키 확인 필요") `listener`를 부르게 한다. 돌려준 함수를 부르면 그만 부른다. */
  onFlowKeyChange: (listener: () => void) => () => void;
  /** 추가 지침과 추가 비밀 파일 패턴을 읽는 설정 저장소. 실행마다 새로 읽어 다음 실행부터 바뀐 값을 쓴다. */
  settingsStore: SettingsStore;
  /** 대기열이 바뀔 때마다 남기고 다시 켤 때 읽는 저장소. */
  stateStore: GenerationQueueStore;
  /** 답변 명의자인 내 이름. 모르면 `null`. */
  myName: () => string | null;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: (projectId: string) => Promise<string | null>;
  /** 실행 시작·종료 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. ID와 개수만 남기고 Flow 글과 초안은 남기지 않는다. */
  logger: Logger;
}

/**
 * 초안 대기열. Flow 멘션 묶음을 묶음 ID로 다루는 창구로, 생성 대기열에 Flow 어댑터를 붙여 돌린다.
 * 실행 자리, 우선순위, 대기열 저장과 복원, 실행 직전 에이전트 확인, 재시도, 멈춤, 취소, 앱 종료는 생성 대기열이 맡고,
 * 맥락 조회와 자동 선택, 초안 검증, 결과 저장은 Flow 어댑터가 맡는다.
 */
export class DraftQueue {
  /** Flow 어댑터를 붙인 생성 대기열. */
  private readonly queue: GenerationQueue;
  /** 사용자 행동으로 바꿀 멘션 묶음. */
  private readonly bundles: MentionBundles;

  constructor(options: DraftQueueOptions) {
    this.bundles = options.bundles;
    /** Flow 어댑터. */
    const flow = new FlowTargetAdapter({
      bundles: options.bundles,
      flowKeyUsable: options.flowKeyUsable,
      onFlowKeyChange: options.onFlowKeyChange,
      settingsStore: options.settingsStore,
      myName: options.myName,
      projectTitle: options.projectTitle,
      clock: options.clock,
    });
    this.queue = new GenerationQueue({
      adapters: [flow],
      agent: options.agent,
      onAgentChange: options.onAgentChange,
      store: options.stateStore,
      clock: options.clock,
      logger: options.logger,
    });
  }

  /** 대기열을 시작한다. 앱이 꺼지기 전에 남긴 대기열이 있으면 그 순서와 자리 그대로 먼저 넣는다. */
  start(): Promise<void> {
    return this.queue.start();
  }

  /** 대기열을 멈춘다. 앱을 끝낼 때 부른다. 실행 중인 실행은 끊고, 끊은 실행의 기록을 최대 5초 기다린다. */
  stop(): Promise<void> {
    return this.queue.stop();
  }

  /** 생성 중 묶음의 진행. 대기열에 없으면 `null`. */
  progress(bundleId: number): DraftProgress | null {
    return this.queue.progress(flowTarget(bundleId));
  }

  /** 에이전트 실행이 진행 중인지 본다. 앱 내 업데이트는 실행이 끝날 때까지 다시 시작을 미룬다. */
  isRunning(): boolean {
    return this.queue.isRunning();
  }

  /** 참이면 앱 내 업데이트의 다시 시작을 기다리는 동안 다음 실행을 시작하지 않고, 거짓이면 다시 돈다. */
  holdForRestart(held: boolean): void {
    this.queue.holdForRestart(held);
  }

  /** 진행(대기열, 진행 단계, 읽은 파일 수)이 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    return this.queue.onChange(listener);
  }

  /** 생성 중 묶음을 취소한다. 실행 중이면 실행을 끊고, 기다리는 중이면 바로 "취소함" 실패로 둔다. */
  cancel(bundleId: number): Promise<void> {
    return this.queue.cancel(flowTarget(bundleId));
  }

  /** 비밀 파일 패턴을 추가했다. 실행 중인 실행이 있으면 끊고 그 묶음을 대기열 맨 앞에서 새 패턴으로 처음부터 다시 만든다. */
  restartForSecretPatterns(): void {
    this.queue.restartForSecretPatterns();
  }

  /** 실패 묶음을 [다시 시도]한다. 사용자 행동이라 생성 중으로 돌아가면 감지해서 기다리는 묶음보다 앞에 들어간다. */
  retry(bundleId: number): Promise<void> {
    return this.changeByUser(bundleId, (bundles) => bundles.retry(bundleId));
  }

  /**
   * 준비됨이나 저장소 확인 필요 묶음을 저장소 선택 창에서 고른 구성으로 다시 만든다. "다른 저장소로 다시 만들기"와 "저장소를 골라 만들기"다.
   * 매번 새 실행이고, 처음 입력에 읽을 저장소만 바꿔 넘긴다(직전 결과는 넘기지 않는다). 매핑이 없어도 선택 실행은 돌리지 않는다.
   */
  regenerateWithRepos(bundleId: number, repos: readonly string[]): Promise<void> {
    return this.changeByUser(bundleId, (bundles) => bundles.regenerateWithRepos(bundleId, repos));
  }

  /**
   * 준비됨 묶음을 다시 만든다. 다시 만들기, 지시를 덧붙여 다시 만들기, 요구 고치기다.
   * 매번 새 실행이고 사용자 행동이라 감지해서 기다리는 묶음보다 앞에 들어간다. 자동 선택으로 저장소를 정한 묶음도 선택 실행은 다시 돌리지 않는다.
   */
  regenerate(bundleId: number, request: RegenerationRequest): Promise<void> {
    return this.changeByUser(bundleId, (bundles) => bundles.regenerate(bundleId, request));
  }

  /** 처리됨 묶음을 되돌린다. 초안이 없어 새로 만들게 되면 사용자 행동이라 감지해서 기다리는 묶음보다 앞에 들어간다. */
  restore(bundleId: number): Promise<void> {
    return this.changeByUser(bundleId, (bundles) => bundles.restore(bundleId));
  }

  /** 사용자 행동으로 묶음을 바꾼다. 바꾸는 사이에 묶음이 생성 중이 되면 사용자 행동 자리에 넣는다. */
  private changeByUser(bundleId: number, change: (bundles: MentionBundles) => Promise<void>): Promise<void> {
    return this.queue.changeByUser(flowTarget(bundleId), () => change(this.bundles));
  }
}

/** 묶음 ID를 생성 대기열의 대상으로 바꾼다. */
function flowTarget(bundleId: number): TargetRef {
  return { kind: FLOW_TARGET_KIND, targetId: bundleId };
}
