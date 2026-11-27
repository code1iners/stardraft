# 재현용 MCP 적용 방식 결정

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: grilling
Mode: HITL
Status: resolved
Blocked by: 10

## Question

[재현용 MCP 조사](10-reproduction-mcp-research.md)의 사실로 [재현 실행의 보안 경계](05-reproduction-security-boundary.md)의 MCP 결정(사용자 MCP 정의만 가져옴, 기본 `자동` + 위험 도구 deny, `직접 선택`)을 구현 가능한 형태로 확정한다.

- **정의를 가져오는 방법**: Claude는 앱이 설정 파일(`~/.claude.json`, 프로젝트별 정의, `.mcp.json`)을 읽어 `--mcp-config`로, Codex는 `-c mcp_servers.*`로 넘기는 방법밖에 없다. 플러그인 MCP와 claude.ai 커넥터(옮길 수 없음)를 어떻게 다룰지 정한다.
- **MCP 인증과 환경 변수**: `${VAR}` 참조가 CLI 환경으로 펼쳐지는데, 재현 실행의 최소 환경 변수 목록과 충돌한다. 필요한 변수만 통과시킬지, 앱이 미리 펼쳐서 넘길지, 원격 OAuth 서버는 어떻게 할지 정한다.
- **Codex 승인**: 조작 도구가 거부되지 않게 `default_tools_approval_mode="approve"`를 둘지 정한다. 그러면 새로 생긴 도구도 허용된다.
- **기본 deny 목록**: 후보 중 무엇을 넣을지, `mobile_batch_commands`처럼 deny가 우회되는 도구는 서버째 막을지 정한다. 서버마다 `disabled_tools`를 넣어야 하는 Codex에서 `자동` 모드를 어떻게 맞출지도 정한다.
- **`직접 선택`의 목록 읽기**: Claude는 파일을 직접 읽고 Codex는 `codex mcp list --json`을 쓰되, 평문으로 나오는 비밀을 앱이 보관하지 않게 할지 정한다.
- **프로세스 정리**: Codex의 stdio MCP 서버가 CLI 그룹 SIGKILL로 끝나지 않는다. 취소나 20분 상한에 걸렸을 때 앱이 그 프로세스들을 어떻게 찾아 끝낼지 정한다.
- **버전 하한**: Claude 하한을 2.1.309 이상으로 올릴지, 아니면 `--mcp-config` 파일을 사본 밖에 두는 것으로 충분한지 정한다.

## Answer

2026-11-23 grilling 세션에서 정했다. 근거 사실은 [재현용 MCP 조사](../research/reproduction-mcp.md)와 지금 코드다. [재현 실행의 보안 경계](05-reproduction-security-boundary.md)와 [ADR 0003](../../../docs/adr/0003-reproduction-opens-agent-boundary.md)의 방향은 그대로이고, 이 티켓은 그것을 구현할 형태로 좁혔다. 새 ADR은 만들지 않았다.

### 싣는 실행

- MCP는 **재현 허용**이 켜진 저장소의 진단 실행에만 싣는다. 분석만 하는 진단과 Flow 초안 실행은 지금처럼 MCP를 막는다.

### 정의를 가져오는 범위

- 실행하는 CLI 자신의 정의만 가져온다. Claude 실행에는 Claude의 정의, Codex 실행에는 Codex의 정의다.
- Claude: 앱이 `~/.claude.json`(또는 `$CLAUDE_CONFIG_DIR/.claude.json`)의 최상위 `mcpServers`(user), `projects["<원본 저장소 절대 경로>"].mcpServers`(local), 원본 저장소의 `.mcp.json`(project)을 읽어 `--mcp-config`로 넘긴다. 이름이 겹치면 CLI와 같은 순서(local > project > user)로 하나만 쓴다. `--restricted --strict-mcp-config`는 유지한다.
- Codex: `~/.codex/config.toml`의 `mcp_servers`를 `-c mcp_servers.<id>=…`로 넘긴다. `--ignore-user-config --ignore-rules`는 유지한다.
- 사용자가 CLI에서 꺼 둔 서버(Claude `disabledMcpServers`, Codex `enabled=false`)는 싣지 않는다.
- **플러그인 MCP와 claude.ai 커넥터는 싣지 않는다.** 커넥터는 로컬 정의가 없고, 플러그인은 경로 치환과 도구 이름 변경이 따라오며 Codex 쪽은 확인하지 못했다. 설정의 `재현` 탭에 이 사실과 "조작용 MCP는 CLI에 직접 등록하라"는 안내를 적는다.

### 인증과 환경 변수

- `${VAR}` 참조: 앱이 정의를 훑어 참조된 변수 **이름**을 모으고, 로그인 셸에서 그 값만 읽어 재현 실행의 최소 환경 변수에 더한다(앱은 Finder에서 떠서 셸 변수를 갖고 있지 않고, 지금은 로그인 셸에서 `PATH`만 읽는다: `core/agent/cli-discovery.ts`). 펼치는 일은 CLI가 한다. 값을 찾지 못한 서버는 빼고 보고서의 실행 정보에 적는다.
- 정의에 평문으로 든 값(`env`, `headers`)은 **명령줄 인자에 싣지 않는다**. Claude는 사본 밖 임시 파일(권한 0600, 실행 뒤 삭제)로 넘긴다. Codex는 값을 CLI 프로세스 환경에 넣고 `env_vars`·`env_http_headers`·`bearer_token_env_var`로 참조하게 바꿔 넘긴다. 앱은 이 값을 디스크에 보관하지 않는다.
- 통과시킨 변수는 에이전트의 셸 명령에도 보일 수 있다. Codex는 `shell_environment_policy`로 가리고, Claude는 가릴 수 없다. 재현용 환경 파일의 노출과 같은 선에서 받아들이고, 재현을 켜는 확인 모달에 "MCP 인증 값도 에이전트에게 노출될 수 있다"는 줄을 더한다.
- 원격 OAuth 서버: 정의를 그대로 넘기고 CLI가 저장된 로그인을 다시 쓰는지에 맡긴다. 앱은 로그인 흐름을 돌리지 않는다. 연결되지 않으면 그 서버 없이 진행한다.

### 도구 허용

- Claude: 실은 서버마다 `mcp__<서버>__*` 허용 규칙을 넣는다.
- Codex: 실은 서버마다 `default_tools_approval_mode="approve"`를 넘긴다.
- 두 CLI 모두 실행 중에 새로 생긴 도구가 허용된다. 막는 수단은 deny 목록뿐이라는 점을 받아들인다.

### 기본 deny 목록

- 기준: 셸이 이미 열려 있으므로 임의 코드 실행을 다 막으려 하지 않는다. **셸로는 못 하는 피해**(로컬 파일의 외부 업로드, 기기 데이터 파괴, 외부 클라우드 사용, deny 우회)를 막는다.
- 넣는 도구
  - Playwright MCP: `browser_run_code_unsafe`, `browser_file_upload`
  - Chrome DevTools MCP: `upload_file`, `install_extension`, `execute_3p_developer_tool`
  - mobile-mcp: `mobile_batch_commands`, `mobile_uninstall_app`, `mobile_clear_app_data`, 클라우드 기기 도구(`mobile_login_to_cloud_provider`, `mobile_allocate_remote_device` 등)
  - MobileBuildMCP: `debug_lldb_command`, `xcode_ide_call_tool`, `erase_sims`
  - Maestro MCP: `run_on_cloud`
- 넣지 않는 도구: `browser_evaluate`·`evaluate_script`(페이지 상태 확인에 필요), 앱 설치 도구(빌드한 앱을 올려야 재현한다), 빌드·테스트 도구, Maestro `run`.
- `mobile_batch_commands`는 그 도구를 막으면 우회로가 닫히므로 서버째 막지 않는다.
- 적용: Claude는 `--disallowedTools 'mcp__*__<도구>'` glob으로 건다. Codex는 고정 목록 전체를 실은 모든 서버의 `disabled_tools`에 넣고, 사용자가 이미 적어 둔 `disabled_tools`와 합친다.
- 목록은 앱 코드에 고정하고 릴리스로만 바꾼다. 이름 기반이라 완전하지 않다는 점을 스펙에 적는다.

### `직접 선택`

- 목록 읽기: Claude는 설정 파일을 직접 읽고(`claude mcp list`는 서버를 띄우므로 쓰지 않는다), Codex는 `codex mcp list --json`을 쓴다. 앱은 서버 **이름·종류(stdio/HTTP)·출처**만 화면에 쓰고, 값은 메모리에도 남기지 않는다. 실행할 때마다 정의를 다시 읽는다.
- 저장: `settings.json`에 에이전트별로 **켠 서버 이름**만 둔다. 나중에 새로 등록된 서버는 꺼진 채로 나타난다.
- 저장소의 `.mcp.json` 서버는 저장소마다 달라서 목록에 넣지 않고, `직접 선택`에서는 싣지 않는다. `자동`에서는 싣는다.
- `직접 선택`에서도 기본 deny 목록은 적용한다.

### 프로세스 정리

- Claude: 지금의 그룹 SIGKILL로 stdio MCP까지 끝난다. 바꾸지 않는다.
- Codex: 취소나 20분 상한에 걸리면 CLI 그룹을 죽이기 **직전에** CLI의 자손을 PPID로 모아 프로세스 그룹마다 SIGKILL을 보내고, 그다음 CLI 그룹을 죽인다. 순서를 뒤집으면 자손이 launchd로 넘어가 찾을 수 없다. 정상 종료는 Codex가 스스로 정리한다.
- 앱이 강제 종료되어 남은 MCP 프로세스는 챙기지 않는다. PID를 적어 두었다가 다음 실행 때 죽이는 방법은 PID 재사용 위험 때문에 쓰지 않는다.

### 버전 하한

- Claude 하한 `2.1.259`, Codex 하한 `0.162.1`을 그대로 둔다.
- `--mcp-config` 파일은 사본 밖에 둔다. 실을 서버가 없으면 `--mcp-config`를 넘기지 않는다(2.1.274 전의 빈 설정 지연을 피한다). `--mcp-config`는 값을 여러 개 받으므로 프롬프트는 지금처럼 표준 입력으로 준다.

### 일부 서버가 안 뜰 때

- 실행은 그대로 진행한다. 조작할 도구가 하나도 없으면 에이전트가 재현 결과를 "불가(도구 없음)"로 적는다.
- 진단 보고서의 실행 정보에 **실린 MCP 서버**와 **빠진 서버와 이유**(변수 없음·연결 실패·꺼 둠)를 이름만 적는다. [진단 보고서의 형식과 저장 위치](07-diagnosis-report-format.md)의 실행 정보 항목에 이 줄이 더해진다.

### 스펙에 적을 실측 항목

- Codex `never` + `approve`에서 조작 도구가 실제로 실행되는지, `approve` 없이 거부되는지.
- Codex `disabled_tools`에 그 서버에 없는 도구 이름을 넣어도 문제가 없는지.
- 두 CLI가 인라인으로 넘긴 원격 HTTP 서버에 저장된 OAuth 로그인을 다시 쓰는지.
- Codex에서 실린 서버와 연결 실패한 서버를 앱이 읽는 방법(Claude는 `system/init`의 `mcp_servers`·`mcp_server_errors`).
- Codex CLI 자손을 PPID로 모아 그룹마다 끝내는 정리가 실제 MCP 서버(브라우저·시뮬레이터를 띄운 상태)에서 통하는지.
