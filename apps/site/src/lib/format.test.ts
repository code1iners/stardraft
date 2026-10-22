import { describe, expect, it } from 'vitest';
import { formatFileSize, formatReleaseDate } from './format';

describe('표기', () => {
  it('공개 시각은 한국 날짜로 적는다(UTC 전날 밤도 한국 날짜)', () => {
    expect(formatReleaseDate('2026-11-10T03:00:00Z')).toBe('2026년 11월 10일');
    expect(formatReleaseDate('2026-11-09T16:30:00Z')).toBe('2026년 11월 10일');
  });

  it('파일 크기는 MB 정수', () => {
    expect(formatFileSize(121_400_000)).toBe('121 MB');
    expect(formatFileSize(97_600_000)).toBe('98 MB');
    expect(formatFileSize(300)).toBe('1 MB');
  });
});
