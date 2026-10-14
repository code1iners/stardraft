# 데스크톱 프레임워크와 기술 스택 결정

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: grilling
Mode: HITL
Status: open
Blocked by: 02, 03, 10, 11

## Question

트레이/메뉴바 데스크톱 앱을 **무엇으로 만들지** 정한다. 근거는 두 조사 결과다.

- [트레이 데스크톱 앱 프레임워크와 미서명 배포 조사](03-tray-app-framework-research.md)
- [CLI 에이전트 비대화형 실행 능력 조사](02-cli-agent-headless-research.md)

아래 두 티켓의 결론도 함께 반영한다.

- [서명 정책 재검토](10-signing-policy-review.md)
- [미서명 Tauri 앱 macOS 실기 검증](11-tauri-macos-unsigned-check.md)

정할 것:

- **프레임워크**: Tauri v2와 Electron 중 무엇을 쓸지, 혹은 다른 대안을 쓸지.
- **언어와 구조**: 앱의 주 언어를 정하고, 핵심 로직(감지, 에이전트 실행, 게시)을 UI에서 분리하는 구조를 정한다.
- **저장 방식**: 로컬 상태 저장소, 설정 파일 형식과 위치, 개인 API 키 보관 방식을 정한다.
- **빌드 파이프라인**: 미서명 dmg/exe를 만드는 파이프라인과, 그 산출물을 어디에 올릴지 정한다.
  - [서명 정책 재검토](10-signing-policy-review.md)에서 정한 제약
    - macOS는 번들 전체에 ad-hoc 서명을 하는 단계가 필수다.
    - Windows는 미서명으로 내되, 나중에 Artifact Signing을 붙일 수 있게 서명 자리를 둔다. Tauri라면 `signCommand`다. 설치 파일 안의 exe와 DLL까지 서명되도록 빌드 안에서 서명해야 한다. 공식 서명 Action이 Windows 러너 전용이므로, Windows 빌드는 Windows 러너에서 한다.
    - 자체 서명 인증서를 채택하는 경우(Electron 알림을 살릴 때만), 인증서 키를 CI 비밀값으로 보관하고 Keychain에 직접 가져오는 단계를 둔다.
