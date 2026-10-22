import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 사이트 전체 스타일. */
const css = readFileSync(new URL('./global.css', import.meta.url), 'utf8');

/** `@media (<조건>) { ... }` 블록의 본문. 중괄호 짝을 세어 꺼낸다. */
function mediaBlock(condition: string): string {
  const start = css.indexOf(`@media (${condition})`);
  if (start < 0) return '';
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index++) {
    if (css[index] === '{') depth++;
    if (css[index] === '}' && --depth === 0) return css.slice(open + 1, index);
  }
  return '';
}

describe('동작 줄이기', () => {
  it('첫 화면 별 아이콘은 반짝인다', () => {
    expect(css).toMatch(/\.spk\s*\{[^}]*animation:\s*twinkle/);
    expect(css).toMatch(/\.ha-star \.main\s*\{[^}]*animation:\s*starSpin/);
  });

  it('prefers-reduced-motion이 reduce이면 모든 요소의 애니메이션과 전환을 멈춘다', () => {
    const reduce = mediaBlock('prefers-reduced-motion: reduce');

    expect(reduce).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{[^}]*animation:\s*none !important;[^}]*transition:\s*none !important;/);
  });

  it('부드러운 스크롤은 동작 줄이기가 꺼졌을 때만', () => {
    expect(mediaBlock('prefers-reduced-motion: no-preference')).toContain('scroll-behavior: smooth');
    expect(css.replace(mediaBlock('prefers-reduced-motion: no-preference'), '')).not.toContain('scroll-behavior: smooth');
  });
});
