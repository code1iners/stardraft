# Flow 전용 구조에서 프로바이더 공통 경계 후보 조사

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: research
Mode: AFK
Status: open
Blocked by:

## Question

현재 코드(`apps/desktop/src/core/`)에서 Flow에 묶여 있는 부분과 프로바이더와 무관한 부분을 나누고, Sentry를 붙일 때 공통 경계를 그을 수 있는 지점을 찾는다. 결정은 하지 않고 후보와 근거만 정리한다.

1. 감지(`detection/`), 묶음(`bundles/`), 맥락 수집, 초안 큐(`drafts/draft-queue.ts`), 에이전트 실행(`agent/`, `ports/executor.ts`), 저장소 매핑·자동 선택(`repos/`, `drafts/repo-selection.ts`), 상태 저장(`storage/`, `ports/state-store.ts`), 검토·게시(`posting/`, 렌더러)를 따라가며 각 단계의 입력·출력 타입이 Flow 개념(멘션, Flow 프로젝트, 댓글 스레드 등)에 얼마나 묶여 있는지 적는다.
2. 저장소 매핑의 키가 Flow 프로젝트 id에 묶인 방식과, Sentry 프로젝트를 키로 추가할 때 바뀌어야 할 저장 스키마·설정 화면을 적는다.
3. 초안 결과 스키마(`outputSchema`)와 검토 화면이 "게시할 답변 텍스트"를 전제하는 지점을 적는다. 진단 보고서는 게시하지 않고 파일로 저장한다.
4. 경계 후보를 2~3개 제시하고, 각각 바뀌는 파일 범위와 Flow 동작 회귀 위험을 적는다. `codebase-design` 스킬의 용어를 쓴다.

결과는 `../research/provider-seam-candidates.md`에 쓰고 이 티켓에서 링크한다.
