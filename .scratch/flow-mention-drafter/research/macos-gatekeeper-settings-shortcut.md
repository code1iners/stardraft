# macOS 첫 실행 차단과 보안 설정 바로가기 조사

- 조사일: 2026-10-26
- 요청: Stardraft 실행 시 표시되는 보안 경고에서 바로 개인정보 보호 및 보안 설정으로 이동할 수 있는지 조사한다.
- 범위: 공식 문서·공식 코드·설치된 macOS 메타데이터 조사와 사용자 요청에 따른 실제 브라우저 이동 검증. 제품 코드 변경, 보안 예외 허용, 재배포는 포함하지 않는다.
- 표기: **확인**은 직접 읽은 문서·관찰, **추론**은 그로부터의 판단, **미검증**은 실제 동작 시험이 남은 항목이다.

## 결론

**설정 바로가기 자체는 구현 가능하다. 다만 현재 뜬 macOS 차단 경고에 Stardraft가 버튼을 추가하는 방식은 사용할 수 없다. 실행 전에도 접근할 수 있는 다운로드 사이트의 설치 안내가 적절한 위치다.**

- **확인:** Apple은 동일한 “악성 소프트웨어를 확인할 수 없음” 경고와 `휴지통으로 이동`·`완료` 선택지를 설명하고, 앱 실행을 시도한 뒤 시스템 설정의 개인정보 보호 및 보안에서 `그래도 열기`를 누르도록 안내한다. [Apple: Mac에서 앱 안전하게 열기](https://support.apple.com/ko-kr/102445)
- **추론:** Gatekeeper는 앱을 열 때 서명·공증을 검사하고 실행 전에 사용자 승인을 요구한다. 이 단계에서 차단된 앱의 Electron 코드로 자체 안내나 설정 이동을 실행할 수 없다. 읽은 공식 문서에서 이 시스템 경고에 앱이 버튼을 삽입하는 공개 확장 지점도 확인되지 않았다. [Apple: Gatekeeper와 런타임 보호](https://support.apple.com/guide/security/gatekeeper-and-runtime-protection-sec5599b66df/web)
- **권고:** 단기적으로 다운로드 사이트에 `개인정보 보호 및 보안 열기`와 수동 이동 경로를 함께 제공하고, 정식 배포에서는 Developer ID 서명과 공증을 별도로 검토한다. 바로가기는 화면 이동일 뿐 Stardraft 실행 허용을 자동으로 처리하지 않는다.

## 설정 화면을 여는 수단과 지원 경계

| 수단 | 확인된 근거 | 적용 판단 |
|---|---|---|
| `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension` | 설치된 시스템 설정 앱의 프로토콜 등록과 개인정보 보호 확장의 해당 프로토콜 허용 속성을 확인함. 아래 로컬 증거 참고 | 현재 Mac의 Chrome·Safari에서 설정 화면 상단 이동 확인. 보안 항목은 화면 아래에 있음 |
| `x-apple.systempreferences:com.apple.preference.security?General` | 현재 Mac의 Chrome·Safari에서 보안 항목까지 자동 이동 확인 | 현재 환경에서 권장하는 주소. Apple의 모든 버전 호환 보장은 확인 못 함 |
| `x-help-action://openPrefPane?bundleId=com.apple.settings.PrivacySecurity.extension` | Apple 사용자 가이드의 실제 “Open Privacy & Security settings for me” 링크 | Apple 도움말용 경로. 일반 다운로드 웹사이트에서 같은 동작을 보장하는 근거로 확대하지 않음 |
| 실행된 Electron 앱의 `shell.openExternal(고정된_설정_URL)` | Electron 공식 API는 외부 프로토콜을 기본 앱으로 여는 기능을 제공 | 앱 실행 후에는 가능. 지금의 첫 실행 차단에는 도달할 수 없음 |

Apple 가이드 링크의 실제 주소는 2026-10-26 원본 HTML에서 확인했다. [Apple 사용자 가이드](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac)

Electron의 `shell.openExternal`은 외부 프로토콜 실행을 지원하지만 개별 macOS 설정 주소의 호환성을 보증하지는 않는다. 향후 앱 내부에 사용한다면 임의 입력이 아닌 고정된 주소만 열어야 한다. [Electron shell](https://www.electronjs.org/docs/latest/api/shell#shellopenexternalurl-options), [Electron 보안 지침](https://www.electronjs.org/docs/latest/tutorial/security#15-do-not-use-shellopenexternal-with-untrusted-content)

설정 주소는 공개적으로 보장된 Gatekeeper 제어 API (영문 원문: Application Programming Interface, 프로그램 연동 규약)로 취급하지 않는다. 설정 패널로 이동하는 기능과 `그래도 열기` 위치까지 이동하는 기능, 실제 앱 실행 허용은 각각 다른 검증 항목이다.

## 로컬 증거

- **확인:** 조사 환경은 macOS 27.0.1, 빌드 26A434다.
- **확인:** `/System/Applications/System Settings.app/Contents/Info.plist`의 `CFBundleURLTypes`에 `x-apple.systempreferences`가 등록되어 있다. 이는 Apple이 설치한 앱의 직접 증거이며, 모든 버전·모든 경로가 지원된다는 뜻은 아니다.
- **확인:** `/System/Library/ExtensionKit/Extensions/SecurityPrivacyExtension.appex/Contents/Info.plist`의 `CFBundleIdentifier`는 `com.apple.settings.PrivacySecurity.extension`이다. `EXAppExtensionAttributes.SettingsExtensionAttributes.allowsXAppleSystemPreferencesURLScheme`는 `true`, `legacyBundleIdentifier`는 `com.apple.preference.security`다. 이는 위 루트 주소의 후보 선정 근거다. `?General` 같은 세부 위치 지원을 입증하지 않는다.
- **확인:** 시스템 설정의 개인정보 보호 및 보안 화면에 Stardraft가 차단되었다는 안내와 `그래도 열기` 버튼이 표시되어 있었다. 허용 버튼은 누르지 않았다.
- **확인:** 후속 실제 브라우저 검증에서 Chrome·Safari 모두 이동에 성공했다. 최초 조사의 Safari 도구 연결 실패는 이후 검증으로 해소했다. 상세 결과는 아래와 같다.

## 실제 브라우저 검증 결과 (2026-10-26)

사용자 요청에 따라 macOS 27.0.1 (26A434)에서 로컬 시험 페이지 `http://127.0.0.1:47831/`의 링크를 실제 클릭했다. 각 시험 전에 시스템 설정을 `일반` 화면으로 옮겨 기존 화면에 머무른 것을 이동 성공으로 오인하지 않도록 했다.

| 주소 | Chrome | Safari |
|---|---|---|
| `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension` | 외부 앱 열기 확인 후 개인정보 보호 및 보안 상단 도착 | 외부 앱 열기 확인 후 개인정보 보호 및 보안 상단 도착 |
| `x-apple.systempreferences:com.apple.preference.security?General` | 보안 항목까지 자동 이동, Stardraft 차단 안내와 `그래도 열기` 표시 | 보안 항목까지 자동 이동, Stardraft 차단 안내와 `그래도 열기` 표시 |

- Chrome은 `시스템 설정 열기`, Safari는 `허용`을 한 번 선택해야 했다. `항상 허용`은 선택하지 않았다.
- `?General` 시험에서는 수동 스크롤 없이 보안 항목이 화면에 나타났다. 접근성 트리와 화면 캡처로 확인했다. 우측 스크롤 값은 상단 주소의 `0`과 달리 약 `0.89946`이었다.
- `그래도 열기`를 누르거나 보안 예외를 허용하지 않았다. 제품 코드와 배포 설정도 변경하지 않았다.
- **권고:** 현재 설치 안내의 후보는 `x-apple.systempreferences:com.apple.preference.security?General`로 좁힌다. 실제 배포 사이트, 다른 macOS·브라우저 버전, 관리 정책 환경은 별도 검증이 필요하며 수동 이동 경로는 함께 유지한다.

## 추가한다면 어디에 둘 것인가

**권고이며 미구현:** 기존 다운로드 사이트 설치 안내의 macOS 단계에 설정 열기 버튼을 배치한다. 현재 안내 위치는 `apps/site/src/components/install-steps.tsx`다. 앱을 한 번 실행해 경고를 확인한 다음 버튼을 누르게 설명하고, 이동이 되지 않으면 `시스템 설정 → 개인정보 보호 및 보안 → 보안 → 그래도 열기`를 직접 찾게 한다. Apple도 예외 허용 전에 앱 실행을 시도하는 순서를 제시한다. [Apple 지원](https://support.apple.com/ko-kr/102445)

DMG (영문 원문: Disk Image, Mac 디스크 이미지) 안에 별도 설치 안내 파일이나 링크를 두는 것도 설계 후보지만, 파일 연동과 브라우저별 동작을 이번 조사에서 검증하지 않았다. 앱 자체나 별도 실행 파일을 먼저 실행해야 하는 안내는 같은 실행 차단을 만날 수 있으므로 첫 해결책으로 삼지 않는다. 이 문단은 배포 동선에 관한 **추론·권고**다.

현재 Mac의 Chrome·Safari에서 외부 앱 열기 확인창과 설정 화면의 스크롤 위치를 **확인**했다. 다른 버전·관리 정책 및 실제 배포 사이트에서의 동작은 **미검증**이다. GitHub Release 본문이 임의 프로토콜 링크를 그대로 유지하고 실행하는지도 검증하지 않았으므로, Release에 직접 특수 주소를 넣기보다 검증할 수 있는 설치 안내 웹페이지로 연결하는 편을 권한다.

## 공증과의 관계

**확인:** Apple의 배포 문서는 Developer ID 서명된 소프트웨어를 공증 서비스로 검사하고, 발급된 티켓을 부착하거나 온라인 조회로 Gatekeeper가 확인하게 한다. 공증 준비에는 Developer ID 인증서, Hardened Runtime (강화된 실행 보호), 안전한 타임스탬프 등이 필요하다. 일반적인 코드 서명 검사의 성공만으로 공증 완료가 되지 않는다. [Apple: 배포 전 macOS 소프트웨어 공증](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

**권고:** 반복 설치 테스트에서는 바로가기가 마찰을 줄여 준다. 외부 사용자 배포의 정상 실행 경로를 개선하려면 Developer ID 서명과 공증을 검토하는 것이 직접적인 해결책이다. 공증을 해도 인터넷에서 받은 앱의 첫 실행 확인까지 모두 사라진다는 보장은 하지 않는다. [Apple Developer ID](https://developer.apple.com/developer-id/), [Apple 지원](https://support.apple.com/ko-kr/102445)

## 후속 구현 시 가장 작은 검증

1. **완료:** 제품 코드 변경 전에 대상 Mac의 Chrome·Safari에서 두 주소의 설정 화면 이동과 도착 위치를 확인했다.
2. 실제 다운로드 경로에서 사용하는 Safari·Chrome 각각에서 사용자 클릭으로 같은 화면에 도착하는지 확인한다.
3. 다운로드한 Stardraft의 첫 실행 차단 후 `그래도 열기` 안내를 사용자가 찾을 수 있는지 확인한다. 자동 허용은 하지 않는다.
4. 링크가 차단되거나 다른 화면이 열리면 바로가기를 성공으로 기록하지 않고 수동 경로 안내를 유지한다.
5. 채택 후 문제가 발생하면 링크 버튼만 제거해 기존 수동 안내로 복구할 수 있게 한다.

이번 조사에서 앱 기능·배포 설정을 수정하거나 Release를 새로 만들지 않았다.
