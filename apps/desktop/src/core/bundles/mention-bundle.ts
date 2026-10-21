import type { BundleContext } from '../flow/bundle-context';
import { mentionLocationKey, type Mention, type MentionLocation } from '../detection/mention';
import type { Draft, DraftFailure, Regeneration, RunRecord } from '../drafts/draft';
import { compareAlarmIds } from '../flow/alarm-id';
import { flowTimeToEpochMs } from '../flow/flow-time';
import type { MyAnswer } from '../flow/mention-judgement';
import type { RepoCandidate } from '../repos/repo-candidates';

/** 멘션 묶음의 상태. 게시 중·게시 실패·게시됨·원문 사라짐은 게시와 변화 감시 기능이 더한다. */
export type BundleStatus =
  /** 생성 중. 선택 실행이나 초안 실행이 대기열에 있거나 돌고 있다. */
  | 'generating'
  /** 준비됨. 초안이 있고 사용자 행동을 기다린다. */
  | 'ready'
  /** 저장소 확인 필요. 초안 없이 저장소를 골라 달라고 기다린다. */
  | 'repo-check-needed'
  /** 실패. 생성이 실패했다(시간 초과, 취소함, 빈 초안, 구조 실패 등). */
  | 'failed'
  /** 무시함. 사용자가 무시했다. */
  | 'ignored'
  /** 이미 답함. Flow에 내 답이 있어 자동으로 옮겨졌다. */
  | 'already-answered';

/** 펼친 창의 목록 묶음 하나. 검토 대기·생성 중·실패·처리됨이다. */
export type BundleListGroup = 'awaiting-review' | 'generating' | 'failed' | 'processed';

/** 멘션 묶음이 상태에 따라 펼친 창의 어느 목록 묶음에 드는지 돌려준다. */
export function listGroupOf(status: BundleStatus): BundleListGroup {
  switch (status) {
    case 'generating':
      return 'generating';
    case 'ready':
    case 'repo-check-needed':
      return 'awaiting-review';
    case 'failed':
      return 'failed';
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

/** 저장소 선택 창으로 고른 구성으로 만들 수 있는 상태인지 본다. 준비됨(다른 저장소로 다시 만들기)과 저장소 확인 필요(저장소를 골라 만들기)다. */
export function canPickRepos(status: BundleStatus): boolean {
  return status === 'ready' || status === 'repo-check-needed';
}

/** 초안을 편집하고 받는 사람을 뺄 수 있는 상태인지 본다. 준비됨이다. */
export function canEditDraft(status: BundleStatus): boolean {
  return status === 'ready';
}

/**
 * 사용자가 초안·요구·지시 가운데 하나라도 손댔는지 본다. 편집본이 있거나, 요구를 고쳤거나, 지시를 덧붙였으면 손댄 것이다.
 * 받는 사람을 뺀 것은 손댐이 아니다. 받는 사람은 초안 텍스트 밖에 있어 다시 만들어도 덮어쓰지 않기 때문이다.
 */
export function isDraftTouched(bundle: Pick<MentionBundle, 'editedText' | 'fixedRequirement' | 'instructions'>): boolean {
  return bundle.editedText !== null || bundle.fixedRequirement !== null || bundle.instructions.length > 0;
}

/** 트레이 숫자에 세는 상태인지 본다. 검토 대기 가운데 준비됨과 저장소 확인 필요다. */
export function countsForReview(status: BundleStatus): boolean {
  return status === 'ready' || status === 'repo-check-needed';
}

/**
 * 저장소 확인 필요의 사유. 자동 선택이 생기기 전에 저장소 매핑이 없어 저장소 확인 필요가 된 묶음은 사유가 없다(`null`).
 */
export type RepoCheck =
  /** 저장소 매핑에 연결된 폴더 가운데 없는 것이 있다. 화면 사유는 "연결된 저장소 폴더를 찾을 수 없음"이다. */
  | {
      kind: 'missing-folders';
      /** 찾을 수 없는 폴더의 절대 경로. */
      paths: string[];
    }
  /** 자동 선택을 하려 했지만 작업 폴더에서 저장소 후보를 찾지 못했다(작업 폴더가 없거나 비어 있음). */
  | { kind: 'no-candidates' }
  /** 선택 실행이 저장소를 확신하지 못했거나(`unsure`) 코드와 무관한 멘션이라고(`unrelated`) 판정했다. */
  | {
      kind: 'unsure' | 'unrelated';
      /** 선택 실행이 적은 사유. 에이전트가 비워 두었으면 빈 문자열이고 화면에는 "이유 없음"으로 보인다. */
      reason: string;
      /** 선택 실행에 넘긴 후보. 작업 폴더에서 찾은 저장소 전부이고 찾은 순서다. */
      candidates: RepoCandidate[];
      /** 선택 실행이 짚은 후보의 절대 경로. 판정이 고름이 아니어도 가능성이 있는 저장소를 넣을 수 있다. 에이전트가 낸 순서이고, 짚지 않았으면 비어 있다. */
      picked: string[];
    };

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
  /**
   * 지금 초안이나 상태를 만든 뒤에 합쳐진 새 멘션 수. 작은 창에 "새 멘션 1건"으로 보인다.
   * 생성 중 묶음에 합친 멘션은 이번 초안에 들어가므로 세지 않는다.
   */
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
  /** 저장소 확인 필요의 사유. 저장소 확인 필요가 아니거나, 자동 선택이 생기기 전에 사유 없이 저장소 확인 필요가 되었으면 `null`. */
  repoCheck: RepoCheck | null;
  /**
   * 사용자가 저장소 선택 창에서 고른 구성(절대 경로). 첫 저장소가 초안 실행의 cwd가 된다.
   * 있으면 저장소 매핑과 자동 선택 대신 이 구성으로 초안 실행만 돌린다. 저장소 매핑은 아니고, 고른 적이 없으면 `null`.
   */
  userRepos: string[] | null;
  /** 초안 실행이 만든 초안(원래 초안). 아직 없으면 `null`. */
  draft: Draft | null;
  /**
   * 편집본. 사용자가 편집기에서 고친 텍스트다. 고치지 않았거나 원래 초안과 같아졌으면 `null`이고, 그때 편집기 텍스트는 원래 초안에서 만든다.
   * 초안이 바뀌거나 지워지면 함께 지운다.
   */
  editedText: string | null;
  /** 사용자가 받는 사람에서 ×로 뺀 사람의 Flow 사용자 ID. 뺀 순서다. */
  removedRecipients: string[];
  /** 이 묶음에 지금까지 덧붙인 지시. 덧붙인 순서다. 요구를 고치거나 저장소를 바꾸면 비운다. */
  instructions: string[];
  /** 사용자가 고친 요구. 요구 고치기로 다시 만드는 중이거나 그렇게 만든 초안이면 그 요구이고, 다른 재생성을 하면 지운다. 고친 적이 없으면 `null`. */
  fixedRequirement: string | null;
  /** 생성 중 묶음을 다시 만드는 재생성. 처음 만드는 묶음이거나 저장소 선택 창으로 다시 만들면 `null`. */
  regeneration: Regeneration | null;
  /** 생성이 실패한 까닭. 실패가 아니면 `null`. */
  failure: DraftFailure | null;
  /** 실행 기록. 실행한 순서다. */
  runs: RunRecord[];
}

/** 아직 저장하지 않아 ID가 없을 수 있는 묶음. 새 묶음은 저장할 때 ID를 받는다. */
export type UnsavedBundle = Omit<MentionBundle, 'id'> & { id: number | null };

/** 묶음 자리를 한 문자열로 나타낸다. 같은 자리를 가려낼 때 쓴다. */
export function bundlePlaceKey({ postId, remarkId }: BundlePlace): string {
  return JSON.stringify([postId, remarkId]);
}

/**
 * 묶음에 든 멘션 위치 전부를 한 문자열로 나타낸다. 이미 답함으로 빠진 멘션도 넣어, 판정이 바뀌어도 같은 값이다.
 * 초안 실행을 시작한 뒤 새 멘션이 합쳐졌는지 가려낼 때 쓴다.
 */
export function mentionSetKey(bundle: Pick<MentionBundle, 'mentions'>): string {
  return bundle.mentions.map(mentionLocationKey).sort().join('\n');
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
