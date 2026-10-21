/**
 * Codex가 띄운 셸 명령을 진행 단계로 보일 수 있게 읽는다. Codex는 파일을 명령(`cat`, `sed -n`, `rg` 등)으로만 읽으므로,
 * 명령 줄에서 읽는 파일과 검색어를 꺼낸다. 진행 표시용이라 흔한 모양만 알아보고, 모르는 명령은 명령 줄을 그대로 보인다.
 */

/** 명령 하나가 하는 일. */
export type CodexCommand =
  /** 파일을 읽는다. 읽는 파일은 명령 줄에 쓴 경로 그대로다. */
  | { kind: 'read'; files: string[] }
  /** 파일 내용이나 파일 이름을 찾는다. */
  | { kind: 'search'; query: string }
  /** 폴더의 파일 목록을 본다. */
  | { kind: 'list' }
  /** 그 밖의 명령. `text`는 한 칸씩 띄운 명령 줄이다. */
  | { kind: 'other'; text: string };

/** 셸 명령 줄의 조각. 낱말이거나 명령을 잇는 연산자다. `quoted`는 낱말에 따옴표나 이스케이프가 있었는지로, 그런 낱말은 리다이렉션이 아니다. */
type ShellToken = { type: 'word'; value: string; quoted: boolean } | { type: 'operator'; value: string };

/** 낱말 조각. */
type WordToken = Extract<ShellToken, { type: 'word' }>;

/** 명령을 감싸는 셸. Codex는 명령을 `/bin/zsh -lc '…'`처럼 로그인 셸로 감싸 알린다. */
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);

/** 파일을 읽는 명령. */
const READ_COMMANDS = new Set(['cat', 'head', 'tail', 'nl', 'less', 'more', 'bat', 'wc', 'sed', 'awk']);

/** 첫 인수가 파일이 아니라 스크립트인 읽기 명령. `-e`·`-f`로 스크립트를 주면 첫 인수부터 파일이다. */
const SCRIPT_FIRST_COMMANDS = new Set(['sed', 'awk']);

/** 내용을 검색하는 명령. */
const SEARCH_COMMANDS = new Set(['rg', 'grep', 'egrep', 'fgrep', 'ag', 'ack']);

/** 목록을 보는 명령. */
const LIST_COMMANDS = new Set(['ls', 'tree']);

/** 명령마다 값을 하나 받는 옵션. 값은 다음 낱말이다(`--opt=값`처럼 붙여 쓴 것은 한 낱말이라 따로 다루지 않는다). */
const VALUE_OPTIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  head: new Set(['-n', '-c']),
  tail: new Set(['-n', '-c']),
  sed: new Set(['-e', '-f']),
  awk: new Set(['-f', '-v', '-F']),
  rg: new Set([
    '-e', '--regexp', '-f', '--file', '-g', '--glob', '--iglob', '-t', '--type', '-T', '--type-not', '-m', '--max-count',
    '-A', '--after-context', '-B', '--before-context', '-C', '--context', '-M', '--max-columns', '-j', '--threads',
    '-r', '--replace', '-d', '--max-depth', '--maxdepth', '--sort', '--sortr', '--color', '--colors', '-E', '--encoding',
  ]),
  grep: new Set(['-e', '--regexp', '-f', '--file', '-m', '--max-count', '-A', '-B', '-C', '-d', '-D']),
};

/** 검색어를 따로 주는 옵션. 있으면 첫 인수가 아니라 이 값이 검색어다. */
const PATTERN_OPTIONS = new Set(['-e', '--regexp']);

/** rg의 파일 이름 패턴 옵션. `rg --files`와 함께 쓰면 파일 이름 찾기다. */
const GLOB_OPTIONS = new Set(['-g', '--glob', '--iglob']);

/** find의 이름 조건. 값이 찾는 패턴이다. */
const FIND_NAME_OPTIONS = new Set(['-name', '-iname', '-path', '-ipath', '-regex']);

/** 셸 명령 줄을 읽어 하는 일을 정한다. 로그인 셸 감싸기를 벗기고, 파이프·`&&`로 이은 명령 가운데 `cd`가 아닌 첫 명령을 본다. */
export function describeCodexCommand(command: string): CodexCommand {
  /** 셸 감싸기를 벗긴 스크립트. */
  const script = unwrapShell(command);
  /** 첫 명령의 낱말. */
  const words = firstCommandWords(script);
  /** 명령 이름. */
  const name = baseName(words[0] ?? '');
  /** 인수. */
  const args = words.slice(1);

  if (READ_COMMANDS.has(name)) {
    /** 읽는 파일. */
    const files = readFiles(name, args);
    return files.length > 0 ? { kind: 'read', files } : other(words);
  }
  if (name === 'git' && args[0] === 'grep') return searchOf('grep', args.slice(1), words);
  if (SEARCH_COMMANDS.has(name)) return searchOf(name, args, words);
  if (name === 'find') return findOf(args);
  if (name === 'fd') {
    /** 찾는 패턴. */
    const [pattern] = operands(name, args);
    return pattern === undefined ? { kind: 'list' } : { kind: 'search', query: pattern };
  }
  if (LIST_COMMANDS.has(name)) return { kind: 'list' };
  return other(words);
}

/** 읽기 명령이 읽는 파일. 스크립트를 먼저 받는 명령은 `-e`·`-f`가 없으면 첫 인수를 뺀다. */
function readFiles(name: string, args: readonly string[]): string[] {
  /** 옵션이 아닌 인수. */
  const positional = operands(name, args);
  /** 스크립트를 옵션으로 줬는지 여부. */
  const scriptByOption = args.some((arg) => arg === '-e' || arg === '-f');
  return SCRIPT_FIRST_COMMANDS.has(name) && !scriptByOption ? positional.slice(1) : positional;
}

/** 검색 명령의 검색어. rg의 `--files`는 파일 이름 찾기(패턴이 있을 때)나 목록 보기다. */
function searchOf(name: string, args: readonly string[], words: readonly string[]): CodexCommand {
  if (args.includes('--files')) {
    /** 파일 이름 패턴. */
    const glob = optionValue(args, GLOB_OPTIONS);
    return glob === undefined ? { kind: 'list' } : { kind: 'search', query: glob };
  }
  /** 검색어. `-e`로 주지 않았으면 첫 인수다. */
  const query = optionValue(args, PATTERN_OPTIONS) ?? operands(name, args)[0];
  return query === undefined ? other(words) : { kind: 'search', query };
}

/** find 명령. 이름 조건이 있으면 그 패턴을 찾는 것이고, 없으면 목록 보기다. */
function findOf(args: readonly string[]): CodexCommand {
  /** 찾는 패턴. */
  const pattern = optionValue(args, FIND_NAME_OPTIONS);
  return pattern === undefined ? { kind: 'list' } : { kind: 'search', query: pattern };
}

/** 그 밖의 명령. */
function other(words: readonly string[]): CodexCommand {
  return { kind: 'other', text: words.join(' ') };
}

/** `options` 가운데 하나의 바로 뒤 값. 없으면 `undefined`. */
function optionValue(args: readonly string[], options: ReadonlySet<string>): string | undefined {
  /** 옵션의 위치. */
  const index = args.findIndex((arg) => options.has(arg));
  return index < 0 ? undefined : args[index + 1];
}

/** 옵션과 옵션 값을 뺀 인수. `--` 뒤는 모두 인수다. */
function operands(name: string, args: readonly string[]): string[] {
  /** 이 명령에서 값을 받는 옵션. egrep·fgrep은 grep과 같다. */
  const valueOptions = VALUE_OPTIONS[name === 'egrep' || name === 'fgrep' ? 'grep' : name] ?? new Set<string>();
  /** 옵션이 아닌 인수. */
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    /** 지금 인수. */
    const arg = args[index] as string;
    if (arg === '--') return [...result, ...args.slice(index + 1)];
    if (valueOptions.has(arg)) index += 1;
    else if (!arg.startsWith('-') || arg === '-') result.push(arg);
  }
  return result;
}

/** `/bin/zsh -lc '<스크립트>'`처럼 셸로 감싼 명령이면 스크립트를, 아니면 명령 그대로를 돌려준다. */
function unwrapShell(command: string): string {
  /** 명령 줄의 낱말. */
  const words = tokenize(command).flatMap((token) => (token.type === 'word' ? [token.value] : []));
  /** `-c` 옵션(`-lc`, `-ilc` 등 묶음 포함)의 위치. */
  const flagIndex = SHELLS.has(baseName(words[0] ?? '')) ? words.findIndex((word, index) => index > 0 && /^-[a-z]*c[a-z]*$/.test(word)) : -1;
  return flagIndex > 0 ? (words[flagIndex + 1] ?? '') : command;
}

/** 스크립트에서 `cd`가 아닌 첫 명령의 낱말. 리다이렉션(`2>/dev/null` 등)은 뺀다. */
function firstCommandWords(script: string): string[] {
  /** 지금 명령의 낱말. */
  let words: WordToken[] = [];
  for (const token of [...tokenize(script), { type: 'operator', value: ';' } as const]) {
    if (token.type === 'word') {
      words.push(token);
      continue;
    }
    /** 리다이렉션을 뺀 낱말. */
    const command = withoutRedirections(words);
    if (command.length > 0 && command[0] !== 'cd') return command;
    words = [];
  }
  return [];
}

/** 리다이렉션 낱말을 뺀다. `>`처럼 대상이 따로 오면 다음 낱말(대상 파일)도 뺀다. 따옴표가 있던 낱말은 리다이렉션이 아니다. */
function withoutRedirections(words: readonly WordToken[]): string[] {
  /** 남긴 낱말. */
  const result: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    /** 지금 낱말. */
    const word = words[index] as WordToken;
    /** 리다이렉션 모양(`>`, `2>`, `>>`, `<`, `2>/dev/null`, `>&2`)이면 연산자 뒤의 대상. */
    const target = word.quoted ? null : /^\d*[<>]{1,2}(.*)$/.exec(word.value)?.[1];
    if (target === null || target === undefined) result.push(word.value);
    else if (target === '') index += 1;
  }
  return result;
}

/**
 * 셸 명령 줄을 낱말과 연산자(`|`, `||`, `&&`, `;`, `&`, 줄바꿈)로 나눈다. 작은따옴표 안은 그대로,
 * 큰따옴표 안은 `\"`·`\\`·`\$`·`` \` ``만 이스케이프로 읽고, 따옴표 밖의 역슬래시는 다음 글자를 그대로 쓴다.
 */
function tokenize(line: string): ShellToken[] {
  /** 나눈 조각. */
  const tokens: ShellToken[] = [];
  /** 지금 쌓고 있는 낱말. 따옴표만 있는 빈 낱말도 낱말이라 `null`과 구분한다. */
  let word: string | null = null;
  /** 지금 낱말에 따옴표나 이스케이프가 있었는지 여부. */
  let quoted = false;
  /** 지금 낱말을 조각으로 넘긴다. */
  const flush = () => {
    if (word !== null) tokens.push({ type: 'word', value: word, quoted });
    word = null;
    quoted = false;
  };
  for (let index = 0; index < line.length; index += 1) {
    /** 지금 글자. */
    const char = line[index] as string;
    if (char === "'") {
      quoted = true;
      /** 닫는 따옴표의 위치. 없으면 끝까지다. */
      const end = line.indexOf("'", index + 1);
      word = (word ?? '') + line.slice(index + 1, end < 0 ? undefined : end);
      index = end < 0 ? line.length : end;
    } else if (char === '"') {
      quoted = true;
      word ??= '';
      for (index += 1; index < line.length && line[index] !== '"'; index += 1) {
        /** 큰따옴표 안의 글자. */
        const inner = line[index] as string;
        if (inner === '\\' && '"\\$`'.includes(line[index + 1] ?? '')) {
          index += 1;
          word += line[index];
        } else {
          word += inner;
        }
      }
    } else if (char === '\\') {
      quoted = true;
      index += 1;
      word = (word ?? '') + (line[index] ?? '');
    } else if (/\s/.test(char) && char !== '\n') {
      flush();
    } else if ('|&;\n'.includes(char)) {
      flush();
      /** `||`·`&&`처럼 두 글자 연산자인지. */
      const doubled = (char === '|' || char === '&') && line[index + 1] === char;
      tokens.push({ type: 'operator', value: doubled ? char + char : char });
      if (doubled) index += 1;
    } else {
      word = (word ?? '') + char;
    }
  }
  flush();
  return tokens;
}

/** 경로의 마지막 조각. */
function baseName(path: string): string {
  return path.split('/').at(-1) ?? path;
}
