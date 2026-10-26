import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import frames from '../resources/tray/frames.json';

/** 투명 PNG를 비교하기 위한 비압축 RGBA 픽셀. */
async function pixels(png: string): Promise<Buffer> {
  return sharp(Buffer.from(png, 'base64')).ensureAlpha().raw().toBuffer();
}

describe('배포 트레이 프레임', () => {
  it('플랫폼의 모든 배율을 포함하고 40프레임이 단색·투명 배경·65–100% 채움을 유지한다', async () => {
    for (const [name, palette] of Object.entries(frames)) {
      expect(palette.review).toHaveLength(40);
      expect(palette.idle.map(image => image.scaleFactor)).toEqual(name === 'mac' ? [1, 2] : [1, 1.25, 1.5, 2]);
      for (const representations of [palette.idle, palette.problem, ...palette.review]) {
        expect(representations.map(image => image.scaleFactor)).toEqual(palette.idle.map(image => image.scaleFactor));
        for (const image of representations) {
          /** 이미지 크기와 투명 픽셀. */
          const metadata = await sharp(Buffer.from(image.png, 'base64')).metadata();
          const data = await pixels(image.png);
          expect(metadata.width).toBe(16 * image.scaleFactor);
          expect(metadata.height).toBe(metadata.width);
          expect(data[3]).toBe(0);
          for (let offset = 0; offset < data.length; offset += 4) {
            if (data[offset + 3] === 0) continue;
            expect(data[offset]).toBe(name === 'dark' ? 255 : 0);
            expect(data[offset + 1]).toBe(data[offset]);
            expect(data[offset + 2]).toBe(data[offset]);
          }
        }
      }
      /** 같은 채움 형태의 반투명·불투명 프레임. */
      const minimum = await pixels(palette.review[0]![0]!.png);
      const maximum = await pixels(palette.review[20]![0]!.png);
      const idle = await pixels(palette.idle[0]!.png);
      /** 부드러운 가장자리를 포함한 전체 알파 값. */
      const alpha = (data: Buffer): number => data.reduce((sum, value, index) => sum + (index % 4 === 3 ? value : 0), 0);
      expect(alpha(minimum) / alpha(maximum)).toBeCloseTo(.65, 2);
      expect(alpha(idle)).toBeLessThan(alpha(maximum));
      expect(Math.max(...maximum.filter((_, index) => index % 4 === 3))).toBe(255);
      expect(palette.problem[0]!.png).not.toBe(palette.idle[0]!.png);
    }
  });
});
