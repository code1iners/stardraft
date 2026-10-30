import type { FlowApi, FlowApiResult, FlowComment, FlowReply } from '../ports/flow-api';
import { myAnswersAmong, type MyAnswer } from './mention-judgement';
import { walkPages } from './pages';

/** 업무 게시글의 댓글과 대댓글 전부. 담당 변경 기록을 읽어야 하므로 시스템 댓글도 그대로 둔다. */
export interface TaskRemarks {
  /** 모든 쪽의 댓글. */
  comments: FlowComment[];
  /** 모든 댓글의 대댓글. 댓글과 함께 온 처음 10개 뒤는 대댓글 목록으로 끝까지 받았다. */
  replies: FlowReply[];
  /** 쪽 수 상한에 닿지 않고 끝까지 받았는지 여부. 끝까지 받지 못했으면 답이 없다고 단정하지 않는다. */
  complete: boolean;
}

/** 업무 게시글의 댓글과 모든 스레드의 대댓글을 받는다. 어느 쪽이든 받지 못하면 그 실패를 돌려준다. */
export async function taskRemarks(api: FlowApi, postId: string): Promise<FlowApiResult<TaskRemarks>> {
  /** 받은 댓글. */
  const comments: FlowComment[] = [];
  /** 댓글 쪽을 넘긴 결과. */
  const walk = await walkPages((cursor) => api.listComments(postId, cursor), (page) => {
    comments.push(...page.comments);
    return true;
  });
  if (!walk.ok) return walk;
  /** 받은 대댓글. */
  const replies: FlowReply[] = [];
  /** 상한 없이 끝까지 받았는지 여부. */
  let complete = !walk.pageLimitReached;
  for (const comment of comments) {
    if (!comment.replyHasNext) {
      replies.push(...comment.replies);
      continue;
    }
    /** 대댓글 목록으로 받은 스레드 전부. 함께 온 처음 10개도 다시 온다. */
    const thread: FlowReply[] = [];
    /** 대댓글 쪽을 넘긴 결과. */
    const more = await walkPages((cursor) => api.listReplies(postId, comment.commentId, cursor), (page) => {
      thread.push(...page.replies);
      return true;
    });
    if (!more.ok) return more;
    complete &&= !more.pageLimitReached;
    replies.push(...thread);
  }
  return { ok: true, value: { comments, replies, complete } };
}

/** 업무에 쓴 내 댓글과 모든 스레드의 내 대댓글. 시스템 기록은 내 명의라도 들지 않는다. */
export function taskAnswers(remarks: TaskRemarks, myIds: readonly string[]): MyAnswer[] {
  return myAnswersAmong([...remarks.comments, ...remarks.replies], myIds);
}
