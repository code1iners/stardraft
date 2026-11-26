import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** 렌더러 스타일 원문. 렌더러 테스트는 Node 모듈을 못 써서 CSS는 여기서 읽는다. */
const styles = readFileSync(new URL('../renderer/src/styles.css', import.meta.url), 'utf8');

/** 선택자 하나의 CSS 규칙 본문. 없으면 빈 문자열이다. */
function rule(selector: string): string {
  const escaped = selector.replace(/\./g, '\\.');
  return new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`).exec(styles)?.[1] ?? '';
}

describe('확인 모달 스타일', () => {
  it('배경이 화면을 어둡게 덮고 모달을 가운데에 둔다', () => {
    const backdrop = rule('.modal-backdrop');
    expect(backdrop).toMatch(/position:\s*fixed/);
    expect(backdrop).toMatch(/inset:\s*0/);
    expect(backdrop).toMatch(/align-items:\s*center/);
    expect(backdrop).toMatch(/justify-content:\s*center/);
    expect(backdrop).toMatch(/background:\s*rgba\(0,\s*0,\s*0,\s*0\.[3-9]/);
  });

  it('모달은 네 모서리가 모두 10px로 둥글다', () => {
    const modal = rule('.modal');
    expect(modal).toMatch(/border-radius:\s*10px;/);
    expect(modal).not.toMatch(/border-top:\s*0/);
  });

  it('시트 전용 스타일 이름이 남아 있지 않다', () => {
    expect(styles).not.toMatch(/\.sheet/);
  });
});
