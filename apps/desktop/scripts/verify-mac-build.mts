// macOS 빌드의 .app과 zip이 서명 검증을 통과하고 최상위 DR이 명시 DR인지 확인한다.
// 사용법: node scripts/verify-mac-build.mts [electron-builder 출력 폴더, 기본 release]
import { readFile } from 'node:fs/promises';
import { APP_ID, OUTPUT_DIR } from './build-config.mts';
import { verifyMacBuild } from './mac-signature.mts';

/** 데스크톱 앱의 package.json. 앱 이름과 버전을 읽는다. */
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  productName: string;
  version: string;
};
/** 검사할 electron-builder 출력 폴더. */
const releaseDir = process.argv[2] ?? OUTPUT_DIR;

try {
  /** 검사한 파일마다 읽은 DR. */
  const report = await verifyMacBuild({
    releaseDir,
    productName: packageJson.productName,
    version: packageJson.version,
    identifier: APP_ID,
  });
  for (const line of report) console.log(`✓ ${line}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
