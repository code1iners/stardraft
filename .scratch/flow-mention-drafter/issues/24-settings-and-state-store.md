# 24: 설정 파일과 상태 DB

**Spec:** [스펙](../spec.md) 3절

**What to build:** 앱이 OS 표준 앱 데이터 폴더에 `settings.json`과 `state.db`를 만들고, 설정 창의 "일반" 칸에서 데이터 폴더·로그 폴더 열기와 버전을 볼 수 있다. 더 새 버전이 만든 데이터를 만나면 앱이 실행되지 않고 "이 데이터는 더 새 버전(vX)에서 만들어졌습니다. 새 버전을 다시 설치하세요"를 보인다.

**Blocked by:** 23

**Status:** resolved

- [x] 데이터 폴더는 macOS `~/Library/Application Support/Stardraft/`, Windows `%APPDATA%\Stardraft\`이고, 개발 모드는 `Stardraft Dev` 폴더다. 위치를 바꾸는 설정과 환경 변수는 없다.
- [x] `settings.json`은 `schemaVersion`을 갖고, 임시 파일에 쓴 뒤 이름을 바꾸는 방식으로 저장된다. 설정 저장소 포트의 실제 구현이다.
- [x] `state.db`는 better-sqlite3 13.x(정확한 버전 고정, `.node`는 asar 밖, 번들러 외부 모듈)이고, `PRAGMA user_version` 기반 SQL 마이그레이션, WAL, `secure_delete`가 켜져 있다. ORM은 없다. 상태 저장소 포트의 실제 구현이다.
- [x] 앱이 아는 것보다 큰 `user_version`이나 `schemaVersion`을 만나면 실행하지 않고 안내 창을 띄우며 데이터를 지우지 않는다.
- [x] 마이그레이션 직전에 `state.db`와 `settings.json`의 사본을 버전 이름으로 남긴다(삭제 규칙은 55).
- [x] 진단 로그가 OS 표준 로그 폴더에 크기 상한으로 회전하며, API 키와 Flow 글 본문을 남기지 않는 로거 규약이 있다.
- [x] 설정 창 "일반" 칸에 데이터 폴더 열기, 로그 폴더 열기, 버전이 있다. 설정은 바꾸는 즉시 저장되고 "저장" 버튼이 없다.
- [x] 마이그레이션, 다운그레이드 차단, 원자적 저장이 실제 임시 파일로 테스트된다.

## Comments

### 2026-10-20 구현과 검증 기록

**구조**

- 저장 어댑터는 Electron 없이 Node에서 테스트할 수 있게 core 아래에 두었다.
  - `src/core/storage/`: 설정 저장소 포트 구현 `FileSettingsStore`, 상태 저장소 포트 구현 `SqliteStateStore`, 둘을 여는 `openAppData`.
  - `src/core/logging/`: 로거 규약과 회전 로그 파일.
- main은 시작할 때 `openAppData`를 부른다.
  - 결과가 `newer-data`면 트레이를 만들기 전에 안내 창(버튼 [종료])을 띄우고 끝낸다.
  - 데이터를 열지 못하면(깨진 `settings.json` 등) 데이터·로그 폴더 위치를 적은 안내 창을 띄우고 끝낸다. 어느 쪽도 파일을 지우지 않는다.
- 데이터 폴더는 `app.getPath('appData')` 아래 앱 이름 폴더로 명시해 고정했다. 실행 인수로 위치가 바뀌지 않는다.
- 로그 폴더는 macOS가 `~/Library/Logs/<앱 이름>`, Windows가 데이터 폴더 안 `logs`다.
  - 인수 없는 `app.setAppLogsPath()`는 소스 실행에서 `~/Library/Logs/Electron`을 써서 경로를 직접 넘긴다.
- better-sqlite3는 `13.0.3`으로 고정했다. N-API prebuild를 함께 배포하므로 Electron용으로 다시 빌드하지 않는다(`npmRebuild: false`).
  - electron-vite main 빌드에서 외부 모듈로 둔다.
  - `node_modules/better-sqlite3/prebuilds/**`는 asar 밖에 둔다.
  - 타입은 `@types/better-sqlite3` 최신판인 9.6.0을 쓴다. 13.x용 타입 패키지는 없다.
- `state.db` 마이그레이션은 `STATE_MIGRATIONS` 배열의 SQL이고, 배열 길이가 곧 앱이 아는 `user_version`이다. 한 트랜잭션으로 올리므로 실패하면 올리기 전 버전 그대로 남는다.
  - 버전 1은 `app_meta`(데이터를 쓴 앱 버전), `account`(`user_id`), `detection`(`baseline_alarm_id`)이다.
- `settings.json` 마이그레이션은 `SETTINGS_MIGRATIONS` 변환 배열이고, 형식 버전은 변환 수 + 1이다. 지금은 변환이 없다.
- 로거 규약은 `src/core/logging/logger.ts` 머리 주석에 있다.
  - 사건 이름은 고정 문자열로 쓰고, 필드 값은 문자열·숫자·참거짓·`null`만 받는다.
  - 이름이 키·토큰·본문·제목·초안·지침 등을 뜻하는 필드는 `[redacted]`로 가린다. `...Id`·`...Count`·`...Length`로 끝나는 이름은 남긴다.
  - 200자를 넘는 문자열은 자른다.
  - 오류 메시지는 그대로 남으므로, Flow 응답이나 에이전트 출력을 다루는 코드는 본문을 오류 메시지에 넣지 않는다.
  - 로그 파일은 JSON 줄이고, 2MB에서 회전하며 옛 파일 3개를 남긴다.

**스펙에 없던 것을 더한 결정** (검토 대상)

- 다운그레이드 안내의 "(vX)"를 채우려고 데이터를 쓴 앱 버전을 남긴다.
  - `settings.json`은 저장할 때마다 최상위 `appVersion` 필드에 남긴다. 읽을 때는 설정 값에서 뺀다.
  - `state.db`는 열 때마다 `app_meta.app_version`에 남긴다. 이 표는 옛 버전이 읽는 곳이라 바꾸지 않는다는 규칙을 코드 주석에 적었다.
  - 버전을 읽을 수 없으면 "이 데이터는 더 새 버전에서 만들어졌습니다. 새 버전을 다시 설치하세요."로 버전 없이 안내한다.
  - 스펙 3절 "담는 것"에 두 필드를 더해 둘 만하다.
- 마이그레이션 전 사본은 `backups/before-v<마이그레이션하는 앱 버전>/state.db`, `settings.json`이다.
  - `state.db` 사본은 `VACUUM INTO`로 만들어 WAL에만 있던 내용도 들어간다.
  - 같은 이름의 사본이 이미 있으면 덮어쓰지 않는다. `state.db`만 올라가고 `settings.json` 쓰기가 실패한 뒤 다시 올릴 때, 먼저 남긴 사본만이 원본이기 때문이다.
  - 7일 뒤 삭제는 55가 맡는다.
- 다운그레이드 검사는 `state.db`를 읽기 전용으로 연다. 없으면 만들지 않는다.
  - 새 버전이 WAL에만 남긴 내용도 체크포인트하지 않는다.
  - 다만 SQLite가 보조 파일(`-shm`, 빈 `-wal`)을 만들 수는 있다.
- 시작할 때 macOS ShipIt 로그 위치(`~/Library/Caches/app.squadify.stardraft.ShipIt`)를 로그에 남긴다. electron-updater 로그 연결은 54·55에서 한다.
- "설정은 바꾸는 즉시 저장"은 `FileSettingsStore.save`가 맡는다. 부르는 즉시 원자적으로 저장하고, 잇단 저장은 부른 순서대로 처리한다.
  - "일반" 칸에는 저장 버튼이 없다. 이 티켓의 "일반" 칸에는 바꿀 설정이 없다(자동 시작·알림 시험은 50, 에디터는 42, 업데이트는 55).
  - 렌더러의 설정 변경 명령은 그 칸들을 만들 때 이 저장소에 연결한다.

**검증**

- 자동 검사: 루트에서 `pnpm lint`, `pnpm typecheck`, `pnpm test`(Vitest 56개)가 통과했다.
  - 데이터 폴더 열기(실제 임시 폴더)
    - 첫 실행 생성
    - 계정·기준점의 재시작 뒤 유지
    - WAL
    - 다운그레이드 차단: `user_version`, WAL에만 남은 새 데이터, `schemaVersion`, `state.db`를 만들지 않음, 버전을 모를 때 안내
    - 마이그레이션 전 사본(`state.db`, `settings.json`)과 덮어쓰지 않음
    - 형식이 그대로일 때 사본 없음
    - 실패한 마이그레이션 SQL의 되돌림
  - 원자적 저장(실제 임시 파일)
    - 임시 파일 미잔존
    - 쓰기 실패 시 원본 보존(폴더를 읽기 전용으로 바꿔 확인)
    - 잇단 저장 20번의 순서
    - 빠진 필드의 기본값
  - `secure_delete`: 지운 행이 파일에 남지 않는지 검사한다. 설정을 끄면 이 테스트가 실패하는 것도 확인했다.
  - 로거: 가림, 자르기, 예약 필드 보호, 출력 실패 격리, 회전, 재시작 뒤 크기 계산.
  - IPC: 폴더 열기 명령은 `data`·`logs`만 받는다.
- macOS 소스 실행(`Stardraft Dev`)
  - `~/Library/Application Support/Stardraft Dev/`에 `settings.json`과 `state.db`(WAL, `user_version` 1)가 생겼다. 로그는 `~/Library/Logs/Stardraft Dev/main.log`에 남았다.
  - 다시 켜면 마이그레이션과 사본 없이 열렸다.
  - CDP로 확인한 설정 "일반" 칸: "데이터" 아래 [데이터 폴더 열기] [로그 폴더 열기], `Stardraft Dev 0.1.0`.
  - 두 폴더 열기 명령은 오류 없이 처리됐다(`shell.openPath` 실패 로그 없음). 정해진 폴더가 아닌 명령은 main이 거절했다.
  - Dev 데이터의 `user_version`을 99, 앱 버전을 0.9.0으로 바꿔 띄웠다.
    - 로그에 `app-data.newer-state`가 남았다.
    - Electron 안내 창(260×208)이 화면에 떠 응답을 기다렸다.
    - `state.db`와 `settings.json`의 해시는 그대로였다.
    - 확인 뒤 Dev 데이터를 원래 버전으로 되돌렸다.
- 설치본 형태 확인: 작업 폴더 밖 임시 폴더에 `electron-builder --mac dir`로 빌드하고, 그 사본에만 ad-hoc 서명을 했다.
  - `.node`는 `app.asar.unpacked/node_modules/better-sqlite3/prebuilds/`에 있다.
  - Fuses(`OnlyLoadAppFromAsar`, asar 무결성) 아래에서 better-sqlite3가 로드됐다.
  - 데이터는 `~/Library/Application Support/Stardraft/`, 로그는 `~/Library/Logs/Stardraft/`에 생겼다.
  - 확인 뒤 이 실행이 만든 두 폴더와 `app.squadify.stardraft` 환경설정 파일을 지웠다.

**남은 것과 사용자 확인이 필요한 것**

- 실제 클릭(이 환경에는 화면 캡처·Finder 제어 권한이 없다)
  - 설정 "일반"의 두 버튼을 눌렀을 때 Finder 창이 실제로 열리는지.
  - 다운그레이드 안내 창의 문구와 [종료] 버튼이 보이는지.
- Windows 실기(60 점검)
  - 데이터 폴더가 `%APPDATA%\Stardraft\`, 로그 폴더가 그 안 `logs`인지.
  - better-sqlite3 win32-x64가 로드되는지.
  - 폴더 열기가 탐색기를 여는지.
- 빌드 크기(52 참고): 지금은 모든 OS의 better-sqlite3 prebuild(8개)가 앱에 들어간다. 빌드 대상 OS 것만 넣도록 52에서 `files` 제외를 정하면 된다.
