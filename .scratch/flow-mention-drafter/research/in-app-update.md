# 앱 내 업데이트 가능성 조사

- 조사일: 2026-10-16
- 티켓: [앱 내 업데이트 가능성 조사](../issues/20-in-app-update-research.md)
- 이어서 읽는 문서. 거기 적힌 사실은 반복하지 않고 링크만 단다.
  - [Electron 빌드 스택 조사](electron-build-stack.md): ad-hoc 서명 방식, NSIS 사용자별 설치, `safeStorage`
  - [코드 서명 선택지 조사](code-signing-options.md): DR, Keychain 파티션, TCC, SAC
  - [다운로드 사이트 호스팅 조사](download-site-hosting.md): 비공개 Release, NSIS 실행 중 설치, 파일명
  - [트레이 앱 프레임워크 조사](tray-app-framework.md): Gatekeeper, quarantine, SmartScreen
- 전제
  - `Stardraft`는 Electron 44 + electron-builder 26.17.0 앱이다.
  - macOS는 arm64 DMG, 번들 전체 ad-hoc 서명(`mac.identity: "-"`)이다. Developer ID와 공증은 없다.
  - Windows는 x64 NSIS 원클릭, 사용자별 설치, 미서명이다.
  - Release는 비공개 저장소 `stardraft`에 있다. Vercel 함수가 읽기 전용 PAT로 GitHub API를 불러, 서명된 임시 URL(`release-assets.githubusercontent.com`, 약 55분 유효, 인증 없이 받아짐)로 302 리디렉트한다.
- 조사 방법
  - 공식 문서, 태그·커밋으로 고정한 공식 저장소 소스, GitHub 이슈만 근거로 삼았다.
  - 이 Mac(macOS 27.0.1 26A434, Apple Silicon, 관리자 계정)에서 몇 가지를 직접 실행했다. 실행 스크립트와 결과물은 세션 스크래치 디렉터리에만 있고 저장소에는 넣지 않았다.
  - 실제 업데이트(v0.0.1 → v0.0.2 설치·재실행) 실험은 하지 않았다. 설계만 [6절](#6-가장-싼-검증-실험)에 적었다.
  - Windows 실기는 없다. 이 Mac에는 Windows가 없다.
- 표기
  - [실측]: 직접 실행한 결과(2026-10-16)
  - [문서]: 공식 문서 원문
  - [소스]: 공식 저장소 코드
  - [이슈]: GitHub 이슈와 PR
  - [추론]: 위 출처에서 끌어낸 판단. 실행해 보지 않았다.
  - [추측]: 공식 근거가 없고 커뮤니티 보고에만 기대는 것
- 기준 버전

| 대상 | 버전 | 날짜 | 비고 |
|---|---|---|---|
| electron-builder | 26.17.0 (태그 커밋 `5cdf017`) | 2026-09-26 | npm `v26` 태그 |
| electron-updater | 6.8.10 | 2026-09-26 | npm `v26` 태그. `latest` 태그는 6.8.9다 |
| builder-util-runtime | 9.7.0 | | electron-updater 6.8.10이 고정으로 쓴다 |
| Squirrel.Mac | 커밋 `fffea30` | 2026-08-14 | Electron `44-x-y` [DEPS](https://github.com/electron/electron/blob/44-x-y/DEPS)가 고정한 커밋 |
| Electron | 44.7.2 (실측), 문서는 `44-x-y` 브랜치 | | auto-updater 문서 마지막 커밋 2026-10-07 |
| Sparkle | 2.10.0 (커밋 `eef1a53`) | 2026-09-13 | |
| tauri-plugin-updater | `v2` 브랜치 `updater.rs` 커밋 `24e6451` | 2026-10-11 | 직접 교체 방식의 구현 예로만 봤다 |

## 한눈에 보기

| # | 질문 | 답 | 근거 |
|---|---|---|---|
| 1 | electron-updater macOS 업데이트에 서명이 필요한가 | **필요하다.** builder와 Electron 문서 모두 명시한다 | [문서] |
| 1 | 기본 ad-hoc 서명으로 ad-hoc → ad-hoc 업데이트가 되는가 | **안 된다.** ad-hoc의 DR은 `cdhash H"…"`라서 빌드마다 바뀐다. Squirrel.Mac과 같은 API로 검증하면 `-67050 code failed to satisfy specified code requirement(s)`로 실패했다. 실제 Electron 44 앱도 같았다 | [소스·실측] |
| 1 | 우회로가 있는가 | **있다.** 최상위 번들을 `designated => identifier "<번들 ID>"` 명시 DR로 ad-hoc 서명하면 검증을 통과했다. Squirrel.Mac 자체 테스트도 이 방식을 쓴다. 단 이 DR은 **신원을 보장하지 않는다**. 같은 식별자의 아무 ad-hoc 번들도 통과했다 | [실측·소스] |
| 1 | `mac.requirements`로 넣으면 되는가 | **안 된다.** 중첩 코드 전부에 같은 DR이 붙어 `nested code is modified or invalid`가 됐다. 최상위만 다시 서명해야 한다 | [소스·실측] |
| 2 | Electron이 받은 파일에 quarantine이 붙는가 | **안 붙었다.** electron-updater 다운로더, `net.fetch`, `session.downloadURL` 세 경로 모두 없었다. `LSFileQuarantineEnabled` 기본값은 false다 | [실측·문서] |
| 2 | quarantine이 없으면 Gatekeeper가 생략되는가 | quarantine 앱 실행은 **항상** Gatekeeper를 부른다. 그 밖의 시점은 문서화돼 있지 않다. Squirrel.Mac과 Sparkle은 새 번들의 quarantine을 일부러 지운다 | [문서·소스] |
| 2 | 관리자가 아닌 계정이 `/Applications` 앱을 바꿀 수 있는가 | **바꿀 수 없다.** `/Applications`는 `root:admin 775`다. Squirrel.Mac은 이때 관리자 인증 창을 띄운다 | [실측·소스] |
| 2 | App Translocation 영향 | 번역 실행 중이면 Squirrel.Mac은 "read-only volume" 오류, Sparkle은 "다운로드한 위치에서 실행 중" 오류로 업데이트를 거부한다 | [소스] |
| 2 | Sparkle 2가 Developer ID 없이 업데이트하는가 | **한다.** EdDSA가 맞거나 코드 서명이 맞으면 통과다. ad-hoc 호스트는 EdDSA로 통과한다. Electron에 붙인 공개 사례는 확인하지 못했다 | [소스] |
| 3 | 미서명 Windows에서 서명 검증 | `app-update.yml`에 `publisherName`이 없으면 **검증을 건너뛴다.** 미서명 빌드에는 이 값이 들어가지 않는다 | [소스] |
| 3 | 조용한 설치와 재실행, UAC | `quitAndInstall(true, true)`는 `--updated /S --force-run`으로 설치 파일을 실행하고 설치 뒤 앱을 띄운다. 사용자별 설치는 UAC가 없다 | [소스] |
| 3 | MOTW, SmartScreen, SAC | electron-updater는 `fs` 스트림으로 저장하므로 MOTW를 붙이지 않는다. 그래서 SmartScreen 경고도 없을 것으로 본다. SAC는 MOTW와 무관하게 모든 실행 파일을 본다 | [소스·문서·추론] |
| 4 | `--publish never`에서도 yml·blockmap이 생기는가 | **생긴다.** `publish` 설정만 있으면 된다. 업로드만 하지 않는다 | [소스] |
| 4 | macOS에 zip이 필요한가 | **필요하다.** zip이 없으면 `ERR_UPDATER_ZIP_FILE_NOT_FOUND`다 | [문서·소스] |
| 4 | 302 리디렉트를 따라가는가 | **따라간다.** 최대 10회, 다른 호스트로 가면 인증 헤더를 지운다. Electron 44에서 GitHub 302를 따라 받는 것을 확인했다 | [소스·실측] |
| 4 | 차등 다운로드가 리디렉트 뒤에서 되는가 | 단일 Range는 된다. 그런데 generic provider 기본값은 **다중 Range**이고, GitHub 자산 호스트는 다중 Range에 **501**을 돌려준다. 실패하면 전체 다운로드로 넘어간다. `useMultipleRangeRequest: false`를 줘야 한다 | [소스·실측] |
| 5 | 업데이트 도중 실패 | macOS Squirrel.Mac은 옛 번들을 보관했다가 3회 실패하면 되돌린다. Windows NSIS는 옛 버전을 지운 뒤 새 파일을 풀므로, 그 사이에 멈추면 앱이 없는 상태가 될 수 있다 | [소스] |

## 1. macOS: electron-updater(Squirrel.Mac)와 ad-hoc 서명

### 문서가 요구하는 서명

- electron-builder [문서]
  - 원문: "macOS application must be [signed](./code-signing/code-signing.md) in order for auto updating to work." [Auto Update](https://www.electron.build/v26/docs/features/auto-update) ([원본](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/website/docs/features/auto-update.md))
  - 서명의 종류(Developer ID인지 ad-hoc인지)는 이 문장에 없다.
- Electron 44 [문서]
  - 원문: "Your application must be [signed](../tutorial/code-signing.md#macos-apis-that-require-code-signing) for automatic updates on macOS. This is a requirement of `Squirrel.Mac`." [auto-updater.md (44-x-y)](https://github.com/electron/electron/blob/44-x-y/docs/api/auto-updater.md)
  - 원문: "`Squirrel.Mac` requires the app to be signed for automatic updates to work at all." 같은 절 머리에는 "an unsigned or ad-hoc signed app may behave inconsistently"라고 적는다. [code-signing.md (44-x-y)](https://github.com/electron/electron/blob/44-x-y/docs/tutorial/code-signing.md#macos-apis-that-require-code-signing)
- electron-updater의 `MacUpdater`는 직접 설치하지 않는다 [소스]
  - zip을 직접 받은 뒤 `127.0.0.1`에 임시 HTTP 서버를 띄우고, Electron 내장 `autoUpdater`(Squirrel.Mac)에 그 주소를 피드로 준다. [MacUpdater.ts L141-261](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/MacUpdater.ts#L141-L261)
  - 그래서 설치 단계의 제약은 Squirrel.Mac의 제약과 같다.

### Squirrel.Mac은 현재 앱의 DR로 새 번들을 검증한다 [소스]

Electron 44가 쓰는 커밋 `fffea30` 기준이다.

- 현재 앱의 서명 읽기: `SecCodeCopySelf`로 자기 코드를 얻고 `SecCodeCopyDesignatedRequirement`로 DR을 꺼낸다. [SQRLCodeSignature.m L48-91](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLCodeSignature.m#L48-L91)
- 새 번들 검증: `SecStaticCodeCheckValidityWithErrors(staticCode, kSecCSCheckNestedCode | kSecCSStrictValidate | kSecCSCheckAllArchitectures, requirement, …)`. 실패하면 "Code signature at URL %@ did not pass validation"을 낸다. [같은 파일 L127-142](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLCodeSignature.m#L127-L142)
- 이 검증은 두 번 한다.
  - 앱 안의 `SQRLUpdater`가 ShipIt에 넘기기 전에 한다. [SQRLUpdater.m L1013-1018](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLUpdater.m#L1013-L1018)
  - 설치 프로세스 ShipIt이 설치된 옛 번들의 DR로 다시 한다. [SQRLInstaller.m L247-268](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLInstaller.m#L247-L268)
- 앱의 코드 서명을 아예 읽지 못하면 릴리스 빌드에서는 예외를 던진다. [SQRLUpdater.m L266-274](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLUpdater.m#L266-L274) ad-hoc 서명 앱은 DR이 있으므로 여기서는 막히지 않는다 [추론].
- 유지보수자 설명(2016) 원문: "For an update to be considered valid it must meet the _designated requirement_ of the current version. This is done to verify the authenticity of a given update". [Squirrel.Mac #160](https://github.com/Squirrel/Squirrel.Mac/issues/160) [이슈]

### ad-hoc 서명의 DR은 빌드마다 바뀐다 [실측]

- 방법
  - clang으로 최소 번들 `Probe.app` 두 개(v0.0.1, v0.0.2)를 만들고 `codesign --force --sign -`로 서명했다. 식별자는 같다(`app.example.probe`).
  - `codesign -d -r-`로 DR을 읽었다.
  - Squirrel.Mac과 같은 호출 순서의 작은 C 프로그램을 만들었다. 옛 번들에서 `SecStaticCodeCreateWithPath` → `SecCodeCopyDesignatedRequirement`로 DR을 꺼내고, 새 번들을 위와 같은 플래그의 `SecStaticCodeCheckValidityWithErrors`로 검증한다.
- DR 결과
  ```
  v0.0.1: # designated => cdhash H"19d203c146c25c1505d57bda15e6350def5bffe6"
  v0.0.2: # designated => cdhash H"7e623f3280266049c7be9684b96c324809b84698"
  ```
  - 맨 앞 `#`은 서명에 박힌 명시 DR이 아니라 시스템이 계산한 기본 DR이라는 뜻이다.
  - 같은 바이너리를 다시 서명하면 cdhash가 같았다. 내용이 바뀌면 cdhash가 바뀐다.
  - [코드 서명 선택지 조사](code-signing-options.md#designated-requirementdr)의 소스 근거(`defaultDesignatedRequirement`가 cdhash를 나열)와 TN3127 설명과 맞는다.
- npm으로 받은 Electron 44.7.2 공식 `Electron.app`도 DR이 `cdhash H"…"`였다. 그 안의 `Squirrel.framework/Resources/ShipIt`도 `Signature=adhoc`이다.
- 검증 결과

| 옛 번들(DR 출처) | 새 번들 | 결과 |
|---|---|---|
| 최소 번들 v0.0.1, 기본 ad-hoc | v0.0.2, 기본 ad-hoc | **실패** `-67050 code failed to satisfy specified code requirement(s)` |
| 최소 번들 v0.0.1, 기본 ad-hoc | 같은 바이너리를 다시 서명한 사본 | 통과(cdhash가 같다) |
| 실제 Electron 44.7.2 앱([티켓 11 프로토타입](../issues/11-tauri-macos-unsigned-check.md)), 기본 ad-hoc | Info.plist 버전만 바꿔 다시 서명한 사본 | **실패** `-67050` |

- 결론: **기본 ad-hoc 서명으로는 electron-updater(Squirrel.Mac) 업데이트가 설치 전에 거부된다.** 오류 문구는 "Code signature at URL … did not pass validation: code failed to satisfy specified code requirement(s)"가 된다 [소스·실측]. 실제 업데이트 흐름에서 이 문구를 본 것은 아니다.

### 명시 DR로 ad-hoc → ad-hoc 검증을 통과시킬 수 있다 [실측·소스]

- 방법: 서명할 때 DR을 직접 준다.
  ```
  codesign --force --sign - -r='designated => identifier "app.example.probe"' Probe.app
  codesign -d -r- Probe.app   # designated => identifier "app.example.probe"  (앞에 # 없음)
  ```
- 결과

| 옛 번들 | 새 번들 | 결과 |
|---|---|---|
| 최소 번들, 명시 DR | 명시 DR v0.0.2 | **통과** |
| 최소 번들, 명시 DR | 명시 DR 없이 같은 식별자로 ad-hoc 서명한 번들 | **통과** |
| 실제 Electron 44.7.2 앱, 최상위만 명시 DR | 같은 방식 v0.0.2 | **통과**. `codesign --verify --deep --strict` 통과, 실행됨 |
| 실제 Electron 44.7.2 앱, 최상위만 명시 DR | 기본 ad-hoc v0.0.2 | **통과** |

- 실제 Electron 앱은 최상위만 이렇게 다시 서명했다. 중첩 코드(Helper, Framework)의 기존 서명은 그대로 둔다.
  ```
  codesign --force --sign - --preserve-metadata=entitlements,flags,runtime \
    -r='designated => identifier "<번들 ID>"' <앱>.app
  ```
- **Squirrel.Mac 자체 테스트가 같은 방식을 쓴다** [소스·이슈]
  - [PR #296](https://github.com/Squirrel/Squirrel.Mac/pull/296)(2026-05-02 병합) 원문: "TestApplication now ad-hoc signs instead of requiring the GitHub `C4RRYD56A6` team cert", "signs both with an explicit designated requirement so `SQRLCodeSignature` cross-validates on any host".
  - [script/sign-test-fixtures](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/script/sign-test-fixtures)는 중첩 코드를 먼저 기본 ad-hoc으로 서명하고, 최상위만 `--requirements '=designated => identifier "com.github.Squirrel.TestApplication"'`으로 서명한다. 주석 원문: "so its DR is the shared identifier rather than the ad-hoc cdhash."
  - 인증서를 바꿀 때 명시 DR(`.rqset`)로 Squirrel.Mac 검증을 넘긴 사용자 보고도 있다. [electron-builder #4166](https://github.com/electron-userland/electron-builder/issues/4166) [이슈]
- **electron-builder `mac.requirements`로는 안 된다** [소스·실측]
  - `mac.requirements`는 요구사항 파일 경로다. [macOptions.ts L145-148](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/options/macOptions.ts#L145-L148)
  - 이 값을 서명하는 **모든 파일**의 옵션에 똑같이 넣는다. [MacTargetHelper.ts L218-233](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/mac/MacTargetHelper.ts#L218-L233)
  - [실측] 식별자가 다른 Helper 번들까지 같은 DR로 서명하자 바깥 번들 검증이 "nested code is modified or invalid"로 실패했다. Helper는 기본 DR, 최상위만 명시 DR로 서명하면 통과했다.
  - 그래서 `afterSign` 훅에서 최상위만 다시 서명하는 방식이 맞다 [추론]. `afterSign`은 서명 뒤, zip·DMG 생성 전에 돈다([빌드 스택 조사 A1](electron-build-stack.md#a1-macos-번들-전체-ad-hoc-서명)).
- **이 DR은 신원을 증명하지 않는다** [실측·추론]
  - 위 표에서 명시 DR이 없는 아무 ad-hoc 번들도 식별자만 같으면 통과했다.
  - 그래서 Squirrel.Mac의 서명 검증은 "같은 번들 ID의 유효한 서명" 확인으로 줄어든다. 진위 확인은 HTTPS와 피드의 sha512에만 남는다.
  - TCC는 DR로 앱을 추적한다([코드 서명 조사](code-signing-options.md#tcc-허용알림-등은-업데이트-뒤에도-유지되는가)). 그래서 명시 DR이면 TCC 허용이 업데이트 뒤에도 유지될 수 있다. 같은 식별자로 ad-hoc 서명한 다른 번들도 그 허용을 물려받을 수 있다 [추론, 실기 미확인].
- **현재 배포본에는 명시 DR이 없다** [추론]
  - Squirrel.Mac은 **설치된 옛 번들**의 DR로 검증한다. 그래서 명시 DR을 넣은 첫 버전은 사이트에서 한 번 수동으로 설치해야 한다.

### 사례

- ad-hoc 서명 Electron 앱이 electron-updater로 **성공하거나 실패한 공개 사례는 찾지 못했다.** electron-builder·electron·Squirrel.Mac 저장소에서 "ad-hoc", "adhoc", "did not pass validation"으로 검색했다.
- 같은 오류의 사례는 대부분 Developer ID 인증서를 바꾼 경우다. [electron-builder #4166](https://github.com/electron-userland/electron-builder/issues/4166)(2019), [electron #31407](https://github.com/electron/electron/issues/31407)(2021), [electron-builder #9504](https://github.com/electron-userland/electron-builder/issues/9504)(2026-01, 사용자 일부에서 같은 오류와 sha512 불일치) [이슈]
- 서명 자체가 없는 앱은 "Could not get code signature for running application"으로 막힌다. 유지보수자는 문서의 서명 요구를 인용해 답했다. [electron #7476](https://github.com/electron/electron/issues/7476) [이슈]
- 참고: 26.15.0의 mac zip이 `.framework` 심볼릭 링크를 풀어 Squirrel.Mac 검증을 깬 회귀가 있었다. 재현 저장소는 Developer ID 없이 ad-hoc으로 재현했다. 26.15.2에서 고쳤고 26.17.0에는 들어 있다. [electron-builder #9846](https://github.com/electron-userland/electron-builder/issues/9846), [CHANGELOG](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/CHANGELOG.md) [이슈·소스]

### 서명 말고도 Squirrel.Mac이 하는 일 [소스]

- 앱이 읽기 전용 볼륨에서 돌면 거부한다. 원문: "Cannot update while running on a read-only volume", "you'll need to move the application out of the Downloads directory". [SQRLUpdater.m L298-306](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLUpdater.m#L298-L306)
- 앱 번들이나 그 부모 폴더에 쓸 수 없으면 ShipIt을 관리자 권한으로 띄운다. [SQRLUpdater.m L410-421](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLUpdater.m#L410-L421)
  - `AuthorizationCreate`로 `kSMRightModifySystemDaemons` 권한을 묻는다. 창 문구는 "An update is ready to install."이다. [SQRLShipItLauncher.m L84-117](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLShipItLauncher.m#L84-L117)
  - 사용자 기본값 `SquirrelMacEnableDirectContentsWrite`를 켜면 부모 폴더 쓰기 권한은 따지지 않는다. Electron 문서에는 없는 설정이다.
- 새 번들의 quarantine을 지운다. 주석 원문: "This ensures users don't see a warning that the application was downloaded from the Internet." [SQRLInstaller.m L107-117, L655-694](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLInstaller.m#L655-L694)
- 설치한 파일의 소유자를 현재 사용자로 바꾸고 group·other 쓰기 권한을 없앤다. [같은 파일 L119-126](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLInstaller.m#L119-L126)

## 2. macOS 대안

### 직접 만드는 업데이터

- **Apple 공식 문서**: 앱이 자기 번들을 바꿔 끼우는 절차를 설명한 Apple 문서는 찾지 못했다.
- **잘 알려진 구현 예: tauri-plugin-updater의 macOS 설치** [소스: [updater.rs L1478-1635](https://github.com/tauri-apps/plugins-workspace/blob/24e6451b11fbd3378eccf4824552053d8862c66b/plugins/updater/src/updater.rs#L1478-L1635)]
  - 받은 파일의 minisign 서명을 먼저 검증한다(같은 파일 `verify_signature`). Tauri 업데이터는 이 서명을 끌 수 없다([코드 서명 조사 확인하지 못한 것 13](code-signing-options.md#확인하지-못한-것)).
  - `.app.tar.gz`를 앱과 **같은 볼륨**의 임시 폴더에 푼다. 같은 볼륨이 아니면 옛 앱을 옮기기 전에 거부한다.
  - APFS에서는 `renamex_np(…, RENAME_SWAP)`로 옛 번들과 새 번들을 한 번에 맞바꾼다. 설치 경로가 비는 순간이 없다.
  - 맞바꿀 수 없는 파일 시스템이면 두 번 rename하고, 두 번째가 실패하면 첫 번째를 되돌린다.
  - 권한 오류(`PermissionDenied`)면 AppleScript `do shell script … with administrator privileges`로 같은 일을 관리자 권한으로 한다.
  - 마지막에 `touch`로 번들 수정 시각을 갱신한다.
  - 코드 서명 DR은 보지 않는다. 그래서 ad-hoc 앱에서도 동작한다 [추론].
- Sparkle의 설치기도 새 번들을 놓기 전에 quarantine을 지운다. [SUPlainInstaller.m L50](https://github.com/sparkle-project/Sparkle/blob/2.10.0/Autoupdate/SUPlainInstaller.m#L50) [소스]
- Electron에 옮길 때의 모양 [추론]
  - main에서 zip과 서명 파일을 받는다. Node `crypto`로 Ed25519 서명을 앱에 넣은 공개 키로 검증한다.
  - `ditto -x -k`로 같은 볼륨에 푼다. Apple DTS는 `unzip` 같은 Unix 도구가 quarantine을 옮기지 않는다고 설명한다(아래).
  - `codesign --verify --deep --strict`로 번들을 확인한다.
  - 앱이 종료된 뒤 돌 작은 스크립트(분리 실행)가 번들을 맞바꾸고 `open`으로 다시 띄운다. Node에는 `renamex_np`가 없으므로 rename 두 번과 되돌리기로 한다.

### Electron이 받은 파일과 quarantine

- **[실측] quarantine이 붙지 않았다**
  - Electron 44.7.2 main(npm으로 받은 `Electron.app`)에서 같은 GitHub 자산을 세 경로로 받고 `xattr -l`로 봤다.

| 경로 | `com.apple.quarantine` |
|---|---|
| electron-updater 6.8.10 `ElectronHttpExecutor.download` | 없음 |
| `net.fetch` + `fs.writeFileSync` | 없음 |
| Chromium 다운로드 관리자 `session.downloadURL` | 없음 |

  - 세 파일 모두 `com.apple.provenance`가 붙어 있었다. 대조로 셸에서 만든 파일에도 같은 속성이 붙었다. 그래서 이 속성은 Electron이 아니라 실행 환경(부모 프로세스)에서 온 것으로 본다 [추론].
  - Electron 44.7.2 기본 `Info.plist`와 electron-builder 26.17.0 소스 어디에도 `LSFileQuarantineEnabled`가 없다 [실측·소스].
- **`LSFileQuarantineEnabled` 기본값은 false다** [문서]
  - 원문: "`false` (Default) Files created by this app are not quarantined by default." [Launch Services Keys](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/LaunchServicesKeys.html) (보관 문서, 2018-06-04 갱신). 현재 [LSFileQuarantineEnabled](https://developer.apple.com/documentation/bundleresources/information-property-list/lsfilequarantineenabled) 페이지에는 기본값 문장이 없다.
- **quarantine과 Gatekeeper** [문서: Apple DTS [Resolving Trusted Execution Problems](https://developer.apple.com/forums/thread/706442) (Quinn, 2022-05-20 게시, 2025-08-06 개정)]
  - 원문: "Unix-y networking tools, like `curl` and `scp`, don't quarantine the files they download. Unix-y unarchiving tools, like `tar` and `unzip`, don't propagate quarantine to the unarchived files."
  - 원문: "If you launch a quarantined app, the system invokes Gatekeeper."
  - 원문: "The system may run Gatekeeper at other times as well. The exact circumstances under which it runs Gatekeeper is not documented and changes over time. However, running a quarantined app always invokes Gatekeeper."
  - Apple 플랫폼 보안 안내 원문: "Gatekeeper also requests user approval before opening downloaded software for the first time", "all software in macOS is checked for known malicious content the first time it's opened". [Gatekeeper and runtime protection](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web) (2024-12-19 게시)
- 판단 [추론]
  - 앱이 받아 설치한 새 번들은 quarantine이 없다. 그래서 "열지 않음 → 그래도 열기" 절차를 다시 거치지 않을 가능성이 높다. Squirrel.Mac과 Sparkle이 quarantine을 지우는 것도 같은 목적이다.
  - 첫 실행 악성 코드 검사(XProtect)는 quarantine과 관계없이 돈다.
  - 실제로 대화상자가 안 뜨는지는 [6절](#6-가장-싼-검증-실험)에서 확인해야 한다.
- **보안상 뜻** [추론]
  - 업데이트 경로에서는 Gatekeeper도 공증도 사람 확인도 없다. 앱의 업데이터가 유일한 관문이 된다.
  - 지금 수동 배포도 ad-hoc이라 진위 확인은 없다. 사용자는 매번 "그래도 열기"를 누른다. 차이는 앱 내 업데이트가 **사람 손을 거치지 않고 모든 PC에 한 번에** 퍼진다는 점이다.
  - Release를 만들 수 있는 GitHub 계정이나 Vercel 배포가 털리면, 팀원 PC 전부에서 확인 창 없이 코드가 실행된다.
  - 그래서 업데이터가 앱에 넣은 공개 키로 업데이트 파일의 서명을 검증하는 편이 안전하다. Tauri와 Sparkle이 기본으로 하는 일이다. 개인 키는 GitHub Actions 비밀값에 둔다.

### 관리자가 아닌 계정과 `/Applications`

- [실측] 이 Mac의 권한
  - `/Applications`: `drwxrwxr-x root admin`
  - 이 계정(관리자)이 끌어다 놓은 앱 번들: 소유자가 그 사용자(`wraith admin` 또는 `wraith staff`), `drwxr-xr-x`
- 판단 [추론]
  - 번들을 통째로 바꾸려면 `/Applications`에서 항목을 rename·삭제해야 한다. 그러려면 `/Applications` 쓰기 권한(admin 그룹)이 필요하다.
  - 관리자 계정이 직접 설치했다면 묻지 않고 바꿀 수 있다.
  - 표준 계정은 `/Applications`에 쓸 수 없다. 다른 사용자가 설치한 번들 안쪽도 쓸 수 없다.
    - Squirrel.Mac은 관리자 인증 창을 띄운다([1절](#서명-말고도-squirrelmac이-하는-일-소스)).
    - Tauri식 업데이터도 관리자 암호를 묻는다.
  - 표준 계정이 Finder로 `/Applications`에 끌어다 놓을 때 관리자 인증을 거친 번들의 소유자가 누구인지는 확인하지 못했다.
  - 표준 계정에서 묻지 않게 하려면 `~/Applications`에 설치하게 해야 한다.

### App Translocation

- Apple 원문: "When necessary, Gatekeeper opens apps from randomized, read-only locations." [Gatekeeper and runtime protection](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web) [문서] 정확한 조건은 문서화돼 있지 않다.
- 업데이터의 대응 [소스]
  - Squirrel.Mac: `statfs`로 읽기 전용 볼륨이면 거부한다([1절](#서명-말고도-squirrelmac이-하는-일-소스)).
  - Sparkle: 실행 경로에 `/AppTranslocation/`이 있으면 "can't be updated if it's running from the location it was downloaded to"로 멈춘다. [SUHost.m L185-188](https://github.com/sparkle-project/Sparkle/blob/2.10.0/Sparkle/SUHost.m#L185-L188), [SPUBasicUpdateDriver.m L77-78](https://github.com/sparkle-project/Sparkle/blob/2.10.0/Sparkle/SPUBasicUpdateDriver.m#L77-L78)
- 판단 [추론]
  - 번역 실행 중인 앱은 업데이트할 수 없다. 원래 경로도 알 수 없다.
  - 안내문대로 `/Applications`로 옮긴 뒤 "그래도 열기"로 연 앱이 번역 실행되는지는 확인하지 못했다. [6절](#6-가장-싼-검증-실험)에서 `process.execPath`로 확인한다.

### 앱 수정 보호(macOS 13 이후)

- WWDC22 [What's new in privacy](https://developer.apple.com/videos/play/wwdc2022/10096/) 원문 [문서]
  - "In macOS Ventura, Gatekeeper will now check the integrity of all notarized apps, not just quarantined apps."
  - "Apps validly signed by the same developer account or team will continue to be able to update each other."
  - "If an app is modified by something that isn't signed by the same development team and isn't allowed by an NSUpdateSecurityPolicy, macOS will block the modification and notify the user that an app wants to manage other apps."
- [NSUpdateSecurityPolicy](https://developer.apple.com/documentation/bundleresources/information-property-list/nsupdatesecuritypolicy) 원문: "For signed apps, macOS allows apps from the same developer — those sharing the same Team ID — to modify the app's bundle." 허용 대상은 Team ID로 지정한다 [문서].
- 판단 [추론]
  - 발표 문장은 공증된 앱을 대상으로 한다. ad-hoc 앱은 Team ID가 없어서 이 정책에 쓸 값도 없다.
  - 공증되지 않은 ad-hoc 앱이 자기 번들을 바꿀 때 이 보호가 걸리는지는 문서로 알 수 없다. 걸린다면 "앱이 다른 앱을 관리하려 합니다" 알림이 뜬다. [6절](#6-가장-싼-검증-실험)에서 본다.

### Sparkle 2

- **ad-hoc + EdDSA로 업데이트를 허용한다** [소스: Sparkle 2.10.0 [SUUpdateValidator.m](https://github.com/sparkle-project/Sparkle/blob/2.10.0/Sparkle/SUUpdateValidator.m)]
  - 앱 번들 업데이트는 옛 앱의 EdDSA 공개 키로 아카이브 서명을 보고, 옛 앱이 코드 서명돼 있으면 새 앱이 옛 앱 서명과 맞는지도 본다(L333-349).
  - 원문 주석: "Either DSA must be valid, or Apple Code Signing must be valid." (L371-375) 그래서 ad-hoc 호스트는 코드 서명 비교가 실패해도 EdDSA로 통과한다 [추론].
  - 새 앱의 코드 서명이 깨져 있으면 거부한다(L362-369). ad-hoc 서명은 유효한 서명이므로 걸리지 않는다 [추론].
  - 옛 앱이 서명돼 있고 새 앱이 미서명이면 거부한다. 원문: "If no Apple Code Signing certificate is available, adhoc signing can be used at minimum." (L285)
- 문서 [문서: [Sparkle Documentation](https://sparkle-project.org/documentation/)]
  - 업데이트 아카이브를 "Sparkle's EdDSA (ed25519) signature"로 서명하라고 권한다. Developer ID 서명과 공증은 "(if possible)"이라고 적는다.
  - Library Validation을 켠 ad-hoc 앱은 Sparkle을 불러오지 못할 수 있다고 경고한다. 원문: "the system may not let your application load Sparkle if you attempt to sign to run locally via an ad-hoc signature." electron-builder ad-hoc 서명은 `disable-library-validation`을 넣으므로 해당하지 않을 것으로 본다([빌드 스택 조사 A1](electron-build-stack.md#a1-macos-번들-전체-ad-hoc-서명)) [추론].
- **Electron에 붙인 사례**
  - Electron 44 DEPS에는 Sparkle이 `squirrel.mac/vendor/Sparkle`로 들어 있다. 하지만 업데이터로서가 아니라 Squirrel.Mac의 바이너리 델타(`BinaryDelta`)용이다. [DEPS](https://github.com/electron/electron/blob/44-x-y/DEPS), [auto-updater.md](https://github.com/electron/electron/blob/44-x-y/docs/api/auto-updater.md) [소스·문서]
  - npm에 `electron-sparkle-updater` 0.5.3(첫 게시 2026-07-18)이 있다. 저장소 링크가 없고, 소개 글은 "supports ad-hoc signing"이라고만 적는다. 동작을 확인하지 않았다 [추측]. ([소개 글](https://innei.in/en/posts/tinkering/electron-sparkle-updater-extraction))
  - 붙이려면 Objective-C 네이티브 모듈, `Sparkle.framework` 번들링과 서명, appcast XML 피드(`SUFeedURL`, `SUPublicEDKey`)가 필요하다 [추론].

### 업데이트 뒤 Keychain, TCC, 알림, 로그인 항목

- **Keychain**: ad-hoc은 업데이트마다 다시 묻는다. 파티션 ID가 빌드마다 바뀌는 `cdhash:`이기 때문이다. [코드 서명 조사 4절](code-signing-options.md#keychain-항목-acl항상-허용은-업데이트-뒤에도-유지되는가), [빌드 스택 조사 C1](electron-build-stack.md#c1-electron-44-safestorage)
  - 명시 DR을 넣어도 파티션은 여전히 `cdhash:`라서 다시 물을 것으로 본다 [추론].
  - 업데이트 방식(앱 내든 수동이든)과 관계없는 문제다.
- **TCC(파일·폴더 등)**: ad-hoc 기본 DR이면 다시 묻는다. [코드 서명 조사 4절](code-signing-options.md#tcc-허용알림-등은-업데이트-뒤에도-유지되는가) 명시 DR이면 유지될 수 있다(1절) [추론].
- **알림 권한, 로그인 항목**: 업데이트 뒤 동작을 다룬 1차 출처를 찾지 못했다. [티켓 11](../issues/11-tauri-macos-unsigned-check.md)도 미확인으로 남겼다. [6절](#6-가장-싼-검증-실험)에서 확인한다.

## 3. Windows: electron-updater(NsisUpdater)와 미서명

### 서명 검증은 `publisherName`이 있을 때만 한다 [소스]

- `NsisUpdater.verifySignature`는 `app-update.yml`의 `publisherName`이 없으면 `null`(통과)을 돌려준다. `app-update.yml`이 없을 때도 통과다. [NsisUpdater.ts L109-124](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/NsisUpdater.ts#L109-L124)
- `publisherName`은 빌드 때 이렇게 들어간다. [PublishManager.ts L259-283](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/publish/PublishManager.ts#L259-L283)
  - `win.verifyUpdateCodeSignature`(기본 true)가 켜져 있으면 서명 관리자의 `computedPublisherName`을 쓴다. [winOptions.ts L38-45](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/options/winOptions.ts#L38-L45)
  - signtool 경로는 인증서 CN을 쓰고, 인증서가 없으면 `null`이다. [windowsSignToolManager.ts L70-80](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/codeSign/windowsSignToolManager.ts#L70-L80)
  - Artifact Signing(`azureSignOptions`) 경로는 `publisherName`을 직접 주지 않으면 `null`이다. 소스 주석: "For now return null." [windowsSignAzureManager.ts L13-24](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/codeSign/windowsSignAzureManager.ts#L13-L24)
- 그래서 미서명 빌드는 서명 검증 없이 설치한다. 무결성은 피드(`latest.yml`)의 sha512 확인뿐이다 [추론].
- 검증할 때는 PowerShell `Get-AuthenticodeSignature`를 부른다. PowerShell 실행이 실패하면 `resolve(null)`, 즉 통과로 처리한다. [windowsExecutableCodeSignatureVerifier.ts L48-53](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/windowsExecutableCodeSignatureVerifier.ts#L48-L53)
- 나중에 Artifact Signing을 붙일 때 [추론]
  - `azureSignOptions.publisherName`을 줘야 검증이 켜진다.
  - 첫 서명 버전으로 가는 업데이트는 옛 미서명 앱이 받으므로 검증하지 않는다. 그다음부터 서명이 맞아야 한다.

### 조용한 설치와 재실행, UAC [소스]

- `quitAndInstall(isSilent, isForceRunAfter)` [BaseUpdater.ts L15-29](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/BaseUpdater.ts#L15-L29)
  - 조용한 모드면 `isForceRunAfter`를 그대로 쓰고, 아니면 `autoRunAppAfterInstall`(기본 true)을 쓴다.
  - 설치 파일을 띄운 뒤 `before-quit-for-update`를 내고 `app.quit()`을 부른다.
- 설치 파일 인자 [NsisUpdater.ts L126-181](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/NsisUpdater.ts#L126-L181)
  - 항상 `--updated`. 조용한 모드면 `/S`, 재실행이면 `--force-run`.
  - `child_process.spawn`(`detached: true`)으로 실행한다. [BaseUpdater.ts L151](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/BaseUpdater.ts#L151)
  - `isAdminRightsRequired`가 참일 때만 `elevate.exe`를 거친다. 실행이 `EACCES`나 `UNKNOWN`으로 실패할 때도 `elevate.exe`로 다시 한다.
- `isAdminRightsRequired`는 전체 사용자 설치(`perMachine`)일 때만 `latest.yml`에 들어간다. [NsisTarget.ts L388-390](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts#L388-L390)
- NSIS 템플릿
  - 원클릭은 `${isForceRun}`이면 설치 뒤 앱을 실행한다. [installSection.nsh L91-103](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/installSection.nsh#L91-L103)
  - 실행할 때 앱에 `--updated` 인자를 넘긴다. [common.nsh L123-131](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/common.nsh#L123-L131)
  - `--updated`면 실행 중 확인창 없이 1초 뒤 앱을 종료한다([다운로드 사이트 조사 9절](download-site-hosting.md#windows-electron-builder-nsis-원클릭-설치-파일을-앱-실행-중에-실행)).
- UAC: 사용자별 설치는 `RequestExecutionLevel user`라 관리자 권한을 묻지 않는다([빌드 스택 조사 A3](electron-build-stack.md#a3-windows-설치-파일)).
- 판단 [추론]: `quitAndInstall(true, true)`면 창과 UAC 없이 설치하고 다시 실행된다. 실기로 보지 않았다.

### Mark of the Web, SmartScreen, 스마트 앱 컨트롤

- **electron-updater는 MOTW를 붙이지 않는다** [소스·문서·추론]
  - 다운로드는 Node `fs.createWriteStream`으로 저장한다. [httpExecutor.ts L582](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/builder-util-runtime/src/httpExecutor.ts#L582) electron-updater와 builder-util-runtime 소스에 `Zone.Identifier` 처리는 없다.
  - MOTW는 `Zone.Identifier` 대체 데이터 스트림이다. 원문: "The Attachment Execution Services (see IAttachmentExecute) set the zone information". [Persistent Zone Identifier object](https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/platform-apis/ms537029(v=vs.85)) (ms.date 2017-08-15), [MS-FSCC Zone.Identifier](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fscc/6e3f7352-d11c-4d76-8c39-2516a9df36e8)
  - 그래서 이 API를 부르지 않는 Node 쓰기에는 MOTW가 없다고 본다. Windows에서 실측하지 않았다.
- **SmartScreen**
  - 원문: "When a file is downloaded and tagged with a Mark-of-the-Web (MotW), SmartScreen in Windows Shell scans it when opened." [SmartScreen deprecation in Internet Explorer](https://support.microsoft.com/en-us/topic/smartscreen-deprecation-in-internet-explorer-and-ie-mode-in-windows-11-7ac03f87-84e8-414e-a3c5-991b02ebc081) (2025-11-04 게시) [문서]
  - 판단 [추론]: 업데이트 설치 파일은 MOTW가 없고 셸이 아닌 `spawn`으로 실행된다. 그래서 SmartScreen 경고가 뜨지 않을 것으로 본다. 지도에 적힌 "업데이트 때마다 다시 뜨는 SmartScreen 경고"가 앱 내 업데이트에서는 없어질 수 있다. 처음 브라우저로 받는 설치 파일은 여전히 경고가 뜬다.
- **스마트 앱 컨트롤은 여전히 막는다** [문서]
  - 원문: "Smart App Control signature checks apply to all executable files, not just those downloaded from the Internet." [SmartScreen reputation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation) (ms.date 2026-05-04)
  - SAC가 켜진 PC는 앱 자체가 실행되지 않는다. 서명 정책상 이미 지원 대상이 아니다([지도](../map.md)).

## 4. 업데이트 피드와 파일 전달

### `--publish never`에서도 yml과 blockmap이 생긴다 [소스]

- `--publish never`는 업로드만 끈다(`isPublish = false`). [PublishManager.ts L103-104](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/publish/PublishManager.ts#L103-L104)
- 업데이트 정보는 `isPublish`와 관계없이 만든다.
  - 산출물마다 `isWriteUpdateInfo`이면 `createUpdateInfoTasks`를 예약하고, 끝에 `writeUpdateInfoFiles`로 `latest.yml`·`latest-mac.yml`을 쓴다. [같은 파일 L211-225, L245-256](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/publish/PublishManager.ts#L211-L256)
  - 앱 안의 `resources/app-update.yml`도 패키징 직후 쓴다. macOS는 타깃에 dmg나 zip이 있을 때만이다. [같은 파일 L117-133](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/publish/PublishManager.ts#L117-L133)
- **조건: publish 설정이 있어야 한다**
  - `publish: null`이면 아무것도 만들지 않는다. [같은 파일 L441-470](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/publish/PublishManager.ts#L441-L470)
  - 설정이 없으면 `GH_TOKEN`·`GITHUB_TOKEN` 환경 변수나 저장소 정보를 보고 **github provider로 정한다**(L285-309, L476-500). 비공개 저장소라 앱이 이 설정으로는 업데이트를 확인할 수 없다 [추론]. 그래서 `generic`을 명시해야 한다.
  - 문서 원문: "when using a generic server, you have to upload the built application and metadata files yourself." [Publish](https://www.electron.build/v26/docs/publish) [문서]
- blockmap
  - mac zip: `zip` 타깃이 업데이트 정보와 blockmap을 만든다. [macPackager.ts L164-167](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/macPackager.ts#L164-L167), [ArchiveTarget.ts L74-80](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/targets/ArchiveTarget.ts#L74-L80)
  - DMG: `dmg.writeUpdateInfo`가 false가 아니면 blockmap을 만든다. [dmg.ts L104-112](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/dmg-builder/src/dmg.ts#L104-L112)
  - NSIS: `differentialPackage`(기본 true)가 켜져 있으면 만든다. [NsisTarget.ts L97-99, L380-386](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts#L380-L386)

### macOS에는 zip이 필요하다

- 문서 원문: "`zip` target for macOS is **required** for Squirrel.Mac, otherwise `latest-mac.yml` cannot be created, which causes `autoUpdater` error." [Auto Update](https://www.electron.build/v26/docs/features/auto-update) [문서]
- 원문: "The default targets are `zip` and `dmg` (both are required for Squirrel.Mac auto-update)." [mac](https://www.electron.build/v26/docs/mac) [문서]
- `MacUpdater`는 파일 목록에서 zip을 찾고, 없으면 `ZIP file not provided`(`ERR_UPDATER_ZIP_FILE_NOT_FOUND`)를 던진다. [MacUpdater.ts L96-100](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/MacUpdater.ts#L96-L100) [소스]
- 결론: 지금처럼 DMG만 내면 안 된다. `mac.target`에 `zip`을 더하고, zip·blockmap·`latest-mac.yml`도 Release에 올려야 한다.

### generic provider와 302 리디렉트

- **리디렉트를 따라간다** [소스]
  - API 요청: 3xx와 `location`이 있으면 다시 요청한다. 최대 10회다. [httpExecutor.ts L217-226](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/builder-util-runtime/src/httpExecutor.ts#L217-L226)
  - Electron `net`으로 받을 때는 `redirect: "manual"`로 요청하고 `redirect` 이벤트에서 새 요청을 만든다. [electronHttpExecutor.ts L23-49, L76-94](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/electronHttpExecutor.ts#L76-L94)
  - 호스트가 바뀌면 `authorization`, `cookie` 같은 민감 헤더를 지운다. [httpExecutor.ts L21-23, L357-425](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/builder-util-runtime/src/httpExecutor.ts#L357-L425) 서명 URL은 인증이 필요 없으므로 문제없다 [추론].
- **[실측]** Electron 44.7.2 main에서 electron-updater 6.8.10의 `ElectronHttpExecutor.download`로 `github.com/electron/electron/releases/download/v44.8.0/SHASUMS256.txt`를 받았다. `release-assets.githubusercontent.com`으로 가는 302를 따라가 6,740바이트를 받았다. 크기와 내용이 다른 두 경로와 같았다.
- generic provider의 파일 주소 [소스]
  - `latest.yml`을 `<url>/latest.yml`(macOS는 `latest-mac.yml`)에서 받는다. 요청 헤더를 따로 주지 않으면 `?noCache=<시각>` 쿼리를 붙인다. [GenericProvider.ts L23-28](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/providers/GenericProvider.ts#L23-L28), [util.ts L15-23](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/util.ts#L15-L23)
  - yml 안 파일 이름은 같은 기준 주소에 붙여 받는다.
  - 받은 파일은 yml의 sha512로 확인한다. [DownloadedUpdateHelper.ts](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/DownloadedUpdateHelper.ts)

### 차등 다운로드와 Range

- **generic provider는 기본으로 다중 Range 요청을 쓴다** [소스]
  - `useMultipleRangeRequest !== false`이고 주소에 `s3.amazonaws.com`이 없으면 켠다. [providerFactory.ts L23-25, L70-75](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/providerFactory.ts#L70-L75)
  - GitHub provider는 이 값을 `false`로 고정한다. [GitHubProvider.ts L27](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/providers/GitHubProvider.ts#L27)
  - 다중 Range 응답이 `multipart/byteranges`가 아니면 실패한다. [multipleRangeDownloader.ts L94-105](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/differentialDownloader/multipleRangeDownloader.ts#L94-L105)
- **[실측] GitHub 자산 호스트의 Range**
  - 단일 Range(`bytes=0-15`): `206`, `content-range: bytes 0-15/6740`
  - 다중 Range(`bytes=0-15,100-115`): **`501 Unsupported client range`**
- 단일 Range 모드는 리디렉트를 따라가고, 그 뒤 요청은 리디렉트된 주소로 바로 보낸다. [DifferentialDownloader.ts L198-265](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/differentialDownloader/DifferentialDownloader.ts#L198-L265) [소스]
- 차등 다운로드가 실패하면 로그를 남기고 전체 다운로드로 넘어간다. [AppUpdater.ts L901-915](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/AppUpdater.ts#L901-L915) [소스]
- 그 밖의 조건 [소스]
  - 옛 blockmap 주소는 새 파일 경로의 버전 문자열을 옛 버전으로 바꿔 만든다. [Provider.ts L30-38](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/providers/Provider.ts#L30-L38) 그래서 파일 이름에 버전이 있어야 하고, 서버는 옛 Release의 blockmap도 내줘야 한다 [추론].
  - macOS는 지난 업데이트 때 캐시한 `update.zip`이 있어야 차등 다운로드를 한다. DMG로 처음 설치한 뒤 첫 업데이트는 항상 전체 다운로드다. [MacUpdater.ts L110-125](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/MacUpdater.ts#L110-L125)
- 결론 [추론]
  - 리디렉트 뒤 차등 다운로드는 `useMultipleRangeRequest: false`를 줄 때만 실제로 쓰인다.
  - 앱 크기와 인원(10명 안팎)을 보면, 처음에는 `disableDifferentialDownload: true`로 끄는 편이 Vercel 함수가 단순하다.

### Vercel 함수가 맞춰야 할 것 [추론]

- `/<기준 경로>/latest.yml`, `latest-mac.yml`, 각 산출물, `.blockmap` 요청을 받아 해당 Release 자산의 서명 URL로 302 한다.
- 쿼리 문자열(`noCache`)은 무시한다.
- 302 응답에는 `Cache-Control: no-store`를 둔다. 서명 URL이 만료되기 때문이다.
- yml은 최신 공개 Release에서, 버전이 붙은 파일 이름은 그 버전의 Release에서 찾는다.
- 다운로드 사이트의 고정 링크도 이 함수가 최신 자산으로 보내 주면 된다. 그러면 [다운로드 사이트 조사](download-site-hosting.md#releaseslatest와-releaseslatestdownload파일명)가 권한 "버전 없는 파일 이름"이 필요 없다. 업데이트용 파일 이름은 버전을 유지한다. 공백은 빼는 편이 경로 처리가 쉽다.

## 5. 실패와 되돌리기

### macOS: Squirrel.Mac [소스]

- 앱 안 단계(다운로드, 압축 해제, 서명 검증)에서 실패하면 `error` 이벤트로 끝난다. 설치된 앱은 그대로다.
- ShipIt 단계 [SQRLInstaller.m L310-424](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/SQRLInstaller.m#L310-L424)
  - 새 번들을 임시 폴더로 복사하고 quarantine을 지운 뒤 서명을 검증한다.
  - 대상 앱이 아직 실행 중이면 중단한다("All instances of the target application should be quit during the update process").
  - 옛 번들을 소유 임시 폴더로 옮겨 두고(위치를 사용자 기본값에 기록) 새 번들을 놓는다. 성공하면 옛 번들을 지운다.
  - 다음 설치 요청이나 중단 요청이 오면 먼저 옛 번들을 원래 자리로 되돌린다(L152-170, L405-424).
- 재시도: 3회를 넘기면 설치를 중단하고 옛 번들을 되돌린다. [ShipIt-main.m L47, L113-125](https://github.com/Squirrel/Squirrel.Mac/blob/fffea30e4a339a7f7d69a3391314b72548d209bd/Squirrel/ShipIt-main.m#L113-L125)
- 새 버전이 실행된 뒤 잘 동작하는지는 보지 않는다. 실행은 되는데 앱 로직이 깨진 버전은 되돌리지 않는다 [추론].

### 직접 만든 업데이터 [소스·추론]

- Tauri처럼 같은 볼륨에서 맞바꾸고, 실패하면 rename을 되돌린다([2절](#직접-만드는-업데이터)).
- 되돌리기를 하지 못하면 옛 번들 위치를 오류로 알려 준다(`PreviousAppNotRestored`).
- Electron으로 옮기면 이 경로를 직접 만들고 시험해야 한다.

### Windows: NSIS 원클릭 [소스]

- 순서: 실행 중 앱 확인 → 옛 버전 언인스톨러 실행 → 새 파일 설치. [installSection.nsh L33-66](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/installSection.nsh#L33-L66)
- 옛 언인스톨러는 `--updated`면 설치 폴더를 임시 폴더로 옮긴다. 파일이 잠겨 있으면 되돌리고 중단한다. 옮기기에 성공하면 지운다. [uninstaller.nsh L159-187](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/uninstaller.nsh#L159-L187)
- 언인스톨러가 실패 코드를 내면 "uninstallFailed" 창을 띄우고 설치를 멈춘다. [installUtil.nsh L124-133](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/include/installUtil.nsh#L124-L133)
- 새 파일 복사는 5회 재시도 뒤 다시 시도·취소를 묻는다. 취소하면 그대로 끝난다. 조용한 모드는 기본값이 다시 시도라서, 마지막 수단으로 원자적이지 않은 덮어쓰기를 한다. [extractAppPackage.nsh L92-136](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/app-builder-lib/templates/nsis/include/extractAppPackage.nsh#L92-L136)
- 판단 [추론]
  - 옛 버전을 지운 뒤 새 파일 설치가 멈추면 옛 버전으로 돌아가지 않는다. 앱이 없는 상태가 될 수 있다. 사이트에서 다시 받아 설치하면 된다.
  - `%APPDATA%\Stardraft`(설정, `state.db`)는 업데이트 중에 지우지 않는다([다운로드 사이트 조사 9절](download-site-hosting.md#windows-electron-builder-nsis-원클릭-설치-파일을-앱-실행-중에-실행)).

### `state.db` 마이그레이션과의 관계 [추론]

- 두 OS 모두 업데이트는 앱이 꺼진 사이에 파일만 바꾼다. 데이터 폴더는 건드리지 않는다. 마이그레이션은 새 버전이 처음 뜰 때 앱 코드가 한다.
- electron-updater의 `allowDowngrade` 기본값은 false다. [AppUpdater.ts L91](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/AppUpdater.ts#L91) [소스] 그래서 문제를 고칠 때는 새 버전으로 덮는 방식이 기본이다.
- 그래도 사용자가 사이트에서 옛 버전을 다시 깔 수 있다. 옛 앱이 새 스키마의 `state.db`를 만나는 경우를 막아야 한다.
  - 스키마 버전은 `PRAGMA user_version`에 둔다. 원문: "The user-version is an integer that is available to applications to use however they want. SQLite makes no use of the user-version itself." [SQLite PRAGMA](https://www.sqlite.org/pragma.html#pragma_user_version) [문서]
  - 마이그레이션 전에 `state.db` 사본을 버전 이름으로 남긴다.
  - 앱은 자기가 아는 것보다 높은 `user_version`을 만나면 열지 않고 안내한다.
  - 마이그레이션은 한 트랜잭션으로 묶는다. 중간에 꺼져도 옛 스키마로 남게 한다.

## 6. 가장 싼 검증 실험

### 0단계: 이미 실행한 것 [실측]

- DR 확인과 검증 비교([1절](#ad-hoc-서명의-dr은-빌드마다-바뀐다-실측)): 기본 ad-hoc은 실패, 최상위 명시 DR은 통과했다. 실제 Electron 44.7.2 앱 사본으로도 같았다.
- Electron이 받은 파일의 quarantine([2절](#electron이-받은-파일과-quarantine)): 붙지 않았다.
- GitHub 자산 호스트의 다중 Range([4절](#차등-다운로드와-range)): 501이었다.
- 이 단계에서 남은 질문은 실제 ShipIt 설치와 재실행, 그 뒤 OS 반응이다.

### 1단계 이후: v0.0.1 → v0.0.2 실험 설계

- **목적**: ad-hoc 서명 Electron 앱이 electron-updater로 업데이트되는지, 그 뒤 OS가 무엇을 다시 묻는지 확인한다.
- **환경**: 이 Mac, 관리자 계정. 작업 폴더는 세션 스크래치에 둔다. Electron 44.7.2, electron-builder 26.17.0, electron-updater 6.8.10.
- **최소 앱 `UpdateProbe`**(`appId: app.example.updateprobe`)
  - 시작할 때 파일 로그에 남긴다: `app.getVersion()`, `process.execPath`(경로에 `/AppTranslocation/`이 있는지), `app.getLoginItemSettings()`.
  - `safeStorage.encryptStringAsync`로 만든 값을 `userData`에 두고, 시작할 때마다 복호화한다. Keychain 창이 뜨는지 본다.
  - 알림을 하나 띄워 `show`/`failed`를 기록한다.
  - 트레이 메뉴 "업데이트 확인"이 `autoUpdater.checkForUpdates()`를 부르고, `update-downloaded`에서 `quitAndInstall()`을 부른다. `autoUpdater.logger`로 electron-updater 로그를 파일에 남긴다.
- **빌드 설정**
  - `mac.target: ["dmg", "zip"]`, `mac.identity: "-"`
  - `publish: [{ provider: "generic", url: "http://localhost:8001/feed", useMultipleRangeRequest: false }]`
  - 빌드 명령: `electron-builder --mac --publish never`
  - 변형 A: 그대로 둔다(기본 cdhash DR).
  - 변형 B: `afterSign` 훅에서 최상위만 다시 서명한다.
    ```
    codesign --force --sign - --preserve-metadata=entitlements,flags,runtime \
      -r='designated => identifier "app.example.updateprobe"' UpdateProbe.app
    ```
- **로컬 서버**(Vercel → GitHub 흉내)
  - `localhost:8001/feed/*`는 `http://127.0.0.1:8002/*`로 302 한다. 호스트 이름이 달라 electron-updater의 교차 출처 리디렉트 경로를 탄다.
  - `127.0.0.1:8002`는 빌드 산출물을 그대로 내준다.
- **순서**
  1. 변형 B로 v0.0.1을 빌드한다. DMG를 Chrome으로 `localhost`에서 받아 quarantine을 붙인다.
  2. `/Applications`로 끌어다 놓고 "열지 않음 → 그래도 열기"로 연다. 알림 허용, Keychain "항상 허용", 로그인 항목 켜기를 한다. (사용자 조작)
  3. `codesign -d -r- /Applications/UpdateProbe.app`으로 명시 DR을 확인한다.
  4. 버전을 0.0.2로 올려 다시 빌드하고 산출물(`latest-mac.yml`, zip)을 서버 폴더에 둔다.
  5. 트레이에서 업데이트를 확인한다.
  6. 같은 절차를 변형 A로 한 번 더 한다.
- **볼 것**

| 항목 | 기대(변형 B) | 기대(변형 A) |
|---|---|---|
| electron-updater 로그와 `error` 이벤트 | 다운로드, sha512 확인, Squirrel 전달 성공 | "Code signature at URL … did not pass validation" |
| 재실행과 버전 | 0.0.2로 다시 뜬다 | 0.0.1 그대로 |
| 새 번들의 `xattr -l` | quarantine 없음 | - |
| Gatekeeper "열지 않음" 대화상자 | 안 뜬다 | - |
| "앱이 다른 앱을 관리하려 합니다" 알림 | 모름. 뜨면 기록 | - |
| `process.execPath` | `/Applications/…` | 같음 |
| Keychain 복호화 | 다시 묻는다(예상) | - |
| 알림 권한, 로그인 항목 | 모름. 기록 | - |
| `~/Library/Caches/app.example.updateprobe.ShipIt` 로그 | 설치 성공 기록 | - |

- **선택 단계**(필요할 때만)
  - 표준 계정을 하나 만들어 같은 절차를 해 본다. 관리자 인증 창이 뜨는지 본다(관리자 승인 필요).
  - `~/Applications` 설치로 같은 절차를 해 본다.
  - zip의 sha512를 틀리게 고쳐 오류 경로를 본다.
- **비용**: 앱과 서버 준비 30~40분, 실행과 관찰 20~30분. 2단계 조작은 사용자가 한다.
- **중단 조건**
  - 변형 A가 성공하면 멈추고 DR이 어떻게 박혔는지부터 다시 본다. 이 조사의 전제가 틀린 것이다.
  - 변형 B가 Squirrel 검증에서 실패하면 멈춘다. 직접 만든 업데이터나 수동 배포 유지로 판단을 넘긴다.
  - App Management 알림이 뜨고 허용 없이는 설치가 안 되면 멈춘다. 이 경우 직접 만든 업데이터도 같은 문제를 겪을 수 있으니 기록만 하고 판단을 넘긴다.
- **복구**
  - `/Applications/UpdateProbe.app` 삭제
  - 로그인 항목 끄기(`app.setLoginItemSettings({ openAtLogin: false })` 후 앱 삭제, 또는 시스템 설정 > 일반 > 로그인 항목)
  - Keychain의 `UpdateProbe Safe Storage` 항목 삭제
  - `tccutil reset All app.example.updateprobe`
  - `~/Library/Caches/app.example.updateprobe.ShipIt`, `~/Library/Caches/updateprobe-updater`, `~/Library/Application Support/UpdateProbe` 삭제
  - 알림 설정에서 UpdateProbe 항목 정리

## 확인하지 못한 것

1. **실제 Squirrel.Mac 설치와 재실행**: 명시 DR로 검증 API는 통과했다. ShipIt 설치, 재실행, electron-builder가 만든 hardened runtime 번들의 최상위 재서명은 실행하지 않았다(실측은 packager로 만든 티켓 11 프로토타입).
2. **업데이트 뒤 Gatekeeper 재확인 여부**: quarantine이 없으니 묻지 않을 것으로 추론만 했다.
3. **앱 수정 보호(App Management)**: 공증되지 않은 ad-hoc 앱이 자기 번들을 바꿀 때 걸리는지 모른다.
4. **App Translocation**: `/Applications`로 옮기고 "그래도 열기"로 연 앱이 번역 실행되는지 보지 않았다.
5. **알림 권한, 로그인 항목, TCC**: 업데이트 뒤 유지되는지 1차 출처가 없다. 명시 DR일 때 TCC 유지도 추론이다.
6. **표준 계정**: Finder로 관리자 인증을 거쳐 설치한 번들의 소유자, Squirrel.Mac 관리자 인증 창의 실제 동작.
7. **Windows 실기 전체**: MOTW가 없는지, SmartScreen이 안 뜨는지, `/S --force-run` 재실행, UAC 없음, 설치 중 실패 시 상태.
8. **비공개 Release 자산의 Range 지원**: 공개 자산으로만 단일 Range 206, 다중 Range 501을 확인했다. 비공개 자산의 서명 URL도 같은 호스트라 같을 것으로 본다.
9. **ad-hoc Electron 앱의 실제 성공·실패 사례**: 공개 이슈에서 찾지 못했다.
10. **Sparkle + Electron**: `electron-sparkle-updater`의 동작과 유지 상태를 확인하지 않았다.

## 결론

### macOS: 조건부로 가능하다

- **조건**
  1. **최상위 번들을 명시 DR로 ad-hoc 서명한다.** `designated => identifier "app.squadify.stardraft"`를 `afterSign`에서 최상위에만 준다. 기본 ad-hoc(cdhash DR)으로는 Squirrel.Mac이 거부한다 [소스·실측]. `mac.requirements`는 중첩 코드를 깨므로 쓰지 않는다 [실측].
  2. **명시 DR이 든 첫 버전은 사이트에서 한 번 수동 설치한다.** 지금 배포본의 DR은 cdhash라서 그 버전에서 앱 내 업데이트로 넘어갈 수 없다 [추론].
  3. **앱이 쓸 수 있는 위치에 있다.** 앱을 쓰는 관리자 계정이 직접 `/Applications`에 설치했거나, 앱이 `~/Applications`에 있다. 표준 계정에서 `/Applications`의 앱은 업데이트마다 관리자 인증을 요구한다 [실측·소스].
  4. **App Translocation 상태가 아니다** [소스].
  5. **6절 실험에서 ShipIt 설치·재실행이 되고, 앱 수정 보호에 막히지 않는다.** 아직 미확인이다.
- **같이 감수하는 것**
  - Keychain 재허용은 업데이트마다 남는다. 수동 업데이트와 같다 [추론, 앞 조사].
  - 명시 DR은 신원을 보장하지 않는다. 업데이트 경로에 Gatekeeper 확인도 없다. 그래서 진위 확인을 앱이 따로 해야 한다(아래 추천 3).
- **직접 만든 업데이터**(Tauri 방식)도 가능하다. DR에 기대지 않고, 서명 검증과 되돌리기를 직접 쥔다. 대신 교체·재실행·되돌리기 코드를 만들고 시험해야 한다. 조건 3~5는 똑같이 적용된다 [소스·추론].
- **Sparkle 2**는 소스상 ad-hoc + EdDSA를 허용한다. 하지만 Electron용 네이티브 연결을 직접 만들거나 검증 안 된 패키지에 기대야 한다. 지금은 권하지 않는다 [소스·추론].

### Windows: 가능하다

- 근거는 문서와 소스다. 실기는 확인하지 않았다.
- 미서명이면 `publisherName`이 없어서 서명 검증을 건너뛴다 [소스].
- `quitAndInstall(true, true)`가 `--updated /S --force-run`으로 조용히 설치하고 다시 실행한다. 사용자별 설치라 UAC가 없다 [소스].
- 앱이 받은 설치 파일에는 MOTW가 없어 SmartScreen 경고가 뜨지 않을 것으로 본다. 업데이트마다 뜨던 SmartScreen 경고가 사라지는 효과가 있다 [추론].
- SAC가 켜진 PC는 앱 자체가 막힌다. 이미 지원 대상이 아니다 [문서].
- 서명 검증이 없으므로 진위 확인은 macOS와 마찬가지로 앱이 따로 해야 한다.

### 추천 방식

1. **두 OS 모두 electron-updater 6.8.x + generic provider로 간다.** 피드 주소는 Vercel 함수다.
   - `publish: [{ provider: "generic", url: "https://<사이트>/api/update", useMultipleRangeRequest: false }]`
   - `mac.target: ["dmg", "zip"]`. CI는 `--publish never`로 빌드하고, `latest.yml`, `latest-mac.yml`, zip, exe를 초안 Release에 함께 올린다.
   - 처음에는 `disableDifferentialDownload: true`로 차등 다운로드를 끈다. Vercel 함수가 옛 Release의 blockmap까지 찾을 필요가 없다.
   - Vercel 함수는 [4절](#vercel-함수가-맞춰야-할-것-추론)의 규칙으로 302 한다.
2. **macOS는 `afterSign`에서 최상위 번들만 명시 DR로 다시 서명한다.** Squirrel.Mac 자체 테스트와 같은 방식이다.
3. **앱이 업데이트 파일의 Ed25519 서명을 직접 검증한다.**
   - CI가 개인 키(GitHub Actions 비밀값)로 zip과 exe의 서명 파일을 만들어 함께 올린다. 앱에는 공개 키를 넣는다.
   - `autoInstallOnAppQuit = false`로 두고 `update-downloaded`에서 `downloadedFile`의 서명을 확인한 뒤에만 `quitAndInstall`을 부른다. `MacUpdater`는 이 값이 false면 Squirrel.Mac에 넘기는 일을 `quitAndInstall` 때까지 미룬다([MacUpdater.ts L249-288](https://github.com/electron-userland/electron-builder/blob/electron-builder%4026.17.0/packages/electron-updater/src/MacUpdater.ts#L249-L288)) [소스·추론].
4. **트레이 메뉴에 "재시작해서 업데이트"를 둔다.** 트레이 앱은 거의 종료되지 않으므로 종료 시 자동 설치에만 기대지 않는다 [추론].
5. **`state.db`는 `user_version`, 마이그레이션 전 사본, 높은 버전 거부를 갖춘다**([5절](#statedb-마이그레이션과의-관계-추론)).
6. **채택 전에 6절 실험을 한다.**
   - 변형 B가 실패하거나 앱 수정 보호에 막히면 macOS는 직접 만든 업데이터를 검토하거나 수동 배포를 유지한다.
   - Windows는 macOS 결과와 관계없이 진행할 수 있다.
   - 앱 내 업데이트를 범위 안으로 되돌리면 지도의 "범위 밖: 앱 내 자동 업데이트"와 서명 정책의 "업데이트 때마다 SmartScreen 경고 감수"를 함께 고친다.
