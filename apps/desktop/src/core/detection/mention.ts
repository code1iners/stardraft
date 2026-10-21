/**
 * 멘션 위치. 멘션이 일어난 글로, 게시물 본문·댓글·대댓글 가운데 하나다. 같은 멘션 위치에서 온 멘션은 하나의 멘션이다.
 * 본문 멘션은 `remarkId`와 `replyId`가, 댓글 멘션은 `replyId`가 `"-1"`이다. 대댓글 멘션의 `remarkId`는 부모 댓글이다.
 */
export interface MentionLocation {
  /** 게시물 ID. */
  postId: string;
  /** 댓글 멘션이면 그 댓글, 대댓글 멘션이면 부모 댓글의 ID. 본문 멘션이면 `"-1"`. */
  remarkId: string;
  /** 대댓글 멘션이면 그 대댓글의 ID. 아니면 `"-1"`. */
  replyId: string;
}

/** 판정을 통과해 `state.db`에 저장한 멘션. 멘션 위치로 식별한다. */
export interface Mention extends MentionLocation {
  /** 멘션이 온 Flow 프로젝트 ID. */
  projectId: string;
  /** 이 멘션을 알린 알림 ID. 같은 멘션 위치의 알림이 여럿이면 가장 먼저 온 알림이다. */
  alarmId: string;
  /** 송신자의 사용자 ID. */
  senderId: string;
  /** 송신자 이름. 비어 있을 수 있다. */
  senderName: string;
  /** 알림 시각. Flow 형식(`yyyyMMddHHmmss`) 그대로다. Flow 글의 시각과 비교할 때 PC 시계 대신 이 값을 쓴다. */
  registeredDateTime: string;
  /** 앱이 감지한 시각(Unix epoch 밀리초). */
  detectedAt: number;
  /** Flow 원문. 멘션이 일어난 글(본문·댓글·대댓글)의 내용이고 멘션 표기가 그대로 들어 있다. 작은 창 원문 영역에 보인다. */
  text: string;
}

/** 멘션 위치를 한 문자열로 나타낸다. 같은 위치를 가려낼 때 쓴다. */
export function mentionLocationKey({ postId, remarkId, replyId }: MentionLocation): string {
  return JSON.stringify([postId, remarkId, replyId]);
}
