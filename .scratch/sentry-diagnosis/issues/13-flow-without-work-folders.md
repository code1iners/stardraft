# 작업 폴더·자동 선택 폐지의 Flow 전환

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: grilling
Mode: HITL
Status: resolved
Blocked by: 09

## Question

[Sentry 설정 칸·저장소 매핑·온보딩 화면 시안](09-sentry-settings-ui-prototype.md)에서 작업 폴더와 Flow 자동 선택을 없애기로 했다. 그래서 매핑이 없는 Flow 멘션은 매핑이 생길 때까지 기다린다. 지금 Flow 동작을 이 방식으로 옮기는 데 남은 결정을 정한다.

- 매핑이 없는 Flow 멘션 묶음의 상태: 지금 `RepoCheck`(`no-candidates`, `missing-folders` 등)와 묶음 상태를 Sentry의 **저장소 매핑 필요**·**저장소 확인 필요**와 같은 이름·재개 방식으로 맞출지. 매핑을 저장하면 기다리던 묶음을 자동으로 대기열에 넣을지, 묶음 하나에만 고르기(`userRepos`, 파일 대화 상자)와 어떻게 함께 있을지.
- 업데이트로 넘어가는 기존 사용자: `settings.json`에 남은 `workFolders`를 버릴지, 첫 실행 때 안내할지, 매핑이 하나도 없는 사용자를 어떻게 이끌지. 업데이트 시점에 자동 선택을 기다리거나 진행 중이던 묶음, 이미 자동 선택으로 만든 초안을 어떻게 다룰지.
- 자동 선택 실행 코드(`repo-selection`, 선택 실행 시간 제한, `autoSelection` 기록 필드)와 검토 화면의 자동 선택 표시를 걷어 내는 범위.

근거 코드: `core/repos/work-folders.ts`, `repo-candidates.ts`, `repo-picker.ts`, `core/drafts/draft-queue.ts`, `core/drafts/repo-selection.ts`, `core/bundles/mention-bundle.ts`, `renderer/src/RepoPickerSheet.tsx`, `review-text.ts`.

## Answer

2026-11-24 grilling 세션에서 정했다. 근거는 지금 Flow 코드 조사다(`core/bundles/mention-bundle.ts`·`mention-bundles.ts`, `core/drafts/draft-queue.ts`·`repo-selection.ts`·`draft.ts`, `core/repos/repo-mappings.ts`·`repo-picker.ts`·`work-folders.ts`, `core/storage/file-settings-store.ts`·`state-database.ts`). 경로는 `apps/desktop/src/` 기준이다.

### 지금 코드 사실

- 묶음 상태는 `repo-check-needed`("저장소 확인 필요") 하나이고 사유(`RepoCheck`: `missing-folders`·`no-candidates`·`unsure`·`unrelated`, 옛 묶음은 `null`)가 붙는다. 매핑이 없는 묶음은 이 상태가 아니라 `generating`으로 가서 자동 선택을 탄다(`statusWithoutDraft`).
- `repo-check-needed`에서 다시 만드는 길은 저장소 선택 창(`regenerateWithRepos`)뿐이다. `repoMappings.onChange`는 화면 갱신만 하고 묶음을 재개하지 않는다.
- `userRepos`는 한 번 정하면 지우는 코드가 없고 매핑보다 먼저 쓰인다.
- 재생성은 저장소를 다시 정한다. 순서는 `userRepos` → 그때의 매핑 → 이전 자동 선택 결과(`regeneration.autoSelected`) 재사용 → 새 자동 선택이다.
- 자동 선택 결과는 초안이 저장될 때만 남는다(`draft` JSON 안의 `autoSelection`, 전용 DB 칸 없음). 도중에 끊긴 실행은 재시작하면 처음부터 다시 한다.
- `settings.json`은 모르는 키를 그대로 보존한다. `SETTINGS_MIGRATIONS`는 비어 있고, 파일 버전이 앱보다 크면 `newer-data`로 실행하지 않는다.
- 모든 묶음에 `projectId`가 있다. 채팅 멘션을 다루는 코드는 없다.

### 상태 둘과 자동 재개

- 묶음 상태를 **저장소 매핑 필요**(매핑도 고른 저장소도 없음)와 **저장소 확인 필요**(정해 둔 저장소의 폴더를 찾을 수 없음) 둘로 나눈다. Sentry 오류 이슈와 같은 이름이고, 두 용어를 `GLOSSARY.md`에 프로바이더 공통 용어로 올렸다. 멘션 묶음과 담당 업무 초안에 똑같이 적용한다.
- 사유는 `missing-folders`만 남긴다. `no-candidates`·`unsure`·`unrelated`는 없앤다. "코드와 무관한 멘션" 판정은 대체 없이 사라진다(매핑된 프로젝트에는 원래 없던 판정이다).
- Flow 프로젝트에 저장소 매핑을 저장하면 그 프로젝트에서 **저장소 매핑 필요**로 기다리던 묶음을 모두 `auto` 칸으로 대기열에 넣는다. 폴더가 다시 생기거나 매핑을 고치면 **저장소 확인 필요** 묶음도 같은 방식으로 재개한다. 매핑이 어느 경로(설정 칸, 검토 화면·선택 창의 [연결])로 생겼는지는 가리지 않는다.
- 따라오는 결과: 처리됨에서 되돌린 묶음에 초안도 매핑도 고른 저장소도 없으면 **저장소 매핑 필요**가 된다. 기다리는 묶음에 새 멘션이 오면 지금처럼 수만 늘고, 재개할 때 함께 다룬다.

### 묶음 하나에만 고르기

- **저장소 매핑 필요** 묶음에도 [저장소를 골라 만들기]를 둔다. 고르면 그 묶음만 만들고 매핑은 저장하지 않으며, 같은 프로젝트의 다른 묶음은 계속 기다린다.
- 선택 창의 후보는 "지금 쓰는 저장소"·"다른 Flow 프로젝트의 매핑 저장소"·"직접 고른 폴더"다. "작업 폴더에서 찾은 저장소" 무리만 뺀다. [시안 티켓](09-sentry-settings-ui-prototype.md)의 "파일 대화 상자로만 고른다"를 이렇게 넓혔다.
- 창의 [연결]은 그대로 둔다. 이 버튼으로 매핑이 생기면 위 자동 재개가 다른 묶음에도 적용된다.
- 고른 저장소가 있는 묶음은 나중에 그 프로젝트에 매핑이 생겨도 고른 저장소를 계속 쓴다(지금 동작 그대로).
- 버튼 배치(주 버튼 [저장소 매핑하기], 보조 [저장소를 골라 만들기])는 지도의 "검토 화면과 알림"에서 시안으로 정한다.

### 저장소가 정해지지 않은 초안

- 초안은 있는데 매핑도 고른 저장소도 없는 묶음(자동 선택으로 만든 기존 초안, 매핑으로 만든 뒤 매핑을 지운 경우)은 [다시 만들기]와 지시를 막고 이유를 본문에 적는다. 게시·무시·"다른 저장소로 다시 만들기"는 된다. 초안을 버리고 **저장소 매핑 필요**로 보내지 않는다.
- 손대지 않은 준비됨 초안에 새 멘션이 합쳐져 저절로 다시 만드는 경로(`mergedNewMentions`)도 같은 이유로 이 묶음에서는 돌지 않고 새 멘션 수만 늘린다. 세션에서 따로 묻지 않았고 위 결정에서 끌어낸 것이다.
- 자동 선택으로 이미 만든 초안은 그대로 검토·게시한다. "자동으로 고른 이유" 표시는 없애고 쓴 저장소 목록과 [연결]만 남긴다. 저장된 `autoSelection`·`regeneration.autoSelected` 값은 지우지 않고 읽지 않는다. DB 마이그레이션은 없다.

### 업데이트로 넘어가는 기존 사용자

- `workFolders`는 읽지 않는다. 설정 스키마 버전은 올리지 않고 키는 파일에 남긴다(버전을 올리면 옛 앱으로 되돌렸을 때 `newer-data`로 막힌다). Sentry 설정 때문에 버전을 올리게 되면 그 마이그레이션에서 함께 지운다.
- 전환 안내 창은 띄우지 않고, 작업 폴더를 매핑으로 바꿔 주지도 않는다. 사용자는 묶음의 **저장소 매핑 필요** 상태와 저장소 칸의 "저장소 매핑 없음 · n건 대기"로 알게 된다.
- 업데이트 순간에 초안 없이 `generating`이던 매핑 없는 묶음(대기 중, 선택 실행 중, 선택은 끝났고 초안 실행 중)은 다음 시작 때 **저장소 매핑 필요**가 된다. 자동 선택 결과는 이어 쓰지 않는다.
- 자동 선택 때문에 멈춰 있던 묶음(`no-candidates`·`unsure`·`unrelated`, 사유 `null`, 선택 실행이 실패한 `failed`)은 첫 시작 때 한 번 다시 판정한다. 고른 저장소도 매핑도 없으면 **저장소 매핑 필요**, 폴더가 없으면 **저장소 확인 필요**, 매핑이 이미 있으면 대기열에 넣는다. 오래 멈춰 있던 묶음이 업데이트 직후 한꺼번에 생성될 수 있음을 받아들였다.

### 걷어 내는 범위

- 자동 선택: `repo-selection.ts`, `DraftQueue.selectRepos`, `RunKind`의 `'selection'`(새 실행에서), `SELECTION_TIMEOUT_MS`, 선택 실행 턴 상한, `CHOOSING_REPO_STEP`, `AutoSelection`을 쓰는 경로, `RunRepos`의 `'auto-selected'`.
- 작업 폴더: `work-folders.ts`, `findSelectionScope`와 스캔, "이 PC에서 찾은 폴더" 제안, IPC `pick-work-folders`·`add-suggested-work-folder`·`remove-work-folder`·`refresh-work-folders`와 `work-folders-changed`, 설정 화면 항목, `SETUP_REQUIREMENTS`의 `work-folders`, 선택 창의 `work-folder` 무리.
- 문구: `AutoSelectionNote`, 선택 실행 시간 초과 문구, 작업 폴더를 가리키는 안내문(`BundleDetail`·`RepositoriesSection`·`RepoPickerSheet`·`AccountSwitchSheet`·OS 알림).
- 과거 실행 기록의 `'selection'` 종류는 읽을 때만 허용하고 "저장소 선택(폐지됨)"으로 보인다.
- 스펙을 쓸 때 확인할 것: `repo-candidates.ts`의 네트워크·WSL 폴더 거부 규칙을 매핑 폴더 선택이 쓰는지 보고, 쓰는 부분만 남긴다.
