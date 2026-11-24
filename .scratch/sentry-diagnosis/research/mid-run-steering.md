# 실행 중인 에이전트에게 메시지 전하기

2026-11-24, [진단 실패와 데이터 부족의 처리](../issues/18-diagnosis-failure-handling.md)를 정하다가 조사했다. 시간 상한이 가까울 때 "재현을 그만두고 보고서를 써라"를 실행 중인 에이전트에게 전할 수 있는지가 질문이다.

## 지금 앱의 방식

- Claude Code는 `claude -p`에 입력을 stdin으로 한 번 넘긴다(`apps/desktop/src/core/agent/claude-code-executor.ts`).
- Codex는 `codex exec --json`에 입력을 stdin으로 한 번 넘긴다(`apps/desktop/src/core/agent/codex-executor.ts`).
- 두 방식 모두 시작한 뒤에는 메시지를 더 보낼 수 없다.

## Claude Code 2.1.331: 된다 (실측)

- `--input-format stream-json`을 쓰면 stdin을 열어 둔 채 사용자 메시지를 줄 단위 JSON으로 더 넣을 수 있다(`claude --help`).
- 실측: `sleep 6`을 8번 차례로 돌리게 하고 16초에 "지금 멈추고 결과를 내라"를 넣었다. 돌던 두 번째 `sleep`이 끝난 직후(16.7초) 메시지가 반영됐고, 18.6초에 `--json-schema`에 맞는 구조화 출력(`rounds_done: 2`, `stopped_early: true`)이 나왔다.
- 메시지는 **도구 호출이 끝나는 자리**에서만 반영된다. 5분짜리 빌드가 돌고 있으면 그 빌드가 끝날 때까지 기다린다.
- 실측하지 않은 것: 앱이 쓰는 플래그 묶음(`--restricted`, `--append-system-prompt-file`, `--mcp-config`)과 함께 쓸 때, 모델이 haiku가 아닐 때. 메시지 형식은 `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`이다.

## Codex 0.171.0: 길은 있으나 실측하지 못했다

- `codex exec`에는 실행 중 입력이 없다. stdin은 처음 프롬프트로만 읽는다(`codex exec --help`).
- `codex app-server`(도움말에 experimental로 표시)의 프로토콜에 `turn/steer`와 `turn/interrupt`가 있다(`codex app-server generate-json-schema`로 확인). `turn/steer`는 `threadId`·`expectedTurnId`·`input`을 받고, `turn/start`는 `outputSchema`를 받는다.
- 실측은 실패했다. 이 PC의 Codex 계정이 사용량 한도에 걸려 있다(2026-11-29 14:05에 풀림). `thread/start`와 `turn/start`까지는 응답했다.
- `codex exec`에서 `app-server`로 바꾸면 지금 검증해 둔 플래그 묶음(권한 프로필, `--ignore-user-config`, MCP 넘기기)을 다시 확인해야 한다.
- 곁다리: 이 PC의 `~/.codex/config.toml`은 `model = "gpt-6-astra"`인데 이 계정에서는 "not supported"로 거절된다. `model/list`는 `gpt-6-luna`(기본)·`gpt-5.6-terra`·`gpt-5.6-luna`를 준다.
