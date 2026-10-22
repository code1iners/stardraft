import type { BlockedLocationReasonSnapshot, UpdateSnapshot } from '../../shared/ipc';
import { formatTime } from './review-text';

/**
 * 받은 파일의 서명 검증에 실패했을 때의 문구. 사이트에서 받아 설치하라고 권하지 않는다.
 * 서명 실패는 Release가 조작됐을 수 있다는 뜻이고, 그러면 같은 Release에서 나온 사이트의 설치 파일도 조작됐을 수 있다.
 */
const SIGNATURE_FAILED_TEXT = '업데이트 파일의 서명이 맞지 않아 설치하지 않았습니다. 지금 버전을 계속 씁니다.';

/** 앱이 스스로 바꿀 수 없는 위치의 까닭별 문구. */
const BLOCKED_LOCATION_TEXT: Record<BlockedLocationReasonSnapshot, string> = {
  'read-only': '응용 프로그램 폴더로 옮긴 뒤 다시 여세요',
  'no-permission': '이 계정은 Stardraft를 바꿀 권한이 없습니다',
};

/** 설정 "일반"의 업데이트 칸에 보일 상태 문구. `now`(Unix epoch 밀리초)는 "3시간 전"처럼 지난 시간을 셀 지금 시각이다. */
export function updateStatusText(update: UpdateSnapshot, now: number): string {
  switch (update.kind) {
    case 'idle':
      return '아직 확인하지 않았습니다';
    case 'checking':
      return '확인 중…';
    case 'up-to-date':
      return `최신 버전입니다 · 마지막 확인 ${formatTime(update.checkedAt, now)}`;
    case 'check-failed':
      return `마지막 확인 실패 · ${elapsedText(update.failedAt, now)}`;
    case 'downloading':
      return `${update.version} 받는 중… ${update.percent}%`;
    case 'ready':
      return `새 버전 ${update.version}${subjectParticle(update.version)} 준비됐습니다`;
    case 'signature-failed':
      return SIGNATURE_FAILED_TEXT;
    case 'location-blocked':
      return `새 버전 ${update.version} · ${BLOCKED_LOCATION_TEXT[update.reason]}`;
  }
}

/** `at`부터 `now`까지 지난 시간을 "방금", "n분 전", "n시간 전", "n일 전"으로 보인다. */
function elapsedText(at: number, now: number): string {
  /** 지난 분. */
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;
  /** 지난 시간. */
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
}

/** 버전 뒤에 붙일 주격 조사. 끝자리 숫자를 읽은 소리(이·사·오·구)에 받침이 없으면 "가", 있으면 "이"다. */
function subjectParticle(version: string): '이' | '가' {
  return /[2459]$/.test(version) ? '가' : '이';
}
