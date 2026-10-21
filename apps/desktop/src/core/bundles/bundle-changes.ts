import { answerWritingKey, contextChanges, mentionWritingKey, type ContextChanges } from '../flow/context-changes';
import { mentionLocationKey } from '../detection/mention';
import type { BundleContext } from '../flow/bundle-context';
import type { MentionBundle } from './mention-bundle';

/** 준비된 뒤의 변화 감시가 찾은 묶음의 변화. 알림 줄과 원문 영역의 태그가 이것을 보인다. */
export interface BundleChanges extends ContextChanges {
  /** Flow에서 사라져 묶음에서 빠진 멘션 수. 내 답으로 이미 빠진 멘션은 세지 않는다. */
  goneMentions: number;
}

/** 변화를 셀 때 보는 묶음의 값. */
type ChangeSource = Pick<MentionBundle, 'remarkId' | 'mentions' | 'answers' | 'context' | 'watchedContext'>;

/**
 * 묶음의 비교 기준과 변화 감시가 마지막으로 조회한 내용을 견준 변화. 초안을 만든 뒤의 새 글과 수정된 원문, 사라진 멘션 수다.
 * 묶음의 멘션(새 멘션으로 따로 알림)과 되돌릴 때 기록한 내 답(사용자가 보고 되돌림)은 새 글로 세지 않는다.
 * 수정되어 내 표기가 빠진 멘션 글은 사라진 멘션으로 알리므로 수정된 글로 세지 않는다.
 * 감시한 내용이나 비교 기준이 없으면 새 글과 수정된 글은 없다.
 */
export function bundleChanges(bundle: ChangeSource): BundleChanges {
  /** 사라진 멘션 수. */
  const goneMentions = bundle.mentions.filter((mention) => mention.gone && !mention.answered).length;
  if (!bundle.context || !bundle.watchedContext) return { newWritings: [], editedWritings: [], goneMentions };
  return { ...changesBetween(bundle.context, bundle.watchedContext, bundle), goneMentions };
}

/**
 * [게시]를 누를 때 화면에 없던 변화. `shown`은 누를 때의 묶음이고, `checked`는 게시를 누를 때 조회한 내용을 반영한 묶음이다.
 * 화면에 보이던 내용(감시 내용, 없으면 비교 기준)과 조회한 내용(`checked`의 감시 내용)을 견주므로, 이미 알림 줄과 태그로 보인 변화는 들지 않는다.
 * 새로 생긴 글에는 아직 알림이 오지 않은 나를 멘션한 글도 든다. 새로 사라진 멘션은 누를 때 묶음에 남아 있다가 조회에서 사라진 것이다.
 */
export function unseenChanges(shown: ChangeSource, checked: ChangeSource): BundleChanges {
  /** 누를 때 사라진 것으로 보이던 멘션의 위치. */
  const shownGone = new Set(shown.mentions.filter((mention) => mention.gone).map(mentionLocationKey));
  /** 새로 사라진 멘션 수. */
  const goneMentions = checked.mentions.filter((mention) => mention.gone && !mention.answered && !shownGone.has(mentionLocationKey(mention))).length;
  /** 누를 때 화면에 보이던 내용. */
  const screen = shown.watchedContext ?? shown.context;
  if (!screen || !checked.watchedContext || checked.watchedContext === shown.watchedContext) return { newWritings: [], editedWritings: [], goneMentions };
  return { ...changesBetween(screen, checked.watchedContext, checked), goneMentions };
}

/** `before`와 `after`를 지켜볼 범위 안에서 견준다. 묶음의 멘션 글과 되돌릴 때 기록한 내 답은 새 글로, 사라진 멘션 글은 수정된 글로 세지 않는다. */
function changesBetween(before: BundleContext, after: BundleContext, bundle: ChangeSource): ContextChanges {
  /** 새 글로 세지 않는 글의 키. */
  const notNew = new Set([
    ...bundle.mentions.flatMap((mention) => mentionWritingKey(mention) ?? []),
    ...bundle.answers.filter((answer) => answer.excluded).map((answer) => answerWritingKey(bundle, answer.answerId)),
  ]);
  /** 사라진 멘션이 일어난 글의 키. */
  const goneWritings = new Set(bundle.mentions.filter((mention) => mention.gone).flatMap((mention) => mentionWritingKey(mention) ?? []));
  /** 견준 변화. */
  const changes = contextChanges(before, after, notNew);
  return { ...changes, editedWritings: changes.editedWritings.filter((key) => !goneWritings.has(key)) };
}
