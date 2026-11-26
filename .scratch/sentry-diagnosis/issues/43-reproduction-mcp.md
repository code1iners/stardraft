# 43: 재현에 MCP 싣기

**Spec:** [스펙](../spec.md) 7절 "MCP 싣기", "CLI별 구현"의 MCP 줄, 11절 실행 정보

**What to build:** 재현하는 진단에 사용자가 에이전트에 등록해 둔 MCP 서버가 실려, 에이전트가 브라우저와 시뮬레이터를 직접 조작한다. 위험 도구는 고정 목록으로 막히고, `직접 선택`이면 켠 서버만 실린다.

**Blocked by:** 42

**Status:** resolved

- [x] 재현하는 진단에만 MCP가 실린다. 읽기 전용 진단과 Flow 초안의 인수 묶음은 그대로다.
- [x] 실행하는 CLI 자신의 정의만 실린다. Claude Code는 사용자·로컬·프로젝트 범위를 로컬 > 프로젝트 > 사용자 순서로 하나씩, Codex는 사용자 설정의 정의다. 사용자가 꺼 둔 서버, 플러그인 MCP, 커넥터는 실리지 않는다.
- [x] 정의가 참조한 변수의 이름만 모아 로그인 셸에서 값을 읽어 실행 환경에 더한다. 값을 찾지 못한 서버는 빠진다.
- [x] 정의에 평문으로 든 값이 명령줄 인자에 없다. Claude Code는 사본 밖 임시 파일(0600, 실행 뒤 삭제)로, Codex는 프로세스 환경과 환경 변수 참조로 넘어간다. 앱이 그 값을 디스크에 보관하지 않는다. 테스트가 이를 검사한다.
- [x] 실은 서버마다 도구가 허용되고, 고정 deny 목록(스펙의 표)이 두 CLI에 걸린다. Codex는 사용자가 적어 둔 비활성 도구와 합쳐진다.
- [x] `직접 선택`이면 켠 서버만 실리고 저장소의 프로젝트 정의 파일 서버는 실리지 않는다. deny 목록은 그대로 걸린다.
- [x] 실을 서버가 없으면 Claude Code에 MCP 설정을 넘기지 않는다.
- [x] Codex를 강제로 끝낼 때 CLI 그룹을 죽이기 직전에 자손의 프로세스 그룹을 먼저 끝낸다.
- [x] 일부 서버가 뜨지 않아도 실행은 진행되고, 보고서의 실행 정보에 실린 서버와 빠진 서버·이유가 이름만 적힌다.
- [x] 가짜 MCP 서버를 등록한 임시 설정으로 재현하는 진단을 실제로 한 번 돌려, 서버가 실리고 deny한 도구가 막히는 것을 확인했다.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`가 통과한다.

## Comments

- 구현 메모
  - 싣기: `core/reproduction/mcp-loading.ts`(`ReproductionMcpLoader`). 실행할 때마다 실행하는 CLI의 정의와 재현 도구 권한을 다시 읽는다. 대기열이 `TargetRun.request(model, agent)`로 실행할 에이전트를 넘겨, 어댑터가 그 CLI의 정의를 고른다. 결과(`ReproductionMcp`: 서버·환경 변수·빠진 서버)는 재현 경계 `reproduction.mcp`로 실행기에 간다. 디스크와 로그에는 남기지 않는다.
  - Claude Code: `~/.claude.json`(또는 `$CLAUDE_CONFIG_DIR/.claude.json`)의 사용자 범위, 원본 저장소 경로의 로컬 범위, 원본 저장소의 `.mcp.json`을 로컬 > 프로젝트 > 사용자 순서로 하나씩 쓴다. `disabledMcpServers`·`disabledMcpjsonServers`는 "꺼 둠"이다. 정의는 실행 임시 폴더의 `mcp.json`(0600)으로 `--mcp-config`에 넘긴다. 이 파일은 실행이 끝나면 폴더째 지운다. `--restricted --strict-mcp-config`는 그대로다. 실을 서버가 없으면 `--mcp-config`를 넘기지 않는다.
  - Claude 권한: 서버마다 `mcp__<이름>__*`을 허용한다. 이름의 영문자·숫자·`_`·`-`가 아닌 글자는 `_`로 바꾼다. 고정 deny 표의 모든 도구는 `mcp__*__<도구>`로 막는다. 실행 임시 폴더(MCP 정의가 있음)는 `Read` deny와 샌드박스 `denyRead`로 에이전트가 읽지 못하게 했다.
  - Codex: `codex mcp list --json -c features.plugins=false`로 고르고(플러그인 MCP를 끄면 `config.toml`의 서버만 나온다. 0.172.0 실측), 사용자가 꺼 둔 도구를 얻으려고 서버마다 `codex mcp get <이름> --json`을 읽는다. 설정 `재현` 탭의 목록 명령도 같은 설정으로 바꿔 플러그인 서버가 목록에 섞이지 않게 했다.
  - Codex 인라인 정의는 `-c mcp_servers={...}` 표 하나로 넘긴다. 이름에 `.`이 있어도 되게 하려는 것이다. 서버마다 `default_tools_approval_mode="approve"`를 두고, `disabled_tools`는 사용자 것과 고정 목록을 합친다.
  - Codex 평문 값: `env`는 같은 이름의 프로세스 환경 변수와 `env_vars`로, `http_headers`는 `STARDRAFT_MCP_HEADER_n` 변수와 `env_http_headers`로 바꾼다. 넘긴 변수는 `shell_environment_policy.exclude`로 셸 명령에서 가린다.
  - 변수: Claude는 정의 안의 `${NAME}`(기본값 없는 것만 필수)과 `${NAME:-x}`, Codex는 `env_vars`·`bearer_token_env_var`·`env_http_headers`를 모은다. 그 이름만 로그인 셸(`<셸> -ilc`, `printf`·`printenv`만 씀)에서 읽는다(`core/agent/login-shell-variables.ts`). 최소 목록 같은 앱이 정하는 이름은 다시 읽지 않는다.
  - 연결 실패: Claude는 `system/init`의 `mcp_servers` 상태가 `connected`가 아닌 서버, Codex는 `RUST_LOG=codex_mcp=warn`으로 받은 `MCP server startup failed server_name="..."` 로그(0.172.0 실측)를 쓴다. Codex의 MCP 로그 줄은 오류 원문에서 걷어 낸다.
  - 보고서: 실행 정보 `mcpServers`(`loaded`, `skipped[{name, reason}]`)를 두고, 화면 정보 탭과 내보낸 파일에 "실린 MCP 서버", "빠진 MCP 서버: 이름(까닭)"으로 적는다. 읽기 전용 진단은 `null`이라 줄이 없다. 옛 보고서는 `null`로 읽는다.
  - Codex 강제 종료 순서(자손 그룹 먼저)는 42번의 `killDescendants`로 이미 되어 있어 이 티켓에서 바꾸지 않았다.
- 해석으로 정한 것
  1. 빠진 까닭에 스펙의 셋(꺼 둠, 변수 없음, 연결 실패) 말고 둘을 더했다.
     - "변수 충돌": Codex 평문 값이 앱이 정하는 변수(PATH 등)나 다른 서버의 다른 값과 겹치는 경우.
     - "설정을 옮기지 못함": Codex 상세 명령 실패, 또는 헤더 값을 계산하는 명령(`http_headers_helper`)이 있는 서버. 그 명령은 목록이 값을 가려 옮길 수 없고, 빼고 넘기면 인증 없이 붙는다.
  2. `직접 선택`에서 켜지 않은 서버도 "꺼 둠"으로 실행 정보에 적는다. 저장소 `.mcp.json` 서버는 `직접 선택`에서는 읽지도 적지도 않는다.
  3. Claude에서 `system/init`을 받기 전에 끝난 실행은 연결됐는지 모르므로 실은 서버를 모두 "연결 실패"로 본다.
  4. `.mcp.json`의 승인 목록(`enabledMcpjsonServers`)은 보지 않는다. `-p`에서는 승인하지 않은 프로젝트 서버도 실린다는 10번 조사의 실측을 따랐다. 사용자가 거부한 `disabledMcpjsonServers`만 뺀다.
- 리뷰에서 고친 것
  - 고정 deny 도구 목록이 두 실행기에 중복돼 있던 것을 `FIXED_DENIED_TOOLS` 하나로 모았다.
  - `asRecord`를 다시 만들지 않고 기존 것을 쓴다.
  - 이름을 정리했다.
  - 헤더 계산 명령을 조용히 버리던 것을 서버를 빼는 쪽으로 바꿨다.
  - init을 받지 못한 실행의 서버를 "실린 서버"로 적던 것을 고쳤다.
- 리뷰에서 남긴 것
  - Claude Code의 MCP용 변수가 셸 명령에도 보이는 것은 스펙 7절 표("MCP용으로 통과시킨 변수는 셸에서 가릴 수 없다")에 적힌 한계다. ADR·알려진 한계 문서화는 45번이 한다.
  - Codex `-c` 인자에 서버의 `args`·`url`·`cwd`는 그대로 남는다. 주소의 쿼리에 토큰을 넣은 정의라면 그 값이 명령줄에 보인다. Codex는 주소를 변수로 참조하는 칸이 없다. 45번 알려진 한계 후보다.
  - Claude 범위 해석이 설정 목록(`parseClaudeMcpServers`)과 싣기(`claudeCandidates`)에 따로 있다. 목록은 매핑된 모든 저장소의 로컬 범위를, 싣기는 원본 하나와 `.mcp.json`을 본다. 하는 일이 달라 합치지 않았다.
- OAuth 재사용 점검(43번 추가 범위)
  - 자동 테스트로 확인한 것: 두 CLI 모두 원격 서버의 이름과 주소를 사용자가 등록한 그대로 넘긴다. Claude는 정의 파일 내용이 원래 정의와 같고, Codex는 이름·URL을 그대로 둔다. Codex는 저장한 OAuth를 이름+URL로 찾는다(10번 조사의 소스 확인).
  - 실기, Claude Code 2.1.332: Claude 설정의 로컬 범위 원격 서버 하나(종류 `http`, `url`만 있음)를 앱 묶음(`--restricted --strict-mcp-config --mcp-config`)으로 띄웠다. `system/init`에서 `needs-auth`였고, MCP 도구는 0개였다. init만 읽고 곧바로 끝냈다.
  - 같은 서버를 원래 범위에서 `claude mcp get`으로 보니 `Needs authentication`이었다. 기본 설정 폴더의 다른 원격 서버도 같았다.
  - **확인 못 함**: 저장된 OAuth 로그인을 다시 쓰는지. 이 PC의 Claude 설정 두 곳 모두 로그인된 원격 OAuth 서버가 없다. Codex는 원격 서버의 `auth_status`가 `not_logged_in`·`bearer_token`·`unsupported`·`unknown`뿐이고 미구독이다. OAuth 로그인은 브라우저에서 사람이 해야 해서 무인 실행으로는 만들 수 없다.
  - 로그인이 안 된 서버는 "연결 실패"로 적히고, 그 서버 없이 실행이 진행되는 것은 확인했다.
  - Codex는 `--ignore-user-config` 때문에 사용자의 `mcp_oauth_credentials_store` 설정이 적용되지 않는다(기본 `auto`). 상세 명령 출력에 OAuth `scopes` 같은 칸이 없어 옮기지 못한다. 저장 방식을 바꾼 사용자는 재사용이 안 될 수 있다(추론).
- 검증
  - 마지막 변경 뒤 `pnpm lint`, `pnpm typecheck`가 통과했고, desktop 전체 테스트 97개 파일 1931개도 모두 통과했다.
  - 전체 실행에서 실패한 것은 이 PC의 환경성 실패뿐이다: desktop `zsh rc 멈춤 5초`, site `index-page.test.ts`.
  - 실기(이 PC, Claude Code 2.1.332, 모델 haiku): 임시 폴더에 가짜 원본 저장소를 만들었다. 가짜 MCP stdio 서버 `probe`의 도구는 `safe_echo`와 `browser_run_code_unsafe`이고, 호출을 파일에 기록한다. 가짜 서버 `needs-var`는 없는 변수를 참조한다. 이 둘을 등록한 임시 Claude 설정과 임시 홈의 `.profile`(토큰 export)로 `ReproductionMcpLoader` → 실제 APFS 사본 → `ClaudeCodeExecutor`의 재현하는 진단(재현 지침·스키마)을 한 번 돌렸다. 결과:
    - `needs-var`는 "변수 없음"으로 빠지고 `probe`만 실렸다.
    - init에서 `probe`는 `connected`였고, MCP 도구는 `mcp__probe__safe_echo` 하나뿐이었다. deny한 `browser_run_code_unsafe`는 목록에서 빠졌다.
    - 모델은 `safe_echo`만 불렀다. `browser_run_code_unsafe`는 "도구 목록에 없어 호출하지 않았다"고 남은 의문에 적었다. 서버 기록에도 `safe_echo` 호출만 있다.
    - 서버는 로그인 셸에서 읽은 토큰과 정의의 평문 값을 모두 받았다. CLI 명령줄 인자에는 둘 다 없었다. 실행은 `completed`로 끝났다.
  - Codex 실행은 확인 못 함(미구독). 인라인 `mcp_servers` 표(점이 든 이름 포함), `shell_environment_policy.exclude`, 연결 실패 로그 형식은 모델 호출 없는 Codex 0.172.0 명령으로 확인했다.
