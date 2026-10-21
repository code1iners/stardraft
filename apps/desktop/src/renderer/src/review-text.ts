import type { BundleGroup, BundleStatusSnapshot, MentionPlaceSnapshot } from '../../shared/ipc';

/** 상태 태그의 이름과 색. */
export const BUNDLE_STATUS_TAGS: Record<BundleStatusSnapshot, { label: string; className: string }> = {
  'repo-check-needed': { label: '저장소 확인 필요', className: 'warn' },
  ignored: { label: '무시함', className: 'done' },
  'already-answered': { label: '이미 답함', className: 'done' },
};

/** 펼친 창 목록의 묶음 이름. */
export const BUNDLE_GROUP_LABELS: Record<BundleGroup, string> = {
  'awaiting-review': '검토 대기',
  generating: '생성 중',
  failed: '실패',
  processed: '처리됨',
};

/** 멘션이 일어난 글의 이름. */
export const MENTION_PLACE_LABELS: Record<MentionPlaceSnapshot, string> = {
  post: '본문',
  comment: '댓글',
  reply: '대댓글',
};

/** 처리됨 묶음의 바닥 줄 안내. */
export const PROCESSED_NOTES: Partial<Record<BundleStatusSnapshot, string>> = {
  ignored: '무시한 묶음입니다.',
  'already-answered': 'Flow에 이미 내 답이 있어 처리했습니다.',
};

/** 처리됨 목록 아래의 보관 안내. */
export const RETENTION_NOTE = '처리한 지 7일이 지나면 목록에서 사라지고 되돌릴 수 없습니다.';

/** 오늘 시각 표기. 예: 오전 9:50 */
const TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
/** 다른 날 시각 표기. 예: 10월 19일 오후 3:12 */
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** 멘션 시각을 이 PC의 시간대로 보인다. 오늘이면 시각만, 아니면 날짜와 시각이다. */
export function formatMentionTime(at: number, now = Date.now()): string {
  /** 멘션 시각과 지금. */
  const [when, today] = [new Date(at), new Date(now)];
  /** 같은 날인지 여부. */
  const sameDay =
    when.getFullYear() === today.getFullYear() && when.getMonth() === today.getMonth() && when.getDate() === today.getDate();
  return (sameDay ? TIME_FORMAT : DATE_TIME_FORMAT).format(when);
}

/** 송신자 이름들을 한 줄로 보인다. 이름을 모르면 "이름 없음"이다. */
export function senderLine(senderNames: readonly string[]): string {
  return senderNames.length > 0 ? senderNames.join(', ') : '이름 없음';
}
