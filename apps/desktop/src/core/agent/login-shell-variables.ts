import { LOGIN_SHELL_TIMEOUT_MS } from './cli-discovery';
import type { ProcessRunner } from './process-runner';

/** 셸 명령에 넣을 수 있는 환경 변수 이름. 이 모양이 아닌 이름은 읽지 않는다(셸 명령에 그대로 들어가므로). */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** 변수마다 값의 시작을 알리는 표지의 앞부분. 뒤에 변수 이름이 붙는다. */
const VALUE_MARKER = '__STARDRAFT_VAR__';
/** 읽을 부분의 끝 표지. */
const END_MARKER = '__STARDRAFT_VARS_END__';

/** 셸 명령에 넣을 수 있는 환경 변수 이름인지 본다. */
export function isVariableName(name: string): boolean {
  return VARIABLE_NAME.test(name);
}

/**
 * 로그인 셸(`<셸> -ilc`)을 한 번 띄워 `names`의 값만 읽는다. MCP 정의가 참조한 변수(토큰 등)는 사용자 rc 파일에만 있는 경우가 많다.
 * 명령은 zsh, bash, fish에서 모두 뜻이 같게 `printf`와 `printenv`만 쓴다. 값이 비었거나 없는 변수, 이름 모양이 아닌 변수는 결과에 없다.
 * 셸을 읽지 못하면(제한 시간, 실행 실패) 빈 결과다. 값은 돌려주기만 하고 어디에도 남기지 않는다.
 */
export async function readLoginShellVariables(options: {
  /** 프로세스 실행기. */
  runner: ProcessRunner;
  /** 로그인 셸의 절대 경로. */
  shell: string;
  /** 셸에 넘길 환경 변수. */
  env: Record<string, string>;
  /** 셸의 작업 폴더. */
  cwd: string;
  /** 읽을 변수 이름. */
  names: readonly string[];
}): Promise<Record<string, string>> {
  /** 읽을 이름. 중복과 모양이 아닌 이름은 뺀다. */
  const names = [...new Set(options.names)].filter(isVariableName);
  if (names.length === 0) return {};
  /** 셸에 넘길 명령. 변수마다 표지 줄 다음에 값을 찍는다. */
  const script = [...names.flatMap((name) => [`printf '%s\\n' ${VALUE_MARKER}${name}`, `printenv ${name}`]), `printf '%s\\n' ${END_MARKER}`].join('; ');
  /** 셸을 띄운 결과. */
  const result = await options.runner.run({ command: options.shell, args: ['-ilc', script], env: options.env, cwd: options.cwd, timeoutMs: LOGIN_SHELL_TIMEOUT_MS });
  if (result.kind !== 'exited') return {};
  return parseVariables(result.stdout, names);
}

/** 셸 출력에서 표지 사이의 값을 꺼낸다. rc 파일의 출력이 앞뒤에 섞여 있을 수 있다. */
function parseVariables(stdout: string, names: readonly string[]): Record<string, string> {
  /** 줄 단위 출력. */
  const lines = stdout.split('\n');
  /** 끝 표지 줄의 위치. 없으면 출력이 중간에 끊긴 것이라 읽지 않는다. */
  const end = lines.lastIndexOf(END_MARKER);
  if (end < 0) return {};
  /** 읽은 값. */
  const values: Record<string, string> = {};
  /** 다음 이름의 표지를 찾기 시작할 줄. */
  let from = 0;
  for (const [index, name] of names.entries()) {
    /** 이 변수의 표지 줄. */
    const start = lines.indexOf(`${VALUE_MARKER}${name}`, from);
    if (start < 0 || start > end) return values;
    /** 다음 변수의 표지 줄이나 끝 표지 줄. */
    const nextName = names[index + 1];
    /** 다음 표지의 위치. */
    const next = nextName === undefined ? end : lines.indexOf(`${VALUE_MARKER}${nextName}`, start + 1);
    if (next < 0) return values;
    // printenv가 붙인 마지막 줄바꿈은 split에서 빈 칸이 되지 않고 다음 표지 줄로 넘어가므로, 값 줄을 다시 이어 붙이면 된다.
    /** 값. 여러 줄일 수 있다. */
    const value = lines.slice(start + 1, next).join('\n');
    if (value !== '') values[name] = value;
    from = next;
  }
  return values;
}
