import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DraftSettingsSnapshot } from '../../shared/ipc';
import { ExtraInstructionsField, SecretPatternsField, secretPatternProblem } from './DraftsSection';

/** 가짜 설정 "초안" 칸 상태. 기본 패턴은 앱 목록의 앞부분만 둔다. */
const SETTINGS: DraftSettingsSnapshot = {
  extraInstructions: '맺음말로 "확인 부탁드립니다"를 붙입니다.\n호칭은 님으로 씁니다.',
  defaultSecretPatterns: ['.env', '.env.*', '*.pem'],
  extraSecretPatterns: ['*.vault.yml'],
};

describe('설정 "초안"의 추가 지침', () => {
  it('저장된 추가 지침을 여러 줄 입력 칸에 보이고, 칸을 벗어나면 저장해 다음 실행부터 쓴다고 안내한다', () => {
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<ExtraInstructionsField draftSettings={SETTINGS} />);

    expect(html).toMatch(/<textarea id="extra-instructions"[^>]*>맺음말로 &quot;확인 부탁드립니다&quot;를 붙입니다.\n호칭은 님으로 씁니다.<\/textarea>/);
    expect(html).toContain('칸을 벗어나면 저장하고 다음 실행부터 씁니다. 이미 만든 초안은 다시 만들지 않습니다.');
    // 아직 고치지 않았으므로 "저장됨"은 보이지 않는다.
    expect(html).not.toContain('저장됨');
  });
});

describe('설정 "초안"의 비밀 파일 패턴', () => {
  it('기본 패턴은 지우기 없이 읽기 전용으로, 추가한 패턴은 그 아래에 보이고 패턴 추가 칸을 둔다', () => {
    /** 그린 HTML. */
    const html = renderToStaticMarkup(<SecretPatternsField draftSettings={SETTINGS} />);

    expect(html).toContain('<ul class="pattern-list" aria-label="기본 패턴"><li>.env</li><li>.env.*</li><li>*.pem</li></ul>');
    expect(html).toContain('<ul class="pattern-list" aria-label="추가한 패턴"><li>*.vault.yml</li></ul>');
    expect(html).not.toContain('지우기');
    expect(html).toContain('aria-label="추가할 패턴"');
    // 빈 칸이면 [추가]를 누를 수 없다.
    expect(html).toContain('<button type="button" class="btn" disabled="">추가</button>');
    expect(html).toContain('추가한 패턴은 지울 수 없습니다.');
  });

  it('추가한 패턴이 없으면 추가한 패턴 목록을 보이지 않는다', () => {
    expect(renderToStaticMarkup(<SecretPatternsField draftSettings={{ ...SETTINGS, extraSecretPatterns: [] }} />)).not.toContain('추가한 패턴</p>');
  });

  it('이미 있는 패턴(대소문자 무시)과 실행기 규칙을 깨는 패턴은 누르기 전에 알린다', () => {
    expect(secretPatternProblem('  ', SETTINGS)).toBeNull();
    expect(secretPatternProblem(' credentials/** ', SETTINGS)).toBeNull();
    expect(secretPatternProblem('.ENV', SETTINGS)).toBe('이미 있는 패턴입니다.');
    expect(secretPatternProblem('*.Vault.yml', SETTINGS)).toBe('이미 있는 패턴입니다.');
    expect(secretPatternProblem('Read(x)', SETTINGS)).toBe('따옴표, 괄호, 역슬래시는 쓸 수 없고 !로 시작할 수 없습니다.');
    expect(secretPatternProblem('!keep.env', SETTINGS)).toBe('따옴표, 괄호, 역슬래시는 쓸 수 없고 !로 시작할 수 없습니다.');
  });
});
