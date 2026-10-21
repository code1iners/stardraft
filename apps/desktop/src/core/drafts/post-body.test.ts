import { describe, expect, it } from 'vitest';
import type { BundledMention } from '../bundles/mention-bundle';
import type { BundleContext, ContextRemark } from '../flow/bundle-context';
import { bundleRecipients, draftEditorText, postBody, POST_BODY_CHAR_LIMIT } from './post-body';

/** 송신자. 실제 사람이 아니다. */
const SENDER = 'sender@example.test';
/** 다른 송신자. 실제 사람이 아니다. */
const OTHER_SENDER = 'other@example.test';
/** 세 번째 송신자. 실제 사람이 아니다. */
const THIRD_SENDER = 'third@example.test';

/** 가짜 멘션. 기본은 08:50에 온, 댓글 700의 댓글 멘션이다. */
function mention(alarmId: string, overrides: Partial<BundledMention> = {}): BundledMention {
  return {
    postId: '90000011',
    remarkId: '700',
    replyId: '-1',
    projectId: '900001',
    alarmId,
    senderId: SENDER,
    senderName: '알림 속 이름',
    registeredDateTime: '20261020085000',
    detectedAt: 1_000,
    text: '@[테스트 사용자](me@example.test) 질문',
    answered: false,
    ...overrides,
  };
}

/** 가짜 대댓글. */
function reply(id: string, authorId: string, authorName: string): ContextRemark {
  return { id, authorId, authorName, registeredDateTime: '20261020085100', contents: '질문', attachments: [], mention: true };
}

/** 댓글 700 스레드의 맥락. 머리 댓글은 송신자, 대댓글 801은 다른 송신자, 802는 송신자, 803은 세 번째 송신자가 썼다. */
function context(): BundleContext {
  return {
    fetchedAt: 1_000,
    post: { title: '가짜 게시물', authorId: 'author@example.test', authorName: '글쓴이', registeredDateTime: '', contents: '본문', attachments: [], mention: false },
    targetThread: {
      ...reply('700', SENDER, '김철수'),
      replies: [reply('801', OTHER_SENDER, '이영희'), reply('802', SENDER, '김철수'), reply('803', THIRD_SENDER, '박민수')],
    },
    otherComments: [],
  };
}

describe('초안에서 편집기 텍스트로', () => {
  it('같은 문단의 문장은 공백 하나로 잇고, 문단 사이에는 빈 줄 하나를 두며, 근거 번호는 넣지 않는다', () => {
    /** 문단 둘, 근거 있는 문장과 없는 문장이 섞인 초안. */
    const draft = {
      paragraphs: [
        { sentences: [{ text: '실제 서비스에서는 재시도를 5번 합니다.', evidence: [1] }, { text: '간격은 2초씩 늘어납니다.', evidence: [1, 2] }] },
        { sentences: [{ text: '테스트 환경은 다를 수 있습니다.', evidence: [] }] },
      ],
    };

    expect(draftEditorText(draft)).toBe('실제 서비스에서는 재시도를 5번 합니다. 간격은 2초씩 늘어납니다.\n\n테스트 환경은 다를 수 있습니다.');
  });
});

describe('받는 사람 기본값', () => {
  it('묶음에 남은 멘션의 송신자 전원을 중복 없이 처음 멘션한 순서로 두고, 이미 답함으로 빠진 멘션의 송신자는 넣지 않는다. 이름과 ID는 맥락 조회 때의 것이다', () => {
    /** 08:50 송신자 댓글, 08:51 다른 송신자 대댓글, 08:52 송신자 대댓글, 08:40 이미 답함으로 빠진 세 번째 송신자 대댓글. 알림 순서는 섞여 있다. */
    const mentions = [
      mention('103', { replyId: '802', registeredDateTime: '20261020085200' }),
      mention('102', { replyId: '801', senderId: OTHER_SENDER, registeredDateTime: '20261020085100' }),
      mention('100', { replyId: '803', senderId: THIRD_SENDER, registeredDateTime: '20261020084000', answered: true }),
      mention('101'),
    ];

    expect(bundleRecipients({ mentions, context: context(), removedRecipients: [] })).toEqual([
      { id: SENDER, name: '김철수' },
      { id: OTHER_SENDER, name: '이영희' },
    ]);
  });

  it('사용자가 뺀 사람은 넣지 않는다. 모두 빼면 받는 사람이 없다', () => {
    /** 송신자와 다른 송신자의 멘션. */
    const mentions = [mention('101'), mention('102', { replyId: '801', senderId: OTHER_SENDER, registeredDateTime: '20261020085100' })];

    expect(bundleRecipients({ mentions, context: context(), removedRecipients: [SENDER] })).toEqual([{ id: OTHER_SENDER, name: '이영희' }]);
    expect(bundleRecipients({ mentions, context: context(), removedRecipients: [SENDER, OTHER_SENDER] })).toEqual([]);
  });

  it('맥락에서 멘션 글을 찾지 못하면 알림의 송신자 ID와 이름을 쓴다', () => {
    /** 맥락에 없는 대댓글 809의 멘션. */
    const mentions = [mention('101', { replyId: '809', senderId: THIRD_SENDER, senderName: '알림 속 이름' })];

    expect(bundleRecipients({ mentions, context: context(), removedRecipients: [] })).toEqual([{ id: THIRD_SENDER, name: '알림 속 이름' }]);
    expect(bundleRecipients({ mentions, context: null, removedRecipients: [] })).toEqual([{ id: THIRD_SENDER, name: '알림 속 이름' }]);
  });
});

describe('게시 본문과 글자 수', () => {
  it('받는 사람의 표기를 공백으로 이어 맨 앞에 두고, 공백 하나 뒤에 앞뒤 공백을 뗀 편집기 텍스트를 같은 줄에서 잇는다', () => {
    /** 받는 사람 둘. */
    const recipients = [
      { id: 'kim@example.test', name: '김철수' },
      { id: 'lee@example.test', name: '이영희' },
    ];

    expect(postBody(recipients, '\n 실제 서비스에서는 재시도를 5번 합니다.\n\n간격은 2초입니다. \n')).toBe(
      '@[김철수](kim@example.test) @[이영희](lee@example.test) 실제 서비스에서는 재시도를 5번 합니다.\n\n간격은 2초입니다.',
    );
  });

  it('받는 사람이 없으면 편집기 텍스트만이다', () => {
    expect(postBody([], '  재시도는 5번입니다. ')).toBe('재시도는 5번입니다.');
  });

  it('글자 수는 받는 사람 표기를 포함한 게시 본문 전체를 String.length로 센다. 상한은 4,000이다', () => {
    /** 표기 `@[김철수](kim@example.test)` 24자, 공백 1자, 이모지 하나(2)와 글 3,997자. */
    const body = postBody([{ id: 'kim@example.test', name: '김철수' }], `😀${'가'.repeat(3_997)}`);

    expect(body.length).toBe(24 + 1 + 2 + 3_997);
    expect(POST_BODY_CHAR_LIMIT).toBe(4_000);
  });
});
