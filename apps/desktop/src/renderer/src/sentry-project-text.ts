import type { SentryProjectSaveResult, SentryProjectSnapshot, SentryCandidatesFailure } from '../../shared/ipc';

/** 등록·편집이 실패했을 때 모달에 보일 문구. 성공(`registered`, `updated`)은 모달을 닫으므로 문구가 없다. */
export const SAVE_FAILURE_TEXT: Record<Exclude<SentryProjectSaveResult, 'registered' | 'updated'>, string> = {
  'no-token': '토큰이 연결되어 있지 않습니다. 토큰을 먼저 연결해 주세요.',
  'token-problem': '토큰을 다시 확인해야 해서 등록할 수 없습니다. 토큰을 다시 입력해 주세요.',
  'unknown-project': '목록에서 이 프로젝트를 찾을 수 없습니다. 목록을 다시 불러와 주세요.',
  'already-registered': '이미 등록한 프로젝트입니다.',
  'not-registered': '등록이 풀린 프로젝트입니다.',
  'invalid-filter': '환경이나 레벨 선택이 맞지 않습니다. 레벨은 하나 이상 골라 주세요.',
  unauthorized: '토큰이 거부되었습니다. 토큰을 다시 입력해 주세요.',
  'scope-missing': '토큰에 event:read 권한이 없습니다. org:read와 event:read 권한을 고른 새 토큰으로 바꿔 주세요.',
  'project-unavailable': '이 프로젝트를 찾을 수 없거나 이 토큰으로 볼 수 없습니다.',
  network: '연결할 수 없어 등록하지 못했습니다. 인터넷 연결을 확인해 주세요.',
  'rate-limited': '요청이 많아 등록하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  unexpected: '요청을 처리하지 못해 등록하지 못했습니다. 잠시 뒤 다시 시도해 주세요.',
  'save-failed': '설정을 저장하지 못했습니다. 다시 시도해 주세요.',
};

/** 등록할 프로젝트 목록을 받지 못했을 때 모달에 보일 문구. */
export const CANDIDATES_FAILURE_TEXT: Record<SentryCandidatesFailure, string> = {
  'no-token': '토큰을 다시 확인해야 프로젝트 목록을 불러올 수 있습니다.',
  unauthorized: '토큰이 거부되어 프로젝트 목록을 불러오지 못했습니다.',
  'scope-missing': '토큰에 org:read 권한이 없어 프로젝트 목록을 불러오지 못했습니다.',
  network: '연결할 수 없어 프로젝트 목록을 불러오지 못했습니다.',
  'rate-limited': '요청이 많아 프로젝트 목록을 불러오지 못했습니다. 잠시 뒤 다시 불러와 주세요.',
  unexpected: '프로젝트 목록을 불러오지 못했습니다.',
};

/** 경로의 마지막 폴더 이름. Windows 경로(`\`)도 읽는다. */
export function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** 환경 필터 문구. `null`은 모든 환경이다. */
export function environmentLabel(environment: string | null): string {
  return environment ?? '모든 환경';
}

/** 프로젝트 줄 둘째 줄: `환경 · 레벨 · 저장소 이름`. 저장소가 없으면 "저장소 없음"이다. */
export function projectFilterSummary(project: SentryProjectSnapshot): string {
  return [environmentLabel(project.environment), project.levels.join(', '), project.repo ? folderName(project.repo.path) : '저장소 없음'].join(' · ');
}

/** 프로젝트 줄에 보일 상태. 앞선 것이 뒤의 것을 가린다. */
export type SentryProjectStatus = 'token-problem' | 'inaccessible' | 'unmapped' | 'watching';

/** 프로젝트 줄의 상태를 고른다. 토큰 문제는 모든 줄을 멈추고, 접근 불가는 그 줄만 멈춘다. */
export function projectStatus(project: SentryProjectSnapshot, tokenProblem: boolean): SentryProjectStatus {
  if (tokenProblem) return 'token-problem';
  if (project.access === 'inaccessible') return 'inaccessible';
  return project.repo === null ? 'unmapped' : 'watching';
}

/** 프로젝트 줄 상태 문구. 저장소 매핑이 없으면 기다리는 진단 수를 붙인다. */
export function projectStatusText(project: SentryProjectSnapshot, status: SentryProjectStatus): string {
  switch (status) {
    case 'token-problem':
      return '토큰 확인 필요';
    case 'inaccessible':
      return '접근 불가';
    case 'unmapped':
      return `저장소 매핑 없음 · ${project.waitingCount}건 대기`;
    case 'watching':
      return '감지 중';
  }
}
