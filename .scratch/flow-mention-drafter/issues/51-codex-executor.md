# 51: Codex 실행기(macOS)

**Spec:** [스펙](../spec.md) 6절 "실행기 허용 기준", "Codex 실행 방식", "에이전트와 모델 선택"의 Codex 모델

**What to build:** macOS에서 설정 "에이전트" 칸에 Codex도 연결 후보로 나타나 찾기·버전·로그인·작동 확인을 거쳐 "✓ Codex 연결됨"이 된다. 기본 에이전트로 고르면 선택 실행과 초안 실행이 Codex 권한 프로필 묶음으로 돈다. Windows에서는 후보에 나타나지 않는다.

**Blocked by:** 28, 37, 38

**Status:** ready-for-agent

- [ ] 필수 플래그 묶음(스펙 6절 "Codex 실행 방식")을 그대로 쓴다. `--sandbox` 없이 인라인 권한 프로필, 시스템 경로 `:minimal`과 codex 실제 경로만 `read`, `/tmp` deny, `workspace_roots`에 둘째 루트부터, 비밀 파일 패턴과 `.git` deny, `features.apps=false` 등 기능 끄기, `--skip-git-repo-check`는 선택 실행에만.
- [ ] 저장한 경로가 심볼릭 링크면 실행 때마다 실제 경로로 풀어 띄우고 그 파일을 프로필에서 읽기 허용한다. npm 설치본(JS 래퍼)에서도 동작하는지 확인해 기록한다.
- [ ] 지침은 `-c developer_instructions`로 넣고 TOML 이스케이프를 한다. 입력은 stdin, 결과는 `--json` JSONL에서 읽고 진행 단계로 바꾼다. 스키마는 모든 속성이 `required`인 형태(선택 항목은 `null` 허용).
- [ ] 로그인 확인은 `codex login status`, 모델 목록은 `codex debug models`의 `visibility`가 `list`인 항목이며 실패하면 "기본 모델"만. 출력 형식이 버전에 따라 유지되는지 확인해 기록한다. 미로그인 때의 실제 출력과 종료 코드를 기록한다.
- [ ] 사용자의 기본 `CODEX_HOME`을 쓴다(미결 항목). 환경 변수 규칙(API 키 변수 제외)은 같다.
- [ ] Windows에서는 후보에서 빠진다. 가짜 프로세스 실행기로 인수 묶음, 경로 풀기, JSONL 파싱이 테스트된다.
