# 앱 내 업데이트 macOS 실기 검증

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: task
Mode: HITL
Status: open
Blocked by:

## Question

ad-hoc 서명한 Electron 앱이 electron-updater로 **실제로 업데이트되고 다시 실행되는지**, 그 뒤 macOS가 무엇을 다시 묻는지 이 Mac에서 확인한다.

[다운로드 사이트 형태 결정](09-download-site.md)에서 앱 내 업데이트를 범위에 넣었다. macOS에서 채택할지는 이 검증 결과로 정한다. 실험 절차, 볼 것, 중단 조건, 복구 방법은 [앱 내 업데이트 가능성 조사](../research/in-app-update.md) 6절을 그대로 따른다.

- **변형 B**: 최상위 번들만 `identifier` 명시 DR로 다시 서명한다. v0.0.1 → v0.0.2 업데이트가 성공하는지 본다.
- **변형 A**: 기본 ad-hoc 서명을 그대로 둔다. 업데이트가 거부되는지 본다.
- **사용자가 할 일**
  - "그래도 열기" 누르기
  - 알림 허용
  - Keychain "항상 허용"
  - 로그인 항목 켜기
- **기록할 것**: 아래 항목을 `## Answer`에 남긴다.
  - 재실행 여부와 재실행 뒤 버전
  - 새 번들의 quarantine 여부
  - Gatekeeper 대화상자가 떴는지
  - 앱 수정 보호 알림이 떴는지
  - Keychain을 다시 물었는지
  - 알림 권한과 로그인 항목이 유지됐는지
  - ShipIt 로그
- **판정**
  - 변형 B가 성공하면 macOS도 앱 내 업데이트를 채택한다.
  - 실패하거나 앱 수정 보호에 막히면 macOS는 수동 업데이트와 새 버전 알림으로 돌아간다. [앱 내 업데이트 방식 결정](22-in-app-update-design.md)에 그 결과를 넘긴다.
