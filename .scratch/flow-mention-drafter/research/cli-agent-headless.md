# CLI 에이전트 비대화형 실행 능력 조사

- 조사일: 2026-10-14
- 대상 버전
  - Claude Code: 이 PC에 2.1.296 설치. 같은 날 기준 최신은 2.1.299([CHANGELOG](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md)).
  - Codex CLI: 이 PC에 0.162.1 설치. 0.162.1은 2026-10-09에 릴리스된 최신 안정판이다([releases](https://github.com/openai/codex/releases)).
  - Gemini CLI: 설치하지 않았다. 최신은 v0.64.0(2026-10-13 릴리스, [releases](https://github.com/google-gemini/gemini-cli/releases)).
- 조사 방법
  - 공식 문서, 공식 저장소 소스, 로컬 `claude --help`·`codex --help`·`codex exec --help` 출력을 읽었다.
  - 실제 프롬프트 실행, 로그인, `auth status`·`login status` 실행, 설정 변경, 설치는 하지 않았다.
  - 따라서 이 문서의 종료 코드와 출력 형식은 **문서와 소스에서 확인한 값이고 실측값이 아니다**. 실측이 필요한 항목은 마지막 절에 모았다.
- 출처 메모
  - OpenAI Codex 문서는 `developers.openai.com/codex/...` 주소가 `learn.chatgpt.com/docs/...`로 308 리다이렉트된다(2026-10-14 확인). 아래 링크는 리다이렉트 후 주소다.
  - Codex 소스 링크는 `openai/codex` main 브랜치의 커밋 `2f05c0a`에 고정했다.
  - 공식 문서에는 페이지별 갱신일이 없다. 그래서 날짜 대신 문서에 적힌 버전 조건(예: "v2.1.259 이상")을 함께 적는다.

## 한눈에 보기

| 항목 | Claude Code | Codex CLI | Gemini CLI |
| :- | :- | :- | :- |
| 비대화형 호출 | `claude -p` | `codex exec` | `gemini -p` |
| 구조화 출력 | `--output-format json` | `--json`(JSONL 이벤트), `-o <파일>` | `--output-format json` |
| 스키마 강제 | `--json-schema` | `--output-schema <파일>` | 없음 |
| 읽기 전용 수단 | 도구 제한 + `dontAsk` + `--restricted` | 기본 `read-only` 샌드박스, 승인 `never` | `--approval-mode plan`(주의 필요) |
| 비밀 파일 제외 | `Read(...)` deny 규칙 | 권한 프로필 `deny`(베타) | `.geminiignore`(지원 도구만) |
| 디렉터리 지정 | 프로세스 cwd + `--add-dir` | `-C <DIR>` | cwd + `--include-directories` |
| Windows 네이티브 | 지원. 샌드박스는 WSL2만 | 지원. Windows 전용 샌드박스 | Windows 11 24H2+ 권장 |
| 로그인 사전 확인 | `claude auth status`(0/1) | `codex login status`(0/1) | 전용 명령 확인 못 함 |

## 1. 호출 방법과 출력 형식

### Claude Code

- **호출**
  - `claude -p "<프롬프트>"`로 비대화형 실행한다. stdin 파이프도 받는다. ([headless](https://code.claude.com/docs/en/headless))
  - 파이프로 넣는 stdin은 10MB가 상한이다. 넘으면 오류와 함께 0이 아닌 코드로 끝난다. ([headless](https://code.claude.com/docs/en/headless))
  - `-p`는 작업 공간 신뢰 대화상자를 띄우지 않는다. 검증에 실패한 설정 파일은 이 모드에서 **조용히 무시**된다. (로컬 `claude --help`, 2.1.296)
- **출력 형식**: `--output-format text|json|stream-json` ([headless](https://code.claude.com/docs/en/headless))
  - `json`은 결과 텍스트(`result`), 세션 ID, 메타데이터, `total_cost_usd`를 담은 단일 객체다.
  - `stream-json`은 줄 단위 JSON 이벤트이고, 마지막 줄이 `result` 메시지다.
- **스키마 강제**
  - `--output-format json --json-schema '<JSON Schema>'`를 주면 검증된 결과가 `structured_output` 필드에 담긴다. ([headless](https://code.claude.com/docs/en/headless), [cli-reference](https://code.claude.com/docs/en/cli-reference))
  - 스키마가 잘못되면 `Error: --json-schema is not a valid JSON Schema`를 내고 코드 1로 끝난다. v2.1.205 전에는 오류 없이 비구조화 출력을 냈다. `format` 키워드는 주석으로만 취급한다. ([errors](https://code.claude.com/docs/en/errors))
- **결과 메시지의 판별 필드** ([agent-sdk/typescript](https://code.claude.com/docs/en/agent-sdk/typescript), [structured-outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs))
  - `subtype`: `success`, `error_max_turns`, `error_during_execution`, `error_max_budget_usd`, `error_max_structured_output_retries`
  - 그 밖에 `is_error`, `permission_denials`, `session_id`, `total_cost_usd`가 있다.
  - `subtype`이 `success`인데 `structured_output`이 비어 있을 수 있다. 문서는 이 경우도 실패로 다루라고 한다.
- **종료 코드** ([headless](https://code.claude.com/docs/en/headless))
  - 성공하면 0, 실패하면 0이 아닌 코드다.
  - 잘못된 플래그는 실행 전에 stderr로 보고한다.
  - 실행 중 실패(예: 인증 누락)는 stdout의 결과로 출력한다.
- **`--bare` 모드** ([headless](https://code.claude.com/docs/en/headless), [authentication](https://code.claude.com/docs/en/authentication))
  - 훅, 스킬, 플러그인, MCP, CLAUDE.md 자동 탐색을 건너뛰어 빠르고 재현성이 높다.
  - 대신 OAuth와 키체인을 읽지 않는다. 그래서 `ANTHROPIC_API_KEY`나 `apiKeyHelper`가 있어야 하고, **구독 로그인만 쓰는 사용자는 쓸 수 없다**. `CLAUDE_CODE_OAUTH_TOKEN`도 읽지 않는다.
  - 문서는 `--bare`가 앞으로 `-p`의 기본값이 될 것이라고 예고한다. 그렇게 바뀌면 구독 로그인 사용자의 `-p` 호출에 영향이 생길 수 있어 지켜봐야 한다.
- **그 밖의 유용한 플래그**: `--no-session-persistence`(세션을 디스크에 저장하지 않음), `--max-turns`, `--max-budget-usd`, `--append-system-prompt(-file)` ([cli-reference](https://code.claude.com/docs/en/cli-reference))

### Codex CLI

- **호출**
  - `codex exec "<프롬프트>"`로 실행한다. 프롬프트를 생략하거나 `-`를 주면 stdin에서 읽는다.
  - stdin을 파이프하면서 프롬프트도 주면 stdin이 `<stdin>` 블록으로 덧붙는다. (로컬 `codex exec --help`, 0.162.1)
- **출력** ([non-interactive-mode](https://learn.chatgpt.com/docs/non-interactive-mode))
  - 진행 상황은 stderr로, 최종 에이전트 메시지만 stdout으로 나온다.
  - `-o/--output-last-message <파일>`은 최종 메시지를 파일에도 쓴다.
  - `--json`을 주면 stdout이 JSONL 이벤트 스트림이 된다. 이벤트는 `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `item.*`, `error`다.
- **스키마 강제**
  - `--output-schema <파일>`로 JSON Schema를 따르는 최종 응답을 요청한다. ([non-interactive-mode](https://learn.chatgpt.com/docs/non-interactive-mode))
  - 문서 예시는 `additionalProperties: false`에 모든 속성을 `required`로 둔 형태다.
  - `--output-schema`, `--output-last-message`, `--ephemeral`을 쓸 때는 프롬프트가 반드시 있어야 한다. ([developer-commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli))
- **종료 코드**
  - 문서에는 명시가 없다.
  - 소스상으로는 재시도 없는 오류 알림을 받거나 턴이 `Failed`·`Interrupted`로 끝나면 `exit(1)`한다. ([exec/src/lib.rs L1295-1405](https://github.com/openai/codex/blob/2f05c0a71f59fb2f05800846351f3e9926c3e52b/codex-rs/exec/src/lib.rs#L1295-L1405))
- **2026년 변경**: `--full-auto`는 더 이상 지원하지 않는다. 문서는 `--sandbox workspace-write`나 `--approve-for-me`로 바꾸라고 한다. ([non-interactive-mode](https://learn.chatgpt.com/docs/non-interactive-mode))

## 2. 읽기 전용 강제와 비밀 파일 제외

### Claude Code

- **도구 자체를 빼는 방법이 가장 확실하다**
  - `--tools "Read,Glob,Grep"`처럼 내장 도구를 목록으로 제한한다. ([cli-reference](https://code.claude.com/docs/en/cli-reference))
  - `--tools`는 MCP 도구에는 영향이 없다. MCP까지 막으려면 `--disallowedTools "mcp__*"`를 함께 준다.
  - macOS·Linux·WSL에서는 기본 도구 세트에 Glob과 Grep이 빠져 있고, Bash의 `find`·`grep`으로 검색한다. `--tools`에 이름을 넣으면 두 도구가 돌아온다. ([tools-reference](https://code.claude.com/docs/en/tools-reference))
  - Read 도구는 디렉터리를 읽지 못한다. Bash를 빼면 목록 조회에는 Glob이 필요하다. ([tools-reference](https://code.claude.com/docs/en/tools-reference))
- **`--restricted`** (v2.1.248 이상) ([cli-reference](https://code.claude.com/docs/en/cli-reference))
  - 명령을 실행하는 내장 도구와 WebFetch를 제거한다.
  - 파일 도구를 작업 디렉터리 안으로 한정한다.
  - 사용자·저장소·local 설정 파일을 무시하고, 관리형 설정과 `--settings`만 읽는다.
  - `bypassPermissions`를 거부한다.
  - MCP 서버까지 건너뛰려면 `--strict-mcp-config`를 함께 준다. (로컬 `claude --help`)
  - 사용자 설정을 무시하므로, 사용자 설정의 `apiKeyHelper`로 인증하는 환경에서는 인증이 깨질 수 있다(추정, 실측 필요).
- **권한 모드는 반드시 명시한다** ([permission-modes](https://code.claude.com/docs/en/permission-modes))
  - `-p`의 시작 모드는 `--permission-mode` 플래그, 설정 파일의 `defaultMode`, 내장 기본값 순으로 정해진다.
  - 내장 기본값은 대개 `default`다. 다만 feature flag를 받지 않는 세션은 v2.1.285 이상에서 `auto`로 시작한다.
  - `dontAsk`: 프롬프트가 필요한 호출을 모두 거부한다. 작업 디렉터리 안의 파일 읽기, 읽기 전용 명령, allow 규칙에 맞는 호출만 실행한다.
  - `plan`: 계획만 하고 편집하지 않는다. `-p`에서도 차단이 유지된다.
  - `--permission-prompts none`(v2.1.259 이상)을 주면 프롬프트가 날 요청을 거부하고, Claude에게 재시도하지 말라고 알린다. ([headless](https://code.claude.com/docs/en/headless))
- **비밀 파일 제외** ([permissions](https://code.claude.com/docs/en/permissions))
  - `Read(./.env)`, `Read(**/.env)`, `Read(./secrets/**)` 같은 deny 규칙을 쓴다. `--disallowedTools`로 주거나 `--settings '{"permissions":{"deny":[...]}}'`로 줄 수 있다.
  - 패턴은 gitignore 문법이다. `.claudeignore` 파일은 효과가 없다.
  - `Read` deny는 같은 경로의 Edit과 Write도 막는다(편집은 v2.1.208, 쓰기는 v2.1.228 이상).
  - Grep과 Glob에는 deny 규칙을 **best-effort**로만 적용한다.
  - Bash에서 파일명을 직접 쓰지 않는 명령(예: `grep -r pattern .`)이나 스크립트 같은 서브프로세스에는 적용되지 않는다. 그러니 Bash를 빼야 이 구멍이 닫힌다.
  - Windows에서는 경로를 POSIX 형식으로 바꿔 비교한다. 예: `//c/**/.env`
- **네트워크** ([sandboxing](https://code.claude.com/docs/en/sandboxing))
  - WebFetch와 WebSearch를 도구 목록에서 빼면 에이전트가 웹에 접근할 수단이 없다. 모델 API 호출 자체는 별개다.
  - OS 수준 샌드박스는 Bash·PowerShell·Monitor 명령에만 걸린다. Read 같은 파일 도구는 샌드박스 밖에서 권한 규칙을 따른다.
  - 샌드박스는 macOS, Linux, WSL2에서만 동작한다. 네이티브 Windows에서는 명령이 샌드박스 없이 실행된다.
- **주의: `-p`는 신뢰하지 않은 저장소의 설정 일부를 그대로 실행한다** ([permissions#what-runs-before-you-trust-a-folder](https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder))
  - 저장소 `.claude/settings.json`의 훅, `env` 블록, 헬퍼 명령을 사용한다.
  - `.mcp.json` 서버를 묻지 않고 연결한다.
  - `permissions.allow`는 적용하지 않고, stderr에 경고만 낸다.
  - 문서가 권하는 대응은 세 가지다.
    - `--setting-sources user`로 저장소 설정과 `.mcp.json`을 읽지 않는다.
    - `--bare`를 쓴다(구독 로그인과 양립 불가).
    - `--settings '{"disableAllHooks": true}'`로 훅을 끈다.
  - `--restricted`는 저장소 설정 파일을 무시하므로, `--strict-mcp-config`와 함께 쓰면 같은 효과를 낸다.

### Codex CLI

- **기본은 read-only다** ([non-interactive-mode](https://learn.chatgpt.com/docs/non-interactive-mode))
  - `codex exec`는 기본적으로 read-only 샌드박스에서 돈다.
  - 소스를 보면 `--sandbox`를 주지 않을 때는 샌드박스 override를 두지 않는다. 그러면 사용자 `config.toml`의 `sandbox_mode`가 적용되는 구조로 보인다(추정). ([exec/src/lib.rs L343-347](https://github.com/openai/codex/blob/2f05c0a71f59fb2f05800846351f3e9926c3e52b/codex-rs/exec/src/lib.rs#L343-L347))
  - 그러니 `--sandbox read-only`를 명시하는 편이 안전하다.
- **승인 정책은 강제로 `never`다**
  - exec는 승인 정책을 `AskForApproval::Never`로 덮어쓴다. ([lib.rs L589-592](https://github.com/openai/codex/blob/2f05c0a71f59fb2f05800846351f3e9926c3e52b/codex-rs/exec/src/lib.rs#L589-L592))
  - 명령 실행·파일 변경 승인 요청이 오면 `... is not supported in exec mode`로 거절한다. ([lib.rs L2097-2120](https://github.com/openai/codex/blob/2f05c0a71f59fb2f05800846351f3e9926c3e52b/codex-rs/exec/src/lib.rs#L2097-L2120))
  - 즉 샌드박스 밖으로 나가는 동작은 사람에게 묻지 않고 막힌다.
- **read-only의 의미** ([sandboxing](https://learn.chatgpt.com/docs/sandboxing), [agent-approvals-security](https://learn.chatgpt.com/docs/agent-approvals-security))
  - 파일은 읽을 수 있지만, 승인 없이 편집하거나 명령을 실행할 수 없다. 기본값으로 네트워크가 꺼져 있다.
  - 샌드박스는 내장 파일 작업뿐 아니라 에이전트가 띄우는 명령과 그 자식 프로세스에도 적용된다.
  - **읽기 범위를 작업 디렉터리로 제한한다는 서술은 없다.** read-only는 쓰기를 막는 모드일 뿐, `~/.ssh` 같은 경로를 읽지 못하게 하는 장치가 아니다.
- **웹 검색은 별도로 끈다** ([agent-approvals-security](https://learn.chatgpt.com/docs/agent-approvals-security), [permissions](https://learn.chatgpt.com/docs/permissions))
  - 웹 검색 도구의 기본값은 `web_search = "cached"`(OpenAI가 관리하는 색인)다.
  - 완전히 끄려면 `-c web_search="disabled"`를 준다.
  - 명령 네트워크 프록시는 웹 검색, MCP, 커넥터 트래픽을 거르지 않는다.
- **비밀 파일 제외는 권한 프로필(베타)로만 된다** ([permissions](https://learn.chatgpt.com/docs/permissions))
  - `[permissions.<name>.filesystem.":workspace_roots"]`에 `"**/*.env" = "deny"`처럼 deny-read 규칙을 둔다.
  - 이 기능은 "Beta"로 표기되어 있고, 바뀔 수 있다고 적혀 있다.
  - **구식 샌드박스 설정과 함께 쓸 수 없다.** `--sandbox`를 주거나 설정 파일에 `sandbox_mode`가 있으면 권한 프로필 대신 구식 설정을 쓴다. 따라서 "`--sandbox read-only`로 확실히 고정"과 "`.env` deny-read"는 동시에 걸 수 없다.
  - Linux, WSL, 네이티브 Windows에서 `**` glob deny는 `glob_scan_max_depth`로 미리 펼쳐야 한다.
  - Windows `unelevated` 샌드박스는 deny-read를 지원하지 않는다. ([windows-sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox))
  - 혼합 버전 환경에 대한 안내에 Codex 0.138.0이 기준으로 나온다.
- **저장소별 설정** ([config-reference](https://learn.chatgpt.com/docs/config-file/config-reference))
  - 저장소 안 `.codex/` 계층(설정, 훅, rules)은 사용자가 그 저장소를 신뢰한 경우에만 로드한다.
  - `--ignore-user-config`(사용자 `config.toml` 무시)와 `--ignore-rules`(execpolicy rules 무시)도 있다. ([non-interactive-mode](https://learn.chatgpt.com/docs/non-interactive-mode))

## 3. 디렉터리 지정

### Claude Code

- **작업 디렉터리를 지정하는 플래그가 없다.** 실행한 디렉터리가 주 작업 디렉터리다. 그래서 앱은 프로세스를 띄울 때 cwd를 지정해야 한다. ([permissions#working-directories](https://code.claude.com/docs/en/permissions#working-directories), 로컬 `claude --help`)
- **여러 디렉터리 동시 읽기**: `--add-dir <경로...>`로 추가한다. ([cli-reference](https://code.claude.com/docs/en/cli-reference), [permissions](https://code.claude.com/docs/en/permissions))
  - 추가 디렉터리는 주 작업 디렉터리와 같은 규칙으로, 프롬프트 없이 읽을 수 있다.
  - 파일 접근 권한만 줄 뿐, 그 디렉터리의 `.claude/` 설정은 대부분 읽지 않는다(스킬 등은 예외).
  - CLAUDE.md는 `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD=1`일 때만 읽는다.
  - `\\server\share` 같은 네트워크 경로는 작업 디렉터리로 추가할 수 없다.
- **작업 폴더에서 저장소 고르기**: cwd를 작업 폴더로 두면 그 아래 저장소 전체를 프롬프트 없이 읽을 수 있다. `dontAsk`에서는 작업 디렉터리 밖 읽기가 거부되므로, 읽기 범위가 자연스럽게 작업 폴더 안으로 묶인다.

### Codex CLI

- **작업 디렉터리 지정**: `-C/--cd <DIR>`로 작업 루트를 지정한다. (로컬 `codex exec --help`)
- **`--add-dir`는 읽기용이 아니다.** "primary workspace와 함께 쓰기 가능해야 할 디렉터리"를 추가하는 플래그라서, 읽기 전용 용도와는 관계가 없다. (로컬 `codex exec --help`)
- **여러 디렉터리 읽기**
  - read-only는 읽기 범위를 좁히지 않으므로, 다른 경로도 읽을 수 있을 것으로 보인다(추정).
  - 권한 프로필을 쓰면 `[permissions.<name>.workspace_roots]`로 여러 루트를 지정할 수 있다. ([permissions](https://learn.chatgpt.com/docs/permissions))
- **git 저장소 확인** ([non-interactive-mode](https://learn.chatgpt.com/docs/non-interactive-mode), [lib.rs L1011-1019](https://github.com/openai/codex/blob/2f05c0a71f59fb2f05800846351f3e9926c3e52b/codex-rs/exec/src/lib.rs#L1011-L1019))
  - git 저장소 밖에서 실행하면 `Not inside a trusted directory and --skip-git-repo-check was not specified.`를 출력하고 코드 1로 끝난다.
  - 작업 폴더는 보통 git 저장소가 아니므로, 저장소를 고르는 실행에는 `--skip-git-repo-check`가 필요하다.

## 4. Windows 지원

### Claude Code

- **지원 범위** ([setup](https://code.claude.com/docs/en/setup))
  - Windows 10 1809+ 또는 Windows Server 2019+에서 네이티브로 돈다. 관리자 권한은 필요 없다.
  - WSL 1·2에서도 동작한다.
- **셸**
  - Git for Windows는 선택이다. 있으면 Bash 도구가 Git Bash를 쓰고, 없으면 PowerShell 도구를 쓴다.
  - Git Bash 경로는 `CLAUDE_CODE_GIT_BASH_PATH`로 지정할 수 있다.
- **샌드박스**: 네이티브 Windows는 지원하지 않고 WSL2만 지원한다. Bash·PowerShell 도구를 빼면 이 차이는 영향이 없다. ([setup](https://code.claude.com/docs/en/setup), [sandboxing](https://code.claude.com/docs/en/sandboxing))
- **경로**
  - 설치 위치는 `%USERPROFILE%\.local\bin\claude.exe`다. ([troubleshoot-install](https://code.claude.com/docs/en/troubleshoot-install))
  - 권한 규칙의 경로는 POSIX 형식으로 바꿔 비교한다(`C:\Users\alice` → `/c/Users/alice`). ([permissions](https://code.claude.com/docs/en/permissions))
  - UNC 경로는 작업 디렉터리로 쓸 수 없다. 드라이브 문자로 매핑해야 한다. ([permissions](https://code.claude.com/docs/en/permissions))
- **버전 주의**: v2.1.211 전에는 Windows에서 stdin을 읽지 못하면 세션이 죽거나, 출력 없이 끝났다. ([headless](https://code.claude.com/docs/en/headless))

### Codex CLI

- **지원 범위**: 네이티브 Windows CLI와 Windows 전용 샌드박스가 있다. ([windows-sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox))
- **샌드박스 구현 3가지**
  - `mxc`: 권장. Windows 11 24H2(build 26100.9278) 또는 25H2(build 26200.9278) 이상의 MXC 기능이 필요하다. 0.162.0 이상에서 한 명령으로 MXC를 시험해 볼 수 있다.
  - `elevated`: 관리자 승인을 거친 설정이 필요하다. 로컬 사용자 생성, 방화벽 규칙, 로그온 권한 등이 회사 PC 정책에 막힐 수 있다.
  - `unelevated`: 네트워크 격리가 약하고 deny-read를 지원하지 않는다.
- **Windows 버전**: Windows 11을 권장한다. Windows 10은 1809 이상에서 best effort다.
- **WSL**: WSL2는 Linux 샌드박스(bubblewrap)를 쓴다. WSL1은 0.115부터 지원하지 않는다. ([wsl](https://learn.chatgpt.com/docs/windows/wsl), [agent-approvals-security](https://learn.chatgpt.com/docs/agent-approvals-security))
- **경로**
  - 독립 설치 위치는 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`이다. ([environment-variables](https://learn.chatgpt.com/docs/config-file/environment-variables))
  - 권한 프로필은 `C:\path`, `~\work`, UNC 경로를 받는다. ([permissions](https://learn.chatgpt.com/docs/permissions))
- **확인하지 못한 것**: 비대화형 `codex exec`를 처음 실행할 때 `elevated` 설정(UAC 프롬프트)이 어떻게 처리되는지는 문서에 없다.

### 공통

- 두 CLI 모두 프롬프트를 stdin으로 받는다(Claude는 10MB 상한, Codex는 `-` 또는 생략). 게시물 본문과 댓글 스레드처럼 긴 맥락은 명령줄 인자 대신 stdin으로 넘기면 인용 부호와 길이 문제를 피할 수 있다.

## 5. 인증 상태

### Claude Code

- **사전 확인**: `claude auth status` ([cli-reference](https://code.claude.com/docs/en/cli-reference))
  - 기본은 JSON 출력이고, `--text`를 주면 사람이 읽는 형식이다.
  - 로그인되어 있으면 코드 0, 아니면 코드 1로 끝난다.
  - JSON의 `authMethod`는 `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper`, `third_party` 중 하나다.
  - `configDirectory` 필드는 v2.1.268 이상에서 나온다.
- **로그인 안 된 상태로 `-p`를 실행하면**
  - 실패 내용을 stdout의 결과로 출력하고, 0이 아닌 코드로 끝난다. ([headless](https://code.claude.com/docs/en/headless))
  - 메시지는 다음과 같다. ([errors](https://code.claude.com/docs/en/errors))
    - 미로그인: `Not logged in · Please run /login`
    - 만료: `Login expired · Please run /login`
    - 잘못된 키: `Invalid API key · Fix external API key`
- **인증 우선순위** ([authentication](https://code.claude.com/docs/en/authentication))
  - 순서: 클라우드 제공자 → `ANTHROPIC_AUTH_TOKEN` → `ANTHROPIC_API_KEY` → `apiKeyHelper` → `CLAUDE_CODE_OAUTH_TOKEN` → Anthropic 프로필 → `/login` 구독 OAuth
  - `-p`에서는 `ANTHROPIC_API_KEY`가 있으면 사용자 승인 없이 **항상** 쓴다. 앱 환경에 이 변수가 남아 있으면 구독 대신 API 과금으로 돈다.
- **저장 위치** ([authentication](https://code.claude.com/docs/en/authentication))
  - macOS는 키체인에 저장한다.
  - Linux와 Windows는 `~/.claude/.credentials.json`(Windows는 `%USERPROFILE%\.claude\.credentials.json`)에 저장한다.
  - `CLAUDE_CONFIG_DIR`로 위치를 바꿀 수 있다.

### Codex CLI

- **사전 확인**: `codex login status`
  - 자격 증명이 있으면 코드 0으로 끝난다. ([developer-commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli))
  - 소스상 출력은 stderr로 나간다. ([cli/src/login.rs L447-510](https://github.com/openai/codex/blob/2f05c0a71f59fb2f05800846351f3e9926c3e52b/codex-rs/cli/src/login.rs#L447-L510))
    - 성공: `Logged in using ChatGPT`, `Logged in using an API key - ...` 등
    - 미로그인: `Not logged in`과 함께 코드 1
    - 확인 중 오류: `Error checking login status: ...`와 함께 코드 1
  - 같은 소스에서 이 확인은 저장된 자격 증명이 있는지만 보고, `CODEX_API_KEY` 환경 변수는 보지 않는다(`enable_codex_api_key_env = false`). 토큰이 만료됐는지는 확인하지 않는 것으로 보인다(추정).
- **exec의 인증** ([non-interactive-mode](https://learn.chatgpt.com/docs/non-interactive-mode), [auth](https://learn.chatgpt.com/docs/auth))
  - `codex exec`는 저장된 CLI 인증을 그대로 쓴다. 실행 한 번에만 키를 넣으려면 `CODEX_API_KEY`를 인라인으로 준다.
  - 자격 증명은 `~/.codex/auth.json`이나 OS 자격 증명 저장소에 둔다(`cli_auth_credentials_store`).
  - ChatGPT 로그인 토큰은 사용 중에 자동으로 갱신된다.
- **확인하지 못한 것**: 로그인 안 된 상태에서 `codex exec`가 무엇을 출력하는지는 문서에 없다. 오류로 끝나면 코드 1일 것으로 보이지만, 실측이 필요하다.

## 6. GUI 앱에서 호출할 때의 PATH 문제

- **문제는 실재한다. Anthropic 자체 데스크톱 앱도 대응하고 있다** ([desktop](https://code.claude.com/docs/en/desktop))
  - macOS에서 Dock이나 Finder로 띄운 앱은 셸 환경을 다 물려받지 않는다. Claude Desktop은 `~/.zshrc`, `~/.bashrc` 같은 셸 프로필을 읽어 `PATH`를 추출한다.
  - Windows에서는 앱이 사용자·시스템 환경 변수를 상속하지만, PowerShell 프로필은 읽지 않는다.
  - 문서는 도구를 찾지 못하면 셸 프로필의 PATH 설정을 확인하고 앱을 재시작하라고 안내한다.
- **설치 문서도 같은 원리를 설명한다** ([troubleshoot-install](https://code.claude.com/docs/en/troubleshoot-install))
  - 설치기는 PATH를 직접 바꾸지 않고 안내만 출력한다.
  - macOS는 셸 rc 파일에 `~/.local/bin`을 추가하고, Windows는 User PATH에 `%USERPROFILE%\.local\bin`을 추가한 뒤 터미널을 재시작하라고 한다.
  - "에디터 안의 터미널은 에디터의 PATH를 받는다"고 적혀 있다. 즉 자식 프로세스는 GUI 부모의 환경을 그대로 물려받는다.
- **설치 위치 후보**
  - Claude Code
    - 네이티브 설치: `~/.local/bin/claude`, `%USERPROFILE%\.local\bin\claude.exe`
    - 그 밖에 Homebrew cask, WinGet, npm으로 설치할 수 있다. ([setup](https://code.claude.com/docs/en/setup))
  - Codex
    - 독립 설치: `~/.local/bin`(macOS/Linux), `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin`(Windows) ([environment-variables](https://learn.chatgpt.com/docs/config-file/environment-variables))
    - 그 밖에 Homebrew cask와 npm으로 설치할 수 있다. ([codex/cli](https://learn.chatgpt.com/docs/codex/cli))
  - 이 PC에서는 두 CLI가 모두 `/opt/homebrew/bin`에 있다(로컬 `which`).
- **Windows의 함정** ([troubleshoot-install](https://code.claude.com/docs/en/troubleshoot-install))
  - 구버전 Claude Desktop은 `WindowsApps`에 `Claude.exe`를 등록한다. 이 경로가 PATH에서 앞서면 `claude`가 CLI 대신 데스크톱 앱을 연다.
  - VS Code 확장은 자체 CLI 사본을 번들할 뿐 PATH에 넣지 않는다.
- **알려진 해결책**
  1. macOS: 사용자의 로그인 셸을 한 번 띄워 PATH나 CLI 절대 경로를 얻는다. Claude Desktop이 셸 프로필에서 PATH를 추출하는 것과 같은 계열의 방법이다.
  2. 위 설치 위치 후보를 직접 탐색한다.
  3. 설정 화면에서 CLI 절대 경로를 직접 입력받고, `--version`과 로그인 상태 확인으로 연결을 시험한다.
  4. Windows: 앱이 시작된 뒤 User PATH를 바꾸면 그 변경을 보지 못한다. 문서가 터미널 재시작을 요구하는 것과 같은 원리이므로, 앱을 재시작하거나 경로를 직접 지정하게 한다.
  5. npm으로 설치한 CLI는 Windows에서 `.cmd` 래퍼일 수 있다. 1차 출처 범위 밖이라 확인하지 못했고, 실측이 필요하다.

## 7. 실행 제어

### Claude Code

- **타임아웃**
  - 전체 실행 시간을 제한하는 플래그가 없다.
  - 대신 `--max-turns`(한도에 닿으면 오류로 끝남)와 `--max-budget-usd`가 있다. 비용 한도는 클라이언트 추정치 기준이라 넘어갈 수 있다. ([cli-reference](https://code.claude.com/docs/en/cli-reference))
  - Bash 명령에는 기본 2분, 최대 10분의 타임아웃이 있다. Bash를 빼면 해당이 없다. ([tools-reference](https://code.claude.com/docs/en/tools-reference))
- **종료 지연** ([headless](https://code.claude.com/docs/en/headless))
  - 턴이 끝난 뒤에도 백그라운드 작업(명령, 서브에이전트, Monitor)을 기다릴 수 있다. 기본 상한은 유휴 10분이고 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`로 바꾼다.
  - 도구를 Read·Glob·Grep으로 제한하면 이런 작업이 생길 여지가 없을 것으로 보인다(추정).
- **취소** ([headless](https://code.claude.com/docs/en/headless))
  - SIGTERM을 받으면 코드 143으로 끝나고, 진행 중인 턴의 결과는 기록하지 않는다.
  - 이때 실행 중인 Bash 프로세스 트리를 종료하고, `SessionEnd` 훅만 돌린 뒤 끝난다.
  - 턴을 정상적으로 마무리하려면 SIGINT를 먼저 보낸다.
- **동시 실행**
  - 같은 PC의 병렬 세션은 저장된 로그인을 공유하고, 토큰 갱신은 한 프로세스만 하도록 조율한다. v2.1.211 전에는 절전 해제 뒤 동시 갱신 때문에 로그인이 풀리는 버그가 있었다. ([troubleshoot-install](https://code.claude.com/docs/en/troubleshoot-install))
  - 실행마다 세션 파일이 쌓이므로 `--no-session-persistence`가 유용하다. ([cli-reference](https://code.claude.com/docs/en/cli-reference))
  - 구독 사용량 한도와 동시 실행의 관계는 이번에 읽은 문서에서 확인하지 못했다.

### Codex CLI

- **타임아웃**: exec에 전체 실행 시간 제한 플래그가 없다. (로컬 `codex exec --help`)
- **취소**
  - 소스상 Ctrl-C(SIGINT)만 잡아 턴 중단을 요청한다. 턴이 `Interrupted`로 끝나면 코드 1로 종료한다. ([lib.rs L1190-1196](https://github.com/openai/codex/blob/2f05c0a71f59fb2f05800846351f3e9926c3e52b/codex-rs/exec/src/lib.rs#L1190-L1196), [L1403-1405](https://github.com/openai/codex/blob/2f05c0a71f59fb2f05800846351f3e9926c3e52b/codex-rs/exec/src/lib.rs#L1403-L1405))
  - SIGTERM은 따로 처리하지 않는다. 그래서 자식 프로세스가 정리되는지는 확인하지 못했다.
  - Windows MXC 샌드박스는 포그라운드 명령이 끝나면 남은 자식 프로세스를 정리한다. ([windows-sandbox](https://learn.chatgpt.com/docs/windows/windows-sandbox))
- **동시 실행**
  - 문서에 제한이 명시되어 있지 않다.
  - `--ephemeral`을 주면 세션 롤아웃 파일을 남기지 않는다. ([non-interactive-mode](https://learn.chatgpt.com/docs/non-interactive-mode))
  - 상태는 `CODEX_HOME`(SQLite 포함)을 함께 쓴다. ([environment-variables](https://learn.chatgpt.com/docs/config-file/environment-variables))

### 공통

- Windows에는 POSIX 시그널이 없다. 그래서 취소할 때의 동작(턴 기록, 자식 프로세스 정리)은 OS별로 실측해야 한다.

## 8. 다른 후보: Gemini CLI

- **호출과 출력** ([headless.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md))
  - `gemini -p "<프롬프트>"`로 실행하거나, TTY가 아닌 환경에서 실행하면 headless로 돈다.
  - `--output-format text|json|stream-json`을 지원한다. `json` 출력은 `response`, `stats`, `error`를 담는다.
  - 종료 코드: `0`(성공), `1`(일반 오류·API 실패), `42`(입력 오류), `53`(턴 한도 초과)
- **스키마 강제**: CLI 참조에 스키마 강제 플래그가 없다. ([cli-reference.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md))
- **읽기 전용**
  - `--approval-mode plan`은 읽기 전용 환경이다.
  - 그런데 비대화형 실행에서는 plan을 빠져나갈 때 **자동으로 YOLO 모드로 바뀐다**. 그래서 읽기 전용을 보장하는 수단으로 쓰기 어렵다. ([plan-mode.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/plan-mode.md))
  - `--sandbox`도 있다. macOS Seatbelt 기본 프로필 `permissive-open`은 쓰기만 프로젝트 디렉터리로 묶고, 읽기와 네트워크는 넓게 허용한다. Docker·Podman 방식도 있다. ([sandbox.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md))
- **비밀 파일**: `.geminiignore`는 이를 지원하는 도구에만 적용되고, 강제력이 없다. ([gemini-ignore.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/gemini-ignore.md))
- **디렉터리**: `--include-directories`로 추가한다. ([cli-reference.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md))
- **신뢰**: headless에서 신뢰하지 않은 폴더면 `FatalUntrustedWorkspaceError`로 끝난다. `--skip-trust`나 `GEMINI_CLI_TRUST_WORKSPACE=true`로 우회한다. ([trusted-folders.md](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md))
- **플랫폼**: macOS 15+, Windows 11 24H2+, Ubuntu 20.04+를 권장하고, Node.js 20+가 필요하다. ([installation.mdx](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/installation.mdx))
- **인증**: headless는 캐시된 자격 증명을 쓰거나, `GEMINI_API_KEY`·Vertex AI 환경 변수를 쓴다. ([authentication.mdx](https://github.com/google-gemini/gemini-cli/blob/main/docs/get-started/authentication.mdx))
- **결론**: 호출 방식과 JSON 출력은 비슷하다. 하지만 스키마 강제가 없고, 읽기 전용과 비밀 파일 제외를 강제하는 수단이 약하다. 교체 가능한 실행기의 2순위 후보로 보는 것이 맞다.

## 실측이 필요한 것

이번 조사는 실행과 로그인을 하지 않았으므로, 아래는 성공으로 확인된 것이 아니다.

1. 로그인 안 된 상태에서 `claude -p --output-format json`이 실제로 내는 stdout JSON과 종료 코드
2. 로그인 안 된 상태에서 `codex exec --json`이 내는 출력과 종료 코드
3. Codex에서 `--sandbox` 없이 `--ignore-user-config`와 `-c`로 권한 프로필을 인라인 정의했을 때, `.env` deny-read가 실제로 걸리는지
4. Windows에서 `codex exec`를 처음 실행할 때 샌드박스 설정(UAC) 동작과, 관리자 권한이 없는 PC에서의 결과
5. Claude의 Grep·Glob이 `Read` deny된 파일 내용을 노출하지 않는지. 문서상 best-effort다.
6. GUI 앱에서 띄운 프로세스를 취소할 때(macOS SIGTERM/SIGINT, Windows 강제 종료) 자식 프로세스가 정리되는지
7. Windows에서 npm으로 설치한 CLI(`.cmd` 래퍼)를 앱이 띄울 수 있는지
8. `--restricted`가 사용자 설정의 `apiKeyHelper` 같은 인증 설정에 영향을 주는지

## 앱 설계에 주는 함의

1. 두 CLI 모두 "stdin 프롬프트 + JSON 스키마 → 구조화 결과 + 종료 코드"를 지원한다. 그래서 실행기 인터페이스를 이 계약 하나로 통일하고, 요구·초안·근거를 스키마로 받을 수 있다.
2. 읽기 전용은 Claude는 도구 제한(`--tools "Read,Glob,Grep"` + `--permission-mode dontAsk` + `--restricted`)으로, Codex는 `--sandbox read-only` + `-c web_search="disabled"`로 건다. 단 비밀 파일 제외가 안정적인 쪽은 Claude뿐이고, Codex는 베타 권한 프로필이 필요해 실행기마다 안전 수준이 다르다.
3. `claude -p`는 신뢰하지 않은 저장소의 훅·`env`·`.mcp.json`을 그대로 실행한다. 그러므로 `--restricted`와 `--strict-mcp-config`는 선택 사항이 아니라 필수 플래그로 다뤄야 한다.
4. GUI 앱은 셸 PATH를 물려받지 못한다. 온보딩에 CLI 경로 해석(로그인 셸, 알려진 위치, 수동 지정)과 `auth status`·`login status` 사전 점검을 넣어야 한다.
5. 두 CLI 모두 실행 시간 제한·동시 실행 제한·취소 정리를 해 주지 않는다. 앱이 실행 큐, 벽시계 타임아웃, 프로세스 종료를 직접 맡는다.
