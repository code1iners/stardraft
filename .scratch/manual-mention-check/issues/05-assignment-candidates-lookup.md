# 05: 담당 업무 후보 조회 코어

**What to build:** 사용자가 담당 업무 후보를 최근순으로 불러와 이어서 볼 수 있다. 이 티켓은 화면을 바꾸지 않고 조회와 해석을 서비스·어댑터 계층에서 완성한다. 스펙: `../spec.md`의 "담당 업무 목록 조회".

- 최근 WORKER 알림을 최신순으로 받아 게시글별로 가장 최근 알림 하나를 남기고, 게시글 상세를 조회해 후보를 정한다. 내 계정의 알림만 본다.
- 유지하는 규칙: 업무가 하나뿐인 게시글, 내가 담당자, 활성(요청) 상태. 이를 만족하지 않으면 후보에서 뺀다.
- 푸는 규칙: 기능 시작 전 업무, 기능 시작 전 배정, 자기 작성 업무, 배정 근거 없음은 후보에 남기고 "감지에서 빠진 이유" 네 가지(기능 시작 전 업무, 기능 시작 전 배정, 자기 작성 업무, 배정 근거 없음)로 표시한다. 배정 근거가 있으면 그 시각을, 없으면 알림 시각을 "배정 시각(추정)"으로 돌려준다.
- 이어 불러오기를 지원한다. 한 번에 10건, 쪽 수 상한 유지, Flow 읽음 상태 불변.
- 줄마다 "이미 묶음 있음(상태)", "답함", "처리됨"을 계산한다. 업무의 묶음 자리는 게시글 본문 자리다.
- 조회 실패는 멘션과 같은 구분(키 없음, 키 거부, 연결 실패, 요청 한도)으로 돌려준다.

**Blocked by:** 01 (멘션 수동 요청 코어)

**Status:** resolved

- [x] 활성 업무가 나오고, 진행·피드백·보류·완료 업무, 업무가 여럿인 게시글, 내가 담당자가 아닌 업무는 나오지 않는다(서비스 통합 테스트).
- [x] 기능 시작 전 업무, 시작 전 배정, 자기 작성, 배정 근거 없음 업무가 나오고 올바른 이유 태그가 붙는다. 근거 없는 업무의 배정 시각은 추정으로 표시된다.
- [x] 이어 불러오기가 다음 10건을 돌려주고 끝에서 멈춘다. 같은 게시글의 알림이 여럿이어도 한 줄만 나온다.
- [x] 줄 상태 태그(묶음 있음, 답함, 처리됨)가 기존 묶음과 최소 기록에 맞게 계산된다.
- [x] 조회 실패가 구분되어 돌아온다.
- [x] 마스킹된 실제 응답 사례(WORKER 알림 쪽 커서, 게시글 상세의 업무·담당자·상태)가 기존 Flow 어댑터 테스트에 추가되어 통과한다.
- [x] 마지막 변경 이후의 정적 검사와 관련 자동 테스트가 통과한다.

## Comments

- 2026-11-13 구현 메모
  - 조회: `apps/desktop/src/core/manual-check/recent-assignments.ts`의 `listRecentAssignments`. 서비스 경계는 `ManualMentionCheck.listAssignments(from)`이고, 후보는 `ManualAssignmentCandidate`(`alarm`, `post`, `taskId`, `assignedAt`, `assignedAtEstimated`, `answers`, `answered`, `missReasons`, `projectTitle`)다. 이어 불러올 자리는 `RecentAssignmentCursor`(판정한 게시물 ID를 `decidedKeys`에 둔다)다.
  - 감지에서 빠진 이유(`AssignmentMissReason`): `pre-feature-task`(기능 시작 전 알림에 나온 업무), `pre-feature-assignment`(배정 근거 시각이 기능 시작 시각 이전), `self-authored`, `no-evidence`. 담당 업무 감지 상태가 없거나 다른 계정 것이면 기능 시작 전 여부는 따지지 않는다.
  - 배정 근거: 가장 최근에 나를 더한 담당 변경 기록(S41)이 먼저이고, 없으면 생성 시 지정(가장 최근 알림이 생성 알림일 때)이다. 둘 다 없으면 가장 최근 알림 시각을 `assignedAtEstimated: true`로 돌려준다. 댓글을 쪽 상한 때문에 끝까지 받지 못하면 담당 변경 기록은 근거로 쓰지 않는다. 판정 함수는 `flow/assignment-evidence.ts`로 옮겨 자동 감지와 함께 쓰며, 자동 감지 동작은 바뀌지 않았다.
  - 알림 쪽 넘기기: 멘션과 업무 조회가 `manual-check/alarm-walk.ts`의 `collectFromAlarms`(한 번에 10건, 쪽 수 상한 10)를 함께 쓴다. `RecentMentionCursor`의 모양(`decidedLocations`)은 01/02와 맞추려고 그대로 뒀다.
  - 줄 상태: "답함"은 후보의 `answered`(배정 시각 뒤의 내 글)이고, "이미 묶음 있음(상태)"와 "처리됨"은 `MentionBundles.assignmentPlaceOf(postId)`(본문 자리의 최신 묶음 → 최소 기록 → 없음)로 정한다. 스냅숏 연결은 07에서 한다.
  - main 배선: `ManualMentionCheck` 옵션의 `myUserId`를 `account`로 바꾸고 `assignmentState`를 더했다. 시트(`ManualCheckSession`)는 아직 담당 업무를 부르지 않는다(07 범위).
  - 실응답 사례: `flow/fixtures/worker-alarms-2026-10-29.json`은 `.scratch/flow-task-assignment-drafts/research/assignment-evidence-2026-10-29.json`의 WORKER 첫 쪽 투영본(숫자 `lastCursor: 20`, 같은 게시물 알림 5건)이다. 투영본에 없던 `projectId`만 별칭으로 채웠다. `assignment-active-post-2026-10-29.json`은 사례 C 상세 투영본이고, 투영본의 상태 범주(`0`)와 담당자를 기존 상세 사례의 `TASK_COLUMN_REC` 구조로 옮겼다. 실제 Flow에서의 해석 확인은 스펙대로 사용자의 수동 통합 테스트로 남는다.
  - 실제 데스크톱 앱 확인: 이 티켓에는 화면 변경과 해당 완료 조건이 없다. 실제 계정·데이터로 앱을 띄우지 않았다.
  - 리뷰(code-review): Standards 축의 용어("게시글"→"게시물"), 주석 위치, 파일 끝 빈 줄을 고쳤다. 판단 사항 스멜(`manualPlaceOf`/`assignmentPlaceOf` 형태 중복, 공유 실패 종류 나열 중복, 커서 필드 옮겨 담기)은 동작 영향이 없어 남겼다. Spec 축 하위 에이전트는 API 인증 오류로 두 번 실패해 직접 대조했고, 빠진 요구나 범위 초과는 찾지 못했다.
  - 검증(마지막 변경 이후): `pnpm typecheck`, `pnpm lint` 통과. `apps/desktop`의 `pnpm test` 67개 파일, 1315건 통과(서비스 통합 테스트 5건: `draft-queue.test.ts`의 "최근 멘션 확인: 담당 업무 후보", 어댑터 테스트 2건: `http-flow-api.test.ts`의 "마스킹한 실응답의 최근 담당 업무 조회").
