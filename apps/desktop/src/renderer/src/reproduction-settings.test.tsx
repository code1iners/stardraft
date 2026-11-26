import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReproductionServerSnapshot } from '../../shared/ipc';
import { AgentSection } from './AgentSection';
import { RepositoriesSection } from './RepositoriesSection';
import { ReproductionConfirmModal } from './ReproductionConfirmModal';
import { ReproductionPanel } from './ReproductionPanel';
import { reproductionSnapshot, UNSUPPORTED_REPRODUCTION } from './reproduction-fixtures';

/** 마크업에서 태그를 지운 글자. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

/** 서버 한 줄. 값이 없는 항목은 흔한 값으로 채운다. */
function server(overrides: Partial<ReproductionServerSnapshot> & Pick<ReproductionServerSnapshot, 'name'>): ReproductionServerSnapshot {
  return { agent: 'claude-code', kind: 'stdio', external: false, deniedTools: [], enabled: false, ...overrides };
}

/** 저장소 칸을 그린 마크업. */
function repositoriesHtml(reproduction = reproductionSnapshot()): string {
  return renderToStaticMarkup(
    <RepositoriesSection
      repoMappings={{ mappings: [], waiting: [], projects: { status: 'idle' } }}
      sentryProjects={{ projects: [], candidates: { status: 'idle' } }}
      reproduction={reproduction}
    />,
  );
}

describe('설정 "저장소" 칸: 재현 항목', () => {
  it('매핑된 저장소마다 재현 허용 체크 상자가 있고, 꺼져 있으면 환경 파일 줄이 없다', () => {
    const html = repositoriesHtml(
      reproductionSnapshot({
        repos: [
          { path: '/fake/work/web-app', enabled: false, envFile: null, envFileMissing: false },
          { path: '/fake/work/api', enabled: false, envFile: null, envFileMissing: false },
        ],
      }),
    );

    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(textOf(html)).toContain('/fake/work/web-app');
    expect(textOf(html)).toContain('재현 허용');
    expect(textOf(html)).not.toContain('환경 파일');
    expect(html).not.toContain('modal-backdrop');
  });

  it('켜 두었고 환경 파일을 지정하지 않았으면 "지정 안 함 · 원본 .env 사용"이 빨간 글씨와 [파일 고르기…]로 보인다', () => {
    const html = repositoriesHtml(reproductionSnapshot({ repos: [{ path: '/fake/work/web-app', enabled: true, envFile: null, envFileMissing: false }] }));

    expect(html).toMatch(/<span class="danger-text path-text">지정 안 함 · 원본 \.env 사용<\/span>/);
    expect(textOf(html)).toContain('파일 고르기…');
    expect(html).toMatch(/<input type="checkbox" checked=""/);
  });

  it('환경 파일을 지정했으면 경로와 [바꾸기…]가 보이고, 파일이 없어졌으면 알린다', () => {
    const html = repositoriesHtml(
      reproductionSnapshot({ repos: [{ path: '/fake/work/web-app', enabled: true, envFile: '/fake/envs/dev.env', envFileMissing: true }] }),
    );

    expect(textOf(html)).toContain('/fake/envs/dev.env');
    expect(textOf(html)).toContain('바꾸기…');
    expect(textOf(html)).toContain('파일을 찾을 수 없음');
    expect(textOf(html)).not.toContain('지정 안 함');
  });

  it('매핑된 저장소가 없으면 안내만 보인다', () => {
    expect(textOf(repositoriesHtml())).toContain('매핑된 저장소가 없습니다');
  });

  it('Windows에서는 재현 항목이 보이지 않는다', () => {
    const html = repositoriesHtml(UNSUPPORTED_REPRODUCTION);

    expect(textOf(html)).not.toContain('재현');
    expect(textOf(html)).toContain('저장소 매핑');
  });
});

describe('재현을 켜는 확인 모달', () => {
  /** 모달을 그린 글자. */
  const modalText = (initialEnvFile: string | null) =>
    renderToStaticMarkup(<ReproductionConfirmModal repoPath="/fake/work/web-app" initialEnvFile={initialEnvFile} onClose={() => {}} />);

  it('허용되는 일(셸, 네트워크, MCP), 환경 파일 고르기, 원본 .env 경고, 운영 키 금지, MCP 인증 값 노출 안내가 한 화면에 있다', () => {
    const html = modalText(null);
    const text = textOf(html);

    expect(html).toContain('modal-backdrop');
    expect(html).toContain('role="dialog"');
    expect(text).toContain('셸 명령 실행');
    expect(text).toContain('네트워크 사용');
    expect(text).toContain('MCP 도구 사용');
    expect(text).toContain('재현용 환경 파일');
    expect(text).toContain('파일 고르기…');
    expect(text).toContain('지정 안 함 · 원본 .env 사용');
    expect(text).toContain('원본 .env를 그대로 씁니다');
    expect(text).toContain('운영 키를 넣지 마세요');
    expect(text).toContain('MCP 인증 값도 에이전트에게 노출될 수 있습니다');
    expect(text).toContain('취소');
    expect(text).toContain('켜기');
  });

  it('이미 지정한 환경 파일이 있으면 그 경로를 보이고 원본 .env 경고는 없다', () => {
    const text = textOf(modalText('/fake/envs/dev.env'));

    expect(text).toContain('/fake/envs/dev.env');
    expect(text).toContain('바꾸기…');
    expect(text).not.toContain('원본 .env를 그대로 씁니다');
  });
});

describe('설정 "에이전트" 칸: 재현 탭', () => {
  /** 에이전트 칸을 그린 마크업. */
  const agentHtml = (reproduction = reproductionSnapshot()) =>
    renderToStaticMarkup(
      <AgentSection
        agentConnections={[]}
        agentPreferences={{ connectedAgents: [], defaultAgent: null, models: {} }}
        parallelWork={{ count: 1, running: 0 }}
        reproduction={reproduction}
        platform="darwin"
      />,
    );

  it('탭 순서는 연결, 재현, 병렬 작업이다', () => {
    const labels = [...agentHtml().matchAll(/role="tab"[^>]*>([^<]+)</g)].map((match) => match[1]);

    expect(labels).toEqual(['연결', '재현', '병렬 작업']);
  });

  it('Windows에서는 재현 탭이 보이지 않는다', () => {
    const labels = [...agentHtml(UNSUPPORTED_REPRODUCTION).matchAll(/role="tab"[^>]*>([^<]+)</g)].map((match) => match[1]);

    expect(labels).toEqual(['연결', '병렬 작업']);
  });
});

describe('재현 도구 권한 패널', () => {
  /** 패널을 그린 마크업. */
  const panelHtml = (overrides: Parameters<typeof reproductionSnapshot>[0] = {}) =>
    renderToStaticMarkup(<ReproductionPanel reproduction={reproductionSnapshot(overrides)} />);

  /** 목록의 서버들. */
  const SERVERS: ReproductionServerSnapshot[] = [
    server({ name: 'playwright', deniedTools: ['browser_run_code_unsafe', 'browser_file_upload'] }),
    server({ name: 'remote-docs', kind: 'http', external: true }),
    server({ name: 'codex-sim', agent: 'codex' }),
  ];

  it('기본은 자동이고, 자동에서는 외부로 보내는 MCP도 실린다는 경고가 있으며 서버 체크 상자는 없다', () => {
    const html = panelHtml({ tools: { servers: SERVERS } });

    expect(html).toMatch(/<input type="radio" name="reproduction-tool-mode" checked="" value="auto"\/>자동/);
    expect(html).toMatch(/<input type="radio" name="reproduction-tool-mode" value="manual"\/>직접 선택/);
    expect(textOf(html)).toContain('외부로 보내는 MCP도 함께 실립니다');
    expect(html).not.toContain('type="checkbox"');
  });

  it('줄마다 이름, 종류, 출처 CLI, 앱이 뺀 위험 도구가 보이고 외부로 보낼 수 있는 서버에만 "외부로 보냄" 꼬리표가 붙는다', () => {
    const html = panelHtml({ tools: { servers: SERVERS } });
    /** 줄별 글자. */
    const rows = [...html.matchAll(/<li class="folder-item">(.*?)<\/li>/g)].map((match) => textOf(match[1] ?? ''));

    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('playwright');
    expect(rows[0]).toContain('Claude Code');
    expect(rows[0]).toContain('앱이 뺀 도구: browser_run_code_unsafe, browser_file_upload');
    expect(rows[0]).not.toContain('외부로 보냄');
    expect(rows[1]).toContain('원격 주소');
    expect(rows[1]).toContain('외부로 보냄');
    expect(rows[2]).toContain('Codex');
  });

  it('직접 선택에서는 줄마다 체크 상자가 있고 켠 서버만 체크되어 있다', () => {
    const html = panelHtml({ tools: { mode: 'manual', servers: [server({ name: 'on', enabled: true }), server({ name: 'off' })] } });

    expect(html.match(/type="checkbox"/g)).toHaveLength(2);
    expect(html.match(/type="checkbox" checked=""/g)).toHaveLength(1);
    expect(textOf(html)).toContain('새로 등록한 서버는 꺼진 채로 나타납니다');
    expect(textOf(html)).toContain('프로젝트 정의 파일에 있는 서버는 목록에 없고');
    expect(textOf(html)).not.toContain('외부로 보내는 MCP도 함께 실립니다');
  });

  it('MCP가 없으면 "셸로만 재현, 조작이 필요하면 불가(도구 없음)"가 보인다', () => {
    expect(textOf(panelHtml())).toContain('셸로만 재현, 조작이 필요하면 불가(도구 없음)');
  });

  it('목록을 읽는 중이면 안내 문구 대신 읽는 중이라고 한다', () => {
    const text = textOf(panelHtml({ tools: { status: 'loading' } }));

    expect(text).toContain('MCP 서버 목록을 읽는 중');
    expect(text).not.toContain('도구 없음');
  });

  it('플러그인 MCP와 커넥터는 실리지 않는다는 안내가 늘 있다', () => {
    for (const mode of ['auto', 'manual'] as const) {
      expect(textOf(panelHtml({ tools: { mode, servers: SERVERS } }))).toContain('플러그인 MCP와 커넥터는 실리지 않습니다');
    }
  });

  it('Codex 목록을 읽지 못했으면 알린다', () => {
    expect(textOf(panelHtml({ tools: { codexListFailed: true } }))).toContain('Codex의 MCP 서버 목록을 읽지 못했습니다');
  });
});
