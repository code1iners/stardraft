import { AGENT_INFO } from '../../shared/agent-info';
import { mcpServerFacts } from '../../shared/mcp-servers-text';
import type { DiagnosisFailureSnapshot, DiagnosisProgressSnapshot, DiagnosisReportSnapshot, DiagnosisRepoWaitSnapshot, DiagnosisSnapshot } from '../../shared/ipc';
import { evidenceLocation, failureText, formatDuration, formatTime, type RepoWaitText } from './review-text';

/** 펼친 창 목록에서 Sentry 진단을 묶는 종류 이름. 초안 묶음보다 위에 온다. */
export const DIAGNOSIS_KIND_LABEL = '진단';

/** 진단 상태 태그의 색. */
type DiagnosisTagTone = 'generating' | 'ready' | 'failed' | 'warn' | 'done';

/**
 * 진단 상태 태그의 이름과 색. `대기`·`진단 중`·`다시 진단 중`은 회색, `준비됨`은 파랑, `진단 실패`는 빨강, `완료함`은 옅은 회색,
 * 저장소 대기는 노랑이다.
 */
export function diagnosisStatusTag(diagnosis: Pick<DiagnosisSnapshot, 'status' | 'repoWait'> & Partial<Pick<DiagnosisSnapshot, 'rediagnosing'>>): { label: string; tone: DiagnosisTagTone } {
  // 다시 진단하는 동안은 기다리든 돌든 `다시 진단 중`이다. 앞선 보고서는 보관되어 있다.
  if (diagnosis.rediagnosing && (diagnosis.status === 'queued' || diagnosis.status === 'running')) return { label: '다시 진단 중', tone: 'generating' };
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

/**
 * 연장을 묻는 동안 진단 상태 태그 앞에 붙는 노란 `확인 필요` 태그. 묻는 중이 아니면 `null`이다.
 * 마무리를 기다리는 동안과 묻지 않는 진행 중에는 붙지 않는다.
 */
export function diagnosisAttentionTag(diagnosis: Pick<DiagnosisSnapshot, 'progress'>): { label: string; tone: DiagnosisTagTone } | null {
  return diagnosis.progress?.status === 'running' && diagnosis.progress.extension?.phase === 'asking' ? { label: '확인 필요', tone: 'warn' } : null;
}

/**
 * 연장 묻기 노란 바닥 줄의 글. 굵은 첫 문장 뒤에 이어진다. 실행 중 전달이 되는 에이전트는 답이 없으면 보고서를 마무리하고,
 * 안 되는 에이전트는 멈추거나 답이 없으면 보고서 없이 끝나므로 둘째 문장이 다르다.
 */
export function diagnosisExtensionAskText(canSteer: boolean): { lead: string; body: string } {
  return {
    lead: '5분 뒤 멈춥니다. 계속할까요?',
    body: canSteer
      ? '계속하면 10분을 더 씁니다. 답이 없으면 지금까지 알아낸 것으로 보고서를 마무리합니다.'
      : '계속하면 10분을 더 씁니다. 멈추거나 답이 없으면 보고서 없이 끝납니다.',
  };
}

/** [멈추기] 뒤 보고서를 마무리하기를 기다리는 동안의 바닥 줄 글. */
export const DIAGNOSIS_WRAP_UP_TEXT = '보고서를 마무리하는 중입니다. 5분 안에 끝납니다.';

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

/**
 * 진단에서 초안과 다르게 보일 실패 문장. 사유는 Flow 초안과 같지만, 초안이나 초안의 시간 상한(10분)을 가리키는 문장은 진단에 맞게 바꾼다.
 */
const DIAGNOSIS_FAILURE_TEXT: Partial<Record<DiagnosisFailureSnapshot['reason'], string>> = {
  cancelled: '취소함: 진단을 취소했습니다.',
  // 재현하는 진단은 연장해서 20분을 넘길 수 있으므로 몇 분이라고 적지 않는다.
  'timed-out': '에이전트가 정해진 시간 안에 끝내지 못해 멈췄습니다.',
  'app-error': '앱 안에서 오류가 나서 진단하지 못했습니다.',
};

/** Sentry에서 오류 데이터를 가져오지 못한 진단 실패의 문장. 초안에는 없는 사유다. */
const SENTRY_UNAVAILABLE_TEXT = 'Sentry에서 오류 데이터를 가져오지 못했습니다. 볼 권한이 없거나 이벤트가 남아 있지 않을 수 있습니다.';

/** 다시 진단하려는데 저장소 매핑이나 폴더가 사라진 실패의 문장. */
const REPOSITORY_UNAVAILABLE_TEXT = '연결한 저장소를 찾을 수 없습니다.';

/** 진단 실패의 오류 문장. Flow 초안의 실패 사유 문장을 쓰고, 초안을 가리키는 문장만 진단에 맞게 바꾼다. */
export function diagnosisFailureText(failure: DiagnosisFailureSnapshot): string {
  if (failure.reason === 'sentry-unavailable') return SENTRY_UNAVAILABLE_TEXT;
  if (failure.reason === 'repository-unavailable') return REPOSITORY_UNAVAILABLE_TEXT;
  return DIAGNOSIS_FAILURE_TEXT[failure.reason] ?? failureText({ ...failure, reason: failure.reason, runKind: 'diagnosis' });
}

/** 목록 줄의 재현 태그 이름과 색. 보고서가 있을 때만 붙인다. 성공은 초록, 실패는 노랑, 불가는 테두리만 있는 `재현 안 함`이다. */
export function reproductionTag(reproduction: DiagnosisReportSnapshot['reproduction']): { label: string; tone: 'success' | 'warn' | 'outline' } {
  if (reproduction.result === 'success') return { label: '재현 성공', tone: 'success' };
  if (reproduction.result === 'failure') return { label: '재현 실패', tone: 'warn' };
  return { label: '재현 안 함', tone: 'outline' };
}

/** 상세 머리의 실행 줄. "Claude Code · 2분 14초"다. 보고서가 없으면 에이전트도 걸린 시간도 모르므로 `null`이다. */
export function diagnosisRunLine(report: DiagnosisReportSnapshot | null): string | null {
  return report && [AGENT_INFO[report.run.agent].name, formatDuration(report.run.durationMs)].join(' · ');
}

/** 상세의 탭. 보고서가 있는 진단에만 있다. */
export type DiagnosisTabId = 'report' | 'evidence' | 'attachments' | 'info';

/** 탭 이름. 근거와 첨부는 수를 붙인다. */
export function diagnosisTabs(report: DiagnosisReportSnapshot, attachmentCount: number): { id: DiagnosisTabId; label: string }[] {
  return [
    { id: 'report', label: '보고서' },
    { id: 'evidence', label: `근거 ${report.evidence.length}` },
    { id: 'attachments', label: `첨부 ${attachmentCount}` },
    { id: 'info', label: '정보' },
  ];
}

/** 첨부 탭의 빈 상태 글. 읽기 전용 진단의 보고서에는 첨부가 없다. */
export const NO_ATTACHMENTS_TEXT = '첨부가 없습니다. 재현하면서 찍은 화면과 로그가 있으면 여기에 보입니다.';

/** 근거 목록이 빈 상태일 때의 글. */
export const NO_EVIDENCE_TEXT = '근거가 없습니다.';

/** 첨부 파일 크기를 사람이 읽는 글로 바꾼다. 1KB 아래는 바이트, 1MB 아래는 KB, 그 위는 MB다. */
export function attachmentSizeText(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes}B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)}KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)}MB`;
}

/** 원인 글의 한 조각. 글이거나, 근거를 가리키는 번호(`[근거 n]`)다. */
export type CausePart = { text: string } | { cite: number };

/**
 * 원인 글을 글과 근거 번호 조각으로 나눈다. 에이전트가 문장 끝에 적은 `[근거 n]`은 Flow 초안처럼 원문자(①②)로 보이도록 번호 조각이 되고,
 * 번호 앞의 공백은 글에서 뺀다. 같은 줄의 `[근거 1] [근거 2]`는 번호 둘이 이어진다.
 */
export function causeParts(text: string): CausePart[] {
  /** 나눈 조각. */
  const parts: CausePart[] = [];
  /** 마지막으로 자른 위치. */
  let last = 0;
  for (const match of text.matchAll(/[ \t]*\[근거\s*(\d+)\]/g)) {
    /** 번호 앞의 글. */
    const before = text.slice(last, match.index);
    if (before !== '') parts.push({ text: before });
    parts.push({ cite: Number(match[1]) });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

/** 종류나 한도(10개, 합계 20MB)를 넘어 옮기지 않은 첨부의 안내. */
export function omittedAttachmentsText(count: number): string {
  return `첨부 ${count}개 생략`;
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

/** 날짜(`YYYY-MM-DD`). PC의 시간대로 센다. */
function formatDate(at: number): string {
  /** 날짜. */
  const date = new Date(at);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/**
 * 보고서의 앞선 진단 줄. 검토 대기 중인 앞선 보고서가 있었으면 그 사실을, 완료한 뒤의 재발이면 "앞서 진단함(완료한 날짜)"과
 * 마지막으로 내보낸 파일 경로를 적는다. 파일이 없었거나 내보낸 적 없으면 날짜만 있다. 앞선 진단이 없으면 줄이 없다.
 */
export function priorDiagnosisFacts(prior: DiagnosisReportSnapshot['priorDiagnosis']): IssueFact[] {
  if (prior === null) return [];
  if (prior.kind === 'in-review') return [{ label: '앞선 진단', value: '검토 대기 중인 앞선 보고서가 있음' }];
  return [
    { label: '앞선 진단', value: `앞서 진단함(${formatDate(prior.completedAt)})` },
    ...(prior.exportPath === null ? [] : [{ label: '앞서 내보낸 파일', value: prior.exportPath }]),
  ];
}

/** 보고서의 오류 이슈 정보 가운데 앱이 진단을 시작할 때 Sentry에서 받은 줄과 앞선 진단. 감지할 때 받은 `오류 정보` 표 뒤에 붙는다. */
export function reportEventFacts(report: DiagnosisReportSnapshot): IssueFact[] {
  /** release 세 가지. */
  const releases = [report.event.release, report.event.firstRelease, report.event.lastRelease];
  return [
    { label: 'release(이벤트 · 최초 · 최근)', value: releases.map((value) => value ?? '없음').join(' · ') },
    { label: '소스맵', value: SOURCE_MAP_TEXT[report.event.sourceMaps] },
    { label: '없는 데이터', value: report.event.missingData.length === 0 ? '없음' : report.event.missingData.join(', ') },
    ...priorDiagnosisFacts(report.priorDiagnosis),
  ];
}

/**
 * 보고서의 실행 정보 표. 저장소 경로, HEAD 해시, 커밋하지 않은 변경 유무, 에이전트와 버전, 재현 허용 여부, 걸린 시간, 생성 시각이고,
 * 재현하는 진단이면 실린 MCP 서버와 빠진 서버·까닭이 붙는다.
 */
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
    ...mcpServerFacts(run.mcpServers).map(([label, value]) => ({ label, value })),
  ];
}

/** 근거의 위치. Flow 초안의 근거와 같은 "저장소 이름 · 파일 이름 · 88번째 줄"이다. 저장소 이름은 경로의 마지막 폴더다. */
export function diagnosisEvidenceLocation(evidence: DiagnosisReportSnapshot['evidence'][number]): string {
  /** 저장소 폴더 이름. */
  const repositoryName = evidence.repository.split(/[\\/]/).filter(Boolean).at(-1) ?? evidence.repository;
  return evidenceLocation({ ...evidence, repositoryName, developerTerms: [] });
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

/** `오류 정보` 표. 감지할 때 받은 값(신규·재발 구분과 감지 시각 포함)만 보이고, 모르는 값은 줄째 뺀다. 스택 앞부분은 이벤트를 받는 진단 시작 때 생긴다. */
export function issueFacts({ issue, origin, detectedAt }: Pick<DiagnosisSnapshot, 'issue' | 'origin' | 'detectedAt'>, now = Date.now()): IssueFact[] {
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
    ['신규·재발', origin === 'new' ? '신규' : '재발'],
    ['감지 시각', formatTime(detectedAt, now)],
  ];
  return facts.flatMap(([label, value]) => (value === null ? [] : [{ label, value }]));
}

/** 보고서 내보내기 토스트 글. 내보냈으면 파일 이름을 적고(`fileName`), 내보내지 못했으면 `null`이다. */
export function exportToastText(fileName: string | null): string {
  return fileName === null ? '내보내지 못했습니다. 내보낼 폴더를 확인해 주세요.' : `내보냈습니다: ${fileName}`;
}

/** 내보내지 않고 [완료]를 눌렀을 때 바닥 줄에 보이는 확인 글. */
export const EXPORT_CONFIRM_TEXT = '내보내지 않았습니다. 완료하면 이 보고서가 사라집니다.';

/** 다시 진단하는 중의 바닥 줄 글. */
export const REDIAGNOSING_FOOTER_TEXT = '다시 진단하는 중입니다. 끝나면 이 보고서를 바꿉니다.';

/**
 * 다시 진단하지 못하고 앞선 보고서로 돌아왔을 때 보고서 위 알림 줄의 글.
 * "다시 진단하지 못했습니다: `<사유>` 앞선 보고서를 그대로 둡니다."이고 사유는 진단 실패의 오류 문장이다.
 */
export function rediagnosisFailureNotice(failure: DiagnosisFailureSnapshot): string {
  return `다시 진단하지 못했습니다: ${diagnosisFailureText(failure)} 앞선 보고서를 그대로 둡니다.`;
}

/** [다시 진단 ▾]의 항목. 지시 없이 다시 진단, 지시를 덧붙여 다시 진단이다. */
export type RediagnoseChoice = 'again' | 'directive';

/** [다시 진단 ▾] 항목의 이름. 메뉴에 이 순서로 보인다. */
export const REDIAGNOSE_CHOICES: readonly { choice: RediagnoseChoice; label: string }[] = [
  { choice: 'again', label: '다시 진단' },
  { choice: 'directive', label: '지시를 덧붙여 다시 진단' },
];

/** 지시 입력의 글. 위에서 아래로 이름, 앞서 덧붙인 지시 안내, 새 보고서 안내다. */
export const DIRECTIVE_FORM_TEXT = {
  label: '지시',
  previous: '앞서 덧붙인 지시도 함께 넘깁니다.',
  reproduce: '재현도 다시 하기',
  reproduceHelp: '끄면 앞선 재현 결과를 그대로 둡니다.',
  replaceNote: '새 보고서가 나오면 지금 보고서를 바꿉니다. 남기려면 먼저 내보내세요.',
  placeholder: '예: 캐시 쪽 원인도 확인해 주세요.',
} as const;
