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
