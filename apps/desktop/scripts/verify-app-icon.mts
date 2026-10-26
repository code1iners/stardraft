import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
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
/** 현재 빌드에 사용한 Electron 패키지 위치. */
const require = createRequire(import.meta.url);
/** 제품 아이콘 설정이 누락되었을 때 복사되는 Electron 기본 아이콘. */
const defaultIcon = readFileSync(join(dirname(require.resolve('electron/package.json')), 'dist/Electron.app/Contents/Resources/electron.icns'));

if (icon.subarray(0, 4).toString() !== 'icns' || icon.equals(defaultIcon)) {
  throw new Error('앱 번들에 제품 아이콘이 없습니다. Electron 기본 아이콘으로 배포할 수 없습니다.');
}
console.log(`✓ ${contents}: 제품 앱 아이콘 확인 (${iconName})`);
