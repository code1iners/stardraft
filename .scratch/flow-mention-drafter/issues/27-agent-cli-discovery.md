# 27: 에이전트 CLI 찾기와 로그인 확인

**Spec:** [스펙](../spec.md) 13절 "에이전트"

**What to build:** 설정 창 "에이전트" 칸을 열면 앱이 Claude Code CLI를 찾고 버전과 로그인을 차례로 확인해 연결선 그림으로 보여 준다. 실패하면 그 마디가 끊기고 터미널에 붙여 넣을 명령이 든 그림 카드가 나온다. 못 찾으면 찾아본 곳과 "직접 지정"이 보인다. (네 번째 단계 "작동 확인"은 28.)

**Blocked by:** 24

**Status:** resolved

- [x] macOS는 로그인 셸(`$SHELL -ilc`)을 한 번 띄워 `command -v`와 PATH를 표지 문자열로 감싸 읽는다(제한 5초). zsh, bash, fish에서 동작하고 rc 파일이 멈출 때 5초 제한이 걸리는지 확인해 기록한다. Windows는 앱이 받은 PATH를 쓴다.
- [x] 못 찾으면 알려진 설치 위치를 보고, 그래도 없으면 파일 선택으로 직접 지정한다. Windows의 `WindowsApps\Claude.exe`는 후보에서 뺀다.
- [x] 찾은 절대 경로를 `settings.json`에 저장해 보여 주고, 경로가 사라졌거나 "다시 찾기"를 누를 때만 다시 찾는다. 읽은 PATH는 자식 프로세스용으로 보관한다.
- [x] 버전 단계는 필수 플래그 지원 여부(예: `--restricted`는 2.1.248 이상)를 보고, 낮으면 "업데이트 필요"로 끊는다.
- [x] 로그인 단계는 `claude auth status`를 앱이 실제로 쓰는 환경 변수(API 키 변수 제외, 읽은 PATH)로 돌린다. `api_key_helper` 방식은 지원하지 않는다고 안내한다. 미로그인 때의 실제 출력과 종료 코드를 확인해 기록한다.
- [x] 연결선 표시: 네 마디(찾기·버전·로그인·작동 확인), 끝난 단계 초록 선, 진행 중 움직이는 점선, 남은 단계 회색 점선. 네 번째 마디는 이 티켓에서 "다음 단계"로 비워 둔다.
- [x] 실패 카드 네 장(터미널/PowerShell 열기, 명령 붙여 넣기와 복사 버튼, 원인별 다음 행동, 다시 확인)이 있고, 화면의 명령(`claude auth login`, `claude update`, 설치 명령)이 실제 CLI와 맞는지 확인해 기록한다. 경로·버전·로그인 방식·오류 원문은 "자세히" 안에만 있다.
- [x] 가짜 프로세스 실행기로 찾기·버전·로그인 각 단계의 성공과 실패가 테스트된다.

## Comments

### 2026-10-20 구현과 검증 기록

**구조**

- core `src/core/agent/`
  - `process-runner.ts`: 프로세스 실행기 계약(`ProcessRunner`)이다.
    - 결과는 `exited`·`timed-out`·`spawn-failed` 셋이다.
    - 자식 환경은 요청에 넘긴 값만 쓴다.
  - `node-process-runner.ts`(`NodeProcessRunner`): 실제 실행기다.
    - POSIX는 새 프로세스 그룹으로 띄운다. 제한 시간을 넘기면 그룹째 `SIGKILL`로 끝내 rc 파일이 띄운 자식까지 정리한다. Windows는 `taskkill /T /F`로 끝낸다.
    - 끝난 뒤 출력이 닫히지 않으면 0.5초만 기다린다. rc 파일의 백그라운드 프로세스가 출력을 물고 있는 경우다.
    - Windows `.cmd`·`.bat`(npm 설치본)은 cmd.exe를 거쳐 명령 한 줄로 띄운다. 인수를 따로 넘기면 Node 24의 DEP0190 경고가 나기 때문이다.
  - `cli-discovery.ts`: CLI 찾기를 맡는다. 로그인 셸 읽기, PATH·알려진 설치 위치 검색, `WindowsApps\Claude.exe` 제외, 터미널에서 부르는 말, 자식 환경을 만든다.
  - `claude-cli.ts`: Claude Code 전용 사실을 둔다. 최소 버전, 버전·`auth status` 출력 해석, 업데이트 명령이다.
  - `agent-connection.ts`(`AgentConnection`): 찾기 → 버전 → 로그인을 차례로 돌린다. 실패한 단계에서 멈춘다.
    - 상태는 `idle`·`checking(step)`·`failed(failure)`·`awaiting-run-check`다. `awaiting-run-check`는 셋째 단계까지 통과한 상태이고, 넷째 마디 "작동 확인"은 28이 채운다.
    - 새 확인(다시 찾기, 직접 지정)이 시작되면 앞 확인의 결과는 상태에도 설정에도 반영하지 않는다(세대 번호).
- 찾기
  - 쓰는 경로는 이 순서로 정한다.
    1. 직접 지정한 파일
    2. 저장한 경로(아직 실행할 수 있을 때)
    3. 로그인 셸의 `command -v`
    4. 로그인 셸 PATH 검색
    5. 알려진 설치 위치
       - macOS: `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`
       - Windows: `%USERPROFILE%\.local\bin`, `%APPDATA%\npm`
  - 로그인 셸 명령: `<$SHELL> -ilc "printf '%s\n' <시작 표지>; command -v claude; printf '%s\n' <경계 표지>; printenv PATH; printf '%s\n' <끝 표지>"`. 제한은 5초다.
    - `command -v`가 절대 경로가 아닌 것(zsh 별칭 정의 등)을 주면 버리고 PATH에서 찾는다.
  - 찾은 절대 경로는 `settings.json`의 `agentCliPaths['claude-code']`에 저장한다. 저장한 경로와 같으면 다시 쓰지 않는다.
  - 저장한 경로가 실행 가능하면 다시 찾지 않는다. 로그인 셸도 앱 실행 동안 처음 한 번만 띄운다. 경로가 사라졌거나 "다시 찾기"를 누르면 로그인 셸부터 다시 읽는다.
  - 읽은 PATH는 `AgentConnection.processEnv()`로 자식 프로세스 환경에 쓴다. API 키 변수(`ANTHROPIC_API_KEY`, `CODEX_API_KEY`)는 빼고 PATH만 바꾼다. Windows는 이름의 대소문자를 가리지 않는다.
  - Windows는 앱이 받은 PATH(`Path`)와 `PATHEXT`(`.com`·`.exe`·`.bat`·`.cmd`만)로 찾는다.
- 버전: `claude --version` 출력에서 `x.y.z`를 읽어 `MIN_CLAUDE_VERSION`과 비교한다.
- 로그인: 자식 환경, 작업 폴더 홈으로 `claude --restricted auth status`를 돌린다.
  - `loggedIn`이 참이면 통과한다.
  - 거짓이면 `claude auth status`를 한 번 더 돌린다. `authMethod`가 `api_key_helper`면 "지원하지 않는 방식", 아니면 "로그인 필요"다.
  - JSON을 읽지 못하면 "확인 실패"이고, 오류 원문을 "자세히"에 담는다.
- IPC
  - 스냅숏에 `agentConnection`을, 이벤트에 `agent-connection-changed`를 더했다.
  - 명령은 `check-agent`, `rediscover-agent`, `pick-agent-cli`, `copy-agent-fix-command` 넷이다.
  - 경로와 복사할 명령은 렌더러가 보내지 않는다. main이 파일 선택 창과 지금 상태에서 정한다(`parseAppCommand`가 실린 값을 버린다).
- 화면(`src/renderer/src/AgentSection.tsx`, 프로토타입 B)
  - 칸을 열 때마다 확인을 시작한다. 이미 확인 중이면 그 확인을 기다린다.
  - 연결선은 네 마디다. 끝난 단계는 초록 선, 진행 중은 움직이는 점선(`prefers-reduced-motion`이면 멈춤), 남은 단계는 회색 점선, 실패는 끊긴 빨간 선과 ✕다.
  - 명령으로 고치는 실패(설치 필요, 업데이트 필요, 로그인 필요, apiKeyHelper)에는 그림 카드 네 장을 둔다. 명령 복사는 main의 `clipboard`로 한다. 렌더러 권한 요청을 모두 거절하므로 `navigator.clipboard`를 쓰지 않는다.
  - 그 밖의 실패는 한 줄 안내와 [다시 확인]만 둔다.
  - 찾기 실패에는 [직접 지정…]을 둔다. 파일 선택 창은 설정 창의 시트로 뜨고, macOS는 숨김 폴더도 보인다.
  - 경로, 버전(필요 버전), 로그인 방식, PATH 출처, 찾아본 곳, 오류 원문은 "자세히" 안에만 있다.

**실측 기록** (이 PC: macOS, zsh, Claude Code 2.1.303 Homebrew cask `claude-code@latest`)

- 로그인 셸 PATH 읽기(`NodeProcessRunner` + `readLoginShell`). rc 파일은 임시 홈에 두었다.
  - zsh(`/bin/zsh`, `ZDOTDIR`): rc 출력이 섞여도 표지 사이를 읽는다. 별칭이면 경로를 버린다. `.zshrc`에 `sleep`을 넣으면 5.0초에 시간 초과로 끝나고, 남은 `sleep` 프로세스가 없다. 이 셋은 자동 테스트에 넣었다.
  - bash(`/bin/bash` 3.2, `.bash_profile`): 같은 명령으로 PATH와 `command -v`를 읽는다. 자동 테스트에 넣었다.
  - fish 4.9.3: 이 PC에 설치하지 않았다. Homebrew 보틀을 임시 폴더에 풀어 pcre2를 다시 링크해 돌렸다.
    - 같은 명령이 `config.fish`의 `fish_add_path`를 반영한 PATH와 `command -v` 경로를 12ms에 읽었다.
    - `config.fish`에 `sleep`을 넣으면 5,001ms에 시간 초과로 끝나고 남은 프로세스가 없다.
    - 자동 테스트에는 넣지 않았다(CI에 fish가 없음).
  - 실제 사용자 로그인 셸(zsh)과 최소 환경(`PATH=/usr/bin:/bin`, 가짜 `ANTHROPIC_API_KEY`)으로 `AgentConnection`을 돌렸다.
    - `/opt/homebrew/bin/claude`를 찾았고 `cliCommand`는 `claude`, 업데이트 명령은 `brew upgrade --cask claude-code@latest`다.
    - 2.1.303, `claude.ai` 로그인으로 셋째 단계까지 1초 안팎에 통과했다.
    - 자식 환경에 `ANTHROPIC_API_KEY`가 없다.
- `claude auth status`(2.1.303)
  - 출력은 JSON이 기본이다(`--json` 기본, `--text`도 있음).
  - 미로그인(빈 `CLAUDE_CONFIG_DIR`)
    - 출력은 `{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty", ...}`이고 종료 코드는 1이다.
    - `--text`는 `Not logged in. Run claude auth login to authenticate.`를 찍고 종료 코드 1이다.
  - 로그인: `loggedIn: true`, `authMethod: "claude.ai"`, 종료 코드 0. 그 밖의 필드(이메일, 조직)는 앱이 읽지도 남기지도 않는다.
  - `apiKeyHelper`만 설정한 경우
    - 출력은 `loggedIn: true`, `authMethod: "api_key_helper"`, `apiKeySource: "apiKeyHelper"`이고 종료 코드는 0이다.
    - 같은 설정에서 `claude --restricted auth status`는 `loggedIn: false`, 종료 코드 1이다. 실행 계약의 `--restricted`가 apiKeyHelper를 무시하는 것과 같다.
  - `ANTHROPIC_API_KEY`가 있으면 `authMethod: "api_key"`로 로그인된 것으로 나온다. 앱은 이 변수를 넘기지 않으므로 판정에 쓰이지 않는다.
  - 위 두 경우(미로그인, apiKeyHelper)를 실제 CLI와 `AgentConnection`으로 돌려 각각 "로그인 필요"와 "지원하지 않는 방식"이 나오는 것을 확인했다.
- 화면의 명령
  - `claude auth login`: `claude auth --help`에 `login`이 있다.
  - `claude update`: `claude update|upgrade`가 있다.
    - Homebrew cask 설치본에서는 "Claude is managed by Homebrew"라며 `brew upgrade` 명령으로 넘긴다(바이너리 문자열 확인).
    - 그래서 실제 경로가 `Caskroom/<cask>/<버전>/claude`면 `brew upgrade --cask <cask>`를 보인다. `brew info --cask claude-code@latest`와 `brew upgrade --cask`가 있는 것을 확인했다.
  - 설치 명령: `curl -fsSL https://claude.ai/install.sh | bash`(macOS), `irm https://claude.ai/install.ps1 | iex`(Windows). 두 주소 모두 200을 준다(HEAD 확인, 실행하지 않음).
  - 이름만 쳐서 같은 CLI가 실행되지 않으면 명령 앞에 따옴표로 감싼 절대 경로를 쓴다. macOS는 `'/path/claude' auth login`, PowerShell은 `& 'C:\...\claude.exe' auth login`이다.
- 최소 버전: 배포된 `@anthropic-ai/claude-code-darwin-arm64` 바이너리에서 필수 플래그 문자열을 비교했다.
  - `--restricted`는 2.1.248부터 있다. 2.1.247에는 없다.
  - `--permission-prompts`는 2.1.259부터 있다. 2.1.248·2.1.250·2.1.251·2.1.257·2.1.258에는 없고, 2.1.259·2.1.260·2.1.265·2.1.280·2.1.303에는 있다.
  - 나머지 필수 플래그는 2.1.247에도 모두 있다.
  - 그래서 `MIN_CLAUDE_VERSION`은 2.1.259다.

**스펙과 다르거나 스펙에 없던 결정** (검토 대상)

- 최소 버전: 스펙의 예 "`--restricted`는 2.1.248 이상"은 맞다. 다만 필수 플래그 전체로는 2.1.259다(위 실측).
- 로그인 확인 명령: 스펙은 `claude auth status`라고만 적었다.
  - 구현은 `claude --restricted auth status`로 판정한다. 앱 실행은 `--restricted`라 apiKeyHelper가 무시되는데, `auth status`만 보면 apiKeyHelper 사용자를 로그인된 것으로 잘못 통과시킨다.
  - apiKeyHelper 안내를 가리려고 미로그인일 때만 `--restricted` 없이 한 번 더 묻는다.
- 로그인 셸을 읽지 못할 때(5초 초과, 셸 실패, 표지 없음): 앱이 받은 PATH를 쓰고 찾은 CLI 폴더를 그 앞에 붙인다. npm 설치본이 옆의 `node`를 찾게 하려는 것이다. "자세히"의 PATH 줄에 "로그인 셸에서 읽지 못함"을 보인다.
- Windows 알려진 설치 위치에 npm 전역 폴더(`%APPDATA%\npm`)를 더했다.
- 업데이트 명령: Homebrew cask 설치본은 `claude update` 대신 `brew upgrade --cask <cask>`다.
- 직접 지정한 파일을 실행할 수 없거나 데스크톱 앱이면 "실행할 수 없음"으로 찾기에서 멈춘다. 저장하지 않는다.
- 셋째 단계까지 통과한 상태의 문구: "찾기·버전·로그인을 확인했습니다. 작동 확인은 다음 단계입니다." 28에서 "✓ Claude Code 연결됨"으로 바뀐다. 용어집의 "에이전트 연결"이 작동 확인을 마친 상태라서, 이 티켓에서는 "연결됨"을 쓰지 않는다.
- 실행 파일 검사(`isExecutableFile`)는 `AgentConnection` 옵션으로 바꿔 끼울 수 있다.
  - macOS에서 Windows 경로(대소문자 무시, `WindowsApps`)를 흉내 내는 테스트에만 쓴다. 나머지 테스트는 임시 폴더의 실제 파일로 검사한다.
  - 스펙의 "별도 파일 시스템 포트는 두지 않는다"와 어긋나는 예외라 적어 둔다.

**검증**

- 자동 검사: 루트에서 캐시 없이 `pnpm turbo run lint typecheck test --force`가 통과했다(Vitest 154개). `pnpm build`도 통과했다.
  - 가짜 프로세스 실행기와 메모리 설정 저장소, 임시 홈의 실행 파일로 각 단계를 검사했다.
    - 찾기
      - 로그인 셸 `command -v`
      - 별칭이면 PATH 검색
      - 셸 시간 초과면 알려진 위치와 PATH 앞붙임
      - 못 찾음과 찾아본 곳
      - 저장한 경로 재사용(셸 한 번)
      - 사라진 경로 다시 찾기
      - 다시 찾기
      - 확인 중 다시 찾기의 앞 결과 버리기
      - 직접 지정 성공·실패
      - Windows PATH와 데스크톱 앱 제외
      - Windows 데스크톱 앱 직접 지정 거부
    - 버전
      - 2.1.258 업데이트 필요
      - 2.1.259 통과
      - Homebrew cask 업데이트 명령
      - 버전 명령 실패와 오류 원문
    - 로그인
      - 통과와 자식 환경(API 키 변수 없음, 로그인 셸 PATH, `--restricted`, 홈 작업 폴더)
      - 미로그인
      - apiKeyHelper
      - 출력을 읽지 못함
  - 실제 실행기는 출력, 종료 코드, 환경 격리, 띄우지 못함, 시간 초과와 프로세스 그룹 정리를 검사했다. zsh·bash 로그인 셸 테스트도 있다.
  - 실패 카드 명령은 설치(OS별), 업데이트(설치 방법별), 로그인(이름·절대 경로), 명령 없는 실패를 검사했다. IPC 명령 파싱도 검사했다.
- 화면: `AgentSection`을 가짜 상태 다섯 개로 정적 페이지에 그려 headless Chrome으로 찍었다(작업 폴더 밖). 상태는 진행 중, 셋째 단계까지 통과, 못 찾음, 미로그인, 버전 읽기 실패다.
  - 마디 색과 점선, 끊긴 마디와 원인, 카드 네 장(터미널 열기, 명령과 복사, 다음 행동 그림, 다시 확인)이 프로토타입 B와 같은 배치로 나왔다.
  - 넷째 마디 "작동 확인"은 회색 점선으로 남는다.

**사용자 확인이 필요한 것**(실제 화면 조작, 다른 OS)

- 실행한 Stardraft Dev 설정 창에서 에이전트 칸을 열었을 때 자동 확인과 연결선 진행
- [직접 지정…]의 OS 파일 선택 창
- [명령 복사] 뒤 클립보드 내용
- [다시 찾기]

  이 넷은 클릭이 필요해 직접 확인하지 못했다. IPC·core 경로는 위 자동 검사와 실측으로 확인했다.
- Windows: 앱이 받은 PATH로 찾기, `WindowsApps\Claude.exe` 제외, `.cmd` 래퍼 실행, `taskkill` 트리 종료, PowerShell 명령 모양. 실기에서 확인하지 못했다(60의 Windows 점검 목록과 함께).

**뒤 티켓에 넘기는 것**

- 28
  - 넷째 단계 "작동 확인"을 `AgentConnection`의 `awaiting-run-check` 뒤에 붙인다.
  - 자식 프로세스 환경은 `AgentConnection.processEnv()`, CLI 경로는 `state().details.cliPath`를 쓴다.
  - "✓ Claude Code 연결됨"과 전역 문제(CLI 없음, 미로그인, 업데이트 필요)는 `progress.failure.step`/`reason`에서 고른다.
  - 화면의 넷째 마디와 상태 줄(`AgentSection`의 `StatusLine`)을 바꾼다.
- 51(Codex): `AgentConnection`은 지금 Claude Code 하나만 다룬다(`AGENT` 상수). 에이전트별로 둘 때 찾기·PATH 읽기(`cli-discovery.ts`)는 그대로 쓰고, 버전·로그인 해석(`claude-cli.ts`)은 에이전트마다 둔다.

