import { activeMentions, type MentionBundle } from '../bundles/mention-bundle';
import { mentionLocationOf, type MentionLocation } from '../detection/mention';
import type { FlowApi, FlowApiFailure, FlowApiResult, FlowComment, FlowRemarkAuthorship, FlowReply } from '../ports/flow-api';
import { compareAlarmIds } from './alarm-id';
import { readableFlowTime } from './flow-time';
import { myAnswersAmong, type MyAnswer } from './mention-judgement';
import { hasMentionMarkupFor, namedMentionText, postBodyMentions } from './mention-markup';
import { isPostBody, mentionPlaceOf } from './mention-place';
import { walkPages } from './pages';

/** 맥락 문서의 길이 상한(글자 수). 넘치면 정한 순서대로 빼고, 절대 빼지 않는 것만으로 넘치면 그대로 둔다. */
export const CONTEXT_CHAR_LIMIT = 30_000;
/** 댓글 스레드 묶음에서 길이 상한을 넘을 때 게시물 본문을 남기는 길이(글자 수). */
const TRUNCATED_BODY_CHARS = 10_000;
/** 맥락에 담는 다른 댓글 수. 시스템 댓글은 세지 않는다. */
const OTHER_COMMENT_LIMIT = 20;
/** 다른 댓글마다 담는 대댓글 수. 댓글과 함께 받은 처음 10개다. */
const OTHER_REPLY_LIMIT = 10;

/** 맥락의 글 하나가 갖는 값. 게시물 본문, 댓글, 대댓글이 함께 갖는다. 쓴 사람의 사용자 ID는 받는 사람에만 쓰고 맥락 문서와 화면에는 넣지 않는다. */
export interface ContextWriting {
  /** 쓴 사람의 사용자 ID(`registerId`). Flow가 주지 않았으면 빈 문자열이다. 받는 사람이 생기기 전에 저장한 맥락에는 이 값이 없다. */
  authorId?: string;
  /** 쓴 사람 이름. 비어 있을 수 있다. */
  authorName: string;
  /** 쓴 시각. Flow 형식(`yyyyMMddHHmmss`) 그대로다. 없으면 빈 문자열. */
  registeredDateTime: string;
  /** 글. 멘션 표기가 그대로 들어 있다. 에이전트에게 넘길 때 이름 표기로 바꾼다. */
  contents: string;
  /** 첨부 파일 이름. 이미지는 넣지 않는다. */
  attachments: string[];
  /** 묶음의 멘션인지 여부. 게시물 본문은 본문 묶음이면 참이다. */
  mention: boolean;
}

/** 맥락의 게시물. 본문은 TEXT 컴포넌트의 글을 줄바꿈으로 이은 것이다. */
export interface ContextPost extends ContextWriting {
  /** 게시물 제목. 비어 있을 수 있다. */
  title: string;
}

/** 맥락의 댓글이나 대댓글 하나. 시스템 댓글은 맥락에 넣지 않는다. */
export interface ContextRemark extends ContextWriting {
  /** 댓글이면 `commentId`, 대댓글이면 `replyId`. */
  id: string;
}

/** 맥락의 댓글 하나와 그 대댓글. */
export interface ContextComment extends ContextRemark {
  /** 대댓글. 오래된 것부터다. 대상 댓글 스레드면 전부, 다른 댓글이면 처음 10개 가운데 시스템 댓글을 뺀 것이다. */
  replies: ContextRemark[];
}

/**
 * 멘션 묶음의 맥락. 초안을 만들 때마다 Flow에서 새로 조회하고, 조회한 내용을 묶음에 비교 기준으로 저장한다.
 * 게시물 제목과 본문, 대상 댓글 스레드 전부, 다른 댓글 최근 20개(댓글마다 대댓글 처음 10개)로 이뤄진다.
 */
export interface BundleContext {
  /** 조회한 시각(Unix epoch 밀리초). */
  fetchedAt: number;
  /** 게시물 제목과 본문. */
  post: ContextPost;
  /** 대상 댓글 스레드. 머리 댓글부터 대댓글까지 전부다. 본문 묶음이면 `null`. */
  targetThread: ContextComment | null;
  /** 대상 댓글 스레드가 아닌 댓글 가운데 최근 20개. 오래된 것부터다. 본문 묶음이면 본문 아래의 댓글이 모두 여기에 든다. */
  otherComments: ContextComment[];
}

/** 맥락을 모으지 못한 이유. Flow API 실패이거나, 대상 댓글 스레드의 머리 댓글이 목록에 없다. */
export type BundleContextFailure = FlowApiFailure | { kind: 'thread-gone' };

/**
 * 맥락을 모으지 못한 이유가 원문이 사라진 것인지 본다. 글이 지워졌거나(`404`), 볼 권한이 없거나(`403`),
 * 머리 댓글이 지워졌으면(목록에 없음, 대댓글 목록의 `412` `NOT_EXISTS_ERROR`) 참이다.
 */
export function isSourceGone(failure: BundleContextFailure): boolean {
  return failure.kind === 'thread-gone' || (failure.kind === 'http' && (failure.status === 403 || failure.status === 404 || failure.status === 412));
}

/**
 * 멘션이 일어난 글을 맥락에서 찾는다. 본문 멘션이면 게시물, 댓글 멘션이면 대상 댓글 스레드의 머리 댓글, 대댓글 멘션이면 그 대댓글이다.
 * 맥락에 없으면(지워진 대댓글 등) `null`.
 */
export function mentionWritingOf(context: BundleContext, mention: MentionLocation): ContextWriting | null {
  switch (mentionPlaceOf(mention)) {
    case 'post':
      return context.post;
    case 'comment':
      return context.targetThread?.id === mention.remarkId ? context.targetThread : null;
    case 'reply':
      return context.targetThread?.replies.find((reply) => reply.id === mention.replyId) ?? null;
    case null:
      return null;
  }
}

/**
 * 맥락을 모은 결과. 같은 조회에서 찾은 묶음 자리의 내 답도 함께 돌려준다. 초안을 만들기 직전과 준비된 뒤의 "이미 답함" 판정에 쓴다.
 * 내 답은 본문 묶음이면 게시물에 쓴 내 댓글, 댓글 스레드 묶음이면 그 스레드의 내 대댓글이다. 시스템 댓글은 들지 않는다.
 * `goneMentions`는 묶음의 멘션 가운데 지금 Flow에서 사라진 것(글이 지워짐, 수정되어 나를 지목하지 않음)이다. 준비된 뒤의 변화 감시가 쓴다.
 */
export type BundleContextResult =
  | { ok: true; context: BundleContext; myAnswers: MyAnswer[]; goneMentions: MentionLocation[] }
  | { ok: false; failure: BundleContextFailure };

/** 맥락을 모을 묶음. 자리와 멘션만 본다. */
export type ContextTarget = Pick<MentionBundle, 'postId' | 'remarkId' | 'mentions'>;

/**
 * 묶음의 맥락을 Flow에서 새로 조회해 모은다. 게시물, 댓글 전부, 대상 댓글 스레드의 대댓글 전부를 받는다.
 * 시스템 댓글(`systemCode`가 있는 글)은 맥락에 넣지 않고 다른 댓글 20개를 셀 때도 세지 않는다.
 * 대상 댓글 스레드는 댓글과 함께 받은 처음 10개 뒤에 대댓글이 더 있으면 대댓글 목록 API로 끝까지 넘긴다.
 * `myIds`(내 사용자 ID들)로 같은 조회에서 묶음 자리의 내 답도 찾는다.
 */
export async function collectBundleContext(api: FlowApi, bundle: ContextTarget, now: number, myIds: readonly string[]): Promise<BundleContextResult> {
  /** 본문 묶음인지 여부. */
  const postBody = isPostBody(bundle);

  /** 게시물. */
  const post = await api.getPost(bundle.postId);
  if (!post.ok) return post;

  /** 게시물의 댓글 전부. 시스템 댓글은 뺐다. */
  const comments: FlowComment[] = [];
  /** 댓글을 넘긴 결과. */
  const walk = await walkPages(
    (cursor) => api.listComments(bundle.postId, cursor),
    (page) => {
      comments.push(...page.comments.filter(isHumanRemark));
      return true;
    },
  );
  if (!walk.ok) return walk;
  comments.sort(compareRemarks((comment) => comment.commentId));

  /** 대상 댓글 스레드. */
  let targetThread: ContextComment | null = null;
  /** 묶음 자리의 내 답. 본문 묶음이면 게시물에 쓴 내 댓글이다. */
  let myAnswers = myAnswersAmong(comments, myIds);
  /** 멘션이 일어난 글이 지금도 나를 지목하는지 보는 함수. 본문 묶음이면 게시물 본문이다. */
  let stillMentions = (mention: MentionLocation): boolean =>
    mentionPlaceOf(mention) === 'post' && myIds.some((id) => postBodyMentions(post.value.textComponents, id));
  if (!postBody) {
    /** 대상 댓글 스레드의 머리 댓글. */
    const head = comments.find((comment) => comment.commentId === bundle.remarkId);
    if (!head) return { ok: false, failure: { kind: 'thread-gone' } };
    /** 머리 댓글의 대댓글 전부. */
    const replies = head.replyHasNext ? await allReplies(api, bundle.postId, head.commentId) : { ok: true as const, value: head.replies };
    if (!replies.ok) return replies;
    /** 사람이 쓴 대댓글. 오래된 것부터다. */
    const humanReplies = replies.value.filter(isHumanRemark).sort(compareRemarks((reply) => reply.replyId));
    targetThread = { ...remarkOf(head.commentId, head), replies: humanReplies.map((reply) => remarkOf(reply.replyId, reply)) };
    myAnswers = myAnswersAmong(humanReplies, myIds);
    stillMentions = (mention) => {
      switch (mentionPlaceOf(mention)) {
        case 'comment':
          return mention.remarkId === head.commentId && mentionsAnyOf(head.contents, myIds);
        case 'reply': {
          /** 멘션이 일어난 대댓글. 지워졌으면 없다. */
          const reply = humanReplies.find((item) => item.replyId === mention.replyId);
          return reply !== undefined && mentionsAnyOf(reply.contents, myIds);
        }
        default:
          return false;
      }
    };
  }

  /** 멘션 표시를 하기 전의 맥락. */
  const context: BundleContext = {
    fetchedAt: now,
    post: {
      title: post.value.title,
      authorId: post.value.registerId,
      authorName: post.value.registerName,
      registeredDateTime: post.value.registeredDateTime,
      contents: post.value.textComponents.map(({ contents }) => contents).join('\n'),
      attachments: [...post.value.attachments],
      mention: false,
    },
    targetThread,
    otherComments: comments
      .filter((comment) => postBody || comment.commentId !== bundle.remarkId)
      .slice(-OTHER_COMMENT_LIMIT)
      .map((comment) => ({
        ...remarkOf(comment.commentId, comment),
        replies: comment.replies
          .slice(0, OTHER_REPLY_LIMIT)
          .filter(isHumanRemark)
          .map((reply) => remarkOf(reply.replyId, reply)),
      })),
  };
  return {
    ok: true,
    context: markContextMentions(context, bundle),
    myAnswers,
    goneMentions: bundle.mentions.filter((mention) => !stillMentions(mention)).map(mentionLocationOf),
  };
}

/** 댓글이나 대댓글에 사용자 ID들 가운데 하나를 가리키는 멘션 표기가 있는지 본다. */
function mentionsAnyOf(contents: string, userIds: readonly string[]): boolean {
  return userIds.some((id) => hasMentionMarkupFor(contents, id));
}

/**
 * 맥락의 글마다 묶음에 남은 멘션인지 다시 표시한 사본. 본문 묶음이면 게시물 본문, 댓글 스레드 묶음이면 대상 댓글 스레드의 멘션 글이다.
 * 초안을 만들기 직전에 "이미 답함"으로 빠진 멘션은 표시하지 않으려고 판정 뒤에 다시 부른다. 다른 댓글은 멘션이 아니다.
 */
export function markContextMentions(context: BundleContext, bundle: ContextTarget): BundleContext {
  /** 묶음에 남은 멘션. */
  const active = activeMentions(bundle);
  /** 묶음의 대댓글 멘션 ID. */
  const mentionedReplies = new Set(active.filter((mention) => mentionPlaceOf(mention) === 'reply').map((mention) => mention.replyId));
  /** 대상 댓글 스레드. */
  const thread = context.targetThread;
  return {
    ...context,
    post: { ...context.post, mention: isPostBody(bundle) },
    targetThread: thread && {
      ...thread,
      mention: active.some((mention) => mentionPlaceOf(mention) === 'comment'),
      replies: thread.replies.map((reply) => ({ ...reply, mention: mentionedReplies.has(reply.id) })),
    },
  };
}

/** 대댓글 목록 API로 댓글 하나의 대댓글을 처음부터 끝까지 받는다. */
async function allReplies(api: FlowApi, postId: string, commentId: string): Promise<FlowApiResult<FlowReply[]>> {
  /** 받은 대댓글. */
  const replies: FlowReply[] = [];
  /** 쪽을 넘긴 결과. */
  const walk = await walkPages(
    (cursor) => api.listReplies(postId, commentId, cursor),
    (page) => {
      replies.push(...page.replies);
      return true;
    },
  );
  return walk.ok ? { ok: true, value: replies } : walk;
}

/** 사람이 쓴 글인지 본다. 시스템 댓글(제목 변경, 업무 상태 변경 등)은 행동한 사람 명의로 와서 사람의 글과 섞이므로 뺀다. */
function isHumanRemark(remark: FlowRemarkAuthorship): boolean {
  return remark.systemCode === '';
}

/** 댓글이나 대댓글을 맥락의 글로 바꾼다. 멘션 표시는 `markContextMentions`가 한다. */
function remarkOf(id: string, remark: FlowRemarkAuthorship & { contents: string; attachments: string[] }): ContextRemark {
  return {
    id,
    authorId: remark.registerId,
    authorName: remark.registerName,
    registeredDateTime: remark.registeredDateTime,
    contents: remark.contents,
    attachments: [...remark.attachments],
    mention: false,
  };
}

/** 글을 쓴 시각, 같으면 ID 크기로 비교하는 함수. 시각이 없는 글은 ID로만 비교한다. 맥락의 댓글과 대댓글이 이 순서다. */
export function compareRemarks<T extends Pick<FlowRemarkAuthorship, 'registeredDateTime'>>(idOf: (remark: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    if (a.registeredDateTime && b.registeredDateTime && a.registeredDateTime !== b.registeredDateTime) {
      return a.registeredDateTime < b.registeredDateTime ? -1 : 1;
    }
    return compareAlarmIds(idOf(a), idOf(b));
  };
}

/** 맥락 문서에서 길이 상한 때문에 뺀 것. */
export interface ContextOmissions {
  /** 뺀 다른 댓글의 대댓글 수. 그 댓글까지 뺐어도 센다. */
  otherReplies: number;
  /** 뺀 다른 댓글 수. */
  otherComments: number;
  /** 댓글 스레드 묶음에서 게시물 본문을 앞 10,000자만 남기고 잘랐는지 여부. */
  postBodyTruncated: boolean;
  /** 뺀 대상 댓글 스레드의 대댓글 수. 멘션이 아닌 대댓글만 뺀다. */
  threadReplies: number;
}

/** 에이전트에게 넘길 맥락 문서. */
export interface ContextDocument {
  /** 문서. 멘션 표기는 이름 표기(`@이름`)이고 Flow 사용자 ID가 없다. */
  text: string;
  /** 길이 상한 때문에 뺀 것. */
  omissions: ContextOmissions;
}

/** 뺀 항목 수. 실행 기록에 남긴다. 본문을 자른 것은 한 항목으로 센다. */
export function omittedItemCount(omissions: ContextOmissions): number {
  return omissions.otherReplies + omissions.otherComments + omissions.threadReplies + (omissions.postBodyTruncated ? 1 : 0);
}

/**
 * 맥락을 에이전트에게 넘길 한 문서로 쓴다. 멘션 표기 `@[이름](ID)`는 `@이름`으로 바꾸고 첨부는 파일 이름만 쓴다.
 * 30,000자를 넘으면 다른 댓글의 대댓글(오래된 댓글부터) → 다른 댓글(오래된 것부터) → 게시물 본문(댓글 스레드 묶음에서만 앞 10,000자)
 * → 대상 댓글 스레드의 멘션이 아닌 대댓글(오래된 것부터) 순서로, 상한 안에 들어올 때까지 하나씩 빼고 뺀 자리에 생략 표시를 넣는다.
 * 게시물 제목, 묶음의 멘션 전부(본문 묶음이면 본문 전체), 머리 댓글은 빼지 않는다. 그것만으로 넘치면 그대로 둔다.
 */
export function contextDocument(context: BundleContext): ContextDocument {
  /** 지금까지 뺀 것. 하나씩 늘려 가며 다시 쓴다. */
  const cut: Cut = { otherRepliesOf: new Set(), otherComments: 0, postBodyTruncated: false, threadReplies: new Set() };
  /** 지금 뺀 것으로 쓴 문서가 상한 안인지 본다. */
  const fits = () => charCount(writeDocument(context, cut)) <= CONTEXT_CHAR_LIMIT;

  // 단계마다 하나씩 빼고 다시 재서, 꼭 필요한 만큼만 뺀다.
  /** 빼는 일을 차례로 늘어놓은 것. 하나를 한 뒤에 들어오면 멈춘다. */
  const steps: (() => void)[] = [
    ...context.otherComments.flatMap((comment, index) => (comment.replies.length > 0 ? [() => cut.otherRepliesOf.add(index)] : [])),
    ...context.otherComments.map((_, index) => () => {
      cut.otherComments = index + 1;
    }),
    ...(!context.post.mention && charCount(namedMentionText(context.post.contents)) > TRUNCATED_BODY_CHARS ? [() => (cut.postBodyTruncated = true)] : []),
    ...(context.targetThread?.replies ?? []).flatMap((reply, index) => (reply.mention ? [] : [() => cut.threadReplies.add(index)])),
  ];
  for (const step of steps) {
    if (fits()) break;
    step();
  }

  return {
    text: writeDocument(context, cut),
    omissions: {
      otherReplies: [...cut.otherRepliesOf].reduce((sum, index) => sum + (context.otherComments[index]?.replies.length ?? 0), 0),
      otherComments: cut.otherComments,
      postBodyTruncated: cut.postBodyTruncated,
      threadReplies: cut.threadReplies.size,
    },
  };
}

/** 맥락 문서에서 뺀 것. 문서를 쓸 때 이 자리에 생략 표시를 넣는다. */
interface Cut {
  /** 대댓글을 뺀 다른 댓글의 위치. */
  otherRepliesOf: Set<number>;
  /** 앞에서부터(오래된 것부터) 뺀 다른 댓글 수. */
  otherComments: number;
  /** 게시물 본문을 잘랐는지 여부. */
  postBodyTruncated: boolean;
  /** 뺀 대상 댓글 스레드 대댓글의 위치. */
  threadReplies: Set<number>;
}

/** 맥락과 뺀 것으로 문서를 쓴다. */
function writeDocument(context: BundleContext, cut: Cut): string {
  /** 게시물, 대상 댓글 스레드, 다른 댓글. */
  const { post, targetThread, otherComments } = context;
  // 표기를 바꾼 뒤에 자른다. 원문을 자르면 자른 자리에 걸린 표기가 바뀌지 않아 사용자 ID 일부가 남는다.
  /** 이름 표기로 바꾼 게시물 본문. 잘랐으면 앞 10,000자와 생략 표시다. */
  const named = namedMentionText(post.contents);
  /** 문서에 쓸 본문. */
  const body = cut.postBodyTruncated ? `${[...named].slice(0, TRUNCATED_BODY_CHARS).join('')}\n[본문 뒷부분 생략]` : named;
  /** 문서의 줄. */
  const lines = [
    '# 게시물',
    `제목: ${post.title}`,
    `작성: ${byline(post)}`,
    ...attachmentLines(post.attachments, ''),
    '',
    ...body.split('\n'),
  ];
  if (targetThread) {
    lines.push('', '# 대상 댓글 스레드', ...commentLines(targetThread, cut.threadReplies));
  }
  if (otherComments.length > 0) {
    lines.push('', '# 다른 댓글');
    if (cut.otherComments > 0) lines.push(`[다른 댓글 ${cut.otherComments}개 생략]`);
    otherComments.forEach((comment, index) => {
      if (index < cut.otherComments) return;
      lines.push(...commentLines(comment, cut.otherRepliesOf.has(index) ? new Set(comment.replies.keys()) : new Set()));
    });
  }
  return lines.join('\n');
}

/** 댓글 하나와 그 대댓글의 줄. `dropped` 위치의 대댓글은 빼고, 이어서 뺀 대댓글마다 생략 표시 하나를 넣는다. */
function commentLines(comment: ContextComment, dropped: ReadonlySet<number>): string[] {
  /** 쓴 줄. */
  const lines = remarkLines(comment, '');
  /** 아직 생략 표시를 넣지 않은, 이어서 뺀 대댓글 수. */
  let skipped = 0;
  /** 이어서 뺀 대댓글의 생략 표시를 넣는다. */
  const flush = () => {
    if (skipped > 0) lines.push(`  [대댓글 ${skipped}개 생략]`);
    skipped = 0;
  };
  comment.replies.forEach((reply, index) => {
    if (dropped.has(index)) {
      skipped += 1;
      return;
    }
    flush();
    lines.push(...remarkLines(reply, '  '));
  });
  flush();
  return lines;
}

/** 댓글이나 대댓글 하나의 줄. 머리 줄 아래에 글과 첨부를 두 칸 들여 쓴다. */
function remarkLines(remark: ContextRemark, indent: string): string[] {
  return [
    `${indent}- ${byline(remark)}`,
    ...namedMentionText(remark.contents)
      .split('\n')
      .map((line) => `${indent}  ${line}`),
    ...attachmentLines(remark.attachments, `${indent}  `),
  ];
}

/** 쓴 사람·시각 줄. 묶음의 멘션이면 "[멘션]"을 붙인다. */
function byline({ authorName, registeredDateTime, mention }: ContextWriting): string {
  /** 읽을 수 있게 바꾼 시각. */
  const time = readableFlowTime(registeredDateTime);
  return `${authorName || '이름 없음'}${time ? ` · ${time}` : ''}${mention ? ' [멘션]' : ''}`;
}

/** 첨부 줄. 파일 이름만 쓴다. 첨부가 없으면 줄이 없다. */
function attachmentLines(attachments: readonly string[], indent: string): string[] {
  return attachments.length > 0 ? [`${indent}첨부 있음(${attachments.join(', ')})`] : [];
}

/** 글자 수. 이모지처럼 두 단위로 된 글자도 한 글자로 센다. */
function charCount(text: string): number {
  return [...text].length;
}
