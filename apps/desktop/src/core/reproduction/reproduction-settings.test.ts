import { describe, expect, it } from 'vitest';
import { exited, FakeProcessRunner } from '../fakes/fake-process-runner';
import { FakeClock } from '../fakes/fake-clock';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { createLogger, type LogSink } from '../logging/logger';
import type { Settings } from '../ports/settings-store';
import { ReproductionSettings } from './reproduction-settings';

/** 테스트용 가짜 비밀 값. 설정 파일과 로그에 나오면 안 된다. */
const SECRET = 'FAKE-SECRET-VALUE-9f3a';

/** 가짜 Claude Code 설정 파일. */
const CLAUDE_CONFIG = {
  mcpServers: {
    playwright: { command: 'npx', args: ['@playwright/mcp'], env: { TOKEN: SECRET } },
    'my-sim': { command: 'sim-mcp' },
  },
};

/** 가짜 `codex mcp list --json` 출력. */
const CODEX_LIST = JSON.stringify([
  { name: 'codex-web', enabled: true, transport: { type: 'stdio', command: 'web-mcp', env: { KEY: SECRET } } },
]);

/** 재현 설정을 만들고 저장된 설정을 읽어 둔다. */
async function setup(options: { settings?: Partial<Settings>; platform?: NodeJS.Platform; codex?: boolean; files?: string[]; mapped?: string[]; claudeError?: boolean } = {}) {
  const settingsStore = new MemorySettingsStore(options.settings);
  const runner = new FakeProcessRunner();
  runner.respond('/fake/bin/codex', ['mcp', 'list', '--json'], exited(0, CODEX_LIST));
  /** 로그에 쓰인 줄. */
  const logLines: string[] = [];
  const sink: LogSink = { write: (line) => logLines.push(line) };
  /** 있는 파일. 테스트가 바꾼다. */
  const files = new Set(options.files ?? ['/fake/envs/dev.env']);
  const settings = new ReproductionSettings({
    settingsStore,
    logger: createLogger([sink], new FakeClock()),
    platform: options.platform ?? 'darwin',
    mappedRepoPaths: () => options.mapped ?? ['/fake/work/web-app', '/fake/work/api', '/fake/work/web-app'],
    readClaudeConfig: async () => {
      if (options.claudeError) throw new SyntaxError(`Unexpected token in JSON: "${SECRET}" is not valid JSON`);
      return CLAUDE_CONFIG;
    },
    runner,
    codexLaunch: () => (options.codex === false ? null : { cliPath: '/fake/bin/codex', env: { PATH: '/fake/bin' } }),
    cwd: '/fake/app-data',
    isFile: async (path) => files.has(path),
  });
  await settings.load();
  /** 상태가 바뀐 횟수. */
  const changes = { count: 0 };
  settings.onChange(() => (changes.count += 1));
  return { settings, settingsStore, runner, logLines, files, changes };
}

describe('저장소별 재현 허용', () => {
  it('매핑된 저장소마다 한 줄이고(중복은 합침) 처음에는 꺼져 있으며 환경 파일은 지정 안 함이다', async () => {
    const { settings } = await setup();

    expect(settings.state().repos).toEqual([
      { path: '/fake/work/web-app', enabled: false, envFile: null, envFileMissing: false },
      { path: '/fake/work/api', enabled: false, envFile: null, envFileMissing: false },
    ]);
  });

  it('재현 허용을 환경 파일과 함께 켜면 저장되고, 설정 파일에는 경로만 있다', async () => {
    const { settings, settingsStore, changes } = await setup();

    const outcome = await settings.setRepoEnabled('/fake/work/web-app', true, '/fake/envs/dev.env');

    expect(outcome).toEqual({ kind: 'saved' });
    expect(settingsStore.settings.reproductionRepos).toEqual({ '/fake/work/web-app': { enabled: true, envFile: '/fake/envs/dev.env' } });
    expect(settings.state().repos[0]).toMatchObject({ enabled: true, envFile: '/fake/envs/dev.env' });
    expect(changes.count).toBeGreaterThan(0);
  });

  it('환경 파일 없이 켜면 지정 안 함으로 저장된다', async () => {
    const { settings, settingsStore } = await setup();

    await settings.setRepoEnabled('/fake/work/web-app', true);

    expect(settingsStore.settings.reproductionRepos['/fake/work/web-app']).toEqual({ enabled: true, envFile: null });
  });

  it('끄면 환경 파일 지정은 남아 다시 켤 때 이어 쓴다', async () => {
    const { settings, settingsStore } = await setup();
    await settings.setRepoEnabled('/fake/work/web-app', true, '/fake/envs/dev.env');

    await settings.setRepoEnabled('/fake/work/web-app', false);
    expect(settingsStore.settings.reproductionRepos['/fake/work/web-app']).toEqual({ enabled: false, envFile: '/fake/envs/dev.env' });

    await settings.setRepoEnabled('/fake/work/web-app', true);
    expect(settingsStore.settings.reproductionRepos['/fake/work/web-app']).toEqual({ enabled: true, envFile: '/fake/envs/dev.env' });
  });

  it('없는 파일이나 절대 경로가 아닌 값은 환경 파일로 받지 않고 아무것도 바꾸지 않는다', async () => {
    const { settings, settingsStore } = await setup();

    expect(await settings.setRepoEnabled('/fake/work/web-app', true, '/fake/envs/missing.env')).toEqual({ kind: 'invalid-env-file' });
    expect(await settings.setRepoEnabled('/fake/work/web-app', true, 'relative.env')).toEqual({ kind: 'invalid-env-file' });
    expect(await settings.setEnvFile('/fake/work/web-app', '/fake/envs/missing.env')).toEqual({ kind: 'invalid-env-file' });
    expect(settingsStore.settings.reproductionRepos).toEqual({});
  });

  it('환경 파일을 바꾸거나 지정 해제할 수 있다', async () => {
    const { settings, settingsStore, files } = await setup();
    files.add('/fake/envs/other.env');
    await settings.setRepoEnabled('/fake/work/web-app', true, '/fake/envs/dev.env');

    await settings.setEnvFile('/fake/work/web-app', '/fake/envs/other.env');
    expect(settingsStore.settings.reproductionRepos['/fake/work/web-app']?.envFile).toBe('/fake/envs/other.env');

    await settings.setEnvFile('/fake/work/web-app', null);
    expect(settings.state().repos[0]).toMatchObject({ enabled: true, envFile: null });
  });

  it('매핑되지 않은 저장소는 켜지 못한다', async () => {
    const { settings, settingsStore } = await setup();

    expect(await settings.setRepoEnabled('/fake/work/unmapped', true)).toEqual({ kind: 'not-mapped' });
    expect(settingsStore.settings.reproductionRepos).toEqual({});
  });

  it('칸을 열 때 지정한 환경 파일이 없어졌으면 알린다', async () => {
    const { settings, files } = await setup();
    await settings.setRepoEnabled('/fake/work/web-app', true, '/fake/envs/dev.env');
    files.delete('/fake/envs/dev.env');

    await settings.refreshRepos();

    expect(settings.state().repos[0]?.envFileMissing).toBe(true);
  });

  it('다른 설정의 저장을 덮어쓰지 않는다', async () => {
    const { settings, settingsStore } = await setup();
    settingsStore.settings = { ...settingsStore.settings, parallelWorkCount: 4 };

    await settings.setRepoEnabled('/fake/work/web-app', true);

    expect(settingsStore.settings.parallelWorkCount).toBe(4);
  });
});

describe('Windows', () => {
  it('재현을 지원하지 않아 저장소 줄도 서버 목록도 없고 어떤 설정도 저장되지 않는다', async () => {
    const { settings, settingsStore, runner } = await setup({ platform: 'win32' });

    await settings.refreshServers();
    expect(await settings.setRepoEnabled('/fake/work/web-app', true)).toEqual({ kind: 'unsupported' });
    await settings.setToolMode('manual');

    expect(settings.state()).toMatchObject({ supported: false, repos: [], tools: { servers: [], status: 'idle' } });
    expect(settingsStore.settings.reproductionRepos).toEqual({});
    expect(settingsStore.settings.reproductionTools.mode).toBe('auto');
    expect(runner.requests).toEqual([]);
  });
});

describe('재현 도구 권한', () => {
  it('기본은 자동이고 서버 목록은 아직 읽지 않았다', async () => {
    const { settings } = await setup();

    expect(settings.state().tools).toEqual({ mode: 'auto', status: 'idle', servers: [], codexListFailed: false });
  });

  it('탭을 열면 Claude Code는 설정 파일에서, Codex는 목록 명령에서 읽어 Claude Code 줄이 먼저 나온다', async () => {
    const { settings, runner } = await setup();

    await settings.refreshServers();

    const { tools } = settings.state();
    expect(tools.status).toBe('loaded');
    expect(tools.servers.map((server) => [server.agent, server.name, server.enabled])).toEqual([
      ['claude-code', 'playwright', false],
      ['claude-code', 'my-sim', false],
      ['codex', 'codex-web', false],
    ]);
    expect(runner.requests.map((request) => [request.command, request.args, request.cwd])).toEqual([
      ['/fake/bin/codex', ['mcp', 'list', '--json'], '/fake/app-data'],
    ]);
  });

  it('Codex를 찾지 못했으면 목록 명령을 돌리지 않고 Claude Code 서버만 보인다', async () => {
    const { settings, runner } = await setup({ codex: false });

    await settings.refreshServers();

    expect(settings.state().tools.servers.map((server) => server.agent)).toEqual(['claude-code', 'claude-code']);
    expect(settings.state().tools.codexListFailed).toBe(false);
    expect(runner.requests).toEqual([]);
  });

  it('Codex 목록 명령이 실패해도 Claude Code 목록은 보이고 실패를 알린다. 로그에는 출력 내용이 없다', async () => {
    const { settings, runner, logLines } = await setup();
    runner.respond('/fake/bin/codex', ['mcp', 'list', '--json'], exited(1, `{"env":"${SECRET}"}`, SECRET));

    await settings.refreshServers();

    expect(settings.state().tools.codexListFailed).toBe(true);
    expect(settings.state().tools.servers).toHaveLength(2);
    expect(logLines.join('')).not.toContain(SECRET);
  });

  it('Claude Code 설정 파일이 깨져 읽지 못해도 오류 원문(파일 내용 조각)은 로그에 남지 않는다', async () => {
    const { settings, logLines } = await setup({ claudeError: true });

    await settings.refreshServers();

    expect(settings.state().tools.servers.map((server) => server.agent)).toEqual(['codex']);
    expect(logLines.join('')).toContain('reproduction.claude-config-unreadable');
    expect(logLines.join('')).not.toContain(SECRET);
  });

  it('직접 선택에서 켠 서버는 에이전트별 이름만 설정에 저장된다. 서버 정의의 값은 설정 파일과 로그에 없다', async () => {
    const { settings, settingsStore, logLines } = await setup();
    await settings.refreshServers();

    await settings.setToolMode('manual');
    await settings.setServerEnabled('claude-code', 'playwright', true);
    await settings.setServerEnabled('codex', 'codex-web', true);

    expect(settingsStore.settings.reproductionTools).toEqual({
      mode: 'manual',
      enabledServers: { 'claude-code': ['playwright'], codex: ['codex-web'] },
    });
    expect(JSON.stringify(settingsStore.settings)).not.toContain(SECRET);
    expect(logLines.join('')).not.toContain(SECRET);
    expect(JSON.stringify(settings.state())).not.toContain(SECRET);
  });

  it('같은 이름이어도 에이전트마다 따로 켠다', async () => {
    const { settings, runner } = await setup();
    runner.respond(
      '/fake/bin/codex',
      ['mcp', 'list', '--json'],
      exited(0, JSON.stringify([{ name: 'playwright', enabled: true, transport: { type: 'stdio', command: 'x' } }])),
    );
    await settings.refreshServers();

    await settings.setServerEnabled('claude-code', 'playwright', true);

    expect(settings.state().tools.servers.filter((server) => server.name === 'playwright').map((server) => server.enabled)).toEqual([true, false]);
  });

  it('새로 등록된 서버는 꺼진 채로 나타난다', async () => {
    const { settings } = await setup({
      settings: { reproductionTools: { mode: 'manual', enabledServers: { 'claude-code': ['playwright'] } } },
    });

    await settings.refreshServers();

    expect(settings.state().tools.servers.map((server) => [server.name, server.enabled])).toEqual([
      ['playwright', true],
      ['my-sim', false],
      ['codex-web', false],
    ]);
  });

  it('목록에 없는 서버는 켜지 못하지만, 목록에서 사라진 저장된 이름은 끌 수 있다', async () => {
    const { settings, settingsStore } = await setup({
      settings: { reproductionTools: { mode: 'manual', enabledServers: { 'claude-code': ['gone'] } } },
    });
    await settings.refreshServers();

    await settings.setServerEnabled('claude-code', 'never-registered', true);
    expect(settingsStore.settings.reproductionTools.enabledServers).toEqual({ 'claude-code': ['gone'] });

    await settings.setServerEnabled('claude-code', 'gone', false);
    expect(settingsStore.settings.reproductionTools.enabledServers).toEqual({});
  });

  it('자동으로 되돌려도 켜 둔 서버 이름은 남는다', async () => {
    const { settings, settingsStore } = await setup();
    await settings.refreshServers();
    await settings.setToolMode('manual');
    await settings.setServerEnabled('claude-code', 'my-sim', true);

    await settings.setToolMode('auto');

    expect(settingsStore.settings.reproductionTools).toEqual({ mode: 'auto', enabledServers: { 'claude-code': ['my-sim'] } });
  });

  it('조회가 겹치면 늦게 시작한 조회의 결과만 쓴다', async () => {
    const { settings, runner } = await setup();
    /** 첫 조회의 Codex 명령을 붙잡아 둘 해제 함수. */
    let release: (() => void) | undefined;
    runner.respond(
      '/fake/bin/codex',
      ['mcp', 'list', '--json'],
      () =>
        new Promise((resolve) => {
          release = () => resolve(exited(0, JSON.stringify([{ name: 'stale', enabled: true, transport: { type: 'stdio', command: 'x' } }])));
        }),
    );
    const first = settings.refreshServers();
    runner.respond('/fake/bin/codex', ['mcp', 'list', '--json'], exited(0, CODEX_LIST));
    await settings.refreshServers();

    release?.();
    await first;

    expect(settings.state().tools.servers.map((server) => server.name)).not.toContain('stale');
  });
});
