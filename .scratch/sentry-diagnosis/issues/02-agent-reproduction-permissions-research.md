# 재현에 필요한 에이전트 실행 권한 조사

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: research
Mode: AFK
Status: open
Blocked by:

## Question

지금 앱은 Claude Code와 Codex를 **읽기 전용**으로 비대화형 실행한다(`apps/desktop/src/core/agent/claude-code-executor.ts`, `codex-executor.ts`). 에이전트가 재현을 하려면 이 경계를 일부 열어야 한다. 무엇을 어떤 수단으로, 얼마나 좁게 열 수 있는지 1차 출처(공식 문서, CLI 도움말, 설치된 바이너리)로 확인한다.

1. **명령 실행**: 비대화형 실행에서 셸 명령을 허용하는 방법. 명령 단위 허용·거부 목록(예: `Bash(npm run *)`), 샌드박스(파일 쓰기 범위, 네트워크 허용 범위) 설정 수단을 Claude Code와 Codex 각각에 대해 정리한다.
2. **브라우저 재현**: Playwright를 MCP 서버로 붙이는 방법과 `npx playwright`를 명령으로 쓰는 방법. 지금은 `--strict-mcp-config`·`mcp__*` 거부로 MCP를 막고 있으므로, 특정 MCP 서버만 허용하는 수단을 확인한다.
3. **모바일 재현**: iOS 시뮬레이터(`xcrun simctl`)와 Android 에뮬레이터(`adb`, `emulator`)를 에이전트가 명령으로 다룰 때 필요한 권한과 샌드박스 충돌(macOS 샌드박스 프로필 등).
4. **실행 위치**: 원본 저장소 대신 git worktree나 임시 사본에서 실행하게 하는 방법과 쓰기 범위를 그 사본으로 한정하는 방법.
5. **장시간 실행**: dev 서버처럼 오래 도는 프로세스의 처리, 최대 턴·시간 제한, 중단 시 자식 프로세스 정리.
6. **비밀 보호**: 명령 실행을 허용해도 기존 비밀 파일 차단(`secret-patterns.ts`)이 유지되는지. 셸로 `cat .env`를 하는 우회를 막을 수 있는지.
7. **버전 하한**: 위 기능이 생긴 CLI 버전. 기존 `cli-version.ts`의 하한과 비교한다.

결과는 `../research/agent-reproduction-permissions.md`에 쓰고 이 티켓에서 링크한다. 실제 바이너리로 확인한 항목과 문서로만 확인한 항목을 구분한다.
