# 28: 작동 확인과 기본 에이전트·모델

**Spec:** [스펙](../spec.md) 6절 "Claude Code 실행 방식", "공통 실행 규칙", "에이전트와 모델 선택"

**What to build:** 에이전트 연결의 네 번째 단계 "작동 확인"이 돈다. 앱이 Claude Code를 실제 실행 계약의 필수 플래그 묶음으로 한 번 불러 최소 스키마 결과를 받으면 "✓ Claude Code 연결됨"이 된다. 그 아래에서 기본 에이전트와 모델을 고른다. CLI가 없거나 미로그인이거나 버전이 낮거나 작동 확인이 실패하면 전역 문제로 표시된다.

**Blocked by:** 27

**Status:** resolved

- [x] Claude Code 실행기 어댑터가 생긴다. 필수 플래그 묶음(스펙 6절)을 그대로 쓰고, 비밀 파일 deny 규칙은 `Read(//**/<패턴>)` 형식으로 기본 목록을 넣으며, 환경 변수는 앱이 구성하고 `ANTHROPIC_API_KEY`·`CODEX_API_KEY`를 넘기지 않는다.
- [x] 점검 실행은 로그인 확인과 최소 스키마 실행 한 번이다. 화면 이름은 "작동 확인"이고 "10초쯤 걸리고 사용량을 조금 씁니다"를 표시한다. `stream-json`의 마지막 `result` 메시지에서 `structured_output`을 꺼낸다.
- [x] 점검 실행은 앱 시작 시, 전역 실패가 의심될 때, CLI 버전이 바뀐 것을 알아챘을 때, 에이전트 칸을 열 때 돈다.
- [x] CLI 없음, 미로그인, CLI 업데이트 필요, 점검 실행 실패가 26의 전역 문제로 표시되고 버튼 [에이전트 확인]이 에이전트 칸을 연다. 원인이 해결되면 표시가 사라진다.
- [x] 연결된 에이전트가 하나면 자동으로 기본이 되고 고르는 칸이 보이지 않는다. 둘 이상이면 Claude Code를 미리 고른다(둘째 에이전트는 51).
- [x] 모델 선택 상자: 첫 항목 "기본 모델(에이전트가 정함)"이면 `--model`을 넘기지 않는다. Claude Code는 Fable, Opus, Sonnet 별칭을 앱에 넣어 두고, 별칭이 더 있는지 `--help`로 확인해 기록한다. 저장한 모델이 목록에서 사라지면 "(목록에 없음)"을 붙여 남긴다.
- [x] 가짜 프로세스 실행기와 가짜 stream-json 스트림으로 인수 묶음, 환경 변수, `structured_output` 추출, 실패 분류가 테스트된다.

## Comments

### 2026-10-20 구현과 검증 기록

**구조**

- core `src/core/agent/`
  - `claude-code-executor.ts`(`ClaudeCodeExecutor`): Claude Code 실행기 어댑터다. 실행기 포트(`Executor`)를 구현한다.
    - 인수는 스펙 6절의 필수 플래그 묶음 그대로다. 첫 저장소가 cwd이고, 나머지는 `--add-dir`를 하나씩 붙인다. `--model`은 모델을 골랐을 때만 넘기고, `--bare`는 쓰지 않는다.
    - 비밀 파일은 `--settings '{"permissions":{"deny":["Read(//**/<패턴>)", ...]}}'`(JSON 문자열)로 넣는다. 요청이 기본 목록을 빠뜨려도 기본 목록(`secret-patterns.ts`의 `DEFAULT_SECRET_PATTERNS`)을 늘 앞에 넣는다.
    - 지침은 실행마다 임시 폴더의 `instructions.md`에 써서 `--append-system-prompt-file`로 넘기고, 실행이 끝나면 지운다. 입력 문서는 stdin으로 넘긴다.
    - 자식 환경은 연결 확인이 구성한 것(`AgentConnection.processEnv()`)을 쓰고, `ANTHROPIC_API_KEY`·`CODEX_API_KEY`를 한 번 더 뺀다. 빼는 규칙은 `cli-discovery.ts`의 `withoutAgentApiKeys` 한 곳에 있다.
    - stream-json을 줄 단위로 읽어 `system/init`의 `claude_code_version`, assistant 이벤트의 `error`, 마지막 `result` 메시지를 모은다. 결과는 마지막 `result`의 `structured_output`이다.
  - 실패 분류(`ExecutorFailureReason`, 포트에 더함)
    - `cli-missing`: 띄우지 못함
    - `cli-error`: result 메시지 없이 끝남(모르는 플래그 등). 오류 원문은 표준 오류만 쓴다. 표준 출력의 stream-json에는 읽은 파일 내용이 들 수 있기 때문이다.
    - `not-logged-in`: assistant `error`가 `authentication_failed`
    - `overloaded`: `overloaded` 또는 `api_error_status` 529
    - `network`: `server_error`인데 HTTP 상태가 없음
    - `max-turns`: `error_max_turns`
    - `agent-error`: 그 밖(사용량 한도 등)
    - 구조 실패(`invalid-output`): `structured_output`이 없거나 `error_max_structured_output_retries`
    - 시간 초과는 `timed-out`, 중단은 `cancelled`다.
  - `check-run.ts`: 점검 실행(화면 이름 "작동 확인")의 고정 입력이다.
    - 스키마는 `{ok: boolean}`(모든 속성 `required`, `additionalProperties: false`)이다.
    - 지침과 입력은 "파일을 읽지 말고 ok에 true"다.
    - 제한 시간은 60초다.
  - `claude-cli.ts`: 실행 종류별 `--max-turns`(`check` 3, `selection`·`draft` 40)와 모델 별칭(Fable·Opus·Sonnet)을 더했다.
  - `agent-connection.ts`(`AgentConnection`)
    - 넷째 단계 "작동 확인"을 붙였다. 상태 `awaiting-run-check`는 `connected`로 바꿨다. 실패 이유 `{ step: 'run-check', reason: 'run-failed' }`를 더했다.
    - 실행기를 직접 만들어 `executor`로 내놓는다. 35부터의 선택·초안 실행은 이 실행기를 쓴다. 그래야 연결 확인이 찾은 CLI 경로와 환경으로 뜬다.
    - `isConnected()`는 마지막으로 끝난 확인이 네 단계를 모두 통과했는지다. 칸을 열 때마다 다시 확인하므로, 다시 확인하는 동안에도 실패하기 전까지는 연결로 본다.
    - 새 확인이 시작되면 앞 확인의 점검 실행을 중단 신호로 끊는다.
  - `agent-preferences.ts`(`AgentPreferences`): 기본 에이전트와 에이전트별 모델을 다룬다. `settings.json`의 `defaultAgent`·`agentModels`에 저장한다.
  - `process-runner.ts`·`node-process-runner.ts`
    - 표준 입력, 줄 단위 표준 출력(길이 상한 없음), 중단 신호를 더했다. 결과 `aborted`도 더했다.
    - 끝낼 때(시간 초과·중단)는 프로세스가 실제로 끝나기를 최대 2초 기다린다. 끝나면 프로세스 그룹에 한 번 더 신호를 보낸다. 셸이 자식을 띄우는 순간과 겹치면 막 생긴 자식이 그룹 신호를 놓치는 것을 테스트에서 실측해서다.
    - Windows `.cmd`·`.bat`(npm 래퍼)는 인수마다 따옴표로 감싸고, cmd 특수 문자를 cross-spawn처럼 두 번 막는다. 27까지는 고정 인수만 넘겨 이스케이프가 없었다. 실행 계약은 JSON과 경로를 넘기므로 필요하다.
- core `problems/global-problems.ts`: 원인 `agent`(이유 `cli-missing`·`not-logged-in`·`update-required`·`check-failed`)를 더했다. `CAUSE_ORDER`는 키 문제가 먼저다.
- shared
  - `global-problem-text.ts`: 제목은 "에이전트 확인 필요", 버튼은 [에이전트 확인]이고 에이전트 칸을 연다. 띠 문구는 다음과 같다.
    - CLI 없음: "Claude Code를 찾을 수 없습니다. 지워졌거나 위치가 바뀌었을 수 있습니다."
    - 미로그인: "Claude Code에 로그인되어 있지 않습니다. 로그아웃했거나 로그인이 만료됐을 수 있습니다."
    - 업데이트 필요: "Claude Code를 업데이트해야 합니다. 지금 버전은 Stardraft에 필요한 기능을 지원하지 않습니다."
    - 점검 실행 실패: "Claude Code 작동 확인에 실패했습니다. 초안을 만들 수 없어 멈췄습니다."
  - `ipc.ts`
    - 스냅숏에 `agentPreferences`를, 이벤트에 `agent-preferences-changed`를 더했다.
    - 명령은 `set-default-agent`와 `set-agent-model`(`model: null`은 기본 모델)을 더했다.
    - 목록에 없는 모델과 연결되지 않은 에이전트는 core가 받지 않는다. 단, 이미 저장한 목록에 없는 모델은 그대로 둘 수 있다.
- main: 앱을 시작하면 트레이를 띄운 뒤 `agentConnection.check()`를 돌린다. 점검 실행의 작업 폴더는 데이터 폴더 안의 빈 `agent-check` 폴더다.
- 화면(`AgentSection.tsx`, 프로토타입 B)
  - 넷째 마디 "작동 확인"을 쓴다. 진행 중에는 "작동 확인 중…"과 "10초쯤 걸리고 사용량을 조금 씁니다."를 보이고, 통과하면 "✓ Claude Code 연결됨"을 보인다. 실패하면 "작동 확인 실패" 마디와 한 줄 안내를 보이고, 원문은 "자세히"에 둔다.
  - 연결되면 카드 아래에 "Claude Code 모델" 선택 상자를 둔다. 첫 항목은 "기본 모델(에이전트가 정함)"이고 Fable·Opus·Sonnet이 뒤따른다. 목록에 없는 저장 모델은 "<이름> (목록에 없음)"으로 남긴다.
  - 기본 에이전트 칸(라디오)은 연결된 에이전트가 둘 이상일 때만 보인다.

**실측 기록** (이 PC: macOS, Claude Code 2.1.303 Homebrew cask)

- 미로그인(빈 `CLAUDE_CONFIG_DIR`)에서 필수 플래그 묶음으로 `claude -p`를 실행했다.
  - 종료 코드는 1이다.
  - assistant 이벤트는 `error: "authentication_failed"`, `is_api_error_message: true`, 본문 "Not logged in · Please run /login"이다.
  - `result`는 `subtype: "success"`, `is_error: true`, `terminal_reason: "api_error"`, `api_error_status: null`, `result: "Not logged in · Please run /login"`이다.
  - 모델 API는 부르지 않았다(`duration_ms` 45).
- 네트워크 오류는 로그인 상태에서 `ANTHROPIC_BASE_URL=http://127.0.0.1:9`(닫힌 로컬 포트, 외부 전송 없음)로 실행해 확인했다.
  - `system/api_retry` 이벤트가 10회 나왔다.
  - 171초 뒤 assistant `error: "server_error"`, `api_error_status: null`, "API Error: Connection refused … (ECONNREFUSED)"로 끝났고, 종료 코드는 1이다.
  - 그래서 상태 없는 `server_error`를 네트워크 오류로 본다. 점검 실행은 60초 제한에 먼저 걸려 "점검 실행 실패"가 된다.
- CLI 안의 오류 종류와 종료 이유 목록도 확인했다(바이너리 문자열).
  - assistant `error` 종류: `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `verification_required`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `unknown`, `max_output_tokens`, `cloud_credential_error`
  - `terminal_reason`: `max_turns`, `api_error`, `completed` 등
- 실제 작동 확인을 실제 `NodeProcessRunner`와 `AgentConnection`으로 두 번 돌렸다. 스크립트와 결과는 작업 폴더 밖 임시 폴더에 두었다.
  - 최소 환경(`PATH=/usr/bin:/bin:/usr/sbin:/sbin`, HOME, USER, SHELL, TMPDIR, LANG)에 가짜 `ANTHROPIC_API_KEY`를 넣었다.
  - 기본 모델: 네 단계를 4.9초에 통과했다. 작동 확인만 약 3.8초다.
  - `--model sonnet`(검토 전 구현에서 실측): 4.3초. 지금 작동 확인은 모델을 넘기지 않지만, 별칭이 실제로 통하는지 확인한 값이다.
  - 두 실행 모두 `num_turns` 2였다(StructuredOutput 도구 한 번). `--max-turns` 3 안이다.
  - init의 `apiKeySource`가 `none`이었다. 가짜 API 키는 넘어가지 않았고 구독 로그인으로 돌았다.
  - 지침 임시 폴더는 지워졌고, `agent-check` 폴더는 비어 있었다.
  - `~/.claude.json`의 projects와 `~/.claude/projects`에 점검 실행 폴더 항목이 생기지 않았다.
- 빌드한 앱(`Stardraft Dev`)을 잠깐 띄웠다. 시작 뒤 4.9초에 진단 로그 `agent.connected`(2.1.303, `claude.ai`)가 남은 것을 보고 앱을 끝냈다. 화면은 조작하지 않았다.
- 모델 별칭
  - `claude --help`(2.1.303)의 `--model` 설명은 "an alias for the latest model (e.g. 'fable', 'opus', or 'sonnet')"다. 예로 셋만 든다.
  - CLI 바이너리 안의 별칭 목록에는 `sonnet`, `opus`, `haiku`, `fable`, `best`, `sonnet[1m]`, `opus[1m]`, `fable[1m]`, `opusplan`이 있다. 계열 별칭 목록은 `sonnet`, `opus`, `haiku`, `fable`이다.
  - 앱에는 스펙대로 Fable·Opus·Sonnet만 넣었다. Haiku를 더할지는 사용자 결정 대상이다.

**스펙과 다르거나 스펙에 없던 결정** (검토 대상)

- 에이전트 전역 문제는 감지를 시작한 뒤(`settings.detectionStarted`)에만 띄운다.
  - 감지 전에는 대기열이 없다. 13절이 그 시점을 필수 설정 전 화면과 노란 점("설정 필요")에 맡긴다.
  - 첫 실행에 Claude Code가 없다고 "!"와 OS 알림이 뜨면 온보딩과 겹친다.
  - 감지 전 실패는 에이전트 칸의 연결선에만 보인다.
  - 26의 "키 확인 필요"는 감지 시작 여부와 관계없이 띄운다(저장된 키가 있을 때만). 두 원인의 조건이 다르다.
  - 이 빌드에는 `detectionStarted`를 켜는 곳이 아직 없다(31). 그래서 에이전트 전역 문제는 자동 테스트로만 확인했다.
- 작동 확인은 고른 모델을 넘기지 않고 기본 모델로 돈다.
  - 고른 모델 하나의 문제(사용량 한도 등)는 스펙의 전역 실패가 아니다.
  - 그 문제로 연결이 끊기면 모델 선택 상자도 사라져 앱 안에서 되돌릴 수 없다(코드 리뷰 지적).
  - 고른 모델의 문제는 선택·초안 실행의 실패로 드러난다.
- 작동 확인에서 `authentication_failed`가 나오면 "점검 실행 실패"가 아니라 로그인 단계의 "로그인 필요"로 멈춘다. `auth status`는 로컬 기록만 보므로 만료된 로그인을 통과시킬 수 있고, 이 경우 고치는 법이 로그인이라서다.
- 버전·로그인 상태를 읽지 못한 실패(`unreadable`)는 전역 문제 "점검 실행 실패"로 묶었다.
- "전역 실패가 의심될 때"와 "CLI 버전이 바뀐 것을 알아챘을 때"
  - 실행기의 실행(점검 실행 말고)이 `cli-missing`·`cli-error`·`not-logged-in`으로 끝나면 연결 확인을 처음부터 다시 돌린다.
  - 실행 stream-json의 `claude_code_version`이 작동 확인 때 버전과 다르면 연결 확인을 처음부터 다시 돌린다.
  - 버전은 실행이 끝난 뒤에 알아챈다. "실행 전에" 알아채는 것은 37의 몫이다.
- 점검 실행의 작업 폴더는 데이터 폴더 안의 빈 `agent-check`다. 매번 새 임시 폴더를 쓰지 않는 것은 사용자 CLI 설정에 프로젝트 항목이 쌓일 수 있어서다(실측으로는 생기지 않았다).
- `--max-turns`: 점검 실행은 3이다(실측 2턴). 선택·초안 실행은 비밀 파일 실측에서 쓴 40으로 두었고, 35·38에서 조정한다.
- 실행기 어댑터는 요청이 기본 비밀 파일 목록을 빠뜨려도 늘 넣는다. 포트 설명도 "추가 패턴만 넘겨도 된다"로 고쳤다.
- 표준 입력이 없는 프로세스도 표준 입력을 열었다가 바로 닫는다(전에는 열지 않음). 자식에게는 둘 다 EOF다.

**검증**

- 자동 검사: 루트에서 캐시 없이 `pnpm turbo run lint typecheck test --force`가 통과했다(Vitest 218개). `pnpm build`도 통과했다.
  - 실행기 어댑터(가짜 프로세스 실행기와 가짜 stream-json)
    - 필수 플래그 묶음 전체와 cwd·`--add-dir`
    - deny 규칙 형식과 기본 목록
    - `--model`
    - stdin과 지침 파일(실행 뒤 삭제)
    - 환경 변수(API 키 변수 제외)
    - 제한 시간·중단 신호 전달
    - `structured_output` 추출, CLI 버전 보고
    - 실패 분류: 구조 실패 둘, CLI 없음, 미로그인, 네트워크, 서버 오류, 과부하, 턴 상한, 사용량 한도, result 없음, 표준 출력을 오류 원문에 넣지 않음, 시간 초과, 취소
  - 연결 확인
    - 작동 확인 통과("연결됨"), 작동 확인의 환경과 cwd
    - 고른 모델을 넘기지 않음, 추가 패턴
    - 실패 원문, 로그인 만료, 60초 초과, 스키마 불일치
    - 전역 문제: CLI 없음 → 다시 찾아 연결되면 해제, 미로그인 둘, 업데이트 필요, 점검 실행 실패, 감지 전에는 띄우지 않음
    - 다시 확인 계기: 미로그인 실행, result 없는 실행, 버전 변화. 같은 버전 성공과 과부하에서는 다시 확인하지 않음
    - 다시 확인 중 연결 유지
    - 실행기가 연결 확인의 CLI와 환경으로 뜸
  - 기본 에이전트와 모델
    - 하나면 자동
    - 둘이면 Claude Code를 미리 고르고 저장
    - 끊기면 남은 에이전트
    - 연결 안 된 에이전트 거부
    - 별칭 셋, 저장과 기본 모델로 지우기, "(목록에 없음)", 목록 밖 모델 거부, 다른 설정 보존
  - 실제 실행기
    - stdin과 줄 단위 출력(`\r` 제거, 64KB 넘는 출력)
    - 중단 시 프로세스 그룹 정리(세 번 반복해 남은 프로세스 없음)
    - 이미 중단된 신호
    - Windows 래퍼 명령줄(손으로 계산한 기대값)
  - 전역 문제 문구와 IPC 명령 검사
- 화면: `AgentSection`을 가짜 상태 다섯 개로 정적 페이지에 그려 headless Chrome으로 찍었다(작업 폴더 밖). 상태는 작동 확인 중, 연결됨(기본 모델), 목록에 없는 모델, 둘 연결(51 대비), 작동 확인 실패다. 넷째 마디, 상태 줄, 모델 상자, 라디오 배치를 확인했다.

**사용자 확인이 필요한 것**(실제 화면 조작, 다른 OS)

- 실행한 Stardraft Dev의 설정 "에이전트" 칸에서 네 마디가 차례로 진행되고 "✓ Claude Code 연결됨"이 보이는지, 모델 상자를 바꾸면 저장되는지(다시 열어 유지되는지). 클릭이 필요해 직접 확인하지 못했다. core·IPC 경로는 위 자동 검사와 실제 CLI 실측으로 확인했다.
- 에이전트 전역 문제의 띠·트레이 "!"·메뉴 항목·OS 알림과 [에이전트 확인]이 에이전트 칸을 여는지. 감지 시작(31) 뒤에만 뜨므로 이 빌드에서는 화면에서 볼 수 없다. 띠와 메뉴는 26의 공통 경로를 그대로 쓴다.
- Windows: npm 래퍼(`claude.cmd`)로 실행 계약 인수(JSON, 공백·한글 경로)가 그대로 전달되는지, 중단 시 `taskkill` 트리 종료. 60의 Windows 점검 목록과 함께 확인한다.

**뒤 티켓에 넘기는 것**

- 31
  - [감지 시작]이 `detectionStarted`를 켜면 에이전트 전역 문제가 뜨기 시작한다.
  - "에이전트 연결" 판정은 `agentConnection.isConnected()`를 쓴다.
  - 시작 시 확인(`main/index.ts`)은 이미 돈다.
- 35
  - 실행은 `agentConnection.executor`로 띄운다. 기본 에이전트와 모델은 `agentPreferences.state()`의 `defaultAgent`·`models[agent].selected`다.
  - 진행 단계 변환(`onProgress`)은 아직 부르지 않는다. stream-json reader(`ClaudeStreamReader`)에 도구 사용 이벤트를 더한다.
  - 기본 지침 텍스트와 `--max-turns` 조정, 실행 기록의 CLI 버전(실행 보고의 `cliVersion`)과 비용(`total_cost_usd`)도 35의 일이다.
- 37
  - 실행 전 버전 확인(`claude --version`을 작동 확인 때 버전과 비교)을 더한다.
  - 대기열은 전역 문제 `agent`가 있는 동안 멈추고, 해제되면 재개한다.
  - 일시적 실패 재시도는 실패 분류의 `overloaded`·`network`와 `invalid-output`을 쓴다.
- 51
  - `AgentConnection`은 Claude Code 하나만 다룬다. Codex를 더하면 `connectedAgents`가 둘이 되어 기본 에이전트 칸이 보인다.
  - Codex 모델 목록은 `agent-preferences.ts`의 `listedModels`에 더한다.
  - 전역 문제 문구는 지금 "Claude Code"로 고정이므로 에이전트 이름을 담게 늘린다.
- 60: Windows npm 래퍼 인수 전달과 트리 종료 실기 확인.
- 용어집 빈틈: "작동 확인"(점검 실행의 화면 이름)과 "기본 에이전트"가 `GLOSSARY.md`에 없다. `/domain-modeling`에서 다룰 후보다.
