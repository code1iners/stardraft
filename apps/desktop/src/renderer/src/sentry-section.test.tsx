import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, type SentryConnectionSnapshot, type SentryProjectsSnapshot } from '../../shared/ipc';
import { SentrySection } from './SentrySection';

/** 토큰이 없는 상태. */
const NO_TOKEN: SentryConnectionSnapshot = { connected: false, organizations: [], tokenCheck: { status: 'idle' }, tokenProblem: null };
/** 조직 둘이 보이는 연결된 상태. */
const CONNECTED: SentryConnectionSnapshot = {
  connected: true,
  organizations: [{ name: '조직 A' }, { name: '조직 B' }],
  tokenCheck: { status: 'idle' },
  tokenProblem: null,
};

/** 등록한 프로젝트가 없는 상태. */
const NO_PROJECTS: SentryProjectsSnapshot = { projects: [], candidates: { status: 'idle' } };

/** 그린 HTML. */
function htmlOf(
  sentry: SentryConnectionSnapshot,
  platform: 'darwin' | 'win32' | 'other' = 'darwin',
  projects: SentryProjectsSnapshot = NO_PROJECTS,
): string {
  return renderToStaticMarkup(<SentrySection sentry={sentry} projects={projects} platform={platform} />);
}

/** 그린 HTML에서 태그를 지운 글자. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('설정 칸 순서', () => {
  it('Flow 계정 · Sentry · 에이전트 · 저장소 · 초안 · 일반 순서다', () => {
    expect(SETTINGS_SECTIONS).toEqual(['flow-account', 'sentry', 'agent', 'repositories', 'drafts', 'general']);
  });
});

describe('설정 "Sentry" 칸', () => {
  it('토큰이 없으면 토큰 입력만 보이고 토큰 카드는 없다', () => {
    const html = htmlOf(NO_TOKEN);

    expect(html).toContain('type="password"');
    expect(textOf(html)).toContain('org:read');
    expect(textOf(html)).toContain('event:read');
    expect(textOf(html)).not.toContain('연결됨');
    expect(html).not.toContain('연결 끊기');
  });

  it('토큰이 있으면 조직 수와 이름, 권한, "연결됨"을 가진 토큰 카드를 보이고 입력 칸은 숨긴다', () => {
    const html = htmlOf(CONNECTED);
    const text = textOf(html);

    expect(text).toContain('조직 2개 · 조직 A, 조직 B');
    expect(text).toContain('권한: org:read 확인됨');
    expect(text).toContain('✓ 연결됨');
    expect(text).toContain('토큰 바꾸기');
    expect(text).toContain('연결 끊기');
    expect(html).not.toContain('type="password"');
  });

  it('토큰 값은 화면 어디에도 넘어오지 않는다: 스냅숏에는 조직 이름만 있다', () => {
    expect(Object.keys(CONNECTED.organizations[0]!)).toEqual(['name']);
  });

  it.each([
    ['rejected', 'Sentry가 토큰을 거부했습니다.'],
    ['scope-missing', '토큰에 필요한 권한(scope)이 없습니다.'],
    ['unreadable', '저장된 토큰을 읽을 수 없습니다. 키체인 접근을 거부했거나'],
  ] as const)('토큰 문제(%s)는 "토큰 확인 필요"와 이유를 구분해 보이고 "연결됨"은 보이지 않는다', (reason, message) => {
    const text = textOf(htmlOf({ ...CONNECTED, tokenProblem: reason }));

    expect(text).toContain('토큰 확인 필요');
    expect(text).toContain(message);
    expect(text).toContain('토큰 다시 입력');
    expect(text).not.toContain('org:read 확인됨');
    expect(text).not.toContain('✓ 연결됨');
  });

  it('토큰을 확인하는 동안 [확인 중…]으로 입력을 막는다', () => {
    const html = htmlOf({ ...NO_TOKEN, tokenCheck: { status: 'checking' } });

    expect(html).toContain('확인 중…');
    expect(html).toMatch(/<input[^>]*disabled/);
  });
});

/** 등록한 프로젝트 둘. 하나는 저장소가 있고 하나는 없다. */
const PROJECTS: SentryProjectsSnapshot = {
  candidates: { status: 'idle' },
  projects: [
    {
      projectId: '11',
      organizationName: '조직 A',
      projectName: '웹',
      environment: 'production',
      levels: ['fatal', 'error'],
      repo: { path: '/fake/work/web-app', status: 'found' },
      access: 'ok',
      waitingCount: 0,
    },
    { projectId: '12', organizationName: '조직 A', projectName: '배치', environment: null, levels: ['error'], repo: null, access: 'unchecked', waitingCount: 2 },
  ],
};

describe('설정 "Sentry" 칸의 진단할 프로젝트', () => {
  it('등록한 프로젝트가 없으면 안내와 [프로젝트 추가…]만 보인다', () => {
    const text = textOf(htmlOf(CONNECTED));

    expect(text).toContain('진단할 프로젝트');
    expect(text).toContain('등록한 프로젝트가 없습니다');
    expect(text).toContain('프로젝트 추가…');
    expect(text).not.toContain('편집');
  });

  it('줄마다 `조직 / 프로젝트`, `환경 · 레벨 · 저장소 이름`, 상태, [편집]이 보인다', () => {
    const text = textOf(htmlOf(CONNECTED, 'darwin', PROJECTS));

    expect(text).toContain('조직 A / 웹 production · fatal, error · web-app 감지 중 편집');
    expect(text).toContain('조직 A / 배치 모든 환경 · error · 저장소 없음 저장소 매핑 없음 · 2건 대기 편집');
  });

  it('프로젝트 하나가 접근 불가이면 그 줄만 "접근 불가"이고 다른 줄은 그대로다', () => {
    const [first, second] = PROJECTS.projects;
    const text = textOf(htmlOf(CONNECTED, 'darwin', { ...PROJECTS, projects: [{ ...first!, access: 'inaccessible' }, second!] }));

    expect(text).toContain('조직 A / 웹 production · fatal, error · web-app 접근 불가');
    expect(text).toContain('저장소 매핑 없음');
    expect(text.match(/접근 불가/g)).toHaveLength(1);
  });

  it('토큰 확인이 필요하면 모든 줄이 "토큰 확인 필요"로 멈추고 [프로젝트 추가…]가 막힌다', () => {
    const html = htmlOf({ ...CONNECTED, tokenProblem: 'rejected' }, 'darwin', PROJECTS);

    expect(html).toMatch(/<button[^>]*disabled[^>]*>프로젝트 추가…/);
    expect(textOf(html).match(/토큰 확인 필요/g)?.length).toBeGreaterThanOrEqual(3);
    expect(textOf(html)).not.toContain('감지 중');
  });

  it('토큰이 정상이면 [프로젝트 추가…]를 누를 수 있다', () => {
    expect(htmlOf(CONNECTED, 'darwin', PROJECTS)).not.toMatch(/<button[^>]*disabled[^>]*>프로젝트 추가…/);
  });

  it('토큰이 없으면 프로젝트 목록은 보이지 않는다', () => {
    expect(textOf(htmlOf(NO_TOKEN, 'darwin', PROJECTS))).not.toContain('진단할 프로젝트');
  });
});
