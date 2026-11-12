# Flow 전용 구조에서 프로바이더 공통 경계 후보 조사

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: research
Mode: AFK
Status: resolved
Blocked by:

## Question

현재 코드(`apps/desktop/src/core/`)에서 Flow에 묶여 있는 부분과 프로바이더와 무관한 부분을 나누고, Sentry를 붙일 때 공통 경계를 그을 수 있는 지점을 찾는다. 결정은 하지 않고 후보와 근거만 정리한다.

1. 감지(`detection/`), 묶음(`bundles/`), 맥락 수집, 초안 큐(`drafts/draft-queue.ts`), 에이전트 실행(`agent/`, `ports/executor.ts`), 저장소 매핑·자동 선택(`repos/`, `drafts/repo-selection.ts`), 상태 저장(`storage/`, `ports/state-store.ts`), 검토·게시(`posting/`, 렌더러)를 따라가며 각 단계의 입력·출력 타입이 Flow 개념(멘션, Flow 프로젝트, 댓글 스레드 등)에 얼마나 묶여 있는지 적는다.
2. 저장소 매핑의 키가 Flow 프로젝트 id에 묶인 방식과, Sentry 프로젝트를 키로 추가할 때 바뀌어야 할 저장 스키마·설정 화면을 적는다.
3. 초안 결과 스키마(`outputSchema`)와 검토 화면이 "게시할 답변 텍스트"를 전제하는 지점을 적는다. 진단 보고서는 게시하지 않고 파일로 저장한다.
4. 경계 후보를 2~3개 제시하고, 각각 바뀌는 파일 범위와 Flow 동작 회귀 위험을 적는다. `codebase-design` 스킬의 용어를 쓴다.

결과는 `../research/provider-seam-candidates.md`에 쓰고 이 티켓에서 링크한다.

## Answer

- 지금 코드에는 프로바이더 seam이 없다. 감지부터 게시까지 모든 단계가 Flow 개념이 필수 필드인 `MentionBundle` 하나를 주고받고, 프로바이더와 무관한 것은 실행기 포트(`core/ports/executor.ts`)뿐이다. 담당 업무 초안이 같은 타입에 선택 필드를 더해 붙인 선례다.
- 저장소 매핑은 Flow 프로젝트 ID를 키로 하는 `settings.json`의 `repoMappings` 한 필드다. 확인 결과 `RepoResolution`과 `resolve(key)`는 키 공간과 무관해 재사용할 수 있고, 설정 화면·참여 목록 검사·검토 화면 "연결" 버튼이 Flow 전용이다. 새 필드는 마이그레이션 없이 더할 수 있다.
- 출력 스키마·기본 지침(쉬운 말, 코드 이름 금지, 5문장)·편집기·받는 사람·게시 상태가 "게시할 평문 답변"을 전제한다. 근거 타입과 근거 검사만 진단 보고서에 그대로 쓸 수 있다.
- 경계 후보는 A(대상 종류 확장, Flow 회귀 위험 높음), B(생성 대기열 아래 프로바이더 어댑터 seam, 중간), C(실행기 포트 아래만 공유, 낮음 대신 대기열 정책 중복·동시 실행)다.
- 결정에 걸리는 제약: 초안 대기열은 직렬이고 Flow 키가 없으면 통째로 멈춘다. 계정을 바꾸면 `state.db`의 표를 모두 지우므로 같은 DB에 둔 Sentry 기록도 함께 지워진다.

자세한 근거: [provider-seam-candidates.md](../research/provider-seam-candidates.md)
