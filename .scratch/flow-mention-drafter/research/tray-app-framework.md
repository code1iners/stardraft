# 트레이 데스크톱 앱 프레임워크와 미서명 배포 조사

- 조사일: 2026-10-14
- 티켓: [트레이 데스크톱 앱 프레임워크와 미서명 배포 조사](../issues/03-tray-app-framework-research.md)
- 조사 방법
  - 공식 문서와 공식 저장소 소스만 읽었다. 패키지 설치, 프로젝트 생성, 빌드는 하지 않았다.
  - 그래서 "실제로 떠 본다"가 필요한 항목은 [확인하지 못한 것](#확인하지-못한-것)에 따로 모았다.
- 기준 버전 (crates.io, npm, GitHub Releases 조회 결과)
  - Tauri `2.12.3` 안정판. `3.0.0-alpha.4`도 이미 나와 있다.
  - `tauri-plugin-notification` `2.6.0` (2026-10-10 배포)
  - Electron `44.7.2` (2026-10-13). 지원 대상은 최신 안정 메이저 3개(44, 43, 42)다. [Electron 타임라인](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
  - Electron Forge `8.0.1`
  - Wails `v3.0.0-beta.29` (2026-10-13, 프리릴리스)
- 전제: 지도에서 정한 대로 트레이/메뉴바 앱, 코드 서명 없음, Mac과 Windows 지원이다.

## 한눈에 보기

| 항목 | Tauri v2 | Electron | 미서명 전제에서 |
|---|---|---|---|
| 1. 트레이와 창 | `TrayIconBuilder`, 클릭 이벤트, 메뉴. macOS Dock 숨김은 `ActivationPolicy::Accessory` | `Tray`, `click` 이벤트에 아이콘 위치(bounds) 포함. Dock 숨김은 `app.dock.hide()`나 `setActivationPolicy('accessory')` | 둘 다 충분 |
| 2. OS 알림과 클릭 | 데스크톱 알림 클릭 보고는 플러그인 2.6.0(2026-10-10)에서 추가됐다. macOS 경로는 폐기 예정 API인 `NSUserNotification`을 쓴다. Windows는 토스트가 화면에 떠 있을 때만 클릭을 보고한다 | Electron 42(2026-05-07)부터 macOS 알림은 **코드 서명이 필요**하다. 미서명이면 `failed` 이벤트만 온다 | **Tauri 우세**. 다만 실기 검증 필요 |
| 3. 자동 시작 | 공식 autostart 플러그인. macOS는 기본으로 `~/Library/LaunchAgents`에 plist를 둔다. Windows는 `Run` 레지스트리 값을 쓴다 | `app.setLoginItemSettings`. macOS는 "서명·공증해야 안정적으로 동작"하고, 미서명이면 조용히 실패할 수 있다 | **Tauri 우세** |
| 4. 자식 프로세스 | shell 플러그인(`spawn`이 줄 단위 이벤트를 보냄)이나 Rust `std::process`. PATH 보정 크레이트(`fix-path-env-rs`)를 Tauri 팀이 제공한다 | Node `child_process.spawn`의 stdout 스트림. PATH 보정은 직접 구현해야 한다 | 비슷함. Electron이 JS만으로 끝나 조금 쉽다 |
| 5. 비밀 저장 | 공식 키체인 플러그인이 없다. 커뮤니티 `keyring` 크레이트로 Keychain과 Credential Manager에 저장한다 | `safeStorage`가 내장돼 있다. macOS는 Keychain 키로 암호화하고, Windows는 Credential Manager가 아닌 DPAPI를 쓴다 | 둘 다 미서명이면 업데이트마다 Keychain 재허용을 물을 수 있다 |
| 6. 로컬 상태 | 공식 SQL 플러그인(sqlx, SQLite)과 Store 플러그인 | 네이티브 모듈(better-sqlite3 등)을 Electron ABI에 맞춰 다시 빌드해야 한다. `node:sqlite`는 Node 24에서 아직 실험 단계다 | Tauri가 조금 쉽다 |
| 7. 미서명 배포 | `signingIdentity: "-"`로 번들 전체를 ad-hoc 서명한다. 설정이 없으면 번들 서명을 건너뛴다 | 공식 arm64 바이너리는 ad-hoc 서명된 채로 나온다. Packager는 프레임워크 서명만 복구하고, 앱 전체 서명은 `osxSign`을 줘야 한다 | 둘 다 ad-hoc 서명을 권장한다. 사용자 절차는 같다 |
| 8. CI | 공식 `tauri-action`. 공식 문서가 macOS(arm64/x64)와 Windows 매트릭스 예제를 제공한다 | Forge `make`를 OS별 러너에서 실행하고, GitHub Publisher로 릴리스한다. DMG는 macOS에서만 만들 수 있다 | 비슷함. Tauri가 조금 쉽다 |
| 9. 비용 | 최소 앱 600KB 미만. 시스템 웹뷰를 쓴다. 백그라운드 로직에는 사실상 Rust가 필요하다 | 런타임 zip만 124MiB(macOS arm64), 151MiB(Windows x64)다. 전부 TS로 짤 수 있다 | 크기는 Tauri, 언어 부담은 Electron이 유리 |

## 1. 트레이와 창

**Tauri v2**
- `tray-icon` 기능을 켜고 `TrayIconBuilder`로 아이콘과 메뉴를 만든다. JS에서는 `TrayIcon.new`를 쓴다. [System Tray](https://v2.tauri.app/learn/system-tray/)
- 클릭 처리
  - `on_tray_icon_event`에서 `TrayIconEvent::Click`(왼쪽 버튼, `Up`)을 받는다.
  - 받은 뒤 `get_webview_window("main")`의 `show()`와 `set_focus()`로 검토 화면을 연다. 같은 문서에 예제가 있다.
  - 메뉴는 기본으로 왼쪽 클릭에도 열린다. 왼쪽 클릭을 창 열기에 쓰려면 `show_menu_on_left_click(false)`로 끈다.
- macOS 메뉴바 전용 앱
  - `set_activation_policy(ActivationPolicy::Accessory)`와 `set_dock_visibility`를 쓴다. [tauri `app.rs`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri/src/app.rs)
  - 창을 모두 닫아도 앱이 살아 있게 하려면 `RunEvent::ExitRequested`에서 `prevent_exit()`를 호출한다(같은 파일).
- 창을 트레이 아래에 붙이는 데는 공식 Positioner 플러그인이 있다. [플러그인 목록](https://v2.tauri.app/plugin/)

**Electron**
- `new Tray(image)`, `setContextMenu`, `click` 이벤트를 쓴다. `click`은 아이콘의 `bounds`를 함께 넘기고, `getBounds()`도 있다(macOS, Windows). 창을 아이콘 아래에 두기 쉽다. [Tray](https://www.electronjs.org/docs/latest/api/tray)
- macOS에서는 아이콘에 Template 이미지를 권장한다. 컨텍스트 메뉴를 설정하면 `mouse-up` 이벤트가 오지 않는다(같은 문서).
- `window-all-closed` 이벤트
  - 구독하지 않으면 창이 모두 닫힐 때 앱이 종료된다.
  - 트레이 앱은 이 이벤트를 구독해서 종료를 막아야 한다. [app](https://www.electronjs.org/docs/latest/api/app)
- Dock을 숨기는 방법
  - `app.dock.hide()`를 쓴다. 1초 안에 다시 호출하면 무시되는 알려진 문제가 있다. [dock](https://www.electronjs.org/docs/latest/api/dock)
  - `app.setActivationPolicy('accessory')`도 된다. [app](https://www.electronjs.org/docs/latest/api/app)

**판단**: 둘 다 요구를 충족한다. 차이가 없다.

## 2. OS 알림과 클릭

이 항목이 두 프레임워크를 가르는 가장 큰 차이다.

**Tauri v2** (`tauri-plugin-notification`)
- **클릭 보고는 막 생겼다**
  - 2.6.0(2026-10-10 배포)에서 "Report actions on desktop"이 들어왔다. 데스크톱에서도 알림 클릭(`tap`)이 JS `onAction`과 Rust `Notification::on_action`에 전달된다. [CHANGELOG](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/CHANGELOG.md), [PR #3671](https://github.com/tauri-apps/plugins-workspace/pull/3671)
  - 공식 문서 페이지는 아직 "The Actions API is only available on mobile platforms"라고 적혀 있다. 문서가 소스보다 늦다. [Notification 문서](https://v2.tauri.app/plugin/notification/)
- **플랫폼별 제약** ([`desktop.rs`](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/src/desktop.rs))
  - 핸들러나 리스너가 없으면 클릭이 보고되지 않는다.
  - Windows는 토스트가 화면에 떠 있는 동안만 클릭을 보고한다. 알림 센터로 넘어간 뒤의 클릭은 받지 못한다.
  - macOS는 개발 모드에서 `com.apple.Terminal` 명의로 알림을 띄우고, 릴리스 빌드에서는 앱의 번들 식별자를 쓴다.
- **macOS 구현이 폐기 예정 API에 기대고 있다**
  - 플러그인은 `notify-rust` 4.18 기본 기능을 쓴다. 그 macOS 백엔드는 `mac-notification-sys`다. [플러그인 Cargo.toml](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/Cargo.toml)
  - `mac-notification-sys`는 `NSUserNotificationCenter`를 호출한다. [notify.m](https://github.com/h4llow3En/mac-notification-sys/blob/master/objc/notify.m)
  - `UNUserNotificationCenter` 백엔드는 `preview-macos-un` 기능으로 따로 있고, 기본으로 꺼져 있다. [notify-rust Cargo.toml](https://github.com/hoodie/notify-rust/blob/main/Cargo.toml)
  - Apple은 `NSUserNotificationCenter`를 macOS 11.0부터 폐기 예정으로 표시했다. [Apple 문서](https://developer.apple.com/documentation/foundation/nsusernotificationcenter)
  - `setApplication`은 번들 식별자가 LaunchServices에 등록돼 있어야 동작한다(`LSCopyApplicationURLsForBundleIdentifier` 확인, 같은 notify.m). 앱을 한 번 설치해 실행한 뒤에야 제 이름으로 알림이 뜬다고 보인다. 이 부분은 추론이다.
- **미서명 상태에서**
  - `NSUserNotification` 경로는 서명을 요구한다는 기록이 없다.
  - Electron이 같은 API에서 `UNNotification`으로 옮기면서 "새 API는 서명이 필요하다"고 밝혔다(아래 Electron 항목). 그래서 옛 API는 미서명에서도 동작해 왔다고 추론한다.
  - 다만 macOS 26/27에서 폐기 예정 API가 여전히 동작하는지 확인한 1차 출처는 없다.
- Windows는 "Only works for installed apps"다. 개발 중에는 PowerShell 이름과 아이콘으로 뜬다. [Notification 문서](https://v2.tauri.app/plugin/notification/)

**Electron**
- **Electron 42(2026-05-07)부터 macOS 알림이 `UNNotification`으로 바뀌었다**
  - 릴리스 노트 원문: "The new API requires that an application be code-signed in order for notifications to be displayed." [Electron 42 블로그](https://www.electronjs.org/blog/electron-42-0), [PR #47817](https://github.com/electron/electron/pull/47817)
  - API 문서: "This API requires an application to be code-signed in order for notifications to appear. Unsigned binaries will emit a `failed` event". [Notification](https://www.electronjs.org/docs/latest/api/notification)
- **ad-hoc 서명으로는 부족해 보인다**
  - 같은 PR에서 Electron CI 주석이 바뀌었다.
    - 원래 주석: "arm64 builds are already ad-hoc signed"
    - 바뀐 주석: "Sign with our self-signed cert so that macOS system integrations (UNNotifications, dock bounce, etc.) work"
  - 테스트용 자체 서명 인증서로 다시 서명하도록 고친 것이다. [PR #47817 변경 파일](https://github.com/electron/electron/pull/47817/files)
  - 코드 서명 문서도 "an unsigned or ad-hoc signed app may behave inconsistently"라고 적는다. [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- `NSUserNotification`을 쓰던 마지막 메이저는 41이다. 지원 정책상 이미 지원 대상(최신 3개)이 아니다. [타임라인](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)
- 클릭 처리
  - 메인 프로세스 `Notification`의 `click` 이벤트로 받는다.
  - Windows는 `Notification.handleActivation(callback)`으로 등록 전에 일어난 클릭까지 받는다. [Notification](https://www.electronjs.org/docs/latest/api/notification)
- Windows 알림에는 AppUserModelID가 있는 시작 메뉴 바로가기가 필요하다. Squirrel로 설치하면 자동으로 설정된다. [Notifications 튜토리얼](https://www.electronjs.org/docs/latest/tutorial/notifications)

**판단**
- Electron은 미서명 전제에서 macOS 알림을 띄울 수 없다.
- Tauri는 띄울 수 있지만 두 가지가 걸린다.
  - 폐기 예정 API에 의존한다.
  - 클릭 보고 기능이 나온 지 4일밖에 안 됐다.
- "알림을 클릭하면 검토 화면이 열린다"는 전제는 실기 검증이 필요하다.

## 3. 자동 시작

**Tauri v2** (`tauri-plugin-autostart` 2.7.0)
- `enable()`, `disable()`, `isEnabled()`를 제공한다. 시작 인자를 넘길 수 있어 `--hidden` 같은 플래그를 앱이 직접 처리하면 된다. [Autostart](https://v2.tauri.app/plugin/autostart/)
- 동작 방식은 소스에서 확인했다. [lib.rs](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/autostart/src/lib.rs)
  - macOS 기본값은 `MacosLauncher::LaunchAgent`로, `~/Library/LaunchAgents`에 plist를 둔다. `AppleScript` 방식도 고를 수 있다.
  - Windows는 `Run` 레지스트리 값을 쓴다.
  - 등록할 때 **현재 실행 파일 경로**를 기록한다. 그래서 사용자가 앱을 응용 프로그램 폴더로 옮긴 뒤에 켜야 한다.

**Electron**
- `app.setLoginItemSettings({ openAtLogin })`를 쓴다. macOS 기본 `type`은 `mainAppService`(SMAppService)다. [app](https://www.electronjs.org/docs/latest/api/app)
- 문서 경고 원문: "your app should be code signed and notarized for login item settings to work reliably. When an app isn't packaged, code signed, and notarized, `openAtLogin` may silently fail to take effect." [app](https://www.electronjs.org/docs/latest/api/app), [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- `openAsHidden`은 제거됐다. 숨김 시작은 인자나 앱 로직으로 처리한다.

**판단**: 미서명 전제에서는 Tauri의 LaunchAgent 방식이 덜 위험하다. Electron에서도 plist를 직접 쓰면 우회할 수 있지만 그 부분은 직접 구현해야 한다.

## 4. 자식 프로세스와 PATH

에이전트 CLI(`claude`, `codex`)를 비대화형으로 실행하고 출력을 스트리밍으로 받는 부분이다.

**Tauri v2**
- JS에서 쓸 때 ([shell JS 레퍼런스](https://v2.tauri.app/reference/javascript/shell/))
  - `Command.create(name, args).spawn()`으로 실행한다.
  - `stdout.on('data')`가 **줄 단위**로 이벤트를 보낸다. `raw` 인코딩을 주면 청크 단위로 바뀐다.
  - 종료는 `close` 이벤트로 받는다. `kill()`과 `write()`(stdin)를 쓸 수 있다.
  - `processGroup: true`를 주면 프로세스 트리 전체를 종료할 수 있다.
  - 프로그램과 인자는 capability 파일의 scope에 허용 목록으로 적어야 한다. 기본은 "no arguments are allowed"다. [Shell](https://v2.tauri.app/plugin/shell/)
- Rust에서 쓸 때
  - `app.shell().command(..).spawn()`이 `(Receiver<CommandEvent>, CommandChild)`를 돌려준다. `envs`, `env_clear`, `current_dir`도 있다. [docs.rs](https://docs.rs/tauri-plugin-shell/latest/tauri_plugin_shell/process/struct.Command.html)
  - 표준 `std::process`나 `tokio::process`를 그대로 써도 된다.
- **PATH**
  - Tauri 문서 원문: GUI apps on macOS and Linux "do not inherit the `$PATH` from your shell dotfiles". [DMG 문서](https://v2.tauri.app/distribute/dmg/)
  - Tauri 팀의 [`fix-path-env-rs`](https://github.com/tauri-apps/fix-path-env-rs)가 셸 설정을 읽어 PATH를 고친다. `fix_path_env::fix()` 한 줄이면 된다.

**Electron**
- Node `child_process.spawn`의 `stdout`이 스트림이라 `'data'` 이벤트로 바로 받는다. [child_process](https://nodejs.org/api/child_process.html)
  - `env` 기본값은 `process.env`다.
  - 출력을 읽지 않으면 파이프 버퍼가 차서 자식이 멈출 수 있다.
- PATH 문제는 OS 동작이라 Electron도 똑같이 겪는다. 공식 보정 도구는 없다. 로그인 셸(`$SHELL -ilc`)로 PATH를 한 번 읽어 오거나, CLI 절대 경로를 설정에서 받는 방식을 직접 구현한다.

**Windows 공통 주의**
- npm 전역 설치 CLI는 `.cmd` 심(shim)으로 깔리는 경우가 많다.
- Node는 `.bat`/`.cmd`를 `execFile`로 실행할 수 없다. `cmd.exe /c`로 실행해야 한다. [child_process](https://nodejs.org/api/child_process.html)
- Rust `Command`는 배치 파일을 암묵적으로 `cmd.exe`로 실행한다. 1.77.2부터는 안전하게 이스케이프할 수 없는 인자가 있으면 `InvalidInput` 오류를 낸다. [Rust 보안 공지](https://blog.rust-lang.org/2024/04/09/cve-2024-24576/)
- 에이전트에 줄 프롬프트(게시물 본문 등)는 인자 대신 stdin으로 넘기는 편이 안전하다. 이 줄은 위 두 출처에서 끌어낸 권고다.

**판단**: 둘 다 충분하다. Electron이 JS만으로 끝난다. Tauri는 PATH 보정 도구를 공식으로 갖추고 있다.

## 5. 비밀 저장 (개인 API 키)

**Tauri v2**
- 공식 플러그인 30개 가운데 OS 키체인 연동은 없다. [플러그인 목록](https://v2.tauri.app/plugin/)
  - 가장 가까운 공식 플러그인은 Stronghold다. 앱이 직접 관리하는 비밀번호로 여는 암호화 볼트라서 OS 키체인과는 다르다. [Stronghold](https://v2.tauri.app/plugin/stronghold/)
- 실제로는 커뮤니티 크레이트 [`keyring`](https://github.com/open-source-cooperative/keyring-rs)(4.2.0)를 Rust 코어에서 쓴다.
  - 기본 `v1` 기능으로 macOS Keychain, Windows Credential Manager, Linux Secret Service에 저장한다.
  - 저장소 README가 Tauri 2 데모 앱을 함께 안내한다.

**Electron**
- `safeStorage`가 내장돼 있다. [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
  - 문자열을 암호화해 `Buffer`로 돌려준다. 앱이 이 암호문을 파일이나 DB에 저장한다.
  - macOS는 암호화 키를 Keychain에 둔다.
  - Windows는 **DPAPI**를 쓴다. 다른 사용자로부터는 보호되지만 같은 사용자의 다른 앱으로부터는 보호되지 않는다. Credential Manager에 직접 넣으려면 네이티브 모듈이 필요하다.
  - 예전에 많이 쓰던 `keytar`는 2022-12에 보관(archived) 처리됐다. [atom/node-keytar](https://github.com/atom/node-keytar)

**미서명의 영향 (둘 다)**
- Electron 문서 원문: "Without a valid, consistent code signature, macOS may be unable to tell that two builds of your unsigned app are 'the same app', which can cause the Keychain to prompt the user for permission again after every update". [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
- 이것은 Keychain ACL의 동작이다. 그래서 Tauri와 `keyring` 조합에도 똑같이 적용된다고 본다(추론).
- 결과적으로 새 버전을 설치할 때마다 Keychain 접근 허용 대화상자가 다시 뜰 수 있다.

## 6. 로컬 상태 저장 (처리한 멘션과 초안)

**Tauri v2**
- 공식 SQL 플러그인이 sqlx 기반으로 SQLite를 지원한다. [SQL](https://v2.tauri.app/plugin/sql/)
  - 경로는 `BaseDirectory::AppConfig` 기준이다.
  - Rust 쪽에 마이그레이션을 정의하고 앱 시작 때 `preload`로 적용할 수 있다.
  - JS에서 쓰려면 `sql:allow-execute` 권한을 따로 켜야 한다.
- 설정 같은 키-값 데이터에는 Store 플러그인이 있다. [플러그인 목록](https://v2.tauri.app/plugin/)
- Rust 코어에서 sqlx나 rusqlite를 직접 써도 된다.

**Electron**
- better-sqlite3 같은 네이티브 모듈은 Electron ABI에 맞춰 다시 빌드해야 한다. Forge가 이 작업을 자동으로 해 준다. [Native Node Modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)
- 내장 `node:sqlite`에는 제약이 있다.
  - Node v22.5.0에 추가됐고, release candidate 단계는 v25.7.0부터다. [node:sqlite](https://nodejs.org/api/sqlite.html)
  - Electron 44가 쓰는 Node는 24.21.0이라 아직 실험 단계다. [releases.json](https://releases.electronjs.org/releases.json)
  - Electron이 이 모듈을 노출하는지는 1차 출처로 확인하지 못했다.

**판단**: Tauri가 공식 경로로 바로 된다. Electron은 네이티브 모듈 관리가 조금 더 든다.

## 7. 미서명 배포 경험

### 산출물 만들기

**Tauri v2**
- macOS
  - `tauri build --bundles dmg`로 만든다. 문서는 Mac에서 빌드하라고 안내한다. [DMG](https://v2.tauri.app/distribute/dmg/)
  - CI에서는 DMG 아이콘 위치가 적용되지 않는 알려진 문제가 있다(같은 문서).
- Windows
  - NSIS `-setup.exe`나 WiX `.msi`를 만든다. [Windows Installer](https://v2.tauri.app/distribute/windows-installer/)
  - NSIS 기본은 사용자별 설치다. `%LOCALAPPDATA%`에 깔리고 관리자 권한이 필요 없다.
  - WebView2 기본 모드는 `downloadBootstrapper`(추가 0MB)다. Windows 10(2018-04 이후)과 Windows 11에는 WebView2가 이미 들어 있다.
  - macOS에서 Windows 설치 파일을 교차 빌드할 수 있지만 NSIS만 되고, 문서가 "last resort"라고 부른다.
- **ad-hoc 서명**
  - `bundle > macOS > signingIdentity`를 `"-"`로 설정한다. [macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
  - 문서는 이 설정이 Apple Silicon에서 유용하다고 적는다. 다만 Privacy & Security에서 허용하는 절차를 없애 주지는 않는다.
  - 설정이 없으면 번들러가 서명 단계를 통째로 건너뛴다. `keychain()`이 `None`을 돌려주기 때문이다. [bundler app.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-bundler/src/bundle/macos/app.rs)

**Electron**
- DMG는 Forge DMG maker로 만들고 macOS에서만 빌드된다. [maker-dmg](https://www.electronforge.io/config/makers/dmg)
- Windows는 Squirrel.Windows maker로 `Setup.exe`를 만든다. 문서는 "no-prompt, no-hassle, no-admin" 설치라고 소개한다. Windows나, mono와 wine을 깐 Linux에서 빌드할 수 있다. [maker-squirrel](https://www.electronforge.io/config/makers/squirrel.windows)
- **서명 상태** ([packager mac.ts](https://github.com/electron/packager/blob/main/src/mac.ts))
  - 공식 Electron 빌드는 ad-hoc 서명된 채로 배포된다.
  - Packager는 무결성 다이제스트를 쓴 뒤 프레임워크의 ad-hoc 서명만 복구한다(`codesign --sign - --force --deep`).
  - 앱 전체 서명은 `osxSign` 옵션을 줄 때만 한다.
- 코드 서명 문서는 미서명 앱 예시로 "The app is damaged" Gatekeeper 경고 그림을 싣고 있다. [Code Signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)

### macOS: Gatekeeper, quarantine, Apple Silicon

- **Apple Silicon은 서명 없는 실행 파일을 실행하지 않는다**
  - "any executable must be signed before it's allowed to run. There isn't a specific identity requirement for this signature: a simple ad-hoc signature is sufficient." [macOS Big Sur 11.0.1 Universal Apps Release Notes](https://developer.apple.com/documentation/macos-release-notes/macos-big-sur-11_0_1-universal-apps-release-notes)
  - Rosetta로 도는 x86 바이너리와 Intel Mac에는 해당하지 않는다.
  - 결론: 실행 자체에는 ad-hoc 서명이면 충분하다. 미서명 배포에서도 **ad-hoc 서명은 사실상 필수**다.
- **Sequoia(macOS 15)의 변경**
  - Apple 개발자 뉴스(2024-08-06) 원문: "users will no longer be able to Control-click to override Gatekeeper when opening software that isn't signed correctly or notarized. They'll need to visit System Settings > Privacy & Security". [Updates to runtime protection in macOS Sequoia](https://developer.apple.com/news/?id=saqachfa)
- **현재 공식 안내**
  - Apple 지원 문서 102445(2026-05-27 게시)에 나온 절차는 이렇다. 먼저 앱을 열어 보고, 시스템 설정 > 개인정보 보호 및 보안에서 "그래도 열기(Open Anyway)"를 누른 뒤, 다시 뜨는 경고에서 "열기"를 누른다. 그러면 예외로 저장된다. [Safely open apps on your Mac](https://support.apple.com/en-us/102445)
  - Mac 사용 설명서(현재 기본 버전이 macOS 27)에도 같은 절차가 있다. 여기에 두 가지가 더 적혀 있다. 버튼은 "about an hour" 동안만 보이고, 로그인 암호를 입력해야 한다. [Open a Mac app from an unknown developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)
- **quarantine**
  - Gatekeeper는 내려받은 소프트웨어의 출처를 추적한다. 처음 열 때 사용자 승인을 받는다. [Gatekeeper and runtime protection](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)
  - 앱이 만든 파일에 quarantine을 붙이는 설정은 `LSFileQuarantineEnabled`다. [Apple 문서](https://developer.apple.com/documentation/bundleresources/information-property-list/lsfilequarantineenabled)
  - `com.apple.quarantine` 속성을 지우는 `xattr` 우회는 Apple 사용자 안내에 없다. 아래 안내문에서는 최후 수단으로만 둔다.
- **"손상됨" 메시지**: Apple은 변경되거나 손상된 소프트웨어를 감지하면 열 수 없다고 알린다고 설명한다. [102445](https://support.apple.com/en-us/102445) 서명이 없거나 깨진 번들이 이 경로로 갈 가능성이 높다. 그래서 번들 전체에 ad-hoc 서명을 하는 것을 기본으로 권한다.

### Windows: SmartScreen과 스마트 앱 컨트롤

- **SmartScreen** ([SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation), ms.date 2026-05-04)
  - 미서명 파일은 "Windows protected your PC" 경고를 띄운다. 사용자가 "Run anyway"를 골라야 실행된다.
  - 같은 문서에 "Enterprise policy can prevent continuation entirely"라고 적혀 있다.
  - 미서명 파일은 **새 버전마다 평판이 0에서 다시 시작**한다. 업데이트할 때마다 경고가 다시 뜬다.
  - 자체 서명 인증서는 미서명과 똑같이 취급된다.
  - EV 인증서도 이제 경고를 없애 주지 않는다.
- **스마트 앱 컨트롤(Windows 11)**
  - 원문: "Malware, Potentially Unwanted Apps (PUA), and unknown, unsigned code are blocked by default." [Smart App Control](https://learn.microsoft.com/en-us/windows/apps/develop/smart-app-control/overview) (ms.date 2026-09-30)
  - 다운로드한 파일뿐 아니라 모든 실행 파일에 적용된다. [SmartScreen reputation 문서](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
  - 원문: "There is currently no way to bypass Smart App Control protection for individual apps." 끄는 것만 가능하다. 최근 업데이트부터는 다시 켤 때 재설치가 필요 없다. [What is Smart App Control](https://support.microsoft.com/en-us/topic/what-is-smart-app-control-285ea03d-fa88-4d56-882e-6698afdb7003)
  - 결론: **스마트 앱 컨트롤이 켜진(On) PC에서는 미서명 앱을 실행할 방법이 없다.**
- **참고 (범위 밖)**: Microsoft가 권장하는 서명 서비스는 Artifact Signing(구 Trusted Signing)이다. 월 9.99달러부터다(위 SmartScreen 문서).

### 사용자 안내문 초안

> 이 앱은 코드 서명을 하지 않은 사내용 도구라서 설치할 때 보안 경고가 뜹니다. 아래 순서대로 진행하세요. 출처가 이 다운로드 사이트인지 먼저 확인하세요.

**macOS (Sequoia 15 이상. Apple 사용 설명서 현재판인 macOS 27 기준)**

1. 내려받은 `.dmg`를 열고 앱 아이콘을 **응용 프로그램** 폴더로 끌어다 놓습니다. 자동 시작이 이 위치를 기록하므로 반드시 옮긴 뒤 실행합니다.
2. 응용 프로그램 폴더에서 앱을 더블클릭합니다. 열 수 없다는 경고가 뜨면 **완료**를 눌러 닫습니다. 우클릭 > 열기로는 더 이상 넘어갈 수 없습니다.
3. 1시간 안에 **시스템 설정 > 개인정보 보호 및 보안**으로 갑니다. 아래쪽 보안 항목에서 앱 이름 옆의 **그래도 열기**를 누릅니다.
4. 로그인 암호를 입력하고, 다시 뜨는 경고에서 **열기**를 누릅니다. 이후에는 그냥 더블클릭으로 열립니다.
5. 처음 실행하면 OS 알림 권한을 묻습니다. **허용**을 누릅니다. 개인 API 키를 저장할 때는 Keychain 접근을 묻는데, **항상 허용**을 누릅니다. 새 버전을 설치하면 이 질문이 다시 나올 수 있습니다.
6. (최후 수단) "손상되었기 때문에 열 수 없습니다"라고만 뜨고 3번의 버튼이 보이지 않으면 터미널에서 아래 명령을 실행한 뒤 다시 엽니다. 이 다운로드 사이트에서 받은 파일에만 사용하세요.
   `xattr -dr com.apple.quarantine "/Applications/<앱 이름>.app"`

**Windows 10/11**

1. 먼저 **Windows 보안** 앱에서 **앱 및 브라우저 컨트롤 > 스마트 앱 컨트롤**을 확인합니다. **켜기**로 되어 있으면 이 앱은 실행되지 않습니다. 끌지 말고 관리자에게 문의하세요. **평가**나 **끄기**면 계속 진행합니다.
2. 내려받은 `<앱 이름>-setup.exe`를 실행합니다.
3. "Windows의 PC 보호" 화면이 뜨면 **추가 정보**를 누르고 **실행**을 누릅니다. 이 버튼이 없으면 회사 정책으로 막힌 것입니다.
4. 설치 프로그램은 관리자 권한 없이 내 계정에만 설치합니다.
5. 새 버전을 설치할 때마다 3번 경고가 다시 나옵니다.

## 8. 빌드 파이프라인 (GitHub Actions)

- **러너** ([GitHub-hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners))
  - `macos-latest`(`macos-14/15/26`)는 arm64다. Intel이 필요하면 `macos-15-intel`이나 `macos-26-intel`을 쓴다.
  - `windows-latest`(`windows-2025/2022`)는 x64다. `windows-11-arm`도 있다.
- **비용** ([runner pricing](https://docs.github.com/en/billing/reference/actions-runner-pricing))
  - 공개 저장소의 표준 러너는 무료다.
  - 비공개 저장소는 분당 macOS 0.062달러, Windows 0.010달러, Linux 0.006달러다.
- **Tauri**
  - 공식 문서가 [`tauri-apps/tauri-action@v1`](https://github.com/tauri-apps/tauri-action) 매트릭스 예제를 제공한다. [GitHub pipeline](https://v2.tauri.app/distribute/pipelines/github/)
    - macOS arm64(`--target aarch64-apple-darwin`)
    - macOS x64(`--target x86_64-apple-darwin`)
    - `windows-latest`
    - Ubuntu
  - 서명 비밀값 없이 `GITHUB_TOKEN`만으로 초안 릴리스를 만든다. 권한은 `contents: write`가 필요하다.
  - `tagName`, `releaseName`, `releaseId`를 빼면 빌드만 한다. `uploadWorkflowArtifacts`로 워크플로 아티팩트에 올릴 수도 있다.
  - ad-hoc 서명은 `tauri.conf.json`의 `signingIdentity: "-"`만 있으면 CI에서도 그대로 적용된다.
- **Electron**
  - 공식 빌드 액션은 없다. OS별 러너에서 `electron-forge make`나 `publish`를 실행한다.
  - DMG는 macOS 러너가 꼭 필요하다. Squirrel은 Windows 러너에서 만드는 편이 무난하다.
  - GitHub Publisher는 `GITHUB_TOKEN`과 `contents: write`로 릴리스에 올린다. [publisher-github](https://www.electronforge.io/config/publishers/github)
  - 앱 전체 ad-hoc 서명은 `osxSign` 설정이나 별도 `codesign --sign -` 단계로 직접 넣어야 한다.

## 9. 비용

- **번들 크기**
  - Tauri: "a minimal Tauri app can be less than 600KB in size." [What is Tauri?](https://v2.tauri.app/start/)
    - 웹뷰 라이브러리를 실행 파일에 넣지 않는다. [Process Model](https://v2.tauri.app/concept/process-model/)
    - macOS는 OS에 들어 있는 WKWebView를, Windows는 WebView2를 쓴다. [Webview Versions](https://v2.tauri.app/reference/webview-versions/)
    - 실제 앱 크기는 프론트엔드와 Rust 의존성에 따라 늘어나며, 측정하지 않았다.
  - Electron: 2026-10-14에 v44.7.2 릴리스 자산을 직접 조회했다. [Releases](https://github.com/electron/electron/releases/tag/v44.7.2)
    - 런타임 zip만 `darwin-arm64` 124.4MiB, `darwin-x64` 127.9MiB, `win32-x64` 150.6MiB다.
    - 앱 산출물은 여기에 앱 코드가 더해진다.
- **메모리**
  - 두 프레임워크 모두 메모리 수치를 공식으로 내놓지 않는다.
  - 둘 다 다중 프로세스 구조다.
    - Tauri: Rust 코어와 시스템 웹뷰 프로세스. [Process Model](https://v2.tauri.app/concept/process-model/)
    - Electron: 메인, 렌더러, 유틸리티 프로세스. [Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
  - 트레이에 상주하고 검토 화면 창은 대부분 닫혀 있는 앱이라면 실제 비교는 프로토타입에서 재야 한다.
- **언어 부담**
  - Tauri
    - UI는 어떤 JS 프레임워크로든 만들 수 있다. [What is Tauri?](https://v2.tauri.app/start/)
    - 창이 닫혀도 계속 돌아야 하는 백그라운드 로직은 Rust 코어에 두는 것이 자연스럽다. 폴링, 에이전트 실행, 게시, Keychain 접근이 여기에 해당한다. 웹뷰는 창과 함께 사라진다.
    - 결국 핵심 로직은 Rust로 쓰게 된다.
    - 플러그인 MSRV는 Rust 1.90이다. [Notification 문서](https://v2.tauri.app/plugin/notification/)
  - Electron: 메인 프로세스가 Node라서 핵심 로직과 UI를 모두 TS로 쓸 수 있다.
- **유지 부담**
  - Tauri는 v3 알파가 나와 있다. 나중에 메이저 이전 작업이 생길 수 있다. [crates.io tauri](https://crates.io/crates/tauri)
  - Electron은 8주마다 메이저가 나오고 최신 3개만 지원한다. [타임라인](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)

## 대안: Wails v3

- Go 백엔드와 웹 프런트엔드 구조다.
- v3는 아직 베타다. 최신은 `v3.0.0-beta.29`(2026-10-13, 프리릴리스)다. [Releases](https://github.com/wailsapp/wails/releases)
- 소스에 시스템 트레이(`systemtray_darwin.m` 등), notifications, sqlite 서비스가 들어 있다.
- macOS 알림 서비스는 "Your app must be packaged and signed for this feature to work."라고 적혀 있다. 시작할 때 번들 식별자도 검사한다. [notifications_darwin.go](https://github.com/wailsapp/wails/blob/master/v3/pkg/services/notifications/notifications_darwin.go)
- 판단: 미서명 macOS 알림에서 Electron과 같은 문제가 있고, 아직 베타다. 이번 요구에는 우선순위가 낮다.

## 확인하지 못한 것

문서만으로는 결론을 낼 수 없었다. 실제 Mac과 Windows에서 확인해야 한다.

1. **Tauri 알림 (macOS 26/27)**: ad-hoc 서명한 Tauri 앱의 `NSUserNotification` 알림이 실제로 뜨는지 확인한다. 클릭하면 `onAction`이 불리는지도 본다.
2. **Electron 알림의 서명 조건**: Electron 42 이상에서 ad-hoc 서명이나 무료 자체 서명 인증서만으로 `UNNotification`이 동작하는지 확인한다. Electron CI 주석으로 보면 ad-hoc은 부족하다.
3. **macOS 다운로드 설치 경험**: 브라우저로 내려받은 ad-hoc 서명 DMG가 어느 경고로 가는지 확인한다. "그래도 열기" 경로인지, "손상됨" 경로인지 본다. 서명하지 않은 번들과도 비교한다.
4. **Keychain 재허용**: 미서명 업데이트 뒤 Keychain 재허용 프롬프트가 실제로 얼마나 자주 뜨는지 확인한다.
5. **`node:sqlite`**: Electron 44에서 `node:sqlite`를 쓸 수 있는지 확인한다.
6. **Windows 알림 센터 클릭**: Tauri 앱에서 알림 센터로 넘어간 토스트를 클릭했을 때 무엇이 일어나는지 확인한다. 소스상으로는 보고되지 않는다.

## 앱 설계에 주는 함의

1. 감지, 에이전트 실행, 게시는 창과 무관한 코어 프로세스에 둔다. Tauri라면 Rust, Electron이라면 main이다. 검토 화면 창은 열고 닫아도 상태가 유지되게 한다.
2. 미서명에서 macOS OS 알림 클릭은 가장 약한 고리다. 그래서 기본 경로를 트레이 아이콘 상태 표시와 트레이 클릭으로 검토 화면 열기로 잡는다. OS 알림은 실패해도 되는 보조 수단으로 설계한다.
3. ad-hoc 서명(`codesign -s -`)은 무료이고 Apple Silicon에서 실행 요건이다. "코드 서명 안 함"의 예외로 기본 적용한다.
4. 에이전트 CLI 경로는 셸 PATH를 보정해서 찾고, 사용자가 절대 경로를 직접 지정할 수 있게 한다. 프롬프트는 stdin으로 넘긴다.
5. 개인 API 키는 OS 키체인에 저장한다. 업데이트마다 접근 허용을 다시 물을 수 있으니 온보딩과 안내문에 반영한다.
