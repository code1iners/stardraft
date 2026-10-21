import type { Configuration } from 'electron-builder';
import { createAfterSign } from './mac-signature.mts';

/** 빌드 설정을 정하는 바깥 값. */
export type BuildEnvironment = {
  /** 빌드를 실행한 환경 변수. */
  env: Readonly<Record<string, string | undefined>>;
  /** 이 저장소의 `origin` 원격 주소. 원격이 없으면 null. */
  originUrl: string | null;
};

/** 번들 ID이자 Windows AppUserModelID. 앱의 `APP_ID`(`src/main/app-identity.ts`)와 같은 값이다. */
export const APP_ID = 'app.squadify.stardraft';
/** 앱이 업데이트를 받는 GitHub 저장소 이름. */
const RELEASE_REPO = 'stardraft';

/** GitHub의 `stardraft` 저장소 원격 주소(HTTPS·SSH)에서 주인을 꺼내는 식. */
const RELEASE_REMOTE_PATTERN = new RegExp(`github\\.com[:/]([^/]+)/${RELEASE_REPO}(?:\\.git)?/?$`);

/**
 * 업데이트를 받을 GitHub 저장소의 주인. 이 값은 설치본의 `app-update.yml`에 들어간다.
 * Actions에서는 워크플로가 도는 저장소의 주인을, 로컬에서는 `origin` 원격의 주인을 쓴다.
 * 둘 다 없으면 업데이트를 엉뚱한 곳에서 찾는 앱이 나오지 않게 멈춘다.
 */
function resolveReleaseOwner({ env, originUrl }: BuildEnvironment): string {
  // Actions가 넣어 주는 값인가요?
  if (env.GITHUB_REPOSITORY_OWNER) return env.GITHUB_REPOSITORY_OWNER;

  /** origin 원격 주소에서 꺼낸 주인. */
  const owner = originUrl?.match(RELEASE_REMOTE_PATTERN)?.[1];
  if (owner) return owner;

  throw new Error(
    `업데이트를 받을 GitHub 저장소의 주인을 알 수 없습니다. origin 원격을 GitHub의 ${RELEASE_REPO} 저장소로 두거나 GITHUB_REPOSITORY_OWNER를 지정하세요.`,
  );
}

/** Artifact Signing 로그인 값. electron-builder가 부르는 `Invoke-TrustedSigning`이 환경 변수에서 직접 읽는다. */
const AZURE_AUTH_NAMES = ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET'] as const;
/** `win.azureSignOptions`의 각 칸을 채우는 환경 변수 이름. */
const AZURE_SIGN_OPTION_NAMES = {
  endpoint: 'AZURE_SIGNING_ENDPOINT',
  codeSigningAccountName: 'AZURE_SIGNING_ACCOUNT_NAME',
  certificateProfileName: 'AZURE_SIGNING_CERTIFICATE_PROFILE_NAME',
  publisherName: 'AZURE_SIGNING_PUBLISHER_NAME',
} as const;

/**
 * Windows 서명 설정. `AZURE_*` 비밀값이 모두 있을 때만 켜고, 하나도 없으면 미서명으로 빌드한다.
 * 일부만 있으면 서명할 생각이었는데 값이 빠진 것이므로, 미서명 파일이 조용히 나가지 않게 멈춘다.
 */
function windowsSigning({ env }: BuildEnvironment): Pick<NonNullable<Configuration['win']>, 'azureSignOptions' | 'signExts'> {
  /** 서명에 필요한 환경 변수 이름 전체. */
  const names = [...AZURE_AUTH_NAMES, ...Object.values(AZURE_SIGN_OPTION_NAMES)];
  // Actions는 등록하지 않은 비밀값을 빈 문자열로 넘기므로 빈 값도 없는 것으로 본다.
  /** 값이 없는 이름. */
  const missing = names.filter((name) => !env[name]);

  // 하나도 없나요? 지금 배포처럼 미서명이다.
  if (missing.length === names.length) return {};
  if (missing.length > 0) {
    throw new Error(`Windows 서명 비밀값 일부가 없습니다: ${missing.join(', ')}. 모두 넣거나 모두 빼세요.`);
  }

  return {
    azureSignOptions: {
      endpoint: env[AZURE_SIGN_OPTION_NAMES.endpoint] ?? '',
      codeSigningAccountName: env[AZURE_SIGN_OPTION_NAMES.codeSigningAccountName] ?? '',
      certificateProfileName: env[AZURE_SIGN_OPTION_NAMES.certificateProfileName] ?? '',
      publisherName: env[AZURE_SIGN_OPTION_NAMES.publisherName] ?? '',
    },
    // 기본으로는 exe만 서명하므로 앱 안의 .dll과 better-sqlite3의 .node도 더한다.
    signExts: ['.dll', '.node'],
  };
}

/** electron-builder 설정. */
export function createBuildConfig(input: BuildEnvironment): Configuration {
  return {
    appId: APP_ID,
    productName: 'Stardraft',
    directories: {
      output: 'release',
      buildResources: 'build',
    },
    files: ['out/**', 'resources/**', 'package.json'],
    // 트레이 아이콘은 OS가 실제 파일 경로로 읽을 수 있게 asar 밖에 둔다.
    // better-sqlite3의 .node 파일도 asar 안에서는 불러올 수 없어 밖에 둔다.
    asarUnpack: ['resources/**', 'node_modules/better-sqlite3/prebuilds/**'],
    // better-sqlite3는 N-API prebuild를 함께 배포하므로 Electron용으로 다시 빌드하지 않는다.
    npmRebuild: false,
    // 서명 전에 적용한다. Node로 실행·NODE_OPTIONS·inspect 인수를 막고, asar 무결성 검증과 asar에서만 앱 불러오기를 켠다.
    electronFuses: {
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    },
    mac: {
      // Apple Silicon만 만든다. zip은 앱 내 업데이트(Squirrel.Mac)가, DMG는 사람이 처음 설치할 때 쓴다.
      target: [
        { target: 'dmg', arch: ['arm64'] },
        { target: 'zip', arch: ['arm64'] },
      ],
      // Helper와 Framework까지 번들 전체를 ad-hoc 서명한다. 값이 없으면 서명을 건너뛰어 번들이 깨진 채 남는다.
      identity: '-',
      extendInfo: {
        // 메뉴 막대 앱이라 Dock 아이콘을 숨긴다. 설정 창이 열려 있는 동안만 앱이 Dock 아이콘을 보인다.
        LSUIElement: true,
      },
    },
    // 명시 DR은 mac.requirements가 아니라 여기서 최상위 번들에만 넣는다. requirements는 중첩 코드까지 같은 DR을 붙여 서명을 깬다.
    afterSign: createAfterSign(APP_ID),
    // 앱은 DMG로 업데이트하지 않으므로 latest-mac.yml에 넣지 않고 blockmap도 만들지 않는다.
    dmg: { writeUpdateInfo: false },
    win: {
      target: [{ target: 'nsis', arch: ['x64'] }],
      ...windowsSigning(input),
    },
    // 관리자 권한 없이 %LOCALAPPDATA%\Programs에 설치한다. 바로가기에는 appId가 AppUserModelID로 들어간다.
    nsis: {
      oneClick: true,
      perMachine: false,
      allowToChangeInstallationDirectory: false,
      // 기본 이름의 공백은 GitHub에 올릴 때 "."으로 바뀌어 latest.yml의 이름과 어긋나므로 뺀다.
      artifactName: '${productName}-Setup-${version}.${ext}',
    },
    // 빌드는 --publish never로 하고, 이 값은 latest*.yml과 설치본의 app-update.yml에만 쓰인다.
    // 차등 다운로드는 쓰지 않는다. zip·exe의 blockmap은 latest*.yml에 크기를 채우는 과정에서 생길 뿐 Release에 올리지 않는다.
    publish: { provider: 'github', owner: resolveReleaseOwner(input), repo: RELEASE_REPO },
  };
}
