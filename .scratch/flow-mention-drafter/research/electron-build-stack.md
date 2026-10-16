# Electron 빌드 도구와 런타임 스택 조사

- 조사일: 2026-10-15
- 티켓: [데스크톱 프레임워크와 기술 스택 결정](../issues/08-desktop-stack.md)
- 전제
  - macOS·Windows 트레이 앱을 Electron 44와 TypeScript로 만든다.
  - 서명 제약은 [서명 정책 재검토](../issues/10-signing-policy-review.md)를 따른다.
    - macOS는 번들 전체 ad-hoc 서명이 필수다.
    - Windows는 미서명으로 내고, 나중에 Artifact Signing을 설정과 비밀값만으로 붙일 자리를 둔다.
  - ad-hoc 서명한 Electron 44 앱에서 macOS 알림, 클릭, 자동 시작이 동작한다는 것은 [실기 검증](../issues/11-tauri-macos-unsigned-check.md)에서 확인했다.
- 조사 방법
  - 공식 문서, 공식 저장소 소스·이슈·릴리스, npm 레지스트리만 읽었다.
  - 이 Mac(macOS 27.0.1, Apple Silicon)에서 몇 가지를 직접 실행해 봤다. 실행 스크립트와 결과물은 세션 스크래치 디렉터리에만 있고 저장소에는 넣지 않았다.
  - 표기
    - [실측]: 직접 실행한 결과
    - [문서]: 공식 문서 원문
    - [소스]: 공식 저장소 코드
    - [이슈]: GitHub 이슈와 PR
    - [npm]: 레지스트리 조회 결과
    - [추론]: 위 출처에서 끌어낸 판단. 실행해 보지 않았다.
- 기준 버전 (2026-10-15 npm 조회)

| 패키지 | 버전 | 게시일 | 비고 |
|---|---|---|---|
| electron | 44.7.2 | 2026-10-14 | Node 24.21.0, Chromium 152. 45.0.0 안정판 예정일은 2026-10-20 |
| @electron-forge/cli | 8.0.1 | 2026-09-29 | 8.0.0도 같은 날 게시. 7.x 마지막은 7.11.2 |
| @electron/packager | 20.3.0 | 2026-08-11 | Forge 8.0.1이 `^20.3.0`을 쓴다 |
| @electron/osx-sign | 2.7.1 | 2026-09-28 | packager가 쓴다. builder 26은 1.3.3 고정 |
| @electron/windows-sign | 2.1.0 | 2026-09-09 | packager가 쓴다. Forge 메이커들은 1.x를 쓴다 |
| @electron/rebuild | 4.2.1 | 2026-10-06 | |
| @electron/fuses | 2.1.3 | 2026-06-29 | |
| electron-builder | `latest` 26.15.3 / `v26` 26.17.0 / `next` 27.0.0-alpha.10 | 2026-06-09 / 2026-09-26 / 2026-10-08 | 아래 A0 참고 |
| electron-vite | 6.0.0 | 2026-10-14 | |
| better-sqlite3 | 13.0.3 | 2026-08-05 | 13부터 N-API |
| @napi-rs/keyring | 2.1.1 | 2026-10-10 | |

## 한눈에 보기

### 빌드 도구

| 항목 | Electron Forge 8.0.1 | electron-builder 26.17.0 | 직접 구현이 적은 쪽 |
|---|---|---|---|
| A1. macOS 번들 전체 ad-hoc 서명 | `osxSign`에 `identity: '-'`만 주면 키체인 검색에서 실패한다. `identityValidation: false`를 더하면 서명은 되지만 hardened runtime 기본값 때문에 **앱이 실행되지 않았다**. `hardenedRuntime: false`를 더해야 실행된다 [실측] | `mac.identity: "-"` 하나로 Helper·Framework·dylib까지 서명되고 앱이 실행됐다 [실측] | **builder** |
| A2. DMG | `maker-dmg`(appdmg 기반. appdmg 마지막 릴리스는 2023-02). macOS에서만 만든다 | dmgbuild 번들을 내려받아 쓴다. macOS에서만 만든다 | 비슷함. 둘 다 macOS 러너가 필요하다 |
| A3. Windows 설치 파일 | 기본 메이커는 Squirrel(사용자별, 관리자 권한 없음). Squirrel 이벤트 처리 코드가 필요하다. WiX는 기본이 전체 사용자 설치이고 WiX v3가 필요하다. MSIX는 실험 단계다. 공식 NSIS 메이커는 없다 | NSIS 기본값이 사용자별 설치이고 관리자 권한이 없다. 시작 메뉴 바로가기에 AUMID(`appId`)를 넣는다 | **builder** |
| A4. Windows 서명 자리 | `packagerConfig.windowsSign`이 내부 exe·dll·`.node`를 모두 서명한다. 설치 파일 서명은 메이커 설정에 따로 넣어야 하고, 메이커가 쓰는 옛 signtool은 Artifact Signing(`/dlib`) 최소 버전보다 낮다 | `win.azureSignOptions`와 환경변수 3개로 붙는다. 기본은 exe만 서명하므로 `signExts: [".dll", ".node"]`를 더해야 한다. 설치 파일과 언인스톨러도 서명한다 | builder가 조금 적다 |
| A4. 서명 설정이 없을 때 | 미서명으로 끝난다. 단 MSIX는 개발용 인증서로 자체 서명한다 | 미서명으로 끝난다(info 로그) | 같음 |
| A5. TypeScript와 번들러 | Vite 플러그인이 8.0에서 안정판으로 올라왔다(Vite 8). 패키지에 `.vite` 폴더만 넣는다 | electron-vite 6.0.0(2026-10-14)과 함께 쓴다. 의존성은 builder가 `node_modules`에서 모은다 | 네이티브 모듈이 없으면 비슷함 |
| A6. pnpm 모노레포 | `node-linker=hoisted`(또는 hoist 패턴)가 없으면 시스템 검사에서 에러를 낸다. 워크스페이스 지원 이슈(#4188)가 열려 있다 | pnpm 수집기가 격리 레이아웃과 hoisted 레이아웃을 모두 처리한다. 워크스페이스 수정은 26.16~26.17에만 있다 | **builder**. 단 `latest` 태그가 아니라 26.17.0을 써야 한다 |
| A7. 네이티브 모듈, 크로스 아키텍처 | 둘 다 `@electron/rebuild`를 쓴다. 둘 다 arm64 Mac에서 x64·universal 패키징을 지원한다 | 같음 | 같음 |
| A8. GitHub Releases 초안 | 기본이 초안이다. 공식 권장은 러너마다 `make`만 하고, 한 job에서 `release --from-make`로 올리는 방식이다 | 기본이 초안이다. 같은 태그의 초안을 찾아 다시 쓴다. 러너가 동시에 처음 올리면 초안이 둘 생길 수 있다 | 비슷함 |
| 유지 상태 | Electron 조직 프로젝트. 8.0.1(2026-09-29) | 26.17.0(2026-09-26), v27 알파 진행 중. 문서 루트는 v27 기준이다 | |

### 런타임

| 항목 | 결과 |
|---|---|
| B1. `node:sqlite` (Electron 44 main) | **동작한다. 실험 경고도 나오지 않았다** [실측]. Node 24.15.0에서 release candidate가 되면서 경고가 빠졌다. utilityProcess 안에서도 동작했다 [실측] |
| B2. better-sqlite3 | 13.0.3. 13부터 N-API라서 Electron 전용 prebuilt가 따로 없다. npm 패키지에 darwin-arm64, darwin-x64, win32-x64 바이너리가 들어 있고, Electron 44 main에서 재빌드 없이 로드됐다 [실측] |
| C1. `safeStorage` | 암호문을 앱이 저장한다. macOS Keychain에는 `<앱 이름> Safe Storage` 항목 하나가 생긴다. Windows는 DPAPI를 쓴다. **동기 API는 45에서 폐기 예고, 46(2027-01-05 예정)에서 제거된다** |
| C2. `@napi-rs/keyring` | 2.1.1. 비밀값마다 Keychain 일반 암호 항목, Windows 자격 증명 관리자 항목을 직접 만든다. N-API라 Electron 44에서 재빌드 없이 로드됐다 [실측] |
| D. utilityProcess | `child_process`, `node:sqlite`, `fetch`를 쓸 수 있다 [실측]. Electron 모듈은 `net`, `systemPreferences`만 있다 [실측·소스]. `safeStorage`, `Notification`, `Tray`는 main에서만 쓸 수 있다 |
| E. Windows 알림 | AUMID와 ToastActivatorCLSID가 있는 시작 메뉴 바로가기가 필요하다. Electron 44가 첫 알림 때 이 바로가기와 COM 등록을 스스로 만든다 [소스]. `Notification.handleActivation`은 42.0.0에 들어왔다 |
| F. 지원 OS | Electron 44는 macOS 13 이상, Windows 10 이상이다. darwin-x64를 계속 제공한다. Apple은 macOS 26 Tahoe를 Intel Mac의 마지막 릴리스로 발표했고, macOS 27 호환 목록에는 Apple Silicon만 있다 |
| G. Fuses와 asar 무결성 | ad-hoc 서명한 앱에서 asar 무결성 검증이 동작했다. 변조한 asar는 실행 시 막혔다 [실측]. `RunAsNode`를 끄면 `child_process.fork`가 막힌다 |

## A. 빌드 도구

### A0. 버전과 문서 위치 (주의)

**Electron Forge**
- 8.0.1이 최신이다. GitHub에는 v8.0.0 릴리스가 없고, v8.0.1 본문이 "Electron Forge 8" 공지다. [v8.0.1](https://github.com/electron/forge/releases/tag/v8.0.1)
- 8에서 바뀐 것 가운데 이번 조사와 관련된 것 [문서: 같은 릴리스 노트]
  - "Every `@electron-forge/*` package is ESM-only and requires Node.js 22.17 or newer." npm `engines`에는 `>= 22.13.0`으로 적혀 있어 표기가 다르다 [npm].
  - Vite 플러그인이 안정판이 됐다.
  - `publish` 명령이 `release`로 바뀌었다.
- **라이브 문서 사이트(electronforge.io)는 아직 7.x 내용이다.**
  - Node 요구 버전과 Vite "experimental" 배너가 옛 내용 그대로다.
  - 8 기준 문서는 저장소 `docs/`에 있다. [forge/docs](https://github.com/electron/forge/tree/main/docs)

**electron-builder**
- npm dist-tag가 셋이다 [npm]
  - `latest`: 26.15.3(2026-06-09)
  - `v26`: 26.17.0(2026-09-26)
  - `next`: 27.0.0-alpha.10(2026-10-08)
- 그래서 `pnpm add electron-builder`는 26.15.3을 설치한다. 아래 A6의 pnpm 수정은 26.15.6~26.17.0에 있으므로 버전을 직접 지정해야 한다.
- **문서 루트(electron.build)는 v27 알파 문서다.** v26 문서는 `/v26/` 아래에 있다.
  - v27 문법인 `mac.sign: {…}`를 26.16.1에 쓰면 `customSign is not a function`으로 실패한 사례가 있다.
  - 유지보수자 답변 원문: "the nested `mac.sign: {...}` form is new in v27 and isn't valid in v26" [이슈 #10215](https://github.com/electron-userland/electron-builder/issues/10215)
- `engines.node`는 `>=14.0.0`으로 적혀 있다. 하지만 의존하는 `@electron/rebuild` 4.x가 `>=22.12.0`을 요구하므로 실제로는 Node 22.12 이상이 필요하다 [npm, 추론].
- 아래 builder 소스 링크는 [26.17.0 태그](https://github.com/electron-userland/electron-builder/tree/electron-builder%4026.17.0/packages) 기준이다.

### A1. macOS 번들 전체 ad-hoc 서명

**실측** (Electron 44.7.2, arm64, 최소 앱. 각 결과물에 `codesign --verify --deep --strict`를 돌리고 실행 파일을 직접 실행했다)

| 변형 | 설정 | 서명 결과 | 검증 | 실행 |
|---|---|---|---|---|
| packager 기본 | `osxSign` 없음 | 앱 본체는 링커 서명만 있다 | 실패 ("code has no resources but signature indicates they must be present") | 됨 (quarantine 없는 로컬 실행) |
| packager ① | `osxSign: { identity: '-' }` | `No identity found for signing.` 에러 | - | - |
| packager ② | `{ identity: '-', identityValidation: false }` | 앱, Framework, Helper, dylib 모두 `adhoc,runtime` | 통과 | **실패.** dyld가 Electron Framework를 거부했다: "mapping process and mapped file (non-platform) have different Team IDs" |
| packager ③ | ②에 `optionsForFile: () => ({ hardenedRuntime: false, timestamp: 'none' })` 추가 | 모두 `adhoc` | 통과 | 됨. 렌더러 실행까지 확인했다 |
| builder 기본 | `mac.identity` 없음 | 이 Mac 키체인의 Apple Development 인증서를 자동으로 골라 서명을 시도했고 `unknown exception`으로 실패했다 | - | - |
| builder 기본 + `CSC_IDENTITY_AUTO_DISCOVERY=false` | | 서명을 건너뛴다 | 실패 (packager 기본과 같은 오류) | 시험 안 함 |
| builder ad-hoc | `mac.identity: "-"` | 모두 `adhoc,runtime`. 엔타이틀먼트에 `disable-library-validation`이 들어 있다 | 통과 | 됨 |

- packager 변형은 `@electron/packager` 20.3.0(내부 `@electron/osx-sign` 2.7.1)을 직접 호출했다. Forge 8.0.1의 `packagerConfig`가 이 값을 그대로 넘기므로 Forge에도 같은 결과가 나온다고 본다 [추론].
- builder 변형은 26.17.0(내부 `@electron/osx-sign` 1.3.3)으로 `--mac dir` 타깃을 만들었다.
- packager ②가 실패한 이유: ad-hoc 서명에는 Team ID가 없어서 hardened runtime의 라이브러리 검증에 걸린다. builder는 기본 엔타이틀먼트에 `com.apple.security.cs.disable-library-validation`이 있어서 통과했다.
- 이전 실기 검증의 `codesign --force --deep --sign -`에는 hardened runtime 옵션이 없었다. 그래서 같은 문제가 없었다.

**Electron Forge (osx-sign 경로)**
- ad-hoc 전용 분기가 없다 [소스: [osx-sign `util-identities.ts`](https://github.com/electron/osx-sign/blob/main/src/util-identities.ts), [`sign.ts`](https://github.com/electron/osx-sign/blob/main/src/sign.ts)]
  - `identityValidation`이 `false`가 아니면 `security find-identity` 출력에서 identity 문자열을 부분 일치로 찾는다.
  - `'-'`는 찾지 못해 throw하거나, 이름에 `-`가 든 다른 인증서를 잘못 고를 수 있다.
- 서명 대상과 순서 [소스: osx-sign `util.ts`]
  - `Contents` 아래의 모든 바이너리와 `.app`, `.framework`를 모아 깊은 경로부터 하나씩 서명한다. Helper 앱, Framework, dylib, `.node`가 모두 들어간다.
  - `--deep`은 쓰지 않는다. 끝나면 `codesign --verify --deep --strict`로 검증한다.
- 기본값
  - `hardenedRuntime: true`라서 `--options runtime`이 붙는다.
  - main 엔타이틀먼트(`default.darwin.plist`)에는 `disable-library-validation`이 없다. plugin helper에만 있다.
  - `hardenedRuntime`, `timestamp`, `entitlements`는 `optionsForFile` 반환값으로만 반영된다. `osxSign` 최상위에 두면 쓰이지 않는다 [이슈 osx-sign #366].
- **실패해도 빌드가 계속된다**
  - packager는 `continueOnError`의 기본값을 `true`로 둔다. 서명이 실패해도 경고만 남기고 넘어간다 [소스: [packager `mac.ts`](https://github.com/electron/packager/blob/main/src/mac.ts)].
  - 서명을 필수 단계로 쓰려면 `continueOnError: false`를 줘야 한다. 위 실측은 이 값을 줬다.
- `osxSign`이 없을 때 packager는 asar 사용, Electron 41 이상, macOS 호스트일 때 Electron Framework만 ad-hoc으로 다시 서명한다. 번들 전체 서명이 아니다 [소스: 같은 `mac.ts`].
- 설정 대신 `codesign`을 직접 끼우는 자리
  - Forge `postPackage` 훅: package 단계가 끝난 뒤 실행된다. [hooks 문서](https://github.com/electron/forge/blob/main/docs/config/hooks.md)
  - `make`는 package → `preMake` → 메이커 → `postMake` 순서다. 그래서 `postPackage`는 DMG 생성 전에 실행된다 [소스: [make.ts](https://github.com/electron/forge/blob/main/packages/api/core/src/api/make.ts)].
  - 단 `make --from-package`로 실행하면 package 단계 전체를 건너뛴다.
  - packager의 `afterComplete` 훅도 서명 뒤, 이동 단계에서 실행된다.

**electron-builder**
- 문서 원문 [문서: [code-signing-mac](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac)]
  - "If no valid certificate is found, signing is skipped for all architectures — electron-builder does **not** apply an ad-hoc signature automatically. To opt in to ad-hoc signing explicitly, set `mac.identity` to `"-"`"
  - 값별 동작: 미설정은 키체인을 찾고 없으면 건너뛴다. `null`은 서명을 완전히 건너뛴다. `"-"`는 ad-hoc 서명이다.
- 동작 경로 [소스: `app-builder-lib/src/mac/MacTargetHelper.ts`, `codeSign/macCodeSign.ts`]
  - 키체인 검색이 실패하고 값이 `"-"`이면 ad-hoc identity를 만들고 `identityValidation: false`로 osx-sign을 부른다.
  - 서명은 3회까지 재시도한다.
- ad-hoc에 hardened runtime이 켜져 있으면 경고를 낸다. 실측에서도 이 경고가 나왔다: "ad-hoc signing with hardenedRuntime enabled requires the com.apple.security.cs.disable-library-validation entitlement…"
  - 기본 엔타이틀먼트 템플릿에 이미 `allow-jit`, `allow-unsigned-executable-memory`, `disable-library-validation`이 있다 [소스: `templates/entitlements.mac.plist`].
  - 엔타이틀먼트 파일을 따로 지정하면 이 키를 직접 넣어야 한다 [추론].
- 서명을 건너뛰면 Electron 원래 서명이 깨진 채로 남는다. 위 실측에서 검증이 실패했다.
  - builder가 Info.plist를 고치고 Helper 이름을 바꾼 뒤 다시 서명하지 않기 때문이다 [소스: `electron/electronMac.ts`].
- 훅과 순서 [문서: [hooks](https://www.electron.build/v26/docs/features/hooks), 소스: `platformPackager.ts`]
  - `afterPack`은 "before signing", `afterSign`은 "before distributable is created"다.
  - 실제 순서는 afterPack → 퓨즈 적용 → 서명 → afterSign → DMG·zip 생성이다.
  - 그래서 afterPack에서 직접 `codesign`하면 그 뒤의 퓨즈 적용이 서명을 깬다(퓨즈를 설정한 경우) [추론].

### A2. DMG

- **Forge**
  - `maker-dmg`는 `electron-installer-dmg` 5.0.1(2024-07)을 거쳐 `appdmg` 0.6.6(2023-02)을 쓴다. 둘 다 그 뒤로 릴리스가 없다 [npm].
  - `appdmg`가 의존하는 `fs-xattr`은 설치할 때 `node-gyp rebuild`를 실행한다 [npm].
  - 원문: "You can only build the DMG target on macOS machines." [maker-dmg](https://www.electronforge.io/config/makers/dmg)
  - 8.0에서 DMG 출력 경로가 `out/make/dmg/<arch>/`로 바뀌었다 [v8.0.1 릴리스 노트].
- **builder**
  - electron-builder-binaries에서 dmgbuild 번들(Python)을 내려받아 SHA256을 확인한 뒤 실행한다. 그다음 `hdiutil`을 쓴다 [소스: `dmg-builder/src/dmgUtil.ts`].
  - 빌드 중 GitHub에서 내려받는다. `CUSTOM_DMGBUILD_PATH`로 바꿀 수 있다.
  - DMG 파일 자체는 기본으로 서명하지 않는다(`dmg.sign: false`). v26 기본 파일 시스템은 HFS+다.
  - 원문: "macOS Code Signing works only on macOS." [multi-platform-build](https://www.electron.build/v26/docs/features/multi-platform-build)
- 둘 다 macOS 러너가 필요하다.

### A3. Windows 설치 파일

**Electron의 요구 사항** [문서: [Notifications](https://www.electronjs.org/docs/latest/tutorial/notifications)]
- "For notifications on Windows, your Electron app needs to have a Start Menu shortcut with an AppUserModelID and a corresponding ToastActivatorCLSID."
- "When Electron is used together with Squirrel.Windows (e.g. if you're using electron-winstaller), shortcuts will automatically be set correctly. In production, Electron will also detect that Squirrel was used and will automatically call `app.setAppUserModelId()` with the correct value."
- Electron 44가 스스로 하는 일은 [E](#e-windows-알림-electron-44)에 정리했다. 요점은 설치 프로그램이 바로가기를 잘못 만들어도 Electron이 첫 알림 때 고친다는 것이다.

**Forge 메이커**
- **Squirrel** (`maker-squirrel`, electron-winstaller 5.4.4. 2026-06~07에 5.4.1~5.4.4가 나왔다)
  - 원문: "Squirrel.Windows is a no-prompt, no-hassle, no-admin method of installing Windows applications" [maker-squirrel](https://www.electronforge.io/config/makers/squirrel.windows)
  - 바로가기는 앱이 `--squirrel-install` 이벤트를 받아 `Update.exe --createShortcut`을 부를 때 만든다. `electron-squirrel-startup`이 이 일을 한다.
  - Forge 템플릿 `main.ts`에 `if (started) app.quit()`가 이미 들어 있다.
  - electron-winstaller README 원문: "it is **very** important that your app handle these events as _early_ as possible, and quit **immediately**". 첫 실행 때는 `--squirrel-firstrun` 인자가 온다.
  - 설치 폴더가 `app-<버전>` 하위 폴더 구조라서 자동 시작 경로나 CLI 경로를 기록할 때 이 구조를 고려해야 한다 [추론. Electron 소스 주석 "Installers sometimes put the running app in a versioned subfolder and ship a stub"].
  - pnpm에서는 electron-winstaller의 설치 스크립트가 실행되지 않으면 make가 실패한다는 보고가 있다 [이슈 #3892].
- **WiX** (`maker-wix`, electron-wix-msi 5.1.3, 2024-03)
  - 원문: "You can only build the WiX MSI target on machines with WiX Toolset v3 installed." [maker-wix](https://www.electronforge.io/config/makers/wix-msi)
  - `defaultInstallMode` 기본값이 `perMachine`(Program Files)다. `perUser`도 있지만 README에는 없다 [npm tarball 소스].
  - 바로가기에 AUMID를 넣는다. 기본값은 `com.squirrel.<shortName>.<exe>`를 소문자로 바꾼 값이다. `toastActivatorClsid` 옵션도 있다.
  - x64, ia64, x86만 지원한다. arm64는 안 된다.
- **MSIX** (`maker-msix`): "currently **experimental**", Windows SDK가 필요하다. [maker-msix](https://www.electronforge.io/config/makers/msix)
- **NSIS**: 공식 메이커가 없다. `@electron-forge/maker-nsis`는 npm에 없다. 커뮤니티 메이커만 있다 [npm].

**builder NSIS** [소스: `targets/nsis/nsisOptions.ts`, `templates/nsis/*`, 문서: [nsis](https://www.electron.build/v26/docs/nsis)]
- 기본값은 `oneClick: true`, `perMachine: false`다.
- 사용자별 설치면 `RequestExecutionLevel user`라서 관리자 권한이 필요 없다. 설치 위치는 `%LOCALAPPDATA%\Programs\<앱>`이다.
- `createStartMenuShortcut`과 `createDesktopShortcut`이 기본으로 켜져 있다.
- 바로가기에 `WinShell::SetLnkAUMI`로 AUMID를 넣는다. 값은 `appId`다(없으면 `com.electron.<name>`).
- ToastActivatorCLSID는 넣지 않는다. 이 부분은 Electron이 첫 알림 때 채운다 [소스, E 참고].
- 문서 원문: "The AUMID should be set within the Main process … `app.setAppUserModelId(appId)`". 앱이 `appId`와 같은 값을 직접 설정해야 한다.
  - electron-vite 공식 스캐폴드는 `appId: com.electron.app`인데 main에서 `setAppUserModelId('com.electron')`을 부른다. 값이 서로 다르니 그대로 쓰면 안 된다 [소스: alex8088/quick-start vanilla-ts 템플릿].
- 설치 뒤 앱을 그냥 실행한다. 업데이트 뒤에만 `--updated` 인자를 넘긴다. Squirrel식 이벤트 처리가 필요 없다 [소스: `common.nsh`].
- builder 문서도 Squirrel 타깃을 "maintained, but deprecated. Please use nsis instead."라고 적는다. [squirrel-windows](https://www.electron.build/v26/docs/squirrel-windows)

### A4. Windows 서명 자리

**Forge**
- **앱 내부 파일** (`packagerConfig.windowsSign` → `@electron/windows-sign` 2.x)
  - 패키징 디렉터리 전체를 순회해 `.exe`, `.dll`, `.node`, `.sys` 등을 모두 서명한다 [소스: [windows-sign `files.ts`](https://github.com/electron/windows-sign/blob/main/src/files.ts)]. asar 안의 파일은 디스크 파일이 아니라서 대상이 아니다 [추론].
  - 서명이 실패하면 기본으로 패키징이 실패한다 [소스: [packager `win32.ts`](https://github.com/electron/packager/blob/main/src/win32.ts)].
  - 옵션: `signToolPath`, `signWithParams`, `timestampServer`(기본 digicert), `hashes`(기본 sha1+sha256), `hookModulePath`/`hookFunction`(signtool 대신 파일마다 호출할 함수) [소스: [sign-with-signtool.ts](https://github.com/electron/windows-sign/blob/main/src/sign-with-signtool.ts)].
  - 동봉된 signtool은 SDK 10.0.26100.9169다(2.1.0). README 원문: "meets the minimum version (10.0.22621.755 or later) required by Azure Trusted Signing (`/dlib`)".
- **Artifact Signing 예제가 문서에 있다** [문서: [code-signing-windows.mdx](https://github.com/electron/forge/blob/main/docs/guides/code-signing/code-signing-windows.mdx), "Using Azure Trusted Signing"]
  - `signWithParams`에 `/dlib <dlib 경로> /dmdf <metadata.json>`, `timestampServer: "http://timestamp.acs.microsoft.com"`, `hashes: ["sha256"]`를 준다.
  - **같은 설정을 `packagerConfig.windowsSign`과 `MakerSquirrel({ windowsSign })`에 두 번 넣는다.** 예제에 `// @ts-expect-error - incorrect types exported by MakerSquirrel`가 붙어 있다.
  - Forge와 windows-sign 문서에 "Artifact Signing"이라는 새 이름은 아직 없다.
- **설치 파일**
  - 메이커는 `packagerConfig.windowsSign`을 읽지 않는다. 메이커 설정에 따로 넣어야 한다 [소스].
  - 메이커들은 `@electron/windows-sign` 1.x(최신 1.2.2)를 쓴다. 1.x에 동봉된 signtool은 10.0.22000.194라서 `/dlib` 최소 버전보다 낮다 [npm]. 메이커 단계에서 Artifact Signing을 쓰려면 `signToolPath`로 최신 signtool을 지정해야 한다 [추론].
  - WiX 메이커는 MSI만 서명한다. 바로가기 대상인 stub 런처 exe는 서명되지 않는다 [소스, 추론].
- **서명 설정이 없을 때**
  - packager, Squirrel, WiX는 서명 단계를 건너뛰고 미서명으로 끝난다 [소스].
  - MSIX는 원문 "A dev cert will be created … and the package will be signed with it!"이다. 미서명으로 끝내려면 `sign: false`를 줘야 한다.
  - 비밀값이 없을 때 `windowsSign`을 켜면 signtool이 실패한다. 비밀값이 있을 때만 설정을 넣도록 config에서 분기해야 한다. Forge 문서 예제도 그렇게 한다 [추론].

**builder**
- **Artifact Signing** [소스: `codeSign/windowsSignAzureManager.ts`, 문서: [code-signing-win](https://www.electron.build/v26/docs/features/code-signing/code-signing-win)]
  - `win.azureSignOptions`에 `publisherName`, `endpoint`, `certificateProfileName`, `codeSigningAccountName`을 준다.
  - 인증은 환경변수 `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`로 한다. 원문: "The environment variables are read directly by the `Invoke-TrustedSigning` module".
  - 처음 서명할 때 PSGallery에서 `TrustedSigning` PowerShell 모듈을 설치하고, 파일마다 `Invoke-TrustedSigning`을 실행한다. 빌드 중 네트워크가 필요하다.
  - `signtoolOptions`와 함께 쓸 수 없다.
  - v27에서는 `win.sign: { type: "azure" }`로 바뀌고 기본 경로가 `signtool /dlib`이 된다.
- **서명 범위** [소스: [winPackager.ts](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/winPackager.ts) `signApp`, `shouldSignFile`. 직접 읽어 확인했다]
  - 기본은 `.exe`만 서명한다. 앱 최상위의 exe, `app.asar.unpacked` 안의 exe, extraFiles·extraResources의 exe가 대상이다.
  - **`.dll`과 `.node`는 기본으로 서명하지 않는다.** `win.signExts: [".dll", ".node"]`를 주면 최상위와 `app.asar.unpacked`의 해당 파일까지 서명한다.
  - NSIS 설치 파일, 언인스톨러, `elevate.exe`도 서명한다. 커스텀 `nsis.script`를 쓰면 언인스톨러는 서명하지 않는다.
- **서명 설정이 없을 때**: info 로그 `no code signing certificate configured, signing is skipped`를 남기고 계속한다. `forceCodeSigning`일 때만 에러다 [소스: `windowsSignToolManager.ts`].

### A5. TypeScript와 번들러

**Forge**
- 8.0 릴리스 노트 원문: "**The Vite plugin is promoted to stable.** `@electron-forge/plugin-vite` is no longer experimental and is covered by semver." Vite 8을 쓴다. [v8.0.1](https://github.com/electron/forge/releases/tag/v8.0.1)
  - 라이브 사이트에는 아직 "As of Electron Forge v7.5.0, Vite support … has been marked as experimental"가 남아 있다.
- 템플릿 명령은 `create-electron-app --template vite --typescript`다. 별도 `vite-typescript` 템플릿 패키지는 없어졌다.
- webpack 플러그인과 템플릿에는 실험 표기가 없다. 8에서 webpack-dev-server 5로 올라갔다.
- **Vite 플러그인은 `.vite` 폴더만 패키지에 넣는다** [소스: [VitePlugin.ts](https://github.com/electron/forge/blob/main/packages/plugin/vite/src/VitePlugin.ts). 직접 읽어 확인했다]
  - `packagerConfig.ignore`를 `file => !file.startsWith('/.vite')`로 설정한다. `node_modules`는 패키지에 들어가지 않는다.
  - 문서는 네이티브 모듈을 Vite `external`로 두라고 권한다. [vite.mdx](https://github.com/electron/forge/blob/main/docs/config/plugins/vite.mdx) 하지만 external로 둔 모듈은 패키지에 복사되지 않는다.
  - 관련 이슈가 열려 있다: [#3738](https://github.com/electron/forge/issues/3738) "Forge make combined with vite is creating an incomplete asar", [#3934](https://github.com/electron/forge/issues/3934) auto-unpack-natives 미동작, [#4350](https://github.com/electron/forge/issues/4350) vite 의존성 선언 누락.
  - 추론: 네이티브 모듈을 하나도 쓰지 않으면 이 문제가 없다. `node:sqlite`와 `safeStorage` 조합이 그렇다.

**builder + electron-vite**
- electron-vite 6.0.0(2026-10-14). peer는 `vite ^6 || ^7 || ^8`, Node `^20.19.0 || >=22.12.0` [npm].
  - 저장소는 활성 상태다. 마지막 커밋은 2026-10-14다. [alex8088/electron-vite](https://github.com/alex8088/electron-vite)
  - 공식 문서 사이트는 아직 v5 기준이다.
- 스캐폴드: `npm create @quick-start/electron@latest`. 실제 패키지는 `@quick-start/create-electron` 1.0.31(2026-10-14)이다.
  - vanilla-ts 템플릿에 `electron ^44.7.2`, `electron-builder ^26.15.3`, `electron-vite ^6.0.0`, `vite ^8.3.4`가 들어 있다.
- 패키징은 builder가 `node_modules`에서 production 의존성을 모으므로, external로 둔 네이티브 모듈도 들어간다 [소스: node-module-collector].

### A6. pnpm 워크스페이스

**Forge**
- 문서 원문: "Its module resolution algorithm is naive and doesn't take into account symlinked dependencies … If you are using pnpm, please set `node-linker=hoisted` in your project's `.npmrc` configuration." [forge/docs/index.md](https://github.com/electron/forge/blob/main/docs/index.md)
- 시스템 검사가 이를 강제한다 [소스: [check-system.ts](https://github.com/electron/forge/blob/main/packages/api/cli/src/util/check-system.ts)]
  - pnpm 8 이상을 요구한다.
  - `node-linker=hoisted`나 `hoist-pattern`/`public-hoist-pattern`이 없으면 에러를 낸다.
- pnpm 템플릿은 `pnpm-workspace.yaml`에 `nodeLinker: hoisted`와 `allowBuilds: { electron: true, electron-winstaller: true }`를 넣는다 [소스: [pnpm-workspace.yaml 템플릿](https://github.com/electron/forge/blob/main/packages/template/base/tmpl/pnpm-workspace.yaml)].
- **모노레포 이슈** [#4188](https://github.com/electron/forge/issues/4188) "Support pnpm workspace"(열림)
  - hoisted로 하면 의존성이 워크스페이스 루트 `node_modules`로 올라간다. Forge는 앱 폴더의 `node_modules`를 기대해서 네이티브 모듈 해석에 실패한다.
- 7.x에서 pnpm `blockExoticSubdeps` 때문에 설치가 실패하던 문제는 8에서 고쳐졌다 [v8.0.1 릴리스 노트].

**builder**
- 문서에 pnpm 설정 요구가 없다 [문서].
- pnpm 수집기가 `pnpm list --prod --json --depth Infinity`를 쓰고, 격리 레이아웃과 hoisted 레이아웃을 모두 처리한다 [소스: `node-module-collector/pnpmNodeModulesCollector.ts`].
- 최근 pnpm 수정은 **모두 npm `latest`(26.15.3)에 없다** [문서: release/v26 CHANGELOG]
  - 26.17.0 #10189: 워크스페이스 루트를 `pnpm-workspace.yaml`로 찾는다. 원문: "on Windows the root silently resolved to `undefined`… shipped transitive native modules… for the wrong architecture"
  - 26.17.0 #10230: pnpm 11과 `node-linker=hoisted` 워크스페이스 처리
  - 26.17.0 #10207: pnpm 10.29.3 이상에서 의존성이 빠지던 문제
  - 26.15.6 #9950: 워크스페이스 하위 패키지의 production 의존성을 asar에 넣는다
- electron-vite 문서는 pnpm 사용자에게 `.npmrc`에 `shamefully-hoist=true`를 권한다. [troubleshooting](https://electron-vite.org/guide/troubleshooting)
- 모노레포 옵션: `directories.app`, `extraMetadata`. 문서에 두 패키지 구조 예시가 있다.
- 트레이 아이콘은 `directories.buildResources`에 두면 패키지에 들어가지 않는다. 원문: "build resources are not packed into the app … e.g. as tray icon, please include required files explicitly"

### A7. 네이티브 모듈과 크로스 아키텍처

- **재빌드**
  - Forge: `rebuildConfig`가 `@electron/rebuild` 옵션으로 그대로 넘어간다. package와 start 때 실행된다. [configuration.mdx](https://github.com/electron/forge/blob/main/docs/config/configuration.mdx)
  - builder: `npmRebuild`가 기본 `true`다. 타깃 arch마다 `@electron/rebuild`를 실행한다 [소스: `util/yarn.ts`].
  - [실측] better-sqlite3 13.0.3에 `@electron/rebuild` 4.2.1을 `--force`로 돌리면 2초 만에 끝난다. 실제 컴파일은 하지 않는다.
    - `binding.gyp`가 호스트용 prebuilt가 있으면 빌드 대상을 `type: none`으로 바꾸기 때문이다 [소스: better-sqlite3 `binding.gyp`].
- **arm64 Mac에서 x64·universal**
  - Forge·packager: `--arch=x64`, `universal`을 지원한다. universal은 슬라이스를 각각 만들고 rebuild한 뒤 `@electron/universal`로 합치고, 합친 앱에만 서명한다 [소스].
    - `osxSign` 없이 universal을 만들면 실패한다는 열린 이슈가 있다 [packager #1952](https://github.com/electron/packager/issues/1952).
  - builder: `--x64`, `--arm64`, `--universal`을 지원한다. 원문: "the most reliable approach is to build `arm64` on Apple Silicon and `x64` on Intel" [mac](https://www.electron.build/v26/docs/mac)
  - `@electron/rebuild`는 다른 OS로의 교차 빌드만 막는다. 같은 macOS에서 arch만 다른 경우는 막지 않는다 [소스: rebuild `node-gyp.ts`].
  - better-sqlite3 13은 모든 플랫폼 바이너리를 한 패키지에 넣는다. 그래서 arm64 러너에서 x64 앱을 만들어도 x64 바이너리가 이미 있다 [npm tarball, 추론].
  - `@napi-rs/keyring`은 플랫폼별 optionalDependencies 구조다. pnpm은 기본으로 호스트 플랫폼 패키지만 설치하므로, 교차 빌드에는 pnpm `supportedArchitectures` 설정이 필요할 것으로 본다 [추론].

### A8. GitHub Releases 초안

**Forge** (`@electron-forge/publisher-github`) [소스: [PublisherGitHub.ts](https://github.com/electron/forge/blob/main/packages/publisher/github/src/PublisherGitHub.ts)]
- `draft` 기본값은 `true`, `prerelease` 기본값은 `false`다. 태그는 `v<version>`이다.
- 토큰은 `authToken` 설정이나 `GITHUB_TOKEN`이다. 권한은 `contents: write`가 필요하다.
- 같은 태그 릴리스를 `listReleases({ per_page: 100 })` 첫 페이지에서 찾는다. 초안도 찾는다. 없으면 새로 만든다.
  - 중복 방지는 같은 프로세스 안에서만 된다 [PR #4327].
  - 그래서 mac과 win 러너가 각자 동시에 올리면 초안이 둘 생길 수 있다 [추론].
- 8의 권장 방식: 각 러너는 `make`만 하고 `out/make/`와 `out/make-results/`를 아티팩트로 남긴다. 한 job에서 `release --from-make`로 한 번에 올린다 [문서: [cli.md](https://github.com/electron/forge/blob/main/docs/cli.md) "Releasing from CI"].

**builder** [소스: `electron-publish/src/gitHubPublisher.ts`, 문서: [publish](https://www.electron.build/v26/docs/publish)]
- `releaseType` 기본값은 `draft`다. 토큰은 `GITHUB_RELEASE_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` 순서로 읽는다.
- `--publish` 값은 `onTag`, `onTagOrDraft`, `always`, `never`다. 값을 생략했을 때의 암묵 규칙은 v26에서 폐기 예고됐고 v27에서 사라진다.
- 같은 태그의 초안이 있으면 다시 쓴다. 같은 이름의 파일은 지우고 다시 올린다.
- 공식 GitHub Actions 예시는 mac과 windows 잡이 각각 `--publish always`를 실행한다. [github-actions](https://www.electron.build/v26/docs/features/github-actions)
- 한 실행 안에서 병렬 업로드할 때 초안이 중복 생성되던 버그(#10026)는 27 알파에서만 고쳐졌다. 러너 사이에는 잠금이 없다 [이슈, 추론].

### A9. 직접 구현량 비교 (추론)

위 사실을 제약 네 가지에 맞춰 정리한다. 결정은 티켓에서 한다.

| 제약 | Forge에서 직접 넣을 것 | builder에서 직접 넣을 것 |
|---|---|---|
| macOS ad-hoc 서명 | `osxSign`에 `identity`, `identityValidation: false`, `continueOnError: false`, `optionsForFile`(hardened runtime 끄기 또는 엔타이틀먼트 추가) | `mac.identity: "-"` |
| Windows 빌드 안 서명 자리 | 비밀값이 있을 때만 `windowsSign` 설정. 같은 설정을 Squirrel 메이커에 한 번 더. 메이커용 최신 `signToolPath` | 비밀값이 있을 때만 `azureSignOptions`. `signExts: [".dll", ".node"]` |
| 사용자별 설치와 알림 | Squirrel 이벤트 처리(템플릿 포함). 또는 비공식 NSIS 메이커 | `app.setAppUserModelId(appId)` |
| pnpm 모노레포 | `node-linker=hoisted`. 워크스페이스 루트 hoist 문제를 우회 | 26.17.0 이상으로 고정 |

- builder 쪽이 설정 항목 수가 적다.
- Forge가 나은 점
  - Electron 조직이 유지한다.
  - `windowsSign`이 기본으로 dll과 `.node`까지 서명한다.
  - CI 업로드 방식(`release --from-make`)이 공식 문서로 정리돼 있다.
- builder의 위험
  - npm `latest` 태그가 4개월 전 버전에 머물러 있다.
  - v27로 넘어가면 서명 설정 문법(`mac.sign`, `win.sign`)이 바뀐다.

## B. SQLite

### B1. `node:sqlite` (Electron 44 main 프로세스)

**실측** (2026-10-15)
- 실행 방법
  - 저장소에 설치된 Electron 44.7.2 바이너리(`Electron.app/Contents/MacOS/Electron`)에 스크래치 디렉터리의 앱 폴더를 넘겨 실행했다.
  - `ELECTRON_RUN_AS_NODE`는 설정하지 않았다.
- 결과 (stdout 원문 일부)
  ```
  [main] process.type: browser
  [main] versions: {"electron":"44.7.2","node":"24.21.0","chrome":"152.0.7977.149","sqlite":"3.53.4","modules":"149"}
  [main] sqlite(main): {"rows":[{"id":1,"body":"hello"},{"id":2,"body":"세계"}],"version":"3.53.4","journal":{"journal_mode":"wal"},"count":1}
  [main] warnings(main): []
  [utility] process.type: utility
  [utility] sqlite(utility): [{"x":42}]
  ```
  - 메모리 DB 생성, 테이블 생성, prepared statement 삽입·조회, 한글 문자열을 확인했다.
  - 파일 DB, `PRAGMA journal_mode = WAL`, 트랜잭션도 동작했다.
  - stderr는 비어 있었다.
- **실험 경고가 나오지 않았다.**
  - `process.on('warning')`에 아무것도 잡히지 않았다.
  - 대조 실험: 같은 main에서 `process.emitWarning(…, 'ExperimentalWarning')`을 부르니 stderr와 핸들러에 모두 나왔다. 그러니 경고가 숨겨진 게 아니라 발생하지 않은 것이다.
- utilityProcess 안에서도 같은 코드가 동작했다(D 참고).

**문서와 소스**
- Node 24 문서의 Stability는 "1.2 - Release candidate"이고, 변경 이력에 "v24.15.0: SQLite is now a release candidate."가 있다. [node:sqlite (v24)](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
  - 해당 변경은 [nodejs/node#61262](https://github.com/nodejs/node/pull/61262) "sqlite: mark as release candidate"이고, 24.15.0(2026-04-15)에 들어갔다.
- 경고가 사라진 이유 [소스]
  - [v24.14.0 `lib/sqlite.js`](https://github.com/nodejs/node/blob/v24.14.0/lib/sqlite.js)에는 `emitExperimentalWarning('SQLite')`가 있다.
  - [v24.21.0 `lib/sqlite.js`](https://github.com/nodejs/node/blob/v24.21.0/lib/sqlite.js)는 `module.exports = internalBinding('sqlite');` 한 줄이다.
- Electron 쪽 이력 [이슈]
  - Electron 37.2.0에서 `No such binding: sqlite` 회귀가 있었다. [#47671](https://github.com/electron/electron/issues/47671)
  - [PR #47706](https://github.com/electron/electron/pull/47706)(2025-07-15)으로 고쳤다. Node 빌드 옵션이 Electron GN 빌드에 옮겨지지 않은 것이 원인이었다.
  - Electron CI는 Node 자체 테스트를 Electron 실행 파일로 돌린다. 44 브랜치에서 비활성화된 sqlite 테스트는 `parallel/test-sqlite-backup` 하나다 [소스: [node-disabled-tests.json](https://github.com/electron/electron/blob/44-x-y/script/node-disabled-tests.json), [node-spec-runner.js](https://github.com/electron/electron/blob/44-x-y/script/node-spec-runner.js)].
- 이전 조사([트레이 앱 프레임워크 조사](tray-app-framework.md) 6절)의 "Node 24에서 아직 실험 단계" 기술은 24.15.0 이전 기준이다. 지금은 맞지 않는다.
- 추론
  - 44.0.0도 Node 24.18.1을 쓴다([Release Schedule](https://releases.electronjs.org/schedule)). 그래서 44.x 전체에서 경고가 없다고 본다.
  - 45와 46도 Node 24.21.0을 쓸 예정이다(같은 표).

### B2. better-sqlite3

- 최신은 13.0.3(2026-08-05)이다. `engines.node >=22` [npm].
- **13.0.0부터 N-API다** [v13.0.0 릴리스 노트](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0)
  - 원문: "the first version of `better-sqlite3` to run on the N-API. This means prebuilt binaries should theoretically work across different versions of Node.js and Electron … prebuilt binaries are published directly with the `better-sqlite3` code itself."
  - 그래서 "Electron 44용 prebuilt"가 따로 없다. GitHub 릴리스에도 자산이 없다.
- npm 패키지에 들어 있는 바이너리 [npm tarball]
  - `prebuilds/` 아래 darwin-arm64, darwin-x64, win32-x64, win32-arm64, linux·linuxmusl(x64, arm64)
  - 내장 SQLite는 3.53.4다.
  - `install` 스크립트가 없다.
- **[실측]** Electron 44.7.2 main에서 재빌드 없이 로드됐다.
  ```
  [bsq] process.type=browser electron=44.7.2 modules=149 row={"x":"ok","v":"3.53.4"}
  ```
  - darwin-arm64만 확인했다. darwin-x64와 win32-x64는 실행해 보지 않았다.
- 저장소 문제 해결 문서는 아직 `electron-rebuild`를 쓰고 asar 밖으로 unpack하라고 적는다. [troubleshooting.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/troubleshooting.md)
  - unpack은 여전히 필요하다. `.node` 파일은 asar 안에서 로드할 수 없기 때문이다 [추론].

## C. 비밀 저장

### C1. Electron 44 `safeStorage`

- **macOS Keychain 항목** [소스]
  - 서비스 이름은 `<앱 이름> Safe Storage`, 계정 이름은 `<앱 이름> Key`다.
    - [electron_browser_main_parts.cc](https://github.com/electron/electron/blob/44-x-y/shell/browser/electron_browser_main_parts.cc)
    - [계정 접미사 패치](https://github.com/electron/electron/blob/44-x-y/patches/chromium/feat_ensure_mas_builds_of_the_same_application_can_use_safestorage.patch)
  - 앱 이름은 `app.setName` 값, 없으면 `package.json`의 `productName`(없으면 `name`)이다.
  - 이름은 메인 스크립트가 실행된 뒤에 확정된다. 그래서 `app.setName()`은 메인 스크립트 최상위에서 동기로 불러야 반영된다 [추론].
  - 앱 하나에 항목 하나다. 이 항목에 든 키로 문자열을 암호화하고, 암호문은 앱이 파일이나 DB에 직접 저장한다.
  - 동기 API와 비동기 API가 같은 Keychain 항목을 쓴다 [소스: Chromium `keychain_key_provider.mm`].
  - 관련 열린 이슈
    - [#45328](https://github.com/electron/electron/issues/45328): ready 전에 부르면 `Chromium Safe Storage` 항목이 생긴다는 보고
    - [#40430](https://github.com/electron/electron/issues/40430): Keychain 이름을 따로 지정하게 해 달라는 요청
- **API** [문서: [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)]
  - 동기: `isEncryptionAvailable`, `encryptString`, `decryptString`
  - 비동기: `isAsyncEncryptionAvailable`, `encryptStringAsync`, `decryptStringAsync`(결과는 `{ shouldReEncrypt, result }`)
  - 비동기 API는 42.0.0에 들어왔다. [PR #49054](https://github.com/electron/electron/pull/49054)
  - 44 문서 원문: "We recommend using the asynchronous API … The synchronous API may be deprecated in a future version of Electron."
  - **동기 API의 폐기 일정이 확정됐다** [문서: [breaking-changes.md](https://github.com/electron/electron/blob/main/docs/breaking-changes.md)]
    - 45에서 폐기 예고: "The synchronous `safeStorage` methods are deprecated and will be removed in Electron 46"
    - 46에서 제거된다. 원문: "Data encrypted with `safeStorage.encryptString()` by earlier versions of Electron decrypts with `safeStorage.decryptStringAsync()`."
    - 일정: 45 안정판 2026-10-20, 46 안정판 2027-01-05, 44 지원 종료 2027-03-02 [Release Schedule](https://releases.electronjs.org/schedule)
  - `isEncryptionAvailable` 문서 원문: "On MacOS, returns true if Keychain is available. On Windows, returns true once the app has emitted the `ready` event."
    - 그런데 44 소스는 모든 플랫폼에서 ready 전이면 `false`를 돌려준다. ready 전에 암호화 함수를 부르면 "safeStorage cannot be used before app is ready"를 던진다 [소스: [electron_api_safe_storage.cc](https://github.com/electron/electron/blob/44-x-y/shell/browser/api/electron_api_safe_storage.cc)].
  - 원문: "on macOS, access to the system Keychain is required and these calls can block the current thread to collect user input."
  - main 프로세스에서만 쓸 수 있다.
- **Windows는 DPAPI다**
  - 동기 API 원문: "Encryption keys are generated via DPAPI… content is protected from other users on the same machine, but not from other apps running in the same userspace."
  - 비동기 API 원문: "Encryption keys are protected via DPAPI."
  - DPAPI로 보호한 키를 userData의 `Local State`에 두는 구조로 보인다 [소스·추론: `browser_process_impl.cc`].
  - Windows 자격 증명 관리자에는 아무것도 저장하지 않는다.
- **ad-hoc 서명과 업데이트 뒤 재허용**
  - 원문: "Without a valid, consistent code signature, macOS may be unable to tell that two builds of your unsigned app are "the same app", which can cause the Keychain to prompt the user for permission again after every update." [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
  - 유지보수자 답변 원문: "This won't happen if your app is codesigned correctly, the ACL is based on the app bundle ID + the team ID… If you aren't signing your app this is going to happen constantly" [#43233](https://github.com/electron/electron/issues/43233#issuecomment-2327571820) (not planned로 닫힘)
  - 같은 문서는 `cookieEncryption` 퓨즈에도 같은 요구가 있다고 적는다. Forge 템플릿은 이 퓨즈를 켠다(G 참고).

### C2. keytar를 대체하는 모듈

- **keytar**: [atom/node-keytar](https://github.com/atom/node-keytar)가 보관(archived) 처리됐다. 마지막 push는 2022-12-12다. npm 7.9.0(2022-02-17)에 deprecated 표시는 없다.
- **`@napi-rs/keyring` 2.1.1** (2026-10-10) [npm, [Brooooooklyn/keyring-node](https://github.com/Brooooooklyn/keyring-node)]
  - 유지 상태: 2.0.0(2026-08-31), 2.1.0(2026-09-13), 2.1.1이 나왔다. 저장소는 보관되지 않았고 MIT다.
  - prebuilt(optionalDependencies): darwin-x64, darwin-arm64, win32-x64-msvc, win32-arm64-msvc, win32-ia32-msvc, linux 여러 종, freebsd-x64
  - 저장 위치 [소스: `Cargo.toml`]
    - keyring-rs 계열 크레이트(`keyring-core` 1.0, `apple-native-keyring-store`, `windows-native-keyring-store`)를 쓴다.
    - macOS: login Keychain의 일반 암호 항목이다. service와 account 속성에 앱이 정한 값이 들어간다.
    - Windows: 자격 증명 관리자의 일반 자격 증명이다. 원문: "uses the Windows Credential Manager as its back end… Each entry in keyring is mapped to a _generic credential_"
  - API: 동기 `Entry`, 비동기 `AsyncEntry`, `findCredentials(Async)`. keytar 호환 shim도 들어 있다.
  - **[실측]** Electron 44.7.2 main에서 재빌드 없이 로드됐다. 내보낸 이름: `AsyncEntry,Entry,EntryTask,FindCredentials,LinuxStore,PasswordTask,SecretTask,findCredentials,findCredentialsAsync`
    - Keychain에 실제로 읽고 쓰지는 않았다. 사용자 Keychain을 건드리지 않으려고 로드만 확인했다.
- 그 밖의 후보 [npm]
  - `@github/keytar` 7.10.6(2026-02-06): GitHub이 keytar를 이어받은 포크다. 저장소는 보관되지 않았고, N-API prebuild를 패키지에 넣는다.
  - `cross-keychain` 1.1.0(2025-10): `@napi-rs/keyring`을 감싼 래퍼다.
  - `@postman/node-keytar`: 마지막 공개 버전은 7.9.3(2023-03)이고, 저장소 링크는 404다.

### C3. `safeStorage`와 keyring 모듈의 차이

| | `safeStorage` | `@napi-rs/keyring` |
|---|---|---|
| 저장 방식 | Keychain 키 하나로 암호화한다. 암호문은 앱이 저장한다 | 비밀값마다 OS 저장소에 직접 넣는다 |
| macOS | `<앱 이름> Safe Storage` 항목 하나 | 앱이 정한 service/account 항목 |
| Windows | DPAPI. 같은 사용자의 다른 앱으로부터는 보호하지 못한다 | 자격 증명 관리자 |
| 추가 의존성 | 없다(내장) | 네이티브 모듈. N-API라 재빌드는 필요 없다 |
| 쓸 수 있는 프로세스 | main만 | 어디서나(Node 모듈) [추론] |
| API 수명 | 동기 API는 46에서 제거된다. 비동기 API는 42 이상 | 동기·비동기 모두 있다 |
| ad-hoc 서명의 업데이트 뒤 재허용 | 문서에 명시돼 있다 | Keychain ACL이 서명에 묶이므로 같을 것으로 본다 [추론] |
| Forge Vite 패키징 | 문제없음 | 네이티브 모듈이라 A5의 패키징 문제를 우회해야 한다 |

## D. 프로세스 구조: utilityProcess

- 문서 원문: "`utilityProcess` creates a child process with Node.js and Message ports enabled. It provides the equivalent of `child_process.fork` API from Node.js but instead uses Services API from Chromium" [utility-process](https://www.electronjs.org/docs/latest/api/utility-process)
  - "`utilityProcess.fork` can only be called after the `ready` event has been emitted on `App`."
  - fuses 문서는 RunAsNode의 대안으로 "a SQLite server process" 같은 용도의 utility process를 든다. [Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)
- **[실측]** utilityProcess 안에서 확인한 것 (Electron 44.7.2)
  ```
  [utility] process.type: utility
  [utility] sqlite(utility): [{"x":42}]
  [utility] child_process(utility): child-ok
  [utility] typeof fetch: function
  [utility] electron module keys: ["net","systemPreferences"]
  [utility] electron.safeStorage: undefined
  [utility] electron.Notification: undefined
  [utility] electron.Tray: undefined
  ```
  - `node:sqlite`, `child_process.spawnSync`, 전역 `fetch`가 동작했다.
  - `require('electron')`에는 `net`과 `systemPreferences`만 있다. 소스 목록과 같다. [module-list.ts](https://github.com/electron/electron/blob/44-x-y/lib/utility/api/module-list.ts)
- **main에서만 쓸 수 있는 것**: `safeStorage`, `Notification`, `Tray`, `MessageChannelMain`. 문서의 Process 표기가 Main뿐이다.
  - utility process에서 `safeStorage`를 쓰게 해 달라는 요청은 not planned로 닫혔다. [#42869](https://github.com/electron/electron/issues/42869)
  - 그래서 utility process가 API 키를 쓰려면 main이 복호화해서 메시지로 넘겨야 한다 [추론].
- **통신**
  - main: `child.postMessage(message, [MessagePortMain…])`, `child.on('message')`
  - 자식: `process.parentPort.on('message')`, `process.parentPort.postMessage`
  - `MessageChannelMain`으로 렌더러와 직접 MessagePort를 연결할 수 있다. [Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- **옵션**
  - `env`(기본 `process.env`), `execArgv`, `cwd`, `serviceName`(기본 "Node Utility Process")
  - `stdio`: stdout과 stderr만 `pipe|inherit|ignore`를 고를 수 있다. stdin은 `ignore`만 된다.
  - `allowLoadingUnsignedLibraries`(macOS): `Electron Helper (Plugin).app`으로 실행된다.
  - `disclaim`(macOS TCC), `respondToAuthRequestsFromMainProcess`
  - utility process의 `net`은 defaultSession이 아니라 별도 네트워크 컨텍스트를 쓴다. 44에는 `session`/`partition` 옵션이 있다 [이슈 #44727].
- 46 예정 변경: `child.kill()`이 더는 SIGKILL로 강제 종료하지 않는다 [breaking-changes.md].

## E. Windows 알림 (Electron 44)

- **요건** [문서: [Notifications](https://www.electronjs.org/docs/latest/tutorial/notifications)]
  - 시작 메뉴 바로가기에 AppUserModelID와 ToastActivatorCLSID가 있어야 한다(A3 원문).
  - `app.setToastActivatorCLSID(id)` 원문: "If this method is never called, a random CLSID is generated once per run… should be called early (before showing notifications) so the value is baked into the registration/shortcut." [app](https://www.electronjs.org/docs/latest/api/app)
- **Electron 44가 스스로 하는 일** [소스: [windows_toast_activator.cc](https://github.com/electron/electron/blob/44-x-y/shell/browser/notifications/win/windows_toast_activator.cc). 직접 읽어 확인했다]
  - MSIX가 아닌 앱이면 다음을 한다.
    1. 사용자 시작 메뉴 Programs 폴더(`FOLDERID_Programs`)에 `<제품 이름>.lnk`를 확인한다. AUMID, ToastActivatorCLSID, 대상 경로가 맞지 않으면 새로 쓴다.
    2. `HKCU\Software\Classes\CLSID\{clsid}\LocalServer32`에 실행 파일 경로를 등록한다.
    3. `CoRegisterClassObject`로 COM 활성화를 받는다.
  - 이미 있는 바로가기에 CLSID가 있으면 그 값을 재사용한다.
  - 버전 하위 폴더에 실행 파일이 있고 한 단계 위에 같은 이름의 stub이 있으면(Squirrel 구조) 바로가기를 stub으로 향하게 한다.
  - AUMID를 지정하지 않으면 `electron.app.<제품 이름>`이 된다 [소스: `application_info_win.cc`].
  - 이 등록은 `new Notification()`이나 `Notification.isSupported()`를 처음 부를 때 일어난다. `handleActivation()`만 불러서는 일어나지 않는다 [소스].
  - 추론
    - 설치 프로그램 종류와 무관하게 첫 알림 때 바로가기가 맞춰진다.
    - 설치 프로그램 바로가기 이름이 제품 이름과 다르거나 하위 폴더에 있으면, 시작 메뉴에 바로가기가 둘 생길 수 있다.
- **`Notification.handleActivation`**
  - 42.0.0에 들어왔다. [PR #49919](https://github.com/electron/electron/pull/49919) "feat: implements cold COM activation"(2026-03-05 병합)
  - 42.0.0 릴리스 노트 원문: "Added `Notification.handleActivation(callback)` API on Windows to handle notification clicks, replies, and action buttons - including when the app is launched from a notification (cold start)."
  - 문서 원문: "invoked whenever a notification is clicked, replied to, or has an action button pressed - regardless of whether the original `Notification` object is still in memory" [Notification](https://www.electronjs.org/docs/latest/api/notification)
    - 적용되는 경우: 알림 클릭으로 앱이 시작될 때, 재시작 뒤 알림 센터에 남은 알림, 알림 객체가 GC된 경우, 객체가 살아 있는 경우(인스턴스 이벤트와 함께 호출)
    - 콜백 등록 전에 온 활성화는 저장했다가 등록 즉시 넘긴다.
- **알림 센터로 넘어간 알림을 앱 실행 중에 클릭할 때**
  - 문서에 직접적인 답이 없다.
  - 소스 흐름 [소스, 추론]
    - 인스턴스 `click`은 토스트 객체의 WinRT `Activated` 이벤트로 발생한다.
    - 타임아웃으로 알림 센터로 넘어가도 객체를 파기하지 않는다.
    - 하지만 알림 센터에서의 클릭은 COM 활성화로 들어올 가능성이 높다. 그러면 인스턴스 `click` 대신 `handleActivation` 콜백(`type: 'click'`)으로 받는다고 본다.
  - 옛 이슈 [#29461](https://github.com/electron/electron/issues/29461) "Notifications fail to trigger "click" when clicked in Windows 10 Action Center"는 not planned로 닫혔다. 2026-06-25에 "42.5.0에서도 안 된다"는 사용자 댓글이 있다.
  - 추론: 클릭 처리는 `handleActivation`에 두는 편이 안전하다. 실기 확인이 필요하다.
- Microsoft 원문: "Notifications in the action center can stay around for several days… you can't assume that your app will be running… you will need to create a local Component Object Model (COM) server" [Respond to toast activations](https://learn.microsoft.com/en-us/previous-versions/windows/desktop/win32_tile_badge_notif/respond-to-toast-activations)

## F. 지원 OS

- **Electron 44** [문서: [README Platform support (44-x-y)](https://github.com/electron/electron/blob/44-x-y/README.md)]
  - "macOS (Ventura and up): Electron provides 64-bit Intel and Apple Silicon / ARM binaries"
  - "Windows (Windows 10 and up): Electron provides `x64` (`amd64`) and `arm64` binaries"
  - 44 breaking change 원문: "macOS 13 (Ventura) or later will be required to run Electron v44.0.0 and higher." ia32 Windows는 44에서 빠졌다.
  - v44.7.2 릴리스에는 `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64` zip이 있다. [v44.7.2](https://github.com/electron/electron/releases/tag/v44.7.2)
  - Electron이 Intel Mac 지원을 끝낸다는 공식 발표는 찾지 못했다.
- **Apple**
  - WWDC25 Platforms State of the Union 원문: "And so, macOS Tahoe will be the final release for Intel Macs." [WWDC25 102](https://developer.apple.com/videos/play/wwdc2025/102/)
  - "macOS 27 Golden Gate is compatible with these computers"(2026-09-14 게시) 원문: "If you have a Mac with Apple silicon, you can upgrade to macOS 27." 목록에 Intel 기종이 없다. [127255](https://support.apple.com/en-us/127255)
  - macOS 26 Tahoe 호환 목록에는 2019~2020년 Intel 기종 일부가 있다. [122867](https://support.apple.com/en-us/122867)
  - 결론: macOS 27은 Intel Mac을 지원하지 않는다. Intel Mac 사용자는 macOS 26 이하에 머문다.

## G. Electron Fuses

- **44의 퓨즈와 기본값** [소스: [fuses.json5](https://github.com/electron/electron/blob/44-x-y/build/fuses/fuses.json5)]
  - 켜짐: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`, `GrantFileProtocolExtraPrivileges`, `WasmTrapHandlers`
  - 꺼짐: `EnableCookieEncryption`, `EnableEmbeddedAsarIntegrityValidation`, `OnlyLoadAppFromAsar`, `LoadBrowserProcessSpecificV8Snapshot`
- **이 앱과 관련된 것** [문서: [Fuses](https://www.electronjs.org/docs/latest/tutorial/fuses)]
  - `RunAsNode`: 원문 "With this fuse disabled, `child_process.fork` throws … Instead, we recommend that you use Utility Processes"
    - 실제로 "child_process.fork() is not supported when the runAsNode fuse is disabled; use utilityProcess.fork() instead"를 던진다 [소스: [lib/node/init.ts](https://github.com/electron/electron/blob/44-x-y/lib/node/init.ts)].
    - `spawn`과 `execFile`로 외부 CLI(`claude`)를 실행하는 것은 영향을 받지 않는다 [추론].
  - `EnableNodeOptionsEnvironmentVariable`: 끄면 `NODE_OPTIONS`와 `NODE_EXTRA_CA_CERTS`를 함께 무시한다. 사내 프록시 인증서를 `NODE_EXTRA_CA_CERTS`로 넣는 환경이라면 영향이 있다 [추론].
  - `EnableNodeCliInspectArguments`: 끄면 `--inspect`와 SIGUSR1 inspector를 막는다.
  - `EnableCookieEncryption`: 원문 "one-way transition"이다. macOS에서는 Keychain을 쓰므로 `safeStorage`와 같은 서명 요구가 있다. [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
  - `GrantFileProtocolExtraPrivileges`: 원문 "If you aren't serving pages from `file://`, you should disable this fuse."
- **Forge 템플릿 기본 퓨즈** [소스: [vite 템플릿 forge.config.mts](https://github.com/electron/forge/blob/main/packages/template/vite/tmpl/forge.config.mts)]
  - `RunAsNode: false`, `EnableCookieEncryption: true`, `EnableNodeOptionsEnvironmentVariable: false`, `EnableNodeCliInspectArguments: false`, `EnableEmbeddedAsarIntegrityValidation: true`, `OnlyLoadAppFromAsar: true`
  - `EnableCookieEncryption: true`라서 ad-hoc 앱에서는 쿠키 암호화 때문에도 Keychain 접근이 생긴다 [추론].
  - FusesPlugin은 `packageAfterCopy` 훅에서 퓨즈를 바꾼다. packager 서명보다 앞이다 [소스: [FusesPlugin.ts](https://github.com/electron/forge/blob/main/packages/plugin/fuses/src/FusesPlugin.ts)].
  - builder는 `electronFuses` 설정으로 퓨즈를 바꾼다. 서명 직전에 적용한다(A1).
- **순서**: 퓨즈 적용 → 서명. 원문: "Call this after your app has been packaged… but before code signing" [@electron/fuses](https://github.com/electron/fuses)
- **asar 무결성** [문서: [ASAR Integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity)]
  - macOS는 `electron>=16.0.0`, Windows는 `electron>=30.0.0`부터 지원한다.
  - macOS는 Info.plist의 `ElectronAsarIntegrity`에 asar 헤더 해시를 둔다. Windows는 리소스 `Integrity/ElectronAsar`에 둔다.
  - `OnlyLoadAppFromAsar`를 함께 켜라고 권한다. 원문: "Otherwise, the validity checking can be bypassed"
  - Electron 41부터는 Info.plist 무결성 딕셔너리의 해시도 Electron Framework 바이너리에 기록해 검증한다. packager가 패키징 때 기록한다 [이슈: PR #48587, 소스: packager `mac.ts`].
- **[실측] ad-hoc 서명과 asar 무결성**
  - 순서: packager로 asar 패키징 → `@electron/fuses`로 `RunAsNode` 끄기, `EnableEmbeddedAsarIntegrityValidation`·`OnlyLoadAppFromAsar` 켜기 → `codesign --force --deep --sign -`
  - 결과: `codesign --verify --deep --strict` 통과, 정상 실행
  - 변조 실험: asar의 `main.js`를 고쳐 다시 묶고 ad-hoc으로 다시 서명했다. 실행하자마자 종료됐다.
    ```
    FATAL:electron/shell/common/asar/asar_util.cc:314] Integrity check failed for asar archive entry '<header>'
    ```
  - 결론: ad-hoc 서명과 함께 동작한다.
  - 한계: ad-hoc 서명은 누구나 다시 만들 수 있다. Info.plist와 Framework의 해시까지 고쳐 다시 서명하는 공격은 막지 못한다 [추론].

## 확인하지 못한 것

1. **Windows 실기 전체**: 이 조사는 macOS에서만 실행했다. 아래는 모두 소스와 문서로만 판단했다.
   - NSIS·Squirrel 설치 후 Electron 44가 시작 메뉴 바로가기를 고치는 동작
   - 알림 센터로 넘어간 알림을 앱 실행 중에 클릭할 때 인스턴스 `click`이 오는지, `handleActivation`으로만 오는지
   - 콜드 스타트에서 `handleActivation`만 등록하고 알림 객체를 만들지 않았을 때 활성화가 전달되는지
   - better-sqlite3 win32-x64 prebuilt와 `@napi-rs/keyring` win32-x64-msvc의 로드
   - WiX `perUser` 설치에서 UAC가 뜨지 않는지, Squirrel이 nupkg 안의 exe·dll까지 서명하는지
2. **Windows 서명 실제 실행**: builder `azureSignOptions`가 쓰는 PowerShell `TrustedSigning` 모듈이 Artifact Signing으로 이름이 바뀐 뒤에도 그대로 유효한지 Microsoft 문서로 확인하지 않았다. Forge의 `/dlib` 경로도 실행해 보지 않았다.
3. **arm64 러너에서 x64·universal 패키징**: 두 도구 모두 실행해 보지 않았다. `@napi-rs/keyring`의 pnpm `supportedArchitectures` 필요 여부도 추론이다.
4. **Forge 전체 흐름**: ad-hoc 서명은 packager 20.3.0을 직접 호출해 확인했다. `electron-forge make`로 DMG까지 만들어 보지는 않았다. Forge Vite 플러그인과 pnpm 워크스페이스 조합도 실행하지 않았다.
5. **builder DMG와 pnpm 워크스페이스**: `--mac dir`까지만 만들었다. DMG 생성과 pnpm 워크스페이스 수집은 실행하지 않았다.
6. **Keychain 재허용 빈도**: `safeStorage`와 `@napi-rs/keyring` 모두 ad-hoc 앱을 업데이트한 뒤 재허용을 묻는지 실제로 보지 않았다. 사용자 Keychain을 건드리지 않으려고 keyring은 로드만 확인했다.
7. **GitHub Releases 동시 업로드**: 두 러너가 동시에 처음 올릴 때 초안이 중복되는지는 소스로만 추론했다.
8. **Electron의 Intel Mac 지원 계획**: 공식 발표를 찾지 못했다. 44.7.2까지는 darwin-x64를 제공한다.
9. **`safeStorage.isEncryptionAvailable()`의 ready 전 macOS 동작**: 문서와 소스가 다르다. 열린 이슈 #45328과의 관계를 확정하지 못했다.
