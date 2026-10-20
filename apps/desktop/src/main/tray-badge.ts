/** 배지의 빨강(BGRA). 화면의 위험 색과 같다. */
const BADGE_RED = [0x18, 0x23, 0xb4, 0xff] as const;
/** "!"의 흰색(BGRA). */
const MARK_WHITE = [0xff, 0xff, 0xff, 0xff] as const;
/** 투명. */
const CLEAR = [0, 0, 0, 0] as const;

/*
 * 16px 아이콘 기준의 배지 모양. 큰 아이콘은 같은 비율로 키운다.
 * 오른쪽 아래 지름 10px 원 안에 폭 2px의 "!"(막대 4px, 1px 띄우고 점 2px)를 두고, 원 둘레 1px을 비운다.
 */
/** 배지 원의 중심(x, y 같음). */
const CENTER = 11;
/** 배지 원의 반지름. */
const RADIUS = 5;
/** 배지 둘레에서 아이콘을 비우는 폭. */
const RING = 1;
/** "!"의 왼쪽과 오른쪽 끝. */
const MARK_X = [10, 12] as const;
/** "!" 막대의 위와 아래 끝. */
const BAR_Y = [8, 12] as const;
/** "!" 점의 위와 아래 끝. */
const DOT_Y = [13, 15] as const;

/**
 * 정사각형 트레이 아이콘 비트맵에 전역 문제 "!" 배지를 그린 사본을 돌려준다. Windows 트레이에 쓴다.
 * 비트맵은 Electron `nativeImage.toBitmap()`이 주는 premultiplied BGRA다. 완전히 불투명하거나 투명한 픽셀만 쓰므로 premultiply를 따로 하지 않는다.
 */
export function drawAlertBadge(bitmap: Uint8Array, size: number): Uint8Array {
  /** 배지를 그린 사본. */
  const badged = Uint8Array.from(bitmap);
  /** 16px 기준 1px의 크기. */
  const unit = size / 16;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 픽셀 중심으로 모양 안팎을 가른다.
      /** 픽셀 중심의 16px 기준 좌표. */
      const px = (x + 0.5) / unit;
      const py = (y + 0.5) / unit;
      /** 배지 중심까지의 거리. */
      const distance = Math.hypot(px - CENTER, py - CENTER);
      if (distance > RADIUS + RING) continue;

      /** 이 픽셀에 칠할 색. */
      const color = distance > RADIUS ? CLEAR : isMark(px, py) ? MARK_WHITE : BADGE_RED;
      badged.set(color, (y * size + x) * 4);
    }
  }
  return badged;
}

/** 16px 기준 좌표가 "!" 안인지 본다. */
function isMark(px: number, py: number): boolean {
  if (px < MARK_X[0] || px > MARK_X[1]) return false;
  return (py >= BAR_Y[0] && py <= BAR_Y[1]) || (py >= DOT_Y[0] && py <= DOT_Y[1]);
}
