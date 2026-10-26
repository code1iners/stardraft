import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

/** SVG와 생성된 PNG 프레임을 보관하는 디렉터리. */
const resources = new URL('../resources/tray/', import.meta.url);
/** 플랫폼별 배율. Windows는 100·125·150·200%를 지원한다. */
const palettes = { mac: { color: '#000000', sizes: [16, 32] }, light: { color: '#000000', sizes: [16, 20, 24, 32] }, dark: { color: '#ffffff', sizes: [16, 20, 24, 32] } };
/** PNG의 논리 배율과 원본 픽셀. 런타임에서는 변환 없이 읽는다. */
type Representation = { scaleFactor: number; png: string };
/** 단색별 정지 상태와 pulse 프레임. */
const output: Record<string, { idle: Representation[]; problem: Representation[]; review: Representation[][] }> = {};

/** CSS ease-in-out cubic-bezier(.42, 0, .58, 1)의 시간에 대응하는 진행률. */
function ease(time: number): number {
  /** 베지어 매개변수의 이분 탐색 범위. */
  let low = 0;
  /** 탐색 상한. */
  let high = 1;
  for (let iteration = 0; iteration < 30; iteration++) {
    /** 현재 매개변수와 그때의 시간 좌표. */
    const t = (low + high) / 2;
    const x = 3 * (1 - t) ** 2 * t * .42 + 3 * (1 - t) * t ** 2 * .58 + t ** 3;
    if (x < time) low = t;
    else high = t;
  }
  /** 구한 매개변수. */
  const t = (low + high) / 2;
  return 3 * (1 - t) * t ** 2 + t ** 3;
}

for (const [name, { color, sizes }] of Object.entries(palettes)) {
  /** 지정한 상태·불투명도를 각 배율의 PNG로 굽는다. SVG 그룹 전체의 불투명도라 선 겹침도 동일하게 흐려진다. */
  async function render(kind: string, opacity = 1): Promise<Representation[]> {
    /** 승인된 SVG 원본. */
    const source = (await readFile(new URL(`${kind}.svg`, resources), 'utf8'))
      .replace('color="#000000"', `color="${color}"`)
      .replace(/(<svg[^>]*>)([\s\S]*)(<\/svg>)/, `$1<g opacity="${opacity}">$2</g>$3`);
    return Promise.all(sizes.map(async size => ({
      scaleFactor: size / 16,
      png: (await sharp(Buffer.from(source)).resize(size, size).png().toBuffer()).toString('base64'),
    })));
  }
  /** 한 주기는 40프레임, 프레임 간격은 50ms다. */
  const review: Representation[][] = [];
  for (let frame = 0; frame < 40; frame++) {
    /** 반 주기마다 오르고 내리는 시간 비율. */
    const progress = frame <= 20 ? frame / 20 : (40 - frame) / 20;
    review.push(await render('review', .65 + .35 * ease(progress)));
  }
  output[name] = { idle: await render('idle'), problem: await render('problem'), review };
}
/** 재생성 결과를 검증할 수 있는 결정적 산출물. */
const generated = `${JSON.stringify(output)}\n`;
/** 커밋할 생성 파일. */
const target = new URL('frames.json', resources);
if (process.argv.includes('--check')) {
  if (await readFile(target, 'utf8') !== generated) throw new Error('트레이 프레임이 SVG 원본과 다릅니다. pnpm icons:generate를 실행하세요.');
} else {
  await writeFile(target, generated);
}
