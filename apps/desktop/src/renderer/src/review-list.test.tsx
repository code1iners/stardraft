import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ListKindGroup, ListRetentionNote, ListRow, StateTag } from './ReviewList';

/** 마크업에서 태그를 지운 글자. */
function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('목록 컴포넌트', () => {
  it('종류 묶음 머리는 종류 이름과 개수이고, 줄은 종류에 상관없이 제목·시각·요약·태그를 같은 자리에 둔다', () => {
    /** 진단처럼 초안이 아닌 종류도 같은 컴포넌트로 그린 마크업. */
    const markup = renderToStaticMarkup(
      <ListKindGroup title="진단" count={1}>
        <ListRow selected title="결제 오류" time="오전 9:50" summary="프로젝트 · 자리" tags={<StateTag label="준비됨" tone="ready" />} onSelect={() => {}} />
      </ListKindGroup>,
    );

    expect(textOf(markup)).toBe('진단 1 결제 오류 오전 9:50 프로젝트 · 자리 준비됨');
    expect(markup).toContain('aria-current="true"');
  });

  it('고르지 않은 줄에는 현재 표시가 없다', () => {
    expect(renderToStaticMarkup(<ListRow selected={false} title="a" time="b" summary="c" tags={null} onSelect={() => {}} />)).not.toContain('aria-current');
  });

  it('상태 태그는 색 이름을 클래스로 달고, 색이 없으면 테두리 태그다', () => {
    expect(renderToStaticMarkup(<StateTag label="재현 성공" tone="success" />)).toBe('<span class="tag success">재현 성공</span>');
    expect(renderToStaticMarkup(<StateTag label="재현 안 함" tone="outline" />)).toBe('<span class="tag outline">재현 안 함</span>');
    expect(renderToStaticMarkup(<StateTag label="태그" />)).toBe('<span class="tag">태그</span>');
  });

  it('보관 안내는 한 줄이다', () => {
    expect(textOf(renderToStaticMarkup(<ListRetentionNote />))).toBe('끝낸 항목은 7일이 지나면 목록에서 사라집니다.');
  });
});
