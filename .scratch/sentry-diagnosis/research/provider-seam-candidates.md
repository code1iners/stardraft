# Flow 전용 구조에서 프로바이더 공통 경계 후보

티켓: [03 Flow 전용 구조에서 프로바이더 공통 경계 후보 조사](../issues/03-provider-seam-codebase-research.md)
조사일: 2026-11-12 · 1차 출처: 이 저장소 코드(`dev` 브랜치, `fe72ed4` 기준). 경로는 `apps/desktop/src/` 기준이다. ADR(`docs/adr/0001`, `0002`)은 Electron 선택과 앱 내 업데이트 신뢰를 다루며 이 주제와 관련이 없다.
용어: 저장소 루트 `GLOSSARY.md`, 설계 용어는 `codebase-design` 스킬(모듈·인터페이스·깊이·seam·어댑터·지역성·레버리지)을 따른다. 결정은 하지 않는다.

---

## 결정용 요약

### "프로바이더 공통 경계 결정"(티켓 08)에 쓸 요약

- **지금 코드에는 프로바이더 seam이 없다.** 감지 → 묶음 → 초안 대기열 → 검토·게시의 모든 단계가 `MentionBundle` 한 타입을 주고받고, 그 타입의 필수 필드가 Flow 개념(`postId`·`remarkId`·`projectId`·`mentions`·`answers`·`posting`)이다(`core/bundles/mention-bundle.ts:293-364`). 프로바이더와 무관한 것은 **실행기 포트**(`core/ports/executor.ts:15-100`) 하나뿐이다.
- **담당 업무 초안이 "두 번째 대상 종류"를 붙인 선례다.** 별도 타입을 만들지 않고 `MentionBundle`에 선택 필드 `assignment?: TaskAssignment`를 더하고(`mention-bundle.ts:295`), 같은 `MentionBundles`·`DraftQueue`를 그대로 썼다(`core/detection/assignment-detection.ts:43-44,190`). 그 결과 `prepareRun`·`runData`·지침·스냅숏 곳곳에 `assignment` 분기가 퍼졌다(`core/bundles/mention-bundles.ts:609-613`, `core/drafts/draft-queue.ts:731`, `core/drafts/draft-input.ts:16,170`, `main/review-snapshot.ts:144-145`). 이 길이 후보 A다.
- **초안 대기열의 "에이전트 실행 관리"는 Flow와 무관하지만 Flow와 한 클래스에 섞여 있다.** 실행 직전 확인·일시적 실패 재시도·전역 실패 멈춤·취소·시간 초과·대기열 저장은 프로바이더와 상관없는데(`draft-queue.ts:37-43,478-500,784-880`), 같은 클래스가 Flow 키 확인(`draft-queue.ts:99-102,473-475`), Flow 맥락 조회 결과 분기(`draft-queue.ts:597-612`), Flow 프로젝트 이름(`draft-queue.ts:110,736`)을 직접 안다. 이 둘을 가르는 것이 후보 B의 seam이다.
- **경계 후보 3개**(자세히는 §4):
  - **A. 대상 종류 확장**: `MentionBundle`에 `errorIssue?`를 더해 같은 묶음·대기열·검토 화면을 쓴다. 새 코드가 가장 적지만 깊이를 잃고, Flow 핵심 파일(`mention-bundles.ts` 1,607줄, `draft-queue.ts` 1,048줄)을 직접 고쳐 Flow 회귀 위험이 가장 크다.
  - **B. 생성 대기열 아래에 프로바이더 어댑터 seam**: `DraftQueue`에서 에이전트 실행 관리를 떼어 공통 모듈로 두고, "대상 준비·결과 저장"을 프로바이더 어댑터(Flow = 기존 `MentionBundles`, Sentry = 새 모듈)로 받는다. 어댑터가 둘이라 실제 seam이다. 회귀 위험은 중간이며 기존 `draft-queue.test.ts`가 인터페이스를 거쳐 검증해 준다.
  - **C. 실행기 포트 아래만 공유**: Sentry가 감지·저장·진단 대기열·검토 화면을 따로 갖고, 실행기·에이전트 연결·저장소 매핑·비밀 파일 패턴만 공유한다. Flow 회귀 위험이 가장 작지만 재시도·전역 실패 처리를 중복하고, 두 대기열이 에이전트를 동시에 돌릴 수 있게 된다.
- **어느 후보든 걸리는 공통 사실**
  - 계정을 바꾸면 `state.db`의 표를 **전부** 지운다(`core/storage/state-database.ts:404-417`, 보존 목록은 `app_meta`·`update_signature_failure`·`update_attempt`뿐 `:306`). Sentry 표를 같은 DB에 두면 **Flow 계정 전환이 Sentry 기록까지 지운다.** 보존 목록에 넣을지 정해야 한다.
  - 기본 지침이 "개발자가 아닌 동료도 이해하는 쉬운 말, 코드 이름·파일 이름 금지, 5문장 이내"를 강제하고(`draft-input.ts:25-34`), 검토 화면이 문장마다 개발자 용어를 표시한다(`main/review-snapshot.ts:188,192`). 진단 보고서와 정면으로 어긋나므로 지침·출력 스키마·문체 검사는 프로바이더(또는 초안 종류)별로 달라야 한다.
  - 실행기 포트의 `RunKind`가 `'selection' | 'draft' | 'check'`로 닫혀 있고(`ports/executor.ts:5`), Claude 턴 상한(`agent/claude-cli.ts:76-80`)과 Codex git 확인 생략(`agent/codex-executor.ts:176-177`)이 이 값으로 갈린다. 진단을 새 `RunKind`로 두면 두 실행기가 함께 바뀐다. 재현을 위해 도구 범위를 넓히는 일(`agent/claude-code-executor.ts:91-102`)도 이 포트를 거친다(티켓 02·05 범위).

### "저장소 매핑이 없는 Sentry 프로젝트 처리"(티켓 06)에 쓸 요약

- **저장소 매핑은 Flow 프로젝트 ID를 키로 하는 단일 `Record<string, string[]>`이다**(`ports/settings-store.ts:16-17`, `core/repos/repo-mappings.ts:79-85`). 키 자체에는 프로바이더 구분이 없다. 읽을 때 문자열 키를 그대로 받으므로(`repo-mappings.ts:338-347`) 접두사 붙인 키(예: `sentry:<org>/<project>`)를 넣어도 깨지지 않는다. 다만 "참여 목록이나 기존 매핑에 있는 프로젝트만 받는다"는 검사가 Flow 참여 목록을 본다(`repo-mappings.ts:176-182,262-265`).
- **매핑 확인 결과 타입 `RepoResolution`(`unmapped`·`missing-folders`·`mapped`)은 프로바이더와 무관하다**(`repo-mappings.ts:54-60`). `resolve(key)` 자체는 키만 보므로(`repo-mappings.ts:148-155`) Sentry 키로 그대로 쓸 수 있다.
- **자동 선택은 프로바이더와 거의 무관하지만 지침·입력이 Flow다.** 후보 찾기(`findSelectionScope`, `draft-queue.ts:671`)와 판정 3종 `chosen`·`unsure`·`unrelated`(`core/drafts/repo-selection.ts:31-34`)·출력 스키마(`repo-selection.ts:61-67`)는 재사용할 수 있다. 하지만 `SELECTION_INSTRUCTIONS`가 "Flow에서 동료가 멘션해 물은 것"을 전제하고(`repo-selection.ts:8-13`), 입력 문서가 Flow용 데이터 구획(`dataSectionLines`, `draft-input.ts:160-177`)을 쓴다. 스택트레이스 파일 경로로 후보를 좁히려면 이 지침·입력을 Sentry용으로 따로 써야 한다.
- **매핑이 없을 때의 지금 흐름**: 후보 0개 → `repo-check-needed`(`no-candidates`), 1개 → 선택 실행 없이 사용, 여럿 → 선택 실행, `unsure`/`unrelated` → `repo-check-needed`(`draft-queue.ts:676-709`). 매핑된 폴더가 없으면 자동 선택으로 넘어가지 않는다(`core/bundles/mention-bundles.ts:656-663`). 자동 선택 결과는 매핑으로 저장하지 않고 초안에 내력(`autoSelection`)만 남긴다(`core/drafts/draft.ts:46-55,67-68`).
- **결과를 매핑으로 굳히는 흐름**: 검토 화면 "이 Flow 프로젝트에 연결"이 `repoPicker.linkBundle` → `replaceRepos(bundle.projectId, draft.repositories)`로 덮어쓴다(`main/ipc.ts:359-360`, `core/repos/repo-picker.ts:148-152`, `repo-mappings.ts:195-203`). 이 함수는 참여 목록 검사를 하지 않아(`repo-mappings.ts:196-197`) Sentry 키에도 쓸 수 있지만, 묶음에서 키를 `bundle.projectId`로 꺼내는 곳(`repo-picker.ts:72,140,152,185,190`)과 화면 문구가 Flow 전용이다.
- **설정 화면은 Flow 전용이다.** "저장소" 칸이 참여 Flow 프로젝트 목록을 받아 고르게 하고(`renderer/src/RepositoriesSection.tsx:140-221`), 키가 없으면 "Flow 계정을 먼저 연결"을 띄운다(`RepositoriesSection.tsx:18-24`). Sentry 프로젝트를 고르려면 Sentry 프로젝트 목록 조회와 별도 선택 UI가 필요하다.

### 진단 실행 큐에 관한 현재 사실

- **초안 대기열은 직렬이다.** 한 번에 하나만 실행한다(`draft-queue.ts:207-208,221-224,468-470`). 동시 실행 수 설정은 없다.
- **우선순위 3단계**(`resume` > `user` > `auto`)이고 대기열을 `state.db`의 `draft_queue` 표에 저장해 다시 켤 때 같은 순서로 돈다(`core/drafts/draft.ts:137-153`, `state-database.ts:206-210`, `draft-queue.ts:450-464`). 표의 키는 `bundle_id` 하나라 **묶음이 아닌 대상(오류 이슈)을 넣으려면 대상 종류를 함께 적어야 한다.**
- **시간 초과**: 초안 실행 10분, 선택 실행 5분, 설정으로 바꿀 수 없다(`draft-queue.ts:33-36`). 실행기가 `timeoutMs`를 넘기면 프로세스 트리를 끝내고 `timed-out`을 돌려준다(`agent/process-runner.ts:11-12,26`, `agent/node-process-runner.ts:97-101`). 진단(재현 포함)은 이보다 길 수 있어 상수를 종류별로 둬야 한다.
- **취소**: 실행 중이면 `AbortController`로 끊어 프로세스 트리를 끝내고, 기다리는 중이면 바로 "취소함" 실패로 둔다(`draft-queue.ts:322-333,924-929`). 앱 종료 때는 끊고 최대 5초 기다려 기록을 남긴다(`draft-queue.ts:48-52,277-292`).
- **재시도·멈춤**: 일시적 실패(`invalid-output`·`overloaded`·`network`)만 1회 자동 재시도(`draft-queue.ts:37-43`). 전역 실패(에이전트 쓸 수 없음)나 Flow 키 문제·Flow 미도달이면 대기열 전체를 멈춘다(`draft-queue.ts:123-131,600-609`).
- **공유 시 걸림돌**: 대기열이 돌 조건에 `flowKeyUsable()`이 들어 있어(`draft-queue.ts:473-475`, 연결 `main/index.ts:239`) **Flow 키가 없거나 거부되면 대기열 전체가 멈춘다.** 진단 실행을 같은 대기열에 넣으면 Flow 키 문제로 Sentry 진단까지 멈춘다. 또 직렬이라 몇 분짜리 진단이 Flow 초안을 그만큼 늦춘다.
- **따로 둘 때의 걸림돌**: 에이전트 실행을 직렬로 묶는 장치는 `DraftQueue` 안의 `busy` 플래그뿐이다(`draft-queue.ts:221-222`). 대기열을 둘로 나누면 같은 CLI 에이전트가 동시에 두 개 돈다(로그인 세션·사용량 한도 공유). 작동 확인(`check`)은 이미 대기열 밖에서 따로 돈다(`agent/check-run.ts:15`).

---

## 1. 단계별 입력·출력과 Flow 결합도 (Question 1)

결합도: **강함** = 타입 자체가 Flow 개념, **중간** = 타입은 일반적이나 내용·의존이 Flow, **약함** = 프로바이더와 무관.

| 단계 | 모듈 | 입력 → 출력 | 결합도 | 근거 |
|---|---|---|---|---|
| 감지 | `MentionDetection` | Flow 알림 목록(`FlowAlarm`) → `Mention[]` + `PlaceLookup` → `bundles.addDetected` | 강함 | `core/detection/mention-detection.ts:10,27-40,281`. 기준점은 `alarmId`(`ports/state-store.ts:31-34`) |
| 감지 | `AssignmentDetection` | Flow 알림·게시물 → `bundles.addAssignment(post, projectId, …)` | 강함 | `core/detection/assignment-detection.ts:40-49,190-191` |
| 감지 일정 | 폴링 루프 | 60초 주기, 72시간 범위, `429` 대기, 키 거부 시 멈춤 | 중간 | `mention-detection.ts:14-24,42-49,84-126`. 일정·백오프는 일반적이나 `MentionDetection` 안에 섞여 있다 |
| 대상 | `Mention`, `MentionLocation` | `postId`·`remarkId`·`replyId`·`projectId`·`alarmId`·`senderId` | 강함 | `core/detection/mention.ts:5-30` |
| 묶음 | `MentionBundle` | 묶음 자리(`postId`,`remarkId`) + 멘션 + 내 답 + 초안 + 게시 기록 + 상태 | 강함 | `core/bundles/mention-bundle.ts:243,293-364` |
| 묶음 상태 | `BundleStatus` | 11개 상태 중 `posting`·`post-failed`·`posted`·`already-answered`·`source-gone`·`unassigned`는 Flow 전용 | 중간 | `mention-bundle.ts:11-33`. 목록 묶음(`listGroupOf`)은 일반적이다 `:36-57` |
| 맥락 수집 | `collectBundleContext` | Flow API + 묶음 → `BundleContext`(게시물·대상 스레드·다른 댓글) | 강함 | `core/flow/bundle-context.ts:62-71,134` |
| 실행 직전 준비 | `MentionBundles.prepareRun` | 묶음 ID → `RunPreparation`(`prepared`·`answered`·`unassigned`·`key-unusable`·`flow-unreachable`·`unavailable`·`skipped`) | 강함 | `core/bundles/mention-bundles.ts:89-107,569-637`. "이미 답함"·"담당 해제" 판정이 여기 있다 |
| 입력 문서 | `draftInputDocument`, `dataSectionLines` | `RunDataSource`(멘션·Flow 맥락·내 이름·Flow 프로젝트 이름) → 문자열 | 강함 | `core/drafts/draft-input.ts:58-71,103-113,160-177` |
| 지침 | `DRAFT_INSTRUCTIONS` | 고정 텍스트(Flow 멘션 답변·쉬운 말 문체) | 강함 | `draft-input.ts:12-48` |
| 초안 대기열 | `DraftQueue` | 생성 중 묶음 ID → 실행기 요청 → 결과를 `bundles.saveDraft`·`markFailed`·`markRepoCheckNeeded`에 맡김 | 중간(섞임) | 일반 부분 `draft-queue.ts:37-43,207-215,478-500,784-880` / Flow 부분 `:99-102,110,473-475,584,597-612,726-740`. 의존 타입 `MentionBundles`가 Flow다 `:94` |
| 에이전트 실행 | `Executor` 포트 | `ExecutorRunRequest`(지침·입력·`outputSchema`·`readRoots`·비밀 패턴·모델·`timeoutMs`·`signal`) → `ExecutorReport` | 약함 | `core/ports/executor.ts:15-100`. 주석 한 줄만 Flow를 언급한다 `:21` |
| 실행 종류 | `RunKind` | `'selection' \| 'draft' \| 'check'` | 약함(닫힌 집합) | `ports/executor.ts:5`, 턴 상한 `agent/claude-cli.ts:76-80`, Codex `agent/codex-executor.ts:176-177` |
| 실행기 구현 | Claude Code·Codex | 읽기 전용 도구, MCP 차단, 첫 `readRoots`가 cwd | 약함 | `agent/claude-code-executor.ts:44-46,91-108`, `agent/codex-executor.ts:48-50` |
| 진행 단계 문구 | `progress-steps` | `"Flow에서 맥락 가져오는 중"` 등 | 중간 | `agent/progress-steps.ts:6-7` |
| 저장소 매핑 | `RepoMappings` | 키(Flow 프로젝트 ID) → `RepoResolution` | 중간 | `core/repos/repo-mappings.ts:54-60,79-85,148-155`. 목록 조회·검증은 Flow `:70-77,176-182,262-265` |
| 자동 선택 | `findSelectionScope` + 선택 실행 | 작업 폴더 → 후보 → `SelectionOutput` | 중간 | 후보 찾기 일반(`draft-queue.ts:671`), 지침·입력 Flow(`core/drafts/repo-selection.ts:8-13,46-55`) |
| 출력 검증 | `readDraftOutput`, `checkDraftOutput` | 구조화 출력 → 요구·문단·근거(위치 확인) | 약함~중간 | `core/drafts/draft.ts:258-310`, `core/drafts/draft-check.ts:35-69`. 근거 위치·비밀 파일 검사는 일반적이나 모양은 "답변 초안"이다(§3) |
| 상태 저장 | `StateStore` 포트 | 계정·기준점·묶음·최소 기록·대기열 | 강함 | `core/ports/state-store.ts:12-89`. 계정 타입이 `FlowEmployee` `:6,23-30` |
| 상태 DB | `state.db` | `mention_bundle`·`mention`·`bundle_answer`·`minimal_record*`·`draft_queue`·`assignment_*` | 강함 | `core/storage/state-database.ts:54-299` |
| 설정 | `Settings` | `repoMappings`(Flow 프로젝트 ID 키)·작업 폴더·에이전트·추가 지침 | 중간 | `core/ports/settings-store.ts:11-34` |
| 검토 스냅숏 | `bundleSnapshot`, `draftSnapshot` | `MentionBundle` → `BundleSnapshot`(송신자·Flow 프로젝트·스레드·받는 사람·게시 가능) | 강함 | `main/review-snapshot.ts:115-145,184-200`, `shared/ipc.ts:561-591,696-757` |
| 검토 화면 | `ReviewView`, `PopoverView`, `BundleDetail` | `BundleSnapshot` → 화면, 명령 `post-bundle` 등 | 강함 | `renderer/src/ReviewView.tsx:61-66,159`, `renderer/src/BundleDetail.tsx:972-985` |
| 게시 | `Posting` | 묶음 ID → Flow 댓글·대댓글 게시, 5초 카운트다운, 결과 확인 | 강함 | `core/posting/posting.ts:25-37,51-59` |
| 트레이·알림 | `reviewCount`, 알림 | 묶음 상태로 셈 | 중간 | `mention-bundles.ts:226-227`, `main/index.ts:462` |
| 필수 설정 | 온보딩 | `flow-key`·`agent`·`work-folders` | 중간 | `core/onboarding/onboarding.ts:10-13,217` |
| 전역 문제 | `global-problems` | `flow-key`·`agent` | 중간 | `core/problems/global-problems.ts:27,46` |

### 프로바이더와 무관하다고 확인한 것 (공유 후보)

- 실행기 포트와 두 구현, 프로세스 실행·시간 초과·취소(`ports/executor.ts`, `agent/*-executor.ts`, `agent/node-process-runner.ts`).
- 에이전트 연결·실행 직전 확인(`RunnableAgent.confirmForRun`, `draft-queue.ts:55-82`).
- 일시적 실패 분류와 전역 실패 의심(`draft-queue.ts:43`, `agent/run-failures.ts`의 `suspectsGlobalFailure`, `draft-queue.ts:2`).
- 비밀 파일 패턴과 근거 경로 검사(`agent/secret-patterns.ts`, `draft-check.ts:35-47,75`).
- 작업 폴더·저장소 후보 찾기(`core/repos/work-folders.ts`, `core/repos/repo-candidates.ts`).
- 매핑 확인 결과 `RepoResolution`과 폴더 존재 확인(`repo-mappings.ts:54-60,322-335`).
- 근거 → 에디터에서 열기(`core/editors/editor-opener.ts`).
- 일반 상태 묶음 개념(생성 중·준비됨·실패·저장소 확인 필요·무시함, `mention-bundle.ts:11-57`)의 **모양**. 단 이 타입은 Flow 전용 상태와 한 유니온이다.

---

## 2. 저장소 매핑 키와 Sentry 프로젝트 추가 (Question 2)

### 지금 묶인 방식

- 설정 파일: `repoMappings: Record<string, string[]>`, 주석상 "Flow 프로젝트 ID → 저장소 절대 경로 목록"(`ports/settings-store.ts:16-17`). 형식 버전은 1이고 마이그레이션 목록은 비어 있다(`ports/settings-store.ts:37`, `core/storage/file-settings-store.ts:15`). 읽을 때 기본값 위에 저장값을 덮으므로(`file-settings-store.ts:58`) **새 필드를 더하는 것만으로는 마이그레이션이 필요 없다.**
- 모듈: `RepoMappings`가 키를 `projectId`라는 이름으로 다루고(`repo-mappings.ts:20-29,148-229`), 화면용 상태에 Flow 참여 프로젝트 목록(`ParticipantProjectsState`)을 함께 싣는다(`repo-mappings.ts:31-51`). 목록은 Flow 연결로 받는다(`repo-mappings.ts:70-77`).
- 키를 꺼내는 곳: 묶음의 `bundle.projectId`(`mention-bundles.ts:650,1022,1100,1216-1226`, `repo-picker.ts:72,140,152,185,190`), 연결은 `resolveRepos: (projectId) => repoMappings.resolve(projectId)`(`main/index.ts:220`), Flow 프로젝트 이름도 같은 모듈에서 받는다(`main/index.ts:245,320`, `repo-mappings.ts:161-170`).
- IPC: 스냅숏 `RepoMappingSnapshot.projectId`(`shared/ipc.ts:286-295`), 명령 `pick-mapping-repos`·`remove-mapping-repo`·`remove-repo-mapping`이 `projectId`를 싣는다(`shared/ipc.ts` `AppCommand` 정의, 930행 이후). 길이 상한 상수는 `FLOW_PROJECT_ID_MAX_LENGTH = 64`(`shared/ipc.ts:51`).

### Sentry 프로젝트를 키로 더할 때의 선택지와 바뀌는 범위

| 선택지 | 저장 스키마 | 바뀌는 코드 | 메모 |
|---|---|---|---|
| (i) 같은 `repoMappings`에 접두사 키(`sentry:<org>/<project>`) | 형식 변경 없음. Flow 키는 접두사 없이 그대로 | `RepoMappings.addRepos`의 알려진 프로젝트 검사(`repo-mappings.ts:179,262-265`), 상태의 `title` 조회(`:114-130`), `RepositoriesSection` 목록·문구(`renderer/src/RepositoriesSection.tsx:140-243`), IPC 명령의 키 길이 상한(`shared/ipc.ts:51`) | 옛 버전 앱으로 내려가면 접두사 키가 Flow 매핑 목록에 "Flow 프로젝트 sentry:…"로 보인다(`RepositoriesSection.tsx:239-240`). Flow 프로젝트 ID가 숫자 문자열인지 코드로 보장하지 않으므로 충돌 가능성은 0이 아니지만 실무상 낮다 |
| (ii) 새 필드 `sentryRepoMappings: Record<string, string[]>` | 새 필드, 기본값 `{}`. 마이그레이션 불필요(`file-settings-store.ts:58`) | `Settings`·`DEFAULT_SETTINGS`(`ports/settings-store.ts:11-52`), `RepoMappings`를 키 공간별로 하나 더 만들거나 매개변수화(`repo-mappings.ts:104-111,279-283`가 `repoMappings` 필드를 직접 읽고 씀), 설정 화면에 Sentry 매핑 칸 | `RepoMappings.save`가 저장 직전에 설정 전체를 다시 읽어 자기 필드만 바꾸므로(`repo-mappings.ts:278-283`) 두 인스턴스가 서로 덮지 않는다 |
| (iii) 프로바이더별 중첩 `repoMappings: { flow: {...}, sentry: {...} }` | 형식 변경 → `SETTINGS_SCHEMA_VERSION` 올리고 마이그레이션 1개 | (ii)의 범위 + 마이그레이션·다운그레이드 안내 | 옛 앱은 `schemaVersion`이 크면 실행하지 않는다(`ports/settings-store.ts:12`) |

공통으로 바뀌는 것:

- **Sentry 프로젝트 목록 조회**: 지금 매핑 화면은 Flow 참여 목록에서만 고른다(`RepositoriesSection.tsx:142-151,204-221`). Sentry 프로젝트 목록 API와 그 실패 상태(티켓 01 범위)를 받을 자리가 필요하다.
- **검토 화면 "연결" 버튼 문구와 키**: "이 Flow 프로젝트에 연결"(`repo-mappings.ts:63-67,195-197`), `MappingMatch` 계산이 `bundle.projectId`를 쓴다(`main/ipc.ts:172`, `repo-picker.ts:72`).
- **필수 설정**: 지금 온보딩은 `flow-key`가 있어야 준비 완료다(`core/onboarding/onboarding.ts:10-13,118-122`). Sentry만 쓰는 사용자를 허용할지는 별도 결정이다.

---

## 3. "게시할 답변 텍스트" 전제 (Question 3)

### 출력 스키마와 읽기

- `draftOutputSchema`는 `requirement{text,summary}` + `paragraphs[].sentences[]{text,evidence[]}` + `evidence[]{id,explanation,repository,path,start_line,end_line}`로 고정이다(`core/drafts/draft.ts:223-247`). 문장 단위로 근거를 다는 "평문 답변" 모양이고, 제목·절·목록·코드 블록을 담을 자리가 없다.
- `readDraftOutput`이 이 모양만 읽고(`draft.ts:258-310`), 문장 0개면 "빈 초안" 실패다(`draft.ts:118-119`, `sentenceCount` `:313-315`).
- `checkDraftOutput`은 비밀 파일 근거 → 번호 맞추기 → 위치 확인을 한다(`draft-check.ts:31-69`). 근거 검사 부분은 진단 보고서에도 그대로 쓸 수 있다. 근거 타입 `DraftEvidence`(`draft.ts:25-44`)도 일반적이다.
- 진단 보고서에 필요한 재현 결과(성공·실패·불가), 원인, 개선 방향(GLOSSARY `진단 보고서`) 필드는 지금 스키마에 없다. 스키마는 `--json-schema`·Codex `--output-schema`로 강제하므로 모든 속성을 `required`로 두는 규칙을 따라야 한다(`draft.ts:218-222,250-252`).

### 지침과 문체

- `DRAFT_INSTRUCTIONS`가 "자기 이름으로 올릴 답변 초안", "코드 이름·파일 이름·설정 키 금지", "5문장 이내, 최대 2문단", "평문만, 글머리표 금지"를 강제한다(`draft-input.ts:12,25-34`). 진단 보고서와 반대다.
- 사용자 추가 지침이 모든 초안에 붙는다(`draft-input.ts:51-55`, 설정 `ports/settings-store.ts:26-27`). 진단에도 붙일지 정해야 한다.
- 검토 스냅숏이 문장마다 개발자 용어를 찾아 표시한다(`main/review-snapshot.ts:186-192`, `core/drafts/style-check.ts:53,74`).

### 검토 화면과 상태

- 편집기 텍스트는 문장을 공백·빈 줄로 이은 평문이고 "검토자가 본 글이 그대로 게시 본문"이다(`core/drafts/post-body.ts:17-23`). 게시 본문 = 받는 사람 멘션 + 편집기 텍스트, 4,000자 상한(`post-body.ts:7,57,75-83`, `shared/ipc.ts:599-600`).
- `DraftSnapshot`이 `recipients`·`postBodyPrefixLength`·`canPost`·`mapping`(Flow 프로젝트 매핑)을 필수로 싣는다(`shared/ipc.ts:561-591`).
- 바닥 줄 행동이 [게시]/[다시 게시]/[시험 끝내기] 중심이다(`renderer/src/BundleDetail.tsx:882-895,972-985`). 진단 보고서는 [파일로 저장]이 그 자리에 와야 한다. 지금 렌더러에는 파일 저장 대화상자 명령이 없다(`AppCommand`에 `open-folder`·`pick-*` 계열만 있음, `shared/ipc.ts` 930행 이후).
- 상태 중 `posting`·`post-failed`·`posted`와 판정 함수 `canPost`·`isBeforePostRequest`·`hasUnpostedDraft`(`mention-bundle.ts:18-25,104-106,204-221`), 게시 기록 `PostingRecord`(`:185-199`), 최소 기록의 `posted`(`:379-389`)는 게시 전제다. 진단 보고서에는 "저장됨" 같은 다른 종착 상태가 필요하다. `mention_bundle.status` 열은 CHECK 제약이 없어 새 값을 넣을 수 있지만, `minimal_record.status`는 CHECK로 닫혀 있어 새 처리됨 상태를 넣으려면 표를 다시 만들어야 한다(`state-database.ts:75` vs `:268`, 그런 이관 선례 `:260-299`).
- 화면 영역 이름이 `original`·`requirement`·`draft`·`evidence`·`repository`·`progress`로 고정이다(`shared/ipc.ts:766-769`). 진단 보고서의 원문(오류 이슈·스택트레이스)과 재현 결과를 어디에 둘지 정해야 한다.
- 재생성(다시 만들기·지시·요구 고치기)은 출력 모양만 같으면 일반적으로 쓸 수 있다(`draft.ts:76-98`, `draft-input.ts:77-81,116-144`). 다만 직전 결과를 문장·근거 번호로 되돌려 쓰는 부분(`draft-input.ts:122-139`)은 답변 모양에 묶여 있다.

---

## 4. 경계 후보 (Question 4)

공통 전제: 프로바이더와 무관한 실행기 포트(`ports/executor.ts`)는 세 후보 모두 그대로 공유한다. 차이는 **seam을 어디에 두느냐**다.

### 후보 A. 대상 종류 확장 (seam 없음, 기존 모듈 안에서 분기)

- **모양**: `MentionBundle`에 `errorIssue?: SentryIssueRef`(이슈 ID·프로젝트 슬러그·마지막 이벤트 요약)를 담당 업무와 같은 방식으로 더한다. `MentionBundles`가 Sentry 이슈로도 묶음을 만들고, `prepareRun`이 종류별로 Flow 맥락 또는 Sentry 이벤트를 조회한다. `DraftQueue`는 그대로 하나, 지침·스키마·`timeoutMs`를 종류로 고른다. 검토 화면은 `BundleSnapshot`에 진단 필드를 더한다.
- **근거가 되는 선례**: 담당 업무가 정확히 이 길을 갔다(`mention-bundle.ts:245-264,295`, `assignment-detection.ts:43-44`).
- **깊이·지역성**: `MentionBundles`의 인터페이스가 Flow 행동(내 답·사라짐·받는 사람·게시)과 Sentry 행동을 모두 노출해 넓어진다. 종류 분기가 `prepareRun`·`runData`·지침·스냅숏·바닥 줄에 흩어져 지역성이 떨어진다(담당 업무 분기 위치: `mention-bundles.ts:609-613`, `draft-queue.ts:731`, `draft-input.ts:170`, `review-snapshot.ts:144-145`).
- **저장**: `mention_bundle`의 `post_id`·`remark_id`·`project_id`가 `NOT NULL`이라(`state-database.ts:70-80`) Sentry 값을 억지로 채우거나 표를 다시 만들어야 한다. 묶음 자리 키 `bundlePlaceKey`(`mention-bundle.ts:394-397`)와 최소 기록(`:370-381`)도 Flow 위치 기반이다.
- **바뀌는 파일**: `core/bundles/mention-bundle.ts`, `core/bundles/mention-bundles.ts`, `core/drafts/draft-queue.ts`, `core/drafts/draft.ts`, `core/drafts/draft-input.ts`, `core/storage/state-database.ts`, `core/ports/state-store.ts`, `core/fakes/memory-state-store.ts`, `main/review-snapshot.ts`, `main/ipc.ts`, `shared/ipc.ts`, `renderer/src/BundleDetail.tsx`·`ReviewView.tsx`·`PopoverView.tsx`, 새 `core/sentry/*`(감지·API).
- **Flow 회귀 위험: 높음.** 가장 큰 두 파일(`mention-bundles.ts` 1,607줄, `draft-queue.ts` 1,048줄)과 가장 큰 테스트(`draft-queue.test.ts` 4,262줄, `review-screens.test.tsx` 1,479줄)에 분기를 넣는다. 묶음 변경이 하나의 직렬 줄(`mention-bundles.ts:136-137`)을 공유하므로 Sentry 처리 지연이 Flow 묶음 변경을 늦출 수 있다. 대기열이 Flow 키 없으면 멈추는 조건(`draft-queue.ts:473-475`)을 종류별로 풀어야 한다.
- **다음 프로바이더 점검(설계 아님)**: Slack·Gmail도 같은 타입에 선택 필드를 하나씩 더하게 되어 유니온이 계속 커진다.

### 후보 B. 생성 대기열 아래 프로바이더 어댑터 seam

- **모양**: `DraftQueue`에서 프로바이더와 무관한 부분(직렬 실행, 우선순위, 대기열 저장, 실행 직전 에이전트 확인, 일시적 실패 1회 재시도, 전역 실패 멈춤, 취소·앱 종료, 진행 단계)을 **생성 대기열** 모듈로 남기고, 대상마다 다른 부분을 **대상 어댑터 인터페이스**로 받는다. 인터페이스는 대략 다음 정도의 크기다(이름은 예시).
  - `prepare(targetId)` → 실행할 입력(지침·입력 문서·출력 스키마·읽을 저장소 해석 결과·`timeoutMs`·`RunKind`) 또는 "건너뜀 / 이 어댑터의 연결 문제로 멈춤 / 잠시 뒤 다시"
  - `read(output)` → 앱이 읽은 결과 또는 구조 실패
  - `save(targetId, result, runs)` / `fail(targetId, failure, runs)` / `needsRepoCheck(targetId, reason, runs)`
  - 대기열에 넣을 대상과 "그대로 생성 중인가"(지금 `isStillGenerating`의 `mentionSet` 비교 `draft-queue.ts:420-425`)
  Flow 어댑터는 지금의 `MentionBundles` + `draft-input` + `repo-selection`을 감싼 것이고, Sentry 어댑터는 새 오류 이슈 모듈이다. **어댑터가 둘이므로 가설이 아닌 실제 seam이다.**
- **깊이·지역성**: 생성 대기열은 재시도·멈춤·취소 정책을 한곳에 두어 두 프로바이더에 레버리지를 준다. Flow 전용 판단("이미 답함", 담당 해제, Flow 키, Flow 미도달 `draft-queue.ts:597-612`)은 Flow 어댑터 안으로 들어가 지역성이 좋아진다. 멈춤 까닭 `flow-key`·`flow-unreachable`(`draft-queue.ts:128-131`)은 "어댑터별 멈춤"으로 일반화해야 하며, 이때 **한 프로바이더 문제로 다른 프로바이더 대상까지 멈추지 않게** 할 수 있다.
- **대상 저장**: Sentry 대상은 새 표(예: 오류 이슈·진단 보고서)로 둔다. `draft_queue`에 대상 종류 열을 더하는 이관이 필요하다(`state-database.ts:206-210`). `StateStore` 포트는 Sentry 메서드가 늘거나 별도 포트로 나뉜다(`ports/state-store.ts:12`).
- **검토 화면**: 목록·트레이 수는 "생성 중·준비됨·실패·처리됨" 묶음(`mention-bundle.ts:36-57`) 개념을 공유하고, 상세는 종류별 컴포넌트로 나누는 것이 자연스럽다. `ReviewSnapshot.bundles`(`shared/ipc.ts:772-779`)를 종류 유니온으로 바꾸거나 진단 목록을 따로 싣는 선택이 남는다(티켓 08·검토 화면 결정 범위).
- **바뀌는 파일**: `core/drafts/draft-queue.ts`(분리), 새 Flow 어댑터 파일(기존 `mention-bundles.ts`의 `prepareRun`·`reposForRun`·`saveDraft`·`markFailed`·`markRepoCheckNeeded`를 감쌈, `mention-bundles.ts:569-712`), `core/drafts/draft.ts`(`QueuedDraft`에 종류), `core/storage/state-database.ts`·`core/fakes/memory-state-store.ts`(대기열 표), `core/ports/executor.ts`(`RunKind` 추가 시)·`agent/claude-cli.ts`·`agent/codex-executor.ts`, `main/index.ts`(조립 `:233-245`), 새 `core/sentry/*`, 검토 화면 쪽은 결정에 따라.
- **Flow 회귀 위험: 중간.** `draft-queue.test.ts`가 실제 `MentionBundles`·`MemoryStateStore`·`FakeExecutor`를 조립해 `DraftQueue` 인터페이스로 검증하므로(`draft-queue.test.ts:16,20,175-215`) 내부를 나눠도 같은 테스트가 Flow 동작을 붙잡아 준다. 위험 지점은 (1) 우선순위·`resume` 재진입과 저장된 대기열 복원(`draft-queue.ts:244-276,881-912`), (2) 멈춤 까닭 일반화, (3) `draft_queue` 이관이다.
- **다음 프로바이더 점검**: Slack·Gmail은 "대상 준비 → 입력 문서 → 출력 → 저장"을 어댑터로 붙이면 되고 대기열 정책은 그대로 쓴다. 게시 여부는 어댑터 뒤의 일이라 대기열과 무관하다.

### 후보 C. 실행기 포트 아래만 공유 (병렬 파이프라인)

- **모양**: Sentry가 감지·오류 이슈 저장·진단 대기열·검토 화면을 모두 따로 갖는다. 공유는 `Executor`·`RunnableAgent`(에이전트 연결과 실행 직전 확인 `draft-queue.ts:55-82`)·`RepoMappings`(키 공간만 추가, §2)·작업 폴더 후보 찾기·비밀 파일 패턴·근거 검사(`draft-check.ts`)·에디터 열기다.
- **깊이·지역성**: Flow 모듈은 그대로라 Flow 지역성은 유지된다. 대신 재시도·전역 실패 멈춤·취소·대기열 저장 로직이 두 대기열에 중복되어(지금 `draft-queue.ts` 1,048줄의 상당 부분) 정책을 고칠 때 두 곳을 고쳐야 한다.
- **동시 실행**: 직렬 보장이 `DraftQueue` 안의 `busy`뿐이라(`draft-queue.ts:221-222`) 두 대기열이 같은 에이전트를 동시에 돌린다. 막으려면 실행기 앞에 공용 "에이전트 줄"을 두는 작은 공용 모듈이 필요하다(이것만 공유하면 C, 더 공유하면 B에 가까워진다).
- **바뀌는 파일**: 새 `core/sentry/*`·새 진단 대기열·새 상태 저장(별도 표나 별도 DB 파일), `core/repos/repo-mappings.ts`·`ports/settings-store.ts`(매핑 키), `core/ports/executor.ts`·`agent/claude-cli.ts`·`agent/codex-executor.ts`(`RunKind` 추가 시), `main/index.ts`·`main/ipc.ts`·`shared/ipc.ts`, 새 렌더러 화면. Flow 파일은 `main/index.ts` 조립과 IPC 정도만 바뀐다.
- **Flow 회귀 위험: 낮음.** Flow 경로 코드를 거의 건드리지 않는다. 남는 위험은 (1) `state.db`를 함께 쓸 경우 마이그레이션 순서와 계정 전환 시 전체 삭제(`state-database.ts:404-417`), (2) 동시 실행으로 인한 에이전트 사용량·로그인 충돌, (3) 트레이 검토 수·알림 합산(`main/index.ts:462`) 정도다.
- **다음 프로바이더 점검**: 프로바이더마다 대기열이 하나씩 늘어 중복이 선형으로 커진다.

### 후보 비교

| | A. 대상 종류 확장 | B. 생성 대기열 어댑터 seam | C. 실행기 아래만 공유 |
|---|---|---|---|
| seam 위치 | 없음(모듈 안 분기) | 생성 대기열 ↔ 대상 어댑터 | 실행기 포트(+선택적으로 에이전트 줄) |
| 어댑터 수 | — | 2(Flow, Sentry) | 1 seam에 2 사용자 |
| 새 코드량 | 적음 | 중간 | 많음(중복) |
| Flow 회귀 위험 | 높음 | 중간(기존 테스트가 보호) | 낮음 |
| Flow 키 문제가 Sentry를 멈추나 | 그대로면 멈춤(`draft-queue.ts:473-475`) | 어댑터별 멈춤으로 분리 가능 | 분리됨 |
| 진단이 Flow 초안을 늦추나 | 늦춤(직렬 공유) | 정책으로 결정(공유 직렬 또는 분리) | 안 늦춤, 대신 동시 실행 |
| 계정 전환 시 Sentry 기록 삭제 | 삭제됨 | 같은 DB면 삭제됨 | 같은 DB면 삭제됨 |

---

## 확인하지 못한 것

- Sentry API 응답 모양·인증·목록 조회 가능 여부는 이 티켓 범위가 아니다(티켓 01). 위 Sentry 쪽 필드 이름은 예시다.
- 렌더러 화면을 실제로 띄워 보지 않았다. 화면 주장은 컴포넌트·스냅숏 코드 근거만 있다.
- 각 후보의 실제 변경 줄 수는 추정하지 않았다.
