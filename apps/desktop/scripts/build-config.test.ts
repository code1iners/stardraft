import { describe, expect, it } from 'vitest';
import { createBuildConfig } from './build-config.mts';

describe('빌드 설정의 publish', () => {
  it('Actions에서는 그 저장소의 주인(GITHUB_REPOSITORY_OWNER)을 github provider의 주인으로 쓴다', () => {
    const config = createBuildConfig({ env: { GITHUB_REPOSITORY_OWNER: 'example-owner' }, originUrl: null });

    expect(config.publish).toEqual({ provider: 'github', owner: 'example-owner', repo: 'stardraft' });
  });

  it.each([
    'https://github.com/example-owner/stardraft.git',
    'https://github.com/example-owner/stardraft',
    'git@github.com:example-owner/stardraft.git',
    'ssh://git@github.com/example-owner/stardraft.git',
  ])('로컬에서는 origin 원격 주소 %s에서 주인을 읽는다', (originUrl) => {
    const config = createBuildConfig({ env: {}, originUrl });

    expect(config.publish).toEqual({ provider: 'github', owner: 'example-owner', repo: 'stardraft' });
  });

  it.each([
    ['원격이 없을 때', null],
    ['원격이 stardraft 저장소가 아닐 때', 'https://github.com/example-owner/other.git'],
    ['원격이 GitHub가 아닐 때', 'https://gitlab.com/example-owner/stardraft.git'],
  ])('%s는 주인을 지어내지 않고 멈춰 GITHUB_REPOSITORY_OWNER를 알려 준다', (_case, originUrl) => {
    expect(() => createBuildConfig({ env: {}, originUrl })).toThrow(/GITHUB_REPOSITORY_OWNER/);
  });
});

describe('설치 파일 형태', () => {
  /** 주인을 정해 둔 빌드 설정. */
  const config = createBuildConfig({ env: { GITHUB_REPOSITORY_OWNER: 'example-owner' }, originUrl: null });

  it('macOS와 Windows 설치 앱에 제품 아이콘을 지정한다', () => {
    expect(config.mac?.icon).toBe('build/icon.png');
    expect(config.win?.icon).toBe('build/icon.png');
  });

  it('macOS는 arm64 DMG와 zip을 만들고, 번들 전체를 ad-hoc 서명한 뒤 afterSign 훅을 거친다', () => {
    expect(config.mac?.target).toEqual([
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ]);
    expect(config.mac?.identity).toBe('-');
    expect(config.afterSign).toBeTypeOf('function');
  });

  it('명시 DR은 mac.requirements로 넣지 않는다(중첩 코드까지 같은 DR이 붙어 서명이 깨진다)', () => {
    expect(config.mac?.requirements).toBeUndefined();
  });

  it('DMG는 앱이 업데이트에 쓰지 않으므로 latest-mac.yml과 blockmap에서 뺀다', () => {
    expect(config.dmg?.writeUpdateInfo).toBe(false);
  });

  it('Windows는 x64 NSIS 원클릭 설치 파일을 사용자별로, 설치 위치를 묻지 않고, 공백 없는 이름으로 만든다', () => {
    expect(config.win?.target).toEqual([{ target: 'nsis', arch: ['x64'] }]);
    expect(config.nsis).toMatchObject({
      oneClick: true,
      perMachine: false,
      allowToChangeInstallationDirectory: false,
      artifactName: '${productName}-Setup-${version}.${ext}',
    });
  });

  it('바로가기의 AppUserModelID가 될 appId는 앱의 식별자다', () => {
    expect(config.appId).toBe('app.squadify.stardraft');
  });
});

describe('Windows 서명 자리', () => {
  /** Artifact Signing에 필요한 가짜 비밀값 일곱 개. */
  const azureSecrets = {
    AZURE_TENANT_ID: 'fake-tenant',
    AZURE_CLIENT_ID: 'fake-client',
    AZURE_CLIENT_SECRET: 'fake-secret',
    AZURE_SIGNING_ENDPOINT: 'https://example.codesigning.azure.net',
    AZURE_SIGNING_ACCOUNT_NAME: 'fake-account',
    AZURE_SIGNING_CERTIFICATE_PROFILE_NAME: 'fake-profile',
    AZURE_SIGNING_PUBLISHER_NAME: 'Fake Publisher',
  };

  /** 주인만 정해 둔 환경 변수에 `extra`를 더한다. */
  function buildWith(extra: Record<string, string>) {
    return createBuildConfig({ env: { GITHUB_REPOSITORY_OWNER: 'example-owner', ...extra }, originUrl: null });
  }

  it('AZURE_* 비밀값이 없으면 서명하지 않는다', () => {
    const { win } = buildWith({});

    expect(win?.azureSignOptions).toBeUndefined();
    expect(win?.signExts).toBeUndefined();
  });

  it('Actions에서 등록하지 않은 비밀값은 빈 문자열이라 없는 것으로 본다', () => {
    /** 비밀값을 등록하지 않은 저장소에서 워크플로가 넘기는 값. */
    const unsetSecrets = Object.fromEntries(Object.keys(azureSecrets).map((name) => [name, '']));

    const { win } = buildWith(unsetSecrets);

    expect(win?.azureSignOptions).toBeUndefined();
    expect(win?.signExts).toBeUndefined();
  });

  it('AZURE_* 비밀값이 모두 있으면 Artifact Signing으로 exe와 함께 .dll·.node도 서명한다', () => {
    const { win } = buildWith(azureSecrets);

    expect(win?.azureSignOptions).toEqual({
      endpoint: 'https://example.codesigning.azure.net',
      codeSigningAccountName: 'fake-account',
      certificateProfileName: 'fake-profile',
      publisherName: 'Fake Publisher',
    });
    expect(win?.signExts).toEqual(['.dll', '.node']);
  });

  it('일부만 있으면 서명 없이 빌드하지 않고 빠진 이름을 알려 준다', () => {
    /** 로그인 비밀번호와 서명 publisher 이름이 빠진 비밀값. */
    const partial = Object.fromEntries(
      Object.entries(azureSecrets).filter(([name]) => name !== 'AZURE_CLIENT_SECRET' && name !== 'AZURE_SIGNING_PUBLISHER_NAME'),
    );

    expect(() => buildWith(partial)).toThrow(/AZURE_CLIENT_SECRET.*AZURE_SIGNING_PUBLISHER_NAME/);
  });
});
