import type { Clock } from '../ports/clock';

/**
 * 진단 로그 규약.
 *
 * - 사건 이름은 `poll.finished`처럼 고정 문자열로 쓰고, 값은 필드로 넘긴다. 문장에 값을 섞지 않는다.
 * - 필드 값은 문자열·숫자·참거짓·`null`만 받는다. Flow 응답이나 초안 같은 객체를 통째로 남길 수 없다.
 * - 남기는 것은 ID, 개수, 길이, 상태, 응답 코드, 경로다. API 키와 Flow 글 본문(제목, 본문, 댓글, 초안, 지침)은 남기지 않는다.
 * - 이름이 본문·비밀값을 뜻하는 필드는 값을 가리고, 긴 문자열은 자른다. 실수로 넘긴 값이 그대로 남지 않게 하는 마지막 방어선이다.
 * - 오류 메시지(`errorFields`)는 그대로 남는다. 그래서 Flow 응답이나 에이전트 출력을 다루는 코드는 본문을 오류 메시지에 넣지 않는다.
 */

/** 로그 수준. */
export type LogLevel = 'info' | 'warn' | 'error';

/** 로그 필드 값. 객체는 받지 않는다. */
export type LogValue = string | number | boolean | null;

/** 사건 하나에 붙이는 필드. */
export type LogFields = Readonly<Record<string, LogValue>>;

/** 진단 로그를 남기는 쪽이 쓰는 인터페이스. */
export interface Logger {
  /** 정상 흐름의 사건. */
  info(event: string, fields?: LogFields): void;
  /** 스스로 회복하는 문제. */
  warn(event: string, fields?: LogFields): void;
  /** 회복하지 못한 문제. */
  error(event: string, fields?: LogFields): void;
}

/** 완성된 로그 한 줄을 받아 어딘가에 쓰는 출력. */
export interface LogSink {
  /** 줄바꿈으로 끝나는 한 줄을 쓴다. */
  write(line: string): void;
}

/** 가린 값 대신 남기는 표시. */
const REDACTED = '[redacted]';
/** 문자열 필드 값의 최대 길이. 넘으면 자른다. */
const MAX_VALUE_LENGTH = 200;
/** 필드 이름에 들어 있으면 값을 가리는 낱말. 비밀값이나 글 본문을 담는 이름이다. */
const SENSITIVE_WORDS = new Set([
  'key',
  'apikey',
  'token',
  'secret',
  'password',
  'authorization',
  'cookie',
  'content',
  'contents',
  'body',
  'text',
  'title',
  'draft',
  'prompt',
  'instruction',
  'instructions',
  'input',
  'output',
  'stdout',
  'stderr',
]);
/** 필드 이름이 이 낱말로 끝나면 본문이 아니라 식별자·수치로 보고 남긴다. */
const SAFE_LAST_WORDS = new Set(['id', 'ids', 'count', 'length', 'chars', 'bytes']);

/** 출력 목록에 로그를 쓰는 로거를 만든다. 시각은 시계 포트에서 읽는다. */
export function createLogger(sinks: readonly LogSink[], clock: Pick<Clock, 'now'>): Logger {
  /** 사건 하나를 한 줄로 만들어 모든 출력에 쓴다. */
  const write = (level: LogLevel, event: string, fields: LogFields = {}) => {
    /** 남길 한 줄. 필드가 시각·수준·사건 이름을 덮어쓰지 못하게 필드를 먼저 펼친다. */
    const line = `${JSON.stringify({ ...sanitizeFields(fields), time: new Date(clock.now()).toISOString(), level, event })}\n`;
    for (const sink of sinks) {
      // 로그를 못 남겨도 앱은 계속 돈다.
      try {
        sink.write(line);
      } catch {
        // 다른 출력에는 계속 쓴다.
      }
    }
  };

  return {
    info: (event, fields) => write('info', event, fields),
    warn: (event, fields) => write('warn', event, fields),
    error: (event, fields) => write('error', event, fields),
  };
}

/** 오류를 로그 필드로 바꾼다. 스택은 남기지 않는다. */
export function errorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    /** Node 오류의 코드(`ENOENT` 등). */
    const code = (error as { code?: unknown }).code;
    return {
      errorName: error.name,
      errorCode: typeof code === 'string' || typeof code === 'number' ? String(code) : null,
      errorMessage: error.message,
    };
  }
  return { errorName: 'unknown', errorCode: null, errorMessage: String(error) };
}

/** 민감한 이름의 필드 값을 가리고 긴 문자열을 자른다. */
function sanitizeFields(fields: LogFields): Record<string, LogValue> {
  /** 정리한 필드. */
  const sanitized: Record<string, LogValue> = {};
  for (const [name, value] of Object.entries(fields)) {
    if (isSensitiveFieldName(name)) {
      sanitized[name] = REDACTED;
    } else if (typeof value === 'string' && value.length > MAX_VALUE_LENGTH) {
      sanitized[name] = `${value.slice(0, MAX_VALUE_LENGTH)}…(${value.length}자 중 일부)`;
    } else {
      sanitized[name] = value;
    }
  }
  return sanitized;
}

/** 필드 이름이 비밀값이나 글 본문을 뜻하는지 본다. `draftText`, `api_key`처럼 낱말로 나눠 검사한다. */
function isSensitiveFieldName(name: string): boolean {
  /** camelCase·snake_case·kebab-case를 나눈 소문자 낱말. */
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .map((word) => word.toLowerCase())
    .filter(Boolean);
  /** 마지막 낱말. */
  const lastWord = words.at(-1);
  if (lastWord && SAFE_LAST_WORDS.has(lastWord)) return false;
  return words.some((word) => SENSITIVE_WORDS.has(word));
}
