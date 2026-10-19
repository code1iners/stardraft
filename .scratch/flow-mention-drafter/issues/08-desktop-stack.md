# 데스크톱 프레임워크와 기술 스택 결정

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: grilling
Mode: HITL
Status: resolved
Blocked by: 02, 03, 10, 11

## Question

트레이/메뉴바 데스크톱 앱을 **무엇으로 만들지** 정한다. 근거는 두 조사 결과다.

- [트레이 데스크톱 앱 프레임워크와 미서명 배포 조사](03-tray-app-framework-research.md)
- [CLI 에이전트 비대화형 실행 능력 조사](02-cli-agent-headless-research.md)

아래 두 티켓의 결론도 함께 반영한다.

- [서명 정책 재검토](10-signing-policy-review.md)
- [미서명 앱 macOS 실기 검증](11-tauri-macos-unsigned-check.md)

정할 것:

- **프레임워크**: Tauri v2와 Electron 중 무엇을 쓸지, 혹은 다른 대안을 쓸지.
- **언어와 구조**: 앱의 주 언어를 정하고, 핵심 로직(감지, 에이전트 실행, 게시)을 UI에서 분리하는 구조를 정한다.
- **저장 방식**: 로컬 상태 저장소, 설정 파일 형식과 위치, 개인 API 키 보관 방식을 정한다.
- **빌드 파이프라인**: 미서명 dmg/exe를 만드는 파이프라인과, 그 산출물을 어디에 올릴지 정한다.
  - [서명 정책 재검토](10-signing-policy-review.md)에서 정한 제약
    - macOS는 번들 전체에 ad-hoc 서명을 하는 단계가 필수다.
    - Windows는 미서명으로 내되, 나중에 Artifact Signing을 붙일 수 있게 서명 자리를 둔다. Tauri라면 `signCommand`다. 설치 파일 안의 exe와 DLL까지 서명되도록 빌드 안에서 서명해야 한다. 공식 서명 Action이 Windows 러너 전용이므로, Windows 빌드는 Windows 러너에서 한다.
    - 자체 서명 인증서를 채택하는 경우(Electron 알림을 살릴 때만), 인증서 키를 CI 비밀값으로 보관하고 Keychain에 직접 가져오는 단계를 둔다.
  - [미서명 앱 macOS 실기 검증](11-tauri-macos-unsigned-check.md) 결과, ad-hoc 서명만으로 Electron 알림이 동작했다. 자체 서명 인증서 단계는 필요 없다.
- **실기 검증 결과의 영향**: macOS에서 ad-hoc 서명한 Electron 44 앱의 알림 표시, 클릭 전달, 로그인 시 자동 시작이 모두 동작했다. 알림과 자동 시작은 두 프레임워크를 가르는 기준에서 빠진다. Tauri를 고르면 그 알림 경로(`NSUserNotification`)는 다시 확인해야 한다.

## Answer

2026-10-15~16에 사용자와 그릴링으로 정했다.

- 빌드 도구, SQLite, 키 보관, 프로세스 구조에 관한 사실은 [Electron 빌드 도구와 런타임 스택 조사](../research/electron-build-stack.md)에서 확인했다. 이 조사는 문서를 읽고, 이 Mac에서 직접 실행해 확인했다.
- Electron을 고른 이유는 [ADR 0001](../../../docs/adr/0001-electron-over-tauri.md)에 남겼다.

### 프레임워크와 언어

- **Electron + TypeScript**로 만든다. 핵심 로직과 UI를 모두 TS로 쓰고, Tauri v2는 쓰지 않는다.
  - [미서명 앱 macOS 실기 검증](11-tauri-macos-unsigned-check.md)에서 ad-hoc 서명한 Electron 44 앱의 알림 표시, 알림 클릭, 자동 시작이 모두 동작했다. 그래서 Tauri가 앞서던 근거가 사라졌다.
  - 남은 차이는 언어와 크기다. 사용자의 다른 저장소는 모두 TS이고, Electron은 실기로 검증한 경로다. 이 두 가지를 크기보다 무겁게 봤다. 크기(런타임만 124~151MiB)는 감수한다.
  - Windows 알림 클릭 처리
    - Electron에는 알림 센터로 넘어간 알림의 클릭까지 받는 `Notification.handleActivation`(42.0.0부터)이 있다. Windows 실기로는 확인하지 않았다.
    - Tauri는 토스트가 화면에 떠 있을 때만 클릭을 받는다.
- **버전**
  - 최신 44.x로 시작한다.
  - 메이저를 올릴 때마다 11의 점검 목록을 다시 돌린다. 점검 목록은 설치 경로, 알림 표시, 알림 클릭, 자동 시작이다.
  - ad-hoc 서명으로 알림이 동작하는 것은 문서가 보장하는 동작이 아니기 때문이다. 이 규칙은 스펙에 넣는다.
- **UI**: React 19 + TypeScript.
- **앱 식별자**
  - 표시 이름은 `Stardraft`다.
  - 번들 ID와 Windows AppUserModelID는 `app.squadify.stardraft`다.
  - 키체인 항목, 알림 권한, 로그인 항목, 데이터 폴더 경로가 이 값에 묶인다. 그래서 바꾸지 않는다.
  - 경로 인코딩 문제를 피하려고 ASCII로 정했다.

### 구조

- **프로세스**: 핵심 로직은 main 프로세스에서 돌린다. 핵심 로직은 감지, 대기열, 에이전트 실행, 게시, 저장이다.
  - `utilityProcess`도 폴링, 자식 프로세스, SQLite를 돌릴 수 있다(실측). 하지만 `safeStorage`, `Notification`, `Tray`는 main에서만 쓸 수 있다.
  - 하는 일이 입출력 대기 위주라서 main 프로세스를 막지 않는다.
- **핵심 모듈 분리**: `src/core`는 Electron을 import하지 않는 순수 TS 모듈이다. ESLint `no-restricted-imports`로 막는다.
  - 외부 의존은 포트로 주입한다. 포트는 아래와 같다.
    - Flow API
    - 실행기: [에이전트 실행 계약 결정](07-agent-run-contract.md)에 따라 교체할 수 있다.
    - 상태 저장소, 설정 저장소, 비밀 저장소
    - 알림
    - 시계
  - Node 환경에서 Vitest로 테스트한다. 필요하면 나중에 `utilityProcess`로 옮긴다.
- **Flow 어댑터**
  - Flow 전용 코드는 `src/core` 안의 Flow 어댑터 한 곳에 모은다. 감지, 맥락 조회, 게시, 직접 답 확인이 여기에 해당한다.
  - 도메인 용어는 일반화하지 않는다(아래 "범위").
- **회사별 값**은 하드코딩하지 않는다.
  - API 주소는 Flow가 모든 회사에 공통으로 쓰는 `https://api.flow.team` 하나다. 이 값은 코드의 한 곳에만 둔다.
  - 내 ID와 이름은 `GET /user/employees/me`로 얻는다.
  - "Flow에서 열기" 링크는 응답에 들어 있는 `projectUrl`과 `connectUrl`을 쓴다.
  - 그래서 회사 주소를 넣는 설정 칸은 두지 않는다.
  - 점검 결과 JSON(`flow-alarm-probe-result.json`) 4줄에 회사 하위 도메인이 남아 있다. 프로필 사진 URL이다.
    - 코드가 아니라 기록 데이터다.
    - 이 저장소는 앱 저장소로 쓰지 않으므로(아래) 고치지 않는다.
- **렌더러**: 상태를 갖지 않는 UI다.
  - preload의 `contextBridge`로 노출한 타입 있는 IPC로만 main과 통신한다.
  - 상태 스냅숏과 변경 이벤트를 받는다.
  - 상태가 main에 있으므로, 창은 닫을 때 없앤다.
- **보안 기본값**: 스펙의 고정 항목이다.
  - **렌더러 설정**
    - `contextIsolation`과 `sandbox`를 켜고 `nodeIntegration`을 끈다.
    - 엄격한 CSP를 걸고, 원격 콘텐츠를 불러오지 않는다.
    - Flow 글과 초안은 HTML이 아니라 텍스트로 그린다.
  - **Fuses**
    - `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`, `EnableNodeCliInspectArguments`를 끈다.
    - `EnableEmbeddedAsarIntegrityValidation`과 `OnlyLoadAppFromAsar`를 켠다.
  - asar 무결성 검증은 ad-hoc 서명한 앱에서도 동작했다(실측).
  - `RunAsNode`를 꺼도 `child_process.spawn`에는 영향이 없다.

### 저장 방식

- **위치**
  - OS 표준 사용자별 앱 데이터 폴더에 둔다. macOS는 `~/Library/Application Support/Stardraft/`, Windows는 `%APPDATA%\Stardraft\`다.
  - PC마다 따로 두고, 동기화하지 않는다.
  - 위치를 바꾸는 설정이나 환경 변수는 두지 않는다.
    - 사용자는 처음에 "앱 데이터"를 공유 데이터베이스로 이해했다. 그래서 외장 SSD 지정, 환경 변수로 위치 바꾸기, Supabase를 물었다.
    - 각자의 PC에 개인 데이터를 두는 것임을 확인한 뒤, 처음 제안으로 돌아왔다.
  - Supabase는 쓰지 않는다. 이유는 세 가지다.
    - 팀원별 로그인과 RLS가 필요하다.
    - Flow 글과 초안이 새 외부 서비스로 나가서, 지도의 데이터 반출 전제를 넘는다.
    - 무료 플랜은 1주 동안 활동이 없으면 일시 정지된다.
- **설정**: `settings.json`
  - `schemaVersion`을 둔다.
  - 임시 파일에 쓴 뒤 이름을 바꾸는 방식으로 저장한다.
  - 작업 폴더, 저장소 매핑, 에이전트와 모델, 비밀 파일 패턴 추가, 추가 지침, 에디터가 여기에 들어간다.
- **상태**: `state.db`(SQLite)
  - 기준점, 멘션과 멘션 묶음, 초안과 비교 기준, 게시 기록, 실행 기록이 여기에 들어간다.
  - 드라이버는 **better-sqlite3 13.x**이고, 정확한 버전으로 고정한다.
    - 13부터 N-API라서, Electron을 올려도 다시 빌드할 필요가 없다.
    - macOS arm64·x64와 Windows x64 바이너리가 npm 패키지 안에 들어 있다.
    - Electron 44 main에서 로드되는 것을 확인했다(arm64만).
  - `node:sqlite`는 쓰지 않는다.
    - Electron 44에서 경고 없이 동작하기는 했다(실측).
    - 하지만 Node에서 아직 release candidate다. 또 Electron이 품은 Node를 따라 바뀌고, Electron 37.2.0에서 모듈이 사라지는 회귀가 있었다.
  - `.node` 파일은 asar 밖으로 빼고(unpack), 번들러에서는 외부 모듈로 둔다.
  - ORM은 쓰지 않는다. 마이그레이션은 SQL과 `PRAGMA user_version`으로 관리하고, WAL을 켠다.
  - 상태 저장소 어댑터 뒤에 둔다.
- **개인 API 키**
  - 설정 화면에서 받아 **`safeStorage` 비동기 API**(`encryptStringAsync`, `decryptStringAsync`)로 암호화한다. 암호문은 데이터 폴더의 파일에 둔다.
  - 암호를 푸는 열쇠는 macOS에서는 키체인 항목 `Stardraft Safe Storage`에 있고, Windows에서는 DPAPI로 보호된다.
  - [서명 정책 재검토](10-signing-policy-review.md)에서 "Keychain 밖으로 빼지 않는다"고 정했다. 암호문은 키체인 밖의 파일에 있지만, 키체인 항목 없이는 풀 수 없다. 그래서 이 원칙의 취지를 지킨다고 본다.
  - 개발 중이든 설치한 앱이든 같은 방식으로 저장한다. `.env`나 환경 변수로 키를 받는 경로는 두지 않는다.
    - 사용자는 처음에 `.env`로 관리하는 방식을 기대했다.
    - 설치한 앱에는 소스 저장소가 없다. 또 macOS GUI 앱은 셸 환경 변수를 받지 못하고, 평문 파일은 10의 결정을 뒤집는다.
    - 이 설명을 들은 뒤 `safeStorage`로 정했다.
  - 동기 API는 Electron 46(2027-01 예정)에서 제거되므로 쓰지 않는다.
  - 복호화 결과에 `shouldReEncrypt`가 참으로 오면 다시 암호화해서 저장한다.
  - 복호화에 실패하면 "키 확인 필요"로 둔다. 실패하는 경우는 키체인 허락 거부, 항목 삭제, 다른 PC로 복사다.
  - `@napi-rs/keyring`은 네이티브 모듈이 하나 더 늘어서 고르지 않았다.
- **개발 중 실행**
  - 소스에서 실행할 때(`app.isPackaged`가 false)는 이름을 `Stardraft Dev`로 바꾼다. 데이터 폴더와 키체인 항목(`Stardraft Dev Safe Storage`)도 따로 쓴다.
  - 개발 중 실행이 실제 기준점을 건드리거나, 마이그레이션이 설치한 앱의 DB를 깨뜨리는 일을 막기 위해서다.
  - 이름을 바꿨을 때 키체인 항목 이름에도 반영되는지는 구현할 때 확인한다.
- **진단 로그**
  - OS 표준 로그 폴더(`app.getPath('logs')`)에 둔다. 크기 상한을 두고 회전한다.
  - API 키와 Flow 글 본문은 남기지 않고, ID만 남긴다.

### 저장소와 라이선스

- **앱 저장소**: 개인 계정의 새 저장소 `stardraft`에서 새 이력으로 시작한다.
  - 비공개로 시작하고, 라이선스는 MIT다. 공개로 바꾸는 시점은 사용자가 정한다. 스펙 밖의 운영 판단이다.
  - 처음에는 "이 저장소에 앱 코드를 둔다"고 정했다가 바꿨다. 사용자가 나중에 다른 회사에서도 쓰고, 다른 출처로 넓힐 수 있다고 밝혔기 때문이다.
  - 이 저장소에는 회사 데이터가 이력째 들어 있다. 회사 하위 도메인, 실제 ID, 업무 시나리오다.
    - 그래서 이 저장소는 앱 저장소로 쓰지 않는다.
    - 지도, 티켓, 조사, 점검 기록을 담은 기획 저장소로 남긴다.
  - 구현을 시작할 때 스펙, `GLOSSARY.md`, ADR을 새 저장소로 옮긴다.
  - 테스트 픽스처는 가짜 데이터로만 만든다. 점검 결과 JSON은 가져가지 않는다.
  - 업무상 저작물 규정(저작권법 제9조)을 설명했고, 사용자는 개인 소유로 진행하기로 했다.
- **구성**: pnpm 워크스페이스 + turbo다. 사용자의 다른 저장소와 같다.
  - `apps/desktop`: `src/core`, `src/main`, `src/preload`, `src/renderer`로 나눈다.
  - `apps/site`: 다운로드 사이트 자리다. 실제로 둘지는 [다운로드 사이트 형태 결정](09-download-site.md)에서 정한다.
  - Node는 24 LTS다. Electron 44가 품은 Node와 같은 메이저다.
  - pnpm은 `packageManager`로 고정한다.
  - 루트 `.gitignore`에 `node_modules`, 빌드 산출물, `.env*`를 넣는다. `.env.example`만 예외다.

### 빌드 파이프라인

- **빌드 도구**: electron-builder **26.17.0**으로 정확히 고정한다.
  - npm `latest` 태그(26.15.3)에는 pnpm 워크스페이스 수정이 없다.
  - v27(지금은 알파)로 올릴 때는 서명 설정 문법이 바뀌므로 다시 본다.
  - Electron Forge 8은 쓰지 않는다. 이유는 세 가지다.
    - 같은 ad-hoc 서명 설정으로 서명한 앱이 hardened runtime 때문에 실행되지 않았다(실측).
    - 공식 NSIS 메이커가 없다.
    - pnpm에 `node-linker=hoisted`를 강제한다.
- **번들러**: electron-vite + Vite다. 구현을 시작할 때의 안정판으로 정확히 고정한다. 조사 시점에는 6.0.0이 나온 지 하루였다.
- **macOS**: arm64 DMG를 만든다.
  - `mac.identity: "-"`를 명시해서, Helper와 Framework까지 번들 전체를 ad-hoc 서명한다(실측).
  - 명시하지 않으면 builder가 키체인의 Apple Development 인증서를 자동으로 골라 서명을 시도한다(실측).
- **Windows**: x64 NSIS 원클릭 설치 파일을 만든다.
  - 관리자 권한 없이 사용자별로 설치하고, 설치 위치는 묻지 않는다.
  - 바로가기에 AppUserModelID(`appId`)가 들어간다.
  - 서명 자리는 `win.azureSignOptions`와 `signExts: [".dll", ".node"]`다.
    - `AZURE_*` 비밀값이 있을 때만 켜진다. 지금은 미서명으로 나간다.
    - 켜지면 설치 파일과 그 안의 exe, dll, `.node`가 함께 서명된다.
- **Intel Mac**: 지금은 만들지 않는다.
  - macOS 27은 Apple Silicon만 지원한다.
  - Intel Mac을 쓰는 팀원이 실제로 나오면 x64 DMG를 추가한다. 빌드 매트릭스에는 그 자리만 둔다.
  - Windows ARM PC에서는 x64 앱이 에뮬레이션으로 돈다.
- **GitHub Actions**
  - **PR과 main 푸시**: lint, typecheck, 테스트를 ubuntu와 windows 러너에서 돌린다. 경로 처리나 `.cmd` 실행처럼 Windows 전용 분기가 있기 때문이다.
  - **`v*` 태그 푸시**
    1. 태그와 `apps/desktop/package.json`의 버전이 같은지 확인한다.
    2. `macos-latest`에서 arm64 DMG를, `windows-latest`에서 x64 exe를 만든다(`--publish never`).
    3. macOS 작업은 `codesign --verify --deep --strict`를 통과하지 못하면 실패한다.
    4. 마지막 작업 하나가 두 파일과 `SHA256SUMS.txt`를 담은 초안 GitHub Release를 만든다. builder가 러너마다 따로 올리면 초안이 둘 생길 수 있기 때문이다.
    5. 공개는 사용자가 직접 누른다.
  - **`workflow_dispatch`**: 같은 빌드를 돌리되, 워크플로 아티팩트로만 올린다.
- **산출물 위치**: `stardraft` 저장소의 GitHub Release다.
  - 저장소가 비공개인 동안은 GitHub에 로그인해야 받을 수 있다.
  - 사이트가 이 파일을 어떻게 내보낼지는 09에서 정한다.

### 실기 검증 결과의 영향

- 알림과 자동 시작은 프레임워크 선택 기준에서 뺐다.
- "알림을 클릭하면 검토 화면이 열린다"는 전제는 macOS에서 Electron으로 성립한다.
- **팀 배포 전 Windows 점검 목록**을 스펙에 넣는다.
  - 결과가 나빠도 프레임워크 선택은 바뀌지 않는다. 그래서 스펙을 막는 티켓으로 만들지 않았다.
  - 점검 항목
    - SmartScreen을 거치는 설치 경로
    - 알림 표시와 클릭(배너, 알림 센터)
    - 로그인 시 자동 시작
    - `.cmd` 래퍼로 설치된 `claude` 실행과 프로세스 트리 종료
    - 한글 사용자 이름 경로(`C:\Users\홍길동\…`)에서 CLI 실행. 앱 이름은 ASCII여도 `%APPDATA%`에는 사용자 이름이 들어가기 때문이다.
    - `safeStorage` 암호화와 복호화
    - better-sqlite3 win32-x64 로드

### 범위

- Slack, Jira 등 다른 출처 통합은 범위 밖으로 뒀다. 지도의 Out of scope에 적었다.

### 지도와 다른 티켓에 반영한 것

- 안개 두 개를 티켓으로 옮겼다.
  - "설정·비밀 저장과 첫 실행 온보딩" → [설정과 첫 실행 온보딩 결정](16-onboarding.md)
  - "처리한 멘션의 보관" → [처리한 멘션의 보관 결정](17-processed-retention.md)
- [다운로드 사이트 형태 결정](09-download-site.md)에 산출물 위치와 접근 제약을 덧붙였다.
- 안개 "여러 PC에서 동시 실행"에 공유 저장소를 쓰지 않기로 한 사실을 덧붙였다.

## Comments

- 2026-10-17, [다운로드 사이트 형태 결정](09-download-site.md)에서 덧붙인다.
  - **저장소 공개**: `stardraft`는 처음부터 공개 저장소로 만든다. "비공개로 시작한다"를 대체한다.
    - 외부인이 연 PR의 워크플로는 승인해야 돌게 한다. 비밀값은 Actions 비밀값에만 둔다.
    - 이 기획 저장소는 그대로 비공개다. 옮기는 문서는 회사 정보가 없는지 확인한 뒤 옮긴다.
  - **사이트**: `apps/site`에 두고, Vercel에 배포한다.
  - **Release**: 초안 Release를 만든 뒤 공개하는 흐름은 그대로다. `stardraft`에 immutable releases를 켠다.
  - **앱 내 업데이트**: 범위에 넣었다. 그래서 첫 버전부터 바뀌는 것이 있다.
    - macOS zip, `latest.yml`, `latest-mac.yml`, 업데이트 서명 파일이 초안 Release에 함께 올라간다.
    - macOS는 `afterSign`에서 최상위 번들을 명시 DR로 다시 서명한다.
    - 정확한 목록과 방식은 [앱 내 업데이트 방식 결정](22-in-app-update-design.md)에서 정한다.

- 2026-10-19, [앱 내 업데이트 방식 결정](22-in-app-update-design.md)에서 덧붙인다.
  - **Release 산출물**: 초안 Release에는 다섯 개만 올린다.
    - DMG, `Stardraft-<v>-arm64-mac.zip`, `latest-mac.yml`, `Stardraft-Setup-<v>.exe`, `latest.yml`
    - `SHA256SUMS.txt`는 뺀다. GitHub가 Release 파일마다 sha256 `digest`를 보여 주기 때문이다.
    - blockmap과 `.sig` 파일은 올리지 않는다. 업데이트 서명은 yml 안의 필드에 둔다.
  - **빌드 설정**
    - `mac.target: ["dmg", "zip"]`
    - `publish`는 `github` provider(`repo: "stardraft"`)로 둔다. 빌드는 `--publish never` 그대로다.
    - `nsis.artifactName`은 `${productName}-Setup-${version}.${ext}`로 둔다. 파일 이름에서 공백을 빼려는 것이다.
  - **태그 워크플로**
    - 업데이트 서명은 Release 작업에서 `release` 환경 비밀값으로 한다. 이 비밀값은 `v*` 태그에서만 읽힌다.
    - 아래 중 하나라도 틀리면 초안 Release를 만들지 않는다.
      - 최상위 DR: `.app`과, zip을 `ditto -x -k`로 푼 결과 양쪽에서 본다.
      - zip을 푼 결과의 `codesign --verify --deep --strict`
      - yml과 실제 파일의 일치
      - 공개 키로 서명 재검증
  - **팀 배포 전 Windows 점검 목록**에 다섯 가지를 더한다.
    - 조용한 설치와 재실행
    - MOTW와 SmartScreen
    - 설치 도중 강제 종료
    - 업데이트 뒤 유지 항목
    - 설치 실패 띠
    - 자세한 내용은 22의 Answer에 있다.
  - **마이그레이션 전 사본**: 새 버전이 정상으로 뜬 지 7일이 지나면 지운다.
