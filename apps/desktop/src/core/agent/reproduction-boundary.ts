import { DEFAULT_SECRET_PATTERNS, withDefaultSecretPatterns } from './secret-patterns';

/**
 * 재현하는 진단의 자식 프로세스에 넘기는 환경 변수 이름. 이 밖의 변수(토큰, 클라우드 자격 증명 등)는 넘기지 않는다.
 * 로그인과 설정 폴더를 찾는 변수, 로캘, 임시 폴더, 셸, 모바일 개발 도구를 찾는 변수다. 셸 명령도 이 환경을 그대로 받는다.
 */
const REPRODUCTION_ENV_NAMES: readonly string[] = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TMPDIR',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
  'DEVELOPER_DIR',
  'ANDROID_HOME',
  'ANDROID_SDK_ROOT',
  'JAVA_HOME',
];

/** 실행기가 재현하는 진단의 환경에 직접 정하는 변수 이름. 프록시, 백그라운드 명령 대기 상한, Codex MCP 연결 실패 로그다. */
const EXECUTOR_ENV_NAMES: readonly string[] = ['NODE_USE_ENV_PROXY', 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', 'RUST_LOG'];

/** 자식 환경에서 재현하는 진단에 넘길 최소 목록만 남긴다. */
export function reproductionEnv(env: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(REPRODUCTION_ENV_NAMES.flatMap((name) => (env[name] === undefined ? [] : [[name, env[name]]])));
}

/**
 * 재현하는 진단의 환경에서 앱이 정하는 변수 이름인지 본다(최소 목록과 실행기가 정하는 값). MCP 정의가 이 이름을 참조하면
 * 로그인 셸에서 다시 읽지 않고 앱이 정한 값을 쓰며, 정의의 평문 값으로 이 이름을 덮지 않는다.
 */
export function isReservedEnvName(name: string): boolean {
  return REPRODUCTION_ENV_NAMES.includes(name) || EXECUTOR_ENV_NAMES.includes(name);
}

/** 사본에서 풀어 주는 `.env` 계열 패턴. 앱 기본 목록의 두 패턴만이고, 사용자가 더한 `.env.production` 같은 패턴은 계속 막는다. */
export const ENV_FILE_PATTERNS: readonly string[] = DEFAULT_SECRET_PATTERNS.filter((pattern) => pattern === '.env' || pattern === '.env.*');

/**
 * 저장소 밖에서 계속 막는 개인 비밀 경로. 홈 기준이다. 정해진 목록만 막고 그 밖의 홈 경로는 막지 않는다.
 * `~/.claude.json`은 앱이 MCP 정의를 읽는 경로라 이 목록에 넣지 않는다.
 */
export const PERSONAL_SECRET_PATHS: readonly string[] = [
  '~/.ssh',
  '~/.aws',
  '~/.npmrc',
  '~/.netrc',
  '~/.pypirc',
  '~/.config/gh',
  '~/.kube',
  '~/.docker',
  '~/.gnupg',
  '~/.config/gcloud',
  '~/.codex',
];

/**
 * 사본 안에서 계속 막을 비밀 파일 패턴. 기본 목록과 추가 패턴에서 `.env` 계열만 뺀다. 앞에 붙은 `/`·`**\/`는 뗀다("어느 깊이에서든"과 같다).
 * 끝의 `/`("폴더")는 남긴다. 규칙 문법에 따라 실행기가 다룬다.
 * `.git/**`도 남아, 사본 안 linked worktree의 `.git` 포인터 파일을 통한 원본 git 접근도 막는다.
 */
export function copySecretPatterns(extraPatterns: readonly string[]): string[] {
  return [
    ...new Set(
      withDefaultSecretPatterns(extraPatterns)
        .filter((pattern) => !ENV_FILE_PATTERNS.includes(pattern))
        .map((pattern) => pattern.replace(/^(?:\/|\*\*\/)+/, '')),
    ),
  ];
}
