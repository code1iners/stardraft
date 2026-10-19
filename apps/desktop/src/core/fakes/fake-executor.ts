import type { AgentId, Executor, ExecutorOutcome, ExecutorProgress, ExecutorRunRequest } from '../ports/executor';

/** 가짜 실행기가 실행 한 번에 따를 대본. */
export interface ScriptedRun {
  /** 차례로 알릴 진행 단계. */
  progress?: ExecutorProgress[];
  /** 돌려줄 결과. `wait-for-abort`면 중단 신호가 올 때까지 끝나지 않고, 신호가 오면 취소로 끝난다. */
  outcome: ExecutorOutcome | 'wait-for-abort';
}

/** 대본대로 진행 단계와 결과를 돌려주는 실행기. 실제 CLI는 부르지 않는다. */
export class FakeExecutor implements Executor {
  /** 받은 실행 입력. 받은 순서대로 쌓인다. */
  readonly requests: ExecutorRunRequest[] = [];
  /** 아직 쓰지 않은 대본. 실행할 때마다 앞에서 하나씩 꺼낸다. */
  private readonly scripts: ScriptedRun[] = [];

  constructor(readonly agent: AgentId) {}

  /** 다음 실행에 쓸 대본을 뒤에 더한다. */
  script(run: ScriptedRun): void {
    this.scripts.push(run);
  }

  async run(request: ExecutorRunRequest): Promise<ExecutorOutcome> {
    this.requests.push(request);
    const scripted = this.scripts.shift();
    if (!scripted) throw new Error('가짜 실행기에 남은 대본이 없습니다.');

    for (const progress of scripted.progress ?? []) request.onProgress(progress);

    if (scripted.outcome !== 'wait-for-abort') return scripted.outcome;
    return waitForAbort(request.signal);
  }
}

/** 중단 신호가 오면 취소 결과로 끝나는 약속. */
function waitForAbort(signal: AbortSignal): Promise<ExecutorOutcome> {
  return new Promise((resolve) => {
    const cancelled: ExecutorOutcome = { type: 'cancelled' };
    if (signal.aborted) {
      resolve(cancelled);
      return;
    }
    signal.addEventListener('abort', () => resolve(cancelled), { once: true });
  });
}
