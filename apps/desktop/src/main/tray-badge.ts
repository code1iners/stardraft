/** 배지의 빨강(BGRA). 화면의 위험 색과 같다. */
const BADGE_RED = [0x18, 0x23, 0xb4, 0xff] as const;
/** "설정 필요" 점의 노랑(BGRA). 온보딩 프로토타입의 노란 점 색이다. */
const SETUP_YELLOW = [0x00, 0x8a, 0xd0, 0xff] as const;
/** 숫자 배지의 파랑(BGRA). 화면의 강조 색과 같다. */
const BADGE_BLUE = [0xc4, 0x60, 0x21, 0xff] as const;
/** 생성 중 배지의 짙은 회색(BGRA). 화면의 생성 중 태그 글자색과 같다. */
const GENERATING_DARK = [0x55, 0x4f, 0x4a, 0xff] as const;
/** "!"와 숫자의 흰색(BGRA). */
const MARK_WHITE = [0xff, 0xff, 0xff, 0xff] as const;
/** 투명. */
const CLEAR = [0, 0, 0, 0] as const;

// 배지와 점 모양은 16px 아이콘 기준이고, 큰 아이콘은 같은 비율로 키운다.
// 오른쪽 아래 지름 10px 원 안에 폭 2px의 "!"(막대 4px, 1px 띄우고 점 2px)를 두고, 원 둘레 1px을 비운다.
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
/** 생성 중 배지의 점 세 개가 시작하는 열. 점마다 2px이고 사이를 1px 띄운다. */
const GENERATING_DOT_X = [7, 10, 13] as const;
/** 생성 중 배지의 점 세 개의 위와 아래 끝. */
const GENERATING_DOT_Y = [10, 12] as const;

// 숫자 배지는 3픽셀 폭 글자가 픽셀 칸에 맞아 가운데 오도록 "!" 배지보다 원을 반 픽셀 옮기고 줄였다(지름 9px).
/** 숫자 배지 원의 중심(x, y 같음). */
const COUNT_CENTER = 11.5;
/** 숫자 배지 원의 반지름. */
const COUNT_RADIUS = 4.5;
/** 글자의 위쪽 끝. */
const GLYPH_TOP = 9;
/** 글자 하나의 폭. 글자 사이는 1px 띄운다. */
const GLYPH_WIDTH = 3;
/** 3×5 픽셀 글꼴. 줄마다 왼쪽부터 칠할 칸이 1이다. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '001', '001', '001'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
  '+': ['000', '010', '111', '010', '000'],
};

/**
 * 정사각형 트레이 아이콘 비트맵에 전역 문제 "!" 배지를 그린 사본을 돌려준다. Windows 트레이에 쓴다.
 * 비트맵은 Electron `nativeImage.toBitmap()`이 주는 premultiplied BGRA다. 완전히 불투명하거나 투명한 픽셀만 쓰므로 premultiply를 따로 하지 않는다.
 */
export function drawAlertBadge(bitmap: Uint8Array, size: number): Uint8Array {
  return drawBadge(bitmap, size, BADGE_RED, true);
}

/** 정사각형 트레이 아이콘 비트맵에 감지 시작 전("설정 필요") 노란 점을 그린 사본을 돌려준다. "!" 배지와 같은 자리, 같은 크기다. */
export function drawSetupDot(bitmap: Uint8Array, size: number): Uint8Array {
  return drawBadge(bitmap, size, SETUP_YELLOW, false);
}

/** 정사각형 트레이 아이콘 비트맵에 실패 있음 빨간 점을 그린 사본을 돌려준다. "!" 배지와 같은 자리, 같은 크기이고 "!"가 없다. */
export function drawFailureDot(bitmap: Uint8Array, size: number): Uint8Array {
  return drawBadge(bitmap, size, BADGE_RED, false);
}

/** 정사각형 트레이 아이콘 비트맵에 생성 중 표시를 그린 사본을 돌려준다. 오른쪽 아래 짙은 회색 원 안에 흰 점 세 개다. */
export function drawGeneratingDots(bitmap: Uint8Array, size: number): Uint8Array {
  return paintBadge(bitmap, size, CENTER, RADIUS, (px, py) => (isGeneratingDot(px, py) ? MARK_WHITE : GENERATING_DARK));
}

/** 트레이 숫자 배지에 그릴 글자. 10건 이상은 "9+"다. */
export function countBadgeLabel(count: number): string {
  return count > 9 ? '9+' : String(count);
}

/**
 * 정사각형 트레이 아이콘 비트맵에 검토 대기 수를 그린 사본을 돌려준다. 오른쪽 아래 파란 원 안에 흰 숫자다.
 * Windows 트레이 아이콘에는 글자를 붙일 수 없어 아이콘에 그려 넣는다.
 */
export function drawCountBadge(bitmap: Uint8Array, size: number, count: number): Uint8Array {
  /** 그릴 글자. */
  const label = countBadgeLabel(count);
  /** 글자 전체의 폭. */
  const width = label.length * (GLYPH_WIDTH + 1) - 1;
  /** 글자가 시작하는 열. 원 가운데에 오도록 한다. */
  const left = Math.floor(COUNT_CENTER - width / 2);
  return paintBadge(bitmap, size, COUNT_CENTER, COUNT_RADIUS, (px, py) => (isGlyph(label, left, px, py) ? MARK_WHITE : BADGE_BLUE));
}

/** 오른쪽 아래에 `color` 원을 그리고, `withMark`면 그 안에 흰 "!"를 그린 사본을 돌려준다. */
function drawBadge(bitmap: Uint8Array, size: number, color: readonly number[], withMark: boolean): Uint8Array {
  return paintBadge(bitmap, size, CENTER, RADIUS, (px, py) => (withMark && isMark(px, py) ? MARK_WHITE : color));
}

/**
 * `center`에 반지름 `radius`인 원을 `colorAt`이 정한 색으로 칠하고, 원 둘레 1px을 비운 사본을 돌려준다.
 * 좌표는 16px 아이콘 기준이고 큰 아이콘은 같은 비율로 키운다.
 */
function paintBadge(
  bitmap: Uint8Array,
  size: number,
  center: number,
  radius: number,
  colorAt: (px: number, py: number) => readonly number[],
): Uint8Array {
  /** 배지를 그린 사본. */
  const badged = Uint8Array.from(bitmap);
  /** 16px 기준 1px의 크기. */
  const unit = size / 16;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      // 픽셀 중심으로 모양 안팎을 가른다.
      /** 픽셀 중심의 16px 기준 x 좌표. */
      const px = (x + 0.5) / unit;
      /** 픽셀 중심의 16px 기준 y 좌표. */
      const py = (y + 0.5) / unit;
      /** 배지 중심까지의 거리. */
      const distance = Math.hypot(px - center, py - center);
      if (distance > radius + RING) continue;

      badged.set(distance > radius ? CLEAR : colorAt(px, py), (y * size + x) * 4);
    }
  }
  return badged;
}

/** 16px 기준 좌표가 `left` 열부터 그린 글자 `label`의 칠할 칸인지 본다. */
function isGlyph(label: string, left: number, px: number, py: number): boolean {
  /** 글자 안의 줄. */
  const row = Math.floor(py - GLYPH_TOP);
  /** 글자 시작부터 센 열. */
  const offset = Math.floor(px - left);
  if (row < 0 || offset < 0) return false;
  /** 몇 번째 글자인지와 그 글자 안의 열. 글자 사이 1px은 칠하지 않는다. */
  const [index, column] = [Math.floor(offset / (GLYPH_WIDTH + 1)), offset % (GLYPH_WIDTH + 1)];
  return GLYPHS[label[index] ?? '']?.[row]?.[column] === '1';
}

/** 16px 기준 좌표가 생성 중 배지의 점 세 개 안인지 본다. */
function isGeneratingDot(px: number, py: number): boolean {
  if (py < GENERATING_DOT_Y[0] || py >= GENERATING_DOT_Y[1]) return false;
  return GENERATING_DOT_X.some((left) => px >= left && px < left + 2);
}

/** 16px 기준 좌표가 "!" 안인지 본다. */
function isMark(px: number, py: number): boolean {
  if (px < MARK_X[0] || px > MARK_X[1]) return false;
  return (py >= BAR_Y[0] && py <= BAR_Y[1]) || (py >= DOT_Y[0] && py <= DOT_Y[1]);
}
