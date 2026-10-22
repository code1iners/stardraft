import type { UpdateSnapshot, UpdateStateSnapshot } from '../../shared/ipc';
import {
  installFailedText,
  locationBlockedText,
  readyText,
  restartPendingText,
  SIGNATURE_FAILED_TEXT,
  updatedText,
} from '../../shared/update-text';
import { formatTime } from './review-text';

/**
 * 설정 "일반"의 업데이트 칸에 둘 수 있는 버튼. [지금 확인], 서명 검증 실패의 [다시 시도], [사이트에서 받기], [다시 시작], [변경 내역],
 * 설치 실패의 [다시 시도]다.
 */
export type UpdateFieldButton = 'check-now' | 'retry' | 'open-site' | 'restart' | 'changelog' | 'retry-install';

/** 설정 "일반"의 업데이트 칸에 보일 모습. */
export interface UpdateFieldView {
  /** 상태 문구. */
  text: string;
  /** 문구를 위험 색으로 보일지 여부. 서명 검증 실패와 설치 실패만 그렇다. */
  danger: boolean;
  /** 받는 중이면 받은 비율(0~100)이고 진행 막대로 보인다. 받는 중이 아니면 `null`. */
  progress: number | null;
  /** 상태마다 둘 버튼. 보일 순서다. */
  buttons: UpdateFieldButton[];
  /** 문구가 "3시간 전"처럼 지난 시간을 보여 지금 시각이 흐르면 새로 그려야 하는지 여부. */
  showsElapsed: boolean;
}

/**
 * 설정 "일반"의 업데이트 칸에 보일 문구와 버튼. `now`(Unix epoch 밀리초)는 "3시간 전"처럼 지난 시간을 셀 지금 시각이다.
 * 업데이트를 끄는 설정은 없다.
 */
export function updateFieldView(update: UpdateSnapshot, now: number): UpdateFieldView {
  switch (update.kind) {
    case 'idle':
      return plain('아직 확인하지 않았습니다', ['check-now']);
    case 'checking':
      return plain('확인 중…', []);
    case 'up-to-date':
      return plain(`최신 버전입니다 · 마지막 확인 ${formatTime(update.checkedAt, now)}`, ['check-now']);
    case 'check-failed':
      return { ...plain(`마지막 확인 실패 · ${elapsedText(update.failedAt, now)}`, ['check-now']), showsElapsed: true };
    case 'downloading':
      return { ...plain(`${update.version} 받는 중… ${update.percent}%`, []), progress: update.percent };
    case 'ready':
      return plain(readyText(update.version), ['restart', 'changelog']);
    case 'restart-pending':
      return plain(restartPendingText(update.waitingFor), []);
    case 'signature-failed':
      return { ...plain(SIGNATURE_FAILED_TEXT, ['retry']), danger: true };
    case 'location-blocked':
      return plain(locationBlockedText(update.version, update.reason), ['open-site']);
    case 'install-failed':
      return { ...plain(installFailedText(update.version, update.reason), installFailedButtons(update.reason)), danger: true };
  }
}

/** 작은 창의 업데이트 띠에 둘 수 있는 버튼. [다시 시작], [변경 내역], [지금 다시 시작], [취소], [사이트에서 받기], [닫기], 설치 실패의 [다시 시도]다. */
export type UpdateBannerButton = 'restart' | 'changelog' | 'restart-now' | 'cancel-restart' | 'open-site' | 'dismiss' | 'retry-install';

/** 작은 창의 업데이트 띠. */
export interface UpdateBannerView {
  /** 띠 이름. 상태와 버전이고, [닫기]로 닫으면 같은 이름의 띠는 다시 보이지 않는다. */
  id: string;
  /** 띠 문구. */
  text: string;
  /** 위험 색으로 보일지 여부. */
  danger: boolean;
  /** 띠의 버튼. 보일 순서다. */
  buttons: UpdateBannerButton[];
}

/**
 * 작은 창 맨 위 띠 자리에 둘 업데이트 띠. 띠 자리는 하나이고 전역 문제 띠가 앞서므로, 전역 문제가 없을 때만 그린다.
 * 상태의 띠가 먼저이고, 없거나 닫았으면 업데이트 직후 첫 실행의 띠다. 둘 띠가 없으면 `null`.
 */
export function updateBannerView(update: UpdateStateSnapshot): UpdateBannerView | null {
  /** 닫지 않은 띠만 남긴다. */
  const open = (banner: UpdateBannerView | null) => (banner && !update.dismissedBanners.includes(banner.id) ? banner : null);
  return open(statusBanner(update.status)) ?? open(update.justUpdated === null ? null : justUpdatedBanner(update.justUpdated));
}

/** 상태의 띠. 메뉴나 설정에만 보이는 상태(최신, 확인 중, 받는 중, 확인 실패)는 `null`. */
function statusBanner(status: UpdateSnapshot): UpdateBannerView | null {
  switch (status.kind) {
    case 'idle':
    case 'checking':
    case 'up-to-date':
    case 'check-failed':
    case 'downloading':
      return null;
    case 'ready':
      return banner(status, readyText(status.version), false, ['restart', 'changelog']);
    case 'restart-pending':
      return banner(status, restartPendingText(status.waitingFor), false, ['restart-now', 'cancel-restart']);
    case 'location-blocked':
      return banner(status, locationBlockedText(status.version, status.reason), false, ['open-site']);
    case 'signature-failed':
      return banner(status, SIGNATURE_FAILED_TEXT, true, ['dismiss']);
    case 'install-failed':
      return banner(status, installFailedText(status.version, status.reason), true, installFailedButtons(status.reason));
  }
}

/** 업데이트 직후 첫 실행의 띠. 한 번만 보이도록 다음 실행에서는 생기지 않고, [닫기]로 이번 실행에서도 닫는다. */
function justUpdatedBanner(version: string): UpdateBannerView {
  return { id: `updated:${version}`, text: updatedText(version), danger: false, buttons: ['changelog', 'dismiss'] };
}

/** 상태의 종류와 버전을 이름으로 한 띠. */
function banner(status: { kind: string; version: string }, text: string, danger: boolean, buttons: UpdateBannerButton[]): UpdateBannerView {
  return { id: `${status.kind}:${status.version}`, text, danger, buttons };
}

/** 설치 실패의 버튼. 앱 안에서 거부됐으면 다시 시도해도 소용이 없어 [사이트에서 받기]만 둔다. */
function installFailedButtons(reason: 'not-applied' | 'rejected'): ('retry-install' | 'open-site')[] {
  return reason === 'rejected' ? ['open-site'] : ['retry-install', 'open-site'];
}

/** 위험 색도 진행 막대도 없고 지난 시간도 보이지 않는 모습. */
function plain(text: string, buttons: UpdateFieldButton[]): UpdateFieldView {
  return { text, danger: false, progress: null, buttons, showsElapsed: false };
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
