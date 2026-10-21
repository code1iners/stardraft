import type { MentionLocation } from '../detection/mention';
import { compareRemarks, type BundleContext, type ContextRemark, type ContextWriting } from './bundle-context';
import { isPostBody, mentionPlaceOf } from './mention-place';

/** 게시물 본문의 글 키. */
export const POST_WRITING_KEY = 'post';

/** 준비된 뒤의 변화 감시가 지켜보는 글 하나. */
export interface WatchedWriting {
  /** 글 키. 게시물 본문은 `post`, 댓글은 `comment:<commentId>`, 대댓글은 `reply:<replyId>`다. */
  key: string;
  /** 글. */
  writing: ContextWriting;
}

/** 비교 기준과 지금 내용을 견준 변화. 글은 글 키로 나타낸다. */
export interface ContextChanges {
  /** 비교 기준 뒤에 지켜볼 범위에 새로 생긴 글. 지금 내용의 순서다. */
  newWritings: string[];
  /** 비교 기준에도 있었는데 글이 바뀐 글. 지금 내용의 순서다. 첨부의 변화는 세지 않는다. */
  editedWritings: string[];
}

/** 댓글의 글 키. */
export function commentKey(commentId: string): string {
  return `comment:${commentId}`;
}

/** 대댓글의 글 키. */
export function replyKey(replyId: string): string {
  return `reply:${replyId}`;
}

/** 멘션이 일어난 글의 글 키. 읽을 수 없는 위치면 `null`. */
export function mentionWritingKey(mention: MentionLocation): string | null {
  switch (mentionPlaceOf(mention)) {
    case 'post':
      return POST_WRITING_KEY;
    case 'comment':
      return commentKey(mention.remarkId);
    case 'reply':
      return replyKey(mention.replyId);
    case null:
      return null;
  }
}

/** 묶음 자리에서 찾은 내 답의 글 키. 본문 묶음이면 게시물의 댓글, 댓글 스레드 묶음이면 그 스레드의 대댓글이다. */
export function answerWritingKey(place: Pick<MentionLocation, 'remarkId'>, answerId: string): string {
  return isPostBody(place) ? commentKey(answerId) : replyKey(answerId);
}

/**
 * 맥락에서 준비된 뒤의 변화 감시가 지켜볼 글. 댓글 스레드 묶음은 그 댓글 스레드 전체(머리 댓글과 대댓글 전부),
 * 본문 묶음은 게시물 본문과 댓글이고 대댓글은 넣지 않는다. 다른 댓글 스레드와 댓글 스레드 묶음의 본문은 범위 밖이고,
 * 시스템 댓글은 맥락에 들지 않으므로 범위에도 없다.
 */
export function watchedWritings(context: BundleContext): WatchedWriting[] {
  /** 대상 댓글 스레드. 본문 묶음이면 `null`이다. */
  const thread = context.targetThread;
  if (thread) {
    return [{ key: commentKey(thread.id), writing: thread }, ...thread.replies.map((reply) => ({ key: replyKey(reply.id), writing: reply }))];
  }
  return [{ key: POST_WRITING_KEY, writing: context.post }, ...context.otherComments.map((comment) => ({ key: commentKey(comment.id), writing: comment }))];
}

/**
 * 비교 기준(초안을 만들 때 넘긴 맥락)과 지금 내용을 지켜볼 범위 안에서 견준다.
 * 비교 기준에 없던 글은 새 글, 있었는데 글이 바뀐 글은 수정된 글이다. `notNew`의 글(묶음의 멘션, 되돌릴 때 기록한 내 답)은 새 글로 세지 않는다.
 * 본문 묶음의 비교 기준에는 최근 댓글만 들어 있으므로, 비교 기준의 가장 오래된 댓글보다 앞선 댓글은 새 글이 아니다.
 */
export function contextChanges(baseline: BundleContext, current: BundleContext, notNew: ReadonlySet<string>): ContextChanges {
  /** 비교 기준의 글. 글 키로 찾는다. */
  const before = new Map(watchedWritings(baseline).map(({ key, writing }) => [key, writing]));
  /** 본문 묶음 비교 기준의 가장 오래된 댓글. 댓글 스레드 묶음이거나 댓글이 없었으면 `null`. */
  const oldestComment = baseline.targetThread ? null : (baseline.otherComments[0] ?? null);
  /** 견준 결과. */
  const changes: ContextChanges = { newWritings: [], editedWritings: [] };

  for (const { key, writing } of watchedWritings(current)) {
    /** 비교 기준의 같은 글. */
    const previous = before.get(key);
    if (previous) {
      if (previous.contents !== writing.contents) changes.editedWritings.push(key);
      continue;
    }
    if (notNew.has(key)) continue;
    if (oldestComment && isRemark(writing) && byWrittenTime(writing, oldestComment) < 0) continue;
    changes.newWritings.push(key);
  }
  return changes;
}

/** 댓글이나 대댓글인지 본다. 게시물 본문에는 ID가 없다. */
function isRemark(writing: ContextWriting): writing is ContextRemark {
  return 'id' in writing;
}

/** 맥락의 댓글을 쓴 시각, 같으면 ID 크기로 비교한다. 맥락의 댓글 순서와 같다. */
const byWrittenTime = compareRemarks<ContextRemark>((remark) => remark.id);
