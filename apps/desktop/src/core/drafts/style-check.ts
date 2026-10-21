import type { MentionBundle } from '../bundles/mention-bundle';
import type { ContextWriting } from '../flow/bundle-context';
import { namedMentionText } from '../flow/mention-markup';

/** 백틱으로 감싼 말. 닫는 백틱이 없으면 백틱 하나만 짚는다. */
const BACKTICK = /`[^`\n]*`|`/g;

/** 한글 사이에 섞인 영문·숫자 덩어리. 경로 구분자와 점 표기까지 한 덩어리로 본다. */
const ASCII_RUN = /[A-Za-z0-9_@.\-/\\]+/g;

/** 덩어리 앞뒤에 붙은 문장 부호. 문장 끝의 마침표나 줄표는 용어가 아니다. */
const EDGE_PUNCTUATION = /^[.\-/\\]+|[.\-/\\]+$/g;

/** 파일 확장자처럼 생긴 끝 조각. 영문으로 시작하는 다섯 글자 이하다. */
const FILE_EXTENSION = /^[A-Za-z][A-Za-z0-9]{0,4}$/;

/** 점 표기 키의 조각. 영문이나 밑줄로 시작한다. */
const KEY_SEGMENT = /^[A-Za-z_][\w-]*$/;

/** 대문자 상수. 밑줄로 이은 대문자 낱말이다. 밑줄이 없는 약어(API 등)는 짚지 않는다. */
const UPPER_CONSTANT = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

/** snake_case. */
const SNAKE_CASE = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+$/;

/** camelCase. 소문자로 시작해 중간에 대문자가 있다. */
const CAMEL_CASE = /^[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*$/;

/** 문체 검사에서 뺄 단어. 멘션 원문과 맥락에 나온 말이다. */
export type SourceWords = ReadonlySet<string>;

/**
 * 글에서 문체 검사가 뺄 단어를 모은다. 송신자가 직접 쓴 용어는 초안에 그대로 써도 된다.
 * 멘션 표기의 사용자 ID는 글에 보이지 않으므로 뺄 단어에 넣지 않는다.
 */
export function sourceWords(texts: readonly string[]): SourceWords {
  /** 모은 단어. */
  const words = new Set<string>();
  for (const text of texts) {
    /** 멘션 표기를 `@이름`으로 바꾼 글. */
    const named = namedMentionText(text);
    for (const match of named.matchAll(BACKTICK)) words.add(match[0]);
    // 백틱 안의 말도 송신자가 쓴 말이므로 백틱 없이 써도 뺀다.
    for (const run of asciiRuns(named)) words.add(run);
  }
  return words;
}

/**
 * 묶음에서 문체 검사가 뺄 단어. 묶인 멘션 전부(빠진 멘션 포함), 게시물 제목, 맥락의 게시물 본문과 댓글·대댓글에 나온 말이다.
 * 맥락을 조회하지 않았으면 멘션과 게시물 제목만 쓴다.
 */
export function bundleSourceWords(bundle: Pick<MentionBundle, 'postTitle' | 'mentions' | 'context'>): SourceWords {
  /** 맥락의 글. */
  const writings: ContextWriting[] = [];
  if (bundle.context) {
    /** 게시물, 대상 댓글 스레드, 다른 댓글. */
    const { post, targetThread, otherComments } = bundle.context;
    writings.push(post);
    for (const comment of [...(targetThread ? [targetThread] : []), ...otherComments]) writings.push(comment, ...comment.replies);
  }
  return sourceWords([
    bundle.postTitle,
    ...(bundle.context ? [bundle.context.post.title] : []),
    ...bundle.mentions.map((mention) => mention.text),
    ...writings.map((writing) => writing.contents),
  ]);
}

/**
 * 글에서 개발자 용어일 수 있는 말을 나온 순서대로 한 번씩 찾는다. 초안 문장과 근거 설명에 쓴다.
 * 백틱, 파일 확장자처럼 생긴 말, 경로 구분자, 점 표기 키, camelCase, snake_case, 대문자 상수를 짚고, `source`에 있는 말은 뺀다.
 */
export function developerTerms(text: string, source: SourceWords): string[] {
  /** 찾은 말. 넣은 순서가 나온 순서다. */
  const terms = new Set<string>();
  for (const match of text.matchAll(BACKTICK)) terms.add(match[0]);
  for (const run of asciiRuns(text.replace(BACKTICK, ' '))) {
    if (isDeveloperTerm(run)) terms.add(run);
  }
  return [...terms].filter((term) => !source.has(term));
}

/** 글 안의 영문·숫자 덩어리. 앞뒤 문장 부호를 뗐다. */
function asciiRuns(text: string): string[] {
  return [...text.matchAll(ASCII_RUN)].map((match) => match[0].replace(EDGE_PUNCTUATION, '')).filter(Boolean);
}

/** 덩어리 하나가 개발자 용어 모양인지 본다. */
function isDeveloperTerm(run: string): boolean {
  if (/[/\\]/.test(run)) {
    // 날짜(10/21)처럼 숫자만 나눈 것은 경로가 아니다.
    /** 경로 구분자로 나눈 조각. */
    const segments = run.split(/[/\\]/).filter(Boolean);
    return segments.length >= 2 && segments.some((segment) => /[A-Za-z]/.test(segment));
  }
  if (run.includes('.')) {
    /** 점으로 나눈 조각. */
    const segments = run.split('.');
    if (segments.some((segment) => segment === '')) return false;
    /** 파일 이름처럼 이름 하나와 확장자다. 소수(2.5)는 확장자가 숫자로 시작해 걸리지 않는다. */
    const fileName = segments.length === 2 && FILE_EXTENSION.test(segments[1] ?? '');
    return fileName || segments.every((segment) => KEY_SEGMENT.test(segment));
  }
  return UPPER_CONSTANT.test(run) || SNAKE_CASE.test(run) || CAMEL_CASE.test(run);
}
