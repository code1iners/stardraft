# 담당 변경의 동명이인 구분 조사

조사일: 2026-10-30. 범위: 담당 업무 초안의 신규 배정 판별. 제품 코드 변경과 외부 업무 변경은 하지 않았다. 웹 검색 후 Flow 공식 문서와 공개 클라이언트 원문을 인증 없는 GET으로 확인했다. 웹 열기 도구가 문서에 접근하지 못하여 `curl`과 Python 표준 HTTP 클라이언트로 원문을 읽었다.

## 결론

**동명이인은 현재 담당자의 사용자 ID를 변경 전후로 비교하면 피할 수 있다.** 다만 이전 조회 결과가 있어야 한다. 이 방법은 두 조회 사이에 내 담당 여부가 바뀌었다는 사실을 확인한다. 정확한 배정 시각이나 그 사이의 모든 해제·재배정 이력까지 복원하지는 않는다. 처음 발견했을 때 이미 담당자인 업무의 과거 배정은 별도 근거가 필요하다. 이는 현재 확인된 응답으로부터 도출한 구현 제안이며 검증 완료한 수집 기능이 아니다. [현재 담당자 실제 응답](assignment-evidence-2026-10-29.json), [초기 조회 경계](../issues/01-flow-assignment-evidence.md)

**이미 저장된 이름 기반 변경 기록을 항상 계정 ID로 되돌리는 방법은 확인하지 못했다.** 현재 이름과 ID가 함께 오는 자료는 있지만, 현재 동명이인이 없다는 사실이 과거에도 없었다는 뜻은 아니다. 공개 문서에서 변경 대상의 이전/이후 ID 목록을 제공하는 별도 이력 조회 또는 담당 변경 외부 전송 기능도 찾지 못했다. 이는 확인한 공개 문서 범위의 결과이고 Flow 내부에 그런 정보가 없다는 단정이 아니다. [공식 게시글 API](https://api.flow.team/docs/api/user/posts), [공식 댓글 API](https://api.flow.team/docs/api/user/comments), [공식 알림 API](https://api.flow.team/docs/api/user/alarms)

## 확인한 사실

| 자료 | 확인 결과 | 판정에 사용할 수 있는 범위 |
| --- | --- | --- |
| 실제 담당 변경 댓글 | `S41^^'기존 이름들'^^'변경 후 이름들'`, 최초 추가는 `S41^^'이름'@$%` 형태를 관측했다. 이름은 조사 파일에서 별칭으로 바꿨다. | 변경 기록 후보와 기록 시각. 이름 자체를 사용자 ID로 취급할 수 없다. |
| 실제 업무 상세 | `WORKER_REC[].WORKER_ID` 및 담당자 컬럼의 `COLUMN_DATA_REC[].CUSTOM_COLUMN_DATA`에 사용자 ID가 있다. 담당자 컬럼에는 `USER_NM`도 있다. | 현재 담당 여부의 ID 비교 및 현재 이름-ID 대응. |
| 실제 알림 | 담당 변경 기록과 일반 댓글 모두 `workerYn=Y`인 사례가 있다. | 발견 신호. 그 값만으로 신규 배정 확정 불가. |

출처: [사례 A](assignment-evidence-2026-10-29.json), [사례 C](assignment-case-c-2026-10-29.json), [기존 조사 설명](../issues/01-flow-assignment-evidence.md). 이 자료는 원문 전체가 아닌 투영본이다. 생략된 필드가 원 응답에도 없었다고 해석하면 안 된다.

### 공식 문서에 공개된 필드와 조회 경로

- 댓글 응답 문서는 `registerId`를 댓글 작성자 ID, `editorId`를 댓글 수정자 ID, `systemCode`를 시스템 댓글 코드로 설명한다. `objectContentsName`은 댓글 작성 경로이며 예시는 `web`이다. 문서의 댓글 필드 목록에 담당 변경 대상의 이전/이후 사용자 ID 전용 필드는 없다. `contents`는 문자열이므로 실제 시스템 댓글 본문에 추가 구조가 있는지는 별도 확인이 필요하다. [댓글 문서](https://api.flow.team/docs/api/user/comments#getUserComments-metadata), [해당 공식 문서 클라이언트](https://api.flow.team/_app/immutable/nodes/22.49c7389d.js)
- 알림 문서에 나열된 경로는 내 알림 목록 조회, 단일 읽음 처리, 전체 읽음 처리다. 별도 알림 상세 또는 배정 변경 이력 GET은 이 목록에 없다. [알림 문서](https://api.flow.team/docs/api/user/alarms)
- 게시글 문서에는 업무 상세·목록 조회와 담당자 수정 경로가 있지만 담당자 변경 이력 전용 조회는 나열되지 않았다. 수정 경로가 사용자 ID를 받더라도 타인이 이미 수행한 변경 요청의 값을 수집할 수 있다는 뜻은 아니다. [게시글 문서](https://api.flow.team/docs/api/user/posts)
- 구성원 목록, 본인 정보, 사용자 ID별 구성원 조회와 프로젝트 참여자 조회가 있다. 구성원 목록 문서는 한 번에 최대 100명과 `hasNext`/`lastCursor` 순회를 설명한다. 이 경로는 동명이인 탐색의 보조 수단이다. 과거 탈퇴자·과거 이름까지 복원한다는 계약은 확인하지 못했다. [구성원 문서](https://api.flow.team/docs/api/user/employees), [구성원 문서 클라이언트](https://api.flow.team/_app/immutable/nodes/25.25edf394.js), [프로젝트 문서](https://api.flow.team/docs/api/user/projects)
- 공식 웹훅은 외부 서비스가 Flow에 게시글·채팅 등을 작성하도록 보내는 방향이다. 안내된 주소는 `https://api.flow.team/webhook/{hookId}/{service}`다. 이 문서는 Flow 담당 변경을 Stardraft로 보내는 이벤트 구독을 설명하지 않는다. [웹훅 공식 문서](https://api.flow.team/docs/webhook)

### 공개 클라이언트의 숨은 ID 가능성

공개 `detail.min.js`의 댓글 렌더링은 `REMARK_CNTN`과 `SYS_CODE`를 `TagConvert.db2HtmlStringByRemark`에 전달한다. `common.min.js`에는 댓글 본문의 `@[표시 이름](사용자 ID)` 형태를 `user-id` 속성으로 바꾸는 일반 멘션 처리와, 별도 이력 참조를 `data-hstr-srno`로 바꾸는 처리가 있다. 따라서 **시스템 댓글 본문이 이름 이외의 구조를 포함하는지 원문을 확인할 가치는 있다.** 그러나 이 코드 자체는 담당 변경 댓글이 그 구조를 사용한다는 증거가 아니다. 이번 공개 코드 조사에서는 S41 문자열에서 변경 대상 사용자 ID를 별도로 복원하는 로직을 발견하지 못했다. [공식 공통 클라이언트](https://flow.team/flow-renewal/dist/js/common.min.js), [공식 상세 클라이언트](https://flow.team/flow-renewal/dist/js/detail.min.js)

이 단계에서 필요한 확인은 기존 알려진 업무의 시스템 댓글 원문에서 (1) 키 목록, (2) 본문의 사용자 ID 마크업 존재 여부, (3) 실제 ID와의 대응만 출력하는 제한된 읽기 조회다. 이름·본문·인증키 원문을 조사 문서에 저장할 필요는 없다. 이후 기존 개발용 암호화 키를 재사용하여 알려진 사례 C만 추가 조회했다. 결과는 다음 절에 기록한다.

## 실제 원문 구조 추가 확인

2026-10-30 02:40:03 UTC에 기존 `Stardraft Dev`의 `flow-api-key.bin`을 Electron `safeStorage.decryptStringAsync`로 메모리에서만 복호화했다. 본인 정보·알려진 사례 C 업무 상세·댓글을 GET으로 각 1회, 총 3회 조회했다. 모두 HTTP 200이었다. 댓글은 3건, `hasNext=false`였다. 키·본문·이름·실제 식별자는 출력하거나 저장하지 않았다. 아래는 값이 아닌 구조/비교 결과만 보관한 실제 관측이다.

- S41 댓글 1건의 `contents`는 비어 있지 않은 문자열이다.
- 이 본문에 본인 `userId`는 없었다. `@[이름](ID)` 멘션 마크업은 0건이며 `user-id`/`data-user-id` 속성도 없었다.
- `data-hstr-srno`/`commt-hstr` 표시는 없었다. 이는 이 두 문자열 검사 결과이며 가능한 모든 내부 이력 문법의 부재를 입증하지 않는다.
- `systemCode`에는 본인의 현재 표시 이름이 있었고 본인 `userId`는 없었다. `^^` 기준 토큰 수는 2였다.
- 현재 `WORKER_REC`에는 본인 `userId`가 있었다.
- 해당 댓글의 전체 키 목록은 다음과 같다. 변경 대상 사용자 ID 전용 필드는 관측하지 못했다.

```text
attachments, commentId, contents, editedDateTime, editorId, editorName,
encrypted, language, objectContentsName, postId, projectId, registerCorpName,
registerDivisionName, registerId, registerInttId, registerName,
registerProfilePhoto, registeredDateTime, repeatDateTime, repeatId,
replies, replyHasNext, systemCode
```

출처: 동일 계정의 공식 `GET /user/employees/me`, `GET /user/posts/{postId}`, `GET /user/comments/{postId}?replyYn=Y&size=100` 실제 응답. 재현용 범위는 [기존 사례 C](assignment-case-c-2026-10-29.json)이며 새 마스킹 구조 결과는 이 절에 모두 기록했다. 따라서 **사례 C에는 본문에 숨은 본인 ID를 이용하는 우회가 통하지 않았다.** 다른 형태의 담당 변경 기록까지 부재를 일반화하지 않는다.

## 선택지 비교와 권장 경계

| 방법 | 동명이인 해결 | 남는 한계 | 판단 |
| --- | --- | --- | --- |
| 현재 이름-ID 대응만 사용 | 일반적 이름 연결 가능, 동명이인 충돌 탐지 가능 | 과거 이름 변경·탈퇴·동명이인 혼동을 제거하지 못함 | 단독 확정 근거로 부적합 |
| 전체 구성원/프로젝트 참여자 목록 조회 | 현재 보이는 동명이인 탐지 | 조회 권한·쪽 누락·과거 구성원 문제 | 보조 검증 |
| 업무별 이전/현재 담당자 ID 비교 | 이름과 무관하게 `내 ID 없음 → 있음` 확인 | 이전 상태 필요, 정확 시각 및 중간 재배정 복원 불가 | 이후 관측분의 가장 명확한 대안 |
| 시스템 댓글 본문 ID 구조 확인 | 실제 존재하고 의미가 확인되면 과거 사건에도 사용 가능 | 실제 사례 C에서는 본인 ID와 멘션 마크업 없음. 다른 형태는 미확인 | 확인한 사례에서는 우회 불가 |
| 공식 배정 이벤트/이력 계약 확인 | 이전/이후 ID와 서버 시각이 제공되면 해결 | 공개 문서에서 미발견 | 원문 검사 후에도 없으면 Flow에 확인 |

위 평가는 확인된 자료에 대한 추론이다. 특히 ID 전후 비교를 구현하려면 업무별로 성공한 상세 응답과 조회 시각을 저장해야 한다. 현재 `initialPostIds`는 과거 WORKER 알림의 게시글 ID 목록이며 이전 담당자 ID 스냅샷이 아니다. 이 값을 과거 미담당 상태로 바꾸어 해석할 수 없다. [현재 초기 판별 구현](../../../apps/desktop/src/core/detection/assignment-detection.ts), [기존 조사 경계](../issues/01-flow-assignment-evidence.md)

‘이미 답함’ 판정은 별도다. 이전 미담당 조회보다 뒤, 현재 담당 조회보다 앞에 쓴 댓글은 실제 배정 전후가 불명확하다. 클라이언트 관측 시각과 서버 댓글 시각의 시계차를 확인해야 한다. 공통 시간축에서 현재 담당 조회보다 뒤인 본인 댓글은 관측된 배정 전환 이후의 답변이라는 근거가 되지만, 그 뒤의 담당 해제·재배정까지 누락 없이 포착했다고 주장하면 안 된다. 정확한 배정 시각을 알림 시각 또는 관측 시각으로 치환하는 정책 변경은 이번 조사에서 하지 않았다. [03번 티켓](../issues/03-later-assignment-and-answered.md), [01번 조사](../issues/01-flow-assignment-evidence.md)

## 재현 정보와 검증 범위

공개 원문을 2026-10-30에 조회했다. JavaScript 원문의 SHA-256은 다음과 같다. 장기 API 계약이 아니라 조회 당시 문서/클라이언트 구현 증거다.

- `common.min.js`: `2e5e83330eb8abc80306baba87870de5abacbf639411d055db8be4d893806cb5`
- `detail.min.js`: `3ff42fdc144467ca066a2a5400097ca51481f0cce512a5c01821070d3c2bcec1`
- 댓글 문서 `22.49c7389d.js`: `cc72f6690d8aba89eeaf86086a9a1d248313880256588216a48f82ec1aec1b48`

제품 코드·테스트·설정·Flow 업무를 변경하지 않았다. 문서 조사이므로 타입 검사와 제품 자동 테스트를 새로 실행하지 않았다. 실제 동명이인 배정/해제 시나리오는 검증하지 않았다. 알려진 사례 C의 원문 구조만 추가 인증 조회로 확인했다.
