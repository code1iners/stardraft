// 페이지에 보이는 날짜와 크기 표기.

/** 한국 시간 기준 "2026년 11월 10일" 표기. */
const DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone: 'Asia/Seoul' });

/** Release 공개 시각(ISO 8601)을 한국 날짜로. */
export function formatReleaseDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso));
}

/** 파일 크기를 Finder·탐색기처럼 MB(10⁶바이트) 정수로. 1MB보다 작으면 1 MB로 적는다. */
export function formatFileSize(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}
