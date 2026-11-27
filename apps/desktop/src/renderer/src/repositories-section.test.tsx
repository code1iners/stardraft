import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RepoMappingsSnapshot, SentryProjectsSnapshot } from '../../shared/ipc';
import { RepositoriesSection, SentryRepoMappingsField } from './RepositoriesSection';
import { UNSUPPORTED_REPRODUCTION } from './reproduction-fixtures';

/** 등록한 Sentry 프로젝트가 없는 상태. */
const NO_SENTRY_PROJECTS: SentryProjectsSnapshot = { projects: [], candidates: { status: 'idle' } };

/** 화면을 그린 HTML에서 태그를 지운 글자. */
function textOf(repoMappings: RepoMappingsSnapshot): string {
  return renderToStaticMarkup(<RepositoriesSection repoMappings={repoMappings} sentryProjects={NO_SENTRY_PROJECTS} reproduction={UNSUPPORTED_REPRODUCTION} />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('설정 "저장소" 칸', () => {
  it('작업 폴더와 "이 PC에서 찾은 폴더" 항목이 없고 저장소 매핑 항목만 있다', () => {
    const text = textOf({ mappings: [], waiting: [], projects: { status: 'idle' } });

    expect(text).toContain('저장소 매핑');
    expect(text).not.toContain('작업 폴더');
    expect(text).not.toContain('이 PC에서 찾은 폴더');
    expect(text).not.toContain('폴더 추가…');
  });

  it('매핑이 없어 기다리는 Flow 프로젝트가 매핑된 프로젝트보다 맨 위에 "저장소 매핑 없음 · n건 대기"와 [폴더 고르기…]로 보인다', () => {
    /** 마크업. */
    const markup = renderToStaticMarkup(
      <RepositoriesSection
        sentryProjects={NO_SENTRY_PROJECTS}
        reproduction={UNSUPPORTED_REPRODUCTION}
        repoMappings={{
          mappings: [{ projectId: '101', title: '매핑된 프로젝트', repos: [{ path: '/fake/work/api', status: 'found' }], missing: false }],
          waiting: [{ projectId: '900002', title: '기다리는 프로젝트', waitingCount: 3 }],
          projects: { status: 'idle' },
        }}
      />,
    );
    /** 글자. */
    const text = markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    expect(text).toContain('기다리는 프로젝트 저장소 매핑 없음 · 3건 대기 폴더 고르기…');
    expect(text.indexOf('기다리는 프로젝트')).toBeLessThan(text.indexOf('매핑된 프로젝트'));
  });

  it('기다리는 프로젝트는 새 매핑을 고르는 선택 상자에서 뺀다', () => {
    /** 마크업. */
    const markup = renderToStaticMarkup(
      <RepositoriesSection
        sentryProjects={NO_SENTRY_PROJECTS}
        reproduction={UNSUPPORTED_REPRODUCTION}
        repoMappings={{
          mappings: [],
          waiting: [{ projectId: '900002', title: '기다리는 프로젝트', waitingCount: 1 }],
          projects: { status: 'loaded', projects: [{ projectId: '900002', title: '기다리는 프로젝트' }, { projectId: '900003', title: '다른 프로젝트' }] },
        }}
      />,
    );

    expect(markup.match(/<option[^>]*value="900002"/g)).toBeNull();
    expect(markup).toContain('value="900003"');
  });

  it('검토 화면에서 짚은 프로젝트의 줄에만 표시를 단다. 기다리는 줄도 매핑된 줄도 같다', () => {
    /** 마크업. */
    const markup = (focusProjectId: string | null) =>
      renderToStaticMarkup(
        <RepositoriesSection
          sentryProjects={NO_SENTRY_PROJECTS}
          reproduction={UNSUPPORTED_REPRODUCTION}
          repoMappings={{
            mappings: [{ projectId: '101', title: '매핑된 프로젝트', repos: [{ path: '/fake/work/api', status: 'missing' }], missing: true }],
            waiting: [{ projectId: '900002', title: '기다리는 프로젝트', waitingCount: 3 }],
            projects: { status: 'idle' },
          }}
          focusProjectId={focusProjectId}
        />,
      );

    expect(markup(null)).not.toContain('aria-current');
    expect(markup('900002').match(/aria-current="true"/g)).toHaveLength(1);
    expect(markup('900002')).toMatch(/aria-current="true"[^>]*>.{0,200}기다리는 프로젝트/s);
    expect(markup('101')).toMatch(/aria-current="true"[^>]*>.{0,200}매핑된 프로젝트/s);
    expect(markup('999')).not.toContain('aria-current');
  });
});

/** 등록한 Sentry 프로젝트 둘. 하나는 저장소가 있고 하나는 없다. */
const SENTRY_PROJECTS: SentryProjectsSnapshot = {
  candidates: { status: 'idle' },
  projects: [
    {
      projectId: '11',
      organizationName: '조직 A',
      projectName: '웹',
      environment: 'production',
      levels: ['error'],
      repo: { path: '/fake/work/web-app', status: 'found' },
      access: 'ok',
      waitingCount: 0,
    },
    { projectId: '12', organizationName: '조직 A', projectName: '배치', environment: null, levels: ['error'], repo: null, access: 'ok', waitingCount: 2 },
  ],
};

describe('설정 "저장소" 칸의 Flow | Sentry 탭', () => {
  /** 첫 화면(Flow 탭) 마크업. */
  const flowMarkup = (sentryProjects: SentryProjectsSnapshot) =>
    renderToStaticMarkup(<RepositoriesSection repoMappings={{ mappings: [], waiting: [], projects: { status: 'idle' } }} sentryProjects={sentryProjects} reproduction={UNSUPPORTED_REPRODUCTION} />);

  it('"저장소 매핑" 아래에 Flow와 Sentry 탭이 있고 Flow 탭이 먼저 보인다', () => {
    const markup = flowMarkup(NO_SENTRY_PROJECTS);

    expect(markup).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Flow/);
    expect(markup).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>Sentry/);
  });

  it('Sentry 프로젝트에 매핑이 없으면 Sentry 탭에 점이 찍히고, 모두 매핑됐거나 등록이 없으면 찍히지 않는다', () => {
    expect(flowMarkup(SENTRY_PROJECTS)).toMatch(/>Sentry<span[^>]*class="underline-tab-dot"/);
    expect(flowMarkup(NO_SENTRY_PROJECTS)).not.toContain('underline-tab-dot');
    expect(flowMarkup({ ...SENTRY_PROJECTS, projects: [SENTRY_PROJECTS.projects[0]!] })).not.toContain('underline-tab-dot');
  });

  it('Flow 프로젝트가 매핑을 기다리면 Flow 탭에 점이 찍힌다', () => {
    const markup = renderToStaticMarkup(
      <RepositoriesSection
        repoMappings={{ mappings: [], waiting: [{ projectId: '9', title: '기다림', waitingCount: 1 }], projects: { status: 'idle' } }}
        sentryProjects={NO_SENTRY_PROJECTS}
        reproduction={UNSUPPORTED_REPRODUCTION}
      />,
    );

    expect(markup).toMatch(/>Flow<span[^>]*class="underline-tab-dot"/);
  });
});

describe('설정 "저장소" 칸 Sentry 탭', () => {
  /** 탭 내용을 그린 글자. */
  const textOfSentry = (sentryProjects: SentryProjectsSnapshot) =>
    renderToStaticMarkup(<SentryRepoMappingsField sentryProjects={sentryProjects} />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  it('등록한 프로젝트가 모두 오르고, 저장소가 하나뿐이라 [폴더 추가…] 대신 [바꾸기…]가 있다', () => {
    const text = textOfSentry(SENTRY_PROJECTS);

    expect(text).toContain('조직 A / 웹 바꾸기…');
    expect(text).toContain('/fake/work/web-app');
    expect(text).toContain('조직 A / 배치');
    expect(text).not.toContain('폴더 추가…');
  });

  it('매핑이 없는 프로젝트가 매핑된 프로젝트보다 맨 위에 "저장소 매핑 없음 · n건 대기"와 [폴더 고르기…]로 보인다', () => {
    const text = textOfSentry(SENTRY_PROJECTS);

    expect(text).toContain('조직 A / 배치 저장소 매핑 없음 · 2건 대기 폴더 고르기…');
    expect(text.indexOf('조직 A / 배치')).toBeLessThan(text.indexOf('조직 A / 웹'));
  });

  it('매핑된 폴더가 없으면 저장소 줄에 "폴더를 찾을 수 없음"이 보인다', () => {
    const [first, second] = SENTRY_PROJECTS.projects;
    const text = textOfSentry({ ...SENTRY_PROJECTS, projects: [{ ...first!, repo: { path: '/fake/gone', status: 'missing' } }, second!] });

    expect(text).toContain('/fake/gone 폴더를 찾을 수 없음');
  });

  it('등록한 프로젝트가 없으면 Sentry 칸에서 추가하라고 안내한다', () => {
    expect(textOfSentry(NO_SENTRY_PROJECTS)).toContain('Sentry 칸에서 프로젝트를 추가해 주세요');
  });
});

describe('설정 "저장소" 칸: 진단에서 짚은 Sentry 프로젝트', () => {
  it('진단의 [저장소 매핑하기]로 Sentry 프로젝트를 짚어 열면 Sentry 탭이 보이고 그 프로젝트의 줄이 짚인다', () => {
    const markup = renderToStaticMarkup(
      <RepositoriesSection repoMappings={{ mappings: [], waiting: [], projects: { status: 'idle' } }} sentryProjects={SENTRY_PROJECTS} reproduction={UNSUPPORTED_REPRODUCTION} focusSentryProjectId="12" />,
    );

    expect(markup).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Sentry/);
    expect(markup).toMatch(/<li class="folder-item" aria-current="true"><div class="folder-row"><span class="mapping-title">조직 A \/ 배치/);
  });
});
