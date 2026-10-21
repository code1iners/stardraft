import type { BundleContext } from '../flow/bundle-context';
import { mentionLocationKey, type Mention, type MentionLocation } from '../detection/mention';
import type { Draft, DraftFailure, Regeneration, RunRecord } from '../drafts/draft';
import { compareAlarmIds } from '../flow/alarm-id';
import { flowTimeToEpochMs } from '../flow/flow-time';
import type { MyAnswer } from '../flow/mention-judgement';
import type { RepoCandidate } from '../repos/repo-candidates';

/** 멘션 묶음의 상태. */
export type BundleStatus =
  /** 생성 중. 선택 실행이나 초안 실행이 대기열에 있거나 돌고 있다. */
  | 'generating'
  /** 준비됨. 초안이 있고 사용자 행동을 기다린다. */
  | 'ready'
  /** 저장소 확인 필요. 초안 없이 저장소를 골라 달라고 기다린다. */
  | 'repo-check-needed'
  /** 게시 중. 게시 취소 카운트다운(5초)이나 게시 요청 중이다. 게시 기록이 없으면 카운트다운 중이다. */
  | 'posting'
  /** 실패. 생성이 실패했다(시간 초과, 취소함, 빈 초안, 구조 실패 등). */
  | 'failed'
  /** 게시 실패. 게시 요청이 실패했다. 초안은 그대로 있고, 사유는 게시 기록에 있다. 편집해 다시 게시하거나 무시할 수 있다. */
  | 'post-failed'
  /** 게시됨. 이 PC가 게시했고 올라간 글의 ID가 게시 기록에 있다. 되돌릴 수 없다. */
  | 'posted'
  /** 무시함. 사용자가 무시했다. */
  | 'ignored'
  /** 이미 답함. Flow에 내 답이 있어 자동으로 옮겨졌다. 초안이 있으면 편집본까지 그대로 둔다. */
  | 'already-answered'
  /** 원문 사라짐. 멘션이 모두 사라졌다(삭제, 내 표기 제거, 접근 불가, 머리 댓글 삭제). 초안이 있으면 그대로 둔다. */
  | 'source-gone';

/** 펼친 창의 목록 묶음 하나. 검토 대기·생성 중·실패·처리됨이다. */
export type BundleListGroup = 'awaiting-review' | 'generating' | 'failed' | 'processed';

/** 멘션 묶음이 상태에 따라 펼친 창의 어느 목록 묶음에 드는지 돌려준다. */
export function listGroupOf(status: BundleStatus): BundleListGroup {
  switch (status) {
    case 'generating':
      return 'generating';
    case 'ready':
    case 'repo-check-needed':
    case 'posting':
      return 'awaiting-review';
    case 'failed':
    case 'post-failed':
      return 'failed';
    case 'posted':
    case 'ignored':
    case 'already-answered':
    case 'source-gone':
      return 'processed';
  }
}

/** 처리됨 상태. 게시됨·무시함·이미 답함·원문 사라짐이다. */
export type ProcessedStatus = Extract<BundleStatus, 'posted' | 'ignored' | 'already-answered' | 'source-gone'>;

/** 처리됨(게시됨·무시함·이미 답함·원문 사라짐)인지 본다. 처리됨 묶음은 작은 창 대기열에 없고 되돌릴 수만 있다. */
export function isProcessed(status: BundleStatus): status is ProcessedStatus {
  return listGroupOf(status) === 'processed';
}

/** Flow에 내 답이 생겼거나 멘션이 사라져 자동으로 처리됨이 된 상태(이미 답함, 원문 사라짐)인지 본다. 되돌릴 때 그 까닭을 기록해 이후 판정에서 뺀다. */
export function isAutoProcessed(status: BundleStatus): boolean {
  return status === 'already-answered' || status === 'source-gone';
}

/** 처리됨에서 되돌릴 수 있는 상태인지 본다. 게시됨은 되돌릴 수 없다. */
export function isRestorable(status: BundleStatus): boolean {
  return status === 'ignored' || status === 'already-answered' || status === 'source-gone';
}

/**
 * 준비된 뒤의 변화 감시 대상인지 본다. 사용자 행동을 기다리는 준비됨·실패·게시 실패·저장소 확인 필요다.
 * 생성 중 묶음은 생성이 끝난 뒤 첫 주기부터 보고, 게시 중 묶음은 게시가 다룬다.
 */
export function isWatched(status: BundleStatus): boolean {
  return status === 'ready' || status === 'failed' || status === 'post-failed' || status === 'repo-check-needed';
}

/** 저장소 선택 창으로 고른 구성으로 만들 수 있는 상태인지 본다. 준비됨(다른 저장소로 다시 만들기)과 저장소 확인 필요(저장소를 골라 만들기)다. */
export function canPickRepos(status: BundleStatus): boolean {
  return status === 'ready' || status === 'repo-check-needed';
}

/** 초안을 편집하고 받는 사람을 뺄 수 있는 상태인지 본다. 준비됨과 게시 실패다. */
export function canEditDraft(status: BundleStatus): boolean {
  return status === 'ready' || status === 'post-failed';
}

/** 초안을 다시 만들 수 있는 상태인지 본다(다시 만들기, 지시 덧붙이기, 요구 고치기). 준비됨이다. 게시 실패는 편집과 다시 게시만 한다. */
export function canRegenerate(status: BundleStatus): boolean {
  return status === 'ready';
}

/** [게시]나 [다시 게시]로 게시를 시작할 수 있는 상태인지 본다. 준비됨과 게시 실패다. 게시 중이면 이미 게시하고 있다. */
export function canPost(status: BundleStatus): boolean {
  return status === 'ready' || status === 'post-failed';
}

/**
 * 사용자가 초안·요구·지시 가운데 하나라도 손댔는지 본다. 편집본이 있거나, 요구를 고쳤거나, 지시를 덧붙였으면 손댄 것이다.
 * 받는 사람을 뺀 것은 손댐이 아니다. 받는 사람은 초안 텍스트 밖에 있어 다시 만들어도 덮어쓰지 않기 때문이다.
 */
export function isDraftTouched(bundle: Pick<MentionBundle, 'editedText' | 'fixedRequirement' | 'directives'>): boolean {
  return bundle.editedText !== null || bundle.fixedRequirement !== null || bundle.directives.length > 0;
}

/** 트레이 숫자에 세는 상태인지 본다. 검토 대기 가운데 준비됨과 저장소 확인 필요다. 게시 중은 검토 대기에 남지만 세지 않는다. */
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
  /**
   * Flow에서 사라져(지워짐, 수정되어 내 표기가 빠짐, 볼 수 없음) 묶음에서 빠졌는지 여부. 준비된 뒤의 변화 감시가 정한다.
   * 빠진 멘션도 기록에는 남지만 묶음의 대기열 순서와 받는 사람에는 들지 않는다.
   */
  gone: boolean;
  /** 원문 사라짐에서 되돌릴 때 사라진 것으로 기록해, 이후 사라짐 판정에서 빼는 멘션인지 여부. 참이면 `gone`은 늘 거짓이다. */
  goneExcluded: boolean;
}

/** 묶음에 기록한 내 답. "이미 답함" 판정을 뒷받침한 답이다. */
export interface RecordedAnswer extends MyAnswer {
  /** 묶음을 되돌릴 때 기록해, 이후 "이미 답함" 판정에서 빼는 답인지 여부. 같은 답으로 다시 처리됨이 되지 않게 한다. */
  excluded: boolean;
}

/** 게시 실패의 사유. 상세 머리에 쉬운 말 한 줄로 보인다. */
export type PostFailureReason =
  /** `403`. 이 글에 댓글을 쓸 권한이 없다. */
  | 'forbidden'
  /** `404`, `412`. 게시물이나 머리 댓글이 지워졌다. */
  | 'gone'
  /** `400`, `422`와 그 밖의 거절. Flow가 글을 받지 않았다(길이 등). */
  | 'rejected'
  /** `429`가 `Retry-After`만큼 기다려 다시 보낸 뒤에도 왔다. */
  | 'rate-limited'
  /** 응답이 없거나 `5xx`였고, 그 자리를 다시 조회해도 게시 본문과 같은 내 글이 없었다. */
  | 'no-response';

/**
 * 게시 기록. 게시 요청을 보내기 직전에 게시 본문과 보낸 시각을 먼저 적고, 성공하면 올라간 글의 ID를, 실패하면 사유를 더한다.
 * 결과(`postedId`, `failure`)가 모두 없는 기록은 요청을 보냈지만 올라갔는지 아직 모르는 것이다.
 */
export interface PostingRecord {
  /** 게시 본문. Flow에 보낸 문자열 그대로다. */
  body: string;
  /** 게시 요청을 보낸 시각(Unix epoch 밀리초). 요청을 보내기 직전에 적는다. */
  sentAt: number;
  /** 올라간 글의 ID. 본문 묶음이면 새 댓글의 `commentId`, 댓글 스레드 묶음이면 대댓글의 `replyId`다. 결과를 받기 전이면 `null`. */
  postedId: string | null;
  /** 게시 실패의 사유. 게시 실패가 아니면 `null`. */
  failure: PostFailureReason | null;
  /**
   * 이 글이 답한 멘션 위치. 게시를 누를 때 조회한 내용에 있던 묶음의 멘션이다. 그 조회가 실패했거나 늦어 결과 없이 게시했으면
   * 게시 요청을 보낼 때 묶음에 남은 멘션이다. 이 PC가 게시한 글은 이 멘션에만 답한 것으로 보고 "이미 답함"을 판정한다.
   */
  answeredMentions: MentionLocation[];
}

/** 게시를 누를 때의 확인이 게시를 멈춘 까닭. 창은 이것으로 "게시하지 않았습니다: …" 토스트를 띄운다. */
export type PostStop =
  /** Flow에 이미 내 답이 있어 "이미 답함"으로 옮겼다. */
  | { kind: 'already-answered' }
  /** 멘션이 모두 사라져 "원문 사라짐"으로 옮겼다. */
  | { kind: 'source-gone' }
  /**
   * [게시]를 누를 때 화면에 없던 변화가 있어 준비됨으로 돌렸다. 확인이 끝나기 전에 합쳐진 새 멘션 수,
   * 화면에 보이던 내용 뒤에 새로 생긴 글 수(나를 멘션한 글 포함), 원문 수정 여부, 새로 사라진 멘션 수다.
   */
  | { kind: 'changed'; newMentionCount: number; newWritingCount: number; edited: boolean; goneMentionCount: number };

/** 이 PC가 게시한 글마다 그 글이 답한 멘션 위치(`mentionLocationKey`). 글의 ID(`commentId`·`replyId`)로 찾는다. */
export type PostedAnswerRanges = ReadonlyMap<string, ReadonlySet<string>>;

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
  /**
   * 준비된 뒤의 변화 감시가 마지막으로 조회한 맥락. 초안이 있는 묶음만 두고, 비교 기준(`context`)과 견주어 초안을 만든 뒤의 새 글과 수정된 원문을 가린다.
   * 원문 영역은 이것을 지금 내용으로 보인다. 아직 감시하지 않았거나 비교 기준이 바뀌었으면 `null`.
   */
  watchedContext: BundleContext | null;
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
  directives: string[];
  /** 사용자가 고친 요구. 요구 고치기로 다시 만드는 중이거나 그렇게 만든 초안이면 그 요구이고, 다른 재생성을 하면 지운다. 고친 적이 없으면 `null`. */
  fixedRequirement: string | null;
  /** 생성 중 묶음을 다시 만드는 재생성. 처음 만드는 묶음이거나 저장소 선택 창으로 다시 만들면 `null`. */
  regeneration: Regeneration | null;
  /** 생성이 실패한 까닭. 실패가 아니면 `null`. */
  failure: DraftFailure | null;
  /** 실행 기록. 실행한 순서다. */
  runs: RunRecord[];
  /** 게시 기록. 게시 요청을 보내기 전이거나(카운트다운 중 포함) 게시하지 않았으면 `null`. */
  posting: PostingRecord | null;
}

/**
 * 최소 기록. 처리됨 목록에서 빠진 묶음의 ID와 상태만 남긴 것이다. 송신자 이름과 글 내용은 넣지 않는다.
 * 같은 멘션 위치에서 다시 온 알림을 막고, 이 PC가 게시한 글이 답한 범위로 "이미 답함"을 판정하는 데 쓴다. 계정이 바뀔 때까지 남는다.
 */
export interface MinimalRecord extends BundlePlace {
  /** 빠지기 전 묶음의 ID. */
  bundleId: number;
  /** 묶음에 있던 멘션 위치 전부. 이미 답함으로 빠지거나 사라진 멘션도 넣는다. */
  mentions: MentionLocation[];
  /** 마지막 상태. */
  status: ProcessedStatus;
  /** 처리한 시각(Unix epoch 밀리초). */
  processedAt: number;
  /** 이 PC가 게시한 글의 ID(`commentId`·`replyId`). 게시됨이 아니면 `null`. */
  postedId: string | null;
  /** 이 PC가 게시한 글이 답한 멘션 위치. 게시됨이 아니면 비어 있다. */
  answeredMentions: MentionLocation[];
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

/** 묶음에 남은 멘션. "이미 답함"으로 빠진 멘션과 사라진 멘션을 뺀 것이다. */
export function activeMentions(bundle: Pick<MentionBundle, 'mentions'>): BundledMention[] {
  return bundle.mentions.filter((mention) => !mention.answered && !mention.gone);
}

/**
 * 묶음의 멘션마다 "이미 답함"을 다시 판정한다. 되돌릴 때 기록한 답은 세지 않는다.
 * 이 PC가 게시한 글(`postedRanges`에 있는 답)은 그 글이 답한 범위의 멘션에만 답한 것으로 보고 시각은 보지 않는다.
 * 그 밖의 답은 그 멘션보다 나중에 썼으면 답한 것이다. 시각은 Flow 시각끼리 비교하고(PC 시계는 쓰지 않음), 읽을 수 없거나 같은 초면 답하지 않은 것으로 본다.
 * 잘못 건너뛰면 멘션을 놓치지만, 잘못 만든 묶음은 한 번 무시하면 끝나기 때문이다.
 */
export function judgeAnswered(
  mentions: readonly BundledMention[],
  answers: readonly RecordedAnswer[],
  postedRanges: PostedAnswerRanges,
): BundledMention[] {
  /** 세는 답. */
  const counted = answers.filter((answer) => !answer.excluded);
  /** 시각으로 판정하는 답 가운데 가장 나중에 쓴 시각. */
  let latestAnswerAt: number | null = null;
  for (const answer of counted) {
    if (postedRanges.has(answer.answerId)) continue;
    /** 답을 쓴 시각. */
    const at = flowTimeToEpochMs(answer.registeredDateTime);
    if (at !== null && (latestAnswerAt === null || at > latestAnswerAt)) latestAnswerAt = at;
  }

  return [...mentions].sort(compareMentions).map((mention) => {
    /** 멘션 위치. */
    const location = mentionLocationKey(mention);
    /** 멘션 시각. */
    const at = flowTimeToEpochMs(mention.registeredDateTime);
    /** 이 PC가 게시한 글이 답한 범위에 드는지 여부. */
    const inPostedRange = counted.some((answer) => postedRanges.get(answer.answerId)?.has(location) === true);
    return { ...mention, answered: inPostedRange || (latestAnswerAt !== null && at !== null && latestAnswerAt > at) };
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
