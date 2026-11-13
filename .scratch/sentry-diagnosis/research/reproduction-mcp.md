# 재현용 MCP 불러오기와 위험 도구 목록 조사

- 조사일: 2026-11-12
- 티켓: [10 재현용 MCP 불러오기와 위험 도구 목록 조사](../issues/10-reproduction-mcp-research.md)
- 앞선 조사: [재현에 필요한 에이전트 실행 권한 조사](agent-reproduction-permissions.md). 거기서 확인한 사실(샌드박스, `--restricted`의 셸 처리, Playwright MCP 위험 등)은 다시 적지 않는다.
- 대상 버전(이 PC 설치본)
  - Claude Code: `2.1.322 (Claude Code)`
  - Codex CLI: `codex-cli 0.167.1` (소스는 태그 `rust-v0.167.1`, 하한 비교는 `rust-v0.162.1`)
- 조사 방법
  - 공식 문서: Claude Code `code.claude.com/docs/en/{mcp,cli-reference,permissions,env-vars,managed-mcp,plugins/loading,changelog}.md`, Codex `developers.openai.com/codex/{mcp,config-reference,config-advanced,non-interactive-mode,permissions,agent-approvals-security}.md`.
  - 공식 소스: `openai/codex`의 `exec/src/lib.rs`, `config/src/loader/mod.rs`, `core/src/mcp_tool_call.rs`, `codex-mcp/src/mcp/mod.rs`, `cli/src/mcp_cmd.rs`, `rmcp-client/src/stdio_server_launcher.rs`, `rmcp-client/src/oauth.rs`.
  - MCP 서버: 각 공식 저장소의 README·도구 문서·소스(§4 표에 버전 표기).
  - 바이너리 `--help`: `claude --help`, `claude mcp {list,get,add,add-json} --help`, `claude plugin list --help`, `codex mcp {list,get} --help`, `codex exec --help`.
  - **실측(모델 호출 없음)**: 실험용 가짜 MCP stdio 서버(띄워진 PID·PPID·PGID를 파일로 남기고 도구 두 개 `safe_read`(readOnlyHint), `browser_run_code_unsafe`(주석 없음)를 알리는 파이썬 스크립트)와, 요청 본문을 저장하고 500으로 답하는 가짜 모델 API(`127.0.0.1`)를 만들었다. Claude는 임시 `CLAUDE_CONFIG_DIR`, Codex는 임시 `CODEX_HOME`에 가짜 사용자 설정을 두고 돌렸다. Claude는 `stream-json`의 `system/init` 이벤트로, Codex는 가짜 모델 API가 받은 요청 본문(도구 목록·권한 지시문)으로 결과를 읽었다.
  - 하지 않은 것: 실제 MCP 서버 실행, 실제 모델 호출, 사용자 설정 파일 변경, 사용자 계정으로 하는 실행(claude.ai 커넥터 확인 포함). 사용자 설정의 실제 값은 이 문서에 옮기지 않았다.

### 출처 표시

| 표시 | 뜻 |
| :- | :- |
| **[바이너리]** | 설치된 CLI의 `--help` 출력으로 확인 |
| **[실측]** | 이 PC에서 가짜 설정·가짜 서버로 직접 실행해 확인(설치본 버전 기준) |
| **[문서]** | 공식 문서로만 확인 |
| **[소스]** | 공식 저장소 소스로 확인(태그를 적음) |
| **[추론]** | 위 사실에서 끌어낸 판단. 실측 필요 |
| **확인 못 함** | 1차 출처에서 찾지 못함 |

---

## 결정용 요약

### 핵심 사실

1. **Claude: `--restricted`를 유지한 채 사용자 MCP를 플래그로 가져오는 방법은 없다.** `--restricted`만 줘도 user·local·project 범위 MCP가 하나도 실리지 않았다(서버 프로세스도 안 뜸). 반대로 `--mcp-config`로 넘긴 서버는 `--restricted`·`--strict-mcp-config`와 함께 실린다. 따라서 앱이 정의 파일을 읽어 `--mcp-config`로 넘기는 길만 남는다. [실측]
2. **Codex: `--ignore-user-config`를 유지한 채 `-c mcp_servers.<id>=...` 인라인 정의가 `exec`에서 통한다.** 사용자 설정의 `sandbox_mode`·`approval_policy`·`default_permissions`·`mcp_servers`는 섞이지 않았다(모델에 전달된 권한 지시문이 `read-only`·`never`였다). [실측]
3. **Codex `exec`는 승인 정책 기본값이 `never`이고, `never`에서는 "승인이 필요한" MCP 도구 호출이 거부된다.** 기본 승인 모드(`auto`)에서는 `readOnlyHint: true`가 아닌 도구 대부분(주석 없는 도구, 파괴·외부 표시 도구)이 승인 필요로 분류된다. 그러므로 지금 권한 프로필(전체 디스크 쓰기 아님) 그대로면 클릭·입력 같은 조작 도구가 거부될 것으로 보인다. 도구를 쓰게 하려면 `default_tools_approval_mode = "approve"`(또는 도구별 `approval_mode`)를 줘야 한다. [소스][추론]
4. **목록 읽기**: Codex는 `codex mcp list --json`이 있고 서버를 띄우지 않는다. Claude는 `claude mcp list`가 텍스트만 내고 **각 서버를 실제로 띄워 상태를 확인한다**. Claude는 파일(`~/.claude.json`, `.mcp.json`)을 직접 읽는 편이 맞다. 두 CLI 모두 출력에 환경 변수·헤더 값이 그대로 나올 수 있다. [실측][소스]
5. **위험 도구는 이름만으로 다 막을 수 없다.** mobile-mcp의 `mobile_batch_commands`는 같은 서버의 다른 도구를 내부에서 직접 호출하므로 클라이언트 쪽 도구 deny를 우회한다. MobileBuildMCP는 `manage-workflows`로 실행 중에 도구 묶음을 늘린다. [소스][문서]
6. **프로세스 정리**: Claude의 stdio MCP 서버는 CLI와 **같은 프로세스 그룹**이라 앱의 그룹 SIGKILL로 함께 끝났다. Codex의 stdio MCP 서버는 **자기 프로세스 그룹**으로 떠서, CLI 그룹에 SIGKILL·SIGTERM을 보내도 살아남았다(표준 입력이 닫혀도 스스로 끝나지 않는 서버의 경우). [실측]
7. **버전 하한**: 위 수단은 모두 현재 하한(Claude `2.1.259`, Codex `0.162.1`) 안에 있다. 다만 Claude에서 샌드박스 명령이 `--mcp-config` 파일을 고칠 수 있던 문제는 `2.1.309`에서 고쳐졌다. [문서][소스]

### 구현 후보(결정 아님)

| 항목 | Claude Code | Codex |
| :- | :- | :- |
| MCP 정의 가져오기 | 앱이 `~/.claude.json`(또는 `$CLAUDE_CONFIG_DIR/.claude.json`)의 최상위 `mcpServers`(user), `projects["<절대 경로>"].mcpServers`(local), 원본 저장소의 `.mcp.json`(project), 플러그인 정의를 읽어 `--mcp-config`로 넘긴다. `--restricted --strict-mcp-config`는 유지 | 앱이 `codex mcp list --json`(또는 `config.toml`)으로 읽어 `-c 'mcp_servers.<id>={...}'`로 넘긴다. `--ignore-user-config --ignore-rules`는 유지 |
| 넘기는 경로 | JSON 문자열 또는 파일. 파일이면 사본(쓰기 가능 영역) 밖에 둔다(2.1.309 전 버전 문제) | `-c` 인자만 가능(사용자 설정을 무시하므로 프로필 파일도 무시됨). 비밀 값은 `env_vars`·`bearer_token_env_var`로 환경 변수 경유가 후보 |
| 위험 도구 deny | `--disallowedTools 'mcp__*__browser_run_code_unsafe'`처럼 서버 이름과 무관한 glob deny가 통한다 | 서버마다 `mcp_servers.<id>.disabled_tools`. 서버 이름과 무관한 전역 deny는 찾지 못함 |
| 도구 허용 | `dontAsk`이므로 서버마다 `mcp__<서버>__*` 허용 규칙이 필요(서버 미지정 허용 glob은 무시됨) | `never`이므로 서버마다 `default_tools_approval_mode="approve"` 같은 설정이 필요 |
| 프로세스 정리 | 지금의 그룹 SIGKILL로 stdio 서버까지 끝남 | stdio 서버가 별도 그룹. 앱이 죽이기 전에 자손 프로세스를 PPID로 모아 그룹마다 끝내는 방식 등이 필요 |

---

## 1. Claude Code에서 MCP만 가져오기

### 사용자 MCP 정의가 저장되는 곳 [문서: mcp "MCP installation scopes", "Plugin-provided MCP servers", "Use MCP servers from claude.ai"]

| 출처 | 저장 위치·형식 | 비고 |
| :- | :- | :- |
| user 범위 | `~/.claude.json` 최상위 `mcpServers` | `CLAUDE_CONFIG_DIR`을 쓰면 `$CLAUDE_CONFIG_DIR/.claude.json`을 읽는다 [실측: 임시 `CLAUDE_CONFIG_DIR`의 `.claude.json`에서 서버가 실림] |
| local 범위 | `~/.claude.json`의 `projects["<프로젝트 절대 경로>"].mcpServers` | 경로 키라서 원본 저장소 경로로 저장돼 있다. 사본 경로로 실행하면 이 항목이 안 맞는다 [추론] |
| project 범위 | 저장소 루트 `.mcp.json`의 `mcpServers` | `-p`에서는 승인 확인 없이 실린다 [문서][실측: 플래그 없는 `-p`에서 승인 안 된 `.mcp.json` 서버가 `connected`] |
| 플러그인 | 플러그인 루트 `.mcp.json` 또는 `plugin.json`의 `mcpServers`. 플러그인 활성은 설정의 `enabledPlugins`, 설치 정보는 `~/.claude/plugins/installed_plugins.json` | 도구 이름은 `mcp__plugin_<플러그인>_<서버>__<도구>`. `${CLAUDE_PLUGIN_ROOT}`·`${CLAUDE_PLUGIN_DATA}` 치환이 있다 [문서] |
| claude.ai 커넥터 | 파일 없음. claude.ai 구독 로그인일 때 실행 중에 claude.ai에서 받아온다 | `ANTHROPIC_API_KEY`·`apiKeyHelper` 등이 활성이면 아예 안 받아온다. `--mcp-config`로 옮길 정의가 로컬에 없다 [문서] |
| 관리 설정 | `managed-mcp.json`, `managedMcpServers` | `managed-mcp.json`이 배포돼 있으면 `--strict-mcp-config`를 주는 순간 시작 단계에서 종료한다 [문서: managed-mcp] |

- 같은 이름이 여러 곳에 있으면 local > project > user > 플러그인 > 커넥터 순으로 하나만 쓰고 필드를 합치지 않는다. 플러그인·커넥터는 이름이 아니라 엔드포인트(URL·명령)로 중복을 가린다. [문서]
- `/mcp`에서 끈 서버는 `~/.claude.json`의 프로젝트별 `disabledMcpServers`에 기록된다. [문서]

### `--restricted`를 유지한 채 싣기 [실측: 2.1.322]

임시 설정 폴더에 user·local·project 가짜 서버를 하나씩 두고 비교했다.

| 플래그 | 실린 서버(`system/init`의 `mcp_servers`) | 프로세스 실행 |
| :- | :- | :- |
| (없음) | user, project, local 셋 다 | 셋 다 뜸 |
| `--restricted` | **없음** | 하나도 안 뜸 |
| `--restricted --setting-sources user,project,local` | **없음** | 하나도 안 뜸 |
| `--restricted --mcp-config <파일>` | `--mcp-config` 서버만(`source: "dynamic"`) | 그것만 뜸 |
| `--restricted --strict-mcp-config --mcp-config <JSON 문자열>` | `--mcp-config` 서버만 | 그것만 뜸 |

- `claude --help`의 `--restricted` 설명은 "add `--strict-mcp-config` to skip MCP servers too"라고 해서 MCP가 남는 것처럼 읽히지만, 실측에서는 `--restricted`만으로 user·local·project MCP가 빠졌다. 문서(cli-reference)는 MCP에 대해 따로 말하지 않는다. claude.ai 커넥터·플러그인·관리 MCP가 `--restricted`에서 남는지는 **확인 못 함**(사용자 계정이 필요해 실측하지 않음). 앱은 `--strict-mcp-config`를 함께 주므로 이 차이는 결과에 영향이 없다. [바이너리][실측]
- 결론: **플래그만으로 사용자 MCP를 골라 싣는 방법은 없다.** 앱이 정의를 읽어 `--mcp-config`로 넘겨야 한다. [실측]
- `--mcp-config`는 여러 값을 받는 인자라서 프롬프트를 그 뒤에 두면 프롬프트를 설정 파일 경로로 읽는다(`MCP config file not found: .../hi`). 지금 실행기처럼 프롬프트를 표준 입력으로 주거나 `--mcp-config`를 맨 뒤에 둬야 한다. [실측]

### 앱이 정의를 읽어 `--mcp-config`로 넘길 때 생기는 차이

| 항목 | 차이 | 근거 |
| :- | :- | :- |
| 환경 변수 참조 `${VAR}`·`${VAR:-기본값}` | `--mcp-config`로 넘긴 정의에서도 펼쳐진다. 펼침은 **CLI 프로세스의 환경**을 쓴다. 앱이 재현 실행에 최소 환경 변수만 넘기면(05 결정) 사용자의 셸에만 있던 토큰 변수가 비어 서버가 인증에 실패할 수 있다. 원격 서버의 `url`·`headers`에서는 `ANTHROPIC_API_KEY`·`NPM_TOKEN` 등 자격 증명 이름이 항상 빈 값으로 읽힌다 | [실측: `--mcp-config`의 `${FAKENAME:-defaultname}`이 펼쳐짐][문서][추론] |
| OAuth 토큰(원격 HTTP) | Claude는 OAuth 로그인을 "엔드포인트별로" 저장한다고 문서에 적혀 있다. 같은 URL을 `--mcp-config`로 넘기면 저장된 토큰을 쓸 것으로 보이나 실측하지 않았다. `-p`에서는 OAuth 흐름을 돌릴 수 없어, 로그인이 안 된 서버는 쓸 수 없다 | [문서][추론] → **실측 필요** |
| 정적 `headers` | 정의에 값이 그대로 있으므로 그대로 전달된다. 값을 앱이 읽고 인자로 넘기게 된다 | [추론] |
| `headersHelper` | `--mcp-config` 서버의 헬퍼는 세션의 주 작업 디렉터리(=사본)에서 돈다. user 범위는 설정 폴더, project·local은 그 프로젝트 폴더에서 돈다. 상대 경로 헬퍼는 옮기면 깨질 수 있다. `--mcp-config` 서버의 헬퍼는 자격 증명 환경 변수를 지우지 않는다 | [문서: mcp "Where the helper runs", "Which variables a helper can read"] |
| local 범위 | 원본 저장소 절대 경로 키에 있다. 앱이 원본 경로로 찾아야 한다 | [문서][추론] |
| 플러그인 서버 | `${CLAUDE_PLUGIN_ROOT}`·`${CLAUDE_PLUGIN_DATA}`를 앱이 직접 바꿔야 할 것으로 보인다. `claude plugin list --json`의 각 행에 `mcpServers`·`installPath`가 있다. 도구 이름이 `mcp__plugin_...` 대신 앱이 붙인 서버 이름으로 바뀐다 | [실측: 필드 존재만 확인][추론] |
| claude.ai 커넥터 | 로컬 정의가 없어 옮길 수 없다 | [문서] |
| 결과 확인 | `stream-json` `system/init`의 `mcp_servers`(이름·상태·출처)와 `mcp_server_errors`(검증에서 빠진 `--mcp-config` 항목)로 확인할 수 있다 | [실측][문서] |
| 비밀 노출 | JSON 문자열로 넘기면 명령줄 인자에 값이 들어간다. 파일로 넘길 때 그 파일을 쓰기 가능한 사본 안에 두면 2.1.309 전 버전에서는 에이전트가 고칠 수 있었다 | [문서: changelog 2.1.309][추론] |

- MCP 서버 쪽 환경: `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`은 MCP stdio 서버 환경에서도 Anthropic·클라우드 자격 증명을 지운다(2.1.83). stdio 서버는 `CLAUDE_PROJECT_DIR`을 받는다(2.1.139). [문서: changelog]

---

## 2. Codex에서 MCP만 가져오기

### 사용자 MCP 정의가 저장되는 곳 [문서: mcp, config-reference]

- `~/.codex/config.toml`(=`$CODEX_HOME/config.toml`)의 `[mcp_servers.<이름>]`. 신뢰한 프로젝트에서는 `.codex/config.toml`에도 둘 수 있다.
- 필드: stdio는 `command`·`args`·`env`·`env_vars`·`cwd`, HTTP는 `url`·`auth`·`bearer_token_env_var`·`http_headers`·`env_http_headers`·`http_headers_helper`. 공통으로 `enabled`, `required`, `startup_timeout_sec`, `tool_timeout_sec`, `enabled_tools`, `disabled_tools`, `default_tools_approval_mode`, `tools.<도구>.approval_mode` 등.
- 플러그인 MCP는 `plugins.<플러그인>.mcp_servers.<서버>.*`로 켜고 끄며 도구 목록도 조정한다.
- MCP OAuth 자격 증명은 키체인(서비스 이름 `Codex MCP Credentials`) 또는 `$CODEX_HOME/.credentials.json`에 저장되고, 키는 **서버 이름 + URL**로 만든다. [소스: rmcp-client/src/oauth.rs `compute_store_key`]

### `--ignore-user-config` + `-c` 인라인 정의 [실측: 0.167.1]

임시 `CODEX_HOME/config.toml`에 `sandbox_mode = "danger-full-access"`, `approval_policy = "on-request"`, `default_permissions = ":danger-full-access"`, `[mcp_servers.userfake]`를 두고 다음으로 실행했다.

```
codex exec --ignore-user-config --ignore-rules --ephemeral --json --skip-git-repo-check -C <폴더> \
  -c 'mcp_servers.inlinefake.command="python3"' -c 'mcp_servers.inlinefake.args=[...]' \
  -c 'mcp_servers.inlinefake.disabled_tools=["browser_run_code_unsafe"]' ... -
```

- 인라인 서버만 떴고 사용자 설정의 `userfake`는 뜨지 않았다.
- 모델 요청의 도구 목록에 `mcp__inlinefake` 네임스페이스가 있고 그 안에는 `safe_read`만 있었다(`disabled_tools`가 적용됨).
- 모델 요청의 권한 지시문은 "`sandbox_mode` is `read-only` ... Approval policy is currently never"였다. 사용자 설정의 `danger-full-access`·`on-request`가 섞이지 않았다.
- 테이블 한 번에 넘기는 형식 `-c 'mcp_servers.x={command="...",args=[...],env={K="v"},disabled_tools=["..."]}'`도 받아들여진다(`codex mcp list --json -c ...`로 확인).

소스로 본 이유 [소스: rust-v0.167.1 `config/src/loader/mod.rs`, `exec/src/lib.rs`]
- `--ignore-user-config`면 사용자 층(`config.toml`)과 `--profile` 프로필 파일 층을 빈 표로 대신한다. 시스템 층(`/etc/codex/config.toml` 등)과 관리 요구사항(managed requirements), CLI `-c` 층은 그대로 읽는다.
- 프로젝트 층(`.codex/config.toml`)은 프로젝트가 신뢰된 경우에만 읽는다. 신뢰 정보가 사용자 설정(`projects.<경로>.trust_level`)에 있으므로, 사용자 설정을 무시하면 프로젝트 층도 안 실릴 것으로 보인다. [소스][추론]
- `--worktree`는 `--ignore-user-config`와 함께 쓸 수 없다(`--worktree cannot be combined with --ignore-user-config`). [소스]

### 섞여 들어오지 않는지

| 사용자 설정 키 | `--ignore-user-config`에서 | 근거 |
| :- | :- | :- |
| `sandbox_mode` | 안 들어옴 | [실측] |
| `approval_policy` | 안 들어옴(`exec`가 `never`로 덮음) | [실측][소스] |
| `default_permissions` | 안 들어옴 | [실측: `:danger-full-access`를 둬도 `read-only`] |
| `mcp_servers` | 안 들어옴 | [실측] |
| `mcp_oauth_credentials_store` | 안 들어옴. 기본값 `auto`(키체인 우선, 실패 시 파일)로 동작할 것으로 보인다 | [소스][추론] |
| 시스템·관리 설정 | 들어옴 | [소스] |

- 참고(범위 밖 관찰): 임시 `CODEX_HOME`과 `--ignore-user-config`로 돌렸는데도 모델 요청에 사용자 홈의 Skill 목록이 들어 있었다. Skill은 `config.toml`과 별개로 읽히는 것으로 보인다. [실측]

### 승인 정책 `never`에서 MCP 도구 호출 [소스: rust-v0.167.1 `core/src/mcp_tool_call.rs`, `codex-mcp/src/mcp/mod.rs`]

1. `codex exec`는 승인 정책을 `never`로 둔다(`approvals_reviewer = "auto_review"`일 때만 예외). 앱은 승인 정책을 따로 넘기지 않으므로 `never`다. [소스: exec/src/lib.rs "Default to never ask for approvals in headless mode"]
2. 도구 승인 모드가 `approve`면 묻지 않고 실행한다.
3. 승인 정책이 `never`이고 권한 프로필이 꺼짐·외부이거나 **전체 디스크 쓰기**를 가지면 묻지 않고 실행한다. 앱의 프로필은 여기에 해당하지 않는다.
4. 그 밖에는 승인 모드별로 승인 필요 여부를 정한다.
   - `auto`(기본): `destructiveHint: true`면 필요, `readOnlyHint: true`면 불필요, 그 밖에는 `destructiveHint`가 없으면 필요(기본값 `true`), `openWorldHint`가 없거나 `true`여도 필요.
   - `prompt`: 항상 필요. `writes`: `readOnlyHint: true`가 아니면 필요. `approve`: 불필요.
5. 승인이 필요하고 정책이 `never`면 `"MCP tool call requires approval, but approval policy is never"`로 **거부**한다.

- 따라서 Playwright MCP의 `browser_click`처럼 읽기 전용이 아닌 도구는 지금 설정 그대로면 거부될 것으로 보인다. 재현에 쓰려면 서버마다 `default_tools_approval_mode = "approve"`(또는 도구별 `approval_mode`)를 넘겨야 한다. 이 경우 `disabled_tools`가 실질적인 유일한 차단 수단이 된다. [소스][추론] → 모델 호출이 필요해 **실측하지 못함**.
- MCP elicitation(서버가 사용자 입력을 요청)은 `never`에서 자동 거부된다(`approval_policy.granular.mcp_elicitations` 설명). [문서][소스]
- 문서: "도구가 destructive 주석을 알리면 app/MCP 도구 호출은 항상 승인이 필요하다(read 주석이 우선)". [문서: agent-approvals-security]

---

## 3. MCP 서버 목록 읽기

### Claude Code

| 수단 | 출력 | 부작용 | 근거 |
| :- | :- | :- | :- |
| `claude mcp list` | 텍스트만(`<이름>: <명령 또는 URL> - <상태>`). JSON 옵션 없음 | **각 서버를 실제로 띄워 상태를 확인한다**("Checking MCP server health…"). 승인 안 된 `.mcp.json` 서버는 `⏸ Pending approval`로 띄우지 않음. 끈 서버는 `⊘ Disabled`로 띄우지 않음(2.1.238부터) | [바이너리][실측][문서] |
| `claude mcp get <이름>` | 텍스트(Scope, Status, Type, Command, Args, Environment) | 역시 상태를 확인한다. user 범위 stdio 서버의 **환경 변수 값을 그대로 출력**했다. 플러그인 서버만 값을 가린다 | [바이너리][실측][문서] |
| `claude plugin list --json` | 플러그인 배열. 행마다 `enabled`, `id`, `installPath`, `mcpServers`(서버별 `type`·`command`·`args` 등), `projectEnabled`, `scope`, `version` 등 | 서버를 띄우는지는 확인 못 함 | [바이너리][실측: 필드만] |
| 파일 직접 읽기 | `~/.claude.json`(또는 `$CLAUDE_CONFIG_DIR/.claude.json`)의 `mcpServers`, `projects[경로].mcpServers`, `projects[경로].disabledMcpServers`, 저장소 `.mcp.json` | 부작용 없음. 형식이 공개 문서에 예시로 있다 | [문서][실측] |

- 서버 항목 형식: stdio `{type?: "stdio", command, args?, env?}`, HTTP `{type: "http", url, headers?, headersHelper?, oauth?: {clientId, callbackPort, ...}}`, SSE `{type: "sse", ...}`, WebSocket `{type: "ws", ...}`. [문서: mcp "Add MCP servers from JSON configuration"]
- 권한 규칙의 서버 이름은 `.`이나 공백이 `_`로 바뀐다(`my.server` → `mcp__my_server__*`). [문서: permissions]
- claude.ai 커넥터 목록은 파일에 없다. 앱이 읽을 수 있는 공개 명령도 찾지 못했다. → **확인 못 함**

### Codex

| 수단 | 출력 | 부작용 | 근거 |
| :- | :- | :- | :- |
| `codex mcp list --json` | 배열. 항목마다 `name`, `enabled`, `disabled_reason`, `transport`(stdio: `type`·`command`·`args`·`env`·`env_vars`·`cwd` / HTTP: `type: "streamable_http"`·`url`·`bearer_token_env_var`·`http_headers`·`env_http_headers`·`http_headers_helper`), `startup_timeout_sec`, `tool_timeout_sec`, `auth_status` | stdio 서버를 띄우지 않았다. HTTP 서버는 인증 상태를 알아내려고 접속할 수 있다(`compute_auth_statuses`). **`env`와 `http_headers` 값을 그대로 출력**한다(`http_headers_helper`만 `<redacted>`) | [바이너리][실측][소스: cli/src/mcp_cmd.rs] |
| `codex mcp get <이름> --json` | 위 항목 + `enabled_tools`, `disabled_tools` | — | [바이너리][실측] |
| `config.toml` 직접 읽기 | `[mcp_servers.<이름>]` 표 | TOML 파서 필요 | [문서] |

- `codex mcp list`에도 `-c`가 통하므로, 앱이 덮어쓸 값(`enabled=false` 등)을 미리 적용한 목록을 볼 수 있다. [실측]
- 플러그인 MCP 서버가 `codex mcp list`에 함께 나오는지는 소스상 플러그인 관리자를 거치는 것만 확인했다. → **실측 필요**

---

## 4. 기본 deny 목록 후보

결정은 하지 않는다. 아래는 각 서버의 1차 출처에 나온 도구 중 **샌드박스 밖 MCP 프로세스에서 임의 코드 실행, 로컬 파일 읽기·외부 업로드, 파일 시스템 쓰기, 기기 상태 파괴**에 해당하는 것을 고른 후보다. 웹·iOS·Android 조작용으로 저장소 별(stars)이 많고 최근까지 관리되는 것을 골랐다.

### 웹

**Playwright MCP** (`microsoft/playwright-mcp`, README 기준 최신 릴리스 `v0.0.85`) [문서]

| 도구 | 기본 노출 | 위험 | 근거 |
| :- | :- | :- | :- |
| `browser_run_code_unsafe` | 예(Core) | "Playwright 서버 프로세스에서 임의 JavaScript 실행, RCE와 같다". `filename`으로 로컬 파일의 코드도 실행 | README |
| `browser_file_upload` | 예(Core) | 절대 경로 파일을 페이지로 올림(로컬 파일 → 외부) | README |
| `browser_evaluate` | 예(Core) | 페이지 안 JS 실행. 결과를 `filename`으로 파일에 저장 가능. 페이지 쿠키·저장소 읽기 | README |
| `browser_set_storage_state` / `browser_storage_state` | `--caps=storage` | 파일에서 쿠키·저장소 복원 / 파일로 저장 | README |
| `browser_route` | `--caps=network` | 네트워크 응답 위조 | README |
| `browser_pdf_save`, `browser_take_screenshot`(`filename`) 등 | 일부 기본 | 파일 쓰기(기본은 작업 공간 루트로 제한) | README |

- 서버 옵션: 파일 접근은 기본적으로 작업 공간 루트(없으면 cwd)로 제한되고 `--allow-unrestricted-file-access`로 풀린다. `--extension`(사용자의 실행 중인 브라우저와 그 로그인 상태에 붙음), `--cdp-endpoint`, `--user-data-dir`(기본은 영속 프로필), `--isolated`, `--secrets <dotenv 파일>`이 있다. 이 옵션은 사용자 MCP 정의의 `args`에 들어 있으므로 앱이 정의를 넘길 때 그대로 따라온다. [문서][추론]

**Chrome DevTools MCP** (`ChromeDevTools/chrome-devtools-mcp`, `chrome-devtools-mcp-v1.13.0`) [문서: docs/tool-reference.md]

| 도구 | 위험 |
| :- | :- |
| `evaluate_script` | 페이지·서비스 워커에서 JS 실행. `sourcePath`로 **MCP 서버 로컬 파일**을 읽어 실행, `filePath`로 결과를 파일에 씀 |
| `upload_file` | 로컬 파일을 페이지로 올림 |
| `install_extension` 등 | `--categoryExtensions` 필요. 로컬 폴더의 확장 설치 |
| `execute_3p_developer_tool` | `--categoryExperimentalThirdParty` 필요. 페이지가 노출한 도구 실행 |
| `mock_network` | 응답 위조 |

- README 면책: "브라우저 내용을 MCP 클라이언트에 노출해 어떤 데이터든 검사·수정할 수 있다". 성능 도구는 기본으로 trace URL을 Google CrUX API로 보낸다(`--no-performance-crux`로 끔). [문서]

### iOS·Android

**mobile-mcp** (`mobile-next/mobile-mcp`, `1.0.17`, iOS·Android 공용) [문서][소스: src/server.ts]

| 도구 | 위험 |
| :- | :- |
| `mobile_batch_commands` | **같은 서버의 다른 도구 콜백을 MCP 전송을 거치지 않고 직접 호출**한다(`mobile_take_screenshot`과 자기 자신만 제외). 클라이언트에서 다른 도구를 deny해도 이 도구로 우회된다. 자체 주석은 `destructiveHint: true` |
| `mobile_install_app` / `mobile_uninstall_app` / `mobile_clear_app_data` | 로컬 파일(.apk·.ipa·.app·.zip) 설치, 앱 삭제, 앱 데이터 삭제 |
| `mobile_save_screenshot`, `mobile_start_screen_recording` / `stop` | 파일 쓰기 |
| `mobile_login_to_cloud_provider`, `mobile_allocate_remote_device` 등 | 외부 클라우드 기기 사용(계정 인증) |
| `mobile_open_url` | 기본은 http(s)만. `MOBILEMCP_ALLOW_UNSAFE_URLS=1`이면 딥링크 등 허용 |

- 기본으로 사용 통계를 보낸다(`MOBILEMCP_DISABLE_TELEMETRY`로 끔). [소스]

**MobileBuildMCP**(옛 XcodeBuildMCP, `getsentry/MobileBuildMCP`, `v2.7.1`) [문서][소스: manifests/tools/*.yaml]

| 도구 | 위험 |
| :- | :- |
| `debug_lldb_command` | 임의 LLDB 명령(`destructiveHint: true`). 디버깅 workflow에 속함 |
| `xcode_ide_call_tool` | 원격 Xcode IDE MCP 도구 호출(`destructiveHint: true`) |
| `erase_sims` | 시뮬레이터 초기화(`destructiveHint: true`) |
| `manage-workflows` | 실행 중에 workflow(도구 묶음)를 켠다. 기본은 시뮬레이터 workflow만 켜져 있다. 앱이 처음 본 도구 목록에 없던 도구가 나중에 생길 수 있다 |
| `build_*`, `test_*`, `swift_package_run` 등 | 저장소의 빌드 스크립트·코드를 **샌드박스 밖에서** 실행한다. 재현의 본래 목적이라 deny 대상은 아니지만 위험 성격은 같다 [추론] |

- Sentry로 내부 오류 원격 측정을 보낸다(opt-out 있음). [문서]

**ios-simulator-mcp** (`joshuayoes/ios-simulator-mcp`, `v2.2.1`) [문서]
- `install_app`(로컬 `.app`·`.ipa` 설치), `screenshot`·`record_video`(기본 저장 위치 `~/Downloads`, `IOS_SIMULATOR_MCP_DEFAULT_OUTPUT_DIR`로 바꿈).
- 서버 쪽 차단 수단: `IOS_SIMULATOR_MCP_FILTERED_TOOLS`(쉼표 목록)로 도구 등록 자체를 막는다.

**Appium MCP** (`appium/appium-mcp`, `v1.99.3`) [문서]
- `appium_app_lifecycle`(설치·삭제·데이터 삭제, `openWorldHint: true`), `appium_session_management`(`remoteServerUrl`로 임의 원격 Appium/WebDriver 서버 접속), `appium_prepare_ios_real_device`(WDA 내려받아 서명).
- URL 앱 설치가 기본 허용(`ALLOW_REMOTE_APP_URLS=false`로 끔), 원격 서버 URL은 기본 아무거나 허용(`REMOTE_SERVER_URL_ALLOW_REGEX`로 제한).

**Maestro MCP** (`mobile-dev-inc/maestro`, `cli-2.12.1`) [소스: maestro-cli/.../mcp/tools/*.kt]
- `run`: 인라인 YAML 또는 flow 파일 실행.
- `run_on_cloud`: 로컬 앱 바이너리와 flow를 Maestro Cloud로 **업로드**한다.

### 도구 단위로 막는 방법과 한계

**Claude Code** [실측: 2.1.322][문서: permissions]

| 방법 | 결과 |
| :- | :- |
| `--disallowedTools mcp__<서버>__<도구>` | 그 도구가 `init`의 도구 목록에서 빠짐 |
| `--settings '{"permissions":{"deny":["mcp__<서버>__<도구>"]}}'` | 같음(`--restricted`에서도 `--settings`는 적용) |
| `--disallowedTools 'mcp__*__browser_run_code_unsafe'` / 같은 glob의 settings deny | **서버 이름과 무관하게** 그 이름의 도구가 빠짐 |
| `--disallowedTools mcp__<서버>` | 그 서버의 도구 전부가 빠짐 |

- deny가 allow보다 우선한다. deny·ask 규칙은 도구 이름 자리에 glob을 받는다(2.1.166부터). allow 규칙의 glob은 `mcp__<서버>__` 뒤에서만 받고 `mcp__*`처럼 서버를 정하지 않은 allow는 무시된다. 그래서 `dontAsk`에서 MCP 도구를 쓰게 하려면 **서버마다** `mcp__<서버>__*` 허용 규칙이 필요하다. [문서]
- MCP 도구 인수 매칭 deny(괄호 있는 규칙)는 `--disallowedTools`로만 넘길 수 있고 설정 파일에서는 건너뛴다. [문서]
- 플러그인 서버 도구는 `mcp__plugin_<플러그인>_<서버>__<도구>`다. 앱이 `--mcp-config`로 옮기면 앱이 붙인 이름이 된다. [문서][추론]
- 도구에 `_meta["anthropic/requiresUserInteraction"] = true`가 있으면 `dontAsk`에서 거부된다. [문서]

**Codex** [문서: mcp, config-reference][실측]
- `mcp_servers.<id>.disabled_tools`(거부 목록, `enabled_tools` 뒤에 적용), `enabled_tools`(허용 목록). 플러그인 서버는 `plugins.<플러그인>.mcp_servers.<서버>.disabled_tools`. 실측에서 `disabled_tools`에 넣은 도구가 모델 요청의 도구 목록에서 빠졌다.
- 서버 이름과 무관한 전역 도구 deny 설정은 문서에서 찾지 못했다. 앱이 서버마다 `-c 'mcp_servers.<id>.disabled_tools=[...]'`를 넘겨야 한다. 사용자 설정에 이미 `disabled_tools`가 있으면 앱이 합쳐서 넘겨야 덮어쓰지 않는다. [추론]
- `omit_tools_from`은 모델에 보이는 면에서만 빼며, 막으려면 `disabled_tools`를 쓰라고 문서가 적는다. [문서]

**공통 한계**
- 이름 기반이라 **서버 안에서 다른 도구를 부르는 도구**(mobile-mcp `mobile_batch_commands`, Maestro `run`의 flow)는 막지 못한다. 그런 도구 자체를 deny하거나 서버를 끄는 수밖에 없다. [소스][추론]
- 같은 능력을 가진 다른 이름의 도구(예: `browser_evaluate`와 `browser_run_code_unsafe`, 빌드 도구의 임의 코드 실행)는 이름 목록으로 다 덮을 수 없다. [추론]
- 서버가 실행 중에 도구를 늘리면(MobileBuildMCP `manage-workflows`, MCP `list_changed`) 앱이 처음 읽은 목록에 없는 도구가 생긴다. 이름 기반 deny는 이름이 맞으면 적용될 것으로 보이나, 서버별 허용 glob(`mcp__<서버>__*`)·`approve` 모드는 새 도구도 허용한다. [문서][추론]
- 서버 자체 옵션(Playwright `--allow-unrestricted-file-access`·`--extension`, mobile-mcp `MOBILEMCP_ALLOW_UNSAFE_URLS`, ios-simulator-mcp `IOS_SIMULATOR_MCP_FILTERED_TOOLS`)은 정의의 `args`·`env`에 있으므로 앱이 정의를 넘길 때 읽거나 덧붙일 수 있다. [추론]

---

## 5. 프로세스 정리

### 실측 [실측: 모델 호출 없이, 가짜 stdio 서버가 표준 입력이 닫혀도 20초 더 살아 있게 설정]

실험 스크립트가 CLI를 새 세션(=새 프로세스 그룹, 앱의 `detached: true`와 같은 형태)으로 띄우고, 가짜 서버가 뜨면 CLI 그룹에 신호를 보냈다.

| CLI | 서버의 PPID | 서버의 PGID | CLI 그룹에 SIGKILL 후 서버 | CLI 그룹에 SIGTERM, 4초 뒤 서버 |
| :- | :- | :- | :- | :- |
| Claude 2.1.322 (`--restricted --strict-mcp-config --mcp-config`) | CLI | **CLI와 같음** | 죽음 | (안 함) |
| Codex 0.167.1 (`exec --ignore-user-config`, `-c mcp_servers...`) | CLI | **서버 자신의 PID**(별도 그룹), 세션은 CLI와 같음 | **살아 있음** | **살아 있음**(CLI는 끝남) |

- Codex는 stdio MCP 서버를 자기 프로세스 그룹으로 띄우고, 정상 종료 때는 그 그룹에 SIGTERM을 보내고 2초 뒤 SIGKILL한다. CLI가 SIGKILL로 죽으면 이 정리가 돌지 않는다. [소스: rust-v0.167.1 `rmcp-client/src/stdio_server_launcher.rs` `PROCESS_GROUP_TERM_GRACE_PERIOD`][실측]
- 실제 서버가 남는지는 서버 구현에 달렸다. 표준 입력이 닫히면 끝나는 서버는 CLI가 죽을 때 함께 끝나겠지만, 그 서버가 띄운 브라우저·시뮬레이터 같은 자식은 서버의 그룹에 남는다. [추론]
- Claude는 세션이 끝날 때 stdio 서버에 SIGINT → 100ms 뒤 SIGTERM → 400ms 뒤 SIGKILL을 보낸다(macOS·Linux). [문서: mcp "How Claude Code stops a stdio server"]
- Claude 서버의 자식이 스스로 새 그룹·세션을 만들면(예: 데몬화) 그룹 SIGKILL로 끝나지 않는다. [추론]

### 후보(결정 아님)
- Codex: 그룹을 죽이기 전에 CLI의 자손 프로세스를 PPID로 모아 두고, 서로 다른 PGID마다 SIGKILL을 보낸다. CLI가 먼저 죽으면 자손이 launchd(PID 1)로 넘어가 PPID로 찾을 수 없으므로 순서가 중요하다. macOS `ps`의 `sess` 열은 0으로 나와 세션 ID로 찾을 수 없고, `pgrep`에도 세션 필터가 없다. [실측][추론]
- 또는 CLI에 SIGINT·SIGTERM을 먼저 보내 정상 종료를 유도한다. 다만 실측에서 SIGTERM으로는 Codex가 서버를 정리하지 않았다. [실측]

### 원격 HTTP MCP
- 로컬 프로세스가 없으므로 CLI가 죽으면 연결만 끊긴다. 서버 쪽 세션이 언제 정리되는지는 두 CLI 문서 모두 적지 않는다. → **확인 못 함**
- 사용자가 따로 띄워 둔 로컬 HTTP MCP(예: 포트로 띄운 Playwright MCP)는 앱 실행과 무관하게 계속 돌고, 그 안의 브라우저 상태도 실행 사이에 이어진다. [추론]

---

## 6. 버전 하한

현재 하한: Claude `2.1.259`, Codex `0.162.1`.

### Claude Code [문서: changelog, cli-reference]

| 수단 | 생긴·바뀐 버전 | 하한 대비 |
| :- | :- | :- |
| `--mcp-config` | 1.x(초기), 여러 파일 지원도 초기 | 충족 |
| deny 규칙 도구 이름 자리 glob(`mcp__*__<도구>`) | 2.1.166 | 충족 |
| `stream-json` init의 `mcp_server_errors` | 2.1.219 | 충족 |
| `-p`에서 `--mcp-config` 서버 연결을 첫 턴 전에 기다림 | 2.1.221 | 충족 |
| `claude mcp list/get`이 끈 서버를 띄우지 않음 | 2.1.238 | 충족 |
| `headersHelper` 실행 위치·신뢰 규칙 변경 | 2.1.238 | 충족 |
| `--strict-mcp-config`가 실리지 않을 `.mcp.json` 승인을 묻지 않음 | 2.1.246 | 충족 |
| `--restricted` | 2.1.248 | 충족 |
| `claude mcp list/get`이 `${VAR}`로 펼친 비밀을 보여 주던 문제 수정 | 2.1.268 | **하한보다 높음**. 2.1.259~2.1.267에서는 목록 출력에 비밀이 펼쳐져 나올 수 있다 |
| `--strict-mcp-config` + 빈 `--mcp-config`가 첫 턴을 `MCP_TIMEOUT`까지 붙잡던 문제 수정 | 2.1.274 | **하한보다 높음**. 지금 실행기는 `--mcp-config` 없이 `--strict-mcp-config`만 주므로 해당하는지는 확인 못 함 |
| 샌드박스 명령·자동 수락 편집이 `--mcp-config` 파일을 고칠 수 있던 문제 수정 | 2.1.309 | **하한보다 높음**. 파일로 넘길 때는 쓰기 가능 영역 밖에 두거나 JSON 문자열로 넘겨야 한다 |
| `--restricted`만으로 user·local·project MCP가 빠지는 동작 | 2.1.322에서 실측. 언제부터인지 **확인 못 함** | 앱은 `--strict-mcp-config`를 같이 쓰므로 영향 없음 |
| `claude plugin list --json` | `--json` 행 필드 추가는 2.1.268. 명령 자체가 생긴 버전은 **확인 못 함** | — |

### Codex [소스: 태그 `rust-v0.162.1`에서 같은 코드가 있는지 확인]

| 수단 | `rust-v0.162.1` |
| :- | :- |
| `exec --ignore-user-config`, `--ignore-rules` | 있음 |
| `exec` 승인 정책 기본 `never` | 있음 |
| `mcp_servers.<id>.disabled_tools`, `default_tools_approval_mode` | 있음 |
| `codex mcp list --json` | 있음 |
| `never`에서 승인 필요한 MCP 호출 거부 문구, 전체 디스크 쓰기 시 자동 승인 | 있음 |
| `requires_mcp_tool_approval`(주석 기반 판정) | 있음 |
| stdio MCP 서버를 별도 프로세스 그룹으로 띄움 | 있음 |

- 위 항목은 소스 존재만 확인했고, 0.162.1 바이너리로 실측하지 않았다. 각 기능이 처음 생긴 버전은 릴리스 노트에서 찾지 못했다(최근 240개 릴리스 노트 검색). → 하한 안에 있다는 것까지만 확인.

---

## 확인하지 못한 것

- Claude `--restricted`(단독)에서 claude.ai 커넥터·플러그인·관리 MCP가 남는지(사용자 계정 필요).
- Claude가 `--mcp-config`로 넘긴 원격 HTTP 서버에 기존 OAuth 로그인을 재사용하는지(문서는 "엔드포인트별 저장"까지만).
- claude.ai 커넥터 목록을 앱이 읽을 공개 수단.
- `claude plugin list --json`이 서버를 띄우는지.
- Codex `never` + `approve` 모드에서 MCP 도구가 실제로 실행되는지, 기본 `auto` 모드에서 조작 도구가 실제로 거부되는지(모델 호출 필요).
- 플러그인 MCP가 `codex mcp list`에 나오는지, `--ignore-user-config`에서 Codex 플러그인 MCP가 실리는지.
- 원격 HTTP MCP의 서버 쪽 세션 정리.
- 각 기능이 처음 생긴 정확한 버전(Codex 전부, Claude 일부).

---

## 출처

- Claude Code 문서: https://code.claude.com/docs/en/mcp.md, https://code.claude.com/docs/en/cli-reference.md, https://code.claude.com/docs/en/permissions.md, https://code.claude.com/docs/en/env-vars.md, https://code.claude.com/docs/en/managed-mcp.md, https://code.claude.com/docs/en/plugins/loading.md, https://code.claude.com/docs/en/changelog.md
- Codex 문서: https://developers.openai.com/codex/mcp.md, https://developers.openai.com/codex/config-reference.md, https://developers.openai.com/codex/config-advanced.md, https://developers.openai.com/codex/non-interactive-mode.md, https://developers.openai.com/codex/permissions.md, https://developers.openai.com/codex/agent-approvals-security.md
- Codex 소스(`openai/codex`, 태그 `rust-v0.167.1`·`rust-v0.162.1`): `codex-rs/exec/src/lib.rs`, `codex-rs/config/src/loader/mod.rs`, `codex-rs/core/src/mcp_tool_call.rs`, `codex-rs/codex-mcp/src/mcp/mod.rs`, `codex-rs/cli/src/mcp_cmd.rs`, `codex-rs/rmcp-client/src/stdio_server_launcher.rs`, `codex-rs/rmcp-client/src/oauth.rs`
- MCP 서버: https://github.com/microsoft/playwright-mcp (README), https://github.com/ChromeDevTools/chrome-devtools-mcp (README, docs/tool-reference.md), https://github.com/mobile-next/mobile-mcp (README, `src/server.ts` @1.0.17), https://github.com/getsentry/MobileBuildMCP (README, `manifests/tools/*.yaml`), https://github.com/joshuayoes/ios-simulator-mcp (README), https://github.com/appium/appium-mcp (README), https://github.com/mobile-dev-inc/maestro (`maestro-cli/src/main/java/maestro/cli/mcp/tools/RunTool.kt`, `RunOnCloudTool.kt`)
