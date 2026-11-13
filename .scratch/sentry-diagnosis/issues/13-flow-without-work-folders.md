# 작업 폴더·자동 선택 폐지의 Flow 전환

Map: [Sentry 오류 이슈 진단 보고서](../map.md)
Type: grilling
Mode: HITL
Status: open
Blocked by: 09

## Question

[Sentry 설정 칸·저장소 매핑·온보딩 화면 시안](09-sentry-settings-ui-prototype.md)에서 작업 폴더와 Flow 자동 선택을 없애기로 했다. 그래서 매핑이 없는 Flow 멘션은 매핑이 생길 때까지 기다린다. 지금 Flow 동작을 이 방식으로 옮기는 데 남은 결정을 정한다.

- 매핑이 없는 Flow 멘션 묶음의 상태: 지금 `RepoCheck`(`no-candidates`, `missing-folders` 등)와 묶음 상태를 Sentry의 **저장소 매핑 필요**·**저장소 확인 필요**와 같은 이름·재개 방식으로 맞출지. 매핑을 저장하면 기다리던 묶음을 자동으로 대기열에 넣을지, 묶음 하나에만 고르기(`userRepos`, 파일 대화 상자)와 어떻게 함께 있을지.
- 업데이트로 넘어가는 기존 사용자: `settings.json`에 남은 `workFolders`를 버릴지, 첫 실행 때 안내할지, 매핑이 하나도 없는 사용자를 어떻게 이끌지. 업데이트 시점에 자동 선택을 기다리거나 진행 중이던 묶음, 이미 자동 선택으로 만든 초안을 어떻게 다룰지.
- 자동 선택 실행 코드(`repo-selection`, 선택 실행 시간 제한, `autoSelection` 기록 필드)와 검토 화면의 자동 선택 표시를 걷어 내는 범위.

근거 코드: `core/repos/work-folders.ts`, `repo-candidates.ts`, `repo-picker.ts`, `core/drafts/draft-queue.ts`, `core/drafts/repo-selection.ts`, `core/bundles/mention-bundle.ts`, `renderer/src/RepoPickerSheet.tsx`, `review-text.ts`.
