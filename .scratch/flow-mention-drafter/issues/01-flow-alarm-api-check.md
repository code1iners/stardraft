# Flow 알림 API 실호출로 멘션 데이터 확인

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: task
Mode: HITL (개인 API 키가 필요하므로 사용자가 직접 실행한다)
Status: open
Blocked by:

## Question

내 개인 API 키로 Flow API를 실제로 호출해서, 문서만으로는 알 수 없던 다음 사실을 확인한다.

1. 알림 목록(`/user/alarms?filters=MENTION`)에 **채팅 멘션이 들어오는가?** 업무 본문 멘션과 업무 댓글 멘션은 각각 어떤 필드 값으로 오는가?
2. 업무 멘션의 `postId`와 `remarkId`로 **게시물 본문과 댓글 스레드**를 가져올 수 있는가?
3. 본문(`content`, `htmlContent`)과 댓글(`contents`)에서 **멘션이 어떤 형식으로 표기**되는가?
4. 알림 목록을 조회하기만 해도 Flow 앱의 **읽음 상태가 바뀌는가?**

## 체크리스트

- 키는 터미널 환경변수로만 다룬다. 파일, 채팅, 티켓에는 남기지 않는다.
- 엔드포인트 경로와 파라미터는 실행 전에 [flow-api-facts.md](../research/flow-api-facts.md)와 원문 문서로 다시 확인한다.

1. 동료나 테스트 계정에 부탁해서 나를 아래 네 곳에서 멘션받는다.
   - 업무 게시물 본문
   - 업무 댓글
   - 그룹(또는 프로젝트) 채팅방
   - 1:1 채팅
2. 알림 목록을 조회한다. 읽음 처리 API(`PATCH /user/alarms/read`)는 **호출하지 않는다.**

   ```bash
   curl -s -H "x-flow-api-key: $FLOW_API_KEY" "https://api.flow.team/user/alarms?filters=MENTION&size=20"
   ```

3. 1번의 네 멘션이 각각 목록에 나오는지 확인한다. 나온다면 `alarmType`, `projectId`, `postId`, `remarkId`, `replyId`, `content` 값을 기록한다.
4. 업무 멘션 하나를 골라 게시물 상세와 댓글 목록을 조회한다. 댓글 목록은 `GET /user/comments/{postId}?replyYn=Y`로 조회한다. 본문과 스레드가 오는지, 멘션이 어떻게 표기되는지 확인한다.
5. Flow 앱(웹/데스크톱)에서 방금 조회한 알림이 아직 안 읽음 상태로 남아 있는지 확인한다.
6. 결과를 아래 `## Answer`에 기록한다. 동료 이름과 메시지 본문은 가리고, 응답 구조와 필드 값의 형태만 남긴다.

## 완료 조건

질문 1~4에 각각 "예/아니오, 그리고 근거가 되는 가린 응답 예시"가 기록되어 있다.
