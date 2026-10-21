import { isAbsolute, posix, relative, resolve, sep, win32 } from 'node:path';
import { errorFields, type Logger } from '../logging/logger';
import type { DraftEvidence } from '../drafts/draft';
import type { EditorChoice, SettingsStore } from '../ports/settings-store';

/** 에디터를 찾고 여는 데 쓰는 OS 기능. main이 Electron과 Node로 채운다. */
export interface EditorSystem {
  /** 실행 중인 OS. */
  platform: 'darwin' | 'win32' | 'other';
  /** 사용자 홈 폴더. */
  homeDir: string;
  /** Windows 설치 폴더를 찾는 환경 변수. */
  env: { LOCALAPPDATA?: string | undefined; ProgramFiles?: string | undefined };
  /** 파일이나 폴더가 있는지 본다. */
  exists(path: string): Promise<boolean>;
  /** 폴더 바로 아래의 이름. 폴더가 없으면 빈 배열이다. */
  listDir(path: string): Promise<string[]>;
  /** URL 스킴 주소를 OS에 넘겨 연다. 실패하면 던진다. */
  openUrl(url: string): Promise<void>;
  /**
   * 셸 없이 명령을 실행하고 기다리지 않는다. 실행하지 못하면 던진다.
   * 직접 지정한 명령도 이것으로 실행하므로, 설정 "일반"에 적은 명령은 사용자가 고른 프로그램을 그대로 띄운다.
   */
  spawn(command: string, args: string[]): Promise<void>;
  /** 파일을 OS 기본 앱으로 연다. 실패하면 던진다. */
  openPath(path: string): Promise<void>;
}

/** 이 PC에서 찾은, 줄 단위로 여는 방법을 아는 에디터. */
export interface InstalledEditor {
  /** 설정에 기억하는 ID. JetBrains IDE는 `jetbrains:` 뒤에 앱 이름을 붙인다. */
  appId: string;
  /** 화면에 보일 이름. */
  name: string;
}

/** 에디터에서 열 파일과 줄. */
export interface EditorTarget {
  /** 파일의 절대 경로. */
  file: string;
  /** 줄. 1부터 센다. */
  line: number;
}

/** 에디터 열기의 상태. 설정 "일반"의 에디터 칸과 처음 열 때의 에디터 고르기 창이 그린다. */
export interface EditorOpenerState {
  /** 기억한 에디터. 아직 고르지 않았으면 `null`. */
  choice: EditorChoice | null;
  /** 마지막으로 찾은 에디터. */
  installed: InstalledEditor[];
  /** 열린 에디터 고르기 창. 닫혀 있으면 `null`. */
  picker: { editors: InstalledEditor[] } | null;
}

/** 에디터를 여는 방법. */
type EditorLaunch = { kind: 'url'; url: string } | { kind: 'process'; command: string; args: string[] };

/** 찾은 에디터와 그 에디터로 줄을 여는 방법. */
interface FoundEditor extends InstalledEditor {
  /** `target`을 여는 방법. */
  launch(target: EditorTarget): EditorLaunch;
}

/** JetBrains IDE의 앱 이름 앞부분과 실행 파일 이름. 앱 이름 뒤에는 판(Ultimate, CE)이나 버전이 붙는다. */
const JETBRAINS_PRODUCTS: readonly { prefix: string; launcher: string }[] = [
  { prefix: 'IntelliJ IDEA', launcher: 'idea' },
  { prefix: 'WebStorm', launcher: 'webstorm' },
  { prefix: 'PyCharm', launcher: 'pycharm' },
  { prefix: 'GoLand', launcher: 'goland' },
  { prefix: 'PhpStorm', launcher: 'phpstorm' },
  { prefix: 'RubyMine', launcher: 'rubymine' },
  { prefix: 'CLion', launcher: 'clion' },
  { prefix: 'Rider', launcher: 'rider' },
  { prefix: 'RustRover', launcher: 'rustrover' },
  { prefix: 'DataGrip', launcher: 'datagrip' },
];

/** 에디터 열기에 필요한 것. */
export interface EditorOpenerOptions {
  /** 고른 에디터를 기억하는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. 파일 경로는 남기지 않는다. */
  logger: Logger;
  /** OS 기능. */
  system: EditorSystem;
}

/**
 * 근거의 "에디터에서 열기". 처음 누르면 찾은 에디터(VS Code, Cursor, JetBrains IDE, Zed, Sublime Text)에서 고르게 하고 기억한다.
 * 그 뒤로는 바로 그 줄을 연다. 찾은 에디터가 없거나 열지 못하면 OS 기본 앱으로 파일만 연다.
 * 설정 "일반"에서 다른 에디터를 고르거나 `{file}`, `{line}` 자리를 넣은 명령을 직접 지정할 수 있다.
 */
export class EditorOpener {
  /** 지금 상태. */
  private current: EditorOpenerState = { choice: null, installed: [], picker: null };
  /** 에디터 고르기 창을 닫으면 열 파일과 줄. */
  private pending: EditorTarget | null = null;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: EditorOpenerOptions) {}

  /** 지금 상태. */
  state(): EditorOpenerState {
    return structuredClone(this.current);
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 기억한 에디터를 읽고 이 PC의 에디터를 다시 찾는다. */
  async refresh(): Promise<void> {
    /** 찾은 에디터. */
    const found = await this.discover();
    this.update({ choice: (await this.options.settingsStore.load()).editor, installed: found.map(installedOf) });
  }

  /**
   * 파일의 그 줄을 연다. 직접 지정한 명령이 있으면 그것으로, 기억한 에디터가 이 PC에 있으면 그 에디터로 연다.
   * 아직 고르지 않았거나 기억한 에디터가 사라졌으면 찾은 에디터를 고르는 창을 열고, 찾은 에디터가 없으면 OS 기본 앱으로 연다.
   */
  async open(target: EditorTarget): Promise<void> {
    /** 기억한 에디터. */
    const choice = (await this.options.settingsStore.load()).editor;
    if (choice?.kind === 'command') {
      /** 직접 지정한 명령의 조각. */
      const argv = parseEditorCommand(choice.command);
      if (argv) {
        await this.launch({ kind: 'process', ...fillCommand(argv, target) }, target);
      } else {
        this.options.logger.warn('editor.command-invalid', {});
        await this.openWithDefaultApp(target);
      }
      this.update({ choice });
      return;
    }
    /** 찾은 에디터. */
    const found = await this.discover();
    this.update({ choice, installed: found.map(installedOf) });
    /** 기억한 에디터가 이 PC에 있으면 그 에디터. */
    const chosen = choice && found.find((editor) => editor.appId === choice.appId);
    if (chosen) {
      await this.launch(chosen.launch(target), target);
      return;
    }
    if (found.length === 0) {
      await this.openWithDefaultApp(target);
      return;
    }
    this.pending = target;
    this.update({ picker: { editors: found.map(installedOf) } });
  }

  /** 에디터 고르기 창에서 에디터를 골랐다. 기억하고, 창을 열게 한 파일을 연다. 찾은 에디터가 아니면 아무 일도 하지 않는다. */
  async choose(appId: string): Promise<void> {
    /** 열 파일과 줄. */
    const target = this.pending;
    /** 고른 에디터. */
    const chosen = target && (await this.discover()).find((editor) => editor.appId === appId);
    if (!target || !chosen) return;
    if (!(await this.saveChoice({ kind: 'app', appId }))) return;
    this.pending = null;
    this.update({ picker: null });
    await this.launch(chosen.launch(target), target);
  }

  /** 에디터 고르기 창을 고르지 않고 닫는다. 아무것도 열지 않는다. */
  closePicker(): void {
    this.pending = null;
    this.update({ picker: null });
  }

  /** 설정 "일반"에서 에디터를 고르거나 명령을 직접 지정한다. `null`이면 다음에 열 때 다시 고르게 한다. 읽을 수 없는 명령은 저장하지 않는다. */
  async setChoice(choice: EditorChoice | null): Promise<void> {
    if (choice?.kind === 'command' && !parseEditorCommand(choice.command)) return;
    await this.saveChoice(choice);
  }

  /** 기억할 에디터를 저장한다. 저장했으면 참이다. */
  private async saveChoice(choice: EditorChoice | null): Promise<boolean> {
    try {
      // 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다.
      /** 저장 직전의 설정. */
      const settings = await this.options.settingsStore.load();
      await this.options.settingsStore.save({ ...settings, editor: choice });
    } catch (error) {
      this.options.logger.error('editor.save-failed', errorFields(error));
      return false;
    }
    this.options.logger.info('editor.chosen', { kind: choice?.kind ?? null, appId: choice?.kind === 'app' ? choice.appId : null });
    this.update({ choice });
    return true;
  }

  /** 에디터를 연다. 열지 못하면 OS 기본 앱으로 파일만 연다. */
  private async launch(launch: EditorLaunch, target: EditorTarget): Promise<void> {
    try {
      if (launch.kind === 'url') await this.options.system.openUrl(launch.url);
      else await this.options.system.spawn(launch.command, launch.args);
    } catch (error) {
      this.options.logger.warn('editor.launch-failed', { kind: launch.kind, ...errorFields(error) });
      await this.openWithDefaultApp(target);
    }
  }

  /** 파일을 OS 기본 앱으로 연다. 열지 못하면 로그만 남긴다. */
  private async openWithDefaultApp(target: EditorTarget): Promise<void> {
    try {
      await this.options.system.openPath(target.file);
    } catch (error) {
      this.options.logger.warn('editor.default-open-failed', errorFields(error));
    }
  }

  /** 상태를 바꾸고 듣는 쪽에 알린다. */
  private update(change: Partial<EditorOpenerState>): void {
    this.current = { ...this.current, ...change };
    for (const listener of this.listeners) listener();
  }

  /** 이 PC에서 에디터를 찾는다. VS Code, Cursor, JetBrains IDE, Zed, Sublime Text 순서다. */
  private async discover(): Promise<FoundEditor[]> {
    /** OS 기능. */
    const { system } = this.options;
    if (system.platform === 'darwin') return discoverOnMac(system);
    if (system.platform === 'win32') return discoverOnWindows(system);
    return [];
  }
}

/** macOS의 `/Applications`와 `~/Applications`에서 에디터를 찾는다. */
async function discoverOnMac(system: EditorSystem): Promise<FoundEditor[]> {
  /** 앱을 찾을 폴더. */
  const folders = ['/Applications', posix.join(system.homeDir, 'Applications')];
  /** 이름이 `name`인 앱이 처음 있는 경로. 없으면 `null`. */
  const appPath = async (name: string) => {
    for (const folder of folders) {
      /** 앱 경로. */
      const path = posix.join(folder, name);
      if (await system.exists(path)) return path;
    }
    return null;
  };
  /** 찾은 에디터. */
  const found: FoundEditor[] = [];

  /** VS Code. */
  const vscode = await appPath('Visual Studio Code.app');
  if (vscode) found.push(urlSchemeEditor('vscode', 'VS Code'));
  /** Cursor. */
  const cursor = await appPath('Cursor.app');
  if (cursor) found.push(urlSchemeEditor('cursor', 'Cursor'));
  for (const folder of folders) {
    for (const entry of await system.listDir(folder)) {
      /** 앱 이름. */
      const name = entry.replace(/\.app$/, '');
      /** 이 앱의 JetBrains IDE 종류. */
      const product = entry.endsWith('.app') ? JETBRAINS_PRODUCTS.find(({ prefix }) => name.startsWith(prefix)) : undefined;
      if (!product) continue;
      /** 실행 파일. */
      const command = posix.join(folder, entry, 'Contents', 'MacOS', product.launcher);
      if (await system.exists(command)) found.push(jetbrainsEditor(name, command));
    }
  }
  /** Zed. 앱에 든 `cli`가 `파일:줄`을 받는다. */
  const zed = await appPath('Zed.app');
  if (zed) found.push(lineSuffixEditor('zed', 'Zed', posix.join(zed, 'Contents', 'MacOS', 'cli')));
  /** Sublime Text. 앱에 든 `subl`이 `파일:줄`을 받는다. */
  const sublime = await appPath('Sublime Text.app');
  if (sublime) found.push(lineSuffixEditor('sublime', 'Sublime Text', posix.join(sublime, 'Contents', 'SharedSupport', 'bin', 'subl')));
  return found;
}

/** Windows의 사용자별 설치 폴더(`%LOCALAPPDATA%\Programs`)와 전체 설치 폴더(`%ProgramFiles%`)에서 에디터를 찾는다. */
async function discoverOnWindows(system: EditorSystem): Promise<FoundEditor[]> {
  /** 사용자별 설치 폴더. */
  const userPrograms = system.env.LOCALAPPDATA ? win32.join(system.env.LOCALAPPDATA, 'Programs') : null;
  /** 전체 설치 폴더. */
  const programFiles = system.env.ProgramFiles ?? null;
  /** 후보 가운데 처음 있는 실행 파일. 없으면 `null`. */
  const firstExisting = async (candidates: (string | null)[]) => {
    for (const path of candidates) if (path && (await system.exists(path))) return path;
    return null;
  };
  /** `base` 아래 경로. `base`를 모르면 `null`. */
  const under = (base: string | null, ...parts: string[]) => (base ? win32.join(base, ...parts) : null);
  /** 찾은 에디터. */
  const found: FoundEditor[] = [];

  // VS Code와 Cursor는 설치할 때 URL 스킴을 등록한다.
  if (await firstExisting([under(userPrograms, 'Microsoft VS Code', 'Code.exe'), under(programFiles, 'Microsoft VS Code', 'Code.exe')])) {
    found.push(urlSchemeEditor('vscode', 'VS Code'));
  }
  if (await firstExisting([under(userPrograms, 'cursor', 'Cursor.exe'), under(programFiles, 'Cursor', 'Cursor.exe')])) {
    found.push(urlSchemeEditor('cursor', 'Cursor'));
  }
  // 설치 프로그램은 `JetBrains\WebStorm 2026.2`에, Toolbox는 사용자별 설치 폴더에 IDE마다 폴더를 만든다.
  for (const folder of [under(programFiles, 'JetBrains'), userPrograms]) {
    if (!folder) continue;
    for (const name of await system.listDir(folder)) {
      /** 이 폴더의 JetBrains IDE 종류. */
      const product = JETBRAINS_PRODUCTS.find(({ prefix }) => name.startsWith(prefix));
      if (!product) continue;
      /** 실행 파일. */
      const command = win32.join(folder, name, 'bin', `${product.launcher}64.exe`);
      if (await system.exists(command)) found.push(jetbrainsEditor(name, command));
    }
  }
  /** Zed. */
  const zed = await firstExisting([under(userPrograms, 'Zed', 'Zed.exe')]);
  if (zed) found.push(lineSuffixEditor('zed', 'Zed', zed));
  /** Sublime Text. */
  const sublime = await firstExisting([under(programFiles, 'Sublime Text', 'subl.exe'), under(programFiles, 'Sublime Text 3', 'subl.exe')]);
  if (sublime) found.push(lineSuffixEditor('sublime', 'Sublime Text', sublime));
  return found;
}

/** VS Code 계열 에디터. 에디터 ID가 곧 URL 스킴이다. */
function urlSchemeEditor(appId: string, name: string): FoundEditor {
  return { appId, name, launch: (target) => urlLaunch(appId, target) };
}

/** JetBrains IDE. 실행 파일이 `--line 줄 파일`을 받아 열린 IDE에 넘긴다. */
function jetbrainsEditor(name: string, command: string): FoundEditor {
  return { appId: `jetbrains:${name}`, name, launch: ({ file, line }) => ({ kind: 'process', command, args: ['--line', String(line), file] }) };
}

/** `파일:줄` 인자 하나로 그 줄을 여는 에디터(Zed, Sublime Text). */
function lineSuffixEditor(appId: string, name: string, command: string): FoundEditor {
  return { appId, name, launch: ({ file, line }) => ({ kind: 'process', command, args: [`${file}:${line}`] }) };
}

/**
 * VS Code 계열의 `스킴://file/경로:줄` 주소. Windows 경로는 빗금으로 바꾸고, 드라이브 이름 말고는 조각마다 인코딩한다.
 * 파일 이름의 `#`이나 `?`가 주소의 다른 부분으로 읽히지 않게 하려는 것이다.
 */
function urlLaunch(scheme: string, { file, line }: EditorTarget): EditorLaunch {
  /** 조각마다 인코딩한 경로. */
  const path = file
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => (/^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)))
    .join('/');
  return { kind: 'url', url: `${scheme}://file${path.startsWith('/') ? '' : '/'}${path}:${line}` };
}

/** 찾은 에디터에서 화면에 보일 것만 남긴다. */
function installedOf({ appId, name }: FoundEditor): InstalledEditor {
  return { appId, name };
}

/**
 * 직접 지정한 명령 한 줄을 조각으로 나눈다. 공백으로 나누고, 큰따옴표나 작은따옴표로 묶은 부분은 한 조각이다.
 * 셸로 실행하지 않으므로 파일 경로에 든 문자가 명령으로 읽히지 않는다. 비었거나, 따옴표가 닫히지 않았거나, `{file}`이나 `{line}` 자리가 없으면 `null`.
 */
export function parseEditorCommand(command: string): string[] | null {
  /** 나눈 조각. */
  const argv: string[] = [];
  /** 만들고 있는 조각. 조각 사이면 `null`. */
  let token: string | null = null;
  /** 열린 따옴표. 따옴표 밖이면 `null`. */
  let quote: string | null = null;
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else token = (token ?? '') + char;
    } else if (char === '"' || char === "'") {
      quote = char;
      token ??= '';
    } else if (/\s/.test(char)) {
      if (token !== null) argv.push(token);
      token = null;
    } else {
      token = (token ?? '') + char;
    }
  }
  if (quote) return null;
  if (token !== null) argv.push(token);
  if (!argv.some((arg) => arg.includes('{file}')) || !argv.some((arg) => arg.includes('{line}'))) return null;
  return argv;
}

/** 명령 조각의 `{file}`, `{line}` 자리를 채운다. 첫 조각이 실행할 명령이다. */
function fillCommand(argv: string[], { file, line }: EditorTarget): { command: string; args: string[] } {
  /** 자리를 채운 조각. */
  const [command = '', ...args] = argv.map((arg) => arg.replaceAll('{file}', file).replaceAll('{line}', String(line)));
  return { command, args };
}

/**
 * 초안의 근거 하나를 에디터에서 열 파일과 줄. 시작 줄을 연다.
 * 위치를 찾지 못한 근거, 없는 근거, 저장소 밖을 가리키는 경로면 `null`이다. 위치 검증을 거쳤어도 열기 직전에 한 번 더 막는다.
 */
export function evidenceFileOf(
  draft: { evidence: readonly Pick<DraftEvidence, 'repository' | 'path' | 'startLine' | 'located'>[] },
  index: number,
): EditorTarget | null {
  /** 열 근거. */
  const evidence = draft.evidence[index];
  if (!evidence?.located || !isAbsolute(evidence.repository)) return null;
  /** 파일의 절대 경로. */
  const file = resolve(evidence.repository, evidence.path);
  /** 저장소 루트에서 파일까지의 상대 경로. */
  const inside = relative(evidence.repository, file);
  if (inside === '' || inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) return null;
  return { file, line: evidence.startLine };
}
