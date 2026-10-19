# 앱 내 업데이트는 최상위 명시 DR과 앱의 Ed25519 검증에 기댄다

Stardraft는 돈이나 신원 확인이 드는 서명을 하지 않는다. 그래서 macOS는 ad-hoc 서명으로, Windows는 서명 없이 배포한다. 그런데 electron-updater의 macOS 설치기 Squirrel.Mac은 설치된 앱의 지정 요구사항(DR)으로 새 번들을 검증한다. 기본 ad-hoc 서명의 DR은 빌드마다 바뀌는 cdhash라서, 이대로면 모든 업데이트가 거부된다.

그래서 electron-builder가 번들 전체를 ad-hoc 서명한 뒤, `afterSign`에서 **최상위 번들만** 명시 DR `designated => identifier "app.squadify.stardraft"`로 다시 서명한다.
- Squirrel.Mac 자체 테스트가 같은 방식을 쓴다.
- `mac.requirements`로 넣으면 중첩 코드까지 같은 DR이 붙어 서명이 깨진다.
- 2026-10-19에 macOS 27에서 업데이트와 재실행을 실기로 확인했다.

이 DR은 신원을 보장하지 않는다. 같은 식별자로 ad-hoc 서명한 번들은 무엇이든 통과한다. Windows는 서명이 없어서 electron-updater가 서명을 아예 보지 않는다. 그 결과 앱 내 업데이트는 Gatekeeper, SmartScreen, 사람의 확인을 모두 거치지 않고 모든 PC에 퍼진다. sha512 확인만으로는 Release를 만들 수 있는 계정이 털린 경우를 막지 못한다. 그래서 앱이 직접 진위를 확인한다. 업데이트 안내 파일(`latest*.yml`)에 든 Ed25519 서명을, 앱에 넣은 공개 키로 검증한다.

## Considered Options

- **Sparkle 2**: ad-hoc과 EdDSA 조합을 허용한다. 하지만 Electron용 네이티브 연결을 직접 만들거나, 검증되지 않은 패키지에 기대야 한다.
- **직접 만든 업데이터**(Tauri 방식): DR에 기대지 않는다. 대신 교체, 재실행, 되돌리기를 직접 만들고 시험해야 한다.
- **수동 업데이트만**: 업데이트할 때마다 팀원이 사이트에서 받아 "그래도 열기"를 다시 거쳐야 한다.

## Consequences

- 명시 DR이 빠진 버전이 한 번 나가면, 그 버전을 설치한 PC에서는 이후 업데이트가 조용히 모두 거부된다. 사이트에서 다시 설치해야 풀린다. 그래서 CI가 DR을 검사하고, 틀리면 Release를 만들지 않는다.
- 공개 키는 설치된 모든 앱에 박힌다.
  - 개인 키를 잃으면, 새 키를 넣은 버전을 모든 PC가 수동으로 설치해야 한다. 그래서 Actions 비밀값과 별도로 오프라인 사본을 둔다.
  - yml의 서명 필드는 처음부터 서명 목록으로 둔다. 키를 회전하는 동안 두 키로 함께 서명할 수 있게 하려는 것이다.
- 명시 DR을 넣어도 Keychain 파티션은 cdhash다. 그래서 macOS는 업데이트할 때마다 Keychain 접근을 다시 묻는다.
