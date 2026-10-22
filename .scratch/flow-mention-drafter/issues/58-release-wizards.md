# 58: 출시 마법사 작성

**Spec:** [스펙](../spec.md) 테스트 결정 "실기 점검 목록", 15절 "릴리스 흐름", 14절 "서명 키", 16절 "코드와 호스팅"

**What to build:** `wizard` 스킬로 bash 마법사 두 개를 만든다. 하나는 저장소 주인이 Mac에서 처음 출시할 때 손으로 해야 하는 일을 처음부터 끝까지 안내하는 **출시 마법사**이고, 다른 하나는 Windows PC에서 돌리는 **Windows 점검 마법사**다. 사람이 해야 하는 일은 모두 이 두 마법사에 들어 있어야 하고, 각 스테이지는 열 URL, 누를 것, 복사할 값, 확인 질문을 담는다. 값은 `.env`나 GitHub 비밀값에 쓴다. 마법사는 앱 저장소의 스크립트 폴더에 두고 커밋한다(다음 사람도 쓰는 반복 절차).

**Blocked by:** 49, 50, 51, 55, 57

**Status:** resolved

- [x] **출시 마법사** 스테이지(순서대로): ① `gh` 로그인 상태 확인 ② 이력에 회사 정보(하위 도메인, 실제 Flow ID)가 없는지 검사하고 공개 저장소 `stardraft`(MIT) 생성과 로컬 이력 푸시, PR CI 통과 확인 ③ 저장소 설정 — immutable releases 켜기, 외부 PR 워크플로 승인 필요로 설정, `release` 환경 만들고 `v*` 태그에만 허용 ④ `pnpm release:keygen` 실행과 개인 키의 비밀번호 관리자 보관 확인, 공개 키 커밋 ⑤ Vercel 프로젝트 생성(Root Directory, Ignored Build Step, 공개 읽기 토큰), `stardraft.squadify.app` 도메인 연결 ⑥ 테스트 저장소에서 "공개 Release → 사전 릴리스 전환 시 `releases/latest`가 이전 버전으로 돌아가는지" 확인 ⑦ `v0.1.0` 태그 푸시와 태그 워크플로 결과 확인, 초안 Release의 다섯 파일 확인 ⑧ 초안 Release의 DMG를 브라우저로 받아 설치("열지 않음" → 시스템 설정 → 그래도 열기) ⑨ 온보딩 실제 실행 — Flow 키 확인, Claude Code 연결, 작업 폴더, [감지 시작], 알림 허용 배너 ⑩ 최근 멘션으로 시험 ⑪ 미서명 macOS 점검 — 알림 표시, 알림 클릭(배너·알림 센터), 로그아웃 뒤 자동 시작, 첫 실행에 Keychain을 묻지 않음 ⑫ macOS 스크린숏 두 곳(열지 않음 대화상자, 그래도 열기 위치)을 한국어 OS에서 찍어 사이트에 넣고 재현 화면 문구 맞추기 ⑬ 표준 계정과 `~/Applications`에서 위치 확인 판정 보기(선택) ⑭ Release 공개, 사이트에서 버전·다운로드·`/api/releases` 확인 ⑮ 두 번째 버전으로 앱 내 업데이트 실측 — 받는 중 표시, 다시 시작 확인 화면, Keychain "항상 허용", 업데이트 직후 띠, yml 변조 두 경우의 오류 표시 ⑯ 동료와 함께 — 받는 사람에게 멘션 알림이 가는지, `PROBE-GROUP`·`PROBE-DM` 표지로 채팅 멘션이 알림 목록에 오는지(결과는 스펙의 범위 밖 항목에 기록).
- [x] **Windows 점검 마법사** 스테이지: 스펙 "팀 배포 전 Windows 점검 목록"의 13개 항목을 하나씩, 그리고 Windows 스크린숏 두 곳(PC 보호 화면, 스마트 앱 컨트롤 설정)과 메뉴 이름·상태 이름 확인. 결과를 기록 파일로 남긴다.
- [x] 각 스테이지는 템플릿의 `stage`/`open_url`/`ask_secret`/`write_env`/`set_secret`/`confirm`를 쓰고, 되돌리기 어려운 행동(공개, 사전 릴리스 전환) 앞에는 `confirm`이 있다. 비밀값은 숨김 입력이다. 실제 UI 경로를 모르는 단계는 지어내지 않고 사용자에게 확인하라고 적는다.
- [x] `bash -n`과 `shellcheck`를 통과하고 실행 권한이 있다. 실행 방법이 README에 적혀 있다.

## Comments

- 2026-10-22 구현 기록
  - 마법사는 `scripts/release-wizard.sh`(16개 스테이지, 저장소 주인의 Mac)와 `scripts/windows-check-wizard.sh`(15개 스테이지, Windows의 Git Bash)다. 1~185줄은 `wizard` 템플릿의 라이브러리 그대로이고 스테이지만 그 아래에 썼다. 실행 방법은 루트 `README.md`에 적었다.
  - 점검 결과는 `docs/checks/macos-release-check.md`, `docs/checks/windows-check.md`에 한 줄씩 쌓는다(기록 시각, 스테이지, 항목, 결과, 메모). 59·60은 이 파일을 검토해 커밋하면 된다.
  - 이어서 하기: `--from N`, `--only N`. 이어서 해도 버전·Release를 다시 만들지 않는다(이미 있는 Release, 이미 공개한 Release, 정해 둔 변조 시험 버전은 건너뛰거나 다시 씀). 로그아웃해야 보이는 자동 시작(출시 11·15, Windows 9·14)은 `.env`에 남기고, 다시 로그인한 뒤 `--from`으로 실행하면 결과를 먼저 묻는다.
  - 값이 가는 곳
    - 루트 `.env`(커밋 안 됨): `GITHUB_OWNER`, 시험 저장소 이름, 버전들, 스크린숏 경로, Windows 메뉴·상태 이름.
    - `apps/site/.env`: `VERCEL_GIT_REPO_OWNER`, `GITHUB_RELEASE_TOKEN`(사이트 로컬 실행용). Vercel에는 사람이 붙여 넣는다(클립보드에 넣었다가 비움).
    - 업데이트 서명 개인 키는 `pnpm release:keygen`이 `release` 환경 비밀값과 클립보드로만 다룬다. Flow 키와 이력 검사에 넣는 회사 값은 숨김 입력이고 어디에도 저장하지 않는다.
  - 템플릿의 `set_secret`은 쓰지 않았다. CI가 읽는 비밀값은 `release` 환경 비밀값 `UPDATE_SIGNING_KEY`뿐이다. 스펙 14절대로 `release:keygen`이 `gh secret set --env release`로 넣는데, `set_secret`은 저장소 비밀값만 다룬다. `AZURE_*`는 지금 미서명이라 넣지 않는다.
  - 되돌리기 어려운 행동 앞에는 `confirm`(멈추는 `require`)이 있다: 공개 저장소 만들기, main·태그 푸시, 서명 키 덮어쓰기, Release 공개, 사전 릴리스 전환, 업데이트 설치 파일 강제 종료.
  - 스펙에 없던 것을 정한 결정 (검토 대상)
    - **yml 변조 두 경우**: 공개 Release는 immutable이고 초안은 앱에 보이지 않는다. 그래서 버전을 하나씩 더 내어, 초안일 때 `latest-mac.yml`의 sha512나 서명 목록을 모양만 맞는 무작위 값으로 바꿔 다시 올리고 공개한다. 확인한 뒤 사전 릴리스로 내린다. 버전 번호 두 개를 쓰고, 공개된 동안 사이트 다운로드도 그 버전을 가리킨다(DMG·exe는 정상). 각 경우는 건너뛸 수 있다.
      - 사전 릴리스로 내린 뒤 `/download/mac`과 앱의 업데이트 확인이 이전 버전으로 돌아가는지도 여기서 본다. 6단계 시험 저장소에서는 `releases/latest`만 볼 수 있다.
    - **13단계(위치 확인)**: 판정은 설치한 버전보다 새 공개 버전이 있어야 보인다. 그래서 순서는 티켓대로 두고, 13단계에서는 새 버전이 있을 때만 하고, 기본 흐름에서는 15단계에서 두 번째 버전을 공개한 직후(업데이트 전)에 묻는다.
    - **Windows의 업데이트 항목 순서**: 이전 버전(GitHub Release 주소로 직접 받음)을 설치하고, 같은 새 버전으로 설치 실패 띠(설치 파일이 나타나자마자 강제 종료) → 설치 도중 강제 종료(몇 초 뒤)와 이전 버전 재설치 → 성공하는 업데이트 순으로 본다. 강제 종료는 마법사가 `tasklist`로 설치 파일을 지켜보다 `taskkill`한다. 받은 설치 파일 폴더 이름은 정해 두지 않고 `%LOCALAPPDATA%` 아래에서 찾는다.
    - **2단계 이력 검사**: `api.flow.team` 말고 다른 `*.flow.team` 주소를 자동으로 찾고, 사람이 넣은 값(숨김 입력)이 나오는 커밋(`-S`, 커밋 메시지)을 찾는다. 커밋 작성자 메일 주소도 공개되므로 보여 주고 확인을 받는다. 이력을 고쳐 쓰는 일은 하지 않고 멈춘다.
    - CI에 `bash -n`과 `shellcheck` 단계를 더했다(ubuntu 러너만).
  - 화면 이름을 확인하지 못해 사용자에게 확인하라고 적은 곳: GitHub의 immutable releases·외부 PR 승인 설정 위치(먼저 API로 켜 보고 안 되면 화면으로), Vercel의 Ignored Build Step·System Environment Variables 위치, DNS 레코드 값(Vercel 화면 값을 그대로), Windows 계정 추가 메뉴, Windows 보안의 메뉴·상태 이름(입력받아 기록).
  - 검증
    - `bash -n`(macOS 기본 bash 3.2와 현재 bash)과 `shellcheck` 0.11.0이 두 스크립트 모두 경고 없이 통과했다. 1~185줄이 템플릿과 같은 것을 diff로 확인했다.
    - 작업 폴더 밖 임시 복사본에서 돌려 봤다: `--help`, 잘못된 인수와 값 없는 `--from`(바로 끝남), 1단계 값 없이 `--from`(안내하고 끝남), 결과 기록(통과·실패·입력 끝남=건너뜀, 메모의 `|` 처리), 로그아웃 전에 남긴 항목을 다시 실행할 때 먼저 묻고 지우기, 선택 스테이지 건너뛰기.
    - yml 변조 코드는 가짜 `latest-mac.yml`에 돌려 sha512(파일 항목과 최상위)와 `stardraftSignatures`가 64바이트 base64 값으로 바뀌는 것을 봤다.
    - `pnpm lint`, `pnpm typecheck`, `pnpm test`(데스크톱 1210개, 사이트 80개)가 통과했다.
    - 마법사를 처음부터 끝까지 돌리지는 않았다. 브라우저·GitHub·Vercel·실기 조작과 사람 입력이 필요하고, 실제 저장소 생성·푸시·Release·서명 키 생성은 외부에 영향을 준다. 실제 실행은 59(macOS)와 60(Windows)에서 한다. gh API 경로(immutable releases, fork PR 승인 정책, 환경 배포 규칙)는 실제로 불러 보지 않았고, 안 되면 설정 화면으로 넘어가게 했다.
