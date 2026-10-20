/** Claude Code CLI의 명령 이름. */
export const CLAUDE_COMMAND_NAME = 'claude';

/**
 * 실행 계약의 필수 플래그를 모두 지원하는 가장 낮은 Claude Code 버전.
 * 배포된 바이너리로 확인하면 `--restricted`는 2.1.248, 가장 늦게 생긴 `--permission-prompts`는 2.1.259부터 있다.
 */
export const MIN_CLAUDE_VERSION = '2.1.259';

/** 버전 확인과 로그인 확인 명령의 제한 시간(밀리초). */
export const CLI_COMMAND_TIMEOUT_MS = 10_000;

/** `claude --version` 출력(`2.1.303 (Claude Code)`)에서 버전을 꺼낸다. 없으면 `null`. */
export function parseCliVersion(output: string): string | null {
  return /\b(\d+)\.(\d+)\.(\d+)\b/.exec(output)?.[0] ?? null;
}

/** 두 `x.y.z` 버전을 비교한다. `a`가 낮으면 음수, 같으면 0, 높으면 양수. */
export function compareVersions(a: string, b: string): number {
  /** 숫자로 나눈 두 버전. */
  const [left, right] = [a, b].map((version) => version.split('.').map(Number));
  for (let index = 0; index < 3; index += 1) {
    /** 이 자리의 차이. */
    const diff = (left?.[index] ?? 0) - (right?.[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** `claude auth status` JSON 출력에서 앱이 쓰는 값. */
export interface ClaudeAuthStatus {
  /** 로그인되어 있는지 여부. */
  loggedIn: boolean;
  /** 로그인 방식(`claude.ai`, `api_key_helper`, `none` 등). 없으면 `null`. */
  authMethod: string | null;
}

/** `claude auth status` 출력(JSON)을 읽는다. 앱이 아는 모양이 아니면 `null`. */
export function parseClaudeAuthStatus(output: string): ClaudeAuthStatus | null {
  /** JSON으로 푼 출력. */
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  /** 필드를 읽기 위해 객체로 본 출력. */
  const record = parsed as Record<string, unknown>;
  if (typeof record.loggedIn !== 'boolean') return null;
  return { loggedIn: record.loggedIn, authMethod: typeof record.authMethod === 'string' ? record.authMethod : null };
}

/**
 * 이 CLI를 업데이트하는 명령. Homebrew cask 설치본은 Homebrew가 관리하므로(`claude update`도 "Claude is managed by Homebrew"라며 brew로 넘긴다) brew 명령을 쓴다.
 * @param realPath 링크를 푼 CLI 실제 경로.
 * @param cliCommand 터미널에서 이 CLI를 부르는 말.
 */
export function claudeUpdateCommand(realPath: string, cliCommand: string): string {
  /** Homebrew cask 이름(`claude-code`, `claude-code@latest` 등). cask 설치본은 `Caskroom/<cask>/<버전>/` 아래에 있다. */
  const cask = /\/Caskroom\/([^/]+)\/[^/]+\/claude$/.exec(realPath)?.[1];
  return cask ? `brew upgrade --cask ${cask}` : `${cliCommand} update`;
}
