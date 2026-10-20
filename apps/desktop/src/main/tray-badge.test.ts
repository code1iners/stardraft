import { describe, expect, it } from 'vitest';
import { drawAlertBadge, drawSetupDot } from './tray-badge';

/** 칠한 아이콘의 회색(BGRA). */
const GRAY = [0x80, 0x80, 0x80, 0xff];
/** 배지의 빨강(BGRA). */
const RED = [0x18, 0x23, 0xb4, 0xff];
/** "!"의 흰색(BGRA). */
const WHITE = [0xff, 0xff, 0xff, 0xff];
/** "설정 필요" 점의 노랑(BGRA). */
const YELLOW = [0x00, 0x8a, 0xd0, 0xff];
/** 투명. */
const CLEAR = [0, 0, 0, 0];

/** 모든 픽셀이 회색인 `size`×`size` BGRA 비트맵. */
function grayIcon(size: number): Uint8Array {
  return Uint8Array.from({ length: size * size * 4 }, (_, index) => GRAY[index % 4] ?? 0);
}

/** 비트맵의 (`x`, `y`) 픽셀. */
function pixelAt(bitmap: Uint8Array, size: number, x: number, y: number): number[] {
  /** 픽셀이 시작하는 바이트. */
  const offset = (y * size + x) * 4;
  return Array.from(bitmap.subarray(offset, offset + 4));
}

describe('Windows 트레이 "!" 배지', () => {
  it('16px 아이콘의 오른쪽 아래에 흰 "!"가 든 빨간 배지를 그리고, 배지 둘레를 비워 아이콘과 떼어 놓는다', () => {
    const badged = drawAlertBadge(grayIcon(16), 16);

    expect(pixelAt(badged, 16, 10, 9)).toEqual(WHITE);
    expect(pixelAt(badged, 16, 11, 13)).toEqual(WHITE);
    expect(pixelAt(badged, 16, 10, 12)).toEqual(RED);
    expect(pixelAt(badged, 16, 7, 11)).toEqual(RED);
    expect(pixelAt(badged, 16, 14, 8)).toEqual(RED);
    expect(pixelAt(badged, 16, 5, 11)).toEqual(CLEAR);
    expect(pixelAt(badged, 16, 0, 0)).toEqual(GRAY);
    expect(pixelAt(badged, 16, 15, 0)).toEqual(GRAY);
  });

  it('32px 아이콘에는 같은 자리에 두 배 크기로 그린다', () => {
    const badged = drawAlertBadge(grayIcon(32), 32);

    expect(pixelAt(badged, 32, 21, 19)).toEqual(WHITE);
    expect(pixelAt(badged, 32, 14, 22)).toEqual(RED);
    expect(pixelAt(badged, 32, 0, 0)).toEqual(GRAY);
  });

  it('받은 비트맵은 바꾸지 않는다', () => {
    const icon = grayIcon(16);

    drawAlertBadge(icon, 16);

    expect(icon).toEqual(grayIcon(16));
  });
});

describe('Windows 트레이 노란 점("설정 필요")', () => {
  it('16px 아이콘의 오른쪽 아래에 "!" 없는 노란 점을 그리고, 둘레를 비워 아이콘과 떼어 놓는다', () => {
    const dotted = drawSetupDot(grayIcon(16), 16);

    expect(pixelAt(dotted, 16, 11, 11)).toEqual(YELLOW);
    expect(pixelAt(dotted, 16, 10, 9)).toEqual(YELLOW);
    expect(pixelAt(dotted, 16, 14, 11)).toEqual(YELLOW);
    expect(pixelAt(dotted, 16, 5, 11)).toEqual(CLEAR);
    expect(pixelAt(dotted, 16, 0, 0)).toEqual(GRAY);
  });
});
