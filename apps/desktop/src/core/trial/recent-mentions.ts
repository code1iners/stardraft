import { mentionLocationKey, type Mention } from '../detection/mention';
import { flowTimeToEpochMs } from '../flow/flow-time';
import { MentionJudge } from '../flow/mention-judgement';
import type { FlowAlarm, FlowApi, FlowApiFailure, FlowApiResult } from '../ports/flow-api';

/** 최근 멘션으로 시험할 때 고르는 목록에 보이는 멘션 수. 설정에서 바꿀 수 없다. */
export const RECENT_MENTION_LIMIT = 10;

/** 알림 목록을 넘기는 최대 쪽 수. 판정을 통과하지 못하는 알림(`@전체` 등)만 이어져도 여기서 멈춘다. */
const MAX_ALARM_PAGES = 10;

/** 최근 멘션으로 시험할 때 고를 수 있는 멘션 하나. */
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
 * 최신 알림부터 쪽을 넘기며 판정을 통과한 멘션을 `RECENT_MENTION_LIMIT`건까지 모은다. 감지와 같은 판정 규칙이지만 72시간 제한이 없고,
 * 기준점이나 이미 기록한 멘션 위치와 상관없이 모은다. Flow의 읽음 상태는 바꾸지 않는다.
 * 그 글에서만 생기는 실패(서버 오류, 모르는 응답)는 그 알림만 건너뛰고, 모든 글에 같은 실패(키 거부, 연결 실패, 요청 한도)면 그 실패를 돌려준다.
 * `myUserId`는 키 확인 때 얻은 내 사용자 ID, `now`는 멘션의 감지한 시각으로 쓸 시각이다.
 */
export async function listRecentMentions(api: FlowApi, myUserId: string, now: number): Promise<FlowApiResult<RecentMention[]>> {
  /** 멘션된 글을 조회해 판정한다. 같은 게시물의 댓글은 한 번만 받는다. */
  const judge = new MentionJudge(api, myUserId);
  /** 모은 멘션. 최신이 앞이다. */
  const found: { alarm: FlowAlarm; text: string }[] = [];
  /** 이미 판정한 멘션 위치. */
  const decided = new Set<string>();
  /** 판정을 멈추게 한 실패. */
  let stoppedBy: FlowApiFailure | null = null;

  // 쪽을 받을 때마다 판정해야 10건을 모은 뒤 더 오래된 쪽을 받지 않는다. walkPages는 쪽마다 바로 답해야 하므로 직접 넘긴다.
  /** 다음 쪽 커서. */
  let cursor: string | null = null;
  for (let page = 0; page < MAX_ALARM_PAGES && found.length < RECENT_MENTION_LIMIT && stoppedBy === null; page += 1) {
    /** 이번 쪽. */
    const result = await api.listMentionAlarms(cursor);
    if (!result.ok) return result;
    for (const alarm of result.value.alarms) {
      if (found.length >= RECENT_MENTION_LIMIT) break;
      /** 멘션 위치. */
      const location = mentionLocationKey(alarm);
      if (decided.has(location)) continue;
      decided.add(location);
      /** 판정 결과. */
      const judgement = await judge.judge(alarm);
      if (judgement.kind === 'mention') found.push({ alarm, text: judgement.text });
      else if (judgement.kind === 'undecided' && isSharedFailure(judgement.failure)) {
        stoppedBy = judgement.failure;
        break;
      }
    }
    /** 다음 쪽 커서. */
    const next: string | null = result.value.nextCursor;
    if (next === null || next === cursor) break;
    cursor = next;
  }
  if (stoppedBy) return { ok: false, failure: stoppedBy };

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
  return { ok: true, value: mentions };
}

/** 모든 글에 같아 다음 알림을 판정해도 같을 실패인지 본다. 키 거부, 연결 실패, 요청 한도다. */
function isSharedFailure(failure: FlowApiFailure): boolean {
  return failure.kind === 'unauthorized' || failure.kind === 'network' || failure.kind === 'rate-limited';
}

/** 멘션 시각보다 나중에 쓴 답이 있는지 본다. 시각은 Flow 시각끼리 비교하고, 읽을 수 없으면 답하지 않은 것으로 본다. */
function answeredAfter(mentionTime: string, answers: readonly { registeredDateTime: string }[]): boolean {
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
