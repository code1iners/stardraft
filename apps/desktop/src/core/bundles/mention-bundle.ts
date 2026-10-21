import type { BundleContext } from '../flow/bundle-context';
import type { Mention, MentionLocation } from '../detection/mention';
import { compareAlarmIds } from '../flow/alarm-id';
import { flowTimeToEpochMs } from '../flow/flow-time';
import type { MyAnswer } from '../flow/mention-judgement';

/**
 * 멘션 묶음의 상태. 생성 중·준비됨·게시 중·실패 같은 상태는 초안을 만들고 게시하는 기능이 더한다.
 * 초안 실행이 생기기 전까지 감지한 묶음은 모두 "저장소 확인 필요"로 올라온다.
 */
export type BundleStatus =
  /** 저장소 확인 필요. 초안 없이 저장소를 골라 달라고 기다린다. */
  | 'repo-check-needed'
  /** 무시함. 사용자가 무시했다. */
  | 'ignored'
  /** 이미 답함. Flow에 내 답이 있어 자동으로 옮겨졌다. */
  | 'already-answered';

/** 펼친 창의 목록 묶음 하나. 검토 대기·생성 중·실패·처리됨이다. */
export type BundleListGroup = 'awaiting-review' | 'generating' | 'failed' | 'processed';

/** 멘션 묶음이 상태에 따라 펼친 창의 어느 목록 묶음에 드는지 돌려준다. */
export function listGroupOf(status: BundleStatus): BundleListGroup {
  switch (status) {
    case 'repo-check-needed':
      return 'awaiting-review';
    case 'ignored':
    case 'already-answered':
      return 'processed';
  }
}

/** 처리됨(게시됨·무시함·이미 답함·원문 사라짐)인지 본다. 처리됨 묶음은 작은 창 대기열에 없고 되돌릴 수만 있다. */
export function isProcessed(status: BundleStatus): boolean {
  return listGroupOf(status) === 'processed';
}

/** 처리됨에서 되돌릴 수 있는 상태인지 본다. 게시됨은 되돌릴 수 없다. */
export function isRestorable(status: BundleStatus): boolean {
  return status === 'ignored' || status === 'already-answered';
}

/** 트레이 숫자에 세는 상태인지 본다. 검토 대기 가운데 준비됨과 저장소 확인 필요다. */
export function countsForReview(status: BundleStatus): boolean {
  return status === 'repo-check-needed';
}

/** 묶음에 든 멘션. */
export interface BundledMention extends Mention {
  /**
   * 내가 Flow에서 이 멘션보다 나중에 답해 묶음에서 빠졌는지 여부.
   * 빠진 멘션도 기록에는 남지만 묶음의 대기열 순서와 받는 사람에는 들지 않는다.
   */
  answered: boolean;
}

/** 묶음에 기록한 내 답. "이미 답함" 판정을 뒷받침한 답이다. */
export interface RecordedAnswer extends MyAnswer {
  /** 묶음을 되돌릴 때 기록해, 이후 "이미 답함" 판정에서 빼는 답인지 여부. 같은 답으로 다시 처리됨이 되지 않게 한다. */
  excluded: boolean;
}

/** 멘션 묶음 자리. 같은 댓글 스레드(`remarkId`가 댓글)나 같은 게시물 본문(`remarkId`가 `"-1"`)이다. */
export type BundlePlace = Pick<MentionLocation, 'postId' | 'remarkId'>;

/**
 * 멘션 묶음. 같은 댓글 스레드나 같은 게시물 본문에서 온, 아직 처리하지 않은 멘션의 모음이다.
 * 초안·상태·트레이 숫자·대기열 위치는 모두 묶음 단위다.
 */
export interface MentionBundle extends BundlePlace {
  /** 묶음 ID. 저장할 때 정해지고 다시 쓰지 않는다. */
  id: number;
  /** 멘션이 온 Flow 프로젝트 ID. */
  projectId: string;
  /** 상태. */
  status: BundleStatus;
  /** 게시물 제목. 모르면 빈 문자열. */
  postTitle: string;
  /** "Flow에서 열기" 주소(게시물의 `connectUrl`). 모르면 `null`. */
  connectUrl: string | null;
  /** 묶음에 든 멘션. 알림 시각 순서다. */
  mentions: BundledMention[];
  /** 묶음 자리에서 찾은 내 답 가운데 멘션보다 나중에 쓴 것과, 되돌릴 때 기록한 것. */
  answers: RecordedAnswer[];
  /** 저장소 확인 필요 묶음에 합쳐진 새 멘션 수. 작은 창에 "새 멘션 1건"으로 보인다. */
  newMentionCount: number;
  /** 묶음을 만든 시각(Unix epoch 밀리초). */
  createdAt: number;
  /** 처리한 시각(Unix epoch 밀리초). 처리됨이 아니면 `null`. */
  processedAt: number | null;
  /**
   * 마지막으로 Flow에서 조회한 맥락. 초안을 만들 때 넘긴 Flow 내용이라, 준비된 뒤의 변화 감시가 이것과 비교한다(비교 기준).
   * 원문 영역의 "스레드 보기"도 이것을 보인다. 아직 조회하지 못했으면 `null`.
   */
  context: BundleContext | null;
}

/** 아직 저장하지 않아 ID가 없을 수 있는 묶음. 새 묶음은 저장할 때 ID를 받는다. */
export type UnsavedBundle = Omit<MentionBundle, 'id'> & { id: number | null };

/** 묶음 자리를 한 문자열로 나타낸다. 같은 자리를 가려낼 때 쓴다. */
export function bundlePlaceKey({ postId, remarkId }: BundlePlace): string {
  return JSON.stringify([postId, remarkId]);
}

/** 두 멘션을 알림 시각, 같으면 `alarmId` 크기로 비교한다. */
export function compareMentions(a: Mention, b: Mention): number {
  if (a.registeredDateTime !== b.registeredDateTime) return a.registeredDateTime < b.registeredDateTime ? -1 : 1;
  return compareAlarmIds(a.alarmId, b.alarmId);
}

/** 묶음에 남은 멘션. "이미 답함"으로 빠진 멘션을 뺀 것이다. */
export function activeMentions(bundle: Pick<MentionBundle, 'mentions'>): BundledMention[] {
  return bundle.mentions.filter((mention) => !mention.answered);
}

/**
 * 묶음의 멘션마다 "이미 답함"을 다시 판정한다. 그 멘션보다 나중에 쓴 내 답이 있으면 답한 멘션이다.
 * 되돌릴 때 기록한 답은 세지 않는다. 시각은 Flow 시각끼리 비교하고(PC 시계는 쓰지 않음), 읽을 수 없거나 같은 초면 답하지 않은 것으로 본다.
 * 잘못 건너뛰면 멘션을 놓치지만, 잘못 만든 묶음은 한 번 무시하면 끝나기 때문이다.
 */
export function judgeAnswered(mentions: readonly Mention[], answers: readonly RecordedAnswer[]): BundledMention[] {
  /** 세는 답 가운데 가장 나중에 쓴 시각. */
  let latestAnswerAt: number | null = null;
  for (const answer of answers) {
    if (answer.excluded) continue;
    /** 답을 쓴 시각. */
    const at = flowTimeToEpochMs(answer.registeredDateTime);
    if (at !== null && (latestAnswerAt === null || at > latestAnswerAt)) latestAnswerAt = at;
  }

  return [...mentions].sort(compareMentions).map((mention) => {
    /** 멘션 시각. */
    const at = flowTimeToEpochMs(mention.registeredDateTime);
    return { ...mention, answered: latestAnswerAt !== null && at !== null && latestAnswerAt > at };
  });
}

/**
 * 작은 창 대기열 순서로 비교한다. 처리되지 않은 묶음이 먼저 오고, 가장 오래된 미처리 멘션 순이다.
 * 처리됨 묶음은 그 뒤에 최근에 처리한 것부터 온다.
 */
export function compareBundles(a: MentionBundle, b: MentionBundle): number {
  /** 처리됨 여부. */
  const [aDone, bDone] = [isProcessed(a.status), isProcessed(b.status)];
  if (aDone !== bDone) return aDone ? 1 : -1;
  if (aDone) return (b.processedAt ?? 0) - (a.processedAt ?? 0) || b.id - a.id;

  /** 묶음마다 가장 오래된 미처리 멘션. 남은 멘션이 없으면 첫 멘션이다. */
  const [aFirst, bFirst] = [oldestMention(a), oldestMention(b)];
  if (aFirst && bFirst) return compareMentions(aFirst, bFirst) || a.id - b.id;
  return a.id - b.id;
}

/** 묶음에서 가장 오래된 미처리 멘션. 남은 멘션이 없으면 첫 멘션이다. */
function oldestMention(bundle: MentionBundle): BundledMention | undefined {
  /** 묶음에 남은 멘션. */
  const active = activeMentions(bundle);
  return [...(active.length > 0 ? active : bundle.mentions)].sort(compareMentions)[0];
}
