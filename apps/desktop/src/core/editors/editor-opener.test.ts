import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { createLogger } from '../logging/logger';
import type { Settings } from '../ports/settings-store';
import { EditorOpener, evidenceFileOf, parseEditorCommand, type EditorSystem } from './editor-opener';

/** 가짜 OS. 있는 파일과 폴더 목록을 정해 두고, 연 주소·실행한 명령·기본 앱으로 연 파일을 적는다. */
class FakeEditorSystem implements EditorSystem {
  /** 연 주소. */
  readonly urls: string[] = [];
  /** 실행한 명령. */
  readonly spawned: { command: string; args: string[] }[] = [];
  /** OS 기본 앱으로 연 파일. */
  readonly defaultOpened: string[] = [];
  /** 실행이 실패할지 여부. */
  failLaunch = false;

  constructor(
    readonly platform: EditorSystem['platform'],
    /** 있는 파일. */
    private readonly files: string[],
    readonly homeDir = '/Users/fake',
    readonly env: EditorSystem['env'] = {},
  ) {}

  async exists(path: string): Promise<boolean> {
    return this.files.some((file) => file === path || file.startsWith(`${path}/`) || file.startsWith(`${path}\\`));
  }

  async listDir(path: string): Promise<string[]> {
    /** `path` 바로 아래 이름. */
    const names = this.files.filter((file) => file.startsWith(`${path}/`) || file.startsWith(`${path}\\`)).map((file) => file.slice(path.length + 1).split(/[/\\]/)[0]!);
    return [...new Set(names)];
  }

  async openUrl(url: string): Promise<void> {
    if (this.failLaunch) throw new Error('열지 못함');
    this.urls.push(url);
  }

  async spawn(command: string, args: string[]): Promise<void> {
    if (this.failLaunch) throw new Error('실행하지 못함');
    this.spawned.push({ command, args });
  }

  async openPath(path: string): Promise<void> {
    this.defaultOpened.push(path);
  }
}

/** macOS에 VS Code, IntelliJ IDEA(Toolbox 설치), Sublime Text가 있는 가짜 OS. */
function macWithEditors(): FakeEditorSystem {
  return new FakeEditorSystem('darwin', [
    '/Applications/Visual Studio Code.app/Contents/Info.plist',
    '/Users/fake/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea',
    '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl',
    '/Applications/Safari.app/Contents/Info.plist',
  ]);
}

/** 열 파일과 줄. */
const TARGET = { file: '/fake/work/billing-api/src/main/resources/application-prod.yml', line: 88 };

/** 시험할 에디터 열기와 그 설정 저장소. */
function setup(system: EditorSystem, settings: Partial<Settings> = {}) {
  /** 설정 저장소. */
  const settingsStore = new MemorySettingsStore(settings);
  /** 에디터 열기. */
  const opener = new EditorOpener({ settingsStore, logger: createLogger([], new FakeClock()), system });
  return { settingsStore, opener };
}

describe('에디터 찾기', () => {
  it('macOS는 /Applications와 ~/Applications에서 VS Code, Cursor, JetBrains IDE, Zed, Sublime Text를 찾는다', async () => {
    const { opener } = setup(macWithEditors());

    await opener.refresh();

    expect(opener.state().installed).toEqual([
      { appId: 'vscode', name: 'VS Code' },
      { appId: 'jetbrains:IntelliJ IDEA Ultimate', name: 'IntelliJ IDEA Ultimate' },
      { appId: 'sublime', name: 'Sublime Text' },
    ]);
  });

  it('Windows는 사용자별·전체 설치 폴더와 JetBrains 폴더에서 찾는다', async () => {
    /** 가짜 Windows. */
    const system = new FakeEditorSystem(
      'win32',
      [
        'C:\\Users\\fake\\AppData\\Local\\Programs\\cursor\\Cursor.exe',
        'C:\\Users\\fake\\AppData\\Local\\Programs\\Zed\\Zed.exe',
        'C:\\Program Files\\JetBrains\\WebStorm 2026.2\\bin\\webstorm64.exe',
      ],
      'C:\\Users\\fake',
      { LOCALAPPDATA: 'C:\\Users\\fake\\AppData\\Local', ProgramFiles: 'C:\\Program Files' },
    );
    const { opener } = setup(system);

    await opener.refresh();

    expect(opener.state().installed).toEqual([
      { appId: 'cursor', name: 'Cursor' },
      { appId: 'jetbrains:WebStorm 2026.2', name: 'WebStorm 2026.2' },
      { appId: 'zed', name: 'Zed' },
    ]);
  });
});

describe('에디터에서 열기', () => {
  it('처음 누르면 찾은 에디터를 고르게 하고, 고른 에디터를 기억해 그 줄을 연다. 그 뒤로는 바로 연다', async () => {
    /** 가짜 OS. */
    const system = macWithEditors();
    const { opener, settingsStore } = setup(system);

    await opener.open(TARGET);
    expect(opener.state().picker).toEqual({ editors: opener.state().installed });
    expect(system.urls).toEqual([]);

    await opener.choose('vscode');
    expect(settingsStore.settings.editor).toEqual({ kind: 'app', appId: 'vscode' });
    expect(opener.state().picker).toBeNull();
    expect(system.urls).toEqual(['vscode://file/fake/work/billing-api/src/main/resources/application-prod.yml:88']);

    await opener.open({ ...TARGET, line: 90 });
    expect(system.urls.at(-1)).toBe('vscode://file/fake/work/billing-api/src/main/resources/application-prod.yml:90');
    expect(opener.state().picker).toBeNull();
  });

  it('고르지 않고 닫으면 아무것도 열지 않고 기억하지 않는다', async () => {
    /** 가짜 OS. */
    const system = macWithEditors();
    const { opener, settingsStore } = setup(system);

    await opener.open(TARGET);
    opener.closePicker();

    expect(opener.state().picker).toBeNull();
    expect(settingsStore.settings.editor).toBeNull();
    expect([...system.urls, ...system.spawned, ...system.defaultOpened]).toEqual([]);
  });

  it.each([
    ['jetbrains:IntelliJ IDEA Ultimate', { command: '/Users/fake/Applications/IntelliJ IDEA Ultimate.app/Contents/MacOS/idea', args: ['--line', '88', TARGET.file] }],
    ['sublime', { command: '/Applications/Sublime Text.app/Contents/SharedSupport/bin/subl', args: [`${TARGET.file}:88`] }],
  ])('%s는 앱에 든 CLI로 그 줄을 연다', async (appId, spawned) => {
    /** 가짜 OS. */
    const system = macWithEditors();
    const { opener } = setup(system, { editor: { kind: 'app', appId } });

    await opener.open(TARGET);

    expect(system.spawned).toEqual([spawned]);
  });

  it('Windows 경로는 빗금으로 바꿔 URL 스킴으로 열고, 특수 문자는 인코딩한다', async () => {
    /** 가짜 Windows. */
    const system = new FakeEditorSystem('win32', ['C:\\Program Files\\Microsoft VS Code\\Code.exe'], 'C:\\Users\\fake', { ProgramFiles: 'C:\\Program Files' });
    const { opener } = setup(system, { editor: { kind: 'app', appId: 'vscode' } });

    await opener.open({ file: 'C:\\work\\my api\\#1.ts', line: 3 });

    expect(system.urls).toEqual(['vscode://file/C:/work/my%20api/%231.ts:3']);
  });

  it('찾은 에디터가 없으면 OS 기본 앱으로 파일만 연다', async () => {
    /** 에디터가 없는 가짜 OS. */
    const system = new FakeEditorSystem('darwin', ['/Applications/Safari.app/Contents/Info.plist']);
    const { opener, settingsStore } = setup(system);

    await opener.open(TARGET);

    expect(system.defaultOpened).toEqual([TARGET.file]);
    expect(opener.state().picker).toBeNull();
    expect(settingsStore.settings.editor).toBeNull();
  });

  it('고른 에디터를 지웠으면 다시 고르게 한다', async () => {
    /** 가짜 OS. */
    const system = macWithEditors();
    const { opener } = setup(system, { editor: { kind: 'app', appId: 'cursor' } });

    await opener.open(TARGET);

    expect(opener.state().picker?.editors.map((editor) => editor.appId)).toEqual(['vscode', 'jetbrains:IntelliJ IDEA Ultimate', 'sublime']);
  });

  it('에디터를 실행하지 못하면 OS 기본 앱으로 파일만 연다', async () => {
    /** 실행이 실패하는 가짜 OS. */
    const system = macWithEditors();
    system.failLaunch = true;
    const { opener } = setup(system, { editor: { kind: 'app', appId: 'vscode' } });

    await opener.open(TARGET);

    expect(system.defaultOpened).toEqual([TARGET.file]);
  });

  it('직접 지정한 명령은 셸 없이 {file}과 {line} 자리를 채워 실행한다', async () => {
    /** 가짜 OS. */
    const system = macWithEditors();
    const { opener } = setup(system, { editor: { kind: 'command', command: '"/opt/my editor/bin/edit" --goto "{file}:{line}"' } });

    await opener.open({ file: '/fake/work/a b/$(rm).ts', line: 7 });

    expect(system.spawned).toEqual([{ command: '/opt/my editor/bin/edit', args: ['--goto', '/fake/work/a b/$(rm).ts:7'] }]);
  });

  it('설정 "일반"에서 고른 에디터나 직접 지정한 명령을 저장하고, 지우면 다음에 다시 고르게 한다', async () => {
    const { opener, settingsStore } = setup(macWithEditors());

    await opener.setChoice({ kind: 'command', command: 'subl {file}:{line}' });
    expect(settingsStore.settings.editor).toEqual({ kind: 'command', command: 'subl {file}:{line}' });
    expect(opener.state().choice).toEqual({ kind: 'command', command: 'subl {file}:{line}' });

    await opener.setChoice(null);
    expect(settingsStore.settings.editor).toBeNull();
  });
});

describe('직접 지정 명령', () => {
  it('따옴표로 묶은 조각을 하나로 읽고, {file} 자리가 없거나 따옴표가 닫히지 않으면 받지 않는다', () => {
    expect(parseEditorCommand(`code --goto '{file}:{line}'`)).toEqual(['code', '--goto', '{file}:{line}']);
    expect(parseEditorCommand('code --goto')).toBeNull();
    expect(parseEditorCommand('"code {file}')).toBeNull();
    expect(parseEditorCommand('   ')).toBeNull();
  });
});

describe('근거 파일', () => {
  /** 근거 두 개. 둘째는 위치를 찾지 못했다. */
  const draft = {
    evidence: [
      { repository: '/fake/work/api', path: 'src/a.ts', startLine: 12, located: true },
      { repository: '/fake/work/api', path: 'src/b.ts', startLine: 1, located: false },
      { repository: '/fake/work/api', path: '../other/c.ts', startLine: 1, located: true },
    ],
  };

  it('위치를 찾은 근거는 저장소 안 파일의 절대 경로와 시작 줄이다. 위치를 찾지 못했거나 저장소 밖이면 열지 않는다', () => {
    expect(evidenceFileOf(draft, 0)).toEqual({ file: '/fake/work/api/src/a.ts', line: 12 });
    expect(evidenceFileOf(draft, 1)).toBeNull();
    expect(evidenceFileOf(draft, 2)).toBeNull();
    expect(evidenceFileOf(draft, 3)).toBeNull();
  });
});
