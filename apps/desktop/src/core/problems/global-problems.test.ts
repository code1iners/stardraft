import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger } from '../logging/logger';
import { GlobalProblems, type GlobalProblem } from './global-problems';

/** 시작 시각. */
const START = Date.UTC(2026, 9, 20, 9, 0, 0);
/** Flow가 키를 거부한 문제. */
const KEY_REJECTED: GlobalProblem = { cause: 'flow-key', reason: 'rejected' };
/** 저장된 키를 읽을 수 없는 문제. */
const KEY_UNREADABLE: GlobalProblem = { cause: 'flow-key', reason: 'unreadable' };

/** 가짜 시계와 기록만 하는 알림 포트로 전역 문제를 만든다. 알림 문구는 원인과 이유를 그대로 적는다. */
function setup() {
  const clock = new FakeClock(START);
  const notifier = new RecordingNotifier();
  const problems = new GlobalProblems({
    notifier,
    clock,
    logger: createLogger([], clock),
    notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }),
  });
  return { clock, notifier, problems };
}

describe('전역 문제', () => {
  it('문제가 생기면 그 문제가 맨 앞 전역 문제가 되고 OS 알림이 한 번 뜬다', () => {
    const { notifier, problems } = setup();

    problems.raise(KEY_REJECTED);

    expect(problems.current()).toEqual({ problem: KEY_REJECTED, since: START });
    expect(notifier.sent).toEqual([{ title: 'flow-key', body: 'rejected' }]);
  });

  it('같은 원인이 해결되기 전에 다시 생기면 시간이 지나도 알림을 다시 띄우지 않고 처음 생긴 시각을 유지한다', () => {
    const { clock, notifier, problems } = setup();
    problems.raise(KEY_REJECTED);

    clock.advance(60 * 60 * 1000);
    problems.raise(KEY_REJECTED);
    clock.advance(24 * 60 * 60 * 1000);
    problems.raise(KEY_UNREADABLE);

    expect(notifier.sent).toHaveLength(1);
    expect(problems.current()).toEqual({ problem: KEY_UNREADABLE, since: START });
  });

  it('해결되면 전역 문제가 사라지고, 해결된 뒤 다시 생기면 알림을 다시 띄운다', () => {
    const { clock, notifier, problems } = setup();
    problems.raise(KEY_REJECTED);

    clock.advance(5_000);
    problems.resolve('flow-key');
    expect(problems.current()).toBeNull();

    clock.advance(5_000);
    problems.raise(KEY_REJECTED);

    expect(notifier.sent).toHaveLength(2);
    expect(problems.current()).toEqual({ problem: KEY_REJECTED, since: START + 10_000 });
  });

  it('없는 문제를 해결해도 아무 일도 없다', () => {
    const { notifier, problems } = setup();
    /** 바뀐 상태를 받은 횟수. */
    let changes = 0;
    problems.onChange(() => (changes += 1));

    problems.resolve('flow-key');

    expect(changes).toBe(0);
    expect(notifier.sent).toEqual([]);
  });

  it('보이는 내용이 바뀔 때만 듣는 쪽에 알린다', () => {
    const { problems } = setup();
    /** 받은 맨 앞 전역 문제. */
    const received: (GlobalProblem | null)[] = [];
    problems.onChange((current) => received.push(current?.problem ?? null));

    problems.raise(KEY_REJECTED);
    problems.raise(KEY_REJECTED);
    problems.raise(KEY_UNREADABLE);
    problems.resolve('flow-key');

    expect(received).toEqual([KEY_REJECTED, KEY_UNREADABLE, null]);
  });
});
