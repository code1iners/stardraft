import { app } from 'electron';
import { createLogger, type Logger, type LogSink } from '../core/logging/logger';
import { RotatingFileSink } from '../core/logging/rotating-file-sink';
import { logsFolderPath } from './app-identity';

/** 로그 파일 하나의 크기 상한(바이트). */
const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024;
/** 남겨 둘 옛 로그 파일 수. 지금 파일까지 합쳐 최대 8MB다. */
const LOG_ARCHIVES = 3;

/** 소스 실행에서 로그를 터미널에도 보이는 출력. */
const consoleSink: LogSink = {
  write: (line) => process.stdout.write(line),
};

/** 앱 전체가 쓰는 진단 로거를 만든다. 로그 폴더가 정해진 뒤(`applyAppIdentity` 뒤)에 부른다. */
export function createAppLogger(): Logger {
  /** OS 표준 로그 폴더의 회전 파일. */
  const fileSink = new RotatingFileSink({
    directory: logsFolderPath(),
    maxBytes: LOG_FILE_MAX_BYTES,
    maxArchives: LOG_ARCHIVES,
  });
  return createLogger(app.isPackaged ? [fileSink] : [fileSink, consoleSink], Date.now);
}
