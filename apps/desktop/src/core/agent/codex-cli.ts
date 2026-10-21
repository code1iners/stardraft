import type { CliCommand, ListedModel, LoginCheck } from './agent-cli';

/** Codex CLI의 명령 이름. */
export const CODEX_COMMAND_NAME = 'codex';

/**
 * 실행 계약의 필수 플래그 묶음을 실측한 가장 낮은 Codex 버전.
 * 권한 프로필은 문서에 베타로 표기되어 있고, 묶음의 플래그와 설정 키(`features.goals` 등)는 0.162.1·0.163.0에서만 확인했다.
 */
export const MIN_CODEX_VERSION = '0.162.1';

/**
 * 이 CLI를 업데이트하는 명령. Homebrew cask 설치본은 brew 명령, npm 설치본(JS 래퍼)은 래퍼가 안내하는 npm 명령을 쓴다.
 * 그 밖(독립 설치)은 CLI의 `update` 명령이다.
 * @param realPath 링크를 푼 CLI 실제 경로.
 * @param cliCommand 터미널에서 이 CLI를 부르는 말.
 */
export function codexUpdateCommand(realPath: string, cliCommand: string): string {
  // cask 설치본은 `Caskroom/codex/<버전>/bin/codex`에 있다.
  if (/\/Caskroom\/codex\/[^/]+\/bin\/codex$/.test(realPath)) return 'brew upgrade --cask codex';
  if (/\/@openai\/codex\/bin\/codex\.js$/.test(realPath)) return 'npm install -g @openai/codex@latest';
  return `${cliCommand} update`;
}

/**
 * `codex login status`로 로그인을 확인한다. 실제 CLI(0.163.0)는 결과를 표준 오류로 낸다.
 * 로그인되어 있으면 종료 코드 0과 `Logged in using ChatGPT`(또는 `an API key`), 아니면 종료 코드 1과 `Not logged in`이다.
 */
export async function checkCodexLogin(runCli: CliCommand): Promise<LoginCheck> {
  /** 로그인 상태 명령 결과. */
  const result = await runCli(['login', 'status']);
  /** 받은 출력. */
  const output = result.kind === 'exited' || result.kind === 'timed-out' || result.kind === 'aborted' ? `${result.stderr}\n${result.stdout}` : '';
  if (result.kind === 'exited' && result.exitCode === 0) return { ok: true, authMethod: codexAuthMethod(output) };
  if (result.kind === 'exited' && /^Not logged in\b/m.test(output)) return { ok: false, reason: 'not-logged-in', authMethod: null };
  return { ok: false, reason: 'unreadable', authMethod: null, failedResult: result };
}

/** 로그인 상태 문장에서 로그인 방식. 모르는 문장이면 `null`. */
function codexAuthMethod(output: string): string | null {
  if (/Logged in using ChatGPT/.test(output)) return 'chatgpt';
  if (/Logged in using an API key/.test(output)) return 'api-key';
  return null;
}

/**
 * `codex debug models`에서 모델 선택 상자에 넣을 모델을 읽는다. `visibility`가 `list`인 모델을 `priority` 순서로 쓴다.
 * 출력은 `{"models":[…]}` JSON 한 줄이고 항목마다 기본 지침이 들어 있어 수백 KB이므로, 길이 상한이 없는 줄 단위로 받는다.
 * 명령이 실패하거나 모양이 다르면 빈 목록이고, 화면에는 "기본 모델"만 남는다.
 */
export async function readCodexModels(runCli: CliCommand): Promise<ListedModel[]> {
  /** 표준 출력의 줄. */
  const lines: string[] = [];
  /** 모델 목록 명령 결과. */
  const result = await runCli(['debug', 'models'], (line) => lines.push(line));
  if (result.kind !== 'exited' || result.exitCode !== 0) return [];
  /** JSON으로 푼 출력. */
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines.join('\n'));
  } catch {
    return [];
  }
  /** 모델 항목. */
  const models = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>).models : undefined;
  if (!Array.isArray(models)) return [];

  /** 목록에 넣을 모델과 우선순위. */
  const listed: (ListedModel & { priority: number })[] = [];
  for (const model of models) {
    if (typeof model !== 'object' || model === null) continue;
    /** 모델 필드. */
    const { slug, display_name: displayName, visibility, priority } = model as Record<string, unknown>;
    if (visibility !== 'list' || typeof slug !== 'string' || slug === '' || listed.some((item) => item.id === slug)) continue;
    listed.push({
      id: slug,
      label: typeof displayName === 'string' && displayName !== '' ? displayName : slug,
      priority: typeof priority === 'number' ? priority : Number.POSITIVE_INFINITY,
    });
  }
  return listed.sort((a, b) => a.priority - b.priority).map(({ id, label }) => ({ id, label }));
}
