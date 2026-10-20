# 30: 저장소 매핑

**Spec:** [스펙](../spec.md) 5절 "저장소 매핑"

**What to build:** 설정 창 "저장소" 칸의 저장소 매핑 목록에서 참여 Flow 프로젝트를 고르고 폴더 선택 창으로 저장소를 여러 개 연결한다. 연결된 폴더가 사라지면 목록에 표시된다.

**Blocked by:** 25, 29

**Status:** resolved

- [x] 참여 Flow 프로젝트 목록은 `GET /user/projects/participants`(`projectId`, `title`, `projectUrl`)로 가져온다. 매핑 키는 `projectId`다.
- [x] Flow 프로젝트 하나에 저장소를 개수 제한 없이 연결하고 추가·수정·삭제할 수 있다. git 저장소가 아닌 코드 폴더도 직접 넣을 수 있다.
- [x] 작업 폴더를 지워도 그 안을 가리키는 매핑은 그대로 남는다.
- [x] 연결된 폴더 중 하나라도 없으면 목록에 "폴더를 찾을 수 없음"으로 표시된다(묶음 처리에서의 의미는 35).
- [x] 가짜 `fetch`로 목록 조회가, 임시 디렉터리로 사라진 폴더 표시가 테스트된다.

## Comments

- 구현 위치
  - 참여 Flow 프로젝트 조회: Flow API 포트의 `listParticipantProjects`(`FlowProject`: `projectId`, `title`, `projectUrl`), 어댑터 `apps/desktop/src/core/flow/http-flow-api.ts`
  - 매핑 목록, 추가·빼기·지우기, 폴더 확인: `apps/desktop/src/core/repos/repo-mappings.ts`
  - IPC 명령: `refresh-repo-mappings`, `pick-mapping-repos`, `remove-mapping-repo`, `remove-repo-mapping`
  - 이벤트: `repo-mappings-changed`
  - 스냅숏 필드: `repoMappings`
  - 화면: 설정 "저장소" 칸의 `RepositoriesSection.tsx` 안 "저장소 매핑"
- 매핑 규칙
  - `settings.json`의 `repoMappings`에 `projectId` → 저장소 절대 경로 목록으로 저장한다.
  - 저장소 개수에 제한이 없다. git 저장소가 아닌 폴더도 받는다.
  - 이미 연결된 폴더를 다시 고르면 한 번만 둔다.
  - "수정"은 매핑에 폴더를 더하거나 빼는 것으로 한다. 마지막 저장소를 빼면 매핑도 없어진다.
  - 참여 목록에도 저장된 매핑에도 없는 `projectId`에는 연결하지 않는다.
  - 작업 폴더와 따로 저장하므로 작업 폴더를 지워도 매핑은 남는다.
  - 네트워크·WSL 경로 거절은 스펙이 작업 폴더에만 정해 두어 매핑에는 걸지 않았다.
- 폴더 확인
  - 폴더가 없거나 폴더가 아니면(파일 등) 그 저장소 줄과 매핑 줄에 "폴더를 찾을 수 없음"을 보인다.
  - "저장소" 칸을 열 때마다 다시 확인한다. 앱 시작 때는 확인하지 않는다.
  - 묶음 처리(35)는 쓰는 시점에 다시 확인해야 한다. 내보낸 `isFolder`를 쓸 수 있다.
- 참여 목록
  - "저장소" 칸을 열 때와 계정이 바뀔 때 받는다.
  - `401`이면 "키 확인 필요"를 올린다. 실패하면 이유와 [다시 불러오기]를 보인다.
  - 응답의 data 안 위치와 쪽 나눔은 문서에 없고 실호출도 하지 않았다.
    - 그래서 data 자체나 data 바로 아래에서 `projectId`가 든 배열을 읽는다.
    - 알림 API처럼 `hasNext`·`lastCursor`가 오면 `cursor`로 다음 쪽을 받는다(최대 50쪽). 이 쪽 나눔은 추정이다.
- 검증
  - `pnpm typecheck`, `pnpm lint`, `pnpm test`(269개), `pnpm build`가 통과했다.
  - 목록 조회는 가짜 fetch(`FakeFlowServer`)로, 사라진 폴더 표시는 임시 디렉터리로 테스트했다.
- 실제 화면에서 확인하지 않은 것
  - 실제 OS 폴더 선택 창 조작과 칸의 실제 렌더링은 사용자 환경 항목이다. 실제 확인은 59에서 한다.
  - 실제 Flow 계정으로 `GET /user/projects/participants`를 부르는 것도 하지 않았다. 응답 모양은 실호출 때 확인이 필요하다.
