import type {
  BundleGroup,
  BundleSnapshot,
  BundleStatusSnapshot,
  DraftFailureReasonSnapshot,
  EvidenceSnapshot,
  FailureSnapshot,
  GenerationSnapshot,
  MentionPlaceSnapshot,
  RepoCheckSnapshot,
  RunLineSnapshot,
} from '../../shared/ipc';
import { AGENT_NAMES } from './AgentSection';

/** 상태 태그의 이름과 색. 준비됨은 파랑, 생성 중은 회색, 실패는 빨강, 확인이 필요한 상태는 노랑, 처리됨은 옅은 회색이다. */
export const BUNDLE_STATUS_TAGS: Record<BundleStatusSnapshot, { label: string; className: string }> = {
  generating: { label: '생성 중', className: 'generating' },
  ready: { label: '준비됨', className: 'ready' },
  'repo-check-needed': { label: '저장소 확인 필요', className: 'warn' },
  failed: { label: '실패', className: 'failed' },
  ignored: { label: '무시함', className: 'done' },
  'already-answered': { label: '이미 답함', className: 'done' },
};

/** 펼친 창의 목록 묶음 이름. */
export const BUNDLE_GROUP_LABELS: Record<BundleGroup, string> = {
  'awaiting-review': '검토 대기',
  generating: '생성 중',
  failed: '실패',
  processed: '처리됨',
};

/** 멘션 묶음 자리의 이름. 본문 묶음과 댓글 스레드 묶음이다. */
export const BUNDLE_PLACE_LABELS: Record<BundleSnapshot['place'], string> = {
  post: '본문',
  thread: '댓글',
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

/** 게시물 제목. 모르면 "제목 없는 게시물"이다. */
export function postTitleOf(bundle: BundleSnapshot): string {
  return bundle.postTitle || '제목 없는 게시물';
}

/** 게시물을 가리키는 한 줄. "Flow 프로젝트 › 게시물 제목"이고, 프로젝트를 모르면 제목만이다. */
export function postLine(bundle: BundleSnapshot): string {
  return bundle.projectTitle ? `${bundle.projectTitle} › ${postTitleOf(bundle)}` : postTitleOf(bundle);
}

/** 무시 토스트 문구. */
export function ignoredText(bundle: BundleSnapshot): string {
  return `무시했습니다: ${senderLine(bundle.senderNames)}님 멘션`;
}

/**
 * 실패 사유마다 실패 화면에 보일 오류 문장. 개발자가 아닌 사람도 읽을 수 있게 쓴다.
 * 일시적 실패(구조 실패, 과부하, 네트워크 오류)는 자동으로 한 번 더 실행한 뒤에야 실패가 되므로 두 번 시도했다고 함께 적는다.
 * 화면은 `failureText`로 읽는다.
 */
const FAILURE_REASON_TEXT: Record<DraftFailureReasonSnapshot, string> = {
  cancelled: '취소함: 초안 만들기를 취소했습니다.',
  'timed-out': '에이전트가 10분 안에 끝내지 못해 멈췄습니다.',
  'invalid-output': '에이전트가 정해진 형식으로 답하지 않았습니다. 두 번 시도했습니다.',
  'empty-draft': '빈 초안: 에이전트가 초안 문장을 하나도 쓰지 않았습니다.',
  'secret-evidence': '비밀 파일을 근거로 듦: 에이전트가 비밀 파일을 근거로 들어 결과를 버렸습니다.',
  'flow-unavailable': 'Flow에서 멘션 내용을 가져오지 못했습니다.',
  'source-gone': 'Flow에서 원문을 찾을 수 없습니다. 지워졌거나 볼 권한이 없습니다.',
  'app-error': '앱 안에서 오류가 나서 초안을 만들지 못했습니다.',
  'cli-missing': '에이전트 CLI를 실행하지 못했습니다.',
  'cli-error': '에이전트 CLI가 오류로 끝났습니다.',
  'not-logged-in': '에이전트에 로그인되어 있지 않습니다.',
  overloaded: '모델이 바빠서 답하지 못했습니다. 두 번 시도했습니다.',
  network: '모델 서버에 연결하지 못했습니다. 두 번 시도했습니다.',
  'max-turns': '에이전트가 정해진 단계 수 안에 끝내지 못했습니다.',
  'agent-error': '에이전트가 오류로 끝났습니다.',
};

/** 선택 실행이 제한 시간(5분) 안에 끝나지 않아 실패한 묶음의 오류 문장. 초안 실행의 시간 초과(10분)와 구분한다. */
const SELECTION_TIMED_OUT_TEXT = '에이전트가 5분 안에 저장소를 고르지 못해 멈췄습니다.';

/** 실패 화면에 보일 오류 문장. 사유마다 정해 두고, 선택 실행의 시간 초과만 선택 실행의 제한 시간으로 적는다. */
export function failureText(failure: FailureSnapshot): string {
  if (failure.reason === 'timed-out' && failure.runKind === 'selection') return SELECTION_TIMED_OUT_TEXT;
  return FAILURE_REASON_TEXT[failure.reason];
}

/** 저장소 확인 필요의 사유마다 저장소 영역 첫 줄에 보일 문장. */
export const REPO_CHECK_TEXT: Record<RepoCheckSnapshot['kind'], string> = {
  'missing-folders': '연결된 저장소 폴더를 찾을 수 없음',
  'no-candidates': '작업 폴더에서 저장소를 찾지 못함',
  unsure: '에이전트가 저장소를 확신하지 못함',
  unrelated: '에이전트가 코드와 무관한 멘션으로 판정함',
};

/** 선택 실행이 적은 이유. 에이전트가 비워 두었으면 "이유 없음"이다. */
export function reasonText(reason: string): string {
  return reason === '' ? '이유 없음' : reason;
}

/** 걸린 시간을 보인다. 1분이 넘으면 "2분 14초", 넘지 않으면 "45초"다. */
export function formatDuration(durationMs: number): string {
  /** 반올림한 초. */
  const totalSeconds = Math.round(durationMs / 1000);
  /** 분과 남은 초. */
  const [minutes, seconds] = [Math.floor(totalSeconds / 60), totalSeconds % 60];
  if (minutes === 0) return `${seconds}초`;
  return seconds === 0 ? `${minutes}분` : `${minutes}분 ${seconds}초`;
}

/** 상세 머리의 실행 줄. "Claude Code · 2분 14초 · 맥락 일부 생략"이다. */
export function runLineText(run: RunLineSnapshot): string {
  return [AGENT_NAMES[run.agent], formatDuration(run.durationMs), ...(run.contextOmitted ? ['맥락 일부 생략'] : [])].join(' · ');
}

/** 근거 번호를 원문자(①②…)로 보인다. ⑳을 넘으면 괄호 숫자다. */
export function circledNumber(id: number): string {
  return id >= 1 && id <= 20 ? String.fromCharCode(0x2460 + id - 1) : `(${id})`;
}

/** 근거의 위치. "저장소 이름 · 파일 이름 · 88번째 줄"이고, 여러 줄이면 "10–14번째 줄"이다. */
export function evidenceLocation({ repositoryName, path, startLine, endLine }: EvidenceSnapshot): string {
  /** 경로의 마지막 조각(파일 이름). */
  const fileName = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  /** 줄 범위. */
  const lines = startLine === endLine ? `${startLine}번째 줄` : `${startLine}–${endLine}번째 줄`;
  return `${repositoryName} · ${fileName} · ${lines}`;
}

/** 생성 중 묶음의 진행 한 줄. 실행 중이면 마지막 진행 단계, 기다리면 차례를 기다린다는 말이다. */
export function generationStepText(generation: GenerationSnapshot): string {
  return generation.status === 'running' ? generation.step : '차례를 기다리는 중';
}
