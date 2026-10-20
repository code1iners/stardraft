import { describe, expect, it } from 'vitest';
import { createLogger, errorFields, type LogSink } from './logger';

/** 쓴 줄을 모아 두는 진단 로그 출력. */
class LineCollector implements LogSink {
  /** 받은 줄. */
  lines: string[] = [];

  write(line: string): void {
    this.lines.push(line);
  }

  /** 받은 줄을 JSON으로 푼 것. */
  records(): Record<string, unknown>[] {
    return this.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

describe('진단 로그 규약', () => {
  it('한 줄에 시각, 수준, 사건 이름, 필드를 JSON으로 남긴다', () => {
    const sink = new LineCollector();
    const logger = createLogger([sink], () => Date.UTC(2026, 9, 20, 1, 2, 3));

    logger.info('poll.finished', { postId: '1001', newMentions: 2, retried: false });

    expect(sink.lines).toHaveLength(1);
    expect(sink.lines[0]?.endsWith('\n')).toBe(true);
    expect(sink.records()).toEqual([
      {
        time: '2026-10-20T01:02:03.000Z',
        level: 'info',
        event: 'poll.finished',
        postId: '1001',
        newMentions: 2,
        retried: false,
      },
    ]);
  });

  it('API 키와 글 본문을 담을 만한 필드는 값을 가린다', () => {
    const sink = new LineCollector();
    const logger = createLogger([sink], () => 0);

    logger.warn('flow.request-failed', {
      apiKey: 'fake-api-key-0000',
      authorization: 'Bearer fake-token',
      content: '가짜 게시물 본문',
      commentContents: '가짜 댓글 본문',
      draftText: '가짜 초안',
      title: '가짜 제목',
      extraInstructions: '가짜 지침',
    });

    /** 남은 로그 줄. */
    const line = sink.lines[0] ?? '';
    expect(line).not.toContain('fake-api-key-0000');
    expect(line).not.toContain('fake-token');
    expect(line).not.toContain('가짜');
    expect(sink.records()[0]).toMatchObject({
      apiKey: '[redacted]',
      authorization: '[redacted]',
      content: '[redacted]',
      commentContents: '[redacted]',
      draftText: '[redacted]',
      title: '[redacted]',
      extraInstructions: '[redacted]',
    });
  });

  it('ID·개수·길이 필드는 이름에 본문 관련 낱말이 들어 있어도 남긴다', () => {
    const sink = new LineCollector();
    const logger = createLogger([sink], () => 0);

    logger.info('draft.saved', { commentId: '2002', replyId: '-1', draftLength: 120, contentChars: 3000 });

    expect(sink.records()[0]).toMatchObject({ commentId: '2002', replyId: '-1', draftLength: 120, contentChars: 3000 });
  });

  it('긴 문자열 값은 잘라서 남긴다', () => {
    const sink = new LineCollector();
    const logger = createLogger([sink], () => 0);

    logger.error('agent.failed', { detail: 'x'.repeat(1_000) });

    /** 남은 detail 값. */
    const detail = sink.records()[0]?.detail as string;
    expect(detail.length).toBeLessThan(260);
    expect(detail.endsWith('…(1000자 중 일부)')).toBe(true);
  });

  it('필드가 시각·수준·사건 이름을 덮어쓰지 못한다', () => {
    const sink = new LineCollector();
    const logger = createLogger([sink], () => 0);

    logger.info('app.started', { event: 'other', level: 'error' });

    expect(sink.records()[0]).toMatchObject({ event: 'app.started', level: 'info' });
  });

  it('출력 하나가 실패해도 다른 출력에는 남기고 앱을 멈추지 않는다', () => {
    const broken: LogSink = {
      write: () => {
        throw new Error('disk full');
      },
    };
    const sink = new LineCollector();
    const logger = createLogger([broken, sink], () => 0);

    expect(() => logger.info('app.started')).not.toThrow();
    expect(sink.records()).toHaveLength(1);
  });

  it('오류는 이름·코드·메시지만 필드로 바꾼다', () => {
    const error = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });

    expect(errorFields(error)).toEqual({
      errorName: 'Error',
      errorCode: 'EACCES',
      errorMessage: 'EACCES: permission denied',
    });
    expect(errorFields('문자열 오류')).toEqual({ errorName: 'unknown', errorCode: null, errorMessage: '문자열 오류' });
  });
});
