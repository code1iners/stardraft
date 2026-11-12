# 재현용 MCP 적용 방식 결정

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: grilling
Mode: HITL
Status: open
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
