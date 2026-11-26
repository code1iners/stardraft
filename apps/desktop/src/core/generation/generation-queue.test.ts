import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeExecutor } from '../fakes/fake-executor';
import { createLogger } from '../logging/logger';
import type { ExecutorOutcome, ExecutorProgress } from '../ports/executor';
import type { GenerationQueueStore } from '../ports/generation-queue-store';
import type { QueuedTarget, RunRecord } from './generation-run';
import { GenerationQueue } from './generation-queue';
import type { Preparation, TargetAdapter, TargetFailure, TimeExtensionPolicy } from './target-adapter';

/** 지금 시각. */
const NOW = Date.UTC(2026, 10, 26, 0, 0, 0);

/** 가짜 어댑터의 타입 묶음. 결과는 에이전트가 낸 출력 그대로이고, 저장소 대기 기록은 까닭 한 줄이다. */
interface FakeTypes {
  /** 생성을 시작할 때 대상의 판. */
  job: number;
  /** 저장할 출력. */
  result: unknown;
  /** 저장소 대기의 까닭. */
  repoWait: string;
  /** 실행 전에 남기는 실패 사유. */
  failureReason: 'source-unavailable';
}

/** 가짜 대상 하나의 상태. */
interface FakeTarget {
  /** 상태. */
  status: 'generating' | 'saved' | 'failed' | 'repo-wait';
  /** 사용자가 요청한 대상인지 여부. */
  manual: boolean;
  /** 생성을 시작할 때마다 바뀌는 판. 판이 바뀌면 "아직 생성 중인가"가 거짓이 된다. */
  revision: number;
  /** 저장한 결과. */
  result: unknown;
  /** 기록한 실패. */
  failure: TargetFailure<FakeTypes['failureReason']> | null;
  /** 남긴 실행 기록. */
  runs: RunRecord[];
}

/**
 * 메모리 안에서 대상을 들고 있는 가짜 대상 어댑터. 준비는 테스트가 대상마다 넣어 둔 대본을 앞에서부터 쓰고,
 * 대본이 없으면 실행 한 번을 돌려 출력 그대로 저장한다.
 */
class FakeAdapter implements TargetAdapter<FakeTypes> {
  /** 준비하는 동안 보일 진행 단계. */
  readonly preparingStep = '준비 중';
  /** 대상. 넣은 순서가 화면 순서다. */
  readonly targets = new Map<number, FakeTarget>();
  /** 준비를 부른 대상 ID. 부른 순서다. */
  readonly prepared: number[] = [];
  /** 연결을 쓸 수 있는지 여부. */
  usable = true;
  /** 대상마다 함께 돌 수 없는 자원. 없으면 제한이 없다. */
  readonly exclusive = new Map<number, string>();
  /** 대상마다 남은 준비 대본. */
  private readonly scripts = new Map<number, Preparation<FakeTypes>[]>();
  /** 대상이 바뀔 때 부를 함수. */
  private readonly targetListeners = new Set<() => void>();
  /** 연결이 바뀔 때 부를 함수. */
  private readonly connectionListeners = new Set<() => void>();

  constructor(readonly kind: string) {}

  /** 생성 중 대상을 더하고 알린다. */
  add(targetId: number, manual = false): void {
    this.targets.set(targetId, { status: 'generating', manual, revision: 0, result: null, failure: null, runs: [] });
    for (const listener of this.targetListeners) listener();
  }

  /** 다음 준비 결과를 대본으로 넣는다. */
  scriptPreparation(targetId: number, preparation: Preparation<FakeTypes>): void {
    this.scripts.set(targetId, [...(this.scripts.get(targetId) ?? []), preparation]);
  }

  /** 연결이 바뀌었다고 알린다. */
  setUsable(usable: boolean): void {
    this.usable = usable;
    for (const listener of this.connectionListeners) listener();
  }

  /** 대상 상태. */
  status(targetId: number): FakeTarget['status'] | undefined {
    return this.targets.get(targetId)?.status;
  }

  generatingTargets(): number[] {
    return [...this.targets].filter(([, target]) => target.status === 'generating').map(([targetId]) => targetId);
  }

  requestedByUser(targetId: number): boolean {
    return this.targets.get(targetId)?.manual === true;
  }

  onTargetsChange(listener: () => void): () => void {
    this.targetListeners.add(listener);
    return () => this.targetListeners.delete(listener);
  }

  connectionUsable(): boolean {
    return this.usable;
  }

  onConnectionChange(listener: () => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  exclusiveResource(targetId: number): string | null {
    return this.exclusive.get(targetId) ?? null;
  }

  begin(targetId: number): number | null {
    /** 대상. */
    const target = this.targets.get(targetId);
    return target?.status === 'generating' ? target.revision : null;
  }

  isGenerating(targetId: number, job: number | null): boolean {
    /** 대상. */
    const target = this.targets.get(targetId);
    return target?.status === 'generating' && (job === null || job === target.revision);
  }

  async prepare(targetId: number): Promise<Preparation<FakeTypes>> {
    this.prepared.push(targetId);
    /** 넣어 둔 준비 대본. 없으면 실행 한 번이다. */
    const scripted = this.scripts.get(targetId)?.shift();
    return scripted ?? { kind: 'ready', next: { kind: 'run', run: fakeRun() } };
  }

  async save(targetId: number, job: number, result: unknown, runs: readonly RunRecord[]): Promise<boolean> {
    return this.finish(targetId, job, runs, (target) => Object.assign(target, { status: 'saved', result }));
  }

  async fail(targetId: number, job: number | null, failure: TargetFailure<FakeTypes['failureReason']>, runs: readonly RunRecord[]): Promise<boolean> {
    return this.finish(targetId, job, runs, (target) => Object.assign(target, { status: 'failed', failure }));
  }

  async needsRepoCheck(targetId: number, job: number, _wait: string, runs: readonly RunRecord[]): Promise<boolean> {
    return this.finish(targetId, job, runs, (target) => Object.assign(target, { status: 'repo-wait' }));
  }

  async addRuns(targetId: number, runs: readonly RunRecord[]): Promise<void> {
    this.targets.get(targetId)?.runs.push(...runs);
  }

  /** 생성 중인 대상을 끝낸다. 판이 바뀌었으면 끝내지 않는다. */
  private finish(targetId: number, job: number | null, runs: readonly RunRecord[], change: (target: FakeTarget) => void): boolean {
    if (!this.isGenerating(targetId, job)) return false;
    /** 대상. */
    const target = this.targets.get(targetId)!;
    target.runs.push(...runs);
    change(target);
    for (const listener of this.targetListeners) listener();
    return true;
  }
}

/** 출력을 그대로 저장하는 가짜 실행 하나. */
function fakeRun() {
  return {
    kind: 'draft' as const,
    step: '쓰는 중',
    omittedContextItems: 0,
    request: async (model: string | null) => ({
      instructions: '가짜 지침',
      input: '가짜 입력',
      outputSchema: {},
      readRoots: [],
      secretPatterns: [],
      model,
      timeoutMs: 60_000,
    }),
    read: (output: unknown) => ({ kind: 'output' as const, output }),
    check: async (output: unknown) => ({ kind: 'passed' as const, fixes: [], next: { kind: 'save' as const, result: output } }),
  };
}

/** 메모리 안의 대기열 저장소. */
class MemoryQueueStore implements GenerationQueueStore {
  /** 남긴 대기열. */
  queue: QueuedTarget[] = [];

  async getGenerationQueue(): Promise<QueuedTarget[]> {
    return [...this.queue];
  }

  async setGenerationQueue(queue: readonly QueuedTarget[]): Promise<void> {
    this.queue = [...queue];
  }
}

/** 가짜 시계와 포트의 응답이 모두 끝나도록 대기 중인 비동기 일을 돌린다. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** 가짜 Flow 어댑터와 가짜 둘째 어댑터를 붙인 생성 대기열을 만든다. 에이전트는 테스트가 끊고 이을 수 있다. */
function setup({ steering = false }: { steering?: boolean } = {}) {
  const clock = new FakeClock(NOW);
  const logger = createLogger([{ write: () => {} }], clock);
  const executor = new FakeExecutor('claude-code', { steering });
  const flow = new FakeAdapter('flow');
  const second = new FakeAdapter('second');
  const store = new MemoryQueueStore();
  /** 에이전트를 쓸 수 있는지 여부와 바뀔 때 부를 함수. */
  const agent = { connected: true, listeners: new Set<() => void>() };
  /** 병렬 작업 수와 바뀔 때 부를 함수. */
  const parallel = { count: 1, listeners: new Set<() => void>() };
  /** 대기열을 만든다. 앱을 다시 켤 때처럼 같은 어댑터와 저장소로 새로 만들 수 있다. */
  const createQueue = () =>
    new GenerationQueue({
      adapters: [flow, second],
      agent: () => ({ executor, model: null, confirmForRun: async () => agent.connected }),
      onAgentChange: (listener) => {
        agent.listeners.add(listener);
        return () => agent.listeners.delete(listener);
      },
      parallelWork: {
        count: () => parallel.count,
        onChange: (listener) => {
          parallel.listeners.add(listener);
          return () => parallel.listeners.delete(listener);
        },
      },
      store,
      clock,
      logger,
    });
  /** 에이전트 연결을 바꾼다. */
  const setConnected = (connected: boolean) => {
    agent.connected = connected;
    for (const listener of agent.listeners) listener();
  };
  /** 알림 없이 에이전트 연결만 바꾼다. 연결 확인을 다시 해야 알 수 있는 변화다. */
  const setConnectedQuietly = (connected: boolean) => {
    agent.connected = connected;
  };
  /** 병렬 작업 수를 바꾼다. */
  const setParallel = (count: number) => {
    parallel.count = count;
    for (const listener of parallel.listeners) listener();
  };
  /** 실행 하나를 출력 `output`으로 끝나게 대본을 넣는다. */
  const completes = (output: unknown) => executor.script({ outcome: { type: 'completed', output } });
  /** 실행 하나를 테스트가 끝낼 때까지 돌게 대본을 넣는다. 돌려준 함수에 결과를 넘기면 끝난다. */
  const holds = (progress: ExecutorProgress[] = []) => {
    /** 실행을 끝내는 함수. */
    let finish!: (outcome: ExecutorOutcome) => void;
    executor.script({ progress, outcome: new Promise<ExecutorOutcome>((resolve) => (finish = resolve)) });
    return finish;
  };
  return { clock, executor, flow, second, store, createQueue, setConnected, setConnectedQuietly, setParallel, completes, holds };
}

describe('생성 대기열: 멈춤은 두 층', () => {
  it('Flow 어댑터가 연결 문제로 멈추면 그 대상은 실패가 되지 않고 순서를 지킨 채 기다리며, 둘째 어댑터의 대상이 그 앞으로 지나간다. 연결이 바뀌면 멈춘 대상부터 다시 돈다', async () => {
    const env = setup();
    env.flow.add(1);
    env.second.add(10);
    env.flow.scriptPreparation(1, { kind: 'adapter-paused' });
    env.completes({ answer: 'second' });
    const queue = env.createQueue();
    await queue.start();
    await settle();

    expect(env.second.status(10)).toBe('saved');
    expect(env.flow.status(1)).toBe('generating');
    expect(queue.progress({ kind: 'flow', targetId: 1 })).toEqual({ status: 'waiting' });
    // 멈춘 동안 들어온 Flow 대상도 시작하지 않는다.
    env.flow.add(2);
    await settle();
    expect(env.flow.prepared).toEqual([1]);
    expect(env.store.queue).toEqual([
      { kind: 'flow', targetId: 1, priority: 'resume' },
      { kind: 'flow', targetId: 2, priority: 'auto' },
    ]);

    env.completes({ answer: 'flow-1' });
    env.completes({ answer: 'flow-2' });
    env.flow.setUsable(true);
    await settle();

    expect(env.flow.prepared).toEqual([1, 1, 2]);
    expect(env.flow.targets.get(1)?.result).toEqual({ answer: 'flow-1' });
    expect(env.flow.status(2)).toBe('saved');
  });

  it('어댑터의 연결을 쓸 수 없는 동안 그 대상은 시작하지 않고, 다른 어댑터의 대상은 돈다', async () => {
    const env = setup();
    env.flow.usable = false;
    env.flow.add(1);
    env.second.add(10);
    env.completes({ answer: 'second' });
    const queue = env.createQueue();
    await queue.start();
    await settle();

    expect(env.flow.prepared).toEqual([]);
    expect(env.second.status(10)).toBe('saved');

    env.completes({ answer: 'flow' });
    env.flow.setUsable(true);
    await settle();
    expect(env.flow.status(1)).toBe('saved');
  });

  it('잠시 뒤 다시는 그 시간 동안 그 어댑터의 대상만 멈추고, 시간이 지나면 그 대상부터 다시 준비한다', async () => {
    const env = setup();
    env.flow.add(1);
    env.flow.scriptPreparation(1, { kind: 'retry-later', afterMs: 30_000 });
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.completes({ answer: 'second' });
    env.second.add(10);
    await settle();

    expect(env.second.status(10)).toBe('saved');
    expect(env.flow.prepared).toEqual([1]);

    env.completes({ answer: 'flow' });
    env.clock.advance(29_999);
    await settle();
    expect(env.flow.prepared).toEqual([1]);
    env.clock.advance(1);
    await settle();
    expect(env.flow.prepared).toEqual([1, 1]);
    expect(env.flow.status(1)).toBe('saved');
  });

  it('에이전트를 쓸 수 없으면 어느 어댑터의 대상도 시작하지 않고, 연결되면 들어온 순서대로 돈다', async () => {
    const env = setup();
    env.setConnected(false);
    const queue = env.createQueue();
    await queue.start();
    env.second.add(10);
    env.flow.add(1);
    await settle();

    expect(env.flow.prepared).toEqual([]);
    expect(env.second.prepared).toEqual([]);

    env.completes({ answer: 'second' });
    env.completes({ answer: 'flow' });
    env.setConnected(true);
    await settle();
    expect(env.second.status(10)).toBe('saved');
    expect(env.flow.status(1)).toBe('saved');
    expect(env.executor.requests).toHaveLength(2);
  });
});

describe('생성 대기열: 저장과 복원', () => {
  it('종류가 섞인 대기열을 종류와 대상 ID, 자리 그대로 남기고, 다시 켜면 그 순서로 돈다. 모르는 종류의 줄은 건너뛴다', async () => {
    const env = setup();
    env.flow.add(1);
    env.second.add(10);
    env.flow.add(2, true);
    env.store.queue = [
      { kind: 'second', targetId: 10, priority: 'resume' },
      { kind: 'gone', targetId: 99, priority: 'resume' },
      { kind: 'flow', targetId: 2, priority: 'user' },
      { kind: 'flow', targetId: 1, priority: 'auto' },
    ];
    for (const answer of ['a', 'b', 'c']) env.completes({ answer });
    const queue = env.createQueue();
    await queue.start();
    await settle();

    expect(env.second.targets.get(10)?.result).toEqual({ answer: 'a' });
    expect(env.flow.targets.get(2)?.result).toEqual({ answer: 'b' });
    expect(env.flow.targets.get(1)?.result).toEqual({ answer: 'c' });
    expect(env.store.queue).toEqual([]);
  });
});

describe('생성 대기열: 실행의 요청과 검증', () => {
  it('요청을 만들 때 실행할 에이전트를 넘기고, 검증에는 그 실행에서 실행기가 알려 준 것을 넘긴다', async () => {
    const env = setup();
    /** 요청을 만들 때 받은 에이전트. */
    const agents: string[] = [];
    /** 검증에서 받은 실행 보고의 연결 실패 서버. */
    const reported: (string[] | undefined)[] = [];
    /** 기본 가짜 실행. */
    const base = fakeRun();
    env.second.add(10);
    env.second.scriptPreparation(10, {
      kind: 'ready',
      next: {
        kind: 'run',
        run: {
          ...base,
          request: async (model, agent) => {
            agents.push(agent);
            return base.request(model);
          },
          check: async (output, _request, report) => {
            reported.push(report.mcpFailedServers);
            return base.check(output);
          },
        },
      },
    });
    env.executor.script({ outcome: { type: 'completed', output: { answer: 'a' } }, report: { mcpFailedServers: ['docs'] } });

    await env.createQueue().start();
    await settle();

    expect(agents).toEqual(['claude-code']);
    expect(reported).toEqual([['docs']]);
    expect(env.second.targets.get(10)?.result).toEqual({ answer: 'a' });
  });
});

describe('생성 대기열: 병렬 작업 수', () => {
  it('병렬 작업 수만큼 초안을 함께 진행하고, 남은 대상은 자리가 날 때 꺼낸다', async () => {
    const env = setup();
    env.setParallel(2);
    const finishFirst = env.holds();
    env.holds();
    env.completes({ answer: 'third' });
    env.flow.add(1);
    env.flow.add(2);
    env.flow.add(3);
    const queue = env.createQueue();
    await queue.start();
    await settle();

    expect(env.executor.requests).toHaveLength(2);
    expect(queue.progress({ kind: 'flow', targetId: 1 })?.status).toBe('running');
    expect(queue.progress({ kind: 'flow', targetId: 2 })?.status).toBe('running');
    expect(queue.progress({ kind: 'flow', targetId: 3 })).toEqual({ status: 'waiting' });

    finishFirst({ type: 'completed', output: { answer: 'first' } });
    await settle();
    expect(env.flow.targets.get(1)?.result).toEqual({ answer: 'first' });
    expect(env.flow.status(3)).toBe('saved');
    expect(env.flow.status(2)).toBe('generating');
  });

  it('값을 줄여도 돌던 실행은 끊지 않고, 진행 중이 새 값 아래로 내려간 뒤에야 다음 대상을 꺼낸다. 값을 올리면 바로 자리가 난다', async () => {
    const env = setup();
    env.setParallel(3);
    const finishes = [env.holds(), env.holds(), env.holds()];
    for (const targetId of [1, 2, 3, 4, 5]) env.flow.add(targetId);
    const queue = env.createQueue();
    await queue.start();
    await settle();
    expect(queue.runningCount()).toBe(3);

    env.setParallel(1);
    await settle();
    expect(queue.runningCount()).toBe(3);
    expect(env.executor.requests.every((request) => !request.signal.aborted)).toBe(true);

    finishes[0]!({ type: 'completed', output: 'one' });
    finishes[1]!({ type: 'completed', output: 'two' });
    await settle();
    expect(queue.runningCount()).toBe(1);
    expect(env.executor.requests).toHaveLength(3);

    const finishFourth = env.holds();
    env.holds();
    finishes[2]!({ type: 'completed', output: 'three' });
    await settle();
    expect(env.executor.requests).toHaveLength(4);
    expect(queue.runningCount()).toBe(1);

    env.setParallel(2);
    await settle();
    expect(env.executor.requests).toHaveLength(5);
    expect(queue.runningCount()).toBe(2);
    finishFourth({ type: 'completed', output: 'four' });
    await settle();
    expect(env.flow.status(4)).toBe('saved');
  });

  it('함께 돌 수 없는 자원을 쓰는 대상은 한 번에 하나만 돌고, 다음 것은 자리를 지키며 기다리는 동안 뒤의 대상이 먼저 돈다', async () => {
    const env = setup();
    env.setParallel(3);
    env.second.exclusive.set(10, 'reproduction');
    env.second.exclusive.set(11, 'reproduction');
    // 같은 칸에서는 어댑터 순서대로 서므로 Flow 대상이 먼저 시작한다.
    env.holds();
    const finishFirstRepro = env.holds();
    env.second.add(10);
    env.second.add(11);
    env.flow.add(1);
    const queue = env.createQueue();
    await queue.start();
    await settle();

    expect(env.second.prepared).toEqual([10]);
    expect(env.flow.prepared).toEqual([1]);
    expect(queue.progress({ kind: 'second', targetId: 11 })).toEqual({ status: 'waiting' });
    expect(queue.runningCount()).toBe(2);

    const finishSecondRepro = env.holds();
    finishFirstRepro({ type: 'completed', output: 'repro-1' });
    await settle();
    expect(env.second.status(10)).toBe('saved');
    expect(env.second.prepared).toEqual([10, 11]);
    finishSecondRepro({ type: 'completed', output: 'repro-2' });
    await settle();
    expect(env.second.status(11)).toBe('saved');
  });

  it('실행의 정리(재현 사본·시뮬레이터 정리 등)는 결과를 저장하거나 실패·취소한 뒤 한 번 돌고, 함께 돌 수 없는 자원은 정리가 끝난 뒤에 놓인다', async () => {
    const env = setup();
    env.setParallel(2);
    env.second.exclusive.set(10, 'reproduction');
    env.second.exclusive.set(11, 'reproduction');
    /** 정리를 부른 대상과 그때 대상 상태. */
    const released: string[] = [];
    /** 첫 정리를 끝내는 함수. */
    let finishRelease = () => {};
    env.second.scriptPreparation(10, {
      kind: 'ready',
      next: {
        kind: 'run',
        run: {
          ...fakeRun(),
          release: () => {
            released.push(`10:${String(env.second.status(10))}`);
            return new Promise<void>((resolve) => (finishRelease = resolve));
          },
        },
      },
    });
    env.second.scriptPreparation(11, {
      kind: 'ready',
      next: { kind: 'run', run: { ...fakeRun(), release: async () => void released.push(`11:${String(env.second.status(11))}`) } },
    });
    const finishFirst = env.holds();
    env.holds();
    env.second.add(10);
    env.second.add(11);
    const queue = env.createQueue();
    await queue.start();
    await settle();

    finishFirst({ type: 'completed', output: 'repro-1' });
    await settle();
    // 결과를 저장한 뒤 정리를 부르고, 정리가 끝날 때까지 다음 재현 대상은 시작하지 않는다.
    expect(released).toEqual(['10:saved']);
    expect(env.second.prepared).toEqual([10]);

    finishRelease();
    await settle();
    expect(env.second.prepared).toEqual([10, 11]);
    await queue.cancel({ kind: 'second', targetId: 11 });
    await settle();
    // 취소해도 정리를 부른다.
    expect(released).toEqual(['10:saved', '11:failed']);
  });

  it('전역 실패로 대기열이 멈춰도 함께 돌던 실행은 끊기지 않고, 성공하면 저장되며 실패하면 같은 판정을 거쳐 대기열로 돌아간다', async () => {
    const env = setup();
    env.setParallel(3);
    const finishes = [env.holds(), env.holds(), env.holds()];
    for (const targetId of [1, 2, 3, 4]) env.flow.add(targetId);
    const queue = env.createQueue();
    await queue.start();
    await settle();

    // 첫 실행이 CLI 오류로 끝나고 다시 한 연결 확인도 실패한다. 전역 실패다.
    env.setConnected(false);
    finishes[0]!({ type: 'failed', reason: 'cli-error', detail: '' });
    await settle();
    expect(env.flow.status(1)).toBe('generating');
    expect(queue.progress({ kind: 'flow', targetId: 1 })).toEqual({ status: 'waiting' });
    expect(env.executor.requests).toHaveLength(3);
    expect(env.executor.requests.slice(1).every((request) => !request.signal.aborted)).toBe(true);

    finishes[1]!({ type: 'completed', output: 'two' });
    finishes[2]!({ type: 'failed', reason: 'not-logged-in', detail: '' });
    await settle();
    expect(env.flow.targets.get(2)?.result).toBe('two');
    expect(env.flow.status(3)).toBe('generating');
    expect(env.flow.targets.get(3)?.failure).toBeNull();
    expect(env.executor.requests).toHaveLength(3);
    expect(queue.runningCount()).toBe(0);
  });

  it('전역 실패로 멈춘 뒤 함께 돌던 실행의 연결 확인이 통과하면 멈춤을 풀고 기다리던 대상을 다시 꺼낸다', async () => {
    const env = setup();
    env.setParallel(2);
    const finishes = [env.holds(), env.holds()];
    env.flow.add(1);
    env.flow.add(2);
    const queue = env.createQueue();
    await queue.start();
    await settle();

    env.setConnected(false);
    finishes[0]!({ type: 'failed', reason: 'cli-error', detail: '' });
    await settle();
    expect(queue.progress({ kind: 'flow', targetId: 1 })).toEqual({ status: 'waiting' });

    // 알림 없이 연결이 돌아왔다(실행하는 사이 CLI를 고침 등). 둘째 실행의 실패 뒤 다시 한 확인이 통과한다.
    env.completes({ answer: 'two-again' });
    env.completes({ answer: 'one-again' });
    env.setConnectedQuietly(true);
    finishes[1]!({ type: 'failed', reason: 'cli-error', detail: '' });
    await settle();
    expect(env.flow.targets.get(2)?.result).toEqual({ answer: 'two-again' });
    expect(env.flow.targets.get(1)?.result).toEqual({ answer: 'one-again' });
  });

  it('앱을 끄면 돌던 실행을 모두 끊고, 다시 켜면 원래 시작한 순서대로 resume 칸 맨 앞에 선다', async () => {
    const env = setup();
    env.setParallel(2);
    env.holds();
    env.holds();
    env.flow.add(1);
    env.second.add(10);
    env.flow.add(2);
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.flow.add(3, true);
    await settle();

    await queue.stop();
    expect(env.executor.requests.every((request) => request.signal.aborted)).toBe(true);
    expect(env.flow.targets.get(1)?.runs.at(-1)?.result).toBe('app-quit');
    expect(env.flow.targets.get(2)?.runs.at(-1)?.result).toBe('app-quit');
    expect(env.store.queue).toEqual([
      { kind: 'flow', targetId: 1, priority: 'resume' },
      { kind: 'flow', targetId: 2, priority: 'resume' },
      { kind: 'flow', targetId: 3, priority: 'user' },
      { kind: 'second', targetId: 10, priority: 'auto' },
    ]);

    env.setParallel(1);
    for (const answer of ['a', 'b', 'c', 'd']) env.completes({ answer });
    const restarted = env.createQueue();
    await restarted.start();
    await settle();
    expect(env.flow.prepared).toEqual([1, 2, 1, 2, 3]);
    expect(env.second.prepared).toEqual([10]);
    expect(env.flow.targets.get(1)?.result).toEqual({ answer: 'a' });
    expect(env.flow.targets.get(2)?.result).toEqual({ answer: 'b' });
    expect(env.flow.targets.get(3)?.result).toEqual({ answer: 'c' });
    expect(env.second.targets.get(10)?.result).toEqual({ answer: 'd' });
  });

  it('진행 단계 알림은 실행마다 따로 간다', async () => {
    const env = setup();
    env.setParallel(2);
    env.holds([{ step: '첫째 파일 읽는 중', filesRead: 3 }]);
    env.holds([{ step: '둘째 파일 읽는 중', filesRead: 7 }]);
    env.flow.add(1);
    env.flow.add(2);
    const queue = env.createQueue();
    await queue.start();
    await settle();

    expect(queue.progress({ kind: 'flow', targetId: 1 })).toEqual({ status: 'running', step: '첫째 파일 읽는 중', filesRead: 3 });
    expect(queue.progress({ kind: 'flow', targetId: 2 })).toEqual({ status: 'running', step: '둘째 파일 읽는 중', filesRead: 7 });
  });
});

describe('생성 대기열: 계정을 떠날 때와 돌아올 때', () => {
  it('Flow 계정을 떠나면 생성 중이던 Flow 실행은 끊기고 줄 서 있던 Flow 대상은 빠지며, 다른 종류의 대상은 그대로 돈다', async () => {
    const env = setup();
    env.setParallel(2);
    env.flow.add(1);
    env.second.add(10);
    env.executor.script({ outcome: 'wait-for-abort' });
    /** 둘째 어댑터의 실행을 끝내는 함수. */
    const finishSecond = env.holds();
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.flow.add(2);
    await settle();
    expect(queue.progress({ kind: 'flow', targetId: 2 })).toEqual({ status: 'waiting' });

    await queue.suspendKind('flow');
    await settle();

    expect(env.executor.requests[0]?.signal.aborted).toBe(true);
    // 앱을 끈 것과 같게 실행 기록만 남기고 생성 중으로 둔다.
    expect(env.flow.status(1)).toBe('generating');
    expect(env.flow.targets.get(1)?.runs.map((run) => run.result)).toEqual(['account-left']);
    expect(queue.progress({ kind: 'flow', targetId: 1 })).toBeNull();
    expect(queue.progress({ kind: 'flow', targetId: 2 })).toBeNull();
    // 떠나기 전의 대기열을 그대로 남겨, 그 계정의 줄로 보관되게 한다.
    expect(env.store.queue).toEqual([
      { kind: 'flow', targetId: 1, priority: 'resume' },
      { kind: 'second', targetId: 10, priority: 'resume' },
      { kind: 'flow', targetId: 2, priority: 'auto' },
    ]);
    // 떠나 있는 동안 생성 중이 된 Flow 대상도 시작하지 않는다.
    env.flow.add(3);
    await settle();
    expect(env.flow.prepared).toEqual([1]);
    expect(queue.progress({ kind: 'second', targetId: 10 })).toMatchObject({ status: 'running' });
    finishSecond({ type: 'completed', output: { answer: 'second' } });
    await settle();
    expect(env.second.status(10)).toBe('saved');
    expect(env.flow.prepared).toEqual([1]);
  });

  it('계정에 돌아오면 그 계정이 남긴 대기열의 Flow 줄이 그 순서와 자리로 먼저 서고, 끊긴 생성은 처음부터 다시 만든다', async () => {
    const env = setup();
    env.flow.add(1);
    env.flow.add(2);
    env.executor.script({ outcome: 'wait-for-abort' });
    const queue = env.createQueue();
    await queue.start();
    await settle();
    await queue.suspendKind('flow');
    await settle();

    // 다른 계정으로 갔다가 돌아왔다. 화면 순서는 2가 먼저지만, 남긴 대기열에서는 끊긴 1이 맨 앞이다.
    env.flow.targets.delete(1);
    env.flow.add(1);
    env.completes({ answer: 'flow-1' });
    env.completes({ answer: 'flow-2' });
    await queue.resumeKind('flow');
    await settle();

    expect(env.flow.prepared).toEqual([1, 1, 2]);
    expect(env.flow.status(1)).toBe('saved');
    expect(env.flow.status(2)).toBe('saved');
  });
});

/** 연장을 묻는 규칙. 처음 상한 20분, 한 번에 10분, 최대 60분, 5분 전에 묻고 마무리는 5분 기다린다. */
const MINUTE = 60_000;
function extensionPolicy(onAsk: () => void = () => {}): TimeExtensionPolicy {
  return {
    limitMs: 20 * MINUTE,
    stepMs: 10 * MINUTE,
    maxMs: 60 * MINUTE,
    askBeforeMs: 5 * MINUTE,
    wrapUpMs: 5 * MINUTE,
    extendedMessage: '10분이 더 있다',
    wrapUpMessage: '마무리해라',
    onAsk,
  };
}

/** 연장을 묻는 실행 하나를 내는 대본을 둘째 어댑터의 대상 10에 넣는다. 돌려준 함수로 실행 결과를 낸다. */
function startExtensionRun(env: ReturnType<typeof setup>, onAsk?: () => void) {
  env.second.add(10);
  env.second.scriptPreparation(10, {
    kind: 'ready',
    next: {
      kind: 'run',
      run: {
        ...fakeRun(),
        kind: 'diagnosis',
        request: async (model: string | null) => ({
          instructions: '지침',
          input: '입력',
          outputSchema: {},
          readRoots: [],
          secretPatterns: [],
          model,
          timeoutMs: 20 * MINUTE,
          timeExtension: extensionPolicy(onAsk),
        }),
      },
    },
  });
  return env.holds();
}

describe('생성 대기열: 시간 연장 묻기', () => {
  const target = { kind: 'second', targetId: 10 };

  it('연장을 묻는 실행에는 처음 상한 대신 가장 늦게 끊길 때까지의 시간을 넘기고, 전달이 되는 실행기에만 보내는 함수를 넘긴다', async () => {
    const env = setup({ steering: true });
    startExtensionRun(env);
    const queue = env.createQueue();
    await queue.start();
    await settle();

    expect(env.executor.requests[0]?.timeoutMs).toBe(65 * MINUTE);
    expect(env.executor.requests[0]?.onSteerable).toBeTypeOf('function');
    expect('timeExtension' in (env.executor.requests[0] ?? {})).toBe(false);
  });

  it('연장을 묻지 않는 실행은 규칙 없이 그대로 간다', async () => {
    const env = setup({ steering: true });
    env.flow.add(1);
    env.holds();
    const queue = env.createQueue();
    await queue.start();
    await settle();

    expect(env.executor.requests[0]?.timeoutMs).toBe(60_000);
    expect(env.executor.requests[0]?.onSteerable).toBeUndefined();
    env.clock.advance(30 * MINUTE);
    expect(queue.progress({ kind: 'flow', targetId: 1 })).toEqual({ status: 'running', step: '쓰는 중', filesRead: 0 });
  });

  it('상한 5분 전에 한 번 묻고, 묻는 동안 진행에 묻는 중과 전달 가능 여부가 보인다', async () => {
    const env = setup({ steering: true });
    let asked = 0;
    startExtensionRun(env, () => (asked += 1));
    const queue = env.createQueue();
    await queue.start();
    await settle();

    env.clock.advance(14 * MINUTE + 59_000);
    expect(asked).toBe(0);
    expect(queue.progress(target)).toMatchObject({ status: 'running' });
    expect(queue.progress(target)).not.toHaveProperty('extension');
    env.clock.advance(1_000);
    expect(asked).toBe(1);
    expect(queue.progress(target)).toMatchObject({ status: 'running', extension: { phase: 'asking', canSteer: true } });
  });

  it('[계속 진행]은 상한을 10분 늘리고 전달이 되는 실행기에 "10분이 더 있다"를 보내며, 새 상한 5분 전에 다시 묻는다', async () => {
    const env = setup({ steering: true });
    let asked = 0;
    startExtensionRun(env, () => (asked += 1));
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.clock.advance(15 * MINUTE);

    queue.answerTimeExtension(target, 'continue');
    expect(env.executor.sentMessages).toEqual(['10분이 더 있다']);
    expect(queue.progress(target)).not.toHaveProperty('extension');
    // 원래 상한(20분)을 지나도 끊기지 않는다.
    env.clock.advance(10 * MINUTE);
    expect(queue.progress(target)).toMatchObject({ status: 'running' });
    expect(asked).toBe(2);
    expect(queue.progress(target)).toMatchObject({ extension: { phase: 'asking' } });
  });

  it('[계속 진행]은 전달이 안 되는 실행기에는 아무것도 보내지 않고 상한만 늘린다', async () => {
    const env = setup({ steering: false });
    startExtensionRun(env);
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.clock.advance(15 * MINUTE);
    expect(queue.progress(target)).toMatchObject({ extension: { phase: 'asking', canSteer: false } });

    queue.answerTimeExtension(target, 'continue');
    expect(env.executor.sentMessages).toEqual([]);
    env.clock.advance(10 * MINUTE);
    expect(queue.progress(target)).toMatchObject({ status: 'running' });
  });

  it('합계가 60분이 되면 더는 묻지 않고 60분에 [멈추기]처럼 처리한다. 묻는 때는 15·25·35·45분이다', async () => {
    const env = setup({ steering: true });
    let asked = 0;
    const finish = startExtensionRun(env, () => (asked += 1));
    const queue = env.createQueue();
    await queue.start();
    await settle();

    for (const minute of [15, 25, 35, 45]) {
      env.clock.advance(minute * MINUTE - (env.clock.now() - NOW));
      expect(queue.progress(target)).toMatchObject({ extension: { phase: 'asking' } });
      queue.answerTimeExtension(target, 'continue');
    }
    expect(asked).toBe(4);
    // 55분이 되어도 묻지 않는다.
    env.clock.advance(10 * MINUTE);
    expect(asked).toBe(4);
    expect(queue.progress(target)).not.toHaveProperty('extension');
    expect(env.executor.sentMessages.filter((message) => message === '10분이 더 있다')).toHaveLength(4);
    // 60분에 마무리 메시지를 보낸다.
    env.clock.advance(5 * MINUTE);
    expect(env.executor.sentMessages.at(-1)).toBe('마무리해라');
    expect(queue.progress(target)).toMatchObject({ extension: { phase: 'wrapping-up' } });
    finish({ type: 'completed', output: { answer: 'wrapped' } });
    await settle();
    expect(env.second.status(10)).toBe('saved');
  });

  it('[멈추기]: 전달이 되는 실행기에 마무리 메시지를 보내고, 5분 안에 결과가 나오면 보통의 결과로 저장한다', async () => {
    const env = setup({ steering: true });
    const finish = startExtensionRun(env);
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.clock.advance(15 * MINUTE);

    queue.answerTimeExtension(target, 'stop');
    expect(env.executor.sentMessages).toEqual(['마무리해라']);
    expect(queue.progress(target)).toMatchObject({ extension: { phase: 'wrapping-up', canSteer: true } });
    env.clock.advance(4 * MINUTE);
    finish({ type: 'completed', output: { answer: 'wrapped' } });
    await settle();

    expect(env.second.status(10)).toBe('saved');
    expect(env.second.targets.get(10)?.result).toEqual({ answer: 'wrapped' });
  });

  it('[멈추기]: 마무리 5분 안에 결과가 나오지 않으면 끊고 시간 초과 실패가 된다', async () => {
    const env = setup({ steering: true });
    startExtensionRun(env);
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.clock.advance(15 * MINUTE);
    queue.answerTimeExtension(target, 'stop');
    env.clock.advance(5 * MINUTE - 1);
    await settle();
    expect(env.second.status(10)).toBe('generating');

    env.clock.advance(1);
    await settle();
    expect(env.second.status(10)).toBe('failed');
    expect(env.second.targets.get(10)?.failure).toMatchObject({ reason: 'timed-out', runKind: 'diagnosis' });
    expect(env.second.targets.get(10)?.runs.at(-1)?.result).toBe('timed-out');
  });

  it('[멈추기]: 전달이 안 되는 실행기는 바로 끊고 시간 초과 실패가 된다', async () => {
    const env = setup({ steering: false });
    startExtensionRun(env);
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.clock.advance(15 * MINUTE);

    queue.answerTimeExtension(target, 'stop');
    await settle();

    expect(env.second.status(10)).toBe('failed');
    expect(env.second.targets.get(10)?.failure).toMatchObject({ reason: 'timed-out' });
    expect(env.executor.sentMessages).toEqual([]);
  });

  it('답이 없으면 상한에 [멈추기]와 똑같이 처리한다: 전달이 되면 마무리를 기다리고, 안 되면 바로 끊는다', async () => {
    const steering = setup({ steering: true });
    startExtensionRun(steering);
    const steeringQueue = steering.createQueue();
    await steeringQueue.start();
    await settle();
    steering.clock.advance(19 * MINUTE + 59_000);
    expect(steeringQueue.progress(target)).toMatchObject({ extension: { phase: 'asking' } });
    steering.clock.advance(1_000);
    expect(steering.executor.sentMessages).toEqual(['마무리해라']);
    expect(steeringQueue.progress(target)).toMatchObject({ extension: { phase: 'wrapping-up' } });
    steering.clock.advance(5 * MINUTE);
    await settle();
    expect(steering.second.targets.get(10)?.failure).toMatchObject({ reason: 'timed-out' });

    const plain = setup({ steering: false });
    startExtensionRun(plain);
    const plainQueue = plain.createQueue();
    await plainQueue.start();
    await settle();
    plain.clock.advance(20 * MINUTE);
    await settle();
    expect(plain.second.targets.get(10)?.failure).toMatchObject({ reason: 'timed-out' });
  });

  it('묻는 중이 아닐 때 온 답과 끝난 실행에 온 답은 무시한다', async () => {
    const env = setup({ steering: true });
    const finish = startExtensionRun(env);
    const queue = env.createQueue();
    await queue.start();
    await settle();

    queue.answerTimeExtension(target, 'stop');
    queue.answerTimeExtension(target, 'continue');
    env.clock.advance(14 * MINUTE);
    expect(env.executor.sentMessages).toEqual([]);
    finish({ type: 'completed', output: { answer: 'done' } });
    await settle();
    queue.answerTimeExtension(target, 'stop');
    expect(env.second.status(10)).toBe('saved');
    expect(env.executor.sentMessages).toEqual([]);
  });

  it('묻는 중에 실행이 끝나면 예약이 지워져 나중에 아무 일도 일어나지 않는다', async () => {
    const env = setup({ steering: true });
    let asked = 0;
    const finish = startExtensionRun(env, () => (asked += 1));
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.clock.advance(15 * MINUTE);
    finish({ type: 'completed', output: { answer: 'early' } });
    await settle();
    env.clock.advance(60 * MINUTE);

    expect(asked).toBe(1);
    expect(env.second.status(10)).toBe('saved');
    expect(env.executor.sentMessages).toEqual([]);
  });

  it('마무리 중에 일시적 실패(구조화 출력 없음)로 끝나면 상한을 새로 세며 다시 실행하지 않고 그대로 실패한다. 마무리까지 가지 않은 일시적 실패는 다시 실행한다', async () => {
    // 첫 실행을 마무리 중 구조 실패로 끝내고, 다시 실행하면 쓸 결과를 미리 넣어 둔다.
    const early = setup({ steering: true });
    const finish = startExtensionRun(early);
    const earlyQueue = early.createQueue();
    await earlyQueue.start();
    await settle();
    early.clock.advance(15 * MINUTE);
    earlyQueue.answerTimeExtension(target, 'stop');
    early.completes({ answer: 'second' });
    finish({ type: 'invalid-output', detail: '구조화 출력 없음' });
    await settle();

    expect(early.executor.requests).toHaveLength(1);
    expect(early.second.status(10)).toBe('failed');
    expect(early.second.targets.get(10)?.failure).toMatchObject({ reason: 'invalid-output' });

    // 마무리까지 가지 않은 일시적 실패는 지금처럼 한 번 다시 실행한다.
    const plain = setup({ steering: true });
    const finishPlain = startExtensionRun(plain);
    const plainQueue = plain.createQueue();
    await plainQueue.start();
    await settle();
    plain.clock.advance(5 * MINUTE);
    plain.completes({ answer: 'retried' });
    finishPlain({ type: 'invalid-output', detail: '구조화 출력 없음' });
    await settle();
    expect(plain.executor.requests).toHaveLength(2);
    expect(plain.second.status(10)).toBe('saved');
  });

  it('사용자의 [취소]는 마무리를 기다리는 중에도 시간 초과가 아니라 취소함이다', async () => {
    const env = setup({ steering: true });
    startExtensionRun(env);
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.clock.advance(20 * MINUTE);
    await queue.cancel(target);
    await settle();

    expect(env.second.targets.get(10)?.failure).toMatchObject({ reason: 'cancelled' });
  });

  it('다시 켜서 처음부터 도는 실행은 상한을 처음부터 센다', async () => {
    const env = setup({ steering: true });
    startExtensionRun(env);
    const queue = env.createQueue();
    await queue.start();
    await settle();
    env.clock.advance(18 * MINUTE);
    // 앱을 끄고 다시 켠다. 끊긴 실행은 처음부터 다시 돈다.
    await queue.stop();
    await settle();
    env.second.scriptPreparation(10, {
      kind: 'ready',
      next: {
        kind: 'run',
        run: {
          ...fakeRun(),
          kind: 'diagnosis',
          request: async (model: string | null) => ({ instructions: '', input: '', outputSchema: {}, readRoots: [], secretPatterns: [], model, timeoutMs: 20 * MINUTE, timeExtension: extensionPolicy() }),
        },
      },
    });
    env.holds();
    const restarted = env.createQueue();
    await restarted.start();
    await settle();

    env.clock.advance(14 * MINUTE);
    expect(restarted.progress(target)).not.toHaveProperty('extension');
    env.clock.advance(1 * MINUTE);
    expect(restarted.progress(target)).toMatchObject({ extension: { phase: 'asking' } });
  });
});
