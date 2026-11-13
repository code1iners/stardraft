# 재현용 MCP 불러오기와 위험 도구 목록 조사

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: research
Mode: AFK
Status: resolved
Blocked by: 05

## Question

[재현 실행의 보안 경계](05-reproduction-security-boundary.md)에서 재현 실행은 **사용자가 Claude Code·Codex에 설정해 둔 MCP 서버 정의만** 가져오고, 권한·훅·샌드박스·승인·모델·Codex rules는 앱이 정한다고 정했다. 이를 구현할 수 있는 방법과 기본 deny 목록에 넣을 도구를 1차 출처(공식 문서, 설치된 바이너리, 공식 저장소)로 확인한다. 결정은 하지 않고 사실과 후보만 정리한다.

1. **Claude Code에서 MCP만 가져오기**: 지금 실행은 `--restricted`(사용자·프로젝트·로컬 설정 무시)와 `--strict-mcp-config`를 쓴다. 사용자 MCP 정의가 저장되는 위치(`~/.claude.json`의 `mcpServers`, 프로젝트별 정의, 플러그인 MCP, claude.ai 커넥터)와 각각을 `--restricted`를 유지한 채 싣는 방법을 확인한다. 안 되면 앱이 정의를 읽어 `--mcp-config`로 넘길 때 생기는 차이(환경 변수 참조, OAuth 토큰, 원격 HTTP 서버 인증)를 적는다.
2. **Codex에서 MCP만 가져오기**: 지금 실행은 `--ignore-user-config`와 `--ignore-rules`를 쓴다. `~/.codex/config.toml`의 `mcp_servers`만 싣는 방법, 또는 `-c mcp_servers.<id>.*` 인라인 정의가 `exec`에서 통하는지 확인한다. 이때 사용자 설정의 `sandbox_mode`·`approval_policy`·`default_permissions`가 섞여 들어오지 않는지 확인한다. 승인 정책이 `never`일 때 MCP 도구 호출이 어떻게 처리되는지도 본다.
3. **MCP 서버 목록 읽기**: 설정 화면의 `직접 선택` 모드가 서버마다 켜고 끄려면 두 CLI의 사용자 MCP 목록을 앱이 읽어야 한다. 읽을 수 있는 명령(`claude mcp list`, `codex mcp list` 등)이나 파일 형식과 출력 형식을 확인한다.
4. **기본 deny 목록 후보**: 웹·iOS·Android 조작용으로 널리 쓰는 MCP 서버(Playwright MCP와 모바일 조작 MCP 등)를 조사하고, 각 서버에서 임의 코드 실행·로컬 파일 업로드·파일 시스템 접근처럼 샌드박스 밖에서 위험한 도구 이름을 적는다. 두 CLI에서 도구 단위로 막는 방법(Claude deny 규칙·`--disallowedTools`, Codex `disabled_tools`)과 각각의 한계를 적는다.
5. **프로세스 정리**: MCP 서버 프로세스가 CLI의 자식으로 떠서 앱의 프로세스 그룹 SIGKILL로 함께 끝나는지, 원격 HTTP MCP는 어떻게 되는지 문서로 확인되는 만큼 적는다.
6. **버전 하한**: 위 수단이 생긴 CLI 버전을 지금 하한(Claude `2.1.259`, Codex `0.162.1`)과 비교한다.

결과는 `../research/reproduction-mcp.md`에 쓰고 이 티켓에서 링크한다. 실제 바이너리로 확인한 항목과 문서로만 확인한 항목을 구분한다. 사용자의 MCP 설정 파일 내용(토큰 등)은 결과에 옮겨 적지 않는다.

## Answer

2026-11-12 조사 에이전트가 정리했다. 상세와 출처 등급([실측]/[바이너리]/[문서]/[소스]/[추론])은 [재현용 MCP 조사](../research/reproduction-mcp.md)에 있다. 대상 바이너리는 Claude 2.1.322, Codex 0.167.1이고, 가짜 MCP 서버와 가짜 모델 API로 측정했다.

1. **Claude**: `--restricted`만 줘도 user·local·project MCP가 하나도 실리지 않는다[실측]. `--mcp-config`로 넘긴 정의는 `--restricted --strict-mcp-config`와 함께 실린다. 그래서 앱이 `~/.claude.json`의 `mcpServers`·`projects[경로].mcpServers`와 `.mcp.json`을 읽어 넘기는 방법만 남는다.
   - 옮기면 생기는 차이: `${VAR}`는 CLI 프로세스 환경으로 펼쳐지므로, 최소 환경 변수로 돌리면 MCP 인증이 실패할 수 있다. claude.ai 커넥터는 로컬 정의가 없어 옮길 수 없고, 플러그인 MCP는 `${CLAUDE_PLUGIN_ROOT}` 치환이 필요하다.
   - `--mcp-config`는 값을 여러 개 받는 인자라서 프롬프트를 그 앞에 둬야 한다.
2. **Codex**: `--ignore-user-config`를 유지한 채 `-c mcp_servers.<id>.*`로 넘긴 정의가 `exec`에서 통하고, 사용자 설정의 `sandbox_mode`·`approval_policy`·`default_permissions`는 섞이지 않는다[실측].
   - `exec`의 승인 정책 기본값은 `never`라서, `readOnlyHint`가 아닌 MCP 도구(클릭 등)는 거부될 것으로 보인다. 쓰게 하려면 `default_tools_approval_mode="approve"`가 필요하다[소스, 미실측].
3. **목록 읽기**: Codex는 `codex mcp list --json`으로 서버를 띄우지 않고 목록을 읽을 수 있지만, `env`·`http_headers` 값이 평문으로 나온다. Claude의 `claude mcp list`·`get`은 JSON 출력이 없고 서버를 실제로 띄운다. 그래서 Claude는 설정 파일을 직접 읽는 편이 맞다.
4. **기본 deny 후보**:
   - 도구 후보:
     - Playwright MCP: `browser_run_code_unsafe`·`browser_file_upload`·`browser_evaluate`
     - Chrome DevTools MCP: `evaluate_script`·`upload_file`
     - mobile-mcp: `mobile_batch_commands`·설치·삭제·데이터 지우기
     - MobileBuildMCP: `debug_lldb_command` 등
   - 막는 방법: Claude는 `--disallowedTools 'mcp__*__<도구>'` glob이 통한다[실측]. Codex는 서버마다 `disabled_tools`를 넣어야 한다.
   - 한계: `mobile_batch_commands`처럼 서버 안에서 다른 도구를 부르면 deny가 우회된다. 실행 중에 도구가 늘어나는 서버도 있다.
5. **프로세스 정리**: Claude의 stdio MCP는 같은 프로세스 그룹이라 그룹 SIGKILL로 함께 끝난다[실측]. Codex의 stdio MCP는 별도 그룹으로 떠서 CLI 그룹을 SIGKILL해도 살아남는다[실측]. 원격 HTTP MCP의 서버 쪽 세션 정리는 확인하지 못했다.
6. **버전 하한**: 쓰는 수단은 모두 지금 하한 안에 있다. Claude에서 하한보다 늦게 고쳐진 문제가 셋 있다(2.1.268 `mcp list` 비밀 노출, 2.1.274 빈 `--mcp-config` 지연, 2.1.309 샌드박스 명령의 `--mcp-config` 파일 수정). `--mcp-config` 파일은 쓰기 가능한 사본 밖에 둬야 한다.

**확인하지 못함**: `--restricted`에서 claude.ai 커넥터·플러그인·관리 MCP가 남는지, 원격 MCP의 OAuth 재사용, Codex `never`에서 MCP 호출의 실제 처리, Codex 플러그인 MCP.

**범위 밖 관찰**: 임시 `CODEX_HOME`과 `--ignore-user-config`로 돌렸는데도 사용자 홈의 Skill 목록이 모델 요청에 들어갔다.

이 사실로 생긴 결정은 [11 재현용 MCP 적용 방식 결정](11-reproduction-mcp-wiring.md)에서 다룬다.
