import type { QueuedTarget } from '../generation/generation-run';

/**
 * 생성 대기열 저장 포트. 대기열이 바뀔 때마다와 앱을 끌 때 남기고, 다시 켤 때 읽는다.
 * 대상의 종류와 상관없이 한 줄로 남겨, 다시 켜도 종류가 섞인 순서 그대로 돈다.
 */
export interface GenerationQueueStore {
  /** 마지막으로 남긴 생성 대기열. 앞에서부터 실행할 순서다. 남긴 것이 없으면 빈 배열이다. */
  getGenerationQueue(): Promise<QueuedTarget[]>;
  /** 생성 대기열을 남긴다. 앞서 남긴 것은 통째로 바꾼다. */
  setGenerationQueue(queue: readonly QueuedTarget[]): Promise<void>;
}
