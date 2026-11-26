import { describe, expect, it } from 'vitest';
import { parseClaudeMcpServers, parseCodexMcpServers } from './mcp-servers';

/** 테스트용 가짜 비밀 값. 어떤 결과에도 나오면 안 된다. */
const SECRET = 'FAKE-SECRET-VALUE-9f3a';

/** 가짜 Claude Code 설정 파일. 사용자 범위 둘, 로컬 범위 하나(이름 겹침 포함), 꺼 둔 서버 하나. */
const CLAUDE_CONFIG = {
  mcpServers: {
    playwright: { type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], env: { TOKEN: SECRET } },
    'remote-docs': { type: 'http', url: `https://fake.example/mcp?key=${SECRET}`, headers: { Authorization: `Bearer ${SECRET}` } },
    legacy: { command: 'node', args: ['server.js'] },
    shared: { command: 'user-version' },
  },
  projects: {
    '/fake/work/web-app': {
      mcpServers: { shared: { command: 'local-version', type: 'stdio' }, 'local-only': { type: 'sse', url: 'https://fake.example/sse' } },
      disabledMcpServers: ['legacy'],
    },
    '/fake/work/other': { mcpServers: { 'unmapped-local': { command: 'x' } } },
  },
};

describe('Claude Code MCP 서버 목록 읽기', () => {
  it('사용자 범위와 매핑된 저장소의 로컬 범위 서버를 이름, 종류, 출처로 읽고 꺼 둔 서버는 뺀다', () => {
    const servers = parseClaudeMcpServers(CLAUDE_CONFIG, ['/fake/work/web-app']);

    expect(servers.map((server) => [server.name, server.kind, server.agent])).toEqual([
      ['playwright', 'stdio', 'claude-code'],
      ['remote-docs', 'http', 'claude-code'],
      ['shared', 'stdio', 'claude-code'],
      ['local-only', 'sse', 'claude-code'],
    ]);
  });

  it('매핑되지 않은 저장소의 로컬 범위 서버와 저장소의 프로젝트 정의 파일 서버는 목록에 없다', () => {
    const servers = parseClaudeMcpServers(CLAUDE_CONFIG, ['/fake/work/web-app']);

    expect(servers.map((server) => server.name)).not.toContain('unmapped-local');
    expect(parseClaudeMcpServers({ mcpServers: {} }, ['/fake/work/web-app'])).toEqual([]);
  });

  it('원격 서버와 알려진 외부 전송 서버에 "외부로 보냄"이 붙고, 알려진 서버는 앱이 뺀 위험 도구가 보인다', () => {
    const servers = parseClaudeMcpServers(CLAUDE_CONFIG, ['/fake/work/web-app']);
    /** 이름으로 찾은 줄. */
    const byName = (name: string) => servers.find((server) => server.name === name);

    expect(byName('remote-docs')?.external).toBe(true);
    expect(byName('local-only')?.external).toBe(true);
    expect(byName('playwright')?.external).toBe(false);
    expect(byName('playwright')?.deniedTools).toEqual(['browser_run_code_unsafe', 'browser_file_upload']);
    expect(byName('legacy')).toBeUndefined();
  });

  it('서버 정의의 값(환경 변수, 헤더, 주소)은 결과 어디에도 없다', () => {
    const servers = parseClaudeMcpServers(CLAUDE_CONFIG, ['/fake/work/web-app']);

    expect(JSON.stringify(servers)).not.toContain(SECRET);
    for (const server of servers) {
      expect(Object.keys(server).sort()).toEqual(['agent', 'deniedTools', 'external', 'kind', 'name']);
    }
  });

  it('설정 파일이 없거나 모양이 다르면 빈 목록이다', () => {
    expect(parseClaudeMcpServers(null, ['/fake/work/web-app'])).toEqual([]);
    expect(parseClaudeMcpServers([], [])).toEqual([]);
    expect(parseClaudeMcpServers({ mcpServers: { broken: 'text' } }, [])).toEqual([]);
  });
});

describe('Codex MCP 서버 목록 읽기', () => {
  /** 가짜 `codex mcp list --json` 출력. 평문 값이 들어 있다. */
  const LIST = [
    { name: 'maestro', enabled: true, transport: { type: 'stdio', command: 'maestro', args: ['mcp'], env: { KEY: SECRET } } },
    { name: 'docs', enabled: true, transport: { type: 'streamable_http', url: 'https://fake.example/mcp', http_headers: { Authorization: SECRET } } },
    { name: 'off', enabled: false, transport: { type: 'stdio', command: 'x' } },
    { enabled: true, transport: { type: 'stdio', command: 'nameless' } },
  ];

  it('켜진 서버를 이름, 종류, 출처로 읽고 꺼진 서버와 이름 없는 항목은 뺀다', () => {
    const servers = parseCodexMcpServers(LIST);

    expect(servers.map((server) => [server.name, server.kind, server.agent, server.external])).toEqual([
      ['maestro', 'stdio', 'codex', true],
      ['docs', 'http', 'codex', true],
    ]);
    expect(servers[0]?.deniedTools).toEqual(['run_on_cloud']);
  });

  it('출력의 평문 값은 결과에 남지 않는다', () => {
    expect(JSON.stringify(parseCodexMcpServers(LIST))).not.toContain(SECRET);
  });

  it('배열이 아닌 출력은 빈 목록이다', () => {
    expect(parseCodexMcpServers({ servers: [] })).toEqual([]);
    expect(parseCodexMcpServers('text')).toEqual([]);
  });
});
