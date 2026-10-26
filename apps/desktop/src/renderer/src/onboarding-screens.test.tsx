import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AppSnapshot, OnboardingSnapshot } from '../../shared/ipc';
import { SetupBand } from './Onboarding';
import { PopoverContent } from './PopoverView';

/** 첫 실행의 온보딩 상태. */
const FIRST_RUN: OnboardingSnapshot = {
  detectionStarted: false,
  requirements: { 'flow-key': 'needed', agent: 'needed', 'work-folders': 'needed' },
  ready: false,
  start: { status: 'idle' },
};

/** 필수 세 가지를 마친 온보딩 상태. */
const READY: OnboardingSnapshot = {
  detectionStarted: false,
  requirements: { 'flow-key': 'done', agent: 'done', 'work-folders': 'done' },
  ready: true,
  start: { status: 'idle' },
};

/** 가짜 앱 상태 스냅숏. 실제 사람이나 회사가 아니다. */
function snapshot(onboarding: OnboardingSnapshot, overrides: Partial<AppSnapshot> = {}): AppSnapshot {
  return {
    appName: 'Stardraft',
    version: '0.0.0-test',
    platform: 'darwin',
    flowAccount: { account: null, keyCheck: { status: 'idle' } },
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
    workFolders: { folders: [], suggestions: [], rejected: [] },
    repoMappings: { mappings: [], projects: { status: 'idle' } },
    onboarding,
    launchAtLogin: false,
    editor: { choice: null, installed: [], picker: null },
    review: {
      bundles: [],
      sections: {
        compact: { original: true, requirement: true, draft: true, evidence: false, repository: false, progress: true },
        expanded: { original: true, requirement: true, draft: true, evidence: true, repository: true, progress: true },
      },
      repoPicker: null,
    },
    trial: { canStart: false, bundleId: null, picker: null },
    draftSettings: { extraInstructions: '', defaultSecretPatterns: ['.env'], extraSecretPatterns: [] },
    update: { status: { kind: 'idle' }, justUpdated: null, restartConfirm: null, dismissedBanners: [] },
    ...overrides,
  };
}

/** 화면을 그린 HTML에서 태그를 지운 글자. */
function textOf(element: React.ReactElement): string {
  return renderToStaticMarkup(element).replace(/<[^>]+>/g, ' ');
}

describe('작은 창: 필수 설정 전', () => {
  it('안내 문장과 필수 세 줄의 "필요", [설정 열기]를 보이고 [감지 시작]은 없다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot(FIRST_RUN)} />);

    expect(text).toContain('멘션 감지를 시작하려면 세 가지를 설정해야 합니다.');
    for (const label of ['Flow 개인 API 키', '에이전트', '작업 폴더']) expect(text).toContain(label);
    expect(text.match(/필요/g)).toHaveLength(3);
    expect(text).toContain('설정 열기');
    expect(text).not.toContain('감지 시작');
  });

  it('통과한 항목은 ✓와 연결된 내용을 보인다', () => {
    const text = textOf(
      <PopoverContent
        snapshot={snapshot(
          { ...FIRST_RUN, requirements: { 'flow-key': 'done', agent: 'checking', 'work-folders': 'needed' } },
          { flowAccount: { account: { name: '테스트 사용자', division: '테스트 팀', email: 'me@example.test' }, keyCheck: { status: 'idle' } } },
        )}
      />,
    );

    expect(text).toContain('✓');
    expect(text).toContain('테스트 사용자 · 테스트 팀');
    expect(text).toContain('확인 중');
  });

  it('세 가지를 마치면 [감지 시작]과 안내 두 줄(자동 시작, macOS 알림 허용)을 보인다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot(READY)} />);

    expect(text).toContain('감지 시작');
    expect(text).toContain('로그인할 때 Stardraft가 자동으로 켜집니다. 설정의 일반에서 끌 수 있습니다.');
    expect(text).toContain('곧 macOS가 알림 허용을 묻습니다.');
  });

  it('Windows는 숨김 영역 안내를 보이고, 알림 안내는 숫자로 확인하는 법만 적는다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot(READY, { platform: 'win32' })} />);

    expect(text).toContain('Stardraft 아이콘은 작업 표시줄 오른쪽 ^ 안에 있습니다.');
    expect(text).toContain('작업 표시줄 아이콘이 채워지면 검토할 초안이 있습니다.');
    expect(text).not.toContain('macOS');
  });

  it('감지 시작이 실패하면 이유를 보인다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot({ ...READY, start: { status: 'failed', reason: 'network' } })} />);

    expect(text).toContain('Flow에 연결할 수 없습니다.');
  });
});

describe('작은 창: 감지를 시작한 뒤', () => {
  it('묶음이 없으면 빈 화면과 [최근 멘션으로 시험] 자리를 보이고, 필수 세 줄은 보이지 않는다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot({ ...READY, detectionStarted: true })} />);

    expect(text).toContain('아직 멘션이 없습니다.');
    expect(text).toContain('최근 멘션으로 시험');
    expect(text).not.toContain('Flow 개인 API 키');
    expect(text).not.toContain('감지 시작');
  });

  it('Windows는 감지를 시작한 직후의 빈 화면에도 숨김 영역 안내를 보인다', () => {
    const text = textOf(<PopoverContent snapshot={snapshot({ ...READY, detectionStarted: true }, { platform: 'win32' })} />);

    expect(text).toContain('Stardraft 아이콘은 작업 표시줄 오른쪽 ^ 안에 있습니다.');
  });
});

describe('설정 창 첫 설정 띠', () => {
  it('"필수 설정 n/3"과 남은 항목, 지금 칸이 아닌 다음 항목 버튼을 보인다', () => {
    const text = textOf(
      <SetupBand
        snapshot={snapshot({ ...FIRST_RUN, requirements: { 'flow-key': 'done', agent: 'needed', 'work-folders': 'needed' } })}
        section="agent"
        onSelectSection={() => {}}
      />,
    );

    expect(text).toContain('필수 설정 1/3');
    expect(text).toContain('남은 항목: 에이전트, 작업 폴더');
    expect(text).toContain('작업 폴더 설정');
  });

  it('세 가지를 마치면 [감지 시작]과 안내 두 줄을 보인다', () => {
    const text = textOf(<SetupBand snapshot={snapshot(READY)} section="general" onSelectSection={() => {}} />);

    expect(text).toContain('필수 설정을 마쳤습니다.');
    expect(text).toContain('감지 시작');
    expect(text).toContain('로그인할 때 Stardraft가 자동으로 켜집니다.');
  });

  it('감지를 시작한 뒤에는 나오지 않는다', () => {
    expect(
      renderToStaticMarkup(<SetupBand snapshot={snapshot({ ...READY, detectionStarted: true })} section="general" onSelectSection={() => {}} />),
    ).toBe('');
  });
});
