import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RotatingFileSink } from './rotating-file-sink';

/** 테스트마다 만드는 임시 폴더. */
let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'stardraft-log-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 10바이트짜리 로그 한 줄. */
function line(n: number): string {
  return `line-${String(n).padStart(3, '0')}\n`;
}

describe('회전하는 로그 파일', () => {
  it('로그 폴더가 없으면 만들고 줄을 이어 쓴다', () => {
    const directory = join(root, 'logs');
    const sink = new RotatingFileSink({ directory, maxBytes: 1_000, maxArchives: 2 });

    sink.write(line(1));
    sink.write(line(2));

    expect(readFileSync(join(directory, 'main.log'), 'utf8')).toBe(line(1) + line(2));
  });

  it('크기 상한을 넘기기 전에 옛 파일로 돌리고, 정한 개수보다 오래된 파일은 지운다', () => {
    const sink = new RotatingFileSink({ directory: root, maxBytes: 25, maxArchives: 2 });

    for (let n = 1; n <= 7; n += 1) sink.write(line(n));

    expect(readdirSync(root).sort()).toEqual(['main.1.log', 'main.2.log', 'main.log']);
    expect(readFileSync(join(root, 'main.log'), 'utf8')).toBe(line(7));
    expect(readFileSync(join(root, 'main.1.log'), 'utf8')).toBe(line(5) + line(6));
    expect(readFileSync(join(root, 'main.2.log'), 'utf8')).toBe(line(3) + line(4));
  });

  it('다시 켜도 이미 있는 파일 크기를 세어 상한을 지킨다', () => {
    new RotatingFileSink({ directory: root, maxBytes: 25, maxArchives: 2 }).write(line(1) + line(2));

    new RotatingFileSink({ directory: root, maxBytes: 25, maxArchives: 2 }).write(line(3));

    expect(readFileSync(join(root, 'main.log'), 'utf8')).toBe(line(3));
    expect(readFileSync(join(root, 'main.1.log'), 'utf8')).toBe(line(1) + line(2));
  });
});
