import { describe, expect, it } from 'vitest';
import type { BundledMention, MentionBundle } from '../core/bundles/mention-bundle';
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
