import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, type AppSnapshot, type OnboardingSnapshot } from '../../shared/ipc';
import { sectionNeedsSetup, SetupBand } from './Onboarding';
import { PopoverContent } from './PopoverView';
import { UNSUPPORTED_REPRODUCTION } from './reproduction-fixtures';

/** 첫 실행의 온보딩 상태. */
const FIRST_RUN: OnboardingSnapshot = {
  detectionStarted: false,
  requirements: { agent: 'needed' },
  ready: false,
  hasDetectionTarget: false,
  flowConnected: false,
  sentryConnected: false,
  start: { status: 'idle' },
};

/** 필수 설정을 마치고 Flow도 연결한 온보딩 상태. */
const READY: OnboardingSnapshot = {
  detectionStarted: false,
  requirements: { agent: 'done' },
  ready: true,
  hasDetectionTarget: true,
  flowConnected: true,
  sentryConnected: false,
  start: { status: 'idle' },
};

/** 필수 설정만 마치고 연결한 서비스는 없는 온보딩 상태. */
const READY_WITHOUT_TARGET: OnboardingSnapshot = { ...READY, hasDetectionTarget: false, flowConnected: false };

/** 가짜 앱 상태 스냅숏. 실제 사람이나 회사가 아니다. */
function snapshot(onboarding: OnboardingSnapshot, overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    appName: 'Stardraft',
    version: '0.0.0-test',
    platform: 'darwin',
    flowAccount: { account: null, keyCheck: { status: 'idle' } },
    sentry: { connected: false, organizations: [], tokenCheck: { status: 'idle' }, tokenProblem: null },
    sentryProjects: { projects: [], candidates: { status: 'idle' } },
    reproduction: UNSUPPORTED_REPRODUCTION,
    globalProblem: null,
    agentConnections: [
      {
        agent: 'claude-code',
        progress: { status: 'idle' },
        cliFound: false,
        details: {
          cliPath: null,
          cliCommand: 'claude',
          updateCommand: 'claude update',
          version: null,
          requiredVersion: '0.0.0',
          authMethod: null,
          pathSource: null,
          searchedDirs: [],
          errorOutput: null,
        },
      },
    ],
    agentPreferences: { connectedAgents: [], defaultAgent: null, models: {} },
    repoMappings: { mappings: [], waiting: [], projects: { status: 'idle' } },
    onboarding,
    launchAtLogin: false,
    editor: { choice: null, installed: [], picker: null },
    review: {
      bundles: [],
      sections: {
        compact: { original: true, requirement: true, draft: true, evidence: false, repository: false, progress: true },
        expanded: { original: true, requirement: true, draft: true, evidence: true, repository: true, progress: true },
      },
      diagnoses: [],
      repoPicker: null,
    },
    manualCheck: { canOpen: false, sheet: null },
    draftSettings: { extraInstructions: '', defaultSecretPatterns: ['.env'], extraSecretPatterns: [] },
    parallelWork: { count: 1, running: 0 },
    reportFolder: { path: '/가짜/문서/Stardraft/Reports/Sentry', isDefault: true },
    update: { status: { kind: 'idle' }, justUpdated: null, restartConfirm: null, dismissedBanners: [] },
    ...overrides,
  };
}

/** 화면을 그린 HTML에서 태그를 지운 글자. */
function textOf(element: React.ReactElement): string {
  return renderToStaticMarkup(element).replace(/<[^>]+>/g, ' ');
}

describe('작은 창: 필수 설정 전', () => {
  it('안내 문장과 "필수"·"감지할 대상 · 선택" 두 묶음, 머리의 설정 아이콘을 보이고 [감지 시작]은 없다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot(FIRST_RUN)} />);

    expect(text).toContain('감지를 시작하려면 에이전트를 연결해야 합니다.');
    expect(text).toContain('필수');
    expect(text).toContain('감지할 대상 · 선택');
    for (const label of ['에이전트', 'Flow 계정']) expect(text).toContain(label);
    expect(text.match(/필요/g)).toHaveLength(1);
    expect(text).toContain('연결 안 함');
    expect(text).not.toContain('작업 폴더');
    expect(text).not.toContain('Flow 개인 API 키');
    expect(renderToStaticMarkup(<PopoverContent snapshot={snapshot(FIRST_RUN)} />)).toContain('aria-label="설정 열기"');
    expect(text).not.toContain('감지 시작');
  });

  it('통과한 항목은 ✓와 연결된 내용을 보인다. Flow 계정은 연결하면 ✓이고 계정 이름을 보인다', () => {
    const text = textOf(
      <PopoverContent
        snapshot={snapshot(
          { ...FIRST_RUN, requirements: { agent: 'checking' }, hasDetectionTarget: true, flowConnected: true },
          { flowAccount: { account: { name: '테스트 사용자', division: '테스트 팀', email: 'me@example.test' }, keyCheck: { status: 'idle' } } },
        )}
      />,
    );

    expect(text).toContain('✓');
    expect(text).toContain('테스트 사용자 · 테스트 팀');
    expect(text).toContain('확인 중');
    // Flow 줄은 연결됐고 Sentry 줄만 연결 안 함이다.
    expect(text.match(/연결 안 함/g)).toHaveLength(1);
  });

  it('감지할 대상 묶음에 Flow 계정 다음으로 Sentry 줄이 있고, 연결하면 ✓와 조직 수를 보인다', () => {
    /** Sentry만 연결한 온보딩 상태. */
    const sentryOnly: OnboardingSnapshot = { ...READY, hasDetectionTarget: true, flowConnected: false, sentryConnected: true };
    const text = textOf(
      <PopoverContent
        snapshot={snapshot(sentryOnly, { sentry: { connected: true, organizations: [{ name: '조직 A' }, { name: '조직 B' }], tokenCheck: { status: 'idle' }, tokenProblem: null } })}
      />,
    );

    expect(text.indexOf('Flow 계정')).toBeLessThan(text.indexOf('Sentry'));
    expect(text).toContain('조직 2개');
    expect(text.match(/✓/g)).toHaveLength(2);
    expect(text.match(/연결 안 함/g)).toHaveLength(1);
    expect(text).not.toContain('연결한 서비스가 없어');
  });

  it('필수를 마치면 완료 문장과 하단 안내 없이 [감지 시작]을 보인다. Flow를 연결했으면 연결한 서비스가 없다는 안내는 없다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot(READY)} />);

    expect(text).toContain('감지 시작');
    expect(text).not.toContain('연결한 서비스가 없어');
    expect(text).not.toContain('필수 설정을 마쳤습니다.');
    expect(text).not.toContain('로그인할 때 Stardraft가 자동으로 켜집니다. 설정의 일반에서 끌 수 있습니다.');
    expect(text).not.toContain('곧 macOS가 알림 허용을 묻습니다.');
  });

  it('연결한 서비스가 없어도 막지 않고 [감지 시작] 위에 안내를 보인다', () => {
    /** 마크업. */
    const markup = renderToStaticMarkup(<PopoverContent snapshot={snapshot(READY_WITHOUT_TARGET)} />);
    /** 글자. */
    const text = markup.replace(/<[^>]+>/g, ' ');

    expect(text).toContain('연결한 서비스가 없어 아직 감지할 대상이 없습니다. 지금 시작하고 나중에 서비스를 연결해도 됩니다.');
    expect(markup).toMatch(/<button[^>]*>감지 시작<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>감지 시작<\/button>/);
    expect(markup.indexOf('연결한 서비스가 없어')).toBeLessThan(markup.indexOf('감지 시작</button>'));
  });

  it('Windows에서도 하단 보조 안내를 생략한다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot(READY, { platform: 'win32' })} />);

    expect(text).not.toContain('Stardraft 아이콘은 작업 표시줄 오른쪽 ^ 안에 있습니다.');
    expect(text).not.toContain('작업 표시줄 아이콘이 채워지면 검토할 초안이 있습니다.');
    expect(text).not.toContain('macOS');
  });

  it.each([
    { agents: ['claude-code'] as const, label: 'Claude Code 연결됨' },
    { agents: ['codex'] as const, label: 'Codex 연결됨' },
    { agents: ['claude-code', 'codex'] as const, label: 'Claude Code · Codex 연결됨' },
  ])('연결된 에이전트를 모두 표시한다: $label', ({ agents, label }) => {
    /** 연결된 에이전트와 기본 에이전트가 있는 완료 화면. */
    const text = textOf(
      <PopoverContent snapshot={snapshot(READY, {
        agentPreferences: { connectedAgents: [...agents], defaultAgent: agents[0], models: {} },
      })} />,
    );
    expect(text).toContain(label);
  });

  it('감지 시작이 실패하면 이유를 보인다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot({ ...READY, start: { status: 'failed', reason: 'network' } })} />);

    expect(text).toContain('Flow에 연결할 수 없습니다.');
  });
});

describe('작은 창: 감지를 시작한 뒤', () => {
  it('묶음이 없으면 빈 화면과 [최근 멘션 확인] 자리를 보이고, 체크리스트는 보이지 않는다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot({ ...READY, detectionStarted: true })} />);

    expect(text).toContain('아직 멘션이 없습니다.');
    expect(text).toContain('최근 멘션 확인');
    expect(text).not.toContain('Flow 계정');
    expect(text).not.toContain('감지 시작');
  });

  it('Windows의 감지 시작 후 빈 화면에서도 하단 보조 안내를 생략한다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot({ ...READY, detectionStarted: true }, { platform: 'win32' })} />);

    expect(text).not.toContain('Stardraft 아이콘은 작업 표시줄 오른쪽 ^ 안에 있습니다.');
  });
});

describe('설정 창 첫 설정 띠', () => {
  it('진행 막대 없이 "필수 설정: 에이전트 연결"과 [에이전트 설정]을 보인다', () => {
    /** 마크업. */
    const markup = renderToStaticMarkup(<SetupBand snapshot={snapshot(FIRST_RUN)} section="general" onSelectSection={() => {}} />);
    /** 글자. */
    const text = markup.replace(/<[^>]+>/g, ' ');

    expect(text).toContain('필수 설정: 에이전트 연결');
    expect(text).toContain('에이전트 설정');
    expect(markup).not.toContain('setup-meter');
    expect(text).not.toMatch(/필수 설정 \d\/\d/);
  });

  it('지금 에이전트 칸을 보고 있으면 다음 항목 버튼을 보이지 않는다', () => {
    const text = textOf(<SetupBand snapshot={snapshot(FIRST_RUN)} section="agent" onSelectSection={() => {}} />);

    expect(text).toContain('필수 설정: 에이전트 연결');
    expect(text).not.toContain('에이전트 설정');
  });

  it('필수를 마치면 [감지 시작]과 안내 두 줄을 보인다. 연결한 서비스가 없으면 안내를 더한다', () => {
    const text = textOf(<SetupBand snapshot={snapshot(READY)} section="general" onSelectSection={() => {}} />);

    expect(text).toContain('필수 설정을 마쳤습니다.');
    expect(text).toContain('감지 시작');
    expect(text).toContain('로그인할 때 Stardraft가 자동으로 켜집니다.');
    expect(text).not.toContain('연결한 서비스가 없어');
    expect(textOf(<SetupBand snapshot={snapshot(READY_WITHOUT_TARGET)} section="general" onSelectSection={() => {}} />)).toContain(
      '연결한 서비스가 없어 아직 감지할 대상이 없습니다.',
    );
  });

  it('감지를 시작한 뒤에는 나오지 않는다', () => {
    expect(
      renderToStaticMarkup(<SetupBand snapshot={snapshot({ ...READY, detectionStarted: true })} section="general" onSelectSection={() => {}} />),
    ).toBe('');
  });
});

describe('설정 창 칸 목록의 점', () => {
  it('끝나지 않은 필수는 에이전트 칸에만 점이 찍히고, 감지를 시작하면 찍히지 않는다', () => {
    expect(SETTINGS_SECTIONS.filter((section) => sectionNeedsSetup(snapshot(FIRST_RUN), section))).toEqual(['agent']);
    expect(SETTINGS_SECTIONS.filter((section) => sectionNeedsSetup(snapshot(READY), section))).toEqual([]);
    expect(SETTINGS_SECTIONS.filter((section) => sectionNeedsSetup(snapshot({ ...FIRST_RUN, detectionStarted: true }), section))).toEqual([]);
  });
});
