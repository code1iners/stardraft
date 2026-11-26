import { AGENT_INFO } from '../../shared/agent-info';
import type { DiagnosisFailureSnapshot, DiagnosisProgressSnapshot, DiagnosisReportSnapshot, DiagnosisRepoWaitSnapshot, DiagnosisSnapshot } from '../../shared/ipc';
import { failureText, formatDuration, formatTime, type RepoWaitText } from './review-text';

/** 펼친 창 목록에서 Sentry 진단을 묶는 종류 이름. 초안 묶음보다 위에 온다. */
export const DIAGNOSIS_KIND_LABEL = '진단';

/** 진단 상태 태그의 색. */
type DiagnosisTagTone = 'generating' | 'ready' | 'failed' | 'warn' | 'done';

/**
 * 진단 상태 태그의 이름과 색. `대기`·`진단 중`은 회색, `준비됨`은 파랑, `진단 실패`는 빨강, `완료함`은 옅은 회색,
 * 저장소 대기는 노랑이다.
 */
export function diagnosisStatusTag(diagnosis: Pick<DiagnosisSnapshot, 'status' | 'repoWait'>): { label: string; tone: DiagnosisTagTone } {
  switch (diagnosis.status) {
    case 'queued':
      return { label: '대기', tone: 'generating' };
    case 'running':
      return { label: '진단 중', tone: 'generating' };
    case 'ready':
      return { label: '준비됨', tone: 'ready' };
    case 'failed':
      return { label: '진단 실패', tone: 'failed' };
    case 'completed':
      return { label: '완료함', tone: 'done' };
    case 'repo-check-needed':
      return { label: diagnosis.repoWait?.kind === 'missing-folder' ? '저장소 확인 필요' : '저장소 매핑 필요', tone: 'warn' };
  }
}

/** 대기·진행 중 진단의 `진행` 한 줄. 대기면 앞에 있는 수, 진행 중이면 마지막 진행 단계다. */
export function diagnosisProgressText(progress: DiagnosisProgressSnapshot): string {
  if (progress.status === 'running') return progress.step;
  if (progress.ahead === null || progress.ahead === 0) return '곧 진단을 시작합니다.';
  return `앞에 ${progress.ahead}개가 있습니다.`;
}

/** 진행 중 진단의 바닥 줄 글. "진단하는 중입니다 · n분 지남"이고 1분이 안 되면 "1분 안"이다. */
export function diagnosisRunningText(startedAt: number, now = Date.now()): string {
  /** 지난 분. */
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000);
  return `진단하는 중입니다 · ${minutes === 0 ? '1분 안' : `${minutes}분 지남`}`;
}

/** 진단 실패의 오류 문장. Flow 초안의 실패 사유 문장을 그대로 쓴다. */
export function diagnosisFailureText(failure: DiagnosisFailureSnapshot): string {
  return failureText({ ...failure, runKind: 'diagnosis' });
}

/** 재현 결과의 이름. 불가면 까닭을 괄호로 붙인다. */
export function reproductionText(reproduction: DiagnosisReportSnapshot['reproduction']): string {
  if (reproduction.result === 'success') return '성공';
  if (reproduction.result === 'failure') return '실패';
  return reproduction.impossibleReason ? `불가(${IMPOSSIBLE_REASON_TEXT[reproduction.impossibleReason]})` : '불가';
}

/** 재현 불가의 까닭 이름. */
const IMPOSSIBLE_REASON_TEXT: Record<NonNullable<DiagnosisReportSnapshot['reproduction']['impossibleReason']>, string> = {
  'no-tool': '도구 없음',
  'insufficient-data': '데이터 부족',
  'env-failed': '환경 실패',
  'not-allowed': '허용 안 됨',
  'timed-out': '시간 초과',
};

/** 재현을 허용하지 않아 읽기 전용으로 진단한 보고서의 재현 칸 안내. */
export const REPRODUCTION_NOT_ALLOWED_NOTE = '이 저장소는 재현을 허용하지 않아 코드만 읽고 진단했습니다';

/** 확신도의 이름. */
export const CONFIDENCE_TEXT: Record<DiagnosisReportSnapshot['cause']['confidence'], string> = {
  high: '확신도 높음',
  medium: '확신도 중간',
  low: '확신도 낮음',
};

/** 소스맵 적용 여부의 이름. */
const SOURCE_MAP_TEXT: Record<DiagnosisReportSnapshot['event']['sourceMaps'], string> = {
  applied: '적용됨',
  failed: '적용 안 됨',
  unknown: '모름',
};

/** 보고서의 오류 이슈 정보 가운데 앱이 진단을 시작할 때 Sentry에서 받은 줄. 감지할 때 받은 `오류 정보` 표 뒤에 붙는다. */
export function reportEventFacts(report: DiagnosisReportSnapshot): IssueFact[] {
  /** release 세 가지. */
  const releases = [report.event.release, report.event.firstRelease, report.event.lastRelease];
  return [
    { label: 'release(이벤트 · 최초 · 최근)', value: releases.map((value) => value ?? '없음').join(' · ') },
    { label: '소스맵', value: SOURCE_MAP_TEXT[report.event.sourceMaps] },
    { label: '없는 데이터', value: report.event.missingData.length === 0 ? '없음' : report.event.missingData.join(', ') },
  ];
}

/** 보고서의 실행 정보 표. 저장소 경로, HEAD 해시, 커밋하지 않은 변경 유무, 에이전트와 버전, 재현 허용 여부, 걸린 시간, 생성 시각이다. */
export function reportRunFacts(report: DiagnosisReportSnapshot, now = Date.now()): IssueFact[] {
  /** 실행 정보. */
  const { run } = report;
  return [
    { label: '저장소', value: run.repository },
    { label: 'HEAD', value: run.headCommit ?? '모름' },
    { label: '커밋하지 않은 변경', value: run.uncommittedChanges === null ? '모름' : run.uncommittedChanges ? '있음' : '없음' },
    { label: '에이전트', value: [AGENT_INFO[run.agent].name, run.cliVersion].filter((part) => part !== null).join(' ') },
    { label: '재현 허용', value: run.reproductionAllowed ? '허용' : '허용 안 함' },
    { label: '걸린 시간', value: formatDuration(run.durationMs) },
    { label: '생성 시각', value: formatTime(run.createdAt, now) },
  ];
}

/** 근거의 위치. "저장소 이름 · 파일 이름 · 88번째 줄"이고 여러 줄이면 "10–14번째 줄"이다. */
export function diagnosisEvidenceLocation({ repository, path, startLine, endLine }: DiagnosisReportSnapshot['evidence'][number]): string {
  /** 저장소 폴더 이름. */
  const repositoryName = repository.split(/[\\/]/).filter(Boolean).at(-1) ?? repository;
  /** 파일 이름. */
  const fileName = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
  return `${repositoryName} · ${fileName} · ${startLine === endLine ? `${startLine}번째 줄` : `${startLine}–${endLine}번째 줄`}`;
}

/** 상세 머리의 둘째 줄: `프로젝트 · 신규/재발 · 감지 시각`. */
export function diagnosisMetaLine(diagnosis: Pick<DiagnosisSnapshot, 'issue' | 'origin' | 'detectedAt'>, now = Date.now()): string {
  return [diagnosis.issue.projectName, diagnosis.origin === 'new' ? '신규' : '재발', formatTime(diagnosis.detectedAt, now)].join(' · ');
}

/** 목록 줄의 둘째 줄. 보고서가 있으면 요약이고, 없는 동안은 `프로젝트 · 자리`이며 자리를 모르면 프로젝트만이다. */
export function diagnosisPlaceLine(diagnosis: Pick<DiagnosisSnapshot, 'issue'> & Partial<Pick<DiagnosisSnapshot, 'report'>>): string {
  if (diagnosis.report) return diagnosis.report.summary;
  return [diagnosis.issue.projectName, diagnosis.issue.culprit].filter((part) => part !== '').join(' · ');
}

/**
 * 저장소 대기 진단의 노란 바닥 줄 글. 초안과 첫 문장은 같고, 저장소 매핑 필요의 둘째 문장은 "기다리는 오류 n건을 진단합니다"다.
 */
export function diagnosisRepoWaitText(repoWait: DiagnosisRepoWaitSnapshot): RepoWaitText {
  if (repoWait.kind === 'unmapped') {
    return { lead: '이 프로젝트에 연결한 저장소가 없습니다.', before: `매핑하면 기다리는 오류 ${repoWait.waitingCount}건을 진단합니다.`, path: null, after: '' };
  }
  return { lead: '연결한 저장소 폴더를 찾을 수 없습니다.', before: '', path: repoWait.path, after: '폴더가 돌아오거나 매핑을 고치면 이어 갑니다.' };
}

/** `오류 정보`의 한 줄. */
export interface IssueFact {
  /** 항목 이름. */
  label: string;
  /** 값. */
  value: string;
}

/** `오류 정보` 표. 감지할 때 받은 값만 보이고, 모르는 값은 줄째 뺀다. 스택 앞부분은 이벤트를 받는 진단 시작 때 생긴다. */
export function issueFacts({ issue }: Pick<DiagnosisSnapshot, 'issue'>, now = Date.now()): IssueFact[] {
  /** 발생 수와 사용자 수. */
  const counts = [issue.count === null ? null : `${issue.count}회`, issue.userCount === null ? null : `사용자 ${issue.userCount}명`].filter(
    (part): part is string => part !== null,
  );
  /** 항목들. 값이 없는 항목은 `null`. */
  const facts: [string, string | null][] = [
    ['난 자리', issue.culprit || null],
    ['발생 수', counts.length > 0 ? counts.join(' · ') : null],
    ['짧은 ID', issue.shortId || null],
    ['조직 / 프로젝트', `${issue.organizationName} / ${issue.projectName}`],
    ['환경', issue.environment ?? '모든 환경'],
    ['레벨', issue.level || null],
    ['첫 발생', formatTime(issue.firstSeen, now)],
    ['최근 발생', issue.lastSeen === null ? null : formatTime(issue.lastSeen, now)],
    ['플랫폼', issue.platform],
  ];
  return facts.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));
}
