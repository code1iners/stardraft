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
 * 저장소 기준 경로(`/` 구분)가 비밀 파일 패턴 가운데 하나에 맞는지 본다. 실행기의 deny 규칙처럼 경로의 어느 깊이에서든 맞춘다.
 * 패턴의 `**`는 경로 구분자를 넘어서, `*`와 `?`는 한 조각 안에서 맞춘다. 대소문자를 가리지 않는다(대소문자를 가리지 않는 파일 시스템에서 `.ENV`도 `.env`다).
 */
export function matchesSecretPattern(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => secretPatternRegExp(pattern).test(path));
}

/** 패턴 하나를 경로 전체에 맞출 정규식으로 바꾼다. 앞에 붙은 `/`와 `**` 조각은 "어느 깊이에서든"과 같으므로 뗀다. */
function secretPatternRegExp(pattern: string): RegExp {
  /** 앞을 뗀 패턴. */
  const body = pattern.replace(/^(?:\/|\*\*\/)+/, '');
  /** 패턴을 정규식으로 옮긴 것. */
  let source = '';
  for (let index = 0; index < body.length; index += 1) {
    /** 지금 글자. */
    const char = body[index] as string;
    if (char === '*' && body[index + 1] === '*') {
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
  return new RegExp(`^(?:.*/)?${source}$`, 'i');
}
