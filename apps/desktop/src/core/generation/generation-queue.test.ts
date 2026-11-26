import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeExecutor } from '../fakes/fake-executor';
import { createLogger } from '../logging/logger';
import type { GenerationQueueStore } from '../ports/generation-queue-store';
import type { QueuedTarget, RunRecord } from './generation-run';
import { GenerationQueue } from './generation-queue';
import type { Preparation, TargetAdapter, TargetFailure } from './target-adapter';

/** 지금 시각. */
const NOW = Date.UTC(2026, 10, 26, 0, 0, 0);

/** 가짜 어댑터의 타입 묶음. 결과는 에이전트가 낸 출력 그대로이고, 저장소 대기 기록은 까닭 한 줄이다. */
interface FakeTypes {
  job: number;
  result: unknown;
  repoWait: string;
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
  readonly preparingStep = '준비 중';
  /** 대상. 넣은 순서가 화면 순서다. */
  readonly targets = new Map<number, FakeTarget>();
  /** 준비를 부른 대상 ID. 부른 순서다. */
  readonly prepared: number[] = [];
  /** 연결을 쓸 수 있는지 여부. */
  usable = true;
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
function setup() {
  const clock = new FakeClock(NOW);
  const logger = createLogger([{ write: () => {} }], clock);
  const executor = new FakeExecutor('claude-code');
  const flow = new FakeAdapter('flow');
  const second = new FakeAdapter('second');
  const store = new MemoryQueueStore();
  /** 에이전트를 쓸 수 있는지 여부와 바뀔 때 부를 함수. */
  const agent = { connected: true, listeners: new Set<() => void>() };
  /** 대기열을 만든다. 앱을 다시 켤 때처럼 같은 어댑터와 저장소로 새로 만들 수 있다. */
  const createQueue = () =>
    new GenerationQueue({
      adapters: [flow, second],
      agent: () => ({ executor, model: null, confirmForRun: async () => agent.connected }),
      onAgentChange: (listener) => {
        agent.listeners.add(listener);
        return () => agent.listeners.delete(listener);
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
  /** 실행 하나를 출력 `output`으로 끝나게 대본을 넣는다. */
  const completes = (output: unknown) => executor.script({ outcome: { type: 'completed', output } });
  return { clock, executor, flow, second, store, createQueue, setConnected, completes };
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
