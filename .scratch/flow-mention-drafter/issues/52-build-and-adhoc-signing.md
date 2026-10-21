# 52: 빌드 설정과 ad-hoc 서명

**Spec:** [스펙](../spec.md) 15절(빌드 도구, macOS, Windows, publish 설정), ADR 0002

**What to build:** 로컬에서 빌드하면 macOS arm64 DMG와 zip, Windows x64 NSIS 설치 파일이 나온다. macOS 번들은 전체가 ad-hoc 서명되고 최상위 번들만 명시 DR로 다시 서명되어 `codesign -d -r-`에 `designated => identifier "app.squadify.stardraft"`가 보인다. `workflow_dispatch`로 같은 빌드를 돌려 워크플로 아티팩트로 받을 수 있다.

**Blocked by:** 23

**Status:** resolved

- [x] electron-builder 26.17.0 정확히 고정. `mac.target: ["dmg", "zip"]`, `mac.identity: "-"`, `afterSign`에서 최상위 번들만 명시 DR 재서명(`mac.requirements`는 쓰지 않음). Fuses 적용.
- [x] Windows: NSIS 원클릭, 사용자별 설치, 설치 위치 묻지 않음, `nsis.artifactName`은 `${productName}-Setup-${version}.${ext}`, 바로가기에 AppUserModelID, `win.azureSignOptions`와 `signExts: [".dll", ".node"]`는 `AZURE_*` 비밀값이 있을 때만.
- [x] `publish`는 `github` provider(`repo: "stardraft"`)이고 빌드는 `--publish never`. 차등 다운로드 끔(`disableDifferentialDownload`), blockmap 안 올림.
- [x] `workflow_dispatch` 워크플로가 macOS와 Windows 러너에서 빌드해 아티팩트로 올린다(실행 확인은 59).
- [x] 로컬 macOS 빌드에서 `codesign --verify --deep --strict` 통과와 최상위 DR을 확인해 기록한다.

## Comments

### 2026-10-22 구현과 검증 기록

**구조**

- 설정 파일: `apps/desktop/electron-builder.yml`을 `apps/desktop/electron-builder.ts`로 바꿨다. electron-builder가 이 파일을 jiti로 읽는다.
  - 설정 내용은 `scripts/build-config.mts`의 `createBuildConfig({ env, originUrl })`가 만든다.
  - 환경 값에 따라 달라지는 부분(GitHub 주인, Windows 서명)을 테스트하려고 함수로 두었다.
- 빌드 명령: 루트나 `apps/desktop`에서 `pnpm dist`를 실행한다. 내용은 `electron-vite build && electron-builder --publish never`이고, 결과는 `apps/desktop/release/`에 나온다.
- afterSign 훅: `scripts/mac-signature.mts`의 `createAfterSign`이다.
  - `codesign --force --sign - --preserve-metadata=entitlements,flags,runtime --requirements '=designated => identifier "app.squadify.stardraft"' Stardraft.app`으로 최상위 번들만 다시 서명한다. `--deep`은 쓰지 않는다.
  - 다시 서명한 뒤 아래 서명 검사를 돌린다. 틀리면 DMG·zip을 만들기 전에 빌드를 멈춘다.
- 서명 검사: `pnpm --filter @stardraft/desktop verify:mac [출력 폴더]`를 실행한다.
  - 두 번들을 검사한다. 빌드한 `.app`과, zip을 `ditto -x -k`로 푼 `.app`이다.
  - 각각에 `codesign --verify --deep --strict`를 돌리고, `codesign -d -r-`로 최상위 DR이 정확히 명시 DR인지 본다.
  - 53 태그 워크플로의 ③은 이 스크립트를 그대로 쓰면 된다.
- 빌드 스크립트의 형식
  - 빌드 스크립트는 Node 24가 TypeScript를 직접 실행하므로 `.mts`로 두었다. 이 패키지에는 `type`이 없어서 `.ts`로 두면 모듈 형식 경고가 나온다.
  - 상대 import에는 확장자를 붙인다(`tsconfig.node.json`의 `allowImportingTsExtensions`).
  - typecheck·lint·Vitest 대상에 `scripts/`와 `electron-builder.ts`를 더했다.
- 워크플로 `.github/workflows/build.yml`
  - 트리거는 `workflow_dispatch` 하나다. 53 태그 워크플로가 이 빌드를 다시 쓸지는 53에서 정한다.
  - macos-latest에서는 빌드한 뒤 `verify:mac`을 돌리고, windows-latest에서는 빌드만 한다.
  - 아티팩트에는 Release에 올릴 파일만 담는다. macOS는 DMG·zip·`latest-mac.yml`, Windows는 exe·`latest.yml`이고 blockmap은 뺀다.
  - 액션은 커밋 SHA로 고정했다. upload-artifact는 v7.0.2(`cf430e0`)다.
  - Intel Mac은 matrix 주석으로 자리만 두었다.

**스펙에 없던 것을 정한 결정** (검토 대상)

- **GitHub 주인**
  - 스펙은 "`github` provider(주인, `repo: "stardraft"`)"라고만 하고 주인 값을 정하지 않았다.
  - electron-builder는 `projectDir/.git/config`만 읽어서 주인을 추론한다. 모노레포(`apps/desktop`)에서는 이 추론이 실패하고, 그러면 경고만 남긴 채 `app-update.yml`과 `latest*.yml`을 만들지 않는다.
  - 그래서 주인을 이 순서로 정한다. 먼저 `GITHUB_REPOSITORY_OWNER`(Actions가 넣는 값), 없으면 `origin` 원격 주소(`github.com[:/]<주인>/stardraft`)다. 둘 다 없으면 빌드를 멈춘다.
  - 지금 이 저장소에는 원격이 없다. 59에서 원격을 만들기 전에는 `GITHUB_REPOSITORY_OWNER=<주인> pnpm dist`로 로컬 빌드한다.
- **Windows 서명 비밀값 이름**
  - 로그인 값은 `AZURE_TENANT_ID`·`AZURE_CLIENT_ID`·`AZURE_CLIENT_SECRET`이다. electron-builder가 부르는 `Invoke-TrustedSigning`이 직접 읽는다.
  - `azureSignOptions` 칸은 `AZURE_SIGNING_ENDPOINT`·`AZURE_SIGNING_ACCOUNT_NAME`·`AZURE_SIGNING_CERTIFICATE_PROFILE_NAME`·`AZURE_SIGNING_PUBLISHER_NAME`에서 읽는다.
  - 일곱 개가 모두 있을 때만 서명을 켠다.
  - Actions는 등록하지 않은 비밀값을 빈 문자열로 넘기므로, 빈 값은 없는 것으로 본다.
  - 일부만 있으면 빠진 이름을 알리고 멈춘다. 서명할 생각이었던 빌드가 미서명 파일을 조용히 내놓지 않게 하려는 것이다.
  - 워크플로는 이 값을 Windows 빌드 단계에만 넘긴다.
- **`dmg.writeUpdateInfo: false`**
  - 앱은 DMG로 업데이트하지 않는다. 그래서 `latest-mac.yml`에는 zip만 들어가고, DMG blockmap도 생기지 않는다.
  - 사이트는 yml이 아니라 Release 자산을 읽으므로 영향이 없다.
- **차등 다운로드**
  - `disableDifferentialDownload`는 electron-updater의 런타임 속성이다. app-builder-lib·builder-util-runtime에는 없다. 그래서 electron-updater를 넣는 54에서 켠다(54의 "차등 다운로드 끔").
  - 빌드 쪽에서 할 일은 blockmap을 올리지 않는 것이다.
  - zip blockmap은 zip을 `latest-mac.yml`에 넣을 때 늘 생긴다.
  - NSIS는 `differentialPackage`를 끄면 `latest.yml`에서 `size`가 빠진다. 53의 크기 검사에 이 값이 필요하므로 기본값을 그대로 두었다.
  - 이렇게 생긴 blockmap은 아티팩트에도 Release에도 올리지 않는다.
- **NSIS와 바로가기**
  - `nsis.perMachine: false`와 `allowToChangeInstallationDirectory: false`는 기본값과 같다. 스펙이 정한 값이라 명시했다.
  - 바로가기 AUMID는 NSIS 템플릿이 `appId`로 넣는다(`WinShell::SetLnkAUMI ... "${APP_ID}"`).
- **앱 식별 값**
  - `productName`은 설정에서 빼고 package.json 한 곳에서 읽는다.
  - `APP_ID`는 두 곳에 있다. 앱 코드(`src/main/app-identity.ts`)는 Electron을 import해서 빌드 스크립트와 같은 파일을 나눠 쓰기 어렵다. 두 곳은 주석으로 연결했다.
- **로컬 키체인 주의**
  - `mac.identity: "-"`여도 electron-builder는 먼저 키체인에서 `-`가 이름에 든 Developer ID Application 인증서를 부분 일치로 찾는다(`findIdentity`).
  - 이 Mac에서는 ad-hoc으로 서명됐다. 배포 빌드는 인증서가 없는 CI에서 만든다.

**검증**

- 자동 검사: 루트에서 `pnpm lint`, `pnpm typecheck`, `pnpm test`(Vitest 1002개, 새 테스트 25개)가 통과했다.
  - 설정 테스트는 아래를 다룬다.
    - 주인: 환경 변수, origin 주소 네 형식(HTTPS·SSH), 원격 없음·다른 저장소·GitHub가 아닌 원격에서 멈추기.
    - Windows 서명: 비밀값 없음, 빈 값, 모두 있음, 일부만 있음.
    - mac: target, identity, requirements 없음, afterSign, DMG update info.
    - NSIS 값과 appId.
  - 서명 테스트는 가짜 codesign으로 아래를 다룬다.
    - 다시 서명하는 명령 인수(`--deep` 없음)와, 다시 서명한 뒤 검증하고 DR을 읽는 순서.
    - Windows에서는 건너뛰기.
    - 기본 DR, 다른 식별자, 검증 실패에서 멈추기.
    - zip을 ditto로 풀어 검사하기, zip 안의 번들만 틀린 경우의 실패.
- **로컬 macOS 빌드**
  - 환경: macOS 27.0, Apple Silicon. 주인은 가짜 값 `example-owner`로 주었고, 결과는 작업 폴더 밖 임시 폴더에 냈다.
  - 산출물은 `Stardraft-0.1.0-arm64.dmg`, `Stardraft-0.1.0-arm64-mac.zip`, `latest-mac.yml`, zip blockmap이다.
    - `latest-mac.yml`에는 zip 하나만 있고, url·sha512·size가 들어 있다.
    - electron-builder 로그는 `signing ... identityName=-`이다.
  - 최상위 번들
    - `codesign -d -r- Stardraft.app`은 `designated => identifier "app.squadify.stardraft"`를 냈다. 앞에 `#`이 없으므로 서명에 박힌 명시 DR이다.
    - `codesign -dv`는 `flags=0x10002(adhoc,runtime)`, `Signature=adhoc`이다.
    - `codesign --verify --deep --strict --verbose=2`는 `valid on disk`, `satisfies its Designated Requirement`를 냈다.
  - 중첩 코드: `Stardraft Helper.app`은 `# designated => cdhash H"…"` 그대로였다. 최상위 번들만 다시 서명됐다는 뜻이다.
  - 엔타이틀먼트 `allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`이 다시 서명한 뒤에도 남아 있다.
  - 검사 스크립트
    - `pnpm verify:mac <출력 폴더>`는 `.app`과 zip 모두 같은 DR로 통과했다.
    - 실패 경로도 확인했다. 같은 앱을 명시 DR 없이 다시 서명한 사본에서는 `# designated => cdhash …`를 보여 주며 종료 코드 1로 끝났다.
  - DMG를 읽기 전용으로 붙여 안의 `Stardraft.app`도 같은 DR이고 검증을 통과했다.
  - 설치본 설정
    - `app-update.yml`은 `owner: example-owner`, `repo: stardraft`, `provider: github`이다.
    - Fuses: `RunAsNode`·`EnableNodeOptionsEnvironmentVariable`·`EnableNodeCliInspectArguments`는 꺼지고, `EnableEmbeddedAsarIntegrityValidation`·`OnlyLoadAppFromAsar`는 켜졌다.
    - Info.plist: `LSUIElement`는 true, `CFBundleIdentifier`는 `app.squadify.stardraft`, `CFBundleName`은 `Stardraft`다.
  - 환경 변수도 원격도 없을 때는 설정 단계에서 안내 문구를 내고 멈췄다.
- **로컬 Windows 빌드** (같은 Mac에서 `--win`)
  - 이 단계까지 진행했다: 패키징, Fuses, `no code signing certificate configured, signing is skipped`, `target=nsis file=Stardraft-Setup-0.1.0.exe archs=x64 oneClick=true perMachine=false`.
  - 그다음 makensis에서 `spawn Unknown system error -86`으로 멈췄다. electron-builder가 받는 makensis는 x86_64 전용인데 이 Mac에는 Rosetta가 없다.
  - exe와 `latest.yml` 실물은 windows-latest 러너에서 확인한다.
- 워크플로 YAML은 파싱으로만 확인했다. 이 Mac에 actionlint가 없다.

**확인하지 못한 것** (실행 확인은 59, Windows는 60)

- `workflow_dispatch`의 실제 실행과 아티팩트. GitHub 저장소가 아직 없다.
- Windows 설치 파일 실물: exe 이름, `latest.yml`의 size, 원클릭·사용자별 설치, 바로가기 AUMID.
- 빌드한 앱 실행. 설치본 이름(`Stardraft`)으로 켜면 실제 데이터 폴더와 키체인 항목을 건드리므로 실행하지 않았다. 59에서 DMG로 설치하며 확인한다.
- Azure 서명의 실제 실행. 비밀값이 없어 지금은 미서명이다.
