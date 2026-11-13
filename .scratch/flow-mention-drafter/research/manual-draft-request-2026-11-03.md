# 에이전트 장애 기간의 누락분과 수동 초안 요청 조사

- 조사일: 2026-11-03
- 범위: 현재 저장소의 코드·테스트·스펙만 1차 출처로 읽었다. 코드는 바꾸지 않았다. 사용자 PC의 `state.db`와 로그는 열어 보지 않았다. 외부 문서(Codex CLI의 구독 종료 시 오류 문구 등)는 조회하지 않았다.
- 실행한 검증: `apps/desktop`에서 `npx vitest run src/core/drafts/draft-queue.test.ts src/core/detection/mention-detection.test.ts -t "전역|에이전트 연결이 없으면|오류로 끝나면|72시간|일시적 실패가 아닌|다시 시도하면"` → 23건 통과(나머지 180건은 이름 필터로 건너뜀). 아래 동작 주장 가운데 테스트 이름을 함께 적은 것은 이 실행으로 확인했다.
- 사용자 질문: Codex 이용이 중지된 상태에서 앱이 돌아 "감지"를 못 했다. 에이전트를 Claude로 바꿨으니 그동안 놓친 내용을 다시 스캔해 초안을 만들고 싶다. 자동 감지가 아닌 수동 초안 요청 경로도 있었으면 한다.

## 결론

1. **감지는 에이전트를 쓰지 않는다.** 멘션 감지와 담당 업무 감지는 Flow API만 조회해 멘션 묶음을 만든다. 에이전트는 그 뒤 초안 대기열이 초안을 만들 때만 쓴다. 그래서 Codex가 멈춘 동안에도 앱이 켜져 있고 Flow 키가 유효했다면 멘션은 감지되어 묶음으로 남아 있다(`apps/desktop/src/core/detection/mention-detection.ts:169-243`, `apps/desktop/src/main/index.ts:423-433`).
2. **에이전트 실패만으로 항목이 영구히 건너뛰어지지는 않는다.** 실패 유형에 따라 두 가지로 남는다.
   - 전역 실패(미로그인, CLI 없음, CLI 오류이면서 다시 한 연결 확인도 실패): 묶음은 **생성 중**으로 남고 대기열만 멈춘다. 기본 에이전트가 Claude로 바뀌는 등 에이전트 연결이 바뀌면 자동으로 다시 돈다.
   - 그 밖의 에이전트 오류(`agent-error`, 사용량 한도 같은 경우): 묶음마다 **실패**가 되고 기한 없이 남는다. 실패 묶음마다 [다시 시도]를 눌러야 다시 만든다. 한꺼번에 다시 시도하는 기능은 없다.
3. **영구히 놓치는 경우는 에이전트가 아니라 감지 규칙에서 생긴다.** 앱이 꺼져 있거나 Flow 키가 막혀 72시간이 넘게 조회하지 못했으면, 그보다 오래된 멘션은 다시 가져오지 않는다(스펙상 의도된 동작). 사용자가 실패 묶음을 [무시]했고 7일이 지났으면 최소 기록만 남아 다시 감지되지도, 되돌려지지도 않는다.
4. 코드 변경 없이 바로 할 수 있는 조치는 **작은 창의 실패·생성 중 묶음 확인 → 기본 에이전트를 Claude로 → 실패 묶음마다 [다시 시도]**다. `state.db`의 기준점을 내리는 방법은 72시간 제한과 멘션 위치 중복 방지 때문에 효과가 없다.
5. 권장 설계 순서는 **(c) 에이전트 실패를 묶음 실패가 아닌 대기열 멈춤으로 다루고, 실패 묶음 일괄 다시 시도 추가** → **(a) 멘션 하나를 골라 실제(게시 가능한) 묶음으로 만드는 수동 요청**이다. (b) 기간 지정 백필은 비용 폭증과 스펙 충돌이 커서 마지막으로 둔다.

## 1. 현재 감지 → 초안 파이프라인

### 1-1. 트리거

| 트리거 | 동작 | 근거 |
| --- | --- | --- |
| 폴링 | 60초마다 알림 목록 조회. 설정으로 바꿀 수 없다. | `apps/desktop/src/core/detection/mention-detection.ts:15`, `:129-163` |
| 앱 시작·[감지 시작]·키 재확인 | `start()`로 바로 조회 후 폴링 시작. 감지를 시작했고 쓸 수 있는 Flow 키가 있을 때만 돈다. **에이전트 연결은 조건이 아니다.** | `apps/desktop/src/main/index.ts:423-433`, `:502-509` |
| 잠자기에서 깨어남 | `checkNow()` | `apps/desktop/src/main/index.ts:439-441` |
| 트레이 "지금 확인" | `checkNow()` | `apps/desktop/src/main/index.ts:454`, `mention-detection.ts:90-93` |
| 담당 업무 감지 | 멘션 조회가 끝날 때마다 같은 주기로 `assignments.checkNow()`를 부른다. 키 거부로 멈출 때는 부르지 않는다. | `mention-detection.ts:141-145` |

### 1-2. 대상

- **멘션**: Flow 알림 목록(`listMentionAlarms`)에서 기준점 뒤의 알림을 최신부터 모으고, 오래된 것부터 판정한다(`apps/desktop/src/core/flow/mention-alarms.ts:19-34`, `mention-detection.ts:183-229`). 판정을 통과한 멘션은 `addDetected`로 멘션 묶음에 들어간다(`mention-detection.ts:234`, `:271-282`).
- **담당 업무**: `listWorkerAlarms`(WORKER 알림)로 후보를 찾고, 게시글 상세와 댓글을 조회해 배정 시점 근거가 확인된 업무만 `addAssignment`로 넣는다(`apps/desktop/src/core/detection/assignment-detection.ts:89-114`, `:138-194`).

### 1-3. 진행 상태 저장

| 상태 | 저장 위치 | 규칙 | 근거 |
| --- | --- | --- | --- |
| 멘션 기준점 | `state.db`의 `detection.baseline_alarm_id` | 이미 본 가장 큰 `alarmId`. 판정을 마친 알림까지만 옮기고, 판정을 통과한 멘션과 **같은 트랜잭션으로** 저장한다. | `apps/desktop/src/core/storage/state-database.ts:40-43`, `:557-561`, `mention-detection.ts:198-234` |
| 기준점이 없을 때 | — | 가장 최근 알림을 기준점으로 잡고 과거 멘션은 가져오지 않는다(첫 실행, 다른 계정으로 바꿈). | `mention-detection.ts:257-269` |
| 72시간 범위 | 상수 | 기준점 뒤라도 72시간보다 오래된 알림은 모으지 않는다. | `mention-detection.ts:17`, `:184`, `mention-alarms.ts:27`, `:36-41`; 테스트 `mention-detection.test.ts:227`, `:533` |
| 담당 업무 상태 | `state.db`의 `assignment_detection`(JSON) | 계정, `enabledAt`(기능 시작 시각), `baselineAlarmId`, `initialPostIds`(시작 전 업무), `pending`(판별 못 한 후보), `scan`(끝내지 못한 순회 커서) | `assignment-detection.ts:12-37`, `:72-78`; `state-database.ts:256` |
| 초안 대기열 | `state.db`의 `draft_queue` | 대기 순서와 우선순위를 바뀔 때마다 남기고 다시 켤 때 복원한다. | `apps/desktop/src/core/drafts/draft-queue.ts:244-270`, `:449-464` |

### 1-4. 중복 방지·제외 규칙

- **멘션 위치 단위 중복 방지**: 이미 `mention` 표나 `minimal_record_mention`(처리됨 목록에서 빠진 최소 기록)에 있는 멘션 위치의 알림은 글을 조회하지 않고 버린다(`mention-detection.ts:284-288`, `state-database.ts:450-460`). `addDetected`도 묶음과 최소 기록에 있는 위치, 처리한 담당 업무 본문 자리를 건너뛴다(`apps/desktop/src/core/bundles/mention-bundles.ts:335-349`).
- **판정 실패 3회 포기**: 서버 오류·모르는 응답처럼 그 글에서만 생기는 실패가 3번 이어지면 그 알림을 버리고 기준점을 넘긴다. 키 거부·연결 실패·요청 한도는 버리지 않고 기다린다(`mention-detection.ts:18-22`, `:290-309`). 이 실패는 Flow 실패이고 에이전트와는 상관없다.
- **이미 답함**: 감지 때 묶음 자리의 내 답을 조회해 판정하고(`mention-bundles.ts:364-371`), 초안 실행 직전에 맥락을 새로 조회해 다시 판정한다. 그사이 답했으면 실행하지 않고 처리됨(이미 답함)으로 옮긴다(`mention-bundles.ts:569-637`, `draft-queue.ts:597-599`).
- **담당 업무 제외**: 기능 시작 전 업무(`initialPostIds`), 자기 작성 업무, 활성(요청)이 아닌 업무, 댓글 쪽 상한을 넘은 업무, 배정 근거가 없거나 기능 시작 전 배정인 업무는 후보에서 뺀다. 57a768d가 "다시 조회해도 결과가 같은 보류"를 `pending`에 남기지 않고 빼도록 바꿨다(`assignment-detection.ts:154-188`). 같은 업무는 `assignment_record`로 한 번만 묶음이 되고, 감지 때 이미 답했으면 본문 맥락을 저장한 채 이미 답함으로 남긴다(`mention-bundles.ts:262-313`, 특히 `:295-301`).
- **보관 기한**: 처리됨 묶음(게시됨·무시·이미 답함·원문 사라짐·담당 해제)은 처리한 지 7일 뒤 최소 기록만 남긴다. **생성 중·실패·준비됨처럼 처리되지 않은 묶음에는 기한이 없다**(`apps/desktop/src/core/bundles/retention.ts:10-22`, `apps/desktop/src/core/bundles/mention-bundle.ts:39-65`).

## 2. 에이전트 선택과 실패 처리

### 2-1. 어떤 에이전트로 실행하나

- 대기열은 실행할 때마다 기본 에이전트와 그 모델을 새로 읽는다(`draft-queue.ts:71-82`, `:507-517`, `apps/desktop/src/main/index.ts:234-238`).
- 기본 에이전트는 저장한 값이 연결되어 있으면 그 값, 아니면 연결된 Claude Code, 그것도 없으면 연결된 첫 에이전트다(`apps/desktop/src/core/agent/agent-preferences.ts:135-138`). 연결되지 않은 에이전트는 기본으로 고를 수 없다(`agent-preferences.ts:96-101`).
- 실행 직전 확인(`confirmForRun`)은 CLI 버전만 다시 읽는다. 로그인 확인과 작동 확인(점검 실행)은 앱 시작 때와 전역 실패가 의심될 때만 돈다(`apps/desktop/src/core/agent/agent-connection.ts:254-284`, `:298-310`, `apps/desktop/src/main/index.ts:510-511`).

### 2-2. 실패 분류

| 실패 사유 | 분류 | 대기열 동작 | 묶음 결과 | 근거 |
| --- | --- | --- | --- | --- |
| `invalid-output`, `overloaded`, `network` | 일시적 | 한 번 더 실행 | 두 번째도 실패면 **실패** | `draft-queue.ts:37-43`, `:815-821`, `:982-985` |
| `cli-missing`, `cli-error`, `not-logged-in` | 전역 실패 의심 | 연결 확인을 다시 돌리고, 확인도 실패하면 대기열 멈춤 | **생성 중** 유지, 대기열 맨 앞으로 되돌림 | `apps/desktop/src/core/agent/run-failures.ts:3-12`, `draft-queue.ts:801-814`, `:898-910`; 테스트 `draft-queue.test.ts:1325`, `:1985` |
| 위와 같으나 다시 한 연결 확인은 통과 | 일시적처럼 | 한 번 더 실행 | 또 실패면 **실패** | `draft-queue.ts:812-821`; 테스트 `draft-queue.test.ts:1804` |
| `agent-error`(사용량 한도, 모델 없음 등), `max-turns` | 묶음 실패 | 멈추지 않고 다음 묶음 실행 | **실패**, 다시 실행하지 않음 | `apps/desktop/src/core/ports/executor.ts:53-67`, 테스트 `draft-queue.test.ts:677-687`, `:1680-1690` |
| `timed-out`, 비밀 파일 근거 등 | 묶음 실패 | 다음 묶음 | **실패** | `draft-queue.ts:39-43`, 테스트 `draft-queue.test.ts:629` |
| 실행 직전 확인 실패, 연결 없음 | 전역 | 대기열 멈춤 | 생성 중 유지 | `draft-queue.ts:519-538`; 테스트 `draft-queue.test.ts:781`, `:1820` |

CLI 출력에서 사유를 정하는 규칙:

- Codex: 턴 실패 문장이 `401|unauthorized|not logged in|log in again|refresh token`이면 `not-logged-in`, 과부하·연결 문구면 일시적 실패, **그 밖(사용량 한도 등)은 `agent-error`**다. 턴 실패 없이 0이 아닌 종료 코드면 `cli-error`다(`apps/desktop/src/core/agent/codex-executor.ts:257-290`).
- Claude Code: `authentication_failed`면 `not-logged-in`, `overloaded`/529면 과부하, 상태 없는 `server_error`면 네트워크, 그 밖은 `agent-error`(`apps/desktop/src/core/agent/claude-code-executor.ts:249-255`).

### 2-3. 실패는 기록되는가

- 묶음이 실패가 되면 사유·CLI 오류 원문·마지막 단계·실행 종류가 묶음에 남고, 실행마다 실행 기록이 쌓인다(`mention-bundles.ts:699-711`, `draft-queue.ts:851-874`, `:977-980`). 화면에 오류 원문이 보인다(`apps/desktop/src/renderer/src/review-text.ts:234-239`, 테스트 `review-screens.test.tsx:464-474`).
- 실패 묶음이 하나라도 있으면 트레이가 문제 표시를 한다(`mention-bundles.ts:235-238`, `apps/desktop/src/main/index.ts:476-485`).
- 진단 로그에는 `draft.queue-paused`(cause), `draft.global-failure`, `draft.run-finished`(result), `agent.check-failed`, `bundle.generation-failed`가 ID·사유만으로 남는다(`draft-queue.ts:553-558`, `:809`, `:867-873`, `agent-connection.ts:399`).

### 2-4. 사용자 상황(Codex 이용 중지)에 대입

Codex 구독이 끝났을 때 CLI가 어떤 문장을 내는지는 이 저장소에서 확인하지 못했다(미확인 경계). 문장에 따라 두 갈래다.

1. **로그인 만료·401로 끝났거나 앱 시작 때 작동 확인이 실패한 경우**: Codex는 연결되지 않은 에이전트가 되고, 대기열은 멈추며 감지한 묶음은 **생성 중**으로 쌓인다. Claude Code가 연결되어 있으면 기본 에이전트가 자동으로 Claude Code로 넘어가고(`agent-preferences.ts:135-138`), 에이전트 변경 알림(`apps/desktop/src/main/index.ts:238`, `draft-queue.ts:265`, `:560-570`)으로 대기열이 다시 돈다. 실행 직전에 이미 답함을 다시 판정하므로, 그사이 Flow에서 직접 답한 묶음은 실행하지 않는다.
2. **사용량 한도 같은 문구(`agent-error`)로 끝난 경우**: Codex 작동 확인은 앱 시작 때 이미 통과했으므로 연결은 유지되고, 감지한 묶음마다 한 번씩 Codex를 띄워 **실패**로 쌓인다. 기본 에이전트를 Claude Code로 바꿔도 실패 묶음은 자동으로 다시 돌지 않는다. 묶음마다 [다시 시도]가 필요하다(`mention-bundles.ts:737-742`, `draft-queue.ts:343-346`). 예외로, 실패 묶음 자리에 새 멘션이 오면 자동으로 다시 시도된다(`mention-bundles.ts:1517-1518`, 테스트 `draft-queue.test.ts:2567`).

어느 경우든 **에이전트 실패 때문에 "본 것"으로 처리되어 영구히 사라지는 항목은 없다.** 감지 기준점은 에이전트 결과와 무관하게 판정을 마친 시점에 옮겨지지만, 그때 묶음이 함께 저장되기 때문이다(`mention-detection.ts:234`, `state-database.ts:557-561`).

### 2-5. 실제로 영구히 놓치는 경로

| 경로 | 왜 다시 오지 않나 | 근거 |
| --- | --- | --- |
| 앱이 꺼져 있었거나 Flow 키 거부로 폴링이 멈춘 채 72시간 넘게 흐름 | 72시간 밖 알림은 모으지 않고, 이후 기준점이 그보다 큰 알림으로 옮겨져 다시 보지 않는다. 스펙의 의도된 동작이다. | `mention-detection.ts:17`, `:184`, `.scratch/flow-mention-drafter/spec.md:58`, `:218-221`, `:231` |
| 쪽 수 상한에 닿음 | 경고 로그만 남기고 더 오래된 알림은 보지 않는다. | `mention-detection.ts:186` |
| 판정이 3번 이어서 실패(Flow 쪽 글 단위 실패) | 버리고 기준점을 넘긴다. | `mention-detection.ts:290-309` |
| 실패 묶음을 [무시]한 뒤 7일이 지남 | 최소 기록만 남아 감지에서 그 위치를 버리고, 되돌리기도 막힌다. | `retention.ts:16-22`, `mention-bundles.ts:1010-1028`, `state-database.ts:450-460` |
| 담당 업무: 기능 시작 전 업무, 기능 시작 전 배정 | 설계상 제외 | `assignment-detection.ts:126-130`, `:156-188`, `.scratch/flow-task-assignment-drafts/spec.md:12`, `:87` |

## 3. 이미 있는 수동·재시도 경로

| 경로 | 무엇을 하나 | 한계 | 근거 |
| --- | --- | --- | --- |
| [다시 시도] | 실패 묶음을 생성 중으로 되돌려 사용자 우선순위로 대기열에 넣는다. | 묶음 하나씩. 일괄 버튼 없음. | `shared/ipc.ts:982`, `main/ipc.ts:328-329`, `renderer/src/useReview.ts:220-221`, `renderer/src/BundleDetail.tsx:880-968`, `mention-bundles.ts:737-742`, `draft-queue.ts:343-346` |
| [되돌리기] | 무시·이미 답함·원문 사라짐·담당 해제 묶음을 되돌린다. 초안이 없으면 다시 생성 중이 된다. | 처리한 지 7일 안만. 게시됨은 불가. | `mention-bundle.ts:75-78`, `mention-bundles.ts:1005-1040`, `draft-queue.ts:365-368` |
| 재생성 3경로, 저장소 골라 만들기 | 준비됨·저장소 확인 필요 묶음을 다시 만든다. | 이미 있는 묶음 대상 | `mention-bundles.ts:744-782`, `draft-queue.ts:348-363` |
| 최근 멘션으로 시험 | 판정 규칙을 통과한 최근 멘션 10건(72시간 제한 없음, 기준점·기존 기록 무관)에서 골라 실제 에이전트로 초안을 만든다. | **게시할 수 없고**, 끝내거나 무시하면 기록째 지운다. 한 번에 하나. 멘션만(담당 업무 불가). 최대 10쪽까지만 훑는다. | `core/trial/recent-mentions.ts:6-30`, `core/trial/trial-run.ts:52-105`, `mention-bundles.ts:1091-1139`, `:823-826`(`!bundle.trial`), `.scratch/flow-mention-drafter/spec.md:670-674` |
| 재시작·재지정 복구(d8a2eaa, fe3a935) | 앱 종료로 끊긴 생성은 대기열 맨 앞에서 다시 돌고, 담당 업무 초안의 재시도·재지정을 실제 DB로 검증 | 이미 생긴 묶음의 복구이며 새 항목 수집은 아님 | `draft-queue.ts:244-270`, `.scratch/flow-task-assignment-drafts/issues/06-recovery-and-final-verification.md` |

"최근 멘션으로 시험"이 사용자가 말한 "수동 초안 요청"에 가장 가깝다. 다만 시험 묶음이라 게시와 처리 기록이 막혀 있다.

## 4. 설계안

### (a) 멘션 하나를 골라 실제 묶음으로 초안 만들기

- **동작**: 시험 고르기 목록과 같은 방식으로 최근 멘션을 보여 주되, 고른 멘션을 시험이 아닌 실제 묶음(게시 가능)으로 만든다. 이미 묶음이나 최소 기록에 있는 위치면 새로 만들지 않고 그 묶음의 [다시 시도]·[되돌리기]·재생성으로 안내한다.
- **건드릴 모듈**: `core/trial/recent-mentions.ts`(목록 재사용, 10건·10쪽 상한을 넓힐지 결정), `core/trial/trial-run.ts`(고르기 상태 재사용 또는 분리), `core/bundles/mention-bundles.ts`(`startTrial`과 비슷하되 `trial: false`이고 `addDetected`의 중복·이미 답함 판정을 타는 입구), `core/storage/state-database.ts`(기준점을 옮기지 않는 저장. 지금 `saveDetectedBundles`는 기준점을 함께 쓴다, `:557-561`), `shared/ipc.ts`·`main/ipc.ts`·renderer `TrialPicker.tsx`.
- **기존 규칙과의 충돌**: 멘션 위치 중복 방지(`state-database.ts:450-460`)와 최소 기록. 7일이 지난 무시 항목을 수동으로 살릴지 정해야 한다. 이미 답함 판정을 수동 요청에도 적용할지(시험은 판정하지 않음, `mention-bundles.ts:603-609`)도 결정해야 한다. 72시간 규칙은 자동 감지의 규칙이라 수동 요청과는 충돌하지 않는다.
- **위험**: 중복 초안은 위치 중복 방지를 그대로 타면 막힌다. 비용은 요청 하나에 실행 한 번(선택 실행 포함 최대 2단계 × 2회)으로 묶인다. 담당 업무는 `addAssignment`가 배정 시점 근거를 요구하므로(`mention-bundles.ts:262-263`) 업무 수동 요청은 별도 입구가 필요하다.
- **가장 싼 검증**: `mention-bundles.test.ts`에서 가짜 Flow로 72시간보다 오래된 멘션을 수동 요청하면 생성 중 묶음이 생기고 기준점은 그대로인지, 같은 위치를 두 번 요청하면 두 번째는 묶음을 만들지 않는지, 그 뒤 같은 위치 알림이 오면 감지가 버리는지 확인한다.

### (b) 기간 지정 재스캔(백필)

- **동작**: 사용자가 기간(예: 최근 7일)을 정하면 그 기간의 알림을 다시 판정해, 중복 방지를 통과한 멘션만 묶음으로 넣는다. 먼저 건수를 보여 주고 확인을 받는다.
- **건드릴 모듈**: `core/flow/mention-alarms.ts`(기준점 대신 시작 시각으로 모으는 변형), `core/detection/mention-detection.ts`(판정 루프 재사용, 기준점은 뒤로 옮기지 않음), `mention-bundles.ts` `addDetected`(지금 기준점과 함께 저장하므로 기준점을 그대로 넘기는 변형), 설정 UI와 IPC.
- **기존 규칙과의 충돌**: 스펙의 72시간 규칙과 "과거 멘션은 가져오지 않는다"(`.scratch/flow-mention-drafter/spec.md:58`, `:220-221`)를 사용자가 명시적으로 넘는 기능이 된다. 담당 업무 백필은 "기능 시작 전부터 담당하던 업무의 일괄 초안 생성"을 범위 밖으로 둔 결정(`.scratch/flow-task-assignment-drafts/spec.md:87`)과 충돌한다.
- **위험**: 비용 폭증이 가장 크다. 묶음마다 선택 실행·초안 실행이 각 최대 2회, 초안 실행은 최대 10분이다(`draft-queue.ts:33-38`). 이미 Flow에서 답한 멘션은 감지·실행 직전 이미 답함 판정으로 걸러지지만(`mention-bundles.ts:364-371`, `:569-637`), 조회가 실패한 자리는 "모름"으로 넘어가 초안이 생길 수 있다(`mention-detection.ts:331-344`). 상한·확인 단계가 없으면 Flow 요청 한도에도 걸리기 쉽다.
- **가장 싼 검증**: 가짜 시계로 5일 전 알림이 7일 백필에서 잡히고 기준점은 바뀌지 않는지, 이미 기록된 위치는 버리는지, 건수 미리보기가 실행 없이 나오는지를 단위 테스트로 본다.

### (c) 에이전트 실패로 생긴 실패를 대기열 멈춤으로 다루고, 일괄 다시 시도

- **동작**:
  1. 사용량 한도·구독 종료처럼 모든 묶음에 똑같이 생길 에이전트 오류는 묶음 실패가 아니라 전역 실패로 보고 대기열을 멈춘다. 묶음은 생성 중으로 남아 에이전트가 바뀌거나 다시 확인되면 이어서 돈다.
  2. 이미 실패가 된 묶음은 "에이전트 원인 실패 모두 다시 시도"로 한 번에 생성 중으로 되돌린다. 기본 에이전트가 바뀔 때 이 동작을 제안할 수도 있다.
- **건드릴 모듈**: `core/agent/run-failures.ts`(전역 의심 집합), `core/agent/codex-executor.ts:285-290`·`claude-code-executor.ts:249-255`(사용량 한도 문구 분류), `core/drafts/draft-queue.ts`(전역 판정 경로는 이미 있음, `:801-814`), `core/bundles/mention-bundles.ts`(`retry`의 다건 판), `shared/ipc.ts`·`main/ipc.ts`·renderer.
- **기존 규칙과의 충돌**: 지금 전역 의심이면 작동 확인을 다시 돌리는데(`agent-connection.ts:298-305`), 사용량 한도일 때 작동 확인도 실패할지는 CLI마다 확인이 필요하다. 작동 확인이 통과하면 지금 규칙상 한 번 더 실행한 뒤 실패로 둔다(`draft-queue.ts:812-821`). 사용량 한도는 시간이 지나면 풀리므로 "에이전트 변경 알림이 올 때까지 멈춤"(`draft-queue.ts:532-538`)만으로는 다시 돌지 않을 수 있어, Flow 연결 실패처럼 시간 기반 재개(`draft-queue.ts:540-551`)가 필요할 수 있다.
- **위험**: 묶음 하나의 문제를 전역으로 잘못 분류하면 대기열 전체가 멈춘다. 문구 분류는 실제 CLI 출력으로 확인한 문장만 넣어야 한다(Codex 미로그인 문장도 실측으로 넣었다, `codex-executor.ts:281-284`). 일괄 다시 시도는 쌓인 수만큼 실행이 한꺼번에 생기므로 건수를 보여 주고 확인받아야 한다. 이미 답한 항목은 실행 직전 판정이 거른다.
- **가장 싼 검증**: `draft-queue.test.ts`에 `agent-error`(사용량 한도 문구) 실행 뒤 묶음이 생성 중으로 남고 대기열이 멈추며, 에이전트 변경 알림 뒤 그 묶음부터 다시 도는지 보는 테스트 하나. 기존 `:1325`, `:1985` 테스트와 같은 구조로 만들 수 있다. 문구는 실제 Codex·Claude Code 출력 한 건을 받아 고정해야 한다.

### 권장안

사용자 상황의 원인은 "감지 누락"보다 "에이전트 실패가 묶음 실패로 쌓여 하나씩 다시 시도해야 하는 것"일 가능성이 크다. 그래서 **(c)를 먼저** 한다. 기존 전역 실패 경로를 넓히는 일이라 변경 범위가 작고, 같은 일이 다시 생겨도 사용자가 할 일이 없어진다. 그다음 72시간 밖 누락과 무시한 항목처럼 자동 경로로는 되살릴 수 없는 항목을 위해 **(a)**를 더한다. 이미 있는 시험 고르기 목록과 판정 코드를 재사용할 수 있고, 비용이 요청 단위로 묶인다. **(b)**는 스펙의 72시간·기능 시작 전 제외 결정을 뒤집고 비용 상한 설계가 필요하므로, (a)로 부족하다는 사용 근거가 생길 때 다시 검토한다.

## 5. 지금 상황에서 코드 변경 없이 할 수 있는 일

### 할 수 있는 것

1. 작은 창에서 **생성 중**과 **실패** 묶음이 있는지 본다. 실패 묶음의 오류 원문으로 2-4의 어느 갈래였는지 알 수 있다.
2. 설정 "에이전트" 칸에서 Claude Code가 연결되어 있는지 확인하고 기본 에이전트를 Claude Code로 둔다. Codex가 연결되지 않은 상태면 자동으로 Claude Code가 기본이 된다(`agent-preferences.ts:135-138`). 그러면 생성 중 묶음은 자동으로 다시 돈다.
3. 실패 묶음은 하나씩 [다시 시도]한다. 사용자 우선순위로 대기열 앞에 들어가고, 실행 직전에 이미 답함을 다시 판정한다.
4. 무시한 지 7일이 안 된 묶음은 처리됨에서 [되돌리기]하면 초안이 없을 때 다시 생성된다(`mention-bundles.ts:1037-1038`).
5. 72시간 밖으로 밀려 묶음이 없는 멘션은 "최근 멘션으로 시험"으로 하나씩 초안을 볼 수는 있다. 게시는 막혀 있으므로 화면의 초안을 Flow에 직접 옮겨야 한다. 복사 가능 여부는 확인하지 않았다. 최근 10건까지만 보인다.

상태를 직접 확인하고 싶으면 앱을 끈 뒤 데이터 폴더(`app.getPath('userData')`, `apps/desktop/src/main/app-identity.ts:43-45`, 설정 "일반"의 데이터 폴더 열기)의 `state.db`를 **읽기 전용으로** 열어 `SELECT id, status, created_at FROM mention_bundle WHERE status IN ('generating', 'failed');`로 볼 수 있다. 진단 로그(`app.getPath('logs')`, `app-identity.ts:48-50`)의 `draft.queue-paused`, `draft.global-failure`, `draft.run-finished`로도 갈래를 가를 수 있다.

### 권하지 않는 DB 조작

- **기준점(`detection.baseline_alarm_id`)을 낮추기**: 효과가 없다. 72시간 밖 알림은 기준점과 상관없이 모으지 않고(`mention-alarms.ts:27`), 72시간 안의 이미 기록한 위치는 버린다(`mention-detection.ts:284-288`). 기록되지 않은 72시간 안 멘션은 지금도 정상 경로에 있다.
- **`mention_bundle.status`를 `failed`에서 `generating`으로 바꾸기**: [다시 시도]는 실패 사유와 새 멘션 수도 함께 지운다(`mention-bundles.ts:1308`). 상태만 바꾸면 화면과 저장 내용이 어긋날 수 있다. 앱의 [다시 시도]와 결과가 같으므로 할 이유가 없다.
- **`assignment_detection` 지우기**: `enabledAt`이 지금 시각으로 다시 잡혀 기존 담당 업무가 모두 "기능 시작 전"으로 제외된다(`assignment-detection.ts:72-78`, `:126-130`). 누락분을 되살리지 못하고 오히려 판정 기준을 잃는다.
- `minimal_record_mention`을 지워 무시한 위치를 다시 감지시키는 것도 72시간 규칙 때문에 지난 멘션에는 소용없다.

정리하면, **에이전트 원인으로 생긴 누락분은 UI만으로 회복할 수 있고, 72시간 밖이나 7일 지난 무시 항목은 코드 변경 없이는 실제 묶음으로 되살릴 수 없다.**

## 확인하지 못한 것

- Codex CLI가 구독 종료·사용량 한도일 때 내는 실제 문장. 이것에 따라 2-4의 두 갈래가 갈린다. 공식 문서와 실측 모두 확인하지 않았다.
- 사용자 PC의 실제 상태: 실패·생성 중 묶음 수, 앱이 꺼져 있던 기간, 로그. `state.db`와 로그를 열지 않았다.
- 사용량 한도일 때 작동 확인(점검 실행)이 실패하는지 여부. (c)의 재개 조건 설계에 필요하다.
- 시험 묶음 초안을 화면에서 복사할 수 있는지.
- 채팅 멘션은 범위 밖이라 조사하지 않았다(`.scratch/flow-mention-drafter/spec.md:817`).
