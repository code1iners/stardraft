import { nativeImage, type NativeImage } from 'electron';
import frames from '../../resources/tray/frames.json';
import type { TrayIndicator } from '../core/tray-indicator';

/** 생성된 PNG의 표시 배율. */
interface Representation { scaleFactor: number; png: string }

/** 시작 시 PNG를 모두 읽어 50ms마다 그리는 동안 파일이나 이미지를 만들지 않는다. */
export class TrayImages {
  /** 플랫폼·시스템 테마별 이미지 캐시. */
  private readonly palettes = Object.fromEntries(Object.entries(frames).map(([name, palette]) => [name, {
    idle: this.decode(palette.idle),
    problem: this.decode(palette.problem),
    review: palette.review.map(frame => this.decode(frame)),
  }]));

  /** macOS는 템플릿을 사용하고 Windows는 작업 표시줄의 시스템 테마에 맞춘다. */
  get(kind: TrayIndicator['kind'], frame: number, dark: boolean): NativeImage {
    /** 이 운영체제에서 사용할 단색 이미지. */
    const palette = this.palettes[process.platform === 'darwin' ? 'mac' : dark ? 'dark' : 'light']!;
    return kind === 'review' ? palette.review[frame]! : palette[kind];
  }

  /** 각 배율의 PNG를 하나의 NativeImage로 묶는다. */
  private decode(representations: Representation[]): NativeImage {
    /** 투명 PNG를 보관하는 이미지. */
    const result = nativeImage.createEmpty();
    for (const { scaleFactor, png } of representations) {
      result.addRepresentation({ scaleFactor, buffer: Buffer.from(png, 'base64') });
    }
    result.setTemplateImage(process.platform === 'darwin');
    return result;
  }
}
