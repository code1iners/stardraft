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
