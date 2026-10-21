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
