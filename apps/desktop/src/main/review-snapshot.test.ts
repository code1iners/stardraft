import { describe, expect, it } from 'vitest';
import type { BundledMention, MentionBundle } from '../core/bundles/mention-bundle';
import type { BundleContext } from '../core/flow/bundle-context';
import { bundleSnapshot, flowUrlOf } from './review-snapshot';

/** 가짜 멘션. 실제 사람이나 글이 아니다. 기본은 08:50(한국 표준시)에 온 댓글 멘션이다. */
function mention(alarmId: string, overrides: Partial<BundledMention> = {}): BundledMention {
  return {
    postId: '90000011',
    remarkId: '700',
    replyId: '-1',
    projectId: '900001',
    alarmId,
    senderId: 'sender@example.test',
    senderName: '보낸 사람',
    registeredDateTime: '20261020085000',
    detectedAt: 1_000,
    text: '@[테스트 사용자](me@example.test) 질문',
    answered: false,
    ...overrides,
  };
}

/** 가짜 댓글 스레드 묶음. */
function bundle(overrides: Partial<MentionBundle> = {}): MentionBundle {
  return {
    id: 7,
    postId: '90000011',
    remarkId: '700',
    projectId: '900001',
    status: 'repo-check-needed',
    postTitle: '가짜 게시물',
    connectUrl: 'https://fake.flow.test/post/90000011',
    mentions: [mention('101')],
    answers: [],
    newMentionCount: 0,
    createdAt: 1_000,
    processedAt: null,
    context: null,
    ...overrides,
  };
}

/** 가짜 Flow 프로젝트 정보. */
const PROJECT = { title: '가짜 프로젝트', projectUrl: 'https://fake.flow.test/project/900001' };

describe('묶음 스냅숏', () => {
  it('묶음에 남은 멘션을 시간순으로, 멘션 표기는 이름만, 송신자는 중복 없이 넘기고 사용자 ID는 넘기지 않는다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({
        mentions: [
          mention('100', { answered: true, registeredDateTime: '20261020084000' }),
          mention('101'),
          mention('102', { replyId: '801', senderName: '다른 사람', senderId: 'other@example.test', registeredDateTime: '20261020085100' }),
          mention('103', { replyId: '802', registeredDateTime: '20261020085200' }),
        ],
        newMentionCount: 2,
        createdAt: Date.UTC(2026, 9, 20, 0, 0),
      }),
      () => PROJECT,
    );

    expect(snapshot).toEqual({
      id: 7,
      status: 'repo-check-needed',
      group: 'awaiting-review',
      place: 'thread',
      projectTitle: '가짜 프로젝트',
      postTitle: '가짜 게시물',
      mentions: [
        { senderName: '보낸 사람', place: 'comment', at: Date.UTC(2026, 9, 19, 23, 50), text: expect.any(Array) },
        { senderName: '다른 사람', place: 'reply', at: Date.UTC(2026, 9, 19, 23, 51), text: expect.any(Array) },
        { senderName: '보낸 사람', place: 'reply', at: Date.UTC(2026, 9, 19, 23, 52), text: expect.any(Array) },
      ],
      senderNames: ['보낸 사람', '다른 사람'],
      newMentionCount: 2,
      lastMentionAt: Date.UTC(2026, 9, 19, 23, 52),
      processedAt: null,
      canRestore: false,
      canOpenInFlow: true,
      thread: [],
    });
    expect(snapshot.mentions[0]?.text).toEqual([
      { text: '@테스트 사용자', mention: true },
      { text: ' 질문', mention: false },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('example.test');
  });

  it('이미 답함 묶음은 빠진 멘션까지 모두 보이고 되돌릴 수 있다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(
      bundle({ status: 'already-answered', processedAt: 5_000, remarkId: '-1', mentions: [mention('101', { remarkId: '-1', answered: true })] }),
      () => null,
    );

    expect([snapshot.group, snapshot.place, snapshot.mentions.length, snapshot.canRestore, snapshot.projectTitle]).toEqual([
      'processed',
      'post',
      1,
      true,
      null,
    ]);
    expect(snapshot.mentions[0]?.place).toBe('post');
  });

  it('알림 시각을 읽을 수 없으면 감지한 시각을 쓴다', () => {
    expect(bundleSnapshot(bundle({ mentions: [mention('101', { registeredDateTime: '', detectedAt: 4_000 })] }), () => null).mentions[0]?.at).toBe(4_000);
  });
});

/** 가짜 맥락. 본문, 머리 댓글(멘션)과 대댓글 둘, 다른 댓글 하나다. */
function context(): BundleContext {
  return {
    fetchedAt: 2_000,
    post: {
      title: '가짜 게시물',
      authorName: '글쓴이',
      registeredDateTime: '20261020080000',
      contents: '본문 @[다른 동료](other@example.test)',
      attachments: ['설계서.pdf'],
      mention: false,
    },
    targetThread: {
      id: '700',
      authorName: '보낸 사람',
      registeredDateTime: '20261020085000',
      contents: '@[테스트 사용자](me@example.test) 질문',
      attachments: [],
      mention: true,
      replies: [
        { id: '800', authorName: '동료', registeredDateTime: '20261020085500', contents: '저도 궁금합니다', attachments: ['로그.txt'], mention: false },
        { id: '801', authorName: '', registeredDateTime: '', contents: '시각 없음', attachments: [], mention: false },
      ],
    },
    otherComments: [
      { id: '690', authorName: '동료', registeredDateTime: '20261020081000', contents: '다른 이야기', attachments: [], mention: false, replies: [] },
    ],
  };
}

describe('묶음 스냅숏: 스레드 보기', () => {
  it('댓글 스레드 묶음은 맥락의 게시물 본문과 대상 댓글 스레드를 시간순 글로 넘기고, 묶음의 멘션을 표시한다. 다른 댓글과 사용자 ID는 넘기지 않는다', () => {
    /** 스냅숏. */
    const snapshot = bundleSnapshot(bundle({ context: context() }), () => null);

    expect(snapshot.thread).toEqual([
      {
        authorName: '글쓴이',
        place: 'post',
        at: Date.UTC(2026, 9, 19, 23, 0),
        text: [
          { text: '본문 ', mention: false },
          { text: '@다른 동료', mention: true },
        ],
        attachments: ['설계서.pdf'],
        mention: false,
      },
      { authorName: '보낸 사람', place: 'comment', at: Date.UTC(2026, 9, 19, 23, 50), text: expect.any(Array), attachments: [], mention: true },
      {
        authorName: '동료',
        place: 'reply',
        at: Date.UTC(2026, 9, 19, 23, 55),
        text: [{ text: '저도 궁금합니다', mention: false }],
        attachments: ['로그.txt'],
        mention: false,
      },
      { authorName: '', place: 'reply', at: null, text: [{ text: '시각 없음', mention: false }], attachments: [], mention: false },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('example.test');
  });

  it('본문 묶음은 본문(멘션) 뒤에 다른 댓글과 그 대댓글을 넘긴다', () => {
    /** 본문 묶음의 맥락. */
    const postContext: BundleContext = {
      ...context(),
      post: { ...context().post, mention: true },
      targetThread: null,
      otherComments: [
        {
          ...context().otherComments[0]!,
          replies: [{ id: '691', authorName: '동료', registeredDateTime: '20261020081500', contents: '답글', attachments: [], mention: false }],
        },
      ],
    };

    /** 스냅숏. */
    const snapshot = bundleSnapshot(bundle({ remarkId: '-1', mentions: [mention('101', { remarkId: '-1' })], context: postContext }), () => null);

    expect(snapshot.thread.map((entry) => [entry.place, entry.authorName, entry.mention])).toEqual([
      ['post', '글쓴이', true],
      ['comment', '동료', false],
      ['reply', '동료', false],
    ]);
  });
});

describe('Flow에서 열기 주소', () => {
  it('게시물의 connectUrl을 먼저 쓰고, 없으면 Flow 프로젝트의 projectUrl을 쓴다', () => {
    expect(flowUrlOf(bundle(), () => PROJECT)).toBe('https://fake.flow.test/post/90000011');
    expect(flowUrlOf(bundle({ connectUrl: null }), () => PROJECT)).toBe('https://fake.flow.test/project/900001');
    expect(flowUrlOf(bundle({ connectUrl: null }), () => null)).toBeNull();
  });

  it('https 주소가 아니면 열지 않는다', () => {
    expect(flowUrlOf(bundle({ connectUrl: 'javascript:alert(1)' }), () => null)).toBeNull();
    expect(flowUrlOf(bundle({ connectUrl: 'http://fake.flow.test/post/1' }), () => ({ ...PROJECT, projectUrl: 'file:///etc/passwd' }))).toBeNull();
    expect(flowUrlOf(bundle({ connectUrl: '주소 아님' }), () => PROJECT)).toBe('https://fake.flow.test/project/900001');
    expect(bundleSnapshot(bundle({ connectUrl: 'javascript:alert(1)' }), () => null).canOpenInFlow).toBe(false);
  });
});
