# 재현에 필요한 에이전트 실행 권한 조사

- 조사일: 2026-11-12
- 티켓: [02 재현에 필요한 에이전트 실행 권한 조사](../issues/02-agent-reproduction-permissions-research.md)
- 대상 버전(이 PC 설치본)
  - Claude Code: `2.1.322 (Claude Code)` (`/opt/homebrew/Caskroom/claude-code@latest/2.1.322/claude`)
  - Codex CLI: `codex-cli 0.167.1` (`/opt/homebrew/Caskroom/codex/0.167.1/bin/codex`)
- 조사 방법
  - 공식 문서: Claude Code는 `code.claude.com/docs/en/*.md`, Codex는 `developers.openai.com/codex/...`가 308로 넘겨 주는 `learn.chatgpt.com/docs/*.md`를 읽었다.
  - 공식 소스: `openai/codex` main 브랜치의 `codex-rs/sandboxing/src/seatbelt_base_policy.sbpl`과 `seatbelt_network_policy.sbpl`(이 파일의 마지막 커밋 `696b4502df`, 2026-08-21). Playwright MCP는 `microsoft/playwright-mcp` README(최신 릴리스 `v0.0.85`)를 읽었다.
  - 바이너리: `claude --help`, `claude --version`, `codex --help`, `codex exec --help`, `codex sandbox --help`, `codex --version`을 실행했다. 설정 키가 바이너리 안에 있는지 문자열 검색(`grep -c -a`)도 했다.
  - 로컬 샌드박스 실측 1건: `codex sandbox`(모델 호출 없이 Seatbelt 아래에서 명령 하나를 실행하는 하위 명령)로 임시 폴더의 가짜 `.env`를 읽어 봤다(§6).
  - 하지 않은 것: 에이전트 실행(모델 호출), 로그인 확인, 시뮬레이터·에뮬레이터 부팅, `xcrun simctl`·`adb` 실행, 설정 파일 변경.
  - 참고: `codex sandbox macos --help`를 하위 명령 도움말로 알고 실행했더니 `sandbox-exec: execvp() of 'macos' failed`로 끝났다. 현재 버전에 `macos` 하위 명령은 없고, 인수를 그대로 샌드박스 안에서 실행하려다 실패한 것이다. 부작용은 없다.

### 출처 표시

| 표시 | 뜻 |
| :- | :- |
| **[바이너리]** | 설치된 CLI의 `--help`·`--version` 출력으로 확인 |
| **[문자열]** | 설치된 바이너리 안에 그 설정 키 문자열이 있는 것만 확인. 동작은 확인하지 않음 |
| **[실측]** | 이 PC에서 모델 호출 없이 직접 실행해 확인 |
| **[문서]** | 공식 문서로만 확인 |
| **[소스]** | 공식 저장소 소스로 확인(설치본과 버전이 다를 수 있음) |
| **[추론]** | 위 사실에서 끌어낸 판단. 실측 필요 |
| **확인 못 함** | 1차 출처에서 찾지 못함 |

---

## 결정용 요약

### 핵심 사실

1. **두 CLI 모두 OS 샌드박스로 셸 명령의 파일·네트워크 접근을 막을 수 있다.** macOS에서는 둘 다 Seatbelt를 쓴다. Claude Code는 `sandbox` 설정을 `--settings`로 넘기고, Codex는 지금 쓰는 권한 프로필의 `"." = "read"`를 `"write"`로 바꾸고 `network`를 더하는 식이다. [문서][바이너리]
2. **Codex는 지금도 셸 명령을 실행한다.** 파일을 읽는 수단이 셸 명령이고, 비밀 파일 차단도 이미 OS 수준이다. 실측에서 `cat .env`, `python3 open(".env")`, `grep -r` 모두 `Operation not permitted`로 막혔다. 반면 **Claude Code는 지금 Bash가 아예 없다.** Bash를 열면 기존 `Read(...)` deny 규칙은 `cat`·`head` 같은 "알아보는 명령"에만 걸리고, `python`·`node` 스크립트나 `grep -r .`은 막지 못한다. 셸 경유 비밀 읽기를 막으려면 **샌드박스를 함께 켜야 한다.** [실측][문서]
3. **MCP 서버는 두 CLI 모두 샌드박스 밖에서 사용자 권한으로 돈다.** Playwright MCP를 붙이면 그 프로세스는 파일·네트워크 제한을 받지 않는다. 게다가 Playwright MCP에는 "RCE와 같다"고 스스로 밝힌 `browser_run_code_unsafe` 도구가 있다. 이 도구는 이름을 지정해 막아야 한다. [문서]
4. **모바일 재현은 샌드박스와 부딪친다.** Claude Code는 `sandbox.network.allowMachLookup`(문서 예시 `com.apple.CoreSimulator.*`)으로 iOS 시뮬레이터·Playwright의 XPC를 열 수 있지만, 열린 서비스가 하는 일은 샌드박스가 가두지 못한다. Codex 문서에는 mach-lookup을 여는 설정이 없고, 기본 Seatbelt 정책도 CoreSimulator를 허용하지 않는다. `adb`는 localhost TCP(adb 서버)를 쓰므로 로컬 접속 허용이 필요하다. [문서][소스][추론]
5. **세 경계는 서로 묶인다.** 쓰기를 열면 dev 서버·빌드가 돌고, 그 프로세스가 `.env`를 못 읽으면 앱이 뜨지 않을 수 있다. localhost를 열면 그 PC의 다른 로컬 서비스도 열린다. 시뮬레이터 XPC를 열면 샌드박스 밖 프로세스에 일을 맡기는 길이 생긴다.
6. **버전 하한**: 위 기능 대부분은 현재 하한(Claude `2.1.259`, Codex `0.162.1`) 안에서 쓸 수 있다. 다만 Claude Code의 `tee` 대상 검사는 `2.1.269`, `--settings`로 샌드박스를 "관리자 필수"로 만드는 동작은 `2.1.285`, `blockWritesOutsideWorkingDirectories`는 `2.1.314`부터다. `allowMachLookup`·`allowLocalBinding`이 생긴 버전과 Codex `features.network_proxy`가 생긴 버전은 확인 못 함. [문서]

### 선택지와 트레이드오프

결정은 하지 않는다. 아래는 "재현 실행의 보안 경계"를 정할 때 비교할 후보다. 모든 후보는 **원본 저장소가 아닌 사본(worktree)에서 실행한다**는 전제를 공통으로 둔다(§4).

| 후보 | 내용 | 얻는 것 | 잃는 것·위험 |
| :- | :- | :- | :- |
| **A. 읽기 전용 유지** | 지금 경계 그대로. 재현은 하지 않고 코드만 읽어 진단 | 새 위험 없음. 구현 비용 0 | 재현이라는 목적지 기능을 못 한다 |
| **B. 사본 쓰기 + 셸 + 네트워크 차단** | Claude: `--tools`에 `Bash` 추가 + `sandbox.enabled`·`failIfUnavailable`·`allowUnsandboxedCommands:false` + 네트워크 허용 목록 비움. Codex: 사본 루트만 `write`, `network` 끔 | 단위 테스트·스크립트 재현 가능. 비밀 파일은 OS가 막음. 외부 유출 경로 없음 | `npm install`처럼 네트워크가 필요한 준비 단계를 못 한다(의존성은 미리 깔려 있어야 함). dev 서버·브라우저·시뮬레이터 재현은 대부분 안 된다 |
| **C. B + 허용 도메인** | B에 패키지 저장소 등 도메인만 허용(Claude `allowedDomains`+`strictAllowlist`, Codex `network.domains`+`features.network_proxy`) | 의존성 설치 가능 | 프록시는 TLS를 열어 보지 않아 domain fronting으로 우회될 수 있다(Claude 문서 명시). 허용 도메인이 넓을수록 유출 경로가 된다 |
| **D. C + localhost + 브라우저** | dev 서버를 띄우고 Playwright로 재현. Claude는 `allowLocalBinding`, Codex는 `localhost` 허용. Playwright는 `npx playwright`(샌드박스 안) 또는 MCP(샌드박스 밖) | 웹 앱 재현 가능 | localhost의 다른 서비스(디버거, DB 등)가 열린다. MCP를 쓰면 브라우저 프로세스는 샌드박스 밖이다. 샌드박스 안 Chromium은 mach-lookup 허용이 필요할 수 있다 |
| **E. D + 모바일** | Claude는 `allowMachLookup: ["com.apple.CoreSimulator.*"]` 등, `adb`는 localhost. Codex는 mach-lookup 설정을 찾지 못해 제외 명령·전체 권한이 필요할 수 있다 | iOS·Android 재현 가능 | 시뮬레이터 서비스는 샌드박스 밖에서 앱 설치·실행을 대신 해 준다. 사실상 코드 실행 격리가 약해진다. 시뮬레이터·adb 서버는 실행이 끝나도 살아남는다 |
| **F. 전체 권한 + 외부 격리** | `--dangerously-skip-permissions`/`danger-full-access`를 VM·컨테이너 안에서 | 가장 적은 마찰 | 앱이 VM을 관리해야 한다. macOS의 iOS 시뮬레이터는 컨테이너로 옮길 수 없다. Claude는 `--restricted`와 `bypassPermissions`를 함께 쓸 수 없다 |

결정 전에 실측으로 풀어야 할 의문은 §8에 모았다. 가장 싸게 확인할 방법은 `codex sandbox --log-denials -P <프로필> -- <명령>`이다. 모델 호출 없이 Codex 정책을 바로 시험한다. Claude Code에는 같은 역할의 하위 명령을 찾지 못했다.

---

## 0. 현재 경계(코드 기준)

### Claude Code (`apps/desktop/src/core/agent/claude-code-executor.ts`)

`claudeRunArgs`가 만드는 고정 플래그 묶음이다.

| 플래그 | 하는 일 |
| :- | :- |
| `-p --output-format stream-json --verbose --json-schema <스키마>` | 비대화형 실행 + 구조화 출력 |
| `--tools Read,Glob,Grep` | 내장 도구를 셋으로 제한. Bash·Edit·Write·WebFetch 없음 |
| `--disallowedTools mcp__*` | 모든 MCP 도구 거부 |
| `--settings {"permissions":{"deny":["Read(//**/<패턴>)", ...]}}` | 비밀 파일 Read deny. 절대 형식 `//**/`라서 `--add-dir` 저장소에도 걸림 |
| `--permission-mode dontAsk` + `--permission-prompts none` | 물어볼 일은 모두 거부 |
| `--restricted` | 명령 실행 도구·WebFetch 제거, 사용자·프로젝트·로컬 설정 무시(관리 설정과 `--settings`만 적용), 파일 도구를 작업 디렉터리로 제한, `bypassPermissions` 거부 |
| `--strict-mcp-config` | `--mcp-config`로 준 MCP만 사용. 지금은 하나도 주지 않으므로 MCP 0개 |
| `--no-session-persistence` | 세션 저장 안 함 |
| `--max-turns <n>` | 선택 40, 초안 60, 점검 3(`claude-cli.ts`의 `CLAUDE_MAX_TURNS`) |
| `--append-system-prompt-file <파일>` | 지침 |
| `--add-dir <나머지 저장소>` | 첫 저장소는 cwd, 나머지는 추가 디렉터리 |
| 환경 변수 | `withoutAgentApiKeys`로 에이전트 API 키만 뺌 |

### Codex (`apps/desktop/src/core/agent/codex-executor.ts`)

`codexRunArgs`의 핵심은 `--sandbox` 대신 인라인 권한 프로필 `stardraft`다.

- 플래그: `exec --ignore-user-config --ignore-rules --ephemeral --json --output-schema <파일> -C <cwd> [--skip-git-repo-check]`, `-c web_search="disabled"`, `features.apps=false`, `features.hooks=false`, `features.multi_agent=false`, `features.goals=false`, `default_permissions="stardraft"`, 입력은 표준 입력(`-`).
- 파일 시스템: `{":minimal"="read", "<CLI 실제 경로>"="read", ":slash_tmp"="deny", ":tmpdir"="deny", ":workspace_roots"={"."="read", "**/<패턴>"="deny"..., ".git"="deny"}}`
- 작업 루트: 둘째 저장소부터 `permissions.stardraft.workspace_roots`에 넣는다.
- 네트워크: 프로필에 `network`가 없으므로 기본값 `enabled=false`다. [문서]
- 승인 정책은 따로 넘기지 않는다.

### 비밀 파일 목록 (`secret-patterns.ts`)

`.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`, `*.keystore`, `id_rsa*`, `id_ed25519*`, `.npmrc`, `.pypirc`, `.netrc`, `secrets/**`, `.git/**`. 사용자는 더하기만 할 수 있다. Claude에는 `Read(//**/<패턴>)`로, Codex에는 `:workspace_roots` 아래 `"**/<패턴>"="deny"`로 들어간다. 근거 검사용 `matchesSecretPattern`은 대소문자를 가리지 않는다.

### 버전 하한 (`cli-version.ts`, `claude-cli.ts`, `codex-cli.ts`)

- `cli-version.ts`는 `--version` 출력에서 `x.y.z`를 꺼내고(`parseCliVersion`) 비교(`compareVersions`)만 한다.
- 하한 값은 `MIN_CLAUDE_VERSION = '2.1.259'`(`--permission-prompts`가 생긴 버전), `MIN_CODEX_VERSION = '0.162.1'`(실측한 가장 낮은 버전)이다.

### 프로세스 정리 (`node-process-runner.ts`)

POSIX에서는 `detached: true`로 새 프로세스 그룹을 만들고, 시간 초과나 중단 때 `process.kill(-pid, 'SIGKILL')`로 그룹 전체를 끝낸다.

---

## 1. 명령 실행

### Claude Code

**셸 도구 켜기**
- `--restricted`는 명령 실행 도구를 지우지만, **`--tools`에 이름을 하나씩 적으면 남긴다.** `default` 프리셋으로는 남지 않는다. [바이너리][문서: cli-reference `--restricted`] 따라서 `--tools Read,Glob,Grep,Bash`(필요하면 `Edit,Write`)로 `--restricted`를 유지한 채 셸을 열 수 있다.
- `--restricted`에서도 `--settings`는 적용된다. 그래서 샌드박스와 권한 규칙을 모두 `--settings` JSON으로 넘기면 된다. [바이너리]
- `--restricted`는 설정·git·도구 설정 파일 쓰기를 사람이나 설정된 권한 처리기만 승인하게 한다. `--permission-prompts none`에서는 이런 쓰기가 거부된다. [바이너리][추론]

**명령 단위 허용·거부(`Bash(...)` 규칙)** [문서: permissions]
- `Bash(npm run *)`처럼 `*`는 공백을 포함한 아무 글자와 맞는다. 공백 뒤의 끝 `*`는 맨 명령(`npm run`)에도 맞는다. `:*` 접미사도 같은 뜻이다.
- 셸 연산자(`&&`, `||`, `;`, `|`, `|&`, `&`, 줄바꿈)를 나눠 보고, **모든 하위 명령이 허용돼야** 묻지 않고 실행한다. deny·ask 규칙은 하위 명령 하나만 맞아도 걸리고, 서브셸·명령 치환·`for` 본문 안까지 본다.
- `timeout`, `time`, `nice`, `nohup`, `stdbuf`, `command`, `builtin`, `noglob`, 플래그 없는 `xargs`는 벗겨서 맞춘다. `npx`, `direnv exec`, `docker exec`는 벗기지 않는다. 따라서 `Bash(npx *)`는 `npx` 뒤의 무엇이든 허용한다.
- **한계(문서 원문 요지)**: Bash 규칙은 명령 텍스트에 맞출 뿐이고 프로그램 둘레의 보안 경계가 아니다. `Bash(curl *)` deny는 `/usr/bin/curl ...`이나 `sh -c 'curl ...'`을 막지 못한다. 문서는 텍스트와 무관한 강제가 필요하면 샌드박스를 쓰라고 한다.
- `ls`, `cat`, `head`, `tail`, `grep`, `find`, `wc` 같은 내장 읽기 전용 명령은 어느 모드에서나 묻지 않고 실행된다(설정 불가). 막으려면 ask·deny 규칙을 따로 둬야 한다.
- 리다이렉션 `> file`은 `Edit` 규칙과 작업 디렉터리로 검사하고, `< file`은 `Read` 규칙으로 검사한다(`2.1.257`부터). `tee` 대상 검사는 `2.1.269`부터다.
- `dontAsk` 모드에서는 허용 규칙에 없는 명령이 모두 거부된다. [문서: permissions 모드 표]

**샌드박스** [문서: sandboxing, settings-reference]
- 기본은 꺼짐. `sandbox.enabled: true`로 켠다. macOS는 Seatbelt, Linux·WSL2는 bubblewrap, 네이티브 Windows는 샌드박스 없음. 오픈소스 `@anthropic-ai/sandbox-runtime` 위에 만들었다.
- 대상은 Bash·PowerShell·Monitor 명령과 **그 자식 프로세스 전부**다. Read·Edit·WebFetch 같은 내장 도구, 훅, **로컬 MCP 서버**, LSP, 상태 줄, `apiKeyHelper`는 샌드박스 밖에서 사용자 권한으로 돈다.
- 쓰기 기본값: 작업 디렉터리, 사용자별 임시 폴더(`$TMPDIR`을 그곳으로 바꿈), **`--add-dir`로 더한 디렉터리**. 보호 경로(`.claude/settings*`, `.mcp.json`, `.claude/hooks`, `.git/hooks` 등)는 쓰기 거부. `filesystem.allowWrite`/`denyWrite`로 조정.
- 읽기 기본값: **거의 전부**(`~/.ssh`, `~/.aws/credentials` 포함). `filesystem.denyRead`/`allowRead`, `credentials.files`, `permissions.blockReadsOutsideWorkingDirectories`로 좁힌다.
- 네트워크: 직접 경로 없음. 로컬 프록시가 허용 도메인(처음엔 비어 있음)으로 판정한다. 허용 목록 밖의 호스트는 `dontAsk`에서 거부된다. `network.strictAllowlist: true`를 사용자·관리·`--settings`에 두면 어느 모드에서나 거부한다(`2.1.219`부터). UDP·QUIC·ICMP는 나가지 못하고, 프록시 변수를 무시하는 도구(일반 `ssh`, DB 드라이버)는 허용 호스트에도 못 붙는다.
- 탈출구: 샌드박스에서 실패한 명령을 Claude가 `dangerouslyDisableSandbox`로 다시 시도할 수 있다. `dontAsk`에서는 거부되지만, **그 명령에 맞는 허용 규칙(예: `Bash(curl *)`)이 있으면 묻지 않고 샌드박스 밖에서 실행된다.** `allowUnsandboxedCommands: false`로 이 재시도를 끌 수 있다. 이것을 `--settings`로 주면 샌드박스가 "관리자 필수"가 되어 저장소 설정이 샌드박스를 넓히지 못한다(`2.1.285`부터).
- `excludedCommands`에 맞는 명령은 샌드박스 밖에서 제한 없이 돈다. 문서는 이것이 편의이지 보안 경계가 아니라고 한다.
- 샌드박스를 시작할 수 없으면 기본은 **샌드박스 없이 실행**한다. `failIfUnavailable: true`를 줘야 시작 단계에서 오류로 끝난다.
- `autoAllowBashIfSandboxed`(기본 `true`)면 샌드박스 안 명령은 묻지 않고 실행된다. 이때도 deny 규칙과 내용이 있는 ask 규칙은 적용된다.
- **비대화형(`-p`) 동작**: 샌드박스 문서는 승인 동작을 "대화형 터미널 세션" 기준으로 설명한다. `-p`에서 샌드박스가 다르게 동작한다는 언급은 없지만, `-p`에서 같다고 명시한 문장도 찾지 못했다. → **실측 필요**.

### Codex

**셸 실행** [바이너리][문서]
- Codex는 원래 셸 명령으로 일한다. `codex exec`의 기본 샌드박스는 `read-only`이고, 이 상태에서도 명령은 실행된다(쓰기·네트워크만 막힘). 앱은 이미 이 모드로 셸 명령을 실행하고 있다.
- `-s, --sandbox <read-only|workspace-write|danger-full-access>` [바이너리]. 다만 **권한 프로필과 옛 샌드박스 설정은 섞이지 않는다.** `--sandbox`를 넘기거나 `sandbox_mode`가 어디에든 있으면 Codex는 `default_permissions`를 무시하고 옛 설정을 쓴다. [문서: permissions] 앱은 지금처럼 프로필만 쓰고 `--sandbox`는 넘기지 말아야 한다.
- 승인 정책: `exec`에는 `-a/--ask-for-approval` 플래그가 없다. 최상위 `codex`에는 있다(`on-request`, `never`). [바이너리] 문서는 비대화형에는 `never`를 쓰라고 한다. `exec`에서는 `-c approval_policy="never"`로 넘길 수 있을 것으로 보이지만 실측하지 않았다. [문서][추론]
- `--add-dir <DIR>`은 "주 작업 공간과 함께 **쓰기 가능한**" 디렉터리다. [바이너리]

**명령 단위 허용·거부(rules)** [문서: rules]
- `.rules` 파일(Starlark `prefix_rule`)로 명령 접두사에 `allow`/`prompt`/`forbidden`을 건다. 여기서 `allow`는 **"샌드박스 밖에서 묻지 않고 실행"**이라는 뜻이다. 셸 문자열은 단순한 연결(`&&`, `||`, `;`, `|`)일 때만 나눠서 본다.
- 규칙 파일은 설정 층의 `rules/` 폴더(예: `~/.codex/rules/`)에서만 읽는다. 앱은 `--ignore-rules`로 사용자·프로젝트 규칙을 끄고 있다. `-c`로 규칙을 인라인으로 넘기는 방법은 **확인 못 함**.

**샌드박스(권한 프로필)** [문서: permissions, 베타 표기]
- 내장 프로필은 `:read-only`, `:workspace`, `:danger-full-access`다. 사용자 프로필은 `extends`로 내장 프로필을 이어받을 수 있다. `:workspace`를 이으면 작업 루트의 `.git`·`.agents`·`.codex`·`.aws`가 읽기 전용으로 유지된다.
- 파일 시스템 값은 `read`/`write`/`deny`다. 더 구체적인 경로가 이기고, 같은 경로에서는 `deny` > `write` > `read`다. 경로 형식은 `:root`, `:minimal`, `:workspace_roots`, `:tmpdir`, `:slash_tmp`, 절대 경로, `~/` 경로다.
- 네트워크는 `permissions.<이름>.network.enabled`(기본 `false`)와 `features.network_proxy`가 **따로** 움직인다.
  - 네트워크 끔: 모든 접속 차단.
  - 네트워크 켬 + 프록시 끔: **제한 없는 직접 접속**. 도메인 규칙은 무시된다.
  - 네트워크 켬 + 프록시 켬: 도메인 규칙 적용. 허용 항목이 없으면 외부를 모두 막는다.
- 프록시가 켜져 있으면 로컬·사설망을 기본으로 막는다. `localhost`·`127.0.0.1`은 정확히 허용 목록에 넣어야 하고, 사설 IP로 풀리는 호스트명까지 허용하려면 `allow_local_binding = true`가 필요하다. Unix 소켓은 `network.unix_sockets`로 경로별로 허용한다.
- macOS에서 정책을 Seatbelt로 강제할 수 없으면 Codex는 **샌드박스 없이 실행하지 않고 거부**한다. [문서]
- 프로필이 다스리지 않는 것: 웹 검색, 앱·커넥터, **MCP 서버**, 브라우저·Computer Use, Codex 서비스 통신. [문서]
- 바이너리 안에 `network_proxy`, `glob_scan_max_depth`, `enabled_tools`, `allow_local_binding`, `unix_sockets` 문자열이 있다. [문자열]

---

## 2. 브라우저 재현

### Playwright를 명령으로(`npx playwright`)

- 셸 명령이므로 각 CLI의 샌드박스 안에서 돈다. [문서]
- Claude 문서는 `allowMachLookup` 설명에서 "iOS Simulator나 **Playwright**처럼 XPC로 통신하는 도구는 여기에 서비스를 적어야 한다"고 한다. 어떤 서비스 이름이 필요한지는 문서에 없다. → **확인 못 함**
- `npx`는 Bash 규칙에서 벗겨지지 않으므로 `Bash(npx playwright *)`처럼 안쪽 명령까지 적어야 한다. [문서]
- 브라우저 바이너리 다운로드(`npx playwright install`)에는 네트워크가 필요하다. 이미 깔려 있지 않으면 허용 도메인이 필요하다. 필요한 도메인은 **확인 못 함**. [추론]
- dev 서버와 브라우저를 함께 쓰려면 localhost 접속이 필요하다.
  - Claude(macOS): `sandbox.network.allowLocalBinding: true`. 포트를 열 수 있고 localhost의 **모든** 포트에 접속할 수 있다. Linux에서는 효과가 없고 명령마다 localhost가 따로다. [문서]
  - Codex: 프록시가 켜져 있으면 `"localhost"`·`"127.0.0.1"`을 `network.domains`에 허용. [문서] 프록시 없이 네트워크를 켜면 localhost를 포함해 모든 곳이 열린다.

### Playwright를 MCP 서버로

**Claude Code에서 특정 MCP만 허용하기** [바이너리][문서]
- `--mcp-config <JSON 파일 또는 문자열>` + `--strict-mcp-config`면 넘긴 서버만 쓴다. 비대화형 `-p`는 작업 공간 신뢰 확인을 건너뛴다.
- `--restricted`는 MCP 서버를 막지 않는다(도움말: "add `--strict-mcp-config` to skip MCP servers too"). 지금은 `--strict-mcp-config`에 서버를 하나도 주지 않아서 MCP가 0개다.
- 권한 규칙
  - **deny가 allow보다 우선한다.** 그래서 지금의 `--disallowedTools mcp__*`를 둔 채 `mcp__playwright__*`를 허용할 수는 없다. `mcp__*` deny를 빼고 허용할 서버만 적어야 한다. `--strict-mcp-config`가 다른 서버를 아예 싣지 않으므로 서버 단위 차단은 그것으로 대신할 수 있다. [문서][추론]
  - 허용 규칙의 도구 이름 glob은 `mcp__<서버>__` 접두사 뒤에서만 쓸 수 있다(예: `mcp__playwright__*`). `"mcp__*"`처럼 서버를 정하지 않은 허용 glob은 무시된다.
  - 도구 단위 거부는 `mcp__playwright__browser_run_code_unsafe`처럼 전체 이름으로 적는다. MCP 도구의 인수 매칭 deny는 `--disallowedTools`로만 넘길 수 있고, 설정 파일에 있으면 건너뛴다.
  - `--tools`는 MCP 도구에 영향이 없다.
  - `-p`의 `dontAsk`에서는 허용 규칙 없는 MCP 호출이 거부된다. `requiresUserInteraction` 표시가 있는 MCP 도구는 허용해도 거부된다.
- **MCP 서버 프로세스는 샌드박스 밖에서 사용자 권한으로 돈다.** [문서: sandboxing "What runs outside the sandbox"]
- `stream-json`의 `system/init` 이벤트에 `mcp_server_errors`가 있어 서버가 안 떴는지 알 수 있다. [문서: mcp]

**Codex에서 특정 MCP만 허용하기** [문서: config-reference, mcp]
- `mcp_servers.<id>.command`/`args`/`env`, `enabled`, `required`, `enabled_tools`(허용 목록), `disabled_tools`(`enabled_tools` 뒤에 적용하는 거부 목록), 도구별 `approval_mode`가 있다.
- `--ignore-user-config`로 사용자 설정의 MCP는 안 실린다. `-c mcp_servers.playwright.command="npx"` 같은 인라인 정의가 `exec`에서 통하는지는 실측하지 않았다. [추론]
- `required = true`인 서버가 시작에 실패하면 `codex exec`는 오류로 끝난다. [문서: non-interactive-mode]
- MCP 서버는 프로필 네트워크 프록시의 대상이 아니다. [문서: permissions]
- 승인 정책 `never`에서 MCP 도구 승인이 어떻게 처리되는지는 **확인 못 함**.

**Playwright MCP 자체의 위험** [문서: microsoft/playwright-mcp README]
- `browser_run_code_unsafe`: "Playwright 서버 프로세스에서 임의의 JavaScript를 실행하며 RCE와 같다." 샌드박스 밖 프로세스이므로 `.env`를 포함한 모든 파일을 읽고 아무 곳으로나 보낼 수 있다. → **반드시 이름을 지정해 거부**해야 한다(Claude는 deny 규칙, Codex는 `disabled_tools`).
- `browser_file_upload`도 로컬 파일을 페이지로 올릴 수 있다. 거부 후보다. [추론]
- 파일 접근은 기본으로 작업 공간 루트(설정이 없으면 cwd)로 제한되고 `file://` 이동은 막힌다. `--allow-unrestricted-file-access`로 풀 수 있다.
- `--allowed-origins`/`--blocked-origins`는 "보안 경계가 아니며 리다이렉트에 영향이 없다"고 명시돼 있다.
- `--isolated`(프로필을 메모리에만 둠), `--headless`, `--output-dir` 옵션이 있다.

---

## 3. 모바일 재현

| 도구 | 동작 방식 | Claude Code 샌드박스 | Codex 권한 프로필 |
| :- | :- | :- | :- |
| `xcrun simctl` | CoreSimulator 서비스(XPC)에 요청. 시뮬레이터 프로세스는 서비스가 띄움 | `sandbox.network.allowMachLookup: ["com.apple.CoreSimulator.*"]`가 문서 예시다. 바이너리에 같은 문자열이 있다 [문서][문자열] | 설정 키를 문서에서 못 찾음. main의 Seatbelt 기본 정책은 mach-lookup을 `opendirectoryd.libinfo`, `PowerManagement.control` 등 몇 개만 허용하고 CoreSimulator는 없다. 설치본에도 `CoreSimulator` 문자열이 없다 [소스][문자열] → 샌드박스 안에서는 실패할 것으로 보인다 [추론] |
| `adb` | adb 클라이언트가 localhost TCP 5037의 adb 서버에 붙는다. 서버가 없으면 데몬으로 띄운다 | macOS에서는 `allowLocalBinding: true`가 필요하다 [추론]. 데몬은 샌드박스 안에서 뜨므로 샌드박스 경계를 그대로 물려받는다 [문서: 자식 프로세스 상속] | 프록시를 켜면 로컬은 기본 차단이다. adb는 HTTP 프록시를 쓰지 않는 직접 TCP라 `localhost` 허용으로 풀리는지 **확인 못 함** |
| `emulator` | QEMU 기반 프로세스. GPU·하이퍼바이저 접근 | **확인 못 함** | **확인 못 함** |

추가 사실
- Claude 문서는 `allowMachLookup`에 적은 서비스에 대해 "샌드박스 명령이 샌드박스 밖으로 닿고, 그 서비스가 해 주는 일은 샌드박스가 가두지 못한다"고 경고한다. CoreSimulator는 앱 설치·실행을 대신 해 주므로 **코드 실행 격리가 사실상 약해진다**. [문서][추론]
- `open`·`osascript`(Apple Events)는 기본 차단이다. `allowAppleEvents`로 열 수 있지만, 문서는 이것이 "코드 실행 격리를 없앤다"고 한다. 사용자·관리·CLI 설정에서만 받는다. [문서] `simctl`은 이것이 필요 없을 것으로 보이나 **확인 못 함**.
- Codex의 `:minimal` 읽기만으로는 Xcode 도구가 부족하다. 실측에서 `/usr/bin/python3`(xcrun 스텁)이 `$TMPDIR`에 캐시를 못 만들어 `couldn't create cache file ... Operation not permitted`를 냈다. 다만 실행 자체는 계속됐다. Xcode·Android SDK 경로(`~/Library/Android/sdk`, `/Applications/Xcode.app`)를 읽기에 더하고 `:tmpdir` 쓰기가 필요할 것으로 보인다. [실측][추론]
- 이 PC 경로: `/usr/bin/xcrun`, `~/Library/Android/sdk/platform-tools/adb`, `~/Library/Android/sdk/emulator/emulator`. [실측: `which`]
- 대안: Claude의 `excludedCommands: ["xcrun simctl *", "adb *"]`로 샌드박스 밖에서 실행할 수 있다. Codex는 rules의 `allow`(샌드박스 밖 실행)가 같은 역할이다. 둘 다 그 명령에는 파일·네트워크 제한이 전혀 없다. [문서]

---

## 4. 실행 위치

### git worktree / 임시 사본

- **Claude Code `-w, --worktree [name]`**: `<repo>/.claude/worktrees/<name>`에 만든다. `-p`는 신뢰 확인 없이 진행하지만 **끝나도 정리하지 않고 잠금도 남긴다.** 직접 `git worktree unlock` 후 `git worktree remove`를 해야 한다. [바이너리][문서: worktrees] 원본 저장소 안에 폴더가 생기므로 앱이 직접 사본을 만들어 cwd로 주는 편이 통제가 쉽다. [추론]
- **Codex `exec --worktree`**: "새 관리형 Git worktree에서 실행". [바이너리] CLI에서 만드는 위치와 정리 방식은 문서에서 찾지 못했다(worktree 문서는 데스크톱 앱 기준). → **확인 못 함**
- 직접 만드는 방법: 앱이 `git worktree add`(또는 복사)로 사본을 만들고 Claude는 cwd, Codex는 `-C`로 넘긴다.
- gitignore된 파일(`.env` 등)은 worktree에 따라오지 않는다. 비밀 노출은 줄지만, dev 서버가 `.env` 없이 뜨지 않을 수 있다. Claude는 `.worktreeinclude`로 gitignore 파일을 복사하는 기능을 문서에 적고 있다. [문서][추론]

### 쓰기 범위를 사본으로 한정

- **Claude Code**
  - 샌드박스 쓰기 기본값은 cwd + 임시 폴더 + **`--add-dir` 디렉터리**다. 다른 저장소를 `--add-dir`로 붙이면 그 저장소도 **쓰기 가능**해진다. 읽기만 시킬 저장소는 `sandbox.filesystem.denyWrite`에 넣어야 한다. [문서][추론]
  - cwd가 linked worktree면 샌드박스가 **원본 저장소의 공유 `.git`에 쓰기를 허용**한다(`hooks/`, `config`는 계속 거부). `git commit`이 원본의 ref를 바꿀 수 있다는 뜻이다. [문서]
  - 내장 Edit·Write 도구는 샌드박스가 아닌 권한 규칙을 따른다. `--restricted`가 파일 도구를 작업 디렉터리로 묶는다. `permissions.blockWritesOutsideWorkingDirectories`(`2.1.314`부터)는 Write·Edit·NotebookEdit만 묶고 셸은 묶지 않는다. [문서][바이너리]
- **Codex**
  - 지금 프로필의 `":workspace_roots" = {"." = "write"}`로 바꾸면 **모든 작업 루트**가 쓰기 가능해진다. 사본만 쓰게 하려면 사본을 절대 경로로 `"<사본>" = "write"`로 두고 나머지 루트는 `read`로 둔다(절대 경로 항목은 하위 경로도 지정 가능). [문서][추론]
  - `:workspace`를 이으면 `.git` 쓰기가 막힌다. 실측에서는 `extends` 없이 `"." = "write"`만 준 프로필에서도 `.git/x` 쓰기가 `Operation not permitted`였다. 보호 경로가 기본 적용되는 것으로 보인다. [실측][문서: 보호 경로]
  - `.git`이 포인터 파일(worktree)이면 그 대상 git 디렉터리도 읽기 전용으로 보호된다. [문서]
  - `--add-dir`은 쓰기 가능 디렉터리를 더한다. 읽기 전용 저장소에 쓰면 안 된다. [바이너리]

---

## 5. 장시간 실행

### Claude Code [문서: tools-reference, headless, cli-reference]
- 포그라운드 명령: 기본 2분(`BASH_DEFAULT_TIMEOUT_MS`), 최대 10분(`BASH_MAX_TIMEOUT_MS`). 시간이 다 되면 멈추지 않고 **백그라운드로 옮긴다**(`sleep`으로 시작하는 명령 제외). `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`이면 옮기지 않고 멈춘다.
- `run_in_background: true`로 dev 서버를 띄울 수 있다. `-p` 텍스트 프롬프트 실행에서는 백그라운드 명령 시간 제한이 **10분**(최대 2시간)이다.
- **`-p`는 메인 대화가 띄운 백그라운드 명령이 끝나거나 시간 제한에 닿을 때까지 결과 뒤에도 열려 있다.** 앱의 실행 제한 시간(초안 10분)과 부딪칠 수 있다. 일반 대기 상한은 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`(기본 10분)다.
- 백그라운드 명령은 `Bash(run_in_background:true)` 규칙으로 따로 막거나 허용할 수 있다. Monitor 도구는 샌드박스 안에서 돌지만 자동 허용되지 않는다.
- 턴·비용 상한: `--max-turns`, `--max-budget-usd`(`-p` 전용. 상한에 닿으면 남은 백그라운드 작업을 멈춤).
- SIGTERM: 종료 코드 143. 실행 중인 Bash 명령의 프로세스 트리를 끝내고 `SessionEnd` 훅을 돌린 뒤 나간다.
- 앱은 SIGKILL을 프로세스 그룹에 보낸다. Claude Code가 백그라운드 명령을 같은 그룹에 두는지, 새 세션(`setsid`)으로 떼는지는 **확인 못 함**. SIGKILL이면 Claude의 자식 정리 루틴이 돌 기회가 없다. [추론]

### Codex [바이너리][문서]
- `exec` 도움말에 턴 수나 시간 제한 플래그가 없다. [바이너리]
- 명령 실행은 재개 가능한 unified exec가 기본이다(`features.unified_exec`, "stable; enabled on all platforms. User opt-outs are ignored"). 백그라운드 터미널을 폴링하는 창은 `background_terminal_max_timeout`(기본 300000ms)이다. [문서]
- `exec`가 끝날 때 백그라운드 터미널 프로세스를 정리하는지는 **확인 못 함**.

### 공통
- 시뮬레이터(CoreSimulator가 launchd 아래에서 띄움)와 adb 서버(스스로 데몬이 됨)는 CLI 프로세스 그룹 밖에서 살아남는다. 앱의 `killTree`로는 끝나지 않는다. 실행 뒤 `xcrun simctl shutdown`/`adb kill-server` 같은 정리 단계가 따로 필요하다. [추론]

---

## 6. 비밀 보호

### 실측: Codex 권한 프로필은 셸 경유 읽기를 OS 수준에서 막는다 [실측]

임시 폴더에 가짜 `.env`, `sub/.env`, `ok.txt`를 두고 다음 프로필로 `codex sandbox`를 실행했다(모델 호출 없음).

```
codex sandbox -C <임시폴더> \
  -c 'permissions.t.filesystem={":minimal"="read", ":workspace_roots"={"."="write", "**/.env"="deny"}}' \
  -P t -- /bin/sh -c '...'
```

| 시도 | 결과 |
| :- | :- |
| `cat .env`, `cat sub/.env` | `Operation not permitted`, 종료 코드 1 |
| `python3 -c 'open(".env")'` | `PermissionError: [Errno 1] Operation not permitted` |
| `grep -r DUMMY .` | 두 `.env` 모두 `Operation not permitted` |
| `cat ok.txt` | 성공 |
| `echo hi > new.txt` | 성공(쓰기 허용) |
| `echo x > .git/x` | `Operation not permitted` |
| `curl https://example.com` | 종료 코드 6(DNS 실패, 네트워크 차단) |

한계 [문서: permissions]
- 이 차단은 **macOS 기준**이다. Linux·WSL·Windows에서는 deny glob을 **프로세스 시작 때 한 번 펼친다.** 그 뒤 새로 생긴 `.env`는 오래 도는 프로세스(dev 서버 등)가 읽을 수 있다.
- 앱의 deny 규칙은 `:workspace_roots` 아래에만 걸린다. 작업 루트 밖(`~/.ssh` 등)은 지금 `:minimal`만 읽기라서 막혀 있다. 읽기 범위를 넓히면 그 경로의 비밀 파일도 따로 막아야 한다.
- MCP 서버는 이 프로필 밖이다.
- 환경 변수: `shell_environment_policy.ignore_default_excludes`의 기본값이 `true`라서 이름에 KEY·SECRET·TOKEN이 든 변수도 **자식 명령에 그대로 넘어간다.** `false`로 둬야 자동 제외가 켜진다. `inherit = "core"|"none"`, `include_only` 같은 다른 필터도 있다. [문서: config-reference]

### Claude Code

- **샌드박스 없이 Bash만 열면** [문서: permissions]
  - `Read`/`Edit` deny는 내장 파일 도구, `cat`·`head`·`tail`·`sed`·`tee` 같은 **Claude Code가 알아보는 파일 명령**, 리다이렉션 대상에 걸린다.
  - 반대로 파일 이름을 적지 않는 명령(예: 그 폴더에서 `grep -r pattern .`)과, 스스로 파일을 여는 Python·Node 스크립트에는 **걸리지 않는다.** 문서는 OS 수준 차단이 필요하면 샌드박스를 켜라고 한다.
  - 결론: `cat .env`는 막히지만 `node -e "console.log(require('fs').readFileSync('.env','utf8'))"`나 `npm run` 안의 스크립트는 못 막는다.
- **샌드박스를 켜면**
  - `Read` deny 규칙은 샌드박스 `denyRead`에, `Edit` deny 규칙은 `denyWrite`에 **합쳐진다.** [문서: settings-reference `sandbox.filesystem`] macOS에서는 `*`, `?`, `**` 와일드카드가 네 목록 모두에서 통한다. Linux·WSL2에서는 `/**/*.pem`처럼 첫 디렉터리 이름 앞의 와일드카드가 **아무것도 막지 못한다.** [문서: Sandbox path prefixes]
  - 앱의 규칙은 `Read(//**/<패턴>)`, 곧 **파일 시스템 루트 기준 어디서나**다. 샌드박스에 합쳐지면 `/**/*.pem`, `/**/.git/**`, `/**/.npmrc` 같은 것이 **시스템 전체에 걸린다.** 그러면 다음과 같은 부작용이 날 수 있다. [추론, 실측 필요]
    - TLS 인증서 묶음(예: `/etc/ssl/cert.pem`)을 못 읽어 `curl`·`npm`·`node`의 HTTPS가 깨질 수 있다.
    - 모든 `.git/**` 읽기가 막혀 `git status`·`git diff` 같은 git 명령이 실패할 수 있다.
    - `~/.npmrc`를 못 읽어 사설 레지스트리 설치가 실패할 수 있다(의도한 동작일 수도 있다).
  - 재현용 규칙은 범위를 작업 루트로 좁힌 별도 형식이 필요할 수 있다.
  - 와일드카드 `denyRead`가 디렉터리에 맞으면 그 안도 막는다. macOS에서 와일드카드 deny가 더 넓은 `allowRead`에 다시 열리던 문제는 `2.1.236`에서 고쳐졌다. [문서]
  - 내장 Read 도구는 `denyRead`의 영향을 받지 않고, 계속 권한 규칙을 따른다. [문서]
  - 샌드박스 밖에서 도는 것(MCP 서버, 훅, `excludedCommands`, 샌드박스 밖 재시도)에는 OS 차단이 없다. 그래서 `allowUnsandboxedCommands: false`, 짧은 `excludedCommands`, MCP 도구 거부가 함께 필요하다. [문서][추론]
- **환경 변수**: 샌드박스 명령은 Claude Code의 환경을 비밀까지 그대로 물려받는다. `sandbox.credentials.envVars`(`mode: deny`면 실행 전에 지움), 또는 모든 자식 프로세스에 거는 `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB`가 있다. 기본 내장 비밀 목록은 없다. [문서]
- **`credentials.files`**: `deny`는 `denyRead`와 같다. `mask`는 macOS에서 파일을 아예 못 읽게 한다. `--settings`에서도 받는다. [문서]

### 정리: `cat .env` 우회를 막을 수 있는가

| 조건 | `cat .env` | 스크립트로 읽기 | 비고 |
| :- | :- | :- | :- |
| Claude, Bash만 허용(샌드박스 없음) | 막힘 [문서] | **안 막힘** [문서] | 규칙은 명령 텍스트 기준 |
| Claude, 샌드박스 + Read deny | 막힘(OS) [문서] | 막힘(OS) [문서] | 샌드박스 밖 프로세스는 예외. Linux에서 루트 앞 glob은 무효 |
| Codex, 권한 프로필 deny | 막힘 [실측] | 막힘 [실측] | Linux 등은 시작 시점 스냅숏. MCP는 예외 |
| 두 CLI의 MCP 서버(Playwright 등) | 해당 없음 | **안 막힘** | 샌드박스 밖. `browser_run_code_unsafe`는 RCE |

---

## 7. 버전 하한

현재 하한: Claude `2.1.259`, Codex `0.162.1`. 설치본: Claude `2.1.322`, Codex `0.167.1`.

### Claude Code [문서. 별도 표시가 없으면 문서에 적힌 "vX 이상"]

| 기능 | 버전 | 현재 하한과 비교 |
| :- | :- | :- |
| `--restricted` | 2.1.248 | 안 |
| `--permission-prompts` | 2.1.259 | 같음(현재 하한의 근거) |
| `sandbox.enabled`·`filesystem`·`allowedDomains`·`excludedCommands`·`allowUnsandboxedCommands`·`failIfUnavailable` 기본 기능 | 도입 버전 **확인 못 함**(문서에 표기 없음) | 2.1.322 바이너리에 키 문자열 있음 [문자열] |
| `network.strictAllowlist` | 2.1.219 | 안 |
| `WebFetch(domain:*)` 맨 `*`가 샌드박스에 반영 | 2.1.186 | 안 |
| macOS 와일드카드 `denyRead` 수정 | 2.1.236 | 안 |
| 트레일링 슬래시 `denyRead` 수정 | 2.1.224 | 안 |
| `--setting-sources`로 뺀 출처의 샌드박스 항목 무시 | 2.1.246 | 안 |
| 입력 리다이렉션(`< file`) Read 검사 | 2.1.257 | 안 |
| `tee` 대상 Edit 검사 | **2.1.269** | 하한보다 높음 |
| `ps` 환경 변수 출력 검사(대시 형식) | 2.1.290 | 하한보다 높음 |
| `--settings`의 `allowUnsandboxedCommands:false` → 관리자 필수 샌드박스(저장소 설정이 샌드박스를 못 넓힘) | **2.1.285** | 하한보다 높음. 다만 `--restricted`가 저장소 설정을 이미 무시함 |
| `permissions.blockWritesOutsideWorkingDirectories` | **2.1.314** | 하한보다 높음 |
| `sandbox.network.allowMachLookup`, `allowLocalBinding`, `allowUnixSockets` | **확인 못 함** | 2.1.322에 문자열 있음 [문자열] |
| `allowNestedUserNamespaces`(Linux Chromium) | 2.1.305 | macOS에는 무관 |

`--restricted`와 `--tools`의 조합으로 Bash를 남기는 동작은 2.1.322 도움말에서 확인했다. 언제부터 그랬는지는 확인 못 함. [바이너리]

### Codex

| 기능 | 버전 | 현재 하한과 비교 |
| :- | :- | :- |
| 권한 프로필 | 문서는 관리 설정 전환 맥락에서 "0.138.0 이상"을 언급 [문서] | 안. 베타 표기 |
| `exec --worktree` | 도입 버전 **확인 못 함** | 0.167.1 도움말에 있음 [바이너리] |
| `features.network_proxy`, `network.domains`, `unix_sockets`, `glob_scan_max_depth` | **확인 못 함** | 0.167.1에 문자열 있음 [문자열] |
| `mcp_servers.<id>.enabled_tools`/`disabled_tools` | **확인 못 함** | 0.167.1에 문자열 있음 [문자열] |
| `codex sandbox -P/--log-denials` | **확인 못 함** | 0.167.1 도움말에 있음 [바이너리] |

현재 하한 `0.162.1`은 실측 기반이다. 새 프로필 키(`network`, `features.network_proxy`)를 쓰려면 `0.162.1`에서 다시 실측해야 한다.

---

## 8. 실측이 필요한 항목

결정 전후로 실측할 것이다. 위에서 가장 싼 것부터 적었다.

1. **Codex 정책 시험**(모델 호출 없음): `codex sandbox --log-denials -C <사본> -c <프로필> -P <이름> -- <명령>`으로 다음을 확인한다.
   - `npm test`, `node` dev 서버(포트 열기), `curl localhost`가 되는지
   - `"localhost"="allow"` + `features.network_proxy=true` 조합이 통하는지
   - `xcrun simctl list`의 거부 로그(시뮬레이터 서비스를 깨우므로 사용자 승인 뒤에)
   - `adb devices`(adb 서버 데몬을 띄우므로 사용자 승인 뒤에)
2. **Claude Code 샌드박스의 `-p` 동작**: 모델 호출이 필요하다. 다음을 확인한다.
   - `--restricted --tools Read,Glob,Grep,Bash --permission-mode dontAsk --permission-prompts none --settings '{"sandbox":{...}}'`에서 Bash가 샌드박스 안에서 묻지 않고 도는지
   - `stream-json`에 거부 내역이 `permission_denials`로 오는지
3. **Claude의 `Read(//**/…)` deny가 샌드박스에 합쳐질 때의 부작용**: TLS 인증서, `.git` 읽기, `~/.npmrc`.
4. **Claude의 `allowMachLookup`에 필요한 서비스 이름**: 시뮬레이터와 Playwright Chromium 각각.
5. **프로세스 정리**: Claude·Codex의 백그라운드 명령이 앱의 그룹 SIGKILL로 함께 끝나는지. 시뮬레이터·adb 서버 정리 절차.
6. **Codex `exec`의 `approval_policy`, 인라인 `mcp_servers`, 규칙 인라인 전달** 가능 여부.

## 출처

- Claude Code 문서
  - [Permissions](https://code.claude.com/docs/en/permissions)
  - [Sandboxing](https://code.claude.com/docs/en/sandboxing)
  - [Settings reference](https://code.claude.com/docs/en/settings-reference)
  - [CLI reference](https://code.claude.com/docs/en/cli-reference)
  - [Headless](https://code.claude.com/docs/en/headless)
  - [Tools reference](https://code.claude.com/docs/en/tools-reference)
  - [Worktrees](https://code.claude.com/docs/en/worktrees)
  - [MCP](https://code.claude.com/docs/en/mcp)
  - [Permission modes](https://code.claude.com/docs/en/permission-modes)
- Codex 문서(`developers.openai.com/codex/...` → `learn.chatgpt.com` 308)
  - [Sandbox](https://learn.chatgpt.com/docs/sandboxing)
  - [Permissions](https://learn.chatgpt.com/docs/permissions)
  - [Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security)
  - [Non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode)
  - [Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
  - [Rules](https://learn.chatgpt.com/docs/agent-configuration/rules)
  - [MCP](https://learn.chatgpt.com/docs/extend/mcp)
  - [Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- Codex 소스: [`codex-rs/sandboxing/src/seatbelt_base_policy.sbpl`](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt_base_policy.sbpl), [`seatbelt_network_policy.sbpl`](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt_network_policy.sbpl)
- Playwright MCP: [README](https://github.com/microsoft/playwright-mcp)
- 이 저장소 코드
  - `apps/desktop/src/core/agent/claude-code-executor.ts`
  - `codex-executor.ts`
  - `secret-patterns.ts`
  - `cli-version.ts`
  - `claude-cli.ts`
  - `codex-cli.ts`
  - `node-process-runner.ts`
