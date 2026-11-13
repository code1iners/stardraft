# 재현에 필요한 에이전트 실행 권한 조사

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: research
Mode: AFK
Status: resolved
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

## Answer

- 두 CLI 모두 macOS Seatbelt로 셸 명령의 쓰기 범위와 네트워크를 좁힐 수 있다. Claude Code는 `--restricted`를 유지한 채 `--tools`에 `Bash`를 적고 `--settings`로 `sandbox`(`failIfUnavailable`, `allowUnsandboxedCommands:false`, `strictAllowlist`)를 넘긴다. Codex는 지금의 인라인 권한 프로필에서 사본 루트만 `write`로 바꾸고 `network`와 `features.network_proxy`를 더한다.
- 셸 경유 비밀 읽기: Codex 프로필 deny는 `cat`·`python`·`grep -r`을 모두 OS 수준에서 막는다(실측). Claude Code의 `Read` deny는 샌드박스 없이는 `cat` 같은 알아보는 명령만 막고 스크립트는 못 막는다. 샌드박스를 켜면 `denyRead`로 합쳐지지만, 지금의 `//**/` 루트 기준 규칙이 시스템 전체(`*.pem`, `.git/**`)에 걸리는 부작용이 의심된다.
- MCP 서버(Playwright MCP 포함)는 두 CLI 모두 샌드박스 밖에서 돈다. Playwright MCP의 `browser_run_code_unsafe`는 RCE와 같으므로 이름을 지정해 거부해야 한다. Claude는 deny가 allow보다 우선하므로 `mcp__*` deny를 빼고 `--strict-mcp-config`로 서버를 제한해야 한다.
- 모바일: Claude는 `allowMachLookup`(예: `com.apple.CoreSimulator.*`)과 `allowLocalBinding`으로 열 수 있지만 격리가 약해진다. Codex는 mach-lookup 설정을 찾지 못했다. 시뮬레이터와 adb 서버는 앱의 프로세스 그룹 종료로 끝나지 않는다.
- 버전: 현재 하한(Claude `2.1.259`, Codex `0.162.1`) 안에서 대부분 가능하다. `tee` 검사(2.1.269), `--settings`로 관리자 필수 샌드박스(2.1.285), `blockWritesOutsideWorkingDirectories`(2.1.314)는 더 높다. 일부 키의 도입 버전은 확인 못 함.
- 자세한 내용과 선택지별 트레이드오프: [../research/agent-reproduction-permissions.md](../research/agent-reproduction-permissions.md)
