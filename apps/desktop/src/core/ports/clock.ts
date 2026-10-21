/** 예약한 일을 취소하는 함수. 이미 실행됐거나 취소된 뒤에 불러도 아무 일도 하지 않는다. */
export type CancelScheduled = () => void;

/**
 * 시계 포트.
 * 폴링 주기, 72시간 범위, 게시 카운트다운처럼 시간에 기대는 규칙은 이 포트로만 시간을 읽고 기다린다.
 * 그래야 테스트에서 가짜 시계를 돌려 검사할 수 있다.
 */
export interface Clock {
  /** 지금 시각(Unix epoch 밀리초). */
  now(): number;
  /** `delayMs` 뒤에 `callback`을 한 번 부른다. */
  after(delayMs: number, callback: () => void): CancelScheduled;
}

/**
 * `task`가 끝나기를 시계로 잰 `limitMs`까지만 기다린다. 시간이 지나도 `task`는 멈추지 않고 그대로 이어진다.
 * `task`가 실패해도 기다림은 끝난 것으로 본다. 앱을 끝낼 때 진행 중인 일을 잠깐만 기다려 줄 때 쓴다.
 */
export async function waitAtMost(clock: Clock, task: Promise<unknown>, limitMs: number): Promise<void> {
  /** 기다리는 시간의 끝 예약을 지우는 함수. */
  let cancel: CancelScheduled = () => {};
  await Promise.race([task.then(noop, noop), new Promise<void>((resolve) => (cancel = clock.after(limitMs, resolve)))]);
  cancel();
}

/** 아무것도 하지 않는다. */
function noop(): void {}
