import type { MentionLocation } from '../detection/mention';

/** 멘션이 일어난 글의 종류. 게시물 본문, 댓글, 대댓글이다. */
export type MentionPlace = 'post' | 'comment' | 'reply';

/** Flow가 해당 없는 ID 자리에 두는 값. */
const NONE = '-1';

/**
 * 멘션 위치가 게시물 본문·댓글·대댓글 가운데 어디인지 돌려준다. 읽을 수 없는 위치면 `null`.
 * 본문 멘션은 `remarkId`와 `replyId`가 모두 `"-1"`, 댓글 멘션은 `replyId`만 `"-1"`, 대댓글 멘션은 둘 다 ID다.
 */
export function mentionPlaceOf({ postId, remarkId, replyId }: MentionLocation): MentionPlace | null {
  if (!postId || !remarkId || !replyId) return null;
  if (remarkId === NONE) return replyId === NONE ? 'post' : null;
  return replyId === NONE ? 'comment' : 'reply';
}
