import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LogSink } from './logger';

/** 회전하는 로그 파일 설정. */
export interface RotatingFileSinkOptions {
  /** 로그 폴더. 없으면 만든다. */
  directory: string;
  /** 지금 쓰는 파일의 크기 상한(바이트). 넘기기 전에 옛 파일로 돌린다. */
  maxBytes: number;
  /** 남겨 둘 옛 파일 수. 더 오래된 파일은 지운다. */
  maxArchives: number;
}

/**
 * 크기 상한으로 회전하는 로그 파일 출력. 지금 파일은 `main.log`, 옛 파일은 `main.1.log`, `main.2.log`다.
 * 로그는 짧고 드물어서 동기로 쓴다. 앱이 갑자기 끝나도 직전 줄까지 남고 줄 순서가 섞이지 않는다.
 */
export class RotatingFileSink implements LogSink {
  /** 로그 폴더. */
  private readonly directory: string;
  /** 크기 상한(바이트). */
  private readonly maxBytes: number;
  /** 남겨 둘 옛 파일 수. */
  private readonly maxArchives: number;
  /** 지금 파일의 크기. 처음 쓸 때 파일에서 읽는다. */
  private currentBytes: number | null = null;

  constructor({ directory, maxBytes, maxArchives }: RotatingFileSinkOptions) {
    this.directory = directory;
    this.maxBytes = maxBytes;
    this.maxArchives = maxArchives;
  }

  write(line: string): void {
    /** 이번 줄의 바이트 수. */
    const lineBytes = Buffer.byteLength(line);
    if (this.currentBytes === null) {
      mkdirSync(this.directory, { recursive: true });
      this.currentBytes = fileSize(this.filePath(0));
    }

    // 빈 파일에는 상한보다 긴 줄도 그대로 쓴다. 그래야 줄 하나가 무한히 회전시키지 않는다.
    if (this.currentBytes > 0 && this.currentBytes + lineBytes > this.maxBytes) {
      this.rotate();
      this.currentBytes = 0;
    }

    appendFileSync(this.filePath(0), line);
    this.currentBytes += lineBytes;
  }

  /** 지금 파일을 `.1`로, `.1`을 `.2`로 밀고 가장 오래된 파일을 지운다. */
  private rotate(): void {
    rmSync(this.filePath(this.maxArchives), { force: true });
    for (let index = this.maxArchives - 1; index >= 0; index -= 1) {
      try {
        renameSync(this.filePath(index), this.filePath(index + 1));
      } catch {
        // 그 번호의 파일이 아직 없다.
      }
    }
  }

  /** 번호에 맞는 로그 파일 경로. 0은 지금 쓰는 파일이다. */
  private filePath(index: number): string {
    return join(this.directory, index === 0 ? 'main.log' : `main.${index}.log`);
  }
}

/** 파일 크기. 파일이 없으면 0이다. */
function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
