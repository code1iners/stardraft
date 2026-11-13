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
      value: { next: null, mentions: [
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
      ] },
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

    expect(result.ok && result.value.mentions.map((item) => item.mention.postId)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(flow.requests).not.toContain('GET /user/posts/11');
  });

  it('이어 불러오기는 앞서 멈춘 알림 다음부터 10건씩 모으고, 알림 끝에 닿으면 더 불러올 것이 없다', async () => {
    const flow = new FakeFlowApi();
    flow.alarmPageSize = 7;
    /** 23개 게시물의 알림. 최신이 앞이다. 사이사이 판정을 통과하지 못하는 알림과 이미 나온 멘션 위치의 알림이 섞여 있다. */
    const alarms: FlowAlarm[] = [];
    for (let index = 0; index < 23; index += 1) {
      /** 게시물 ID. 1이 가장 최근이다. */
      const postId = String(index + 1);
      addMentionPost(flow, postId);
      alarms.push(alarm(String(500 - index * 3), postId));
      if (index === 4) alarms.push(alarm(String(499 - index * 3), '1'));
      if (index === 12) {
        flow.addPost({ postId: 'all', textComponents: [{ contents: '@전체 공지', mentions: ['ALL'] }] });
        alarms.push(alarm(String(499 - index * 3), 'all'));
      }
    }
    flow.respondToListMentionAlarms(alarms);

    /** 첫 10건. */
    const first = await listRecentMentions(flow, ME, NOW);
    if (!first.ok) throw new Error('첫 목록을 만들지 못했습니다.');
    /** 이어 불러온 10건. */
    const second = await listRecentMentions(flow, ME, NOW, first.value.next);
    if (!second.ok) throw new Error('이어 불러오지 못했습니다.');
    /** 마지막 남은 것. */
    const third = await listRecentMentions(flow, ME, NOW, second.value.next);
    if (!third.ok) throw new Error('마지막을 불러오지 못했습니다.');

    /** 쪽마다 나온 게시물 ID. */
    const postIds = [first, second, third].map((page) => page.value.mentions.map((item) => item.mention.postId));
    expect(postIds).toEqual([
      ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      ['11', '12', '13', '14', '15', '16', '17', '18', '19', '20'],
      ['21', '22', '23'],
    ]);
    expect(first.value.next).not.toBeNull();
    expect(second.value.next).not.toBeNull();
    expect(third.value.next).toBeNull();
  });

  it('새 알림이 앞에 더 와도 이어 불러오기는 앞서 본 알림 뒤의 더 오래된 멘션만 모은다', async () => {
    const flow = new FakeFlowApi();
    flow.alarmPageSize = 4;
    /** 12개 게시물의 알림. 최신이 앞이다. */
    const alarms = Array.from({ length: 12 }, (_, index) => {
      /** 게시물 ID. 1이 가장 최근이다. */
      const postId = String(index + 1);
      addMentionPost(flow, postId);
      return alarm(String(300 - index), postId);
    });
    flow.respondToListMentionAlarms(alarms);
    /** 첫 10건. */
    const first = await listRecentMentions(flow, ME, NOW);
    if (!first.ok) throw new Error('첫 목록을 만들지 못했습니다.');

    addMentionPost(flow, 'new');
    flow.addAlarm(alarm('400', 'new'));
    flow.addAlarm(alarm('401', 'new', { remarkId: '9', replyId: '-1' }));
    /** 이어 불러온 것. */
    const second = await listRecentMentions(flow, ME, NOW, first.value.next);

    expect(second.ok && second.value.mentions.map((item) => item.mention.postId)).toEqual(['11', '12']);
    expect(second.ok && second.value.next).toBeNull();
  });

  it('Flow의 읽음 상태를 바꾸지 않는다', async () => {
    const flow = new FakeFlowApi();
    addMentionPost(flow, '1');
    flow.respondToListMentionAlarms([alarm('101', '1')]);

    await listRecentMentions(flow, ME, NOW);

    expect(flow.requests.filter((request) => !request.startsWith('GET '))).toEqual([]);
  });

  it('멘션보다 나중에 쓴 내 답이 있으면 "답함"으로 표시한다', async () => {
    const flow = new FakeFlowApi();
    addMentionPost(flow, '1');
    addMentionPost(flow, '2');
    flow.addComment('1', { commentId: '701', contents: '답했습니다', registerId: ME, registeredDateTime: '20261020085930' });
    flow.addComment('2', { commentId: '702', contents: '먼저 쓴 내 댓글', registerId: ME, registeredDateTime: '20261020085000' });
    flow.respondToListMentionAlarms([alarm('102', '1'), alarm('101', '2')]);

    const result = await listRecentMentions(flow, ME, NOW);

    expect(result.ok && result.value.mentions.map((item) => [item.mention.postId, item.answered])).toEqual([
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
    expect(skipped.ok && skipped.value.mentions.map((item) => item.mention.postId)).toEqual(['2']);

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
