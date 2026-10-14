# CLI 에이전트 비대화형 실행 능력 조사

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: research
Mode: AFK
Status: resolved
Blocked by:

## Question

데스크톱 앱이 Claude Code와 Codex CLI를 **비대화형으로 호출**해서 초안을 만들 수 있는지, 그리고 어떤 제약이 있는지 1차 출처(공식 문서, 저장소, CLI 도움말)로 확인한다.

1. **호출 방법**: 비대화형 호출 방법(`claude -p`, `codex exec` 등)과 출력 형식을 확인한다. JSON 출력과 스키마 강제 같은 구조화 출력을 지원하는지 본다.
2. **읽기 전용 강제**: 파일 수정, 명령 실행, 네트워크 접근을 막는 수단(권한 모드, 허용 도구 목록, 샌드박스 등)이 무엇인지 확인한다. 특정 파일(`.env`, 키 파일)을 읽기에서 빼는 수단이 있는지도 본다.
3. **디렉터리 지정**: 작업 디렉터리를 지정하는 방법을 확인한다. 여러 디렉터리를 동시에 읽게 하는 방법이 있는지도 본다. 이는 작업 폴더에서 저장소를 고를 때 필요하다.
4. **Windows 지원**: Windows 네이티브 지원 여부와 WSL 필요 여부, 경로와 셸 관련 제약을 확인한다.
5. **인증 상태**: 로그인 상태를 미리 확인하는 방법과, 로그인이 안 됐을 때의 종료 코드와 출력을 확인한다.
6. **GUI 앱에서의 호출**: 트레이/데스크톱 앱처럼 GUI에서 띄운 프로세스가 CLI를 찾지 못하는 PATH 문제가 있는지 확인한다. macOS의 로그인 셸 환경과 Windows의 사용자 PATH를 각각 보고, 알려진 해결책을 정리한다.
7. **실행 제어**: 타임아웃, 취소(프로세스 종료) 시 동작, 동시에 여러 개를 실행할 때 생기는 제약을 확인한다.
8. **다른 후보**: Gemini CLI 등 다른 CLI 에이전트도 같은 수준의 인터페이스를 제공하는지 간단히 비교한다.

## 산출물

- 조사 결과 파일: `research/cli-agent-headless.md`. 항목마다 출처 URL을 단다.

## Answer

- 두 CLI 모두 비대화형 호출과 스키마 강제 출력을 지원한다. Claude Code 2.1.296은 `claude -p --output-format json --json-schema`, Codex 0.162.1은 `codex exec --output-schema <파일> -o <파일>`을 쓴다.
- 읽기 전용은 Claude는 `--tools "Read,Glob,Grep"` + `--permission-mode dontAsk` + `--restricted`로, Codex는 기본 read-only 샌드박스(exec는 승인 `never` 고정)로 건다.
- 비밀 파일 제외는 Claude만 안정적이다(`Read(**/.env)` deny). Codex는 베타 권한 프로필로만 되고, 이 프로필은 `--sandbox`와 함께 쓸 수 없다.
- `claude -p`는 신뢰하지 않은 저장소의 훅·`env`·`.mcp.json`을 실행하므로, `--restricted`와 `--strict-mcp-config`를 필수로 써야 한다.
- 디렉터리는 Claude가 프로세스 cwd + `--add-dir`, Codex가 `-C`로 지정한다. git 저장소가 아닌 작업 폴더에서 Codex를 돌리려면 `--skip-git-repo-check`가 필요하다.
- Windows는 둘 다 네이티브로 지원한다. 다만 Codex 샌드박스는 Windows 11 24H2+의 MXC나 관리자 승인 설정이 있어야 온전하다.
- 로그인 확인은 `claude auth status`와 `codex login status`로 하고, 둘 다 미로그인이면 코드 1이다. GUI 앱은 셸 PATH를 물려받지 못하며, 타임아웃·동시 실행 관리는 앱 몫이다.
- Gemini CLI는 스키마 강제가 없고 headless plan 모드가 YOLO로 바뀌어 2순위 후보다. 미로그인 출력과 Windows 동작은 실측이 필요하다. 상세: [조사 결과](../research/cli-agent-headless.md)
