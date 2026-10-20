/**
 * 맡은 일을 맡긴 순서대로 하나씩 한다. 앞 일이 실패해도 다음 일은 한다.
 * 같은 파일이나 같은 상태를 바꾸는 비동기 일이 서로 끼어들지 않게 할 때 쓴다.
 */
export class SerialQueue {
  /** 마지막으로 맡은 일. 다음 일은 이것이 끝난 뒤에 한다. */
  private last: Promise<unknown> = Promise.resolve();

  /** 앞서 맡은 일이 모두 끝난 뒤에 `task`를 한다. */
  run<T>(task: () => Promise<T>): Promise<T> {
    /** 이번 일. */
    const current = this.last.then(task);
    this.last = current.catch(() => {});
    return current;
  }
}
