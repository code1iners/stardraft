import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AgentPreferencesSnapshot } from '../../shared/ipc';
import { AgentSection } from './AgentSection';
import { ParallelWorkPanel } from './ParallelWorkPanel';
import { UnderlineTabs } from './UnderlineTabs';

/** 연결된 에이전트가 없는 기본 에이전트·모델 선택. */
const NO_PREFERENCES: AgentPreferencesSnapshot = { connectedAgents: [], defaultAgent: null, models: {} };

describe('설정 "에이전트" 칸: 탭', () => {
  it('칸 안에 `연결` · `병렬 작업` 밑줄 탭이 있고 처음에는 `연결`이 골라져 있다', () => {
    const html = renderToStaticMarkup(
      <AgentSection agentConnections={[]} agentPreferences={NO_PREFERENCES} parallelWork={{ count: 1, running: 0 }} platform="darwin" />,
    );
    expect(html).toMatch(/<div class="underline-tabs" role="tablist"/);
    expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="true"[^>]*>연결<\/button>/);
    expect(html).toMatch(/<button[^>]*role="tab"[^>]*aria-selected="false"[^>]*>병렬 작업<\/button>/);
    expect(html).not.toContain('병렬 작업 수');
  });

  it('밑줄 탭은 탭마다 점 하나를 찍을 수 있다', () => {
    const html = renderToStaticMarkup(
      <UnderlineTabs
        label="저장소 매핑"
        idPrefix="mapping"
        tabs={[
          { id: 'flow', label: 'Flow' },
          { id: 'sentry', label: 'Sentry', dot: true },
        ]}
        selected="flow"
        onSelect={() => {}}
      />,
    );
    expect(html.match(/underline-tab-dot/g)).toHaveLength(1);
    expect(html).toMatch(/>Sentry<span class="underline-tab-dot" role="img" aria-label="확인 필요"><\/span><\/button>/);
  });
});

describe('설정 "에이전트" 칸: 병렬 작업 탭', () => {
  it('이름, 도움말, 눈금 숫자 없는 1~5 슬라이더와 현재 값, 두 줄 표와 툴팁이 스펙 문구대로 있다', () => {
    const html = renderToStaticMarkup(<ParallelWorkPanel parallelWork={{ count: 2, running: 0 }} />);
    expect(html).toContain('병렬 작업 수');
    expect(html).toContain('올리면 사용량 한도를 더 빨리 씁니다.');
    expect(html).toMatch(/<input[^>]*type="range"[^>]*min="1"[^>]*max="5"[^>]*step="1"[^>]*value="2"/);
    expect(html).not.toContain('<datalist');
    expect(html).toContain('2개');
    expect(html).toMatch(/초안 · 진단.*최대 2개/s);
    expect(html).toMatch(/재현하는 진단.*그중 1개/s);
    expect(html).toContain('연결한 모든 서비스의 초안과 진단을 합친 수입니다.');
    expect(html).toContain('재현을 허용한 저장소의 진단입니다. 시뮬레이터와 포트를 함께 써서 한 번에 하나만 진행합니다.');
  });

  it('진행 중인 작업이 고른 값보다 많을 때만 노란 띠를 보인다', () => {
    expect(renderToStaticMarkup(<ParallelWorkPanel parallelWork={{ count: 2, running: 3 }} />)).toContain('진행 중인 3개가 끝나면 2개로 맞춥니다.');
    expect(renderToStaticMarkup(<ParallelWorkPanel parallelWork={{ count: 2, running: 2 }} />)).not.toContain('끝나면');
    expect(renderToStaticMarkup(<ParallelWorkPanel parallelWork={{ count: 3, running: 1 }} />)).not.toContain('끝나면');
  });
});
