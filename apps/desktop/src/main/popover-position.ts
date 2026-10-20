/** 화면 좌표의 점. */
export interface Point {
  /** 가로 좌표. */
  x: number;
  /** 세로 좌표. */
  y: number;
}

/** 화면 좌표의 사각형. */
export interface Rect extends Point {
  /** 너비. */
  width: number;
  /** 높이. */
  height: number;
}

/** 작은 창 위치를 정할 때 쓰는 값. */
export interface PopoverPositionInput {
  /** 트레이 아이콘의 화면 위치. OS가 알려 주지 않으면 크기가 0이다. */
  trayBounds: Rect;
  /** 트레이 아이콘이 있는 모니터의 작업 영역(메뉴 막대·작업 표시줄을 뺀 영역). */
  workArea: Rect;
  /** 작은 창 크기. */
  windowSize: { width: number; height: number };
  /** 트레이 위치를 알 수 없을 때 대신 쓸 마우스 포인터 위치. */
  cursor?: Point;
}

/** 트레이 아이콘과 작은 창 사이 간격(px). */
const TRAY_GAP = 4;
/** 작은 창과 작업 영역 좌우 끝 사이 최소 간격(px). */
const EDGE_MARGIN = 8;

/**
 * 작은 창을 트레이 아이콘 가까이에 놓을 왼쪽 위 좌표를 구한다.
 * 아이콘이 작업 영역 위쪽 절반에 있으면(macOS 메뉴 막대) 아래에, 아래쪽 절반에 있으면(Windows 작업 표시줄) 위에 놓는다.
 */
export function popoverPosition({ trayBounds, workArea, windowSize, cursor }: PopoverPositionInput): Point {
  /** 창을 붙일 기준 사각형. */
  const anchor = popoverAnchor(trayBounds, cursor);

  // 아이콘의 가로 가운데에 맞추고, 세로는 아이콘이 있는 쪽 반대 방향으로 편다.
  /** 기준 사각형의 세로 가운데. */
  const anchorCenterY = anchor.y + anchor.height / 2;
  /** 작업 영역의 세로 가운데. */
  const workAreaCenterY = workArea.y + workArea.height / 2;
  /** 작업 영역 안으로 당기기 전의 가로 좌표. */
  const preferredX = anchor.x + anchor.width / 2 - windowSize.width / 2;
  /** 작업 영역 안으로 당기기 전의 세로 좌표. */
  const preferredY =
    anchorCenterY < workAreaCenterY
      ? anchor.y + anchor.height + TRAY_GAP
      : anchor.y - windowSize.height - TRAY_GAP;

  // 창 전체가 작업 영역 안에 들어오게 당긴다.
  return {
    x: Math.round(
      clamp(preferredX, workArea.x + EDGE_MARGIN, workArea.x + workArea.width - windowSize.width - EDGE_MARGIN),
    ),
    y: Math.round(
      clamp(preferredY, workArea.y + TRAY_GAP, workArea.y + workArea.height - windowSize.height - TRAY_GAP),
    ),
  };
}

/**
 * 작은 창을 붙일 기준 사각형. 보통은 트레이 아이콘이다.
 * OS가 트레이 위치를 알려 주지 않으면(크기 0) 마우스 포인터를 크기 0인 아이콘으로 본다.
 */
export function popoverAnchor(trayBounds: Rect, cursor?: Point): Rect {
  /** OS가 트레이 위치를 알려 줬는지 여부. */
  const hasTrayBounds = trayBounds.width > 0 && trayBounds.height > 0;
  return hasTrayBounds || !cursor ? trayBounds : { ...cursor, width: 0, height: 0 };
}

/** `value`를 `min`과 `max` 사이로 자른다. 범위가 뒤집히면 `min`을 쓴다. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}
