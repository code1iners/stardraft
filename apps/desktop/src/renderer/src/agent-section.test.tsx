import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentCheckProgress, AgentConnectionSnapshot, AgentId, AgentPreferencesSnapshot } from '../../shared/ipc';
import { AgentSection } from './AgentSection';

/** 가짜 연결 상태. 경로와 버전은 가짜다. */
function connection(agent: AgentId, progress: AgentCheckProgress, cliPath: string | null): AgentConnectionSnapshot {
  /** 명령 이름. */
  const command = agent === 'codex' ? 'codex' : 'claude';
  return {
    agent,
    progress,
    details: {
      cliPath,
      cliCommand: command,
      updateCommand: `${command} update`,
      version: cliPath === null ? null : '1.0.0',
      requiredVersion: '0.0.1',
      authMethod: null,
      pathSource: 'login-shell',
      searchedDirs: [],
      errorOutput: null,
    },
  };
}

/** 연결된 에이전트가 없는 기본 에이전트·모델 선택. */
const NO_PREFERENCES: AgentPreferencesSnapshot = { connectedAgents: [], defaultAgent: null, models: {} };

/** 에이전트 칸을 macOS로 그린 HTML. */
function htmlOf(agentConnections: AgentConnectionSnapshot[], agentPreferences = NO_PREFERENCES): string {
  return renderToStaticMarkup(<AgentSection agentConnections={agentConnections} agentPreferences={agentPreferences} platform="darwin" />);
}

describe('설정 "에이전트" 칸', () => {
  it('macOS에서 Codex 설치를 찾았으면 Claude Code 아래에 Codex 연결 카드도 보이고, 연결되면 "✓ Codex 연결됨"이다. 둘 다 연결되면 기본 에이전트를 고른다', () => {
    /** 그린 HTML. */
    const html = htmlOf(
      [connection('claude-code', { status: 'connected' }, '/fake/bin/claude'), connection('codex', { status: 'connected' }, '/fake/bin/codex')],
      {
        connectedAgents: ['claude-code', 'codex'],
        defaultAgent: 'codex',
        models: {
          'claude-code': { options: [], selected: null },
          codex: { options: [{ id: 'gpt-fake-pro', label: 'GPT-Fake-Pro', unlisted: false }], selected: 'gpt-fake-pro' },
        },
      },
    );

    expect(html.match(/class="agent-card"/g)).toHaveLength(2);
    expect(html.indexOf('✓ Claude Code 연결됨')).toBeLessThan(html.indexOf('✓ Codex 연결됨'));
    expect(html).toContain('기본 에이전트');
    expect(html).toMatch(/<input type="radio" name="default-agent" checked="" value="codex"\/>Codex/);
    expect(html).toContain('Codex 모델');
    expect(html).toMatch(/<option value="gpt-fake-pro" selected="">GPT-Fake-Pro<\/option>/);
  });

  it('Codex 설치를 찾지 못했으면 Codex 카드는 보이지 않는다(설치했을 때만 후보다). Claude Code 카드는 늘 보인다', () => {
    /** 그린 HTML. */
    const html = htmlOf([
      connection('claude-code', { status: 'failed', failure: { step: 'find', reason: 'not-found' } }, null),
      connection('codex', { status: 'failed', failure: { step: 'find', reason: 'not-found' } }, null),
    ]);

    expect(html.match(/class="agent-card"/g)).toHaveLength(1);
    expect(html).toContain('Claude Code를 찾지 못했습니다');
    expect(html).not.toContain('Codex');
  });

  it('Codex에 로그인해야 하면 그 카드에 codex login 명령과 브라우저 로그인 그림을 보인다', () => {
    /** 그린 HTML. */
    const html = htmlOf([
      connection('claude-code', { status: 'connected' }, '/fake/bin/claude'),
      connection('codex', { status: 'failed', failure: { step: 'login', reason: 'not-logged-in' } }, '/fake/bin/codex'),
    ]);

    expect(html).toContain('Codex에 로그인해야 합니다');
    expect(html).toContain('<span class="mini-command">codex login</span>');
    expect(html).toContain('ChatGPT에 로그인');
  });
});
