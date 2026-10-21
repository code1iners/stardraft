import { isSameFlowUser } from './user-id';

/** Flow 글의 멘션 표기 `@[표시 이름](사용자 ID)`. 두 번째 묶음이 사용자 ID다. */
const MENTION_MARKUP = /@\[([^\]]*)\]\(([^)\s]*)\)/g;

/** 글 안의 멘션 표기가 가리키는 사용자 ID. 나온 순서대로다. */
export function mentionedUserIds(text: string): string[] {
  return [...text.matchAll(MENTION_MARKUP)].map((match) => match[2] ?? '');
}

/** 글 안에 `userId`를 가리키는 멘션 표기가 있는지 본다. */
export function hasMentionMarkupFor(text: string, userId: string): boolean {
  return mentionedUserIds(text).some((id) => isSameFlowUser(id, userId));
}
