# Flow 공개 API 사실 정리

- 조사일: 2026-10-14 (API 포털 v2.1.0 기준)
- 출처: https://api.flow.team/docs
- 조사 방법: 포털 페이지는 SPA라서 엔드포인트 상세 설명이 페이지 HTML에 없다. 공개 JS 번들에 들어 있는 문서 텍스트를 읽었다. 로그인이나 키 호출은 하지 않았다.
- 재확인: 2026-10-14에 실호출 티켓을 실행하기 전에 같은 방법으로 알림·게시글·댓글 명세를 다시 읽었다. 그때 보탠 내용에는 "(재확인)"을 붙였다.
- 실제 호출로 검증해야 하는 항목은 [Flow 알림 API 실호출로 멘션 데이터 확인](../issues/01-flow-alarm-api-check.md) 티켓에서 다룬다.

## 인증

- 모든 REST 호출은 `x-flow-api-key` 헤더로 인증한다.
- **관리자 키 (v1/v2)**
  - 이용기관 관리자가 API Key 관리 페이지에서 발급한다.
  - 기관당 3개까지 발급할 수 있다.
  - IP 제한과 API(operationId) 제한을 걸 수 있다.
  - 출처: https://api.flow.team/docs#authorization, https://api.flow.team/docs/faq
- **개인 키 (User API)**
  - 구성원이 "내 API 키"(`/account/api-keys`)에서 직접 발급한다.
  - 관리자가 "개인 API 키 직접 발급" 정책을 켜 둬야 한다.
  - 키 소유자 본인의 권한 범위로 동작한다.
  - 2026-10-14에 사용자가 실제 발급에 성공했다.
- **요금제**
  - 비즈니스 계열 요금제 기관에는 현재 무료로 제공한다.
  - 사용량이 일정 수준을 넘으면 향후 과금될 수 있다고 안내되어 있다.
  - 출처: https://api.flow.team/docs/faq
- **MCP 서버**는 API 키 대신 OAuth 로그인으로 연결하며, 본인 권한으로 동작한다.

## 이벤트 수신

- Flow에서 외부로 이벤트를 보내는 기능(아웃고잉 웹훅, 이벤트 구독)은 문서에 없다.
- 문서의 웹훅은 들어오는 방향뿐이다. 외부 서비스가 호출하면 Flow 안에 봇 명의로 글이나 채팅이 생긴다. 이 기능은 관리자만 만들 수 있고 베타 단계다.
- 출처: https://api.flow.team/docs/webhook

## 멘션 감지 (폴링)

- **알림 목록 조회**
  - 요청: `GET /user/alarms?filters=MENTION,REGISTRANT,WORKER&readYn=N&cursor=&size=` (`size`는 100 이하)
  - 응답 필드: `alarmId`, `projectId`, `postId`, `remarkId`, `replyId`, `receiverId`, `registerId`, `registerName`, `registeredDateTime`, `message`, `content`, `alarmType`, `mentionYn`
  - 개인 키로 "나에게 온 멘션"을 조회할 수 있다.
  - 출처: https://api.flow.team/docs/api/user/alarms
  - (재확인) 쿼리
    - `filters`, `readYn`, `cursor`, `size`는 모두 선택값이다.
    - `filters`의 허용 값은 `MENTION`, `REGISTRANT`, `WORKER` 세 가지이고, 쉼표로 여러 개를 고를 수 있다.
    - `cursor`는 0 이상의 숫자다. `readYn`을 생략했을 때의 동작은 문서에 없다.
  - (재확인) 응답 구조
    - `response.data.alarms` 아래에 `hasNext`, `lastCursor`, `alarms[]`가 온다. `lastCursor`를 다음 조회의 `cursor`로 쓴다.
  - (재확인) 응답 필드
    - 위 목록에 `readYn`, `registrantYn`(내가 등록한 글 알림 여부), `workerYn`이 더 있다. `mentionYn`과 이 두 필드는 필수 필드다.
    - 문서 예시에서는 댓글이 없는 알림의 `remarkId`, `replyId`가 `"-1"`이다.
    - 문서 예시에서는 `registeredDateTime`이 `yyyyMMddHHmmss` 형식이다.
    - 문서 예시에서는 `message`가 "OOO님이 회원님을 언급했습니다." 같은 시스템 문구이고, `content`는 원문 본문이다.
- **읽음 처리**: `PATCH /user/alarms/read`, `PATCH /user/alarms/read/all`
  - (재확인) 단건 처리는 body에 `alarmId`를 넣는다. 서버는 그 알림의 프로젝트, 게시글, 댓글 정보를 써서 읽음 처리한다.
  - (재확인) 전체 처리는 body가 비어 있으면 모든 알림을 처리한다. `projectId`를 넣으면 그 Flow 프로젝트의 알림만 처리한다.
- **문서로 확인하지 못한 것**: 알림 목록에 **채팅 멘션이 포함되는지**. 응답 필드가 프로젝트·게시글·댓글 기준이라 채팅은 빠져 있을 수 있다.

## 맥락 조회

- **게시물** (개인 키): `GET /user/posts/projects/{projectId}`, 게시글 단건 상세, 업무 필터 조회
  - 상세 응답 필드: `content`, `htmlContent`, `contentJsonYn`
  - (재확인) 단건 상세의 경로는 `GET /user/posts/{postId}`(operationId `getProjectPost`)다. `projectId`는 넣지 않는다.
  - (재확인) 상세 응답에는 `title`, `registerId`, `registerName`, `remarkCount`(댓글 수)도 있다.
- **댓글** (개인 키)
  - `GET /user/comments/{postId}`: `replyYn=Y`를 주면 댓글마다 대댓글을 최대 10개까지 함께 준다.
  - `GET /user/comments/{postId}/replies/{commentId}`
  - 출처: https://api.flow.team/docs/api/user/comments
  - (재확인) 조회 권한은 게시글 단건 조회 권한과 같다.
  - (재확인) 댓글 목록의 `size`는 기본 100이다. 페이징은 부모 댓글을 기준으로 한다.
    - `replyYn=Y`이면 댓글마다 `replies`와 `replyHasNext`가 온다.
    - 대댓글 목록 API는 `replyId` 오름차순이고, `cursor`는 기본 0이다.
  - (재확인) 댓글 응답 필드
    - `commentId`, `contents`, `registerId`, `registerName`, `registerDivisionName`, `attachments`
    - 대댓글에는 `replyId`와 `parentCommentId`가 더 있다.
    - `encrypted`(암호화 여부) 필드도 있다. 값이 `Y`일 때 `contents`가 평문으로 오는지는 문서에 없다.
- **채팅**
  - 채팅 메시지 내용을 조회하는 REST API는 없다.
  - v1(관리자 키)에서는 채팅방 정보만 조회할 수 있다.
  - MCP의 `flow_search`만 "글·업무·댓글·채팅" 검색을 지원한다고 적혀 있다(https://api.flow.team/docs/mcp/tools). v1 MCP는 읽기 전용이다.
- **멘션 표기 형식**: 문서에 없다. 실제 호출로 확인해야 한다.
- **문서 간 불일치**: 공통 문서는 페이지네이션을 `page`/`limit`으로 설명하지만, 엔드포인트 명세는 `cursor`/`size`/`lastCursor`를 쓴다.

## 쓰기

- **댓글 작성** (개인 키, 본인 명의)
  - `POST /user/comments/{postId}`
  - 대댓글: `POST /user/comments/{postId}/replies/{commentId}`
  - 첨부 제한: 파일당 2MB, 일반 파일과 이미지 각 5개
- **채팅 전송** (관리자 키 전용)
  - `POST /v1/chats/{roomId}/messages`, body는 `registerId`와 `contents`(최대 10,000자)
  - 작성자를 임의로 지정하는 구조다.
  - 그룹·프로젝트 채팅방에만 보낼 수 있고, 1:1 DM은 안 된다.
  - 출처: https://api.flow.team/docs/api/v1/chats
- **봇 계정**
  - 관리자가 만들며, 기관당 2개까지다.
  - 봇 명의 댓글 API는 없다.
  - 출처: https://api.flow.team/docs/api/v1/bots

## 한도

- 조회 API는 분당 1,000회, 그 외 API는 분당 120회까지 호출할 수 있다.
- 한도를 넘으면 `429` 응답과 함께 `Retry-After` 헤더가 온다.
- 출처: https://api.flow.team/docs/errors, https://api.flow.team/docs/faq
