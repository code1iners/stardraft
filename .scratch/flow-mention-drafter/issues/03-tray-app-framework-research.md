# 트레이 데스크톱 앱 프레임워크와 미서명 배포 조사

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: research
Mode: AFK
Status: resolved
Blocked by:

## Question

Mac과 Windows에서 동작하는 트레이/메뉴바 데스크톱 앱을 만들 때, **Tauri v2와 Electron**이 아래 요구를 각각 어떻게 충족하는지 1차 출처로 비교한다. Wails처럼 눈에 띄는 대안이 있으면 짧게 덧붙인다.

1. **트레이와 창**: 트레이/메뉴바 아이콘, 트레이 메뉴, 클릭하면 검토 창이 열리는 동작.
2. **OS 알림**: 데스크톱 알림을 띄울 수 있는지, 알림을 클릭하면 앱의 특정 화면을 열 수 있는지. 미서명 상태에서도 알림이 동작하는지(특히 macOS).
3. **자동 시작**: 로그인 시 자동으로 시작하고 백그라운드에서 계속 실행되는 기능.
4. **자식 프로세스**: 외부 CLI(`claude`, `codex`)를 자식 프로세스로 실행하고 출력을 스트리밍으로 받는 방법. 사용자 셸의 PATH를 이어받는 방법.
5. **비밀 저장**: macOS Keychain과 Windows Credential Manager에 개인 API 키를 저장하는 방법.
6. **로컬 상태 저장**: SQLite 등으로 처리한 멘션과 초안을 저장하는 방법.
7. **미서명 배포 경험**: 미서명 dmg/exe를 만드는 방법과 설치할 때 사용자가 겪는 절차.
   - macOS: 최신 Gatekeeper 정책, quarantine 속성, Apple Silicon에서 ad-hoc 서명이 필요한지.
   - Windows: SmartScreen 경고.
   - 사용자에게 안내할 우회 절차도 정리한다.
8. **빌드 파이프라인**: GitHub Actions 같은 CI에서 Mac과 Windows 산출물을 만드는 방법.
9. **비용**: 번들 크기, 메모리 사용량, 개발 언어 부담(Rust/JS).

## 산출물

- 조사 결과 파일: `research/tray-app-framework.md`. 비교 표와 항목별 출처 URL을 포함한다.

## Answer

조사 결과: [트레이 데스크톱 앱 프레임워크와 미서명 배포 조사](../research/tray-app-framework.md)

- **기울기**: 미서명 전제에서는 Tauri v2가 유리하다. 최종 결정은 [08 grilling 티켓](08-desktop-stack.md)에서 한다.
- **macOS 알림**: Electron 42 이상(2026-05-07)과 Wails v3는 코드 서명이 없으면 알림이 뜨지 않는다. Tauri는 폐기 예정 API인 `NSUserNotification`으로 띄운다. 클릭 보고는 플러그인 2.6.0(2026-10-10)에서 막 생겨서 실기 검증이 필요하다.
- **자동 시작**: Electron 로그인 항목은 서명·공증이 없으면 조용히 실패할 수 있다고 문서에 적혀 있다. Tauri는 LaunchAgent plist 방식이고 이런 제약이 문서에 없다.
- **비슷한 항목**: 트레이, 자식 프로세스 스트리밍, CI는 둘 다 충분하다. Tauri는 공식 SQLite 플러그인과 `tauri-action`이 있는 대신 핵심 로직을 Rust로 써야 한다. Electron은 전부 TS로 쓸 수 있다.
- **비밀 저장**: Tauri는 커뮤니티 `keyring` 크레이트를, Electron은 `safeStorage`를 쓴다(Windows에서는 DPAPI). 둘 다 미서명이면 업데이트마다 Keychain 재허용을 물을 수 있다.
- **macOS 배포**: Apple Silicon은 서명 없는 실행 파일을 실행하지 않아서 ad-hoc 서명이 사실상 필수다. Sequoia부터는 시스템 설정 > 개인정보 보호 및 보안 > "그래도 열기"로만 열 수 있다.
- **Windows 배포**: 미서명 설치 파일은 버전마다 SmartScreen "추가 정보 > 실행"을 거친다. 스마트 앱 컨트롤이 켜진 PC에서는 실행할 방법이 없다.
