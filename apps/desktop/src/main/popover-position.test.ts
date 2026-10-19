import { describe, expect, it } from 'vitest';
import { popoverPosition } from './popover-position';

/** 테스트에 쓰는 작은 창 크기. */
const size = { width: 380, height: 520 };

describe('작은 창 위치', () => {
  it('macOS 메뉴 막대 아이콘 바로 아래 가운데에 놓는다', () => {
    const position = popoverPosition({
      trayBounds: { x: 1000, y: 0, width: 24, height: 24 },
      workArea: { x: 0, y: 25, width: 1440, height: 875 },
      windowSize: size,
    });

    expect(position).toEqual({ x: 822, y: 29 });
  });

  it('아이콘이 화면 오른쪽 끝에 붙어 있으면 창이 화면 밖으로 나가지 않게 당긴다', () => {
    const position = popoverPosition({
      trayBounds: { x: 1420, y: 0, width: 24, height: 24 },
      workArea: { x: 0, y: 25, width: 1440, height: 875 },
      windowSize: size,
    });

    expect(position).toEqual({ x: 1052, y: 29 });
  });

  it('Windows 아래쪽 작업 표시줄의 아이콘이면 작업 표시줄 위에 놓는다', () => {
    const position = popoverPosition({
      trayBounds: { x: 1790, y: 1036, width: 40, height: 40 },
      workArea: { x: 0, y: 0, width: 1920, height: 1032 },
      windowSize: size,
    });

    expect(position).toEqual({ x: 1532, y: 508 });
  });

  it('보조 모니터의 작업 영역 안에 놓는다', () => {
    const position = popoverPosition({
      trayBounds: { x: 3700, y: 1036, width: 40, height: 40 },
      workArea: { x: 1920, y: 0, width: 1920, height: 1032 },
      windowSize: size,
    });

    expect(position).toEqual({ x: 3452, y: 508 });
  });

  it('아이콘 위치를 알 수 없으면 마우스 포인터 근처에 놓는다', () => {
    const position = popoverPosition({
      trayBounds: { x: 0, y: 0, width: 0, height: 0 },
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      windowSize: size,
      cursor: { x: 500, y: 300 },
    });

    expect(position).toEqual({ x: 310, y: 304 });
  });
});
