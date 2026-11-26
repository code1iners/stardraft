import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SETTINGS_SECTIONS, type SentryConnectionSnapshot } from '../../shared/ipc';
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

/** 그린 HTML. */
function htmlOf(sentry: SentryConnectionSnapshot, platform: 'darwin' | 'win32' | 'other' = 'darwin'): string {
  return renderToStaticMarkup(<SentrySection sentry={sentry} platform={platform} />);
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
    expect(text).not.toContain('✓ 연결됨');
  });

  it('토큰을 확인하는 동안 [확인 중…]으로 입력을 막는다', () => {
    const html = htmlOf({ ...NO_TOKEN, tokenCheck: { status: 'checking' } });

    expect(html).toContain('확인 중…');
    expect(html).toMatch(/<input[^>]*disabled/);
  });
});
