import type { CancelScheduled, Clock } from '../ports/clock';
import type { TimeExtensionPolicy } from './target-adapter';

/**
 * 연장을 묻는 실행의 단계. `running`은 묻지 않는 동안, `asking`은 상한 직전에 사용자에게 묻고 답을 기다리는 중,
 * `wrapping-up`은 [멈추기]나 답 없음 뒤에 에이전트가 보고서를 마무리하기를 기다리는 중이다.
 */
export type TimeExtensionPhase = 'running' | 'asking' | 'wrapping-up';

/** 사용자의 답. `continue`는 [계속 진행], `stop`은 [멈추기]다. */
export type TimeExtensionAnswer = 'continue' | 'stop';

/** 시간 연장에 필요한 것. */
export interface TimeExtensionOptions {
  /** 대상 어댑터가 정한 연장 규칙. */
  policy: TimeExtensionPolicy;
  /** 실행 중 전달이 되는 실행기인지 여부. 거짓이면 마무리 메시지를 보내지 않고 바로 끊는다. */
  canSteer: boolean;
  /** 상한을 재고 기다림을 예약하는 시계. */
  clock: Clock;
  /** 단계가 바뀔 때마다 부른다. 화면에 알리는 데 쓴다. */
  onChange: () => void;
  /** 실행을 끊는다. 끊은 실행은 시간 초과로 끝난다. */
  stop: () => void;
}

/**
 * 실행 한 번의 시간 상한과 연장. 재현하는 진단처럼 사용자에게 연장을 묻는 실행만 쓴다. 시간 값은 모두 규칙(`TimeExtensionPolicy`)이 정한다.
 * 상한 얼마 전에 묻고, [계속 진행]이면 상한을 한 단계 늘려 새 상한 앞에서 다시 묻는다. 합계가 최대 상한이 되면 더는 묻지 않는다.
 * [멈추기]와 답 없음(상한에 닿음)은 같다. 실행 중 전달이 되는 실행기에는 마무리 메시지를 보내고 마무리 시간만큼 더 기다려, 그 안에 결과가 나오지 않으면 끊는다.
 * 전달이 안 되는 실행기는 바로 끊는다. 시간은 `begin`을 부른 때부터 센다. 실행이 끝나면 `end`로 예약을 모두 지운다.
 */
export class TimeExtension {
  /** 지금 단계. */
  phase: TimeExtensionPhase = 'running';
  /** 마무리 단계(마무리 메시지를 보냈거나 끊음)에 들어갔는지 여부. 참이면 상한을 이미 쓴 실행이라 다시 실행하지 않는다. */
  wrappedUp = false;
  /** 이 객체가 실행을 끊었는지 여부. 끊은 실행이 취소로 돌아와도 시간 초과로 읽게 한다. */
  timedOut = false;
  /** 지금 상한(밀리초). 실행을 시작한 때부터 센다. */
  private limitMs: number;
  /** 시간을 세기 시작한 시각. */
  private startedAt = 0;
  /** 실행 중인 에이전트에게 메시지를 보내는 함수. 실행기가 받을 준비를 알리기 전이면 `null`. */
  private send: ((message: string) => boolean) | null = null;
  /** 상한 예약. */
  private cancelLimit: CancelScheduled | null = null;
  /** 묻는 때 예약. */
  private cancelAsk: CancelScheduled | null = null;
  /** 마무리를 기다리는 예약. */
  private cancelWrapUp: CancelScheduled | null = null;
  /** 끝났는지 여부. 끝난 뒤에 오는 답과 예약은 무시한다. */
  private ended = false;

  constructor(private readonly options: TimeExtensionOptions) {
    this.limitMs = options.policy.limitMs;
  }

  /** 실행기에 넘길 시간 제한. 이 객체가 상한을 세므로 실행기의 제한은 가장 늦게 끊길 때(최대 상한과 마무리 기다림)까지 둔다. */
  get backstopMs(): number {
    return this.options.policy.maxMs + this.options.policy.wrapUpMs;
  }

  /** 실행 중 전달이 되는 실행기인지 여부. 바닥 줄의 둘째 문장이 이 값으로 달라진다. */
  get canSteer(): boolean {
    return this.options.canSteer;
  }

  /** 시간을 세기 시작한다. 실행기를 띄우기 직전에 부른다. */
  begin(): void {
    this.startedAt = this.options.clock.now();
    this.schedule();
  }

  /** 실행기가 메시지를 받을 준비가 됐다고 알린다. 보내는 함수는 실행이 끝나면 `false`를 돌려준다. */
  attach(send: (message: string) => boolean): void {
    this.send = send;
  }

  /** 사용자의 답. 묻는 중이 아니면 무시한다(답하는 사이에 상한이 지났거나 실행이 끝난 경우). */
  answer(answer: TimeExtensionAnswer): void {
    if (this.ended || this.phase !== 'asking') return;
    if (answer === 'stop') {
      this.wrapUp();
      return;
    }
    this.limitMs = Math.min(this.limitMs + this.options.policy.stepMs, this.options.policy.maxMs);
    this.phase = 'running';
    // 전달이 안 되는 실행기에는 알릴 길이 없고, 알려야 할 일도 없다(상한만 늘어난다).
    if (this.options.canSteer) this.send?.(this.options.policy.extendedMessage);
    this.schedule();
    this.options.onChange();
  }

  /** 실행이 끝났다. 남은 예약을 모두 지운다. */
  end(): void {
    this.ended = true;
    this.cancelAll();
  }

  /** 지금 상한에 맞춰 묻는 때와 상한을 예약한다. 최대 상한에서는 묻지 않는다. */
  private schedule(): void {
    this.cancelAll();
    /** 지난 시간. */
    const elapsed = this.options.clock.now() - this.startedAt;
    // 상한에 닿으면(답이 없었으면) 마무리 단계로 간다.
    this.cancelLimit = this.options.clock.after(Math.max(0, this.limitMs - elapsed), () => this.reachedLimit());
    if (this.limitMs >= this.options.policy.maxMs) return;
    this.cancelAsk = this.options.clock.after(Math.max(0, this.limitMs - this.options.policy.askBeforeMs - elapsed), () => this.ask());
  }

  /** 상한 5분 전이다. 사용자에게 묻는다. */
  private ask(): void {
    if (this.ended || this.phase !== 'running') return;
    this.phase = 'asking';
    this.options.onChange();
    this.options.policy.onAsk?.();
  }

  /** 상한에 닿았다. 답이 없었으면 [멈추기]와 똑같이 처리한다. */
  private reachedLimit(): void {
    if (this.ended) return;
    this.wrapUp();
  }

  /**
   * 멈춘다. 전달이 되면 마무리 메시지를 보내고 `wrapUpMs` 동안 결과를 기다리며, 전달이 안 되거나 보내지 못하면 바로 끊는다.
   */
  private wrapUp(): void {
    this.wrappedUp = true;
    this.cancelAll();
    if (this.options.canSteer && this.send?.(this.options.policy.wrapUpMessage)) {
      this.phase = 'wrapping-up';
      this.cancelWrapUp = this.options.clock.after(this.options.policy.wrapUpMs, () => this.cut());
      this.options.onChange();
      return;
    }
    this.cut();
  }

  /** 실행을 끊는다. */
  private cut(): void {
    if (this.ended) return;
    this.timedOut = true;
    this.cancelAll();
    this.options.stop();
    this.options.onChange();
  }

  /** 예약을 모두 지운다. */
  private cancelAll(): void {
    this.cancelLimit?.();
    this.cancelAsk?.();
    this.cancelWrapUp?.();
    this.cancelLimit = null;
    this.cancelAsk = null;
    this.cancelWrapUp = null;
  }
}
