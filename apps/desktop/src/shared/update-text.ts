import type { BlockedLocationReasonSnapshot, InstallFailureReasonSnapshot, RestartWaitSnapshot } from './ipc';

/**
 * 받은 파일의 서명 검증에 실패했을 때의 문구. 사이트에서 받아 설치하라고 권하지 않는다.
 * 서명 실패는 Release가 조작됐을 수 있다는 뜻이고, 그러면 같은 Release에서 나온 사이트의 설치 파일도 조작됐을 수 있다.
 */
export const SIGNATURE_FAILED_TEXT = '업데이트 파일의 서명이 맞지 않아 설치하지 않았습니다. 지금 버전을 계속 씁니다.';

/** Squirrel.Mac이 앱 안에서 거부해 다시 시도해도 소용이 없을 때의 문구. */
const INSTALL_REJECTED_TEXT = '이 버전은 앱 안에서 업데이트할 수 없습니다. 사이트에서 받아 설치하세요.';

/** 앱이 스스로 바꿀 수 없는 위치의 까닭별 문구. */
const BLOCKED_LOCATION_TEXT: Record<BlockedLocationReasonSnapshot, string> = {
  'read-only': '응용 프로그램 폴더로 옮긴 뒤 다시 여세요',
  'no-permission': '이 계정은 Stardraft를 바꿀 권한이 없습니다',
};

/** 설치 준비됨의 문구. */
export function readyText(version: string): string {
  return `새 버전 ${version}${subjectParticle(version)} 준비됐습니다`;
}

/** 스스로 바꿀 수 없는 위치의 문구. 새 버전과 까닭이다. */
export function locationBlockedText(version: string, reason: BlockedLocationReasonSnapshot): string {
  return `새 버전 ${version} · ${BLOCKED_LOCATION_TEXT[reason]}`;
}

/** 다시 시작 대기의 문구. 기다리는 일에 맞춘다. */
export function restartPendingText(waitingFor: RestartWaitSnapshot): string {
  if (waitingFor.drafting && waitingFor.posting) return '초안 생성과 게시가 끝나면 다시 시작합니다';
  if (waitingFor.posting) return '게시가 끝나면 다시 시작합니다';
  return '초안 생성이 끝나면 다시 시작합니다';
}

/** 설치 실패의 문구. 앱 안에서 거부됐으면 사이트에서 받으라고 한다. */
export function installFailedText(version: string, reason: InstallFailureReasonSnapshot): string {
  return reason === 'rejected' ? INSTALL_REJECTED_TEXT : `${version}${directionParticle(version)} 업데이트하지 못했습니다`;
}

/** 업데이트 직후 첫 실행의 문구. */
export function updatedText(version: string): string {
  return `${version}${directionParticle(version)} 업데이트했습니다`;
}

/** 다시 시작 확인 화면의 제목. */
export function restartConfirmTitle(version: string): string {
  return `${version}${directionParticle(version)} 다시 시작합니다`;
}

/** 버전 뒤에 붙일 주격 조사. 끝자리 숫자를 읽은 소리(이·사·오·구)에 받침이 없으면 "가", 있으면 "이"다. */
function subjectParticle(version: string): '이' | '가' {
  return /[2459]$/.test(version) ? '가' : '이';
}

/** 버전 뒤에 붙일 "(으)로". 끝자리 숫자를 읽은 소리에 받침이 없거나 ㄹ 받침(일·칠·팔)이면 "로", 그 밖의 받침(영·삼·육)이면 "으로"다. */
function directionParticle(version: string): '으로' | '로' {
  return /[036]$/.test(version) ? '으로' : '로';
}
