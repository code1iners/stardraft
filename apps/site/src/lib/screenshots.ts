// 설치 안내에서 막히는 네 곳의 실제 스크린숏. `src/assets/screenshots/<이름>.png`를 넣으면 빌드할 때 찾아 쓴다.

/** 실제 스크린숏을 기본으로 보이는 막히는 곳. 파일 이름이기도 하다. */
export type StuckScreenshotId = 'mac-blocked' | 'mac-settings' | 'win-smartscreen' | 'win-sac';

/** 페이지에 넣을 스크린숏 이미지. */
export type Screenshot = {
  /** 빌드한 이미지 주소. */
  src: string;
  /** 이미지 폭(px). */
  width: number;
  /** 이미지 높이(px). */
  height: number;
};

/** 스크린숏 폴더에 있는 PNG. 파일이 없으면 비어 있다. */
const files = import.meta.glob<{ default: Screenshot }>('../assets/screenshots/*.png', { eager: true });

/** 막히는 곳의 실제 스크린숏. 아직 찍지 않았으면 null이고, 그때는 예시 화면만 보인다. */
export function stuckScreenshot(id: StuckScreenshotId): Screenshot | null {
  /** 그 이름의 PNG. */
  const image = files[`../assets/screenshots/${id}.png`]?.default;
  return image ? { src: image.src, width: image.width, height: image.height } : null;
}
