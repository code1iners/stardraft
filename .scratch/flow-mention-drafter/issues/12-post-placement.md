# 초안 게시 위치와 형식 결정

Map: [Flow 멘션 답변 초안 앱](../map.md)
Type: grilling
Mode: HITL
Status: open
Blocked by: 04

## Question

승인한 초안을 Flow의 **어디에, 어떤 형식으로 게시할지** 정한다. 근거가 되는 응답 형태는 [Flow 알림 API 실호출로 멘션 데이터 확인](01-flow-alarm-api-check.md)의 답에 있다.

- **게시 위치**: 멘션 위치(본문·댓글·대댓글)마다 초안을 게시글의 새 댓글로 달지, 대댓글로 달지 정한다.
  - Flow의 댓글은 댓글과 대댓글의 2단 구조다. 대댓글 멘션은 알림에 부모 댓글의 `remarkId`와 대댓글의 `replyId`가 함께 온다.
  - 쓰기 API는 `POST /user/comments/{postId}`(댓글)와 `POST /user/comments/{postId}/replies/{commentId}`(대댓글)다.
- **송신자 다시 멘션하기**: 게시 본문 앞에 송신자를 `@[이름](ID)` 표기로 멘션할지 정한다.
  - 조회 응답에서는 이 표기를 확인했다. 쓰기 API가 이 표기를 받아 실제 멘션 알림으로 처리하는지는 문서에 없다. 확인이 필요하면 별도 task 티켓으로 뺀다.
- **근거 표기**: 근거(파일과 코드 위치)를 게시 본문에 넣을지, 검토 화면에만 둘지 정한다. [초안 검토 화면 프로토타입](04-draft-review-prototype.md)의 결정을 따른다.
