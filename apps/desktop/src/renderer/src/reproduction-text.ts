import type { ReproductionSaveResult, ReproductionServerKind } from '../../shared/ipc';

/** 재현용 환경 파일을 지정하지 않았을 때 보이는 문구. 빨간 글씨로 보인다. */
export const ENV_FILE_UNSET_TEXT = '지정 안 함 · 원본 .env 사용';

/** 재현을 켜는 확인 모달에서 허용되는 일. */
export const ALLOWED_THINGS: readonly string[] = [
  '셸 명령 사용(저장소의 사본 폴더 안에서만 파일을 바꿉니다. 원본은 그대로입니다)',
  '네트워크 사용',
  '내가 에이전트에 등록해 둔 MCP 도구 사용(브라우저, 시뮬레이터 조작 등)',
];

/** MCP 서버 연결 종류를 사용자 말로 바꾼 이름. */
export const SERVER_KIND_LABELS: Record<ReproductionServerKind, string> = {
  stdio: '내 PC에서 돌아감',
  http: '원격 주소',
  sse: '원격 주소',
  ws: '원격 주소',
  unknown: '알 수 없음',
};

/** 재현 허용을 켜지 못한 이유 문구. */
export const SAVE_FAILURE_TEXT: Record<Exclude<ReproductionSaveResult, 'saved'>, string> = {
  'invalid-env-file': '고른 환경 파일을 열 수 없습니다. 파일을 다시 골라 주세요.',
  'not-mapped': '이 저장소는 더 이상 매핑되어 있지 않습니다. 저장소 매핑을 확인해 주세요.',
  unsupported: '이 PC에서는 재현을 쓸 수 없습니다.',
};

/** 경로의 마지막 이름. 폴더나 파일 이름만 보이고 싶을 때 쓴다. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
