# 23: 저장소 뼈대와 빈 트레이 앱

**Spec:** [스펙](../spec.md) 2절, 15절

**What to build:** 앱 저장소 `stardraft`(이 저장소)의 뼈대를 세우고, 켜면 메뉴 막대(트레이)에 아이콘이 생기는 빈 앱을 만든다. 아이콘을 누르면 트레이 옆에 빈 작은 창이 뜨고, 오른쪽 클릭 메뉴에 창 열기, 설정…, 종료가 있다. 설정…을 누르면 왼쪽에 칸 목록(Flow 계정, 에이전트, 저장소, 초안, 일반)이 있는 빈 설정 창이 뜬다. 소스에서 실행하면 이름이 `Stardraft Dev`로 보인다. 이 저장소는 아직 GitHub에 올리지 않고 로컬 git으로만 둔다(GitHub 생성은 59 마법사).

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] 이 저장소에 MIT 라이선스, `.gitignore`(`node_modules`, 빌드 산출물, `.env*`, 예외 `.env.example`)가 있다. 회사 데이터와 비밀값은 없다.
- [x] pnpm 워크스페이스 + turbo, `packageManager` 고정, Node 24 LTS. 데스크톱 앱 패키지와 사이트 패키지 자리가 있다.
- [x] Electron 최신 44.x, electron-vite + Vite(안정판 정확히 고정), React 19 + TypeScript. 앱은 core, main, preload, renderer 네 부분으로 나뉜다.
- [x] core는 Electron을 import하지 않고, ESLint `no-restricted-imports`로 막혀 있으며, 포트(Flow API, 실행기, 상태 저장소, 설정 저장소, 비밀 저장소, 알림, 시계)의 인터페이스와 가짜 구현 골격이 있다. Vitest가 Node에서 돈다.
- [ ] 트레이 아이콘, 클릭 시 트레이 근처의 작은 창, 오른쪽 클릭 메뉴(창 열기, 설정…, 종료)가 동작한다. macOS는 `LSUIElement`로 Dock 아이콘을 숨기고, 설정 창이 열려 있는 동안만 Dock 아이콘(Windows는 작업 표시줄 단추)을 보인다. 창은 닫을 때 없앤다.
- [x] 렌더러는 `contextIsolation`·`sandbox` 켜짐, `nodeIntegration` 꺼짐, 엄격한 CSP, 원격 콘텐츠 없음이며, preload의 타입 있는 IPC(상태 스냅숏·변경 이벤트·명령)로만 main과 통신한다.
- [x] Fuses 설정(`RunAsNode`·`EnableNodeOptionsEnvironmentVariable`·`EnableNodeCliInspectArguments` 끔, `EnableEmbeddedAsarIntegrityValidation`·`OnlyLoadAppFromAsar` 켬)이 빌드 설정에 있다.
- [x] 앱 이름 `Stardraft`, 식별자 `app.squadify.stardraft`. 소스 실행 시 `Stardraft Dev`로 이름이 바뀐다.
- [x] PR과 main 푸시에서 lint, typecheck, 테스트를 ubuntu와 windows 러너에서 돌리는 워크플로 파일이 있다(실행 확인은 59 마법사).
- [x] 스펙, `GLOSSARY.md`, ADR 0001·0002에 회사 정보가 없음을 확인했다.

## Comments

### 2026-10-19 구현과 검증 기록

**구조와 버전**

- 루트는 pnpm 12.14.0(`packageManager`) 워크스페이스와 turbo 2.11.9, Node 24(`.node-version`, `engines`)다. 패키지는 `apps/desktop`(데스크톱 앱)과 `apps/site`(다운로드 사이트 자리, 아직 비어 있음) 두 개다.
- 데스크톱 앱은 Electron 44.9.0(44.x 최신), electron-vite 6.0.0, Vite 8.3.4, React 19.3.1이다. 의존성은 모두 정확한 버전으로 고정했다.
  - TypeScript는 6.0.3이다. 7.x는 typescript-eslint 8.71.2가 지원하지 않는다(`<6.1.0`).
  - Electron 44.9.0은 설치 스크립트 없이 처음 실행할 때 바이너리를 받는다. 그래서 CI의 lint·typecheck·test는 Electron을 내려받지 않는다.
- `src/core`, `src/main`, `src/preload`, `src/renderer`의 네 부분으로 나눴다.
  - 세 부분이 함께 쓰는 IPC 계약 타입과 명령 검사는 `src/shared/ipc.ts` 한 파일에 따로 뒀다.
  - ESLint `no-restricted-imports`로 경계를 막는다. core는 Electron과 main·preload·renderer를 import하지 못한다. shared는 Electron, `node:*`, 앱의 다른 부분을 import하지 못한다. renderer는 Electron, `node:*`, main, core를 import하지 못한다.
- core 포트 일곱 개(Flow API, 실행기, 상태 저장소, 설정 저장소, 비밀 저장소, 알림, 시계)는 각 티켓이 처음 쓰는 메서드만 둔 골격이다. 가짜 구현은 `src/core/fakes`에 있다.
  - `Settings` 타입과 기본값은 스펙 3절의 필드를 그대로 옮겼다. 실제 `settings.json` 저장은 24가 맡는다.
- IPC는 셋으로 나뉜다. 스냅숏은 `getSnapshot`, 명령은 `send`(main이 형식을 검사하고, 앱 화면이 아닌 발신자는 거절), 변경 이벤트는 `onEvent`로 오간다.
  - 지금 있는 변경 이벤트는 "설정 창의 이 칸 보이기" 하나다. 묶음 변경, 전역 문제, 업데이트 상태, 설정 변경 이벤트는 각 티켓에서 더한다.
- electron-builder 26.17.0을 넣고, `electron-builder.yml`에는 앱 이름·식별자·Fuses·`LSUIElement`만 설정했다. 설치 파일 형식, 서명, publish 설정은 52가 맡는다.

**스펙에 없던 것을 더한 결정** (검토 대상)

- 단일 인스턴스 잠금을 걸었다. 두 번 실행해도 트레이 아이콘이 둘 생기지 않고, 두 번째 실행은 이미 켜진 앱의 작은 창을 연다.
- 소스 실행에서는 Windows AppUserModelID를 `app.squadify.stardraft.dev`로 바꾼다. 개발 중 실행이 설치본의 알림·바로가기 등록을 건드리지 않게 하려는 것이다(스펙 2절 "개발 중 실행"의 취지). 설치본은 스펙 값 `app.squadify.stardraft` 그대로다.
- 앱 메뉴를 줄였다. 기본 메뉴의 새로고침·개발자 도구 단축키를 없애려는 것이다. macOS는 입력 칸의 복사·붙여넣기 단축키 때문에 앱·편집·창 메뉴만 남기고, Windows는 메뉴를 없앴다.
- 렌더러에서 나가는 원격 네트워크 요청을 세션에서도 막았다(CSP와 이중 방어). main의 요청에는 webContents가 없어서 걸리지 않는다.
- 작은 창에 [설정 열기] 버튼을 뒀다. 스펙 13절 "설정 창은 작은 창에서 연다"에 따른 것이다. 필수 설정 전 화면은 31이 맡는다.

**검증**

- 자동 검사: 루트에서 `pnpm lint`, `pnpm typecheck`, `pnpm test`(Vitest 22개, Node)가 통과했다.
  - 테스트는 import 경계(core·shared·renderer), 가짜 시계, 가짜 실행기, 가짜 Flow API, IPC 명령 검사, 작은 창 위치 계산을 다룬다.
  - 작은 창 위치는 macOS 메뉴 막대, 화면 끝, Windows 아래쪽 작업 표시줄, 보조 모니터, 트레이 위치를 모를 때를 검사한다.
- macOS 실행 검증: 빌드한 앱을 소스 실행 모드로 띄우고 CDP로 확인했다.
  - 이름은 `Stardraft Dev`이고 데이터 폴더는 `~/Library/Application Support/Stardraft Dev`다. 시작할 때 Dock 아이콘과 창이 없다.
  - 두 번째 실행으로 연 작은 창은 실제 트레이 위치를 써서 메뉴 막대 바로 아래(작업 영역 위 4px)에 떴다.
  - 렌더러 상태: `contextIsolation`·`sandbox`·`webSecurity`는 켜져 있고 `nodeIntegration`은 꺼져 있다. `require`와 `process`가 없고 `window.stardraft`(getSnapshot, send, onEvent)만 보인다.
  - 차단: CSP가 원격 fetch와 인라인 스크립트를 막았다. 외부 주소로의 이동도 막혔다. 모르는 명령은 main이 거절했다.
  - 설정 창: [설정 열기]를 누르면 작은 창이 닫히고, 설정 창(`Stardraft Dev 설정`, 칸 목록 180px, 다섯 칸)이 열리며 Dock 아이콘이 보인다. 칸 이동과 "칸 보이기" 이벤트도 동작했다.
  - 설정 창을 닫으면 창이 없어지고 Dock 아이콘이 숨는다. 앱은 계속 돌고, 종료는 `app.quit`으로 된다.
  - 고친 경합: 이미 보이는 Dock에 `dock.show()`를 다시 부르면 늦게 끝나면서 그 사이의 `dock.hide()`를 덮어, 창을 닫아도 Dock 아이콘이 남는 문제가 있었다. 이미 보이면 부르지 않고, show가 끝났을 때 설정 창이 닫혀 있으면 다시 숨기게 고쳤다. 설정 창을 연 직후 바로 닫는 경우도 확인했다.
  - 개발 서버 모드(`pnpm dev`): 렌더러를 로컬 개발 서버에서 불러오고 스타일이 적용됐다. 개발 서버에서만 CSP `style-src`에 `'unsafe-inline'`이 더해진다.
- 빌드 설정 검증: `electron-builder --mac dir`로 작업 폴더 밖 임시 폴더에 빌드해 확인했다.
  - Fuses: `RunAsNode`·`EnableNodeOptionsEnvironmentVariable`·`EnableNodeCliInspectArguments`는 꺼지고, `EnableEmbeddedAsarIntegrityValidation`·`OnlyLoadAppFromAsar`는 켜졌다.
  - Info.plist: `LSUIElement`는 true, `CFBundleIdentifier`는 `app.squadify.stardraft`, `CFBundleName`은 `Stardraft`다.
- 회사 정보 확인: 스펙, `GLOSSARY.md`, ADR 0001·0002에서 회사 이름·도메인, `*.flow.team` 하위 도메인, 이메일 주소, 6자리 이상 숫자 ID, URL을 찾았다. 나온 것은 공통 주소 `api.flow.team`과 `flow.team`, 앱 도메인 `squadify.app`뿐이다.

**사용자 확인이 필요한 것** (트레이 체크 항목을 체크하지 않은 이유)

트레이 항목의 코드와 macOS 동작 일부는 위에서 확인했다. 아래는 실제 화면 조작이나 Windows 기기가 있어야 해서 확인하지 못했다.

- macOS 메뉴 막대 아이콘을 실제로 왼쪽 클릭했을 때 작은 창이 열리는지, 다시 누르면 닫히는지, 바깥을 누르면 닫히는지.
  - 자동 검증에서 두 번째 실행으로 연 작은 창은 macOS가 포커스를 주지 않았다. 사용자 입력이 아닌 활성화라 막힌 것으로 본다. 포커스가 없으면 바깥을 눌러도 닫히지 않으므로, 실제 클릭에서 포커스를 받는지 봐야 한다.
- 오른쪽 클릭 메뉴에 창 열기, 설정…, 종료가 보이는지와 각 항목의 동작.
- Windows 동작(60 Windows 점검 때 확인): 트레이 아이콘 표시, 작은 창이 작업 표시줄 위 트레이 근처에 뜨는지와 테두리, 설정 창이 열려 있는 동안 작업 표시줄 단추가 보이는지.
- CI 워크플로 실제 실행(59 마법사). 액션은 커밋 SHA로 고정했고, YAML 문법만 확인했다.
- 소스 실행에서 이름을 바꿨을 때 키체인 항목 이름(`Stardraft Dev Safe Storage`)에 반영되는지는 `safeStorage`를 처음 쓰는 25에서 확인한다.
