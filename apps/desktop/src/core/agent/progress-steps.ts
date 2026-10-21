/**
 * 진행 단계 문구. 생성 중 화면에 마지막 한 줄로 보이고, 실패하면 "마지막 단계"로 남는다.
 * 검토자만 보는 정보라 파일 이름과 검색어를 그대로 쓴다. 실행기마다 도구 이벤트를 이 문구로 바꾼다.
 */

/** 초안 실행 직전에 Flow에서 맥락을 새로 조회하는 단계. */
export const FETCHING_CONTEXT_STEP = 'Flow에서 맥락 가져오는 중';

/** 선택 실행을 시작했을 때의 단계. 도구를 부르기 전까지 보이고, 고른 뒤 초안 실행으로 넘어가면 "초안 쓰는 중"으로 바뀐다. */
export const CHOOSING_REPO_STEP = '저장소 고르는 중';

/** 초안 실행을 시작했을 때의 단계. 도구를 부르기 전까지 보인다. */
export const WRITING_DRAFT_STEP = '초안 쓰는 중';

/** 파일을 읽을 때의 단계. 경로는 파일 이름만 쓴다. */
export function readingFileStep(filePath: string): string {
  return `파일 읽는 중: ${fileNameOf(filePath)}`;
}

/** 파일 내용이나 파일 이름을 찾을 때의 단계. 여러 줄짜리 검색어는 한 줄로 줄인다. */
export function searchingStep(query: string): string {
  return `검색 중: ${query.replace(/\s+/g, ' ').trim()}`;
}

/** 폴더의 파일 목록을 볼 때의 단계. Codex가 `ls`나 `rg --files`로 저장소를 둘러볼 때다. */
export const LISTING_FILES_STEP = '파일 목록 보는 중';

/** 읽기·검색·목록이 아닌 명령을 실행할 때의 단계. 너무 긴 명령은 앞부분만 쓴다. */
export function runningCommandStep(command: string): string {
  /** 한 줄로 줄인 명령. */
  const line = command.replace(/\s+/g, ' ').trim();
  return `명령 실행 중: ${line.length > COMMAND_STEP_MAX_LENGTH ? `${line.slice(0, COMMAND_STEP_MAX_LENGTH)}…` : line}`;
}

/** 명령 실행 단계에 쓰는 명령의 최대 길이. */
const COMMAND_STEP_MAX_LENGTH = 80;

/** 경로의 마지막 조각. macOS와 Windows 구분자를 모두 받는다. */
function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
}
