# Flow 담당자 지정 감지와 후속 프로세스 연결 검토

- 조사일: 2026-10-29
- 범위: 공식 공개 문서, 현재 Stardraft 코드, 저장소에 보관된 기존 실호출 결과를 검토했다. 구현 변경과 인증된 API 실호출, 실제 업무 생성·담당자 변경·댓글 게시는 하지 않았다.
- 공식 문서 기준: 개발자 포털 2.2.0. 페이지와 공개 JavaScript 문서 번들을 직접 조회했다. 기존 [API 사실 정리](flow-api-facts.md)는 2.1.0 시점 자료이므로 아래 최신 조회와 구분한다.

## 결론

**연결할 수 있는 기반은 있다. 다만 현재 구현은 담당자 지정을 처리하지 않으며, “새로 나에게 지정된 순간”을 정확히 구분하는 방법은 실측이 필요하다.** 공식 알림 API (Application Programming Interface: 프로그램 간 연동 인터페이스)에 `WORKER` 필터가 있고, 담당 업무 알림에서 게시글 식별자를 얻을 수 있다. 이를 별도 감지 유형으로 만들면 기존 큐·저장소 연결·코드 확인·초안 작성·검토·사용자 승인 후 댓글 게시 과정을 재사용할 수 있다. 단순히 멘션 필터를 늘리는 것만으로는 후속 과정이 이어지지 않는다. 근거는 아래 공식 명세와 현재 코드 분석이다. [공식 알림 API](https://api.flow.team/docs/api/user/alarms), [현재 감지 구현](../../../apps/desktop/src/core/detection/mention-detection.ts)

특히 **`workerYn=Y`는 “지금 담당자로 지정됨”이라는 이벤트 코드가 아니다.** 공식 설명은 내 담당 업무에 관한 알림 분류이고, 기존 실호출에서도 멘션 알림 20건 중 17건이 동시에 `workerYn=Y`였다. 따라서 담당 업무의 일반 댓글·수정 알림까지 모두 새 업무 요청으로 처리하면 중복 초안이 생길 수 있다. [공식 알림 리스트 도움말](https://support.flow.team/ko/flow/알림리스트), [기존 실호출 기록](../issues/01-flow-alarm-api-check.md)

## 공식 자료에서 확인한 사실

| 항목 | 확인 내용 | 출처 |
| --- | --- | --- |
| 알림 조회 | `GET /user/alarms`. 개인 키 소유자의 알림을 조회한다. `filters`는 `MENTION`, `REGISTRANT`, `WORKER`만 문서화되어 있다. `TASK`는 허용값이 아니다. 쉼표로 복수 선택할 수 있다. | [알림 API](https://api.flow.team/docs/api/user/alarms) |
| 담당 업무 알림 | `workerYn`은 내 담당 업무 알림 여부. `projectId`, `postId`, `remarkId`, `replyId`, `alarmId`, 등록자와 등록 시각 등이 함께 온다. | [알림 API](https://api.flow.team/docs/api/user/alarms) |
| 이벤트 구분 한계 | `alarmType`은 선택 문자열이며 완전한 이벤트 종류 목록이 없다. 공식 예시에는 `WORKER`와 담당 업무 변경 문구가 있지만, 지정·해제·재지정만 식별하는 계약은 없다. | [공식 알림 문서 번들](https://api.flow.team/_app/immutable/nodes/19.d44ad53c.js) |
| 생성 시 지정 | 공식 도움말은 담당자를 1명 또는 여러 명 지정해 업무를 등록하면 담당자와 프로젝트 참여자에게 알림을 보낸다고 설명한다. | [업무 게시물 도움말](https://support.flow.team/ko/flow/task) |
| 생성 후 지정 | `PATCH /user/posts/projects/{projectId}/tasks/{taskId}/worker`로 기존 업무 담당자를 수정할 수 있다. 개인용 API는 작성자 ID를 별도로 받지 않고 인증 사용자를 사용하며, 본문은 `workers: [{workerId: ...}]` 형식이다. 이 호출의 특정 알림 생성 보장과 지연 시간은 명세에 없다. | [게시글 API](https://api.flow.team/docs/api/user/posts), [개인용 명세 번들](https://api.flow.team/_app/immutable/nodes/26.027ae61c.js), [공유 요청 스키마 번들](https://api.flow.team/_app/immutable/chunks/createTodo.f8966716.js) |
| 업무 생성 | `POST /user/posts/projects/{projectId}/tasks`도 `workers`를 받으며 응답의 `taskId`와 `postId`는 별도 식별자다. 둘이 항상 같다고 가정하면 안 된다. | [게시글 API](https://api.flow.team/docs/api/user/posts) |
| 현재 업무 조회 | `GET /user/posts/{postId}`는 `tasks` 원본 배열을 반환한다. 다만 `tasks` 내부 담당자 필드의 세부 스키마는 공개 명세에 없다. | [개인용 명세 번들](https://api.flow.team/_app/immutable/nodes/26.027ae61c.js) |
| 업무 목록 대안 | `GET /user/posts/projects/{projectId}/tasks/filter`는 업무·컬럼과 필터 조건을 제공한다. `updatedSince`는 페이지별 수정 시각 필터일 뿐 완전한 변경 이력이나 스냅샷이 아니다. 조회 중 중복·누락 가능, 삭제 감지 미지원이라고 명시한다. 현재 담당자 목록의 보조 점검 후보이지 정확한 할당 이벤트 로그로 볼 수 없다. | [개인용 명세 번들](https://api.flow.team/_app/immutable/nodes/26.027ae61c.js) |
| 이벤트 전달 | 공개 웹훅 문서는 외부 서비스가 Flow에 글·업무·일정·채팅을 만드는 방향이다. 검토한 문서에서 Flow 담당자 변경을 외부에 전달하는 구독 계약은 확인하지 못했다. 따라서 현재의 주기적 조회 방식을 확장하는 것이 근거 있는 출발점이다. | [공식 웹훅 문서](https://api.flow.team/docs/webhook) |

생성과 동시에 지정하는 경우에는 공식 도움말에 알림 발생 설명이 있다. **이미 생성된 업무에 나를 추가하는 경우는 담당자 변경 기능과 담당 업무 알림 기반까지 확인했지만, 해당 동작이 어떤 실제 알림으로 나타나는지는 이번 조사에서 재현하지 않았다.** 담당자가 여러 명인 경우, 자기 자신을 지정하는 경우, 하위업무, 프로젝트 알림 설정에 따른 차이도 동일하게 실측 대상으로 남는다. [업무 게시물 도움말](https://support.flow.team/ko/flow/task), [알림 API](https://api.flow.team/docs/api/user/alarms)

## 기존 실호출 증거와 한계

- 2026-10-14 기존 조사에서 `alarmType`은 21건 모두 `null`이었다. 시스템 문구인 `message`도 대부분 `null`이었다. `alarmType === 'WORKER'`나 한국어 문구만으로 판별하는 방식은 당시 응답과 맞지 않는다. 현재 서버에서도 동일하다는 보장은 없다. [기존 실호출 기록](../issues/01-flow-alarm-api-check.md)
- 멘션 20건 중 17건이 `workerYn=Y`였다. 이는 멘션 여부와 담당 업무 여부가 겹칠 수 있다는 관측이며, 신규 지정 알림을 실제로 재현한 증거는 아니다. [기존 실호출 기록](../issues/01-flow-alarm-api-check.md)
- 마스킹된 기존 응답의 `calls[6].body.response.data.tasks[0].WORKER_REC[]`에 `WORKER_ID`, `WORKER_NM`이 들어 있었다. 현재 담당자 재확인의 유력한 구현 근거지만, 전체 업무 형식에서 보장되는 최신 공개 계약으로 취급하면 안 된다. [기존 응답 자료](flow-alarm-probe-result.json)
- 기존 조사에서는 `readYn`을 생략하면 읽은 알림도 조회되었다. 사용자가 Flow에서 먼저 읽었다고 감지 대상에서 빠지지 않도록 이 동작을 재검증하는 편이 좋다. [기존 실호출 기록](../issues/01-flow-alarm-api-check.md)

## 현재 구현에서 막히는 지점

아래 행 번호는 조사 시점 기준이다.

| 지점 | 현재 동작 | 필요한 변경 방향 |
| --- | --- | --- |
| 도메인 계약 | 글로서리 11행에서 담당자 지정을 멘션 범위에서 제외한다. | 멘션의 의미를 바꾸기보다 담당자 지정이라는 별도 감지 유형을 정의한다. [GLOSSARY.md](../../../GLOSSARY.md) |
| 알림 수집 | `http-flow-api.ts:90–102`는 `filters=MENTION` 고정이다. `294–320`의 파싱은 `workerYn`, `alarmType` 등을 보존하지 않는다. | `WORKER` 후보 수집과 필요한 알림 메타데이터 보존. [http-flow-api.ts](../../../apps/desktop/src/core/flow/http-flow-api.ts) |
| 감지 판정 | `mention-judgement.ts:95–103`은 본문의 직접 `@`를 확인한다. | 멘션 판정과 담당자 지정 판정을 분리한다. [mention-judgement.ts](../../../apps/desktop/src/core/flow/mention-judgement.ts) |
| 현재 상태 | 게시글 파싱 `http-flow-api.ts:326–355`는 담당자를 읽지 않는다. | 실제 업무 담당자 배열의 스키마를 확인한 뒤 현재 담당 상태를 읽는다. [http-flow-api.ts](../../../apps/desktop/src/core/flow/http-flow-api.ts) |
| 중복 제거 | `mention-detection.ts:183–219,277–279`는 게시글·댓글·답글 위치 기준으로 중복을 제외한다. | 같은 업무의 해제 후 재지정과 멘션·지정 동시 발생에 대한 별도 중복 정책이 필요하다. [mention-detection.ts](../../../apps/desktop/src/core/detection/mention-detection.ts) |
| 후속 맥락 확인 | `bundle-context.ts:143–146,207`은 본문에 직접 멘션이 없으면 `goneMentions`로 처리한다. | 지정 유형은 직접 멘션 존재 대신 담당 상태를 확인해야 한다. 필터와 최초 판정만 바꾸면 이 단계에서 다시 탈락한다. [bundle-context.ts](../../../apps/desktop/src/core/flow/bundle-context.ts) |
| 초안·수신자 | `draft-input.ts:167`은 멘션 답변 전제다. `post-body.ts:30–40`은 본문 작성자를 수신자로 우선한다. | 업무 요청 맥락을 초안 입력에 넣고, 작성자와 실제 지정자가 다른 경우의 답변 대상을 정한다. [draft-input.ts](../../../apps/desktop/src/core/drafts/draft-input.ts), [post-body.ts](../../../apps/desktop/src/core/drafts/post-body.ts) |

현재 감지는 최초 시작 시 과거 알림을 기준점으로 삼고, 이후 조회에는 72시간 범위가 있다. 기능을 켰을 때 이미 담당 중인 업무까지 가져올지, 켠 뒤 새 지정만 처리할지도 별도로 정해야 한다. 기존 담당 업무 전체를 즉시 처리하는 것으로 해석하면 현재 최초 실행 정책과 달라진다. [mention-detection.ts](../../../apps/desktop/src/core/detection/mention-detection.ts)

## 권장 설계와 남은 결정

다음은 구현 확정이 아니라 위 명세와 현재 코드에서 도출한 설계 제안이다.

1. `WORKER` 알림을 **후보**로 모으고, 업무의 현재 담당자에 내가 포함되어 있는지 확인한다. 조회 실패·스키마 미확인은 미할당으로 단정하지 않는다.
2. `triggerKind` 같은 별도 유형과 `taskId`, 지정 감지 시각, 현재 담당자 정보를 보존한다. 기존 멘션의 직접 `@` 계약은 유지한다.
3. 이전에는 미담당이고 현재는 담당인 상태 전환을 신규 지정의 근거로 검토한다. 단, 초기 상태를 모르면 “신규 지정”과 “원래 담당한 업무의 새 댓글”을 구분할 수 없다. 제거와 재지정이 두 조회 사이에 모두 일어나면 현재 상태 비교만으로는 놓칠 수 있다. 정확한 이벤트 구분이 필요한 경우 실제 알림·변경 이력을 먼저 확보해야 한다.
4. 큐·저장소 매핑·코드 확인·초안 검토·승인 후 게시를 재사용하되, 멘션과 지정이 함께 온 같은 요청을 한 건으로 묶을지 정한다. 재지정을 다시 처리하려면 위치만으로 영구 중복 제외하지 않아야 한다.
5. 게시 직전 담당 상태를 재확인하고, 해제되었다면 자동 게시하지 않고 검토 가능한 상태로 돌리는 정책을 검토한다. 답변 대상도 업무 작성자·실제 지정자 중 누구인지 명시한다.

이 연결의 기본 범위는 현재 제품의 **코드 확인과 답변 초안 작성 흐름**이다. 담당자가 되었다는 이유로 코드 수정·커밋·배포까지 자동 실행하는 기능은 이 조사에서 검토하거나 승인한 범위가 아니다. [현재 초안 입력](../../../apps/desktop/src/core/drafts/draft-input.ts)

## 가장 작은 검증 실험

구현에 앞서 테스트용 업무 1개와 기존 읽기 전용 조사 절차로 아래 결과를 비교하는 것이 좋다. 이번 조사에서는 실행하지 않았다. 외부에 업무·댓글을 새로 만드는 재현은 별도 실행 범위로 두고, 가능하면 사용자가 이미 받은 지정 사례를 읽어 먼저 확인한다.

| 시나리오 | 확인할 것 |
| --- | --- |
| 생성하면서 나를 담당자로 지정 | 알림 생성, `workerYn`, `alarmType`, 게시글·업무 식별자, 담당자 배열 |
| 생성 후 나를 담당자로 추가 | 생성 동시 지정과 응답 차이, 별도 알림의 식별 가능성 |
| 담당 중인 업무의 일반 댓글·상태 변경 | 신규 지정으로 잘못 판정하지 않는지 |
| 담당 해제 후 재지정 | 상태 전환과 새로운 알림을 구분할 수 있는지, 조회 사이에 해제·재지정되는 경우 |
| 담당 지정과 직접 멘션 동시 발생 | 중복 수집·중복 초안 방지 정책 |
| 이미 처리했던 본문의 업무에 재지정 | 기존 위치 기준 중복 제거로 소실되지 않는지 |
| 초안 작성 후 게시 직전 담당 해제 | 재확인과 게시 보류 동작 |
| 복수 담당자·자기 지정·하위업무·읽은 알림 | 각 형태의 실제 응답과 누락 여부 |

**진행 조건:** 생성 후 지정 알림을 실제로 관측하고, 일반 담당 업무 알림과 구분할 근거 및 현재 담당자 조회 스키마를 확보한다. **중단 조건:** 신규 지정과 일반 갱신을 구분하지 못한다면 “지정 순간 자동 감지”라고 약속하지 않는다. 대신 관측 가능한 “내 담당 업무 후보 표시”로 범위를 낮추거나 공식 지원팀에 이벤트 계약을 확인한다. 이후 구현하더라도 별도 기능 설정으로 켜고 끌 수 있게 하면 기존 멘션 전용 동작으로 복귀하기 쉽다.
