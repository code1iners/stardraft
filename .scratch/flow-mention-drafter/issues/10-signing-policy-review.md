# 서명 정책 재검토

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: grilling
Mode: HITL
Status: open
Blocked by:

## Question

[트레이 데스크톱 앱 프레임워크와 미서명 배포 조사](03-tray-app-framework-research.md)에서 "코드 서명은 하지 않고, 설치 경고에 동의하면 쓸 수 있다"는 전제가 일부 성립하지 않는다는 사실이 나왔다. 이 사실을 바탕으로 서명 정책을 다시 정한다.

- **macOS ad-hoc 서명**: Apple Silicon은 서명이 전혀 없는 실행 파일을 실행하지 않는다. 무료이고 Apple 계정도 필요 없는 ad-hoc 서명을 "서명 안 함" 원칙의 예외로 허용할지 정한다.
- **Windows 스마트 앱 컨트롤**: 이 기능이 켜진 Windows 11 PC에서는 미서명 앱을 앱별로 허용할 방법이 없다. 선택지는 두 가지다.
  - 이런 PC를 지원 대상에서 뺀다.
  - Windows 서명(예: Artifact Signing, 월 9.99달러부터)을 도입한다. 도입 시점을 팀 배포 단계로 미룰 수도 있다.
- **반복 확인 감수 여부**: 미서명 앱은 버전마다 SmartScreen 경고가 다시 뜨고, 업데이트할 때마다 Keychain 접근 허용을 다시 물을 수 있다. 이 불편을 받아들일지 정한다.

결론에 따라 지도의 **범위 밖** 항목인 "코드 서명과 공증"을 고치거나 유지한다.
