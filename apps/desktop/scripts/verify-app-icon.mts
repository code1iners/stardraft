import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { OUTPUT_DIR } from './build-config.mts';
import { readAppPackageInfo } from './release-config.mts';

/** 검사할 앱 이름. */
const { productName } = await readAppPackageInfo();
/** 경로를 넘기면 DMG에서 마운트한 앱도 같은 검사로 확인할 수 있다. */
const contents = join(process.argv[2] ?? join(OUTPUT_DIR, 'mac-arm64', `${productName}.app`), 'Contents');
/** Finder가 실제로 읽는 번들 아이콘 이름. */
const iconName = execFileSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', join(contents, 'Info.plist')], { encoding: 'utf8' }).trim();
/** 설치본 아이콘 데이터. 파일 누락도 여기서 실패한다. */
const icon = readFileSync(join(contents, 'Resources', iconName));
if (icon.subarray(0, 4).toString() !== 'icns' || iconName === 'electron.icns') {
  throw new Error('앱 번들에 제품 아이콘이 없습니다. Electron 기본 아이콘으로 배포할 수 없습니다.');
}
/** 개발용 Electron 설치 여부와 무관하게 배포 아이콘을 원본 PNG와 직접 비교한다. */
const temporary = await mkdtemp(join(tmpdir(), 'stardraft-icon-'));
try {
  /** ICNS에서 추출한 배율별 이미지 디렉터리. */
  const iconset = join(temporary, 'app.iconset');
  execFileSync('iconutil', ['-c', 'iconset', join(contents, 'Resources', iconName), '-o', iconset]);
  /** 승인된 1024px 원본의 픽셀. */
  const expected = await sharp(fileURLToPath(new URL('../build/icon.png', import.meta.url))).ensureAlpha().raw().toBuffer();
  /** 실제 배포 번들에 포함된 최대 배율의 픽셀. */
  const actual = await sharp(join(iconset, 'icon_512x512@2x.png')).ensureAlpha().raw().toBuffer();
  if (!actual.equals(expected)) throw new Error('앱 번들의 아이콘이 제품 아이콘 원본과 다릅니다.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`✓ ${contents}: 제품 앱 아이콘 확인 (${iconName})`);
