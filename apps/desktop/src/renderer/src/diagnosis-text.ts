import type { DiagnosisRepoWaitSnapshot, DiagnosisSnapshot } from '../../shared/ipc';
import { formatTime, type RepoWaitText } from './review-text';

/** 펼친 창 목록에서 Sentry 진단을 묶는 종류 이름. 초안 묶음보다 위에 온다. */
export const DIAGNOSIS_KIND_LABEL = '진단';

/** 진단 상태 태그의 이름과 색. */
export function diagnosisStatusTag(diagnosis: Pick<DiagnosisSnapshot, 'status' | 'repoWait'>): { label: string; tone: 'generating' | 'warn' } {
  if (diagnosis.status === 'queued') return { label: '대기', tone: 'generating' };
  return { label: diagnosis.repoWait?.kind === 'missing-folder' ? '저장소 확인 필요' : '저장소 매핑 필요', tone: 'warn' };
}

/** 상세 머리의 둘째 줄: `프로젝트 · 신규/재발 · 감지 시각`. */
export function diagnosisMetaLine(diagnosis: Pick<DiagnosisSnapshot, 'issue' | 'origin' | 'detectedAt'>, now = Date.now()): string {
  return [diagnosis.issue.projectName, diagnosis.origin === 'new' ? '신규' : '재발', formatTime(diagnosis.detectedAt, now)].join(' · ');
}

/** 목록 줄의 둘째 줄. 보고서가 없는 동안은 `프로젝트 · 자리`이고, 자리를 모르면 프로젝트만이다. */
export function diagnosisPlaceLine(diagnosis: Pick<DiagnosisSnapshot, 'issue'>): string {
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
