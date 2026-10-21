import type { FlowTextComponent } from '../ports/flow-api';
import { isSameFlowUser } from './user-id';

/** Flow 글의 멘션 표기 `@[표시 이름](사용자 ID)`. 두 번째 묶음이 사용자 ID다. */
const MENTION_MARKUP = /@\[([^\]]*)\]\(([^)\s]*)\)/g;

/** 글 안의 멘션 표기가 가리키는 사용자 ID. 나온 순서대로다. */
function mentionedUserIds(text: string): string[] {
  return [...text.matchAll(MENTION_MARKUP)].map((match) => match[2] ?? '');
}

/** 글 안에 `userId`를 가리키는 멘션 표기가 있는지 본다. */
export function hasMentionMarkupFor(text: string, userId: string): boolean {
  return mentionedUserIds(text).some((id) => isSameFlowUser(id, userId));
}

/**
 * 게시물 본문이 `userId`를 지목하는지 본다. TEXT 컴포넌트의 `MENTIONS`에 그 ID가 있거나 `CONTENTS`에 그 사람의 멘션 표기가 있으면 지목한 것이다.
 * 둘 다 본다. `@전체`는 `MENTIONS`에 `ALL`로 오므로 걸리지 않는다.
 */
export function postBodyMentions(components: readonly FlowTextComponent[], userId: string): boolean {
  return components.some(({ contents, mentions }) => mentions.some((id) => isSameFlowUser(id, userId)) || hasMentionMarkupFor(contents, userId));
}

/** 화면에 보일 글의 한 조각. */
export interface MarkupPart {
  /** 글. 멘션 표기는 `@이름`이다. */
  text: string;
  /** 멘션 표기인지 여부. */
  mention: boolean;
}

/**
 * 글을 화면에 보일 조각으로 나눈다. 멘션 표기 `@[이름](사용자 ID)`는 `@이름` 조각이 되고 사용자 ID는 버린다.
 * 화면은 조각을 글자로만 그린다(HTML로 해석하지 않음).
 */
export function splitMentionMarkup(text: string): MarkupPart[] {
  /** 나눈 조각. */
  const parts: MarkupPart[] = [];
  /** 아직 조각으로 옮기지 않은 글의 시작 위치. */
  let rest = 0;
  for (const match of text.matchAll(MENTION_MARKUP)) {
    if (match.index > rest) parts.push({ text: text.slice(rest, match.index), mention: false });
    parts.push({ text: `@${match[1] ?? ''}`, mention: true });
    rest = match.index + match[0].length;
  }
  if (rest < text.length) parts.push({ text: text.slice(rest), mention: false });
  return parts;
}

/** 멘션 표기 `@[이름](ID)`를 `@이름`으로 바꾼 글. 에이전트에게 Flow 사용자 ID를 넘기지 않을 때 쓴다. */
export function namedMentionText(text: string): string {
  return splitMentionMarkup(text)
    .map((part) => part.text)
    .join('');
}
