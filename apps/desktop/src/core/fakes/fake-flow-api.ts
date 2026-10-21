import type {
  FlowAlarm,
  FlowAlarmPage,
  FlowApi,
  FlowApiFailure,
  FlowApiResult,
  FlowCommentPage,
  FlowCreatedComment,
  FlowCreatedReply,
  FlowEmployee,
  FlowPost,
  FlowProject,
  FlowRemarkAuthorship,
  FlowReply,
  FlowReplyPage,
} from '../ports/flow-api';

/** 가짜 Flow API가 기본으로 쓰는 키 소유자. 실제 사람이나 회사가 아니다. */
export const FAKE_ME: FlowEmployee = {
  userId: 'me@example.test',
  name: '테스트 사용자',
  division: '테스트 팀',
  email: 'me@example.test',
};

/** 댓글과 함께 주는 대댓글 수. Flow의 `replyYn=Y`와 같다. */
const REPLIES_WITH_COMMENT = 10;

/** 가짜 Flow API가 들고 있는 게시물. 제목·"Flow에서 열기" 주소·작성자·첨부는 주지 않으면 비어 있다. */
export type FakeFlowPost = Pick<FlowPost, 'postId' | 'textComponents'> &
  Partial<Pick<FlowPost, 'title' | 'connectUrl' | 'registerId' | 'registerName' | 'registeredDateTime' | 'attachments'>>;

/** 가짜 Flow API가 들고 있는 대댓글. 쓴 사람·시각·시스템 댓글 종류·첨부는 주지 않으면 비어 있다. */
export type FakeFlowCommentReply = Pick<FlowReply, 'replyId' | 'contents'> & Partial<FlowRemarkAuthorship> & { attachments?: string[] };

/** 가짜 Flow API가 들고 있는 댓글. 대댓글은 모두 들고 있다가 Flow처럼 처음 10개만 댓글과 함께 준다. */
export interface FakeFlowComment extends Partial<FlowRemarkAuthorship> {
  /** 댓글 ID. */
  commentId: string;
  /** 글. */
  contents: string;
  /** 첨부 파일 이름. */
  attachments?: string[];
  /** 대댓글 전부. `replyId` 오름차순으로 둔다. */
  replies?: FakeFlowCommentReply[];
}

/** 게시로 받은 글 하나. */
export interface FakeFlowWrite {
  /** 받은 요청(`메서드 경로`). */
  request: string;
  /** 받은 `contents`. 게시 본문 그대로다. */
  contents: string;
}

/** 대본으로 정한 실패 하나. */
interface ScriptedFailure {
  /** 실패시킬 요청의 경로(`?` 앞). */
  path: string;
  /** 돌려줄 실패. */
  failure: FlowApiFailure;
  /** 남은 횟수. */
  remaining: number;
  /** 요청을 처리한(글을 단) 뒤에 실패를 돌려주는지 여부. 응답만 잃은 경우다. */
  afterProcessing: boolean;
}

/**
 * 메모리 안의 알림·게시물·댓글·대댓글로 응답하는 Flow API.
 * 목록은 Flow처럼 커서(앞에서부터 센 위치)로 나눠 준다. 응답 코드는 대본으로 바꿀 수 있고, 받은 요청은 `requests`에 남는다.
 * 게시로 받은 글은 `writes`에 남기고, 키 소유자(`FAKE_ME`)가 쓴 댓글·대댓글로 목록에도 넣는다.
 */
export class FakeFlowApi implements FlowApi {
  /** 받은 요청을 `메서드 경로` 형식으로 받은 순서대로 쌓는다. */
  readonly requests: string[] = [];
  /** 게시로 받은 글. 받은 순서다. */
  readonly writes: FakeFlowWrite[] = [];
  /** 게시로 단 글의 쓴 시각(Flow 형식). 쓰기 응답에는 시각이 없고 목록에만 보인다. */
  writtenDateTime = '';
  /** 알림 목록 한 쪽의 크기. */
  alarmPageSize = 20;
  /** 댓글 목록 한 쪽의 크기. */
  commentPageSize = 100;
  /** 대댓글 목록 한 쪽의 크기. */
  replyPageSize = 20;
  /** `getMe`가 돌려줄 응답. */
  private meResult: FlowApiResult<FlowEmployee> = { ok: true, value: FAKE_ME };
  /** `listParticipantProjects`가 돌려줄 응답. */
  private projectsResult: FlowApiResult<FlowProject[]> = { ok: true, value: [] };
  /** 알림 목록. Flow처럼 최신 알림이 앞이다. */
  private alarms: FlowAlarm[] = [];
  /** 게시물. */
  private readonly posts = new Map<string, FlowPost>();
  /** 게시물마다 댓글. */
  private readonly comments = new Map<string, FakeFlowComment[]>();
  /** 대본으로 정한 실패. */
  private failures: ScriptedFailure[] = [];
  /** 요청을 받을 때 응답하기 전에 할 일. 요청 문자열마다 한 번씩 한다. */
  private readonly hooks = new Map<string, () => void>();
  /** 경로마다 응답을 붙잡아 둔 문. 문이 열릴 때까지 그 경로의 요청은 응답하지 않는다. */
  private readonly gates = new Map<string, Promise<void>>();
  /** 게시로 다음에 만들 글의 ID. */
  private nextWrittenId = 950_000_001;

  /** `getMe`가 앞으로 돌려줄 응답을 바꾼다. */
  respondToGetMe(result: FlowApiResult<FlowEmployee>): void {
    this.meResult = result;
  }

  /** `listParticipantProjects`가 앞으로 돌려줄 응답을 바꾼다. */
  respondToListParticipantProjects(result: FlowApiResult<FlowProject[]>): void {
    this.projectsResult = result;
  }

  /**
   * 알림 목록 응답을 바꾼다. 알림 배열(최신이 앞)을 주면 그 목록으로 쪽을 나눠 답한다.
   * 실패를 주면 바꿀 때까지 알림 목록 조회가 그 실패로 끝난다.
   */
  respondToListMentionAlarms(result: FlowApiResult<FlowAlarmPage> | FlowAlarm[]): void {
    this.failures = this.failures.filter((scripted) => scripted.path !== 'GET /user/alarms');
    if (Array.isArray(result)) this.alarms = [...result];
    else if (result.ok) this.alarms = [...result.value.alarms];
    else this.failOn('GET /user/alarms', result.failure);
  }

  /** 새 알림이 왔다. 알림 목록 맨 앞에 둔다. */
  addAlarm(alarm: FlowAlarm): void {
    this.alarms.unshift(alarm);
  }

  /** 게시물을 둔다. 두지 않은 게시물은 지워진 것으로 보고 `404`로 답한다. */
  addPost({ title = '', connectUrl = null, registerId = '', registerName = '', registeredDateTime = '', attachments = [], ...post }: FakeFlowPost): void {
    this.posts.set(post.postId, { ...post, title, connectUrl, registerId, registerName, registeredDateTime, attachments });
  }

  /** 게시물에 댓글을 단다. 댓글은 단 순서대로 온다. */
  addComment(postId: string, comment: FakeFlowComment): void {
    this.comments.set(postId, [...(this.comments.get(postId) ?? []), comment]);
  }

  /** 게시물을 지운다. 그 뒤 게시물과 댓글 조회는 `404`다. */
  removePost(postId: string): void {
    this.posts.delete(postId);
  }

  /** 게시물 본문의 글 조각을 바꾼다(수정). */
  editPost(postId: string, textComponents: FlowPost['textComponents']): void {
    /** 고칠 게시물. */
    const post = this.posts.get(postId);
    if (!post) throw new Error(`가짜 게시물 ${postId}가 없습니다.`);
    post.textComponents = structuredClone(textComponents);
  }

  /** 게시물의 댓글을 지운다. 대댓글도 함께 사라진다. */
  removeComment(postId: string, commentId: string): void {
    this.comments.set(postId, (this.comments.get(postId) ?? []).filter((comment) => comment.commentId !== commentId));
  }

  /** 댓글의 글을 바꾼다(수정). */
  editComment(postId: string, commentId: string, contents: string): void {
    this.commentOf(postId, commentId).contents = contents;
  }

  /** 대댓글의 글을 바꾼다(수정). */
  editReply(postId: string, commentId: string, replyId: string, contents: string): void {
    /** 고칠 대댓글. */
    const reply = this.commentOf(postId, commentId).replies?.find((item) => item.replyId === replyId);
    if (!reply) throw new Error(`가짜 대댓글 ${replyId}가 없습니다.`);
    reply.contents = contents;
  }

  /** 대댓글을 지운다. */
  removeReply(postId: string, commentId: string, replyId: string): void {
    /** 부모 댓글. */
    const comment = this.commentOf(postId, commentId);
    comment.replies = (comment.replies ?? []).filter((reply) => reply.replyId !== replyId);
  }

  /** 게시물의 댓글 하나. 없으면 던진다. */
  private commentOf(postId: string, commentId: string): FakeFlowComment {
    /** 찾은 댓글. */
    const comment = this.comments.get(postId)?.find((item) => item.commentId === commentId);
    if (!comment) throw new Error(`가짜 댓글 ${commentId}가 없습니다.`);
    return comment;
  }

  /** 댓글에 대댓글을 단다. 대댓글은 단 순서대로 온다. */
  addReply(postId: string, commentId: string, reply: FakeFlowCommentReply): void {
    /** 부모 댓글. */
    const comment = this.commentOf(postId, commentId);
    comment.replies = [...(comment.replies ?? []), reply];
  }

  /** `path`(`메서드 경로`, `?` 앞까지)로 오는 요청을 `times`번 `failure`로 실패시킨다. */
  failOn(path: string, failure: FlowApiFailure, times = Number.POSITIVE_INFINITY): void {
    this.failures.push({ path, failure, remaining: times, afterProcessing: false });
  }

  /**
   * `path`로 오는 요청을 `times`번 처리한 뒤(게시면 글을 단 뒤) 응답 대신 `failure`를 돌려준다.
   * Flow에는 올라갔지만 응답을 받지 못한 경우(연결 끊김, 응답 전 `5xx`)를 만든다.
   */
  loseResponseOn(path: string, failure: FlowApiFailure, times = 1): void {
    this.failures.push({ path, failure, remaining: times, afterProcessing: true });
  }

  /** `request`(요청 문자열 전체)가 오면 응답하기 전에 `action`을 한 번 한다. 쪽을 넘기는 사이에 새 알림이 오는 경우를 만든다. */
  whenRequested(request: string, action: () => void): void {
    this.hooks.set(request, action);
  }

  /**
   * `path`(`메서드 경로`, `?` 앞까지)로 오는 요청의 응답을 돌려준 함수를 부를 때까지 붙잡아 둔다. 요청은 받은 때 `requests`에 남는다.
   * Flow가 늦게 답하는 경우를 만든다. 응답은 풀어 준 때의 내용으로 한다.
   */
  hold(path: string): () => void {
    /** 문을 연다. */
    let release!: () => void;
    this.gates.set(path, new Promise<void>((resolve) => (release = resolve)));
    return () => {
      this.gates.delete(path);
      release();
    };
  }

  async getMe(): Promise<FlowApiResult<FlowEmployee>> {
    this.requests.push('GET /user/employees/me');
    return this.meResult;
  }

  async listParticipantProjects(): Promise<FlowApiResult<FlowProject[]>> {
    this.requests.push('GET /user/projects/participants');
    return this.projectsResult;
  }

  async listMentionAlarms(cursor: string | null): Promise<FlowApiResult<FlowAlarmPage>> {
    return this.answer('GET /user/alarms', cursor, () => {
      /** 이 쪽. */
      const page = pageOf(this.alarms, cursor, this.alarmPageSize);
      return { alarms: page.items, nextCursor: page.nextCursor };
    });
  }

  async getPost(postId: string): Promise<FlowApiResult<FlowPost>> {
    return this.answer(`GET /user/posts/${postId}`, null, () => {
      /** 조회한 게시물. */
      const post = this.posts.get(postId);
      return post ? structuredClone(post) : NOT_FOUND;
    });
  }

  async listComments(postId: string, cursor: string | null): Promise<FlowApiResult<FlowCommentPage>> {
    return this.answer(`GET /user/comments/${postId}`, cursor, () => {
      if (!this.posts.has(postId)) return NOT_FOUND;
      /** 이 쪽. */
      const page = pageOf(this.comments.get(postId) ?? [], cursor, this.commentPageSize);
      return {
        comments: page.items.map(({ commentId, contents, replies = [], attachments = [], ...authorship }) => ({
          commentId,
          contents,
          ...authorshipOf(authorship),
          attachments: [...attachments],
          replies: replies.slice(0, REPLIES_WITH_COMMENT).map(replyOf),
          replyHasNext: replies.length > REPLIES_WITH_COMMENT,
        })),
        nextCursor: page.nextCursor,
      };
    });
  }

  async listReplies(postId: string, commentId: string, cursor: string | null): Promise<FlowApiResult<FlowReplyPage>> {
    return this.answer(`GET /user/comments/${postId}/replies/${commentId}`, cursor, () => {
      /** 부모 댓글. */
      const comment = this.posts.has(postId) ? this.comments.get(postId)?.find((item) => item.commentId === commentId) : undefined;
      if (!comment) return NOT_FOUND;
      /** 이 쪽. */
      const page = pageOf(comment.replies ?? [], cursor, this.replyPageSize);
      return { replies: page.items.map(replyOf), nextCursor: page.nextCursor };
    });
  }

  async createComment(postId: string, contents: string): Promise<FlowApiResult<FlowCreatedComment>> {
    return this.answer(`POST /user/comments/${postId}`, null, () => {
      if (!this.posts.has(postId)) return NOT_FOUND;
      /** 만든 댓글의 ID. */
      const commentId = this.writeOf(`POST /user/comments/${postId}`, contents);
      this.addComment(postId, { commentId, contents, ...this.writtenAuthorship() });
      return { commentId };
    });
  }

  async createReply(postId: string, commentId: string, contents: string): Promise<FlowApiResult<FlowCreatedReply>> {
    return this.answer(`POST /user/comments/${postId}/replies/${commentId}`, null, () => {
      /** 부모 댓글. */
      const comment = this.posts.has(postId) ? this.comments.get(postId)?.find((item) => item.commentId === commentId) : undefined;
      if (!comment) return NOT_FOUND;
      /** 만든 대댓글의 ID. */
      const replyId = this.writeOf(`POST /user/comments/${postId}/replies/${commentId}`, contents);
      this.addReply(postId, commentId, { replyId, contents, ...this.writtenAuthorship() });
      return { commentId, replyId };
    });
  }

  /** 게시로 받은 글을 남기고 새 글 ID를 돌려준다. */
  private writeOf(request: string, contents: string): string {
    this.writes.push({ request, contents });
    return String(this.nextWrittenId++);
  }

  /** 게시로 단 글을 쓴 사람(키 소유자)과 시각. */
  private writtenAuthorship(): FlowRemarkAuthorship {
    return { registerId: FAKE_ME.userId, registerName: FAKE_ME.name, registeredDateTime: this.writtenDateTime, systemCode: '' };
  }

  /** 요청을 남기고, 대본의 실패가 있으면 그 실패를, 없으면 `respond`의 값으로 답한다. 붙잡아 둔 경로면 풀어 줄 때까지 기다린다. */
  private async answer<T>(path: string, cursor: string | null, respond: () => T | typeof NOT_FOUND): Promise<FlowApiResult<T>> {
    /** 남길 요청 문자열. */
    const request = cursor === null ? path : `${path}?cursor=${cursor}`;
    this.requests.push(request);
    /** 응답하기 전에 할 일. */
    const hook = this.hooks.get(request);
    if (hook) {
      this.hooks.delete(request);
      hook();
    }
    await this.gates.get(path);

    /** 이 요청에 걸린 실패. */
    const scripted = this.failures.find((failure) => failure.path === path && failure.remaining > 0);
    if (scripted) scripted.remaining -= 1;
    if (scripted && !scripted.afterProcessing) return { ok: false, failure: scripted.failure };
    /** 대본이 없을 때의 응답. */
    const value = respond();
    if (scripted) return { ok: false, failure: scripted.failure };
    return value === NOT_FOUND ? { ok: false, failure: { kind: 'http', status: 404 } } : { ok: true, value };
  }
}

/** 주지 않은 쓴 사람·시각·시스템 댓글 종류를 빈 값으로 채운다. */
function authorshipOf({
  registerId = '',
  registerName = '',
  registeredDateTime = '',
  systemCode = '',
}: Partial<FlowRemarkAuthorship>): FlowRemarkAuthorship {
  return { registerId, registerName, registeredDateTime, systemCode };
}

/** 응답으로 줄 대댓글. */
function replyOf({ replyId, contents, attachments = [], ...authorship }: FakeFlowCommentReply): FlowReply {
  return { replyId, contents, ...authorshipOf(authorship), attachments: [...attachments] };
}

/** 없는 글을 조회했다는 표시. */
const NOT_FOUND = Symbol('not-found');

/** 목록에서 `cursor`(앞에서부터 센 위치) 뒤의 한 쪽을 자른다. */
function pageOf<T>(items: readonly T[], cursor: string | null, size: number): { items: T[]; nextCursor: string | null } {
  /** 이 쪽의 시작 위치. */
  const start = cursor === null ? 0 : Number(cursor);
  /** 다음 쪽의 시작 위치. */
  const end = start + size;
  return { items: items.slice(start, end), nextCursor: end < items.length ? String(end) : null };
}
