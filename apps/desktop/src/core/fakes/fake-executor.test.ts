import { describe, expect, it } from 'vitest';
import type { ExecutorProgress, ExecutorRunRequest } from '../ports/executor';
import { FakeExecutor } from './fake-executor';

/** 테스트용 초안 실행 입력. */
function draftRequest(overrides: Partial<ExecutorRunRequest> = {}): ExecutorRunRequest {
  return {
    kind: 'draft',
    instructions: '가짜 지침',
    input: '가짜 맥락',
    outputSchema: { type: 'object' },
    readRoots: ['/tmp/fake-repo'],
    secretPatterns: ['.env'],
    model: null,
    timeoutMs: 600_000,
    signal: new AbortController().signal,
    onProgress: () => {},
    ...overrides,
  };
}

describe('가짜 실행기', () => {
  it('대본대로 진행 단계를 알리고 구조화 출력을 돌려준다', async () => {
    const executor = new FakeExecutor('claude-code');
    executor.script({
      progress: [
        { step: '저장소 구조 확인', filesRead: 0 },
        { step: 'src/retry.ts 읽는 중', filesRead: 1 },
      ],
      outcome: { type: 'completed', output: { draft: '세 번 재시도합니다.' } },
    });
    const seen: ExecutorProgress[] = [];

    const report = await executor.run(draftRequest({ onProgress: (progress) => seen.push(progress) }));

    expect(seen.map((progress) => progress.step)).toEqual(['저장소 구조 확인', 'src/retry.ts 읽는 중']);
    expect(report).toEqual({ outcome: { type: 'completed', output: { draft: '세 번 재시도합니다.' } }, cliVersion: null, model: null, usage: null });
    expect(executor.requests.map((request) => request.kind)).toEqual(['draft']);
  });

  it('대본에 준 CLI 버전·모델·사용량을 실행 보고에 담는다', async () => {
    const executor = new FakeExecutor('claude-code');
    executor.script({
      outcome: { type: 'timed-out' },
      report: { cliVersion: '2.1.303', model: 'claude-fake-model', usage: { costUsd: 0.5, inputTokens: 10, outputTokens: 2 } },
    });

    expect(await executor.run(draftRequest())).toEqual({
      outcome: { type: 'timed-out' },
      cliVersion: '2.1.303',
      model: 'claude-fake-model',
      usage: { costUsd: 0.5, inputTokens: 10, outputTokens: 2 },
    });
  });

  it('취소를 기다리는 대본은 중단 신호가 오면 취소로 끝난다', async () => {
    const executor = new FakeExecutor('claude-code');
    executor.script({ outcome: 'wait-for-abort' });
    const controller = new AbortController();

    const running = executor.run(draftRequest({ signal: controller.signal }));
    controller.abort();

    await expect(running).resolves.toMatchObject({ outcome: { type: 'cancelled' } });
  });

  it('약속으로 준 결과는 약속이 풀릴 때 돌려주고, 그 전에 중단 신호가 오면 취소로 끝난다', async () => {
    const executor = new FakeExecutor('claude-code');
    /** 결과를 풀어 줄 함수. */
    let release: (outcome: { type: 'timed-out' }) => void = () => {};
    executor.script({ outcome: new Promise((resolve) => (release = resolve)) });
    executor.script({ outcome: new Promise(() => {}) });
    const controller = new AbortController();

    const first = executor.run(draftRequest());
    release({ type: 'timed-out' });
    await expect(first).resolves.toMatchObject({ outcome: { type: 'timed-out' } });

    const second = executor.run(draftRequest({ signal: controller.signal }));
    controller.abort();
    await expect(second).resolves.toMatchObject({ outcome: { type: 'cancelled' } });
  });

  it('대본이 없으면 실행을 거부한다', async () => {
    const executor = new FakeExecutor('codex');

    await expect(executor.run(draftRequest())).rejects.toThrow('대본');
  });
});
