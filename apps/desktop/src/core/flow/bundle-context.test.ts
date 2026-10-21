import { describe, expect, it } from 'vitest';
import type { BundledMention, MentionBundle } from '../bundles/mention-bundle';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import {
  CONTEXT_CHAR_LIMIT,
  collectBundleContext,
  contextDocument,
  omittedItemCount,
  type BundleContext,
  type ContextComment,
  type ContextRemark,
} from './bundle-context';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시. */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 나(키 소유자)의 사용자 ID. */
const ME = FAKE_ME.userId;
/** 송신자. 실제 사람이 아니다. */
const SENDER = 'sender@example.test';
/** 멘션이 온 게시물. */
const POST_ID = '90000011';
/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${ME})`;

/** 묶음에 든 멘션. 기본은 08:50에 온 본문 멘션이다. */
function mention(overrides: Partial<BundledMention> = {}): BundledMention {
  return {
    postId: POST_ID,
    remarkId: '-1',
    replyId: '-1',
    projectId: '900001',
    alarmId: '101',
    senderId: SENDER,
    senderName: '보낸 사람',
    registeredDateTime: '20261020085000',
    detectedAt: NOW,
    text: '',
    answered: false,
    ...overrides,
  };
}

/** 맥락을 모을 묶음 자리와 멘션. */
function bundle(remarkId: string, mentions: BundledMention[]): Pick<MentionBundle, 'postId' | 'remarkId' | 'mentions'> {
  return { postId: POST_ID, remarkId, mentions };
}

/** `n`부터 `count`개의 댓글 ID. 오래된 것부터다. */
function ids(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, index) => String(900000100 + from + index));
}

/** 분 단위로 나아가는 Flow 시각. `minute`은 2026-10-20 08:00부터 센 분이다. */
function at(minute: number): string {
  return `20261020${String(8 + Math.floor(minute / 60)).padStart(2, '0')}${String(minute % 60).padStart(2, '0')}00`;
}

describe('맥락 수집: 본문 묶음', () => {
  it('게시물 제목과 TEXT 컴포넌트의 본문, 첨부 파일 이름을 담고, 다른 댓글은 시스템 댓글을 빼고 세어 최근 20개를 대댓글 처음 10개와 함께 담는다', async () => {
    const flow = new FakeFlowApi();
    flow.addPost({
      postId: POST_ID,
      title: '재시도 정책',
      registerId: SENDER,
      registerName: '보낸 사람',
      registeredDateTime: '20261020085000',
      textComponents: [
        { contents: `${MY_MARKUP} 재시도는 몇 번인가요?`, mentions: [ME] },
        { contents: '둘째 문단', mentions: [] },
      ],
      attachments: ['설계서.pdf'],
    });
    // 오래된 댓글 3개, 시스템 댓글 2개, 최근 댓글 20개 순서로 단다. 시스템 댓글은 맥락에도 20개에도 들지 않는다.
    for (const [index, commentId] of ids(0, 3).entries()) {
      flow.addComment(POST_ID, { commentId, contents: `오래된 댓글 ${index}`, registerName: '동료', registeredDateTime: at(index) });
    }
    flow.addComment(POST_ID, { commentId: '900000200', contents: '제목 변경', systemCode: 'A00^^', registeredDateTime: at(5) });
    for (const [index, commentId] of ids(10, 20).entries()) {
      flow.addComment(POST_ID, { commentId, contents: `최근 댓글 ${index}`, registerName: '동료', registeredDateTime: at(10 + index) });
    }
    flow.addComment(POST_ID, { commentId: '900000201', contents: '상태 변경', systemCode: 'S13', registeredDateTime: at(40) });
    // 마지막 사람 댓글에는 대댓글 12개(하나는 시스템 댓글)와 첨부가 있다.
    const lastId = ids(10, 20).at(-1)!;
    for (let index = 0; index < 12; index += 1) {
      flow.addReply(POST_ID, lastId, {
        replyId: String(9000100 + index),
        contents: `대댓글 ${index}`,
        registerId: 'colleague@example.test',
        registerName: '동료',
        registeredDateTime: at(41 + index),
        systemCode: index === 0 ? 'A00^^' : '',
        attachments: index === 1 ? ['로그.txt'] : [],
      });
    }

    const result = await collectBundleContext(flow, bundle('-1', [mention()]), NOW, [ME]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { context } = result;
    expect(context.fetchedAt).toBe(NOW);
    expect(context.post).toEqual({
      title: '재시도 정책',
      authorId: SENDER,
      authorName: '보낸 사람',
      registeredDateTime: '20261020085000',
      contents: `${MY_MARKUP} 재시도는 몇 번인가요?\n둘째 문단`,
      attachments: ['설계서.pdf'],
      mention: true,
    });
    expect(context.targetThread).toBeNull();
    expect(context.otherComments.map((comment) => comment.contents)).toEqual(Array.from({ length: 20 }, (_, index) => `최근 댓글 ${index}`));
    /** 대댓글이 있는 마지막 댓글. */
    const last = context.otherComments.at(-1)!;
    // 댓글과 함께 받은 처음 10개 가운데 시스템 댓글을 뺀 9개다. 대댓글 목록 API는 부르지 않는다.
    expect(last.replies.map((reply) => reply.contents)).toEqual(Array.from({ length: 9 }, (_, index) => `대댓글 ${index + 1}`));
    expect(last.replies[0]).toEqual({
      id: '9000101',
      authorId: 'colleague@example.test',
      authorName: '동료',
      registeredDateTime: at(42),
      contents: '대댓글 1',
      attachments: ['로그.txt'],
      mention: false,
    });
    expect(flow.requests.filter((request) => request.includes('/replies/'))).toEqual([]);
  });
});

describe('맥락 수집: 댓글 스레드 묶음', () => {
  /** 머리 댓글(멘션)에 대댓글 25개가 달린 댓글 스레드와, 그 앞뒤의 다른 댓글. 대댓글 목록 한 쪽은 7개다. */
  function threadFlow() {
    const flow = new FakeFlowApi();
    flow.replyPageSize = 7;
    flow.addPost({ postId: POST_ID, title: '오류 문의', textComponents: [{ contents: '본문', mentions: [] }] });
    flow.addComment(POST_ID, { commentId: '900000101', contents: '앞선 다른 댓글', registeredDateTime: at(1) });
    flow.addComment(POST_ID, { commentId: '900000102', contents: `${MY_MARKUP} 왜 실패하나요?`, registerId: SENDER, registerName: '보낸 사람', registeredDateTime: at(2) });
    flow.addComment(POST_ID, { commentId: '900000103', contents: '뒤의 다른 댓글', registeredDateTime: at(3) });
    for (let index = 0; index < 25; index += 1) {
      flow.addReply(POST_ID, '900000102', {
        replyId: String(9000200 + index),
        contents: index === 20 ? `${MY_MARKUP} 다시 확인 부탁` : `대댓글 ${index}`,
        registeredDateTime: at(4 + index),
        systemCode: index === 3 ? 'A00^^' : '',
      });
    }
    return flow;
  }

  it('머리 댓글부터 대댓글까지 전부를 대댓글 목록 API로 끝까지 넘겨 담고, 묶음의 멘션을 표시한다. 다른 댓글에는 대상 댓글 스레드가 없다', async () => {
    const flow = threadFlow();
    /** 머리 댓글 멘션과 스물한째 대댓글 멘션. */
    const mentions = [
      mention({ remarkId: '900000102', alarmId: '101', registeredDateTime: at(2) }),
      mention({ remarkId: '900000102', replyId: '9000220', alarmId: '102', registeredDateTime: at(24) }),
    ];

    const result = await collectBundleContext(flow, bundle('900000102', mentions), NOW, [ME]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const thread = result.context.targetThread!;
    expect(thread).toMatchObject({ id: '900000102', authorId: SENDER, authorName: '보낸 사람', mention: true });
    // 시스템 대댓글 하나를 뺀 24개다.
    expect(thread.replies).toHaveLength(24);
    expect(thread.replies.filter((reply) => reply.mention).map((reply) => reply.id)).toEqual(['9000220']);
    expect(result.context.post.mention).toBe(false);
    expect(result.context.otherComments.map((comment) => comment.id)).toEqual(['900000101', '900000103']);
    expect(flow.requests.filter((request) => request.includes('/replies/'))).toEqual([
      `GET /user/comments/${POST_ID}/replies/900000102`,
      `GET /user/comments/${POST_ID}/replies/900000102?cursor=7`,
      `GET /user/comments/${POST_ID}/replies/900000102?cursor=14`,
      `GET /user/comments/${POST_ID}/replies/900000102?cursor=21`,
    ]);
  });

  it('"이미 답함"으로 빠진 멘션은 멘션으로 표시하지 않는다', async () => {
    const flow = threadFlow();
    const mentions = [
      mention({ remarkId: '900000102', alarmId: '101', registeredDateTime: at(2), answered: true }),
      mention({ remarkId: '900000102', replyId: '9000220', alarmId: '102', registeredDateTime: at(24) }),
    ];

    const result = await collectBundleContext(flow, bundle('900000102', mentions), NOW, [ME]);

    expect(result.ok && result.context.targetThread?.mention).toBe(false);
  });

  it('머리 댓글이 목록에 없으면 대상 댓글 스레드가 사라졌다고, 조회가 실패하면 그 실패를 돌려준다', async () => {
    const flow = threadFlow();
    await expect(collectBundleContext(flow, bundle('900000999', [mention({ remarkId: '900000999' })]), NOW, [ME])).resolves.toEqual({
      ok: false,
      failure: { kind: 'thread-gone' },
    });

    flow.failOn(`GET /user/comments/${POST_ID}/replies/900000102`, { kind: 'network' }, 1);
    await expect(collectBundleContext(flow, bundle('900000102', [mention({ remarkId: '900000102' })]), NOW, [ME])).resolves.toEqual({
      ok: false,
      failure: { kind: 'network' },
    });

    await expect(collectBundleContext(new FakeFlowApi(), bundle('-1', [mention()]), NOW, [ME])).resolves.toEqual({
      ok: false,
      failure: { kind: 'http', status: 404 },
    });
  });
});

describe('맥락 수집: 같은 조회에서 찾는 내 답', () => {
  it('본문 묶음이면 게시물에 쓴 내 댓글을, 댓글 스레드 묶음이면 그 스레드의 내 대댓글을 돌려준다. 시스템 댓글과 다른 사람의 글은 내 답이 아니다', async () => {
    const flow = new FakeFlowApi();
    flow.addPost({ postId: POST_ID, title: '오류 문의', textComponents: [{ contents: '본문', mentions: [] }] });
    flow.addComment(POST_ID, { commentId: '900000101', contents: '내 댓글', registerId: ME, registeredDateTime: at(10) });
    flow.addComment(POST_ID, { commentId: '900000102', contents: '상태 변경', registerId: ME, systemCode: 'S13', registeredDateTime: at(11) });
    flow.addComment(POST_ID, { commentId: '900000103', contents: `${MY_MARKUP} 질문`, registerId: SENDER, registeredDateTime: at(12) });
    flow.addReply(POST_ID, '900000103', { replyId: '9000301', contents: '내 대댓글', registerId: ME, registeredDateTime: at(13) });
    flow.addReply(POST_ID, '900000103', { replyId: '9000302', contents: '동료 대댓글', registerId: SENDER, registeredDateTime: at(14) });

    /** 본문 묶음의 결과. */
    const post = await collectBundleContext(flow, bundle('-1', [mention()]), NOW, [ME]);
    /** 댓글 스레드 묶음의 결과. */
    const thread = await collectBundleContext(flow, bundle('900000103', [mention({ remarkId: '900000103' })]), NOW, [ME]);

    expect(post.ok && post.myAnswers).toEqual([{ answerId: '900000101', registeredDateTime: at(10) }]);
    expect(thread.ok && thread.myAnswers).toEqual([{ answerId: '9000301', registeredDateTime: at(13) }]);
  });
});

/** 맥락의 글 하나. 기본은 멘션이 아닌 짧은 글이다. */
function remark(id: string, contents: string, overrides: Partial<ContextRemark> = {}): ContextRemark {
  return { id, authorId: 'colleague@example.test', authorName: '동료', registeredDateTime: '20261020081000', contents, attachments: [], mention: false, ...overrides };
}

/** 맥락의 댓글 하나. */
function comment(id: string, contents: string, replies: ContextRemark[] = [], overrides: Partial<ContextRemark> = {}): ContextComment {
  return { ...remark(id, contents, overrides), replies };
}

/** 맥락. 기본은 짧은 본문의 본문 묶음이다. */
function context(overrides: Partial<BundleContext> = {}): BundleContext {
  return {
    fetchedAt: NOW,
    post: {
      title: '재시도 정책',
      authorId: SENDER,
      authorName: '보낸 사람',
      registeredDateTime: '20261020085000',
      contents: '본문',
      attachments: [],
      mention: true,
    },
    targetThread: null,
    otherComments: [],
    ...overrides,
  };
}

/** `count`자짜리 글. 어느 글인지 알아보게 `label`로 시작한다. */
function filler(label: string, count: number): string {
  return `${label}:`.padEnd(count, '가');
}

describe('맥락 문서', () => {
  it('제목·본문·첨부·대상 댓글 스레드·다른 댓글을 한 문서로 쓰고, @[이름](ID) 표기를 이름 표기로 바꿔 Flow 사용자 ID를 넣지 않는다', () => {
    const document = contextDocument(
      context({
        post: {
          title: '오류 문의',
          authorId: SENDER,
          authorName: '보낸 사람',
          registeredDateTime: '20261020080000',
          contents: `배포 뒤 오류가 납니다.\n@[다른 동료](other@example.test) 참고`,
          attachments: ['오류.log', '설계서.pdf'],
          mention: false,
        },
        targetThread: comment(
          '900000102',
          `${MY_MARKUP} 왜 실패하나요?`,
          [
            remark('9000201', '저도 봤습니다.', { registeredDateTime: '20261020082000' }),
            remark('9000202', `${MY_MARKUP} 확인 부탁\n급합니다`, {
              authorName: '보낸 사람',
              registeredDateTime: '20261020083000',
              mention: true,
              attachments: ['화면 녹화.mov'],
            }),
          ],
          { authorName: '보낸 사람', registeredDateTime: '20261020081500', mention: true },
        ),
        otherComments: [comment('900000101', '다른 이야기', [remark('9000101', '대댓글', { authorName: '' })])],
      }),
    );

    expect(document.text).toBe(
      [
        '# 게시물',
        '제목: 오류 문의',
        '작성: 보낸 사람 · 2026-10-20 08:00',
        '첨부 있음(오류.log, 설계서.pdf)',
        '',
        '배포 뒤 오류가 납니다.',
        '@다른 동료 참고',
        '',
        '# 대상 댓글 스레드',
        '- 보낸 사람 · 2026-10-20 08:15 [멘션]',
        '  @테스트 사용자 왜 실패하나요?',
        '  - 동료 · 2026-10-20 08:20',
        '    저도 봤습니다.',
        '  - 보낸 사람 · 2026-10-20 08:30 [멘션]',
        '    @테스트 사용자 확인 부탁',
        '    급합니다',
        '    첨부 있음(화면 녹화.mov)',
        '',
        '# 다른 댓글',
        '- 동료 · 2026-10-20 08:10',
        '  다른 이야기',
        '  - 이름 없음 · 2026-10-20 08:10',
        '    대댓글',
      ].join('\n'),
    );
    expect(document.text).not.toContain('@example.test');
    expect(document.omissions).toEqual({ otherReplies: 0, otherComments: 0, postBodyTruncated: false, threadReplies: 0 });
    expect(omittedItemCount(document.omissions)).toBe(0);
  });

  it('30,000자를 넘으면 먼저 다른 댓글의 대댓글을 오래된 댓글부터 빼고, 뺀 자리에 생략 표시를 넣는다', () => {
    /** 대댓글 3개(각 600자)가 달린 다른 댓글 20개. 대댓글만 36,000자다. */
    const others = Array.from({ length: 20 }, (_, index) =>
      comment(`c${index}`, `댓글 ${index}`, [0, 1, 2].map((reply) => remark(`r${index}-${reply}`, filler(`대댓글 ${index}-${reply}`, 600)))),
    );

    const document = contextDocument(context({ otherComments: others }));

    expect([...document.text].length).toBeLessThanOrEqual(CONTEXT_CHAR_LIMIT);
    /** 대댓글을 뺀 댓글 수. */
    const dropped = document.omissions.otherReplies / 3;
    expect(dropped).toBeGreaterThan(0);
    expect(document.omissions).toMatchObject({ otherComments: 0, postBodyTruncated: false, threadReplies: 0 });
    // 오래된 댓글의 대댓글부터 빠지고, 최근 댓글의 대댓글은 남는다.
    expect(document.text).not.toContain(`대댓글 ${dropped - 1}-0:`);
    expect(document.text).toContain(`대댓글 ${dropped}-0:`);
    expect(document.text.split('[대댓글 3개 생략]')).toHaveLength(dropped + 1);
    // 댓글 자체는 모두 남는다.
    for (let index = 0; index < 20; index += 1) expect(document.text).toContain(`댓글 ${index}\n`);
    expect(omittedItemCount(document.omissions)).toBe(dropped * 3);
  });

  it('대댓글을 모두 빼도 넘치면 다른 댓글을 오래된 것부터 빼고 "[다른 댓글 N개 생략]"을 넣는다', () => {
    /** 대댓글 1개가 달린 2,000자 댓글 20개. */
    const others = Array.from({ length: 20 }, (_, index) => comment(`c${index}`, filler(`댓글 ${index}`, 2_000), [remark(`r${index}`, '짧은 대댓글')]));

    const document = contextDocument(context({ otherComments: others }));

    expect([...document.text].length).toBeLessThanOrEqual(CONTEXT_CHAR_LIMIT);
    const { otherComments } = document.omissions;
    expect(otherComments).toBeGreaterThan(0);
    expect(document.omissions).toMatchObject({ otherReplies: 20, postBodyTruncated: false, threadReplies: 0 });
    expect(document.text).toContain(`# 다른 댓글\n[다른 댓글 ${otherComments}개 생략]\n`);
    expect(document.text).not.toContain(`댓글 ${otherComments - 1}:`);
    expect(document.text).toContain(`댓글 ${otherComments}:`);
    expect(document.text).not.toContain('짧은 대댓글');
  });

  it('그래도 넘치면 댓글 스레드 묶음에서만 게시물 본문을 앞 10,000자만 남기고 자른다', () => {
    /** 35,000자 본문. */
    const body = filler('본문', 35_000);
    const thread = comment('900000102', `${MY_MARKUP} 질문`, [], { mention: true });

    const document = contextDocument(
      context({ post: { ...context().post, contents: body, mention: false }, targetThread: thread, otherComments: [comment('c0', '다른 댓글')] }),
    );

    expect(document.omissions).toEqual({ otherReplies: 0, otherComments: 1, postBodyTruncated: true, threadReplies: 0 });
    expect(document.text).toContain(`${body.slice(0, 10_000)}\n[본문 뒷부분 생략]\n`);
    expect(document.text).not.toContain(body.slice(0, 10_001));
    expect(document.text).toContain('@테스트 사용자 질문');
    expect(omittedItemCount(document.omissions)).toBe(2);
  });

  it('본문을 자를 때는 멘션 표기를 이름 표기로 바꾼 뒤 잘라, 자른 자리에 걸린 표기에서도 사용자 ID가 들어가지 않는다', () => {
    /** 9,990자 뒤에 표기가 오는 35,000자 본문. 원문 그대로 자르면 10,000자 경계가 표기 한가운데에 걸린다. */
    const body = `${filler('본문', 9_990)}@[다른 동료](other@example.test)${filler('뒷부분', 25_000)}`;
    const thread = comment('900000102', `${MY_MARKUP} 질문`, [], { mention: true });

    const document = contextDocument(context({ post: { ...context().post, contents: body, mention: false }, targetThread: thread }));

    expect(document.omissions.postBodyTruncated).toBe(true);
    expect(document.text).not.toContain('example.test');
    // 바꾼 본문의 앞 10,000자는 9,990자, "@다른 동료" 6자, 뒷부분의 첫 4자다.
    expect(document.text).toContain(`${filler('본문', 9_990)}@다른 동료뒷부분:\n[본문 뒷부분 생략]`);
  });

  it('본문 묶음의 본문은 자르지 않고, 절대 빼지 않는 것만으로 넘치면 그대로 넘긴다', () => {
    /** 35,000자 본문. */
    const body = filler('본문', 35_000);

    const document = contextDocument(context({ post: { ...context().post, contents: body }, otherComments: [comment('c0', '다른 댓글')] }));

    expect(document.text).toContain(body);
    expect([...document.text].length).toBeGreaterThan(CONTEXT_CHAR_LIMIT);
    expect(document.omissions).toEqual({ otherReplies: 0, otherComments: 1, postBodyTruncated: false, threadReplies: 0 });
  });

  it('마지막으로 대상 댓글 스레드의 멘션이 아닌 대댓글을 오래된 것부터 빼고, 머리 댓글과 멘션은 남긴다', () => {
    /** 1,000자 대댓글 40개. 스물째는 멘션이다. */
    const replies = Array.from({ length: 40 }, (_, index) =>
      remark(`r${index}`, filler(`대댓글 ${index}`, 1_000), { mention: index === 20, authorName: index === 20 ? '보낸 사람' : '동료' }),
    );
    const thread = comment('900000102', filler('머리 댓글', 1_000), replies, { mention: false });

    const document = contextDocument(context({ post: { ...context().post, mention: false }, targetThread: thread }));

    expect([...document.text].length).toBeLessThanOrEqual(CONTEXT_CHAR_LIMIT);
    const { threadReplies } = document.omissions;
    expect(threadReplies).toBeGreaterThan(0);
    expect(document.text).toContain('머리 댓글:');
    expect(document.text).toContain('대댓글 20:');
    expect(document.text).toContain('대댓글 39:');
    // 멘션(스물째)보다 앞선 대댓글부터 빠진다. 멘션을 건너뛰고 이어 빼면 생략 표시가 멘션 앞뒤로 나뉜다.
    expect(document.text).not.toContain('대댓글 0:');
    if (threadReplies < 20) {
      expect(document.text).toContain(`  [대댓글 ${threadReplies}개 생략]\n  - 동료`);
    } else {
      expect(document.text).toContain('  [대댓글 20개 생략]\n  - 보낸 사람');
    }
  });
});
