/** Flow 구성원 정보. `GET /user/employees/me` 응답에서 앱이 쓰는 값이다. */
export interface FlowEmployee {
  /** Flow 사용자 ID(이메일 형식). 알림의 `receiverId`와 같은 값이다. */
  userId: string;
  /** 이름. */
  name: string;
  /** 소속. */
  division: string;
  /** 이메일. */
  email: string;
}

/** 내가 참여한 Flow 프로젝트. `GET /user/projects/participants` 응답에서 앱이 쓰는 값이다. */
export interface FlowProject {
  /** Flow 프로젝트 ID. 알림의 `projectId`와 같은 값이고 저장소 매핑의 키다. */
  projectId: string;
  /** Flow 프로젝트 이름. 비어 있을 수 있다. */
  title: string;
  /** Flow에서 열기 주소. 없으면 `null`. */
  projectUrl: string | null;
}

/**
 * 멘션 알림 하나. `GET /user/alarms` 응답에서 앱이 쓰는 값이다. ID는 숫자로 와도 문자열로 맞춘다.
 * 멘션 위치는 `(postId, remarkId, replyId)`이고, 본문 멘션은 `remarkId`와 `replyId`가, 댓글 멘션은 `replyId`가 `"-1"`이다.
 */
export interface FlowAlarm {
  /** 알림 ID. 알림 목록은 이 값의 내림차순으로 오며, 감지의 기준점으로만 쓴다. */
  alarmId: string;
  /** 멘션이 온 Flow 프로젝트 ID. */
  projectId: string;
  /** 게시물 ID. */
  postId: string;
  /** 댓글 멘션이면 그 댓글, 대댓글 멘션이면 부모 댓글의 ID. 본문 멘션이면 `"-1"`. */
  remarkId: string;
  /** 대댓글 멘션이면 그 대댓글의 ID. 아니면 `"-1"`. */
  replyId: string;
  /** 알림을 받은 사람(나)의 사용자 ID. */
  receiverId: string;
  /** 멘션한 사람(송신자)의 사용자 ID. */
  registerId: string;
  /** 송신자 이름. 비어 있을 수 있다. */
  registerName: string;
  /** 알림 시각. Flow 형식(`yyyyMMddHHmmss`) 그대로다. */
  registeredDateTime: string;
}

/** 멘션 알림 목록 한 쪽. */
export interface FlowAlarmPage {
  /** 이 쪽의 알림. Flow가 준 순서(`alarmId` 내림차순) 그대로다. */
  alarms: FlowAlarm[];
  /** 다음 쪽을 받을 커서. 마지막 쪽이면 `null`. */
  nextCursor: string | null;
}

/** 게시물 본문의 글 조각. 본문 `content` JSON의 TEXT 컴포넌트 하나다. */
export interface FlowTextComponent {
  /** 글(`CONTENTS`). 멘션 표기 `@[이름](사용자 ID)`가 그대로 들어 있다. */
  contents: string;
  /** 지목한 사용자 ID 목록(`MENTIONS`). `@전체`는 `ALL`로 온다. */
  mentions: string[];
}

/** 게시물 하나. `GET /user/posts/{postId}` 응답에서 앱이 쓰는 값이다. */
export interface FlowPost {
  /** 게시물 ID. */
  postId: string;
  /** 게시물 제목. 비어 있을 수 있다. */
  title: string;
  /** "Flow에서 열기" 주소. 게시물을 바로 연다. 없으면 `null`. */
  connectUrl: string | null;
  /** 작성자 이름. 없으면 빈 문자열. */
  registerName: string;
  /** 쓴 시각. Flow 형식(`yyyyMMddHHmmss`) 그대로다. 없으면 빈 문자열. */
  registeredDateTime: string;
  /** 본문의 TEXT 컴포넌트. 본문이 JSON이 아니면 본문 전체를 글 조각 하나로 담는다. */
  textComponents: FlowTextComponent[];
  /** 첨부 파일 이름. 이미지는 넣지 않는다. */
  attachments: string[];
}

/** 댓글과 대댓글이 함께 갖는, 누가 언제 썼는지에 관한 값. "이미 답함" 판정과 맥락 수집에 쓴다. */
export interface FlowRemarkAuthorship {
  /** 쓴 사람의 사용자 ID. 시스템 댓글이면 그 행동을 한 사람이다. 없으면 빈 문자열. */
  registerId: string;
  /** 쓴 사람의 이름. 없으면 빈 문자열. */
  registerName: string;
  /** 쓴 시각. Flow 형식(`yyyyMMddHHmmss`) 그대로다. 없으면 빈 문자열. */
  registeredDateTime: string;
  /** 시스템 댓글(제목 변경, 업무 상태 변경 등)의 종류. 사람이 쓴 글이면 빈 문자열이다. */
  systemCode: string;
}

/** 대댓글 하나. */
export interface FlowReply extends FlowRemarkAuthorship {
  /** 대댓글 ID. */
  replyId: string;
  /** 글. 멘션 표기가 그대로 들어 있다. */
  contents: string;
  /** 첨부 파일 이름. */
  attachments: string[];
}

/** 댓글 하나. `GET /user/comments/{postId}?replyYn=Y` 응답에서 앱이 쓰는 값이다. */
export interface FlowComment extends FlowRemarkAuthorship {
  /** 댓글 ID. 알림의 `remarkId`와 같은 값이다. */
  commentId: string;
  /** 글. 멘션 표기가 그대로 들어 있다. */
  contents: string;
  /** 첨부 파일 이름. */
  attachments: string[];
  /** 댓글과 함께 받은 대댓글. Flow는 처음 10개까지만 준다(`replyId` 오름차순). */
  replies: FlowReply[];
  /** 함께 받은 대댓글 뒤에 대댓글이 더 있는지 여부. 있으면 대댓글 목록 API로 넘겨 받는다. */
  replyHasNext: boolean;
}

/** 댓글 목록 한 쪽. */
export interface FlowCommentPage {
  /** 이 쪽의 댓글. */
  comments: FlowComment[];
  /** 다음 쪽을 받을 커서. 마지막 쪽이면 `null`. */
  nextCursor: string | null;
}

/** 대댓글 목록 한 쪽. */
export interface FlowReplyPage {
  /** 이 쪽의 대댓글. `replyId` 오름차순이다. */
  replies: FlowReply[];
  /** 다음 쪽을 받을 커서. 마지막 쪽이면 `null`. */
  nextCursor: string | null;
}

/** Flow API 호출이 실패한 이유. */
export type FlowApiFailure =
  /** `401`. 키가 맞지 않거나 삭제·변경됐다. */
  | { kind: 'unauthorized' }
  /** `429`. `Retry-After`가 있으면 기다릴 시간(밀리초)을 담는다. */
  | { kind: 'rate-limited'; retryAfterMs: number | null }
  /** 응답을 받지 못했다. */
  | { kind: 'network' }
  /** 그 밖의 응답 코드. */
  | { kind: 'http'; status: number }
  /** 성공 응답을 받았지만 본문이 앱이 아는 모양이 아니다. */
  | { kind: 'unexpected-response' };

/** Flow API 호출 결과. */
export type FlowApiResult<T> = { ok: true; value: T } | { ok: false; failure: FlowApiFailure };

/**
 * Flow API 포트.
 * Flow 전용 코드는 이 포트의 어댑터 한 곳에 모은다. 알림 조회, 맥락 조회, 게시는 이 포트에 차례로 더한다.
 */
export interface FlowApi {
  /** 키 소유자 본인의 구성원 정보를 조회한다. 키 확인에 쓴다. */
  getMe(): Promise<FlowApiResult<FlowEmployee>>;
  /** 키 소유자가 참여한 Flow 프로젝트 목록을 조회한다. 저장소 매핑에서 Flow 프로젝트를 고를 때 쓴다. */
  listParticipantProjects(): Promise<FlowApiResult<FlowProject[]>>;
  /**
   * 업무 멘션 알림 목록 한 쪽을 조회한다. `cursor`가 `null`이면 가장 최근 쪽이다.
   * 읽은 알림도 받고, Flow의 읽음 상태는 바꾸지 않는다.
   */
  listMentionAlarms(cursor: string | null): Promise<FlowApiResult<FlowAlarmPage>>;
  /** 게시물 하나를 조회한다. 지워졌으면 `404`, 볼 권한이 없으면 `403`으로 실패한다. */
  getPost(postId: string): Promise<FlowApiResult<FlowPost>>;
  /** 게시물의 댓글 목록 한 쪽을 대댓글(댓글마다 처음 10개)과 함께 조회한다. `cursor`가 `null`이면 첫 쪽이다. */
  listComments(postId: string, cursor: string | null): Promise<FlowApiResult<FlowCommentPage>>;
  /** 댓글 하나의 대댓글 목록 한 쪽을 `replyId` 오름차순으로 조회한다. `cursor`가 `null`이면 첫 쪽이다. */
  listReplies(postId: string, commentId: string, cursor: string | null): Promise<FlowApiResult<FlowReplyPage>>;
}

/** 지금 키로 부르는 Flow. 키를 바꾸면 새로 만든다. */
export interface FlowConnection {
  /** 지금 키로 부르는 Flow API. */
  api: FlowApi;
  /** Flow가 이 키를 거부했다(`401`)고 알린다. "키 확인 필요"를 올린다. */
  reportKeyRejected(): void;
}
