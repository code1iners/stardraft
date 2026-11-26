import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SentryCandidatesSnapshot, SentryProjectSnapshot } from '../../shared/ipc';
import { SentryProjectModal } from './SentryProjectModal';
import { folderName, projectFilterSummary, projectStatus } from './sentry-project-text';

/** 등록할 수 있는 프로젝트 목록. `웹`은 `production`이 있고 `배치`는 없다. */
const LOADED: SentryCandidatesSnapshot = {
  status: 'loaded',
  incomplete: false,
  projects: [
    { projectId: '11', organizationName: '조직 A', projectName: '웹', environments: ['development', 'production'] },
    { projectId: '12', organizationName: '조직 A', projectName: '배치', environments: ['staging'] },
  ],
};

/** 등록한 프로젝트. */
const REGISTERED: SentryProjectSnapshot = {
  projectId: '11',
  organizationName: '조직 A',
  projectName: '웹',
  environment: 'production',
  levels: ['fatal', 'error'],
  repo: { path: '/fake/work/web-app', status: 'found' },
  access: 'ok',
};

/** 모달을 그린 마크업. */
function markup(props: Partial<Parameters<typeof SentryProjectModal>[0]> = {}): string {
  return renderToStaticMarkup(<SentryProjectModal editing={null} registeredIds={new Set()} candidates={LOADED} onClose={() => {}} {...props} />);
}

/** 마크업에서 태그를 지운 글자. */
function textOf(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

describe('Sentry 프로젝트 추가 모달', () => {
  it('화면 가운데 모달에 조직의 프로젝트를 고르는 상자와 환경·레벨·저장소가 있고, 등록 해제는 없다', () => {
    const html = markup();

    expect(html).toContain('modal-backdrop');
    expect(textOf(html)).toContain('진단할 프로젝트 추가');
    expect(textOf(html)).toContain('조직 A / 웹');
    expect(textOf(html)).toContain('조직 A / 배치');
    expect(textOf(html)).toContain('저장소 · 선택');
    expect(textOf(html)).toContain('지정 안 함');
    expect(textOf(html)).not.toContain('등록 해제');
  });

  it('레벨 기본값은 error와 fatal이고 나머지는 꺼져 있다', () => {
    const html = markup();

    expect(html).toMatch(/<input type="checkbox" checked=""\/>fatal/);
    expect(html).toMatch(/<input type="checkbox" checked=""\/>error/);
    expect(html).toMatch(/<input type="checkbox"\/>warning/);
    expect(html).toMatch(/<input type="checkbox"\/>debug/);
  });

  it('이미 등록한 프로젝트는 고르는 목록에서 뺀다', () => {
    const text = textOf(markup({ registeredIds: new Set(['11']) }));

    expect(text).not.toContain('조직 A / 웹');
    expect(text).toContain('조직 A / 배치');
  });

  it('프로젝트를 고르기 전에는 [등록]을 누를 수 없다', () => {
    expect(markup()).toMatch(/<button[^>]*disabled[^>]*>등록</);
  });

  it('프로젝트 목록을 받는 동안과 받지 못했을 때를 알린다', () => {
    expect(textOf(markup({ candidates: { status: 'loading' } }))).toContain('프로젝트를 불러오는 중…');
    /** 받지 못한 상태의 글자. */
    const failed = textOf(markup({ candidates: { status: 'failed', reason: 'network' } }));
    expect(failed).toContain('연결할 수 없어 프로젝트 목록을 불러오지 못했습니다.');
    expect(failed).toContain('다시 불러오기');
  });

  it('토큰 확인 필요로 목록을 못 받으면 다시 불러오기 대신 토큰을 먼저 확인하라고 알린다', () => {
    const text = textOf(markup({ candidates: { status: 'failed', reason: 'no-token' } }));

    expect(text).toContain('토큰을 다시 확인해야');
    expect(text).not.toContain('다시 불러오기');
  });
});

describe('Sentry 프로젝트 편집 모달', () => {
  it('프로젝트는 고치지 못하고, 지금 필터와 저장소가 채워져 있으며, [등록 해제]가 있다', () => {
    const html = markup({ editing: REGISTERED, registeredIds: new Set(['11']) });
    const text = textOf(html);

    expect(text).toContain('진단할 프로젝트 편집');
    expect(text).toContain('조직 A / 웹');
    expect(html).not.toContain('aria-label="프로젝트"');
    expect(text).toContain('/fake/work/web-app');
    expect(text).toContain('등록 해제');
    expect(text).toContain('저장');
    expect(html).toMatch(/<option value="production" selected=""/);
  });

  it('받아 둔 목록에 없는 환경으로 필터가 걸려 있어도 그 환경이 선택지에 남는다', () => {
    const html = markup({ editing: { ...REGISTERED, environment: 'qa' }, candidates: { status: 'idle' } });

    expect(html).toMatch(/<option value="qa" selected=""/);
  });
});

describe('Sentry 프로젝트 문구', () => {
  it('저장소 이름은 경로의 마지막 폴더이고 Windows 경로도 읽는다', () => {
    expect(folderName('/fake/work/web-app')).toBe('web-app');
    expect(folderName('C:\\fake\\work\\web-app\\')).toBe('web-app');
  });

  it('줄의 상태는 토큰 문제가 먼저, 접근 불가가 그다음, 매핑 없음이 그다음이다', () => {
    expect(projectStatus(REGISTERED, true)).toBe('token-problem');
    expect(projectStatus({ ...REGISTERED, access: 'inaccessible' }, false)).toBe('inaccessible');
    expect(projectStatus({ ...REGISTERED, repo: null }, false)).toBe('unmapped');
    expect(projectStatus(REGISTERED, false)).toBe('watching');
  });

  it('모든 환경이면 "모든 환경"으로 적는다', () => {
    expect(projectFilterSummary({ ...REGISTERED, environment: null, repo: null })).toBe('모든 환경 · fatal, error · 저장소 없음');
  });
});
