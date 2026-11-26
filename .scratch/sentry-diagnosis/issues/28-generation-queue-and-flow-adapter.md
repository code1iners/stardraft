# 28: 생성 대기열과 Flow 어댑터로 나누기

**Spec:** [스펙](../spec.md) 2절, 8절 "멈춤은 두 층", ADR 0004

**What to build:** 사용자가 보는 Flow 동작은 그대로 두고, 초안 대기열을 프로바이더와 무관한 **생성 대기열**과 **Flow 어댑터**로 나눈다. 대기열은 대상을 `(종류, 대상 ID)`로만 안다. Flow 키 문제는 대기열 전체가 아니라 Flow 대상만 멈춘다. 이 티켓은 병렬 실행을 더하지 않는다(직렬 그대로).

**Blocked by:** 24

**Status:** resolved

- [x] 생성 대기열이 실행 자리, 우선순위, 대기열 저장과 복원, 실행 직전 에이전트 확인, 일시적 실패 1회 재시도, 전역 실패 멈춤, 취소, 앱 종료를 맡고, Flow 타입을 import하지 않는다.
- [x] 대상 어댑터 인터페이스가 준비(지침·입력·출력 스키마·저장소·시간 상한·실행 종류, 또는 건너뜀·어댑터 멈춤·잠시 뒤 다시), 결과 읽기, 저장, 실패 기록, 저장소 대기 기록, "아직 생성 중인가" 판정을 갖는다.
- [x] Flow 어댑터가 기존 멘션 묶음 모듈을 감싸고, 담당 업무 초안은 그 안에 그대로 있다.
- [x] 대기열 표에 대상 종류 열을 더하는 이전이 있고 기존 줄은 Flow로 채워진다. 이전은 실제 SQLite 파일로 테스트된다.
- [x] 멈춤이 두 층이다. 에이전트를 쓸 수 없으면 전부 멈추고, Flow 키 거부·Flow 미도달은 Flow 어댑터의 대상만 멈춘다. 멈춘 대상은 실패가 되지 않고 순서를 지킨다. 가짜 둘째 어댑터의 대상이 멈춘 Flow 대상을 지나가는 테스트가 있다.
- [x] 기존 초안 대기열 테스트가 고치지 않은 기대값으로 통과한다(우선순위, `resume` 재진입, 저장된 대기열 복원).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`가 통과한다.

## Comments

### 구현 기록 (2026-11-26)

- 생성 대기열은 `apps/desktop/src/core/generation/generation-queue.ts`(`GenerationQueue`)에 있다. 대상 어댑터 인터페이스는 `apps/desktop/src/core/generation/target-adapter.ts`(`TargetAdapter`)에 있다. `TargetAdapter`의 메서드는 `prepare`, `TargetRun.read`·`check`, `save`, `fail`, `needsRepoCheck`, `isGenerating`, `begin`이다. 대기열 키는 `(kind, targetId)`다.
- Flow 모듈 import 금지는 eslint 규칙(`src/core/generation/**`)으로 강제한다.
- Flow 어댑터는 `apps/desktop/src/core/drafts/flow-target-adapter.ts`(`FlowTargetAdapter`, 종류 `flow`)다. `DraftQueue`는 Flow 어댑터를 붙인 생성 대기열의 창구로 남겨 공개 API와 생성 옵션이 그대로다.
- 멈춤은 두 층이다.
  - 전역 멈춤: `agent`, `restart`
  - 어댑터 멈춤: `connection`(Flow 키 거부, 알림이 오면 풀림), `retry`(Flow 미도달, 시간이 지나면 풀림)
  - `flowKeyUsable`은 Flow 어댑터의 `connectionUsable`로 옮겼다.
  - 가짜 둘째 어댑터 테스트: `generation-queue.test.ts`
- 대기열 저장은 새 포트 `GenerationQueueStore`(`getGenerationQueue`·`setGenerationQueue`, `QueuedTarget`)가 맡는다. `StateStore`의 `getDraftQueue`·`setDraftQueue`는 없앴다.
- `state.db` 형식 23은 `draft_queue`를 새로 만들어 옮긴다. `kind TEXT NOT NULL` 열을 더하고 `bundle_id`를 `target_id`로 바꾸며, 기존 줄은 `flow`로 채운다. 형식 22의 실제 파일로 테스트했다.
- `draft-queue.test.ts`는 고치지 않았고 그대로 통과한다. `restart-recovery.test.ts`와 `state-database.test.ts`는 저장 메서드 이름과 줄 모양(`kind`, `targetId`)만 바꿨고, 기대하는 순서와 자리는 그대로다.
- 실행 기록의 결과 값 `bundle-changed`는 저장된 기록과 맞추려고 이름을 그대로 둔다. 대기열 안에서는 `target-changed`로 다룬다.
- 알아 둘 점: `resetForAccount`는 대기열 표를 통째로 지운다. Flow 계정을 바꿀 때 Flow 줄만 빼는 일은 33번 몫이다.
- 검증: `pnpm lint`와 `pnpm typecheck`는 통과했다. `pnpm test`의 실패는 결정 #6의 환경성 실패 둘뿐이다(desktop `node-process-runner` zsh rc 5초, site `index-page`). 나머지 desktop 1350개는 통과했다.
