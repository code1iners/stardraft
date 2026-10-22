// 태그 워크플로의 Release 작업에서 업데이트 안내 파일(latest*.yml)을 검사하고, 서명을 넣고, 다시 검증한다.
// 사용법: node scripts/release-update-info.mts <check|sign|verify> [Release 파일 폴더, 기본 release]
// sign은 release 환경 비밀값을 같은 이름의 환경 변수(UPDATE_SIGNING_KEY, 회전 중이면 UPDATE_SIGNING_KEY_2)로 받는다.
import { readFile } from 'node:fs/promises';
import { UPDATE_PUBLIC_KEYS } from '../src/core/update/update-public-keys.mts';
import { OUTPUT_DIR } from './build-config.mts';
import { checkReleaseFiles, readSigningKeys, signUpdateInfo, verifyUpdateInfo } from './update-info.mts';

/** 데스크톱 앱의 package.json. 앱 이름과 버전을 읽는다. */
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as {
  productName: string;
  version: string;
};
/** 할 일과 Release 파일 폴더. */
const [command, dir = OUTPUT_DIR] = process.argv.slice(2);
/** 이번 Release 파일 묶음. */
const release = { dir, productName: packageJson.productName, version: packageJson.version };

/** 할 일을 하고 결과를 한 줄씩 돌려준다. */
async function run(): Promise<string[]> {
  switch (command) {
    case 'check':
      return checkReleaseFiles(release);
    case 'sign': {
      /** release 환경 비밀값에서 읽은 서명 키. */
      const keys = readSigningKeys(process.env);
      // 개인 키 대신 짝인 공개 키를 남겨, 앱 소스의 공개 키 목록과 견줄 수 있게 한다.
      for (const key of keys) console.log(`${key.name}의 공개 키: ${key.publicKey}`);
      return signUpdateInfo(release, keys.map((key) => key.privateKey));
    }
    case 'verify':
      return verifyUpdateInfo(release, UPDATE_PUBLIC_KEYS);
    default:
      throw new Error('사용법: node scripts/release-update-info.mts <check|sign|verify> [Release 파일 폴더]');
  }
}

try {
  for (const line of await run()) console.log(`✓ ${line}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
