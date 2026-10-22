// macOS 빌드의 .app과 zip이 서명 검증을 통과하고 최상위 DR이 명시 DR인지 확인한다.
// 사용법: node scripts/verify-mac-build.mts [electron-builder 출력 폴더, 기본 release]
import { APP_ID, OUTPUT_DIR } from './build-config.mts';
import { verifyMacBuild } from './mac-signature.mts';
import { readAppPackageInfo } from './release-config.mts';

/** 데스크톱 앱의 이름과 버전. */
const { productName, version } = await readAppPackageInfo();
/** 검사할 electron-builder 출력 폴더. */
const releaseDir = process.argv[2] ?? OUTPUT_DIR;

try {
  /** 검사한 파일마다 읽은 DR. */
  const report = await verifyMacBuild({ releaseDir, productName, version, identifier: APP_ID });
  for (const line of report) console.log(`✓ ${line}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
