# Flow 알림 API 실호출로 멘션 데이터 확인

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: task
Mode: HITL (에이전트가 점검 스크립트를 만들고 결과를 정리한다. 스크립트 실행은 개인 API 키가 필요하므로 사용자가 한다)
Status: resolved
Blocked by:

## Question

내 개인 API 키로 Flow API를 실제로 호출해서, 문서만으로는 알 수 없던 다음 사실을 확인한다.

1. (구현 후로 넘김) 알림 목록(`/user/alarms?filters=MENTION`)에 **채팅 멘션이 들어오는가?**
   - 2026-10-14에 사용자가 채팅 멘션을 MVP에서 빼고 이 질문을 구현 후에 확인하기로 했다. 근거는 지도의 Out of scope 항목에 있다.
2. 업무 멘션의 `postId`와 `remarkId`로 **게시물 본문과 댓글 스레드**를 가져올 수 있는가? 본문 멘션과 댓글 멘션은 각각 어떤 필드 값으로 오는가?
3. 본문(`content`, `htmlContent`)과 댓글(`contents`)에서 **멘션이 어떤 형식으로 표기**되는가?
4. 알림 목록을 조회하기만 해도 Flow 앱의 **읽음 상태가 바뀌는가?**

## 체크리스트

- 키는 터미널 환경변수나 점검 스크립트의 숨김 입력으로만 다룬다. 파일, 채팅, 티켓에는 남기지 않는다.
- 엔드포인트 경로와 파라미터는 2026-10-14에 원문 문서로 다시 확인했다. 확인 결과는 [flow-api-facts.md](../research/flow-api-facts.md)에 반영했다. 게시글 상세 경로는 `GET /user/posts/{postId}`다.
- 읽음 처리 API(`PATCH /user/alarms/read`, `/read/all`)는 **호출하지 않는다.** [점검 스크립트](../research/flow-alarm-probe.py)는 GET만 호출한다.

1. 스크립트를 실행할 때까지 Flow 앱(웹·데스크톱·모바일)에서 알림 목록이나 멘션받은 게시물을 **열지 않는다.** 열면 읽음 상태가 바뀌어서 질문 4를 판단할 수 없다.
2. 저장소 루트에서 점검 스크립트를 실행한다. 키는 화면에 보이지 않는 입력으로 받는다. 동료에게 새 멘션을 부탁할 필요는 없고, 이미 받아 둔 멘션 알림으로 점검한다.

   ```bash
   python3 -I .scratch/flow-mention-drafter/research/flow-alarm-probe.py
   ```

   스크립트는 아래 순서로 GET을 호출한다. 보통 4~8회이고, 알림이 많아 페이지를 넘기면 최대 19회다.
   1. 알림 목록 1차 조회: 멘션 필터 미읽음, 필터 없는 미읽음, `readYn` 생략
   2. 멘션 필터 미읽음 목록 재조회
   3. 게시글 상세와 댓글 목록(`replyYn=Y`) 조회: 최신 본문 멘션 하나와 최신 댓글 멘션 하나의 게시글
   4. 멘션 필터 미읽음 목록 재조회

   결과는 [flow-alarm-probe-result.json](../research/flow-alarm-probe-result.json)에 쓴다.
   - 이름, 이메일, 본문 글자는 가린다(한글은 `가`, 영문은 `a`, 숫자는 `0`).
   - HTML 태그, `@`, ID, 유형 코드, 일시는 원본 그대로 남긴다.
   - 본문 맨 앞에 `PROBE-POST` 같은 표지를 넣은 멘션이 있으면, 그 멘션만 골라 점검한다. 표지 목록은 스크립트의 `EXPECTED_MARKERS`에 있다.
3. 안 읽은 멘션이 없다는 안내가 나오면, 질문 4는 새 멘션을 받은 뒤 Flow 앱에서 열지 말고 다시 실행해서 확인한다.
4. 결과 파일을 열어 가려지지 않은 이름이나 본문이 없는지 훑어본다.
5. 에이전트에게 실행이 끝났다고 알린다. 에이전트가 결과 파일을 읽고 아래 `## Answer`를 작성한다.

## 완료 조건

질문 2~4에 각각 "예/아니오, 그리고 근거가 되는 가린 응답 예시"가 기록되어 있다.

## Answer

2026-10-14에 사용자가 [점검 스크립트](../research/flow-alarm-probe.py)를 두 번 실행했다. 표지 없이, 이미 받아 둔 멘션 알림 20건과 미읽음 알림 1건으로 점검했다.

- 가린 응답 전체는 [flow-alarm-probe-result.json](../research/flow-alarm-probe-result.json)에 있다. 두 번째 실행 결과다.
- 이 파일에서는 본문 속 URL 중 Flow 도메인이 아닌 호스트를 나중에 따로 가렸다. 사내 서버 주소가 남아 있었기 때문이다.
- 아래 예시의 ID는 원본이다. `이름N`과 `userN@masked`는 같은 사람에게 같은 별칭을 붙인 것이다. `user1@masked`는 나(`receiverId`)다.

### 질문 2. `postId`·`remarkId`로 게시물 본문과 댓글 스레드를 가져올 수 있는가? — 예

단, 대댓글이 10개를 넘으면 대댓글 API로 페이지를 더 넘겨야 한다.

- **알림의 ID 필드로 멘션 위치를 구분한다.** 멘션 알림 20건의 분포는 대댓글 11건, 댓글 7건, 본문 2건이다.
  - 본문 멘션: `remarkId`와 `replyId`가 모두 `"-1"`이다.
  - 댓글 멘션: `remarkId`가 그 댓글의 `commentId`이고, `replyId`는 `"-1"`이다.
  - 대댓글 멘션: `remarkId`가 부모 댓글의 `commentId`이고, `replyId`가 대댓글의 `replyId`다.

  ```json
  {"alarmId": "9999999020", "alarmType": null, "mentionYn": "Y", "readYn": "Y",
   "projectId": "9999059", "postId": "99999054", "remarkId": "999999033", "replyId": "9999081",
   "message": null, "content": "가가가 가가가가 가가가가가가가. 가가가가가가가."}
  ```

- **게시글 본문**: `GET /user/posts/99999054`이 200으로 왔다. 함께 조회한 게시글 3건이 모두 `contentJsonYn: "Y"`였다.
  - `content`: 컴포넌트 배열을 담은 JSON 문자열이다.
  - `outContent`: 표기가 없는 평문 본문이다.
  - 응답에는 `title`, `remarks`, `tasks`, `subTasks`, `commentContent`도 있다.
  - `htmlContent`는 퍼센트 인코딩된 문자열로 보인다. 가린 상태라 내용은 확인하지 못했다.

  ```json
  "content": {"$jsonString": {"COMPS": [
    {"COMP_TYPE": "TEXT", "COMP_DETAIL": {"CONTENTS": " \n가가 가가가가 AA가가가 …", "MENTIONS": [], "HASHTAGS": [], "PRODUCT_MENTIONS": []}},
    {"COMP_TYPE": "IMAGE", "COMP_DETAIL": {"FILE_NM": "aaaaa (0).aaa", "ATCH_URL": "https://flow.team/<가림:87자>", …}}]}}
  ```

- **댓글 스레드**: `GET /user/comments/99999054?replyYn=Y`가 200으로 왔다. 댓글 7개가 왔고 `hasNext`는 `false`였다.
  - 알림의 `remarkId` `999999033`와 같은 `commentId`를 가진 댓글이 있었다.
  - 그 댓글에는 대댓글이 10개 왔고 `replyHasNext`가 `true`였다.
  - 알림의 `replyId` `9999081`과 `9999080`은 처음 10개 안에 없었다. 대댓글은 `replyId` 오름차순으로 오고, 마지막이 `9999079`이었다.
  - 따라서 대댓글 멘션의 원문을 보려면 `GET /user/comments/{postId}/replies/{commentId}`로 페이지를 넘겨야 한다.
- **아직 못 본 것**: 개인을 지목한 본문 멘션 사례는 관찰하지 못했다. 본문 멘션 알림 2건 중 조회한 1건은 `@전체`였다(질문 3 참고).

### 질문 3. 멘션은 어떤 형식으로 표기되는가? — 본문과 댓글 모두 `@[표시 이름](사용자 ID)`

- **사용자 ID**: `registerId`·`receiverId`와 같은 이메일 형식이다. 그래서 내 ID(`receiverId`)가 들어 있는지로 나를 지목한 멘션인지 판정할 수 있다.
- **댓글·대댓글**: `contents`가 평문이고, 그 안에 표기가 그대로 들어 있다. 한 글에 여러 명이 표기될 수 있다.

  ```json
  "contents": "@[⟨이름6⟩](user2@masked) 가 가가가가가가. \n@[⟨이름8⟩](user4@masked) 가가가가가가 가가 가 가가 가가가가가가~!"
  ```

- **본문**: `content` JSON의 TEXT 컴포넌트에서 `CONTENTS`에 같은 표기가 들어가고, `MENTIONS`에 ID 목록이 따로 온다. `@전체`는 `ALL`로 표기된다.

  ```json
  {"COMP_TYPE": "TEXT", "COMP_DETAIL": {"MENTIONS": ["ALL"], "CONTENTS": "@[AAA](AAA) \n가가 00가 00가(가) …"}}
  ```

  - `outContent`에는 표기 없이 이름만 남는다: `"AAA \n가가 00가 …"`
- **알림 `content`**: 대부분 표기가 빠져 있다. 20건 중 19건에 `@`가 없었다. 본문 멘션 알림의 `content`는 본문이 아니라 제목처럼 보이는 짧은 문자열이었다(`"[가가 AA 가가 가가 가가]"`). 그래서 멘션 판정과 맥락은 알림이 아니라 게시글·댓글 API에서 가져와야 한다.
- **`encrypted`**: 댓글과 대댓글은 모두 `encrypted: "Y"`였지만 `contents`는 평문으로 왔다. 이 필드는 조회에 영향이 없다.

### 질문 4. 알림 목록을 조회하기만 해도 읽음 상태가 바뀌는가? — 아니오

게시글·댓글을 조회해도 바뀌지 않는다.

- **근거**: 멘션이 아닌 미읽음 알림 1건(`alarmId` `9999999018`, `mentionYn: "N"`, `postId` `99999057`)으로 확인했다.
  - 첫 실행에서 알림 목록을 5회 조회한 뒤에도 이 알림은 미읽음이었다.
  - 두 번째 실행에서 미읽음 목록을 세 번 조회하는 동안에도 계속 미읽음이었다.
  - 두 번째 실행의 2차와 3차 미읽음 조회 사이에, 이 알림이 달린 게시글 `99999057`의 상세와 댓글을 조회했다.

  ```json
  "unreadCheck": {"unreadCounts": [1, 1, 1], "goneAfterAlarmGets": [], "goneAfterPostAndCommentGets": [], "fetchedPostsWithUnreadAlarm": ["99999057"]}
  ```

- **한계**
  - 멘션 알림이 아니라 일반 알림으로 확인했다. 받아 둔 멘션이 모두 읽음 상태였기 때문이다. 멘션 알림만 다르게 동작할 근거는 문서에도 응답에도 없다.
  - Flow 앱 화면으로 다시 확인하지는 않았다.

### 함께 알게 된 사실

- **`alarmType`**: 실제 응답에서는 21건 모두 `null`이었다. 문서 예시에는 `"MENTION"`이 들어 있었다. 멘션인지는 `mentionYn`으로만 구분할 수 있다.
- **`@전체`도 `mentionYn: "Y"`로 온다.** 글로서리에서 그룹 지목은 멘션이 아니다. 그래서 앱이 본문의 `MENTIONS`나 `@[이름](ID)` 표기에 내 ID가 있는지 보고 걸러야 한다.
- **`message`**: 대부분 `null`이고, 일부는 `"⟨이름2⟩님의 댓글 등록"` 같은 시스템 문구였다.
- **`workerYn`**: 멘션 알림 20건 중 17건이 `"Y"`였다. 내가 담당자인 업무에 달린 멘션으로 보인다. 멘션 판정에는 쓰지 않는다.
- **`readYn`**: 생략하면 읽은 알림도 함께 온다.
- **`lastCursor`**: 빈 목록이면 `-1`, 다음 페이지가 없으면 `0`이었다. `size=20`에서 다음 페이지가 있으면 `20`이었다.
- **호출 한도**: 두 번째 실행에서 GET 11회를 호출했고, 모두 200 응답이 1초 안에 왔다. 한도 문제는 없었다.
