// Release에 올리는 파일과 업데이트 서명 키의 이름. 빌드 스크립트와 태그 워크플로(.github/workflows/release.yml)가 이 이름을 함께 쓴다.
import { readFile } from 'node:fs/promises';

/** 데스크톱 앱 package.json에서 읽는 값. Release 파일 이름이 이 둘로 정해진다. */
export type AppPackageInfo = {
  /** 앱 이름(productName). */
  productName: string;
  /** 앱 버전. */
  version: string;
};

/** 데스크톱 앱의 package.json에서 앱 이름과 버전을 읽는다. */
export async function readAppPackageInfo(): Promise<AppPackageInfo> {
  return JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as AppPackageInfo;
}

/** Release에 올리는 다섯 파일의 이름. 이름은 electron-builder 기본 이름과 nsis.artifactName(build-config.mts)을 따른다. */
export type ReleaseFileNames = {
  /** 사람이 처음 설치할 때 받는 macOS 디스크 이미지. 앱은 받지 않으므로 업데이트 안내 파일에 들어가지 않는다. */
  macDmg: string;
  /** 앱 내 업데이트(Squirrel.Mac)가 받는 macOS zip. */
  macZip: string;
  /** macOS 앱이 새 버전을 확인하는 업데이트 안내 파일. */
  macUpdateInfo: string;
  /** Windows 설치 파일. 사람의 처음 설치와 앱 내 업데이트가 같은 파일을 쓴다. */
  winSetup: string;
  /** Windows 앱이 새 버전을 확인하는 업데이트 안내 파일. */
  winUpdateInfo: string;
};

/** 앱 이름과 버전으로 Release 파일 이름을 정한다. Intel Mac 빌드를 더하면 여기와 업데이트 안내 파일의 짝도 함께 고친다. */
export function releaseFileNames(productName: string, version: string): ReleaseFileNames {
  return {
    macDmg: `${productName}-${version}-arm64.dmg`,
    macZip: `${productName}-${version}-arm64-mac.zip`,
    macUpdateInfo: 'latest-mac.yml',
    winSetup: `${productName}-Setup-${version}.exe`,
    winUpdateInfo: 'latest.yml',
  };
}

/** 업데이트 안내 파일과, 그 파일이 가리키는 업데이트 파일의 짝. 서명하는 파일은 이 업데이트 파일(macOS zip, Windows exe)이다. */
export type UpdateInfoTarget = {
  /** 업데이트 안내 파일(latest*.yml) 이름. */
  updateInfo: string;
  /** 안내 파일이 가리켜야 하는 업데이트 파일 이름. */
  updateFile: string;
};

/** OS마다 업데이트 안내 파일과 업데이트 파일의 짝. */
export function updateInfoTargets(names: ReleaseFileNames): UpdateInfoTarget[] {
  return [
    { updateInfo: names.macUpdateInfo, updateFile: names.macZip },
    { updateInfo: names.winUpdateInfo, updateFile: names.winSetup },
  ];
}

/** 업데이트 서명 개인 키를 담는 `release` 환경 비밀값 이름. 태그 워크플로는 같은 이름의 환경 변수로 넘긴다. */
export const SIGNING_KEY_SECRETS = {
  /** 평소의 서명 키. 처음 만든 키가 여기 있고, 회전을 마치면 새 키로 바꾼다. */
  primary: 'UPDATE_SIGNING_KEY',
  /** 키를 회전하는 동안에만 두는 새 키. 그동안 두 키로 함께 서명한다. */
  rotation: 'UPDATE_SIGNING_KEY_2',
} as const;

/** 업데이트 서명 개인 키를 두는 Actions 환경. 저장소 설정에서 `v*` 태그만 이 환경을 쓸 수 있게 막는다. */
export const RELEASE_ENVIRONMENT = 'release';
