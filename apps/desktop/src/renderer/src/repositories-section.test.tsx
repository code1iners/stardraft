import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RepoMappingsSnapshot } from '../../shared/ipc';
import { RepositoriesSection } from './RepositoriesSection';

/** 화면을 그린 HTML에서 태그를 지운 글자. */
function textOf(repoMappings: RepoMappingsSnapshot): string {
  return renderToStaticMarkup(<RepositoriesSection repoMappings={repoMappings} />).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
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
