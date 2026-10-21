import { answerWritingKey, contextChanges, mentionWritingKey, type ContextChanges } from '../flow/context-changes';
import type { MentionBundle } from './mention-bundle';

/** 준비된 뒤의 변화 감시가 찾은 묶음의 변화. 알림 줄과 원문 영역의 태그가 이것을 보인다. */
export interface BundleChanges extends ContextChanges {
  /** Flow에서 사라져 묶음에서 빠진 멘션 수. */
  goneMentions: number;
}

/**
 * 묶음의 비교 기준과 변화 감시가 마지막으로 조회한 내용을 견준 변화. 초안을 만든 뒤의 새 글과 수정된 원문, 사라진 멘션 수다.
 * 묶음의 멘션(새 멘션으로 따로 알림)과 되돌릴 때 기록한 내 답(사용자가 보고 되돌림)은 새 글로 세지 않는다.
 * 감시한 내용이나 비교 기준이 없으면 새 글과 수정된 글은 없다.
 */
export function bundleChanges(bundle: Pick<MentionBundle, 'remarkId' | 'mentions' | 'answers' | 'context' | 'watchedContext'>): BundleChanges {
  /** 사라진 멘션 수. */
  const goneMentions = bundle.mentions.filter((mention) => mention.gone).length;
  if (!bundle.context || !bundle.watchedContext) return { newWritings: [], editedWritings: [], goneMentions };

  /** 새 글로 세지 않는 글의 키. */
  const notNew = new Set([
    ...bundle.mentions.flatMap((mention) => mentionWritingKey(mention) ?? []),
    ...bundle.answers.filter((answer) => answer.excluded).map((answer) => answerWritingKey(bundle, answer.answerId)),
  ]);
  return { ...contextChanges(bundle.context, bundle.watchedContext, notNew), goneMentions };
}
