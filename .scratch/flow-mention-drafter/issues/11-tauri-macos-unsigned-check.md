# 미서명 앱 macOS 실기 검증

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: task
Mode: HITL (에이전트가 최소 앱을 빌드하고, Gatekeeper 대화상자 처리와 알림 클릭, 로그아웃은 사용자가 한다)
Status: resolved
Blocked by:

## Question

ad-hoc 서명만 한 최소 트레이 앱이 이 Mac에서 실제로 동작하는지 확인한다. 최소 앱에는 트레이 아이콘, 알림, 로그인 시 자동 시작만 넣는다. 문서로는 확정할 수 없었던 항목들이라, [데스크톱 프레임워크와 기술 스택 결정](08-desktop-stack.md)과 "알림을 클릭하면 검토 화면이 열린다"는 전제가 이 결과에 달려 있다.

1. **설치 경로**: 브라우저로 내려받은 DMG(quarantine 속성이 붙은 상태)를 열 때 어느 쪽으로 가는가? "그래도 열기"로 넘어갈 수 있는 경로인가, "손상됨"으로 막히는 경로인가?
2. **알림 표시**: 알림이 뜨는가?
3. **알림 클릭**: 알림을 클릭한 사실이 앱에 전달되는가?
4. **자동 시작**: 로그인 시 자동 시작이 동작하는가?

### 검증 순서

처음에는 Tauri만 검증하려 했다. 2026-10-14에 사용자와 순서를 바꿨다.

- **Electron 44를 먼저 본다.** Electron 42 이상은 macOS 알림에 새 API(`UNNotification`)를 쓰고, 문서는 서명된 앱만 알림이 뜬다고 적는다. ad-hoc 서명이 이 조건을 만족하면 Tauri의 가장 큰 이점이 사라진다. 그러면 Rust 없이 TS만으로 만드는 길이 열린다.
- **Electron 알림이 막히면 Tauri v2를 본다.** Tauri는 폐기 예정 API(`NSUserNotification`)로 알림을 띄우고, 클릭 보고는 알림 플러그인 2.6.0 이상에서 확인한다. 이때 Rust 툴체인을 설치한다.
- 설치 경로(1번)는 프레임워크와 상관없이 Gatekeeper가 ad-hoc 서명 번들을 다루는 방식이므로, 먼저 만든 앱으로 한 번만 본다.

## 체크리스트

- 최소 앱 코드는 이 지도의 `prototypes/unsigned-macos-check/` 아래에 둔다. 구현 코드로 재사용하지 않는다.
- 결과를 `## Answer`에 기록한다. 항목마다 macOS 버전, 칩(Apple Silicon/Intel), 실제로 본 대화상자나 알림 화면 설명을 남긴다.

## Answer

2026-10-15에 사용자와 함께 확인했다. **ad-hoc 서명한 Electron 44 앱으로 네 항목이 모두 동작했다.** 그래서 Tauri 검증과 자체 서명 인증서 변형(Comments의 조건부 단계)은 하지 않았다.

- **환경**: macOS 27.0.1(26A434), Apple M5 Pro(Apple Silicon). Intel Mac은 확인하지 않았다.
- **앱**
  - Electron 44.7.2를 `@electron/packager` 20.3.0으로 패키징했다.
  - 번들 전체를 `codesign --force --deep --sign -`로 ad-hoc 서명했다. `codesign --verify --deep --strict`는 통과하고, `spctl -a -t exec`는 `rejected`가 나온다.
  - `LSUIElement`로 Dock 아이콘을 숨긴 메뉴바 전용 앱이다.
  - 코드는 [prototypes/unsigned-macos-check/electron](../prototypes/unsigned-macos-check/electron/main.js)에 있다. 관찰 기록은 앱이 `~/Library/Logs/UnsignedCheck Electron/check.log`에 남긴 이벤트로 판정했다.

1. **설치 경로: "그래도 열기"로 넘어가는 경로다. "손상됨"으로 막히지 않는다.**
   - Chrome으로 받은 DMG에 `com.apple.quarantine`(`0081;…;Chrome`)이 붙었고, Applications로 끌어다 놓은 앱에도 이어졌다.
   - 처음 실행하면 "'UnsignedCheck Electron'을(를) 열지 않음" 대화상자가 뜬다. 본문은 "Apple은 … 악성 코드가 없음을 확인할 수 없습니다"이고, 버튼은 **휴지통으로 이동**과 **완료**다. 여기서 바로 여는 버튼은 없다.
   - **완료**를 누르고 시스템 설정 > 개인정보 보호 및 보안 > **그래도 열기**를 누르니 실행됐다. 허용 뒤 quarantine 값은 `01c1`로 바뀌었다.
   - 사용자가 "다시 설치해야 하냐"고 되물었다. 대화상자만 보고는 다음 단계를 알기 어렵다는 뜻이므로, 설치 안내문이 이 대화상자를 그대로 보여 주고 다음 단계를 짚어야 한다.
2. **알림 표시: 뜬다.**
   - 첫 알림 때 macOS 27은 권한 요청을 별도 창이 아니라 배너로 물었다. 배너 문구는 "'UnsignedCheck Electron' 알림 / 경고, 사운드, 아이콘 배지가 알림에 포함될 수 있습니다"이다.
   - 허용한 뒤에는 알림이 Electron 기본 아이콘과 앱 이름으로 뜨고 알림 센터에도 남았다.
   - 앱에는 `failed`가 아니라 `show`가 기록됐다. Electron 문서의 "서명된 앱만 알림이 뜬다"는 조건을 ad-hoc 번들 서명이 만족한다.
3. **알림 클릭: 앱에 전달된다.**
   - 배너가 떠 있는 동안 클릭하면 2.4초 뒤 `click`이 기록됐고 검토 창이 열렸다.
   - 배너가 사라진 지 2분 지난 알림을 알림 센터에서 클릭해도 똑같이 전달됐다.
   - 배너 클릭 첫 시도 한 번은 `click`이 기록되지 않았다. 원인은 확인하지 못했다. 사용자가 본문이 아닌 곳을 눌렀을 가능성이 있다.
   - 앱이 꺼진 상태에서 지난 알림을 클릭하는 경우는 확인하지 않았다.
4. **자동 시작: 동작한다.**
   - `app.setLoginItemSettings({ openAtLogin: true })`를 부르자 바로 `status: "enabled"`가 됐고, macOS가 로그인 항목 추가 알림을 띄웠다.
   - 로그아웃 후 다시 로그인하니(`loginwindow` 시작 10:42:02) 앱이 10:42:14에 `ppid 1`로 시작했다. `wasOpenedAtLogin: true`였고, 로그인 직후 띄운 알림도 `show`였다.
   - Electron 문서의 경고("서명·공증이 없으면 조용히 실패할 수 있다")는 이 조건에서 나타나지 않았다.
5. **비교(Electron ad-hoc 알림)**: 위 2·3번이 그 답이다. 그래서 Tauri v2(`NSUserNotification`)는 실기 검증하지 않았다.

**결론과 영향**
- 미서명 전제에서 Tauri가 Electron보다 앞섰던 근거 두 가지(macOS 알림, 로그인 항목)가 이 Mac에서는 사라졌다.
- 그래서 [데스크톱 프레임워크와 기술 스택 결정](08-desktop-stack.md)에서는 알림과 자동 시작을 가르는 기준으로 쓰지 않는다. 남는 기준은 언어(TS만 쓸지, Rust를 함께 쓸지), 크기, 저장소 플러그인 같은 것들이다.
- "알림을 클릭하면 검토 화면이 열린다"는 전제는 macOS에서 Electron으로는 성립한다. Tauri를 고르면 이 전제를 다시 확인해야 한다.

**확인하지 못한 것**
- Intel Mac
- 새 버전을 설치할 때 Gatekeeper 확인과 알림 권한을 다시 묻는지
- Windows의 알림과 자동 시작
- 회사 관리(MDM) PC에서의 동작

## Comments

- 2026-10-14, [서명 정책 재검토](10-signing-policy-review.md)에서 덧붙인다. 검증 순서에 조건부 단계를 하나 넣는다.
  - **조건**: Electron 44 알림이 ad-hoc 서명으로 막히는 경우에만 한다. 이때는 Tauri로 넘어가기 전에, 같은 Electron 앱을 **자체 서명 인증서**로 다시 서명해 한 번 더 본다.
  - **근거**: Electron CI는 PR #47817 이후 `generate-identity.sh`로 만든 자체 서명 인증서로 앱을 다시 서명하고 알림 테스트를 돌린다. 자세한 내용은 [코드 서명 선택지 조사](../research/code-signing-options.md)에 있다.
  - **볼 것**
    - 알림 배너가 실제로 뜨는가(2번)
    - 클릭이 앱에 전달되는가(3번)
    - 브라우저로 내려받은 DMG가 Gatekeeper에서 어느 경로로 가는가(1번). 자체 서명 앱의 경로는 문서로 확정하지 못했다.
  - **판정**: 이 변형으로 Electron 알림이 살아날 때만 자체 서명 인증서를 채택한다. 살아나지 않으면 원래 순서대로 Tauri v2를 본다.

- 2026-10-15, 중간 기록(로그아웃 전). 환경: macOS 27.0.1(26A434), Apple M5 Pro(arm64). 앱: Electron 44.7.2, `@electron/packager` 20.3.0, 번들 전체 `codesign --force --deep --sign -`. 코드는 [prototypes/unsigned-macos-check/electron](../prototypes/unsigned-macos-check/electron/main.js), 앱 기록은 `~/Library/Logs/UnsignedCheck Electron/check.log`.
  - **설치 경로**: Chrome으로 받은 DMG에 `com.apple.quarantine`(`0081;…;Chrome`)이 붙었고, Applications로 옮긴 앱에도 이어졌다. 처음 실행하면 "'UnsignedCheck Electron'을(를) 열지 않음 / Apple은 … 악성 코드가 없음을 확인할 수 없습니다" 대화상자가 뜬다(버튼: 휴지통으로 이동, 완료). "손상됨" 경로가 아니다. 시스템 설정 > 개인정보 보호 및 보안 > 그래도 열기로 실행됐다.
  - **알림 표시**: 첫 알림 때 macOS 27은 권한 요청을 배너("'UnsignedCheck Electron' 알림 / 경고, 사운드, 아이콘 배지가 알림에 포함될 수 있습니다")로 물었다. 허용한 뒤 알림이 뜨고 알림 센터에도 남았다. 앱에는 `failed`가 아니라 `show`가 기록됐다.
  - **알림 클릭**: 알림 센터에서 2분 지난 알림을 클릭해도, 배너를 클릭해도 `click`이 전달되어 검토 창이 열렸다. 첫 배너 시도 한 번은 클릭 기록이 없었고 원인은 확인하지 못했다.
  - **자동 시작**: `app.setLoginItemSettings({ openAtLogin: true })` 직후 `status: "enabled"`가 됐고, macOS가 로그인 항목 추가 알림을 띄웠다. 실제 로그인 후 실행 여부는 로그아웃해서 확인한다.
