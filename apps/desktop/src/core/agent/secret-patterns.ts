/**
 * 앱에 넣어 둔 비밀 파일 패턴(gitignore 문법). 모든 실행기에 같은 목록을 적용한다.
 * 사용자는 설정에서 이 목록에 더하기만 하고 뺄 수 없다.
 * `.git/**`은 원격 주소의 토큰과 git 객체에 남은 비밀 사본을 막는다. `application-prod.yml` 같은 설정 파일은 정당한 근거라 넣지 않는다.
 */
export const DEFAULT_SECRET_PATTERNS: readonly string[] = [
  '.env',
  '.env.*',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  'id_rsa*',
  'id_ed25519*',
  '.npmrc',
  '.pypirc',
  '.netrc',
  'secrets/**',
  '.git/**',
];

/** 기본 목록 뒤에 추가 패턴을 붙인다. 기본 목록에 이미 있거나 겹치는 패턴은 한 번만 넣는다. */
export function withDefaultSecretPatterns(patterns: readonly string[]): string[] {
  return [...new Set([...DEFAULT_SECRET_PATTERNS, ...patterns])];
}

/**
 * 경로(`/` 구분)가 비밀 파일 패턴 가운데 하나에 맞는지 본다. 실행기의 deny 규칙처럼 경로의 어느 깊이에서든 맞춘다.
 * 패턴이 폴더에 맞으면 그 안의 파일도 모두 맞는다(gitignore처럼 `secrets`, `secrets/`도 폴더 안 전부).
 * `**`는 경로 구분자를 넘어서 맞추고, 가운데의 `**` 조각은 0단계도 맞는다(`deploy`와 `vault.yml` 사이의 `**`는 `deploy/vault.yml`에도 맞음).
 * `*`와 `?`는 한 조각 안에서 맞춘다.
 * 대소문자를 가리지 않는다(대소문자를 가리지 않는 파일 시스템에서 `.ENV`도 `.env`다). 판정이 실행기보다 넓어지는 쪽이라 안전하다.
 */
export function matchesSecretPattern(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => secretPatternRegExp(pattern).test(path));
}

/** 패턴 하나를 경로 전체에 맞출 정규식으로 바꾼다. 앞에 붙은 `/`와 `**` 조각은 "어느 깊이에서든"과 같고, 끝의 `/`는 "폴더"라는 뜻이라 뗀다. */
function secretPatternRegExp(pattern: string): RegExp {
  /** 앞뒤를 뗀 패턴. */
  const body = pattern.replace(/^(?:\/|\*\*\/)+/, '').replace(/\/+$/, '');
  /** 패턴을 정규식으로 옮긴 것. */
  let source = '';
  for (let index = 0; index < body.length; index += 1) {
    /** 지금 글자. */
    const char = body[index] as string;
    if (body.startsWith('/**/', index)) {
      source += '/(?:.*/)?';
      index += 3;
    } else if (body.startsWith('**', index)) {
      source += '.*';
      index += 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^(?:.*/)?${source}(?:/.*)?$`, 'i');
}

/** 추가 비밀 파일 패턴 하나의 가장 긴 길이. */
export const SECRET_PATTERN_MAX_LENGTH = 200;

/**
 * 사용자가 추가하려는 비밀 파일 패턴을 읽는다. 앞뒤 공백을 뗀 패턴을 돌려주고, 쓸 수 없으면 그 까닭을 돌려준다.
 * 패턴은 실행기의 deny 규칙(Claude `Read(//**\/<패턴>)`, Codex `"**\/<패턴>"="deny"`)에 그대로 들어가므로
 * 규칙을 깨는 따옴표·괄호·역슬래시와 제어 문자는 받지 않는다. gitignore의 되돌리기(`!`로 시작)는 막을 파일을 줄이는 것이라 받지 않는다.
 */
export function readSecretPattern(input: string): { kind: 'pattern'; pattern: string } | { kind: 'empty' | 'invalid' } {
  /** 앞뒤 공백을 뗀 패턴. */
  const pattern = input.trim();
  if (pattern === '') return { kind: 'empty' };
  // eslint-disable-next-line no-control-regex
  if (pattern.length > SECRET_PATTERN_MAX_LENGTH || pattern.startsWith('!') || /["\\()\u0000-\u001f\u007f]/.test(pattern)) return { kind: 'invalid' };
  return { kind: 'pattern', pattern };
}

/** 같은 패턴이 이미 목록에 있는지 본다. 판정이 대소문자를 가리지 않으므로 비교도 가리지 않는다. */
export function hasSecretPattern(patterns: readonly string[], pattern: string): boolean {
  /** 견줄 패턴. */
  const lower = pattern.toLowerCase();
  return patterns.some((item) => item.toLowerCase() === lower);
}
