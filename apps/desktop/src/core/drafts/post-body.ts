import { activeMentions, compareMentions, type MentionBundle } from '../bundles/mention-bundle';
import { mentionWritingOf } from '../flow/bundle-context';
import { isSameFlowUser } from '../flow/user-id';
import type { Draft } from './draft';

/** 받는 사람 한 명. 게시 본문 앞에서 `@[이름](ID)`로 다시 멘션한다. */
export interface Recipient {
  /** Flow 사용자 ID. */
  id: string;
  /** 표기에 넣을 이름. 비어 있을 수 있다. */
  name: string;
}

/**
 * 원래 초안을 편집기 텍스트로 바꾼다. 같은 문단의 문장은 공백 하나로 잇고 문단 사이에는 빈 줄 하나를 둔다.
 * 근거 번호는 화면 장식이라 넣지 않는다. 그래서 검토자가 본 글이 그대로 게시 본문이 된다.
 */
export function draftEditorText(draft: Pick<Draft, 'paragraphs'>): string {
  return draft.paragraphs.map((paragraph) => paragraph.sentences.map((sentence) => sentence.text).join(' ')).join('\n\n');
}

/**
 * 묶음의 받는 사람. 묶음에 남은 멘션의 송신자 전원을 중복 없이 처음 멘션한 순서로 두고, 사용자가 뺀 사람은 넣지 않는다.
 * "이미 답함"으로 빠진 멘션의 송신자는 넣지 않는다. 이름과 ID는 맥락(초안을 만들 때 조회한 글)의 `registerName`·`registerId`이고,
 * 맥락에서 멘션 글을 찾지 못하면(맥락이 없거나 옛 맥락이라 ID가 없음) 알림의 송신자를 쓴다.
 */
export function bundleRecipients(bundle: Pick<MentionBundle, 'mentions' | 'context' | 'removedRecipients'>): Recipient[] {
  /** 받는 사람. */
  const recipients: Recipient[] = [];
  for (const mention of activeMentions(bundle).sort(compareMentions)) {
    /** 맥락에서 찾은 멘션 글. */
    const writing = bundle.context && mentionWritingOf(bundle.context, mention);
    /** 맥락의 쓴 사람. ID가 없으면 쓰지 않는다. */
    const author = writing?.authorId ? { id: writing.authorId, name: writing.authorName } : null;
    /** 이 멘션의 송신자. */
    const recipient = author ?? { id: mention.senderId, name: mention.senderName };
    if (recipients.some((item) => isSameFlowUser(item.id, recipient.id))) continue;
    if (bundle.removedRecipients.some((id) => isSameFlowUser(id, recipient.id))) continue;
    recipients.push(recipient);
  }
  return recipients;
}

/** 게시 본문 길이 상한. Flow 댓글 `contents`의 상한이고 `String.length`로 센다. 넘으면 게시할 수 없다. */
export const POST_BODY_CHAR_LIMIT = 4_000;

/**
 * 게시 본문. 받는 사람의 `@[이름](ID)` 표기를 공백으로 이어 맨 앞에 두고, 공백 하나 뒤에 편집기 텍스트(앞뒤 공백을 뗌)를 같은 줄에서 잇는다.
 * 받는 사람이 없으면 편집기 텍스트만이다. 근거와 근거 번호, AI 초안 표시는 넣지 않는다.
 */
export function postBody(recipients: readonly Recipient[], editorText: string): string {
  /** 받는 사람 표기. */
  const markup = recipients.map(({ id, name }) => `@[${name}](${id})`).join(' ');
  /** 앞뒤 공백을 뗀 편집기 텍스트. */
  const text = editorText.trim();
  return markup ? `${markup} ${text}` : text;
}
