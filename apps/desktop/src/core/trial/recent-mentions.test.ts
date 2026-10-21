import { describe, expect, it } from 'vitest';
import { FAKE_ME, FakeFlowApi } from '../fakes/fake-flow-api';
import type { FlowAlarm } from '../ports/flow-api';
import { listRecentMentions } from './recent-mentions';

/** 지금 시각. 2026-10-20 09:00:00 한국 표준시. */
const NOW = Date.UTC(2026, 9, 20, 0, 0, 0);
/** 나(키 소유자)의 사용자 ID. */
const ME = FAKE_ME.userId;
/** 송신자. 실제 사람이 아니다. */
const SENDER = 'sender@example.test';
/** 나를 지목한 표기. */
const MY_MARKUP = `@[테스트 사용자](${ME})`;

/** 가짜 멘션 알림. 기본은 게시물 `postId`의 본문 멘션이다. */
function alarm(alarmId: string, postId: string, overrides: Partial<FlowAlarm> = {}): FlowAlarm {
  return {
    alarmId,
    projectId: '900001',
    postId,
    remarkId: '-1',
    replyId: '-1',
    receiverId: ME,
    registerId: SENDER,
    registerName: '보낸 사람',
    registeredDateTime: '20261020085900',
    ...overrides,
  };
}

/** 나를 본문에서 멘션한 게시물을 더한다. */
function addMentionPost(flow: FakeFlowApi, postId: string, text = `${MY_MARKUP} 확인 부탁드립니다`): void {
  flow.addPost({ postId, title: `게시물 ${postId}`, connectUrl: `https://flow.example.test/${postId}`, textComponents: [{ contents: text, mentions: [ME] }] });
}

describe('최근 멘션 목록', () => {
  it('최신 알림부터 판정을 통과한 멘션만 모으고, 72시간보다 오래된 멘션도 넣으며, 같은 멘션 위치는 한 번만 넣는다', async () => {
    const flow = new FakeFlowApi();
    addMentionPost(flow, '1');
    flow.addPost({ postId: '2', textComponents: [{ contents: '@전체 공지', mentions: ['ALL'] }] });
    addMentionPost(flow, '3');
    flow.respondToListMentionAlarms([
      alarm('105', '1', { registeredDateTime: '20261020085900' }),
      alarm('104', '1', { registeredDateTime: '20261020085800' }),
      alarm('103', '2'),
      alarm('102', '1', { registerId: ME }),
      // 일주일 전 알림. 감지와 달리 72시간 제한이 없다.
      alarm('101', '3', { registeredDateTime: '20261013085900' }),
    ]);

    const result = await listRecentMentions(flow, ME, NOW);

    expect(result).toEqual({
      ok: true,
      value: [
        {
          mention: {
            postId: '1',
            remarkId: '-1',
            replyId: '-1',
            projectId: '900001',
            alarmId: '105',
            senderId: SENDER,
            senderName: '보낸 사람',
            registeredDateTime: '20261020085900',
            detectedAt: NOW,
            text: `${MY_MARKUP} 확인 부탁드립니다`,
          },
          postTitle: '게시물 1',
          connectUrl: 'https://flow.example.test/1',
          answered: false,
        },
        {
          mention: expect.objectContaining({ postId: '3', alarmId: '101', registeredDateTime: '20261013085900' }),
          postTitle: '게시물 3',
          connectUrl: 'https://flow.example.test/3',
          answered: false,
        },
      ],
    });
  });

  it('10건을 모으면 더 오래된 알림은 판정하지 않는다', async () => {
    const flow = new FakeFlowApi();
    flow.alarmPageSize = 5;
    /** 12개 게시물의 알림. 최신이 앞이다. */
    const alarms = Array.from({ length: 12 }, (_, index) => {
      /** 게시물 ID. 1이 가장 최근이다. */
      const postId = String(index + 1);
      addMentionPost(flow, postId);
      return alarm(String(200 - index), postId);
    });
    flow.respondToListMentionAlarms(alarms);

    const result = await listRecentMentions(flow, ME, NOW);

    expect(result.ok && result.value.map((item) => item.mention.postId)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(flow.requests).not.toContain('GET /user/posts/11');
  });

  it('멘션보다 나중에 쓴 내 답이 있으면 "답함"으로 표시한다', async () => {
    const flow = new FakeFlowApi();
    addMentionPost(flow, '1');
    addMentionPost(flow, '2');
    flow.addComment('1', { commentId: '701', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085930' });
    flow.addComment('2', { commentId: '702', contents: '먼저 쓴 내 댓글', registerId: ME, registeredDateTime: '20261020085000' });
    flow.respondToListMentionAlarms([alarm('102', '1'), alarm('101', '2')]);

    const result = await listRecentMentions(flow, ME, NOW);

    expect(result.ok && result.value.map((item) => [item.mention.postId, item.answered])).toEqual([
      ['1', true],
      ['2', false],
    ]);
  });

  it('그 글에서만 생긴 실패(서버 오류)는 그 알림만 건너뛰고, 알림 목록을 받지 못하면 실패를 돌려준다', async () => {
    const flow = new FakeFlowApi();
    addMentionPost(flow, '1');
    addMentionPost(flow, '2');
    flow.failOn('GET /user/posts/1', { kind: 'http', status: 500 });
    flow.respondToListMentionAlarms([alarm('102', '1'), alarm('101', '2')]);

    const skipped = await listRecentMentions(flow, ME, NOW);
    expect(skipped.ok && skipped.value.map((item) => item.mention.postId)).toEqual(['2']);

    flow.respondToListMentionAlarms({ ok: false, failure: { kind: 'unauthorized' } });
    expect(await listRecentMentions(flow, ME, NOW)).toEqual({ ok: false, failure: { kind: 'unauthorized' } });
  });

  it('연결 실패처럼 모든 글에 같은 실패면 멈추고 실패를 돌려준다', async () => {
    const flow = new FakeFlowApi();
    addMentionPost(flow, '1');
    flow.failOn('GET /user/posts/1', { kind: 'network' });
    flow.respondToListMentionAlarms([alarm('101', '1')]);

    expect(await listRecentMentions(flow, ME, NOW)).toEqual({ ok: false, failure: { kind: 'network' } });
  });
});
