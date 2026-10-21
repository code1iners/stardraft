# 51: Codex 실행기(macOS)

**Spec:** [스펙](../spec.md) 6절 "실행기 허용 기준", "Codex 실행 방식", "에이전트와 모델 선택"의 Codex 모델

**What to build:** macOS에서 설정 "에이전트" 칸에 Codex도 연결 후보로 나타나 찾기·버전·로그인·작동 확인을 거쳐 "✓ Codex 연결됨"이 된다. 기본 에이전트로 고르면 선택 실행과 초안 실행이 Codex 권한 프로필 묶음으로 돈다. Windows에서는 후보에 나타나지 않는다.

**Blocked by:** 28, 37, 38

**Status:** resolved

- [x] 필수 플래그 묶음(스펙 6절 "Codex 실행 방식")을 그대로 쓴다. `--sandbox` 없이 인라인 권한 프로필, 시스템 경로 `:minimal`과 codex 실제 경로만 `read`, `/tmp` deny, `workspace_roots`에 둘째 루트부터, 비밀 파일 패턴과 `.git` deny, `features.apps=false` 등 기능 끄기, `--skip-git-repo-check`는 선택 실행에만. (작동 확인과 첫 저장소가 git 저장소가 아닌 초안 실행에도 붙인다. 이유는 Comments)
- [x] 저장한 경로가 심볼릭 링크면 실행 때마다 실제 경로로 풀어 띄우고 그 파일을 프로필에서 읽기 허용한다. npm 설치본(JS 래퍼)에서도 동작하는지 확인해 기록한다.
- [x] 지침은 `-c developer_instructions`로 넣고 TOML 이스케이프를 한다. 입력은 stdin, 결과는 `--json` JSONL에서 읽고 진행 단계로 바꾼다. 스키마는 모든 속성이 `required`인 형태(선택 항목은 `null` 허용).
- [x] 로그인 확인은 `codex login status`, 모델 목록은 `codex debug models`의 `visibility`가 `list`인 항목이며 실패하면 "기본 모델"만. 출력 형식이 버전에 따라 유지되는지 확인해 기록한다. 미로그인 때의 실제 출력과 종료 코드를 기록한다.
- [x] 사용자의 기본 `CODEX_HOME`을 쓴다(미결 항목). 환경 변수 규칙(API 키 변수 제외)은 같다.
- [x] Windows에서는 후보에서 빠진다. 가짜 프로세스 실행기로 인수 묶음, 경로 풀기, JSONL 파싱이 테스트된다.

## Comments

### 2026-10-22 구현과 검증 기록

**구조**

- 에이전트마다 다른 것은 `core/agent/agent-cli.ts`의 `AGENT_CLIS`에 모았다. 명령 이름, 최소 버전, 업데이트 명령, 로그인 확인, 모델 목록, 실행기다.
  - `AgentConnection`은 `agent` 옵션 하나로 Claude Code와 Codex를 같은 네 단계(찾기, 버전, 로그인, 작동 확인)로 확인한다.
  - 화면 쪽 정보(이름, 아이콘 글자, 로그인·설치 명령)는 렌더러가 core를 import할 수 없어서 `shared/agent-info.ts`의 `AGENT_INFO`에 따로 둔다.
- `AgentConnections`(`core/agent/agent-connections.ts`)가 이 OS의 후보마다 연결 확인을 둔다. 후보는 `agentCandidates`가 정하고, macOS는 Claude Code와 Codex, Windows는 Claude Code만이다.
  - main은 앱 시작과 칸을 열 때 `checkAll`을 부른다. 기본 에이전트·모델 선택과 초안 대기열은 이 묶음에서 연결과 모델 목록을 읽는다.
- `CodexExecutor`(`core/agent/codex-executor.ts`)
  - 실행마다 저장한 경로의 링크를 풀어 실제 경로로 띄우고, 그 파일만 프로필에서 `read`로 둔다. 링크를 풀 수 없으면 띄우지 않고 CLI 없음으로 끝난다.
  - 스키마는 실행마다 임시 파일로 써서 `--output-schema`로 넘기고 끝나면 지운다.
  - 지침은 TOML 기본 문자열로 이스케이프해 `-c developer_instructions`로 넣는다. 따옴표, 역슬래시, 줄바꿈, 탭, 제어 문자를 이스케이프한다.
  - 입력은 표준 입력(`-`)으로 넘긴다.
  - 추가 비밀 파일 패턴은 앞의 `/`·`**/`와 끝의 `/`를 떼고 `"**/<패턴>"="deny"`로 넣는다. 앱의 근거 검사(`matchesSecretPattern`)와 같은 해석이다.
- JSONL 읽기
  - `item.started`의 `command_execution`을 진행 단계로 바꾼다(`codex-commands.ts`). Codex는 명령을 `/bin/zsh -lc '…'`로 감싸 알린다. 감싸기를 벗긴 뒤 `cd`가 아닌 첫 명령을 본다.
    - `cat`·`sed -n`·`head`·`nl` 등은 "파일 읽는 중: <파일 이름>"이다.
    - `rg`·`grep`, `find -name`, `rg --files -g`는 "검색 중: <검색어나 패턴>"이다.
    - `ls`, `rg --files`는 "파일 목록 보는 중"이다.
    - 그 밖은 "명령 실행 중: <명령>"이다.
  - 읽은 파일 수는 읽기 명령이 종료 코드 0으로 끝났을 때 센다.
  - 결과는 마지막 `agent_message`의 JSON이다. 토큰 수는 `turn.completed`에서 읽고, 비용은 알려 주지 않는다.
  - 실패는 `turn.failed` 문장으로 가린다. 401은 미로그인, 과부하와 연결 실패는 일시적 실패, 사용량 한도 등은 에이전트 오류다.
  - 이벤트 없이 오류로 끝나면 결과 메시지 없는 실패(`cli-error`)로 보고 표준 오류만 오류 원문에 남긴다. JSONL에는 명령이 읽은 파일 내용이 들어 있기 때문이다.
  - CLI 버전은 이벤트에 없다. 그래서 실행 직전 확인이 읽은 버전을 실행 기록에 쓴다.
- 출력 스키마: 초안·선택·점검 실행 스키마는 이미 모든 속성이 `required`이다. 지금 선택 항목은 없으므로 `null` 허용으로 바꾼 곳은 없다.
- 모델: 연결을 마칠 때 `codex debug models`에서 `visibility`가 `list`인 모델을 `priority` 순서로 읽는다. 실패하거나 모양이 다르면 빈 목록이고 "기본 모델"만 보인다.
  - 출력이 수백 KB 한 줄이라 프로세스 실행기의 64KB 상한을 피해 줄 단위로 받는다.
- `CODEX_HOME`: 앱은 이 변수를 따로 정하지 않는다. 사용자 환경에 있으면 그대로 넘기고, 없으면 CLI 기본값(`~/.codex`)이다. 환경 변수에서 `ANTHROPIC_API_KEY`·`CODEX_API_KEY`를 빼는 규칙은 Claude Code와 같다.
- 화면
  - 에이전트 칸은 후보마다 연결 카드를 둔다(프로토타입 B와 같은 모양).
  - Codex 카드는 마지막으로 끝난 찾기 단계가 CLI를 찾았을 때만 보인다(`cliFound`). 다시 확인하는 동안에는 앞 확인의 값을 둬서, 칸을 열 때마다 카드가 깜빡이지 않는다.
  - 둘 다 연결되면 기본 에이전트를 고르는 칸과 Codex 모델 선택 상자가 나온다.

**실측 기록**(이 PC의 Homebrew cask 0.163.0, npm으로 임시 폴더에 받은 0.162.1·0.163.0, 모의 Responses 서버. 사용량 없음)

- 미로그인(자격 증명이 없는 빈 `CODEX_HOME`)
  - `codex login status`는 표준 오류로 `Not logged in`을 내고 종료 코드 1이다. 로그인되어 있으면 표준 오류로 `Logged in using ChatGPT`를 내고 0이다. 0.162.1도 같다.
  - `codex exec --json`(필수 묶음 그대로)은 종료 코드 1이다.
    - JSONL에 `error` 이벤트 `Reconnecting... n/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: wss://api.openai.com/v1/responses …)`가 먼저 나온다. HTTPS로 넘어가 같은 시도를 되풀이한다.
    - 마지막은 `turn.failed`의 `{"error":{"message":"unexpected status 401 Unauthorized: …"}}`이다.
    - 이 문장으로 미로그인을 가린다.
- 실제 경로
  - 링크 경로(`/opt/homebrew/bin/codex`)로 띄우면 표준 출력 없이 종료 코드 1로 끝나고, 표준 오류는 `Failed to create session: failed to load AGENTS.md instructions … sandbox-exec: execvp() of '/opt/homebrew/bin/codex' failed: Operation not permitted`다. 실제 경로로 띄우면 세션이 만들어진다.
  - 0.163.0에서는 실제 경로로 띄우기만 하면 그 파일을 `read`로 두지 않아도 세션이 만들어졌다. 스펙대로 실제 경로를 `read`로 둔다.
- npm 설치본
  - `bin/codex`는 `lib/node_modules/@openai/codex/bin/codex.js`(JS 래퍼)를 가리키는 링크다. 래퍼는 `@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`를 절대 경로로 띄운다.
  - 링크를 풀어 래퍼(`codex.js`)를 띄우고 그 파일을 `read`로 두면 세션이 만들어졌다. `CODEX_HOME`에 AGENTS.md가 있어 자기 재실행이 일어나는 조건이었고, 요청에 AGENTS.md가 실린 것을 확인했다. 비밀 파일도 막혔다.
  - 그래서 npm 설치본을 따로 처리하지 않는다. 래퍼는 `#!/usr/bin/env node`이므로 자식 PATH에 node가 있어야 한다. 로그인 셸 PATH를 쓰고, 셸을 못 읽으면 CLI 폴더를 PATH 앞에 붙이는 기존 처리로 충분하다.
  - 업데이트 명령은 래퍼가 안내하는 `npm install -g @openai/codex@latest`, Homebrew cask는 `brew upgrade --cask codex`, 그 밖(독립 설치)은 `codex update`다.
  - 독립 설치 스크립트(`curl -fsSL https://chatgpt.com/codex/install.sh | sh`)는 실행하지 않고 읽기만 했다. `~/.local/bin/codex` → `~/.codex/packages/standalone/current/bin/codex` 링크 두 단계여서 실제 경로 풀기로 처리된다.
- `codex debug models`
  - 0.162.1과 0.163.0 모두 `{"models":[…]}` JSON 한 줄을 낸다. 항목의 필드 구성이 같다(`--bundled` 비교). `slug`, `display_name`, `visibility`(`list`/`hide`), `priority`가 있다.
  - 로그인 상태에서는 약 560KB, 미로그인이면 내장 목록(약 660KB)을 종료 코드 0으로 낸다.
- 필수 묶음은 0.162.1에서도 그대로 받아들여졌다. JSONL 모양도 같았다. 그래서 최소 버전은 실측한 가장 낮은 0.162.1로 두었다.
- 실제 CLI + 모의 모델로 앱 코드 자체를 돌린 결과(검증용 임시 테스트를 돌린 뒤 지웠다)
  - 초안 실행: 두 루트를 모두 읽었고 `.env`, `secrets/b.txt`, 루트 밖 파일, 쓰기는 막혔다. 막힌 명령은 JSONL에 항목이 나오지 않는다. 지침의 이스케이프가 원문대로 전달됐고, 진행 단계와 읽은 파일 수가 맞았다.
  - 선택 실행: git 저장소가 아닌 작업 폴더 둘에서 돌았다.
  - 취소: codex 프로세스 트리가 끝났다.
  - 연결 확인 전체: 이 PC의 `~/.codex`로 찾기·버전·로그인을 거쳤다. 작동 확인은 모의 모델로 돌렸고 "연결됨"과 모델 목록 7개를 얻었다.

**스펙과 다르게 한 것과 해석**(스펙 반영 여부는 따로 정할 일)

- `--skip-git-repo-check`
  - 스펙 6절은 "선택 실행에만"이다. 구현은 작동 확인에도 붙이고, 첫 저장소가 git 저장소 안이 아닌 초안 실행에도 붙인다.
  - 작동 확인은 앱 전용 빈 폴더(git 아님)에서 돈다. 플래그가 없으면 `Not inside a trusted directory and --skip-git-repo-check was not specified.`로 종료 코드 1이 된다(실측).
  - 저장소 매핑은 git이 아닌 코드 폴더도 받는다(30 티켓). 그런 폴더가 첫 저장소인 초안 실행은 플래그 없이는 같은 오류로 실패한다.
  - 이 플래그는 권한 프로필(읽기 범위, 비밀 파일, 쓰기 차단)을 바꾸지 않는다.
- 에이전트 전역 문제는 대기열이 쓸 에이전트가 하나도 없을 때만 띄운다.
  - 사용자가 Codex를 기본으로 골랐어도, Codex가 끊기고 Claude Code가 연결되어 있으면 기본 에이전트가 Claude Code로 바뀐다(28 티켓의 기존 규칙). 그래서 대기열은 멈추지 않고 전역 문제도 띄우지 않는다.
  - 띄울 때는 설치된 에이전트의 문제를 CLI 없음보다 앞세우고, 그 가운데 저장한 기본 에이전트의 문제를 먼저 보인다. 모두 CLI 없음이면 늘 칸에 보이는 Claude Code의 문제를 보인다.
  - 고른 에이전트가 끊겨 다른 에이전트로 바뀐 것을 따로 알리지는 않는다. 알릴지는 정할 일이다.
- Codex 카드는 설치를 찾았을 때만 보인다(프로토타입의 "macOS에서 설치했을 때만 후보").
  - 그래서 Codex를 찾지 못하면 "직접 지정"으로 고를 길이 없다. 13절의 "설치를 못 찾았으면 찾아본 곳과 직접 지정을 보인다"는 늘 보이는 Claude Code 카드에만 적용된다.
- `codex login status`가 `Logged in using an API key`면 연결로 받고 로그인 방식("API 키")을 자세히에 남긴다.
  - 이 경우 실행은 API 요금으로 돈다. 스펙의 API 키 제외 규칙은 환경 변수에 대한 것이다. Claude Code의 `apiKeyHelper` 거부는 `--restricted`가 그 방식을 무시하기 때문이다. 그래서 막지 않았다. 막을지는 정할 일이다.
- 진행 단계에 "파일 목록 보는 중"과 "명령 실행 중: …"을 더했다. Codex는 Claude Code의 Glob 같은 도구 없이 셸 명령으로 둘러보기 때문이다.

**검증**

- `pnpm lint`, `pnpm typecheck`, `pnpm test`(53개 파일, 977개 테스트), `pnpm build` 통과.
- 가짜 프로세스 실행기로 확인한 것
  - 인수 묶음, 링크 풀기와 버전이 바뀔 때 다시 풀기, JSONL 읽기, 실패 분류(`codex-executor.test.ts`)
  - Codex 연결 확인의 네 단계, 모델 목록, 업데이트 명령(`agent-connection.test.ts`)
  - 후보와 Windows 제외, 전역 문제(`agent-connections.test.ts`)
  - Codex를 기본으로 고른 선택 실행·초안 실행과 실행 기록(`draft-queue.test.ts` "대기열: Codex 실행기")
  - 모델 선택(`agent-preferences.test.ts`), 명령 검사와 문구(`ipc.test.ts`, `agent-fix-command.test.ts`, `global-problem-text.test.ts`)
  - 화면 정적 렌더링(`agent-section.test.tsx`)
- 아직 확인하지 않은 것(사용자만 확인할 수 있음)
  - 실제 앱 창에서 에이전트 칸을 열었을 때 Codex 카드가 연결선 네 마디를 거쳐 "✓ Codex 연결됨"이 되는지
  - 기본 에이전트를 Codex로 고른 뒤 실제 멘션으로 초안이 만들어지는지(실제 모델 사용량이 든다)
