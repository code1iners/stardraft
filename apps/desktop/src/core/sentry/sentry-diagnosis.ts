import type { DraftEvidence } from '../drafts/draft';
import type { GenerationRunKind, RunFailureReason, RunRecord } from '../generation/generation-run';
import type { AgentId } from '../ports/executor';

/** 진단을 일으킨 감지의 갈래. 신규와 재발이다. 표에 그대로 남으므로 값을 바꾸지 않는다. */
export type DiagnosisOrigin = 'new' | 'regression';

/**
 * 진단의 상태. 진행 중은 따로 두지 않고 대기(`queued`) 안에서 생성 대기열이 실행 중인지로 가린다.
 * 표의 상태 열에는 검사를 두지 않아 값을 더해도 표를 다시 만들지 않는다.
 */
export type DiagnosisStatus =
  /** 대기 또는 진행 중. 생성 대기열의 대상이다. */
  | 'queued'
  /** 저장소 대기. 사유는 `repoCheck`다. */
  | 'repo-check-needed'
  /** 검토 대기. 보고서가 있다(재현 결과와 무관). */
  | 'ready'
  /** 진단 실패. 보고서 없이 끝났고 사유는 `failure`다. 자동으로 더 재시도하지 않는다. */
  | 'failed'
  /** 완료. 최소 기록(오류 이슈 ID, 재발 식별자, 완료 시각)만 남았다. */
  | 'completed';

/** 저장소 대기의 사유. Flow 묶음과 이름·재개 방식이 같다. */
export type DiagnosisRepoCheck =
  /** 저장소 매핑 필요. 프로젝트에 매핑이 없다. 매핑을 저장하면 저절로 대기가 된다. */
  | { kind: 'unmapped' }
  /** 저장소 확인 필요. 매핑된 폴더가 없다. 폴더가 돌아오거나 매핑을 고치면 저절로 대기가 된다. */
  | { kind: 'missing-folder'; path: string };

/** 감지할 때 오류 이슈 목록과 등록에서 받아 둔 오류 이슈 정보. 상세의 `오류 정보`와 보고서의 오류 이슈 정보가 쓴다. */
export interface DiagnosisIssue {
  /** 짧은 ID. 없으면 빈 문자열. */
  shortId: string;
  /** 오류 제목. */
  title: string;
  /** 오류가 난 자리(culprit). 없으면 빈 문자열. */
  culprit: string;
  /** 레벨. 없으면 빈 문자열. */
  level: string;
  /** 등록의 환경 필터. `null`이면 모든 환경이다. */
  environment: string | null;
  /** 처음 보인 시각(Unix epoch 밀리초). 환경 필터가 있으면 그 환경 기준이다. */
  firstSeen: number;
  /** 마지막으로 보인 시각. 모르면 `null`. */
  lastSeen: number | null;
  /** 발생 수. 모르면 `null`. */
  count: number | null;
  /** 사용자 수. 모르면 `null`. */
  userCount: number | null;
  /** Sentry 화면 주소. 없으면 `null`. */
  permalink: string | null;
  /** 플랫폼. 없으면 `null`. */
  platform: string | null;
  /** 조직 이름. */
  organizationName: string;
  /** 프로젝트 이름. */
  projectName: string;
}

/** 보고서를 마지막으로 내보낸 기록. 완료한 뒤에도 파일 경로는 최소 기록으로 남는다. */
export interface DiagnosisExport {
  /** 내보낸 마크다운 파일의 절대 경로. */
  path: string;
  /** 내보낸 시각(Unix epoch 밀리초). */
  at: number;
  /** 내보낸 보고서의 생성 시각(`report.run.createdAt`). 다시 진단으로 보고서가 바뀌면 값이 달라져 내보내지 않은 것으로 본다. */
  reportCreatedAt: number;
}

/** Sentry 진단 하나. 신규 또는 재발한 오류 이슈 하나에 하나다. 같은 오류 이슈의 진단이 여럿일 수 있다(검토 대기 중 재발 등). */
export interface SentryDiagnosis {
  /** 진단 ID. 생성 대기열의 대상 ID다. */
  id: number;
  /** 등록한 Sentry 프로젝트 ID. */
  projectId: string;
  /** 오류 이슈 ID. */
  issueId: string;
  /** 신규인지 재발인지. */
  origin: DiagnosisOrigin;
  /** 재발이면 재발을 일으킨 이벤트 ID. 신규면 `null`. */
  regressionEventId: string | null;
  /** 감지한 시각(Unix epoch 밀리초). */
  detectedAt: number;
  /** 상태. */
  status: DiagnosisStatus;
  /** 저장소 대기의 사유. 저장소 대기가 아니면 `null`. */
  repoCheck: DiagnosisRepoCheck | null;
  /** 오류 이슈 정보. */
  issue: DiagnosisIssue;
  /** 진단 보고서. 검토 대기가 아니면 `null`. */
  report: DiagnosisReport | null;
  /** 진단 실패의 까닭. 진단 실패가 아니면 `null`. */
  failure: DiagnosisFailure | null;
  /** 실행 기록. 이 진단을 만드는 동안 돌린 실행이다. 완료하면 지운다. */
  runs: RunRecord[];
  /** 완료한 시각(Unix epoch 밀리초). 완료가 아니면 `null`. */
  completedAt: number | null;
  /** 마지막으로 내보낸 기록. 내보낸 적 없으면 `null`. 완료해도 남는다. */
  lastExport: DiagnosisExport | null;
  /** 다시 진단에서 쌓인 지시. 덧붙인 순서다. 지시 없이 다시 진단하거나 완료하면 비운다. */
  directives: string[];
  /**
   * 마지막 다시 진단이 실패하거나 취소해 앞선 보고서로 돌아왔다는 기록. 보고서 위 알림 줄이 사유와 [다시 걸기]를 보인다.
   * 새 다시 진단을 시작하거나 성공하거나 완료하면 `null`로 되돌린다.
   */
  rediagnosisFailure: DiagnosisFailure | null;
}

/** 아직 저장하지 않은 진단. 감지가 만든 진단은 대기나 저장소 대기라 보고서·실패·실행 기록·완료 시각·내보내기 기록·지시가 없다. */
export type UnsavedDiagnosis = Omit<SentryDiagnosis, 'id' | 'report' | 'failure' | 'runs' | 'completedAt' | 'lastExport' | 'directives' | 'rediagnosisFailure'>;

/**
 * 진단을 실행하기 전에 생기는 실패 사유. Flow 초안의 맥락 조회 실패(`flow-unavailable`)에 해당한다.
 * `sentry-unavailable`: 기다려도 풀리지 않을 까닭(접근 거부, 최신 이벤트 없음, 앱이 모르는 응답 등)으로 Sentry에서 오류 데이터를 가져오지 못했다.
 * `repository-unavailable`: 다시 진단하려는데 그사이 저장소 매핑이나 폴더가 사라졌다. 다시 진단은 저장소 대기로 가지 않고 앞선 보고서로 돌아오므로 이 사유로 알린다.
 */
export type SentryFailureReason = 'sentry-unavailable' | 'repository-unavailable';

/** 진단 실패의 까닭. 사유는 Flow 초안의 실패 사유를 그대로 쓰고(결과 형식 오류, 시간 초과, 취소함, 비밀 파일 근거 등), Sentry 조회 실패를 더한다. */
export interface DiagnosisFailure {
  /** 사유. */
  reason: RunFailureReason | SentryFailureReason;
  /** 에이전트가 알려 준 오류 원문. 없으면 `null`. */
  detail: string | null;
  /** 실패할 때의 마지막 진행 단계. 실행을 시작하기 전이면 `null`. */
  lastStep: string | null;
  /** 실패한 실행의 종류. 실행을 시작하기 전에 실패했으면 `null`. */
  runKind: GenerationRunKind | null;
}

/** 원인의 확신도. 재현 없이 추정한 원인을 확정으로 오해하지 않게 보고서에 함께 보인다. */
export type DiagnosisConfidence = 'high' | 'medium' | 'low';

/**
 * 재현이 불가한 까닭. 앞의 셋은 에이전트가 적고, 뒤의 둘은 에이전트가 답할 수 없어 앱이 채운다.
 * - `not-allowed`: 재현을 허용하지 않은 진단(읽기 전용 진단). 화면에는 "불가(허용 안 됨)".
 * - `timed-out`: 시간 초과 뒤 재현 없이 다시 시도한 진단. 화면에는 "불가(시간 초과)".
 */
export type ReproductionImpossibleReason = 'no-tool' | 'insufficient-data' | 'env-failed' | 'not-allowed' | 'timed-out';

/** 보고서의 재현 칸. */
export interface DiagnosisReproduction {
  /** 결과. 성공, 실패, 불가다. */
  result: 'success' | 'failure' | 'impossible';
  /** 불가의 까닭. 불가가 아니면 `null`. */
  impossibleReason: ReproductionImpossibleReason | null;
  /** 재현에 쓴 방법. 앱이 채운 칸이면 빈 문자열. */
  method: string;
  /** 성공이면 최소화한 재현 순서, 실패·불가면 시도한 것. */
  steps: string[];
}

/** 원인과 확신도. 원인 글은 근거를 `[근거 n]`으로 가리킨다(Flow 초안의 근거 번호와 같은 번호). */
export interface DiagnosisCause {
  /** 원인 글. */
  text: string;
  /** 확신도. */
  confidence: DiagnosisConfidence;
}

/** 소스맵이 적용됐는지. 최신 이벤트의 처리 오류와 변환 전 스택트레이스로 정한다. */
export type SourceMapStatus = 'applied' | 'failed' | 'unknown';

/** 앱이 진단을 시작할 때 Sentry에서 받아 보고서의 오류 이슈 정보에 더하는 것. */
export interface DiagnosisEventFacts {
  /** 받은 최신 이벤트 ID. */
  eventId: string;
  /** 최신 이벤트의 release. 없으면 `null`. */
  release: string | null;
  /** 오류 이슈의 최초 release. 모르면 `null`. */
  firstRelease: string | null;
  /** 오류 이슈의 최근 release. 모르면 `null`. */
  lastRelease: string | null;
  /** 소스맵 적용 여부. */
  sourceMaps: SourceMapStatus;
  /** 없는 데이터 항목(스택트레이스 없음, 소스맵 적용 안 됨 등). 지침과 보고서에 그대로 적는다. */
  missingData: string[];
  /** 스택 앞부분. 상세의 `오류 정보`에 보인다. 가장 안쪽 예외의 마지막 프레임부터 몇 줄이다. */
  stackHead: string[];
}

/** 앱이 채우는 실행 정보. */
export interface DiagnosisRunInfo {
  /** 에이전트가 읽은 저장소(절대 경로). */
  repository: string;
  /** 진단을 시작할 때 저장소의 HEAD 커밋 해시. git 저장소가 아니거나 읽지 못하면 `null`. */
  headCommit: string | null;
  /** 진단을 시작할 때 커밋하지 않은 변경이 있었는지. 모르면 `null`. */
  uncommittedChanges: boolean | null;
  /** 실행한 에이전트. */
  agent: AgentId;
  /** 실행에서 본 에이전트 CLI 버전. 모르면 `null`. */
  cliVersion: string | null;
  /** 재현 허용 여부. 읽기 전용 진단은 거짓이다. */
  reproductionAllowed: boolean;
  /** 걸린 시간(밀리초). 첫 실행을 시작한 때부터 마지막 실행이 끝난 때까지다. */
  durationMs: number;
  /** 보고서를 만든 시각(Unix epoch 밀리초). */
  createdAt: number;
}

/**
 * 같은 오류 이슈의 앞선 진단. 새 보고서의 오류 이슈 정보에 적힌다.
 * - `in-review`: 앞선 보고서가 검토 대기 중이다. 그 요약·원인·개선 방향은 입력에 "참고일 뿐"으로 넘어간다.
 * - `completed`: 완료한 뒤의 재발이다. 입력에는 아무것도 넘어가지 않고, 완료한 날짜와 마지막으로 내보낸 파일 경로만 적는다.
 *   파일이 그 자리에 없거나 내보낸 적이 없으면 `exportPath`는 `null`이다.
 */
export type PriorDiagnosis = { kind: 'in-review' } | { kind: 'completed'; completedAt: number; exportPath: string | null };

/** 진단 보고서. 에이전트가 쓴 칸(요약, 원인, 개선 방향, 근거, 남은 의문)과 앱이 채우는 칸(재현 불가 사유, 오류 이슈 정보, 실행 정보)이다. */
export interface DiagnosisReport {
  /** 요약. */
  summary: string;
  /** 재현 결과. 읽기 전용 진단은 앱이 "불가(허용 안 됨)"로 채운다. */
  reproduction: DiagnosisReproduction;
  /** 원인과 확신도. */
  cause: DiagnosisCause;
  /** 개선 방향. */
  improvements: string[];
  /** 남은 의문. 채택하지 않은 가설도 여기에 든다. */
  openQuestions: string[];
  /** 근거. Flow 초안의 근거와 같은 필드이고 위치를 확인했는지가 붙는다. */
  evidence: DraftEvidence[];
  /** 진단을 시작할 때 Sentry에서 받은 오류 이슈 정보. */
  event: DiagnosisEventFacts;
  /** 실행 정보. */
  run: DiagnosisRunInfo;
  /** 같은 오류 이슈의 앞선 진단. 없으면 `null`. 이 칸이 생기기 전에 저장한 보고서는 읽을 때 `null`로 본다. */
  priorDiagnosis: PriorDiagnosis | null;
}

/**
 * 중복 억제 키. 신규는 오류 이슈 ID, 재발은 오류 이슈 ID와 재발을 일으킨 이벤트 ID다.
 * 재발 활동의 ID는 같은 재발인데도 달라질 수 있어 쓰지 않는다.
 */
export interface DetectionKey {
  /** 오류 이슈 ID. */
  issueId: string;
  /** 재발을 일으킨 이벤트 ID. 신규면 `null`. */
  eventId: string | null;
}

/**
 * 지금 보이는 보고서를 내보낸 적이 있는지 본다. 마지막 내보내기가 지금 보고서의 것이어야 한다.
 * 다시 진단으로 보고서가 새로 생기면 이전 내보내기는 이 보고서의 것이 아니라 거짓이 된다.
 */
export function hasExportedCurrentReport(diagnosis: Pick<SentryDiagnosis, 'report' | 'lastExport'>): boolean {
  return diagnosis.report !== null && diagnosis.lastExport !== null && diagnosis.lastExport.reportCreatedAt === diagnosis.report.run.createdAt;
}

/**
 * 다시 진단하는 중인지 본다. 대기(진행 중 포함)인데 앞선 보고서를 보관하고 있다. 처음 진단하는 대기에는 보고서가 없다.
 * 이 동안 내보내기와 완료는 할 수 없고, 새 재발은 새 진단을 만들지 않고 키만 기록한다.
 */
export function isRediagnosing(diagnosis: Pick<SentryDiagnosis, 'status' | 'report'>): boolean {
  return diagnosis.status === 'queued' && diagnosis.report !== null;
}

/** 저장소 대기인지 본다. */
export function isRepoWaiting(diagnosis: Pick<SentryDiagnosis, 'status'>): boolean {
  return diagnosis.status === 'repo-check-needed';
}

/**
 * 같은 오류 이슈에 새 재발이 왔을 때 새 진단을 만들지 않고 키만 기록하는 상태.
 * 저장소 대기와 대기(진행 중 포함)다.
 */
export function absorbsRegression(status: DiagnosisStatus): boolean {
  return status === 'queued' || status === 'repo-check-needed';
}

/** 같은 오류 이슈에 새 재발이 왔을 때 새 진단으로 바꾸는 상태. 진단 실패다. */
export function replacedByRegression(status: DiagnosisStatus): boolean {
  return status === 'failed';
}

/** 등록을 풀 때 목록에서 조용히 빼는 상태. 대기(진행 중 포함), 저장소 대기, 진단 실패다. 검토 대기 보고서와 완료는 남는다. */
export const STATUSES_REMOVED_ON_UNREGISTER: readonly DiagnosisStatus[] = ['queued', 'repo-check-needed', 'failed'];

/**
 * [Sentry에서 열기]로 열 수 있는 주소만 돌려준다. 공식 sentry.io(하위 주소 포함)의 https 주소이고 아니면 `null`이다.
 * 주소는 Sentry 응답에서 온 값이라 브라우저에 넘기기 전에 한 번 더 거른다.
 */
export function openableSentryUrl(permalink: string | null): string | null {
  if (permalink === null) return null;
  try {
    /** 읽은 주소. */
    const url = new URL(permalink);
    return url.protocol === 'https:' && (url.hostname === 'sentry.io' || url.hostname.endsWith('.sentry.io')) ? url.toString() : null;
  } catch {
    return null;
  }
}
