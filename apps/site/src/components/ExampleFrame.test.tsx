import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { pressExample, startExample, type ExampleSceneId, type ExampleState } from '../lib/example-scenes';
import { ExampleFrame } from './ExampleFrame';

/** 가짜 스크린숏. */
const SHOT = {
  image: { src: '/_astro/mac-blocked.png', width: 1200, height: 800 },
  alt: '가짜 스크린숏',
  caption: '완료를 누릅니다.',
};

/** 태그를 지운 글. 글 사이의 굵게는 띄우지 않고 지운다. */
function textOf(html: string): string {
  return html
    .replace(/<\/?b>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 누를 곳(강조 테두리를 두르고 커서가 가리키는 버튼)의 글. */
function targetsOf(html: string): string[] {
  return [...html.matchAll(/<button[^>]*class="[^"]*ex-target[^"]*"[^>]*data-target=""[^>]*>([\s\S]*?)<\/button>/g)].map(([, inner]) => textOf(inner!));
}

/** 예시 화면을 상태와 동작 줄이기 설정으로 그린다. */
function render(scene: ExampleSceneId, options: { state?: ExampleState; reduced?: boolean } = {}) {
  return renderToStaticMarkup(
    <ExampleFrame scene={scene} initialState={options.state ?? startExample()} initialReduced={options.reduced ?? false} />,
  );
}

describe('예시 화면 틀', () => {
  it('노란 띠, 빗금 칸 속 장면과 커서, 안내 문구와 처음부터를 둔다', () => {
    const html = render('mac-blocked');

    expect(html).toContain('<figcaption class="example-band">예시 화면 · 눌러 볼 수 있지만 실제 창이 아닙니다</figcaption>');
    expect(html).toMatch(/class="example-stage"[\s\S]*class="scene mac enter"[\s\S]*class="ex-cursor"/);
    expect(textOf(html)).toContain('처음 열면 이 창이 뜹니다. 완료를 누르세요.');
    expect(textOf(html)).toContain('처음부터');
  });

  it('지금 누를 곳에만 강조 테두리와 커서 표지를 단다', () => {
    expect(targetsOf(render('mac-blocked'))).toEqual(['완료']);
    expect(targetsOf(render('win-smartscreen'))).toEqual(['추가 정보']);
    expect(targetsOf(render('win-smartscreen', { state: pressExample('win-smartscreen', startExample(), 'more') }))).toEqual(['실행']);
  });

  it('누를 곳을 누른 다음 모습을 그린다', () => {
    const html = render('win-sac', { state: { phase: 'status', warning: null } });

    expect(textOf(html)).toContain('앱 & 브라우저 컨트롤 › 스마트 앱 컨트롤');
    expect(textOf(html)).toContain('지금 상태를 보세요. 이 그림은 평가입니다.');
    expect(targetsOf(html)).toEqual([]);
  });

  it('잘못된 버튼을 누른 뒤에는 안내 대신 경고를 보인다', () => {
    const html = render('mac-blocked', { state: pressExample('mac-blocked', startExample(), 'trash') });

    expect(html).toContain('<p class="example-cap warn" role="status">실제 창에서는 누르지 마세요. 앱이 휴지통으로 갑니다.</p>');
    expect(textOf(html)).toContain('처음부터');
  });

  it('누를 곳이 없는 장면(설치 진행)에는 처음부터가 없다', () => {
    expect(textOf(render('win-install'))).not.toContain('처음부터');
  });

  it('막히는 곳에 실제 스크린숏이 있으면 그것이 기본이고 예시로 바꿀 수 있다', () => {
    const html = renderToStaticMarkup(<ExampleFrame scene="mac-blocked" shot={SHOT} />);

    expect(html).toContain('<figcaption class="example-band real">실제 화면</figcaption>');
    expect(html).toContain('src="/_astro/mac-blocked.png"');
    expect(html).toContain('alt="가짜 스크린숏"');
    expect(html).not.toContain('예시 화면 · 눌러 볼 수 있지만');
    expect(html).toContain('<button type="button" aria-pressed="true">실제 화면</button>');
    expect(html).toContain('<button type="button" aria-pressed="false">예시</button>');
  });

  it('막히는 곳이라도 스크린숏을 아직 넣지 않았으면 예시 화면만 보이고 바꾸는 버튼이 없다', () => {
    const html = renderToStaticMarkup(<ExampleFrame scene="mac-blocked" shot={{ ...SHOT, image: null }} />);

    expect(html).toContain('예시 화면 · 눌러 볼 수 있지만 실제 창이 아닙니다');
    expect(html).not.toContain('aria-pressed');
  });
});

describe('예시 화면과 동작 줄이기', () => {
  it('동작 줄이기가 꺼져 있으면 장면 전환과 옮겨 가는 아이콘을 보인다', () => {
    const html = render('mac-dmg', { state: { phase: 'moved', warning: null } });

    expect(html).toContain('class="scene mac enter"');
    expect(html).toContain('class="dmg-item leaving"');
  });

  it('동작 줄이기가 켜져 있으면 장면 전환 없이 마지막 모습만 그린다', () => {
    const moved = render('mac-dmg', { state: { phase: 'moved', warning: null }, reduced: true });
    const installing = render('win-install', { reduced: true });

    expect(moved).toContain('class="scene mac"');
    expect(moved).not.toContain('leaving');
    expect(moved).toContain('class="dmg-item left"');
    expect(installing).toContain('<i class="full"></i>');
  });

  it('누를 곳 강조는 동작 줄이기와 상관없이 서 있다', () => {
    expect(targetsOf(render('mac-blocked', { reduced: true }))).toEqual(['완료']);
  });
});
