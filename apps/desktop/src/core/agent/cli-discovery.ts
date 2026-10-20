import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import type { ProcessRunner } from './process-runner';

/** 로그인 셸에서 PATH를 읽는 제한 시간(밀리초). rc 파일이 멈춰도 이보다 오래 기다리지 않는다. */
export const LOGIN_SHELL_TIMEOUT_MS = 5_000;

/**
 * 로그인 셸 출력에서 앱이 읽을 부분을 감싸는 표지. rc 파일이 찍는 다른 출력과 섞이지 않게 한다.
 * 표지 사이에는 `command -v` 결과와 PATH가 차례로 온다.
 */
export const LOGIN_SHELL_MARKERS = {
  /** 읽을 부분의 시작. */
  begin: '__STARDRAFT_SHELL_BEGIN__',
  /** `command -v` 결과와 PATH의 경계. */
  path: '__STARDRAFT_SHELL_PATH__',
  /** 읽을 부분의 끝. */
  end: '__STARDRAFT_SHELL_END__',
} as const;

/** CLI를 찾을 때 기대는 OS 사실. */
export interface CliSearchContext {
  /** 실행 중인 OS. Windows만 다르게 다루고, 나머지는 macOS처럼 다룬다. */
  platform: NodeJS.Platform;
  /** 앱이 받은 환경 변수. */
  env: Readonly<Record<string, string | undefined>>;
  /** 사용자 홈 폴더. */
  homeDir: string;
  /** 실행할 수 있는 파일인지 본다. */
  isExecutableFile: (filePath: string) => Promise<boolean>;
}

/** 로그인 셸을 한 번 띄워 읽은 결과. */
export type LoginShellRead =
  /** 표지 사이를 읽었다. `commandPath`는 `command -v`가 절대 경로를 주지 않았으면 `null`이다. */
  | { kind: 'read'; commandPath: string | null; path: string }
  /** 제한 시간 안에 끝나지 않았다(rc 파일이 입력을 기다리는 등). */
  | { kind: 'timed-out' }
  /** 셸을 띄우지 못했거나 표지를 찾지 못했다. */
  | { kind: 'failed'; detail: string };

/**
 * 로그인 셸(`<셸> -ilc`)을 한 번 띄워 `command -v <commandName>`과 PATH를 읽는다.
 * 명령은 zsh, bash, fish에서 모두 뜻이 같게 `printf`, `command -v`, `printenv`만 쓴다.
 */
export async function readLoginShell(options: {
  /** 프로세스 실행기. */
  runner: ProcessRunner;
  /** 로그인 셸의 절대 경로. */
  shell: string;
  /** 셸에 넘길 환경 변수. 앱이 받은 그대로다. */
  env: Record<string, string>;
  /** 셸의 작업 폴더. */
  cwd: string;
  /** 찾을 명령 이름. */
  commandName: string;
}): Promise<LoginShellRead> {
  /** 셸에 넘길 명령. */
  const script = [
    `printf '%s\\n' ${LOGIN_SHELL_MARKERS.begin}`,
    `command -v ${options.commandName}`,
    `printf '%s\\n' ${LOGIN_SHELL_MARKERS.path}`,
    'printenv PATH',
    `printf '%s\\n' ${LOGIN_SHELL_MARKERS.end}`,
  ].join('; ');
  /** 셸을 띄운 결과. */
  const result = await options.runner.run({
    command: options.shell,
    args: ['-ilc', script],
    env: options.env,
    cwd: options.cwd,
    timeoutMs: LOGIN_SHELL_TIMEOUT_MS,
  });
  if (result.kind === 'timed-out') return { kind: 'timed-out' };
  if (result.kind === 'spawn-failed') return { kind: 'failed', detail: result.message };

  /** 표지 사이에서 읽은 값. */
  const parsed = parseLoginShellOutput(result.stdout);
  if (!parsed) return { kind: 'failed', detail: `로그인 셸 출력에서 표지를 찾지 못했습니다(종료 코드 ${String(result.exitCode)}).` };
  return { kind: 'read', ...parsed };
}

/** 로그인 셸 출력에서 표지 사이의 `command -v` 결과와 PATH를 꺼낸다. 표지가 없거나 PATH가 비었으면 `null`. */
function parseLoginShellOutput(stdout: string): { commandPath: string | null; path: string } | null {
  /** 줄 단위 출력. rc 파일의 출력이 앞뒤에 섞여 있을 수 있다. */
  const lines = stdout.split(/\r?\n/);
  /** 시작 표지 줄의 위치. */
  const begin = lines.indexOf(LOGIN_SHELL_MARKERS.begin);
  /** 경계 표지 줄의 위치. 시작 표지 뒤에서 찾는다. */
  const middle = begin < 0 ? -1 : lines.indexOf(LOGIN_SHELL_MARKERS.path, begin + 1);
  /** 끝 표지 줄의 위치. 경계 표지 뒤에서 찾는다. */
  const end = middle < 0 ? -1 : lines.indexOf(LOGIN_SHELL_MARKERS.end, middle + 1);
  if (end < 0) return null;

  /** PATH 값. */
  const path = lines.slice(middle + 1, end).join('').trim();
  if (path === '') return null;
  // zsh는 별칭·함수면 경로 대신 정의를 찍으므로 절대 경로만 받는다.
  /** `command -v`가 준 절대 경로. */
  const commandPath = lines.slice(begin + 1, middle).map((line) => line.trim()).find((line) => line.startsWith('/')) ?? null;
  return { commandPath, path };
}

/** 환경 변수 값을 읽는다. Windows는 이름의 대소문자를 가리지 않는다(`Path`와 `PATH`). */
export function envValue(env: CliSearchContext['env'], name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[name];
  /** 대소문자를 무시하고 이름이 같은 변수. */
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
}

/** OS에 맞는 경로 함수. */
function pathApi(platform: NodeJS.Platform) {
  return platform === 'win32' ? win32 : posix;
}

/** PATH의 폴더 목록. 빈 칸은 뺀다. */
export function pathEntries(pathValue: string, platform: NodeJS.Platform): string[] {
  return pathValue.split(pathApi(platform).delimiter).filter((entry) => entry.trim() !== '');
}

/** Windows에서 셸 없이 띄울 수 있는 실행 파일 확장자. `PATHEXT`에 있어도 `.ps1` 같은 것은 띄울 수 없어 뺀다. */
const WINDOWS_LAUNCHABLE_EXTENSIONS = ['.com', '.exe', '.bat', '.cmd'];

/** 폴더 안에서 `commandName`으로 찾을 파일 이름. Windows는 `PATHEXT` 순서대로 확장자를 붙인다. */
function executableNames(commandName: string, context: CliSearchContext): string[] {
  if (context.platform !== 'win32') return [commandName];
  /** 사용자의 실행 파일 확장자 목록. */
  const extensions = (envValue(context.env, 'PATHEXT', 'win32') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => WINDOWS_LAUNCHABLE_EXTENSIONS.includes(extension));
  return extensions.map((extension) => `${commandName}${extension}`);
}

/**
 * Windows의 Claude 데스크톱 앱(`WindowsApps\Claude.exe`)인지 본다. 파일 이름이 CLI와 같아 PATH 검색에 걸리지만 CLI가 아니다.
 */
export function isExcludedCandidate(filePath: string, platform: NodeJS.Platform): boolean {
  if (platform !== 'win32') return false;
  /** 비교할 경로 조각. Windows 경로는 대소문자를 가리지 않는다. */
  const parts = filePath.toLowerCase().split(/[\\/]/);
  return parts.at(-1) === 'claude.exe' && parts.includes('windowsapps');
}

/**
 * PATH의 폴더를 앞에서부터 보며 `commandName` 실행 파일을 찾는다.
 * `skipExcluded`면 CLI가 아닌 후보(Windows 데스크톱 앱)를 건너뛴다. 끄면 터미널에서 이름만 쳤을 때 실행될 파일을 찾는다.
 */
export async function findOnPath(
  commandName: string,
  pathValue: string,
  context: CliSearchContext,
  { skipExcluded }: { skipExcluded: boolean },
): Promise<string | null> {
  return findInDirs(commandName, pathEntries(pathValue, context.platform), context, skipExcluded);
}

/** 폴더 목록을 차례로 보며 `commandName` 실행 파일을 찾는다. */
export async function findInDirs(
  commandName: string,
  dirs: readonly string[],
  context: CliSearchContext,
  skipExcluded = true,
): Promise<string | null> {
  /** 폴더 안에서 찾을 파일 이름. */
  const names = executableNames(commandName, context);
  for (const dir of dirs) {
    for (const name of names) {
      /** 후보 파일. */
      const candidate = pathApi(context.platform).join(dir, name);
      if (skipExcluded && isExcludedCandidate(candidate, context.platform)) continue;
      if (await context.isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
}

/** PATH에서 못 찾았을 때 볼 알려진 설치 위치. 앞에서부터 본다. */
export function knownInstallDirs(context: Pick<CliSearchContext, 'platform' | 'env' | 'homeDir'>): string[] {
  if (context.platform !== 'win32') {
    return [posix.join(context.homeDir, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin'];
  }
  /** npm 전역 설치 위치의 부모(`%APPDATA%`). */
  const appData = envValue(context.env, 'APPDATA', 'win32');
  return [win32.join(context.homeDir, '.local', 'bin'), ...(appData ? [win32.join(appData, 'npm')] : [])];
}

/** 실제 파일 시스템에서 실행할 수 있는 파일인지 본다. 링크는 따라가고, 폴더는 아니다. */
export async function isExecutableFileOnDisk(filePath: string): Promise<boolean> {
  try {
    if (!(await stat(filePath)).isFile()) return false;
    // Windows는 실행 권한 비트가 없어 있는 파일이면 실행할 수 있다고 본다.
    if (process.platform !== 'win32') await access(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 터미널에서 이 CLI를 부르는 말. 이름만 쳐서 같은 파일이 실행되면 이름을, 아니면 따옴표로 감싼 절대 경로를 쓴다.
 * 화면의 명령 카드는 이 말을 앞에 붙여 사용자의 터미널(macOS 셸, Windows PowerShell)에서 그대로 돌게 한다.
 */
export function terminalCommand(cliPath: string, commandName: string, nameResolvesToCli: boolean, platform: NodeJS.Platform): string {
  if (nameResolvesToCli) return commandName;
  if (platform === 'win32') return `& '${cliPath.replaceAll("'", "''")}'`;
  return `'${cliPath.replaceAll("'", `'\\''`)}'`;
}

/** 자식 프로세스에 넘기지 않는 환경 변수. 구독 로그인을 전제로 하고, API 요금이 나가지 않게 한다. */
const EXCLUDED_AGENT_ENV_VARS = ['ANTHROPIC_API_KEY', 'CODEX_API_KEY'] as const;

/**
 * 에이전트 CLI 자식 프로세스의 환경 변수. 앱이 받은 환경에서 API 키 변수를 빼고 PATH를 `pathValue`로 바꾼다.
 * Windows는 이름의 대소문자를 가리지 않으므로 같은 이름의 변수를 모두 지운다.
 */
export function agentProcessEnv(
  appEnv: CliSearchContext['env'],
  pathValue: string,
  platform: NodeJS.Platform,
): Record<string, string> {
  /** 지울 변수 이름. Windows는 대문자로 비교한다. */
  const removed = new Set<string>([...EXCLUDED_AGENT_ENV_VARS, 'PATH']);
  /** 만들 환경. */
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(appEnv)) {
    if (value === undefined) continue;
    if (removed.has(platform === 'win32' ? key.toUpperCase() : key)) continue;
    env[key] = value;
  }
  env.PATH = pathValue;
  return env;
}

/** `dir`이 PATH에 없으면 맨 앞에 붙인다. */
export function prependPathEntry(pathValue: string, dir: string, platform: NodeJS.Platform): string {
  /** 지금 PATH의 폴더 목록. */
  const entries = pathEntries(pathValue, platform);
  if (entries.includes(dir)) return pathValue;
  return [dir, ...entries].join(pathApi(platform).delimiter);
}

/** 경로의 폴더 부분. */
export function parentDir(filePath: string, platform: NodeJS.Platform): string {
  return pathApi(platform).dirname(filePath);
}
