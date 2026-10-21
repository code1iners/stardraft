import type { FlowAlarm, FlowApi, FlowApiFailure, FlowApiResult, FlowComment, FlowPost, FlowReply } from '../ports/flow-api';
import { hasMentionMarkupFor } from './mention-markup';
import { mentionPlaceOf } from './mention-place';
import { walkPages } from './pages';
import { isSameFlowUser } from './user-id';

/** 알림을 멘션으로 보지 않고 버린 이유. 로그에만 남는다. */
export type MentionDropReason =
  /** 송신자가 나다. */
  | 'sent-by-me'
  /** 알림의 멘션 위치를 읽을 수 없다. */
  | 'unknown-location'
  /** 글에 나를 지목한 표기가 없다(`@전체`, 담당자 지정, 수정되어 표기가 사라짐). */
  | 'not-mentioned'
  /** 글이 지워졌다(`404`, 목록에 없는 댓글·대댓글). */
  | 'gone'
  /** 글을 볼 권한이 없다(`403`). */
  | 'forbidden';

/** 알림 하나를 판정한 결과. */
export type MentionJudgement =
  /** 나를 직접 지목한 멘션이다. */
  | { kind: 'mention' }
  /** 멘션이 아니거나 볼 수 없는 글이라 조용히 버린다. */
  | { kind: 'dropped'; reason: MentionDropReason }
  /** 글을 조회하지 못해 아직 판정할 수 없다. 다음 조회에서 다시 판정한다. */
  | { kind: 'undecided'; failure: FlowApiFailure };

/** 글을 조회한 결과. 조회하지 못했으면 그대로 판정 결과가 된다. */
type Fetched<T> = { kind: 'found'; value: T } | Exclude<MentionJudgement, { kind: 'mention' }>;

/** 나를 직접 지목한 멘션이라는 판정. */
const MENTION: MentionJudgement = { kind: 'mention' };

/**
 * 멘션 알림이 나를 직접 지목했는지 멘션된 글을 직접 조회해 판정한다.
 * 알림의 `content`에는 멘션 표기가 대부분 빠져 있고, `mentionYn`에는 `@전체`도 섞여 오기 때문이다.
 * 한 번의 조회 동안 같은 게시물의 댓글은 한 번만 받도록, 조회 하나마다 새로 만들어 쓴다.
 */
export class MentionJudge {
  /** 게시물마다 조회한 결과. */
  private readonly posts = new Map<string, Promise<Fetched<FlowPost>>>();
  /** 게시물마다 받은 댓글(ID로 찾음). */
  private readonly comments = new Map<string, Promise<Fetched<Map<string, FlowComment>>>>();
  /** 댓글마다 대댓글 목록 API로 받은 대댓글. */
  private readonly replies = new Map<string, Promise<Fetched<FlowReply[]>>>();

  /** `accountUserId`는 키 확인 때 얻은 내 사용자 ID다. 알림에 `receiverId`가 없을 때 대신 쓴다. */
  constructor(
    private readonly api: FlowApi,
    private readonly accountUserId: string,
  ) {}

  /** 알림 하나를 판정한다. 내 ID는 알림의 `receiverId`다. */
  async judge(alarm: FlowAlarm): Promise<MentionJudgement> {
    /** 나를 지목했는지 볼 내 ID. */
    const myId = alarm.receiverId || this.accountUserId;
    if (isSameFlowUser(alarm.registerId, myId) || isSameFlowUser(alarm.registerId, this.accountUserId)) return dropped('sent-by-me');

    /** 멘션된 글에 나를 지목한 표기가 있는지. */
    const mentionsMe = await this.mentionsMe(alarm, myId);
    if (mentionsMe.kind !== 'found') return mentionsMe;
    return mentionsMe.value ? MENTION : dropped('not-mentioned');
  }

  /** 멘션 위치의 글을 조회해 `myId`를 지목한 표기가 있는지 돌려준다. */
  private async mentionsMe(alarm: FlowAlarm, myId: string): Promise<Fetched<boolean>> {
    /** 멘션 위치. */
    const { postId, remarkId, replyId } = alarm;
    switch (mentionPlaceOf(alarm)) {
      case 'post': {
        // 본문은 TEXT 컴포넌트의 MENTIONS와 CONTENTS 표기를 둘 다 본다. @전체는 MENTIONS에 "ALL"로 오므로 걸리지 않는다.
        /** 게시물. */
        const post = await this.post(postId);
        if (post.kind !== 'found') return post;
        return found(
          post.value.textComponents.some(
            ({ contents, mentions }) => mentions.some((id) => isSameFlowUser(id, myId)) || hasMentionMarkupFor(contents, myId),
          ),
        );
      }
      case 'comment': {
        /** 댓글. */
        const comment = await this.comment(postId, remarkId);
        if (comment.kind !== 'found') return comment;
        return found(hasMentionMarkupFor(comment.value.contents, myId));
      }
      case 'reply': {
        /** 대댓글의 부모 댓글. */
        const comment = await this.comment(postId, remarkId);
        if (comment.kind !== 'found') return comment;
        /** 대댓글. */
        const reply = await this.reply(postId, comment.value, replyId);
        if (reply.kind !== 'found') return reply;
        return found(hasMentionMarkupFor(reply.value.contents, myId));
      }
      case null:
        return dropped('unknown-location');
    }
  }

  /** 게시물을 조회한다. */
  private post(postId: string): Promise<Fetched<FlowPost>> {
    return cached(this.posts, postId, async () => fetched(await this.api.getPost(postId)));
  }

  /** 게시물의 댓글 가운데 `commentId`를 찾는다. 목록에 없으면 지워진 것으로 본다. */
  private async comment(postId: string, commentId: string): Promise<Fetched<FlowComment>> {
    /** 게시물의 댓글. */
    const comments = await cached(this.comments, postId, async () => {
      /** 모든 쪽의 댓글. */
      const all = await allItems((cursor) => this.api.listComments(postId, cursor), (page) => page.comments);
      return all.kind === 'found' ? found(new Map(all.value.map((comment) => [comment.commentId, comment]))) : all;
    });
    if (comments.kind !== 'found') return comments;
    /** 찾은 댓글. */
    const comment = comments.value.get(commentId);
    return comment ? found(comment) : dropped('gone');
  }

  /**
   * 댓글의 대댓글 가운데 `replyId`를 찾는다. 댓글과 함께 받은 처음 10개에 없으면 대댓글 목록 API로 넘겨 찾는다.
   * 그래도 없으면 지워진 것으로 본다.
   */
  private async reply(postId: string, comment: FlowComment, replyId: string): Promise<Fetched<FlowReply>> {
    /** 댓글과 함께 받은 대댓글에서 찾은 것. */
    const inline = comment.replies.find((reply) => reply.replyId === replyId);
    if (inline) return found(inline);
    if (!comment.replyHasNext) return dropped('gone');

    /** 대댓글 목록 API로 받은 대댓글. */
    const replies = await cached(this.replies, JSON.stringify([postId, comment.commentId]), () =>
      allItems((cursor) => this.api.listReplies(postId, comment.commentId, cursor), (page) => page.replies),
    );
    if (replies.kind !== 'found') return replies;
    /** 찾은 대댓글. */
    const reply = replies.value.find((item) => item.replyId === replyId);
    return reply ? found(reply) : dropped('gone');
  }
}

/** 조회한 값. */
function found<T>(value: T): Fetched<T> {
  return { kind: 'found', value };
}

/** 버린다는 판정. */
function dropped(reason: MentionDropReason): { kind: 'dropped'; reason: MentionDropReason } {
  return { kind: 'dropped', reason };
}

/** Flow API 결과를 조회 결과로 바꾼다. */
function fetched<T>(result: FlowApiResult<T>): Fetched<T> {
  return result.ok ? found(result.value) : judgementOfFailure(result.failure);
}

/**
 * 조회 실패를 판정으로 바꾼다. 지워졌거나(`404`) 권한이 없으면(`403`) 버린다.
 * 그 밖의 실패(키 거부, 연결 실패, 요청 한도, 서버 오류, 모르는 응답)는 다음 조회에서 다시 판정한다.
 */
function judgementOfFailure(failure: FlowApiFailure): Exclude<MentionJudgement, { kind: 'mention' }> {
  if (failure.kind === 'http' && failure.status === 403) return dropped('forbidden');
  if (failure.kind === 'http' && failure.status === 404) return dropped('gone');
  return { kind: 'undecided', failure };
}

/** 커서로 나뉜 목록을 끝까지 받아 항목을 모은다. */
async function allItems<P extends { nextCursor: string | null }, T>(
  fetchPage: (cursor: string | null) => Promise<FlowApiResult<P>>,
  itemsOf: (page: P) => T[],
): Promise<Fetched<T[]>> {
  /** 모은 항목. */
  const items: T[] = [];
  /** 쪽을 넘긴 결과. */
  const walk = await walkPages(fetchPage, (page) => {
    items.push(...itemsOf(page));
    return true;
  });
  return walk.ok ? found(items) : judgementOfFailure(walk.failure);
}

/** `key`의 조회 결과가 있으면 그것을, 없으면 `load`로 조회해 남긴 결과를 돌려준다. */
function cached<T>(cache: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  /** 남겨 둔 결과. */
  let entry = cache.get(key);
  if (!entry) {
    entry = load();
    cache.set(key, entry);
  }
  return entry;
}
