import { mentionLocationKey, type Mention } from '../detection/mention';
import { flowTimeToEpochMs } from '../flow/flow-time';
import { MentionJudge } from '../flow/mention-judgement';
import type { FlowAlarm, FlowApi, FlowApiResult } from '../ports/flow-api';
import { collectFromAlarms, type AlarmVerdict } from './alarm-walk';

/** 최근 멘션 목록에서 고를 수 있는 멘션 하나. */
export interface RecentMention {
  /** 판정을 통과한 멘션. 감지한 시각은 목록을 만든 시각이다. */
  mention: Mention;
  /** 게시물 제목. 모르면 빈 문자열. */
  postTitle: string;
  /** "Flow에서 열기" 주소. 모르면 `null`. */
  connectUrl: string | null;
  /** 멘션보다 나중에 쓴 내 답이 묶음 자리에 있는지 여부. 목록에 "답함"을 붙이지만 고를 수는 있다. */
  answered: boolean;
}

/**
 * 이어 불러오기가 시작할 자리. 앞선 불러오기가 돌려준 값을 그대로 넘긴다.
 * 쪽 커서는 Flow가 준 값이라, 그사이 새 알림이 앞에 더 와 쪽이 밀려도 `afterAlarmId`보다 오래된 알림만 보아 같은 알림을 다시 판정하지 않는다.
 */
export interface RecentMentionCursor {
  /** 다시 받을 알림 쪽의 커서. 첫 쪽이면 `null`. */
  pageCursor: string | null;
  /** 이 알림까지는 앞서 판정했다. 그 쪽을 처음부터 볼 것이면 `null`. */
  afterAlarmId: string | null;
  /** 앞서 판정한 멘션 위치(`mentionLocationKey`). 같은 위치의 더 오래된 알림을 다시 넣지 않는다. */
  decidedLocations: string[];
}

/** 최근 멘션 목록의 한 번 불러온 몫. */
export interface RecentMentionPage {
  /** 모은 멘션. 최신이 앞이다. */
  mentions: RecentMention[];
  /** 이어 불러올 자리. 알림 끝에 닿았으면 `null`. */
  next: RecentMentionCursor | null;
}

/**
 * 최신 알림부터(`from`이 있으면 그 자리부터) 쪽을 넘기며 판정을 통과한 멘션을 `MANUAL_CHECK_PAGE_SIZE`건까지 모은다.
 * 감지와 같은 판정 규칙이지만 72시간 제한이 없고, 기준점이나 이미 기록한 멘션 위치와 상관없이 모은다. Flow의 읽음 상태는 바꾸지 않는다.
 * 그 글에서만 생기는 실패(서버 오류, 모르는 응답)는 그 알림만 건너뛰고, 모든 글에 같은 실패(키 거부, 연결 실패, 요청 한도)면 그 실패를 돌려준다.
 * `myUserId`는 키 확인 때 얻은 내 사용자 ID, `now`는 멘션의 감지한 시각으로 쓸 시각이다.
 */
export async function listRecentMentions(
  api: FlowApi,
  myUserId: string,
  now: number,
  from: RecentMentionCursor | null = null,
): Promise<FlowApiResult<RecentMentionPage>> {
  /** 멘션된 글을 조회해 판정한다. 같은 게시물의 댓글은 한 번만 받는다. */
  const judge = new MentionJudge(api, myUserId);
  /** 쪽을 넘기며 판정을 통과한 멘션을 모은 결과. 같은 멘션 위치는 가장 최근 알림 하나만 판정한다. */
  const walk = await collectFromAlarms(
    (cursor) => api.listMentionAlarms(cursor),
    from && { pageCursor: from.pageCursor, afterAlarmId: from.afterAlarmId, decidedKeys: from.decidedLocations },
    mentionLocationKey,
    async (alarm): Promise<AlarmVerdict<{ alarm: FlowAlarm; text: string }>> => {
      /** 판정 결과. */
      const judgement = await judge.judge(alarm);
      if (judgement.kind === 'mention') return { kind: 'found', value: { alarm, text: judgement.text } };
      return judgement.kind === 'undecided' ? { kind: 'failed', failure: judgement.failure } : { kind: 'skip' };
    },
  );
  if (!walk.ok) return walk;
  /** 모은 멘션. 최신이 앞이다. */
  const found = walk.value.found;
  /** 이어 불러올 자리. */
  const next: RecentMentionCursor | null = walk.value.next && {
    pageCursor: walk.value.next.pageCursor,
    afterAlarmId: walk.value.next.afterAlarmId,
    decidedLocations: walk.value.next.decidedKeys,
  };

  /** 내 사용자 ID들. 키 확인 때 얻은 ID와 판정을 통과한 알림의 receiverId다. */
  const myIds = [...new Set([myUserId, ...found.flatMap(({ alarm }) => (alarm.receiverId ? [alarm.receiverId] : []))])];
  /** 모은 멘션마다 게시물과 내 답을 조회한 것. */
  const mentions: RecentMention[] = [];
  for (const { alarm, text } of found) {
    /** 묶음 자리의 게시물과 내 답. 조회하지 못한 값은 `null`이다. */
    const place = await judge.lookupPlace(alarm, myIds);
    mentions.push({
      mention: mentionOf(alarm, text, now),
      postTitle: place.post?.title ?? '',
      connectUrl: place.post?.connectUrl ?? null,
      answered: answeredAfter(alarm.registeredDateTime, place.myAnswers ?? []),
    });
  }
  return { ok: true, value: { mentions, next } };
}

/** 멘션 시각보다 나중에 쓴 답이 있는지 본다. 시각은 Flow 시각끼리 비교하고, 읽을 수 없으면 답하지 않은 것으로 본다. */
export function answeredAfter(mentionTime: string, answers: readonly { registeredDateTime: string }[]): boolean {
  /** 멘션 시각. */
  const at = flowTimeToEpochMs(mentionTime);
  if (at === null) return false;
  return answers.some((answer) => {
    /** 답을 쓴 시각. */
    const answeredAt = flowTimeToEpochMs(answer.registeredDateTime);
    return answeredAt !== null && answeredAt > at;
  });
}

/** 판정을 통과한 알림과 멘션된 글의 내용으로 멘션을 만든다. */
function mentionOf(alarm: FlowAlarm, text: string, detectedAt: number): Mention {
  return {
    postId: alarm.postId,
    remarkId: alarm.remarkId,
    replyId: alarm.replyId,
    projectId: alarm.projectId,
    alarmId: alarm.alarmId,
    senderId: alarm.registerId,
    senderName: alarm.registerName,
    registeredDateTime: alarm.registeredDateTime,
    detectedAt,
    text,
  };
}
