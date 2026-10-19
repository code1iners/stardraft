import { describe, expect, it } from 'vitest';
import type { ExecutorProgress, ExecutorRunRequest } from '../ports/executor';
import { FakeExecutor } from './fake-executor';

/** 테스트용 초안 실행 입력. */
function draftRequest(overrides: Partial<ExecutorRunRequest> = {}): ExecutorRunRequest {
  return {
    kind: 'draft',
    prompt: '가짜 맥락',
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

    const outcome = await executor.run(draftRequest({ onProgress: (progress) => seen.push(progress) }));

    expect(seen.map((progress) => progress.step)).toEqual(['저장소 구조 확인', 'src/retry.ts 읽는 중']);
    expect(outcome).toEqual({ type: 'completed', output: { draft: '세 번 재시도합니다.' } });
    expect(executor.requests.map((request) => request.kind)).toEqual(['draft']);
  });

  it('취소를 기다리는 대본은 중단 신호가 오면 취소로 끝난다', async () => {
    const executor = new FakeExecutor('claude-code');
    executor.script({ outcome: 'wait-for-abort' });
    const controller = new AbortController();

    const running = executor.run(draftRequest({ signal: controller.signal }));
    controller.abort();

    await expect(running).resolves.toEqual({ type: 'cancelled' });
  });

  it('대본이 없으면 실행을 거부한다', async () => {
    const executor = new FakeExecutor('codex');

    await expect(executor.run(draftRequest())).rejects.toThrow('대본');
  });
});
