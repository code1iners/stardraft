import { describe, expect, it } from 'vitest';
import { siteSectionUrl } from './download-site';

describe('다운로드 사이트 섹션 주소', () => {
  it('[사이트에서 받기]는 다운로드 사이트의 업데이트 섹션을 연다', () => {
    expect(siteSectionUrl('update')).toBe('https://stardraft.squadify.app/#update');
  });
});
