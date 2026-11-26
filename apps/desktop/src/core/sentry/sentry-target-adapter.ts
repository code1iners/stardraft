import { DIAGNOSING_STEP, FETCHING_SENTRY_EVENT_STEP } from '../agent/progress-steps';
import { withDefaultSecretPatterns } from '../agent/secret-patterns';
import { checkEvidence } from '../drafts/draft-check';
import type { RunRecord } from '../generation/generation-run';
import type { Preparation, PrepareContext, RunReading, TargetAdapter, TargetFailure, TargetRun, TargetRunRequest } from '../generation/target-adapter';
import { errorFields, type LogFields, type Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { AgentId, ReproductionMcp } from '../ports/executor';
import type { ConnectSentry, SentryApiFailure } from '../ports/sentry-api';
import type { ReproductionRepoSetting, SettingsStore } from '../ports/settings-store';
import type { ReproductionCopies } from '../reproduction/reproduction-copies';
import type { DeviceSnapshot, Simulators } from '../reproduction/simulators';
import type { RepoGitState } from '../repos/repo-git-state';
import { stageReproductionAttachments, type DiagnosisAttachmentFolders } from './diagnosis-attachments';
import {
  DIAGNOSIS_EXTENDED_MESSAGE,
  DIAGNOSIS_TIMEOUT_MS,
  DIAGNOSIS_WRAP_UP_MESSAGE,
  REPRODUCTION_TIME_EXTENSION,
  diagnosisInputDocument,
  eventFacts,
  readDiagnosisOutput,
  readOnlyDiagnosisInstructions,
  readOnlyDiagnosisSchema,
  readReproducingDiagnosisOutput,
  reproducingDiagnosisInstructions,
  reproducingDiagnosisSchema,
  type DiagnosisInstructionContext,
  type DiagnosisOutput,
  type ReproducingDiagnosisOutput,
} from './diagnosis-run';
import type { SentryConnection } from './sentry-connection';
import type { ReportAttachments, SentryDiagnoses } from './sentry-diagnoses';
import {
  isRediagnosing,
  type DiagnosisRepoCheck,
  type DiagnosisMcpServers,
  type DiagnosisReport,
  type DiagnosisRunInfo,
  type PriorDiagnosis,
  type SentryDiagnosis,
  type SentryFailureReason,
} from './sentry-diagnosis';
import type { SentryProjects } from './sentry-projects';

/** Sentry 진단의 대상 종류. 생성 대기열 표에 남는 값이라 바꾸지 않는다. */
export const SENTRY_TARGET_KIND = 'sentry';

/** Sentry에 닿지 못해(네트워크 오류, 서버 오류) 멈춘 Sentry 어댑터가 다시 준비하기까지 기다리는 시간(밀리초). */
const SENTRY_RETRY_DELAY_MS = 60_000;
/** 요청 한도에 걸려 멈춘 Sentry 어댑터가 기다리는 가장 짧은 시간(밀리초). */
const MIN_SENTRY_RETRY_DELAY_MS = 1_000;

/** 재현하는 진단이 쥐는 함께 돌 수 없는 자원. 재현하는 진단은 시뮬레이터와 포트를 함께 써서 한 번에 하나만 돈다. */
const REPRODUCTION_RESOURCE = 'reproduction';

/** 재현 사본을 만들지 못해 읽기 전용으로 돈 진단의 재현 방법 칸. */
const COPY_FAILED_METHOD = '재현 사본을 만들지 못해 코드만 읽고 진단했습니다.';

/** 결과를 저장할 때 실행 기록으로 채울 칸을 뺀 보고서. 실행 정보의 에이전트·버전·걸린 시간·생성 시각은 저장할 때 채운다. */
export type PendingDiagnosisReport = Omit<DiagnosisReport, 'run'> & {
  /** 준비할 때 정한 실행 정보와, 재현하는 진단이면 실은 MCP 서버. */
  run: Pick<DiagnosisRunInfo, 'repository' | 'headCommit' | 'uncommittedChanges' | 'reproductionAllowed' | 'mcpServers'>;
  /** 저장할 때 첨부를 어떻게 할지. 보고서에는 남지 않는다. */
  attachmentChange: ReportAttachments;
};

/** 재현하는 진단에 필요한 것. 없으면 모든 진단이 읽기 전용으로 돈다. */
export interface SentryReproductionOptions {
  /** 지금 OS. macOS(`darwin`)에서만 재현한다. */
  platform: NodeJS.Platform;
  /** 프로젝트에 매핑된 저장소의 재현 설정. 매핑이 없거나 설정이 없으면 `null`. 대기열이 꺼낼 때마다 부르므로 바로 답한다. */
  setting: (projectId: string) => ReproductionRepoSetting | null;
  /** 재현 사본. */
  copies: Pick<ReproductionCopies, 'create' | 'remove'>;
  /** 실행이 새로 켠 시뮬레이터·에뮬레이터 정리. */
  devices: Pick<Simulators, 'snapshot' | 'shutDownNew'>;
  /** 첨부를 옮겨 둘 폴더. */
  attachments: Pick<DiagnosisAttachmentFolders, 'createStaging' | 'discard'>;
  /** 실행하는 에이전트가 원본 저장소의 사본에서 재현할 때 실을 MCP. 실행마다 그 CLI의 정의를 다시 읽는다. */
  mcp: (agent: AgentId, sourceRoot: string) => Promise<ReproductionMcp>;
}

/**
 * Sentry 어댑터의 타입 묶음. 시작 표식은 진단을 감지한 시각, 결과는 실행 정보를 채우기 전의 보고서,
 * 저장소 대기는 저장소 대기 사유, 실행 전 실패는 Sentry에서 오류 데이터를 가져오지 못함이다.
 */
export interface SentryTargetTypes {
  /** 진단을 감지한 시각. */
  job: number;
  /** 실행 정보를 채우기 전의 보고서. */
  result: PendingDiagnosisReport;
  /** 저장소 대기 사유. */
  repoWait: DiagnosisRepoCheck;
  /** 실행 전 실패 사유. */
  failureReason: SentryFailureReason;
}

/** Sentry 어댑터에 필요한 것. */
export interface SentryTargetAdapterOptions {
  /** 진단을 찾고 결과를 맡길 진단 목록. */
  diagnoses: SentryDiagnoses;
  /** 진단할 Sentry 프로젝트의 저장소와 조직을 정한다. */
  projects: Pick<SentryProjects, 'resolveRepo' | 'organizationFor'>;
  /** Sentry 토큰과 "토큰 확인 필요". 토큰 문제는 Sentry 어댑터만 멈춘다. */
  connection: Pick<SentryConnection, 'token' | 'state' | 'reportApiFailure' | 'onChange'>;
  /** 토큰 하나로 Sentry API를 부르는 클라이언트를 만든다. */
  connectSentry: ConnectSentry;
  /** 추가 비밀 파일 패턴을 읽는 설정 저장소. 실행마다 새로 읽는다. 사용자 추가 지침은 진단에 붙이지 않는다. */
  settingsStore: SettingsStore;
  /** 저장소의 HEAD 해시와 커밋하지 않은 변경 유무를 읽는다. */
  repoState: (repository: string) => Promise<RepoGitState>;
  /** 내보낸 파일이 지금도 그 자리에 있는지 본다. 완료한 뒤의 재발이 앞선 진단의 파일 경로를 적을 때 쓴다. */
  exportFileExists: (path: string) => Promise<boolean>;
  /** 보고서를 만든 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. 오류 제목과 경로는 남기지 않는다. */
  logger: Logger;
  /** 재현하는 진단에 필요한 것. 없으면 재현하지 않는다. */
  reproduction?: SentryReproductionOptions;
}

/**
 * Sentry 어댑터. 생성 대기열에서 Sentry 진단을 맡는다. 감지된 진단은 `auto` 칸에, [다시 시도]한 진단은 `user` 칸에 선다.
 * 준비는 저장소 확인 → 시작 직전 오류 이슈 상태 확인 → 최신 이벤트 받기 → 저장소 git 상태 읽기 순서다.
 * 해결·보관·삭제·병합된 오류 이슈는 조용히 빼고, Sentry에 닿지 못하거나 토큰이 거부되면 진단을 실패로 두지 않고 Sentry 어댑터만 멈춘다.
 * 재현 허용이 켜진 저장소(macOS)의 진단은 원본의 사본에서 재현 경계로 돌고(재현하는 진단), 그 밖은 읽기 전용 진단이다.
 * 재현하는 진단은 한 번에 하나만 돌고, 사본과 실행이 새로 켠 시뮬레이터는 성공·실패·취소와 상관없이 생성이 끝날 때 치운다.
 * 지시를 덧붙인 다시 진단에서 "재현도 다시 하기"를 껐으면 읽기 전용으로 돌고 앞선 재현 칸과 첨부를 그대로 옮긴다.
 * 다시 진단(대기인데 앞선 보고서를 보관한 진단)도 이 어댑터가 돌린다. 지시를 덧붙였으면 앞선 보고서와 쌓인 지시 전부를, 지시가 없으면 아무것도 넘기지 않는다.
 * 사용자가 요청한 다시 진단은 그사이 Sentry에서 오류 이슈가 해결·보관돼도 조용히 빼지 않고 진단하며, 오류 이슈가 사라졌으면 앞선 보고서로 돌아온다.
 * 같은 오류 이슈의 앞선 진단이 검토 대기 중이면 그 요약·원인·개선 방향을 참고로 넘기고, 완료한 뒤라면 아무것도 넘기지 않는다.
 * 어느 쪽이든 보고서의 오류 이슈 정보에 앞선 진단이 있다고 적는다.
 */
export class SentryTargetAdapter implements TargetAdapter<SentryTargetTypes> {
  /** Sentry 진단의 대상 종류. */
  readonly kind = SENTRY_TARGET_KIND;
  /** 준비하는 동안 보일 진행 단계. */
  readonly preparingStep = FETCHING_SENTRY_EVENT_STEP;

  /** 생성을 시작할 때(재현 자원을 쥘 때) 재현하는 진단으로 판단했는지. 진단 ID → 판단. 준비가 꺼내 쓴다. */
  private readonly startedReproducing = new Map<number, boolean>();
  /** 지금 사본에서 재현 경계로 도는 진단 ID. 실패를 기록할 때 "재현하던 진단"인지 알려 준다. 생성이 끝날 때(정리) 뺀다. */
  private readonly reproducingNow = new Set<number>();

  constructor(private readonly options: SentryTargetAdapterOptions) {}

  generatingTargets(): number[] {
    return this.options.diagnoses.generatingIds();
  }

  requestedByUser(id: number): boolean {
    return this.options.diagnoses.requestedByUser(id);
  }

  onTargetsChange(listener: () => void): () => void {
    return this.options.diagnoses.onChange(listener);
  }

  connectionUsable(): boolean {
    return this.usableToken() !== null;
  }

  onConnectionChange(listener: () => void): () => void {
    return this.options.connection.onChange(listener);
  }

  exclusiveResource(id: number): string | null {
    /** 진단. */
    const diagnosis = this.options.diagnoses.get(id);
    return diagnosis && this.reproduces(diagnosis) ? REPRODUCTION_RESOURCE : null;
  }

  begin(id: number): number | null {
    /** 실행할 진단. */
    const diagnosis = this.options.diagnoses.get(id);
    if (diagnosis?.status !== 'queued') return null;
    // 대기열은 꺼낼 때 `exclusiveResource`로 재현 자원을 쥐었다. 준비하는 사이 재현 허용이 켜져도 자원 없이 재현하지 않도록 지금 판단을 남긴다.
    this.startedReproducing.set(id, this.reproduces(diagnosis));
    return diagnosis.detectedAt;
  }

  /** 진단이 대기(진행 중 포함)이고, 감지 시각이 주어졌으면 생성을 시작할 때의 진단과 같은지 본다. 등록 해제나 취소로 빠지면 거짓이다. */
  isGenerating(id: number, detectedAt: number | null): boolean {
    /** 지금 진단. */
    const diagnosis = this.options.diagnoses.get(id);
    return diagnosis?.status === 'queued' && (detectedAt === null || diagnosis.detectedAt === detectedAt);
  }

  async prepare(id: number, _detectedAt: number, context: PrepareContext): Promise<Preparation<SentryTargetTypes>> {
    /** 생성을 시작할 때의 재현 판단. */
    const startedReproducing = this.startedReproducing.get(id) ?? false;
    this.startedReproducing.delete(id);
    /** 실행할 진단. */
    const diagnosis = this.options.diagnoses.get(id);
    if (!diagnosis || diagnosis.status !== 'queued') return { kind: 'skipped' };

    // 기다리는 사이에 매핑이 사라졌으면 저장소 매핑 필요로, 매핑된 폴더가 사라졌으면 저장소 확인 필요로 둔다.
    /** 지금 폴더 상태로 정한 저장소. */
    const repo = await this.options.projects.resolveRepo(diagnosis.projectId);
    if (context.stopped()) return { kind: 'skipped' };
    if (repo.kind === 'unmapped') return { kind: 'ready', next: { kind: 'repo-wait', wait: { kind: 'unmapped' } } };
    if (repo.kind === 'missing-folder') return { kind: 'ready', next: { kind: 'repo-wait', wait: { kind: 'missing-folder', path: repo.path } } };

    /** 쓸 토큰. 없거나 "토큰 확인 필요"면 토큰이 다시 들어올 때까지 Sentry 어댑터만 멈춘다. */
    const token = this.usableToken();
    if (token === null) return { kind: 'adapter-paused' };
    /** 부를 조직. 조직 목록에 없으면 부를 주소를 모르므로 이 진단만 실패로 두고 다른 진단은 계속한다. */
    const organization = this.options.projects.organizationFor(diagnosis.projectId);
    if (organization === null) {
      this.options.logger.warn('sentry-adapter.organization-missing', { diagnosisId: id });
      return { kind: 'ready', next: { kind: 'fail', reason: 'sentry-unavailable' } };
    }
    /** 이 토큰으로 부르는 Sentry API. */
    const api = this.options.connectSentry(token);

    // 시작 직전 확인: 그사이 해결·보관·삭제·병합됐으면 진단하지 않는다. 실행 중에는 다시 보지 않는다.
    // 다시 진단은 앞선 보고서를 보관하고 있어 조용히 뺄 수 없다. 해결·보관돼도 사용자가 요청했으니 진단하고, 오류 이슈가 사라졌으면 앞선 보고서로 돌아온다.
    /** 다시 진단인지 여부. */
    const rediagnosing = isRediagnosing(diagnosis);
    /** 오류 이슈 상태. */
    const state = await api.errorIssueState(organization, diagnosis.issueId);
    if (context.stopped()) return { kind: 'skipped' };
    if (!state.ok) {
      // 시작 직전 확인의 `404`는 그사이 지워진 오류 이슈라 조용히 뺀다.
      if (state.failure.kind !== 'not-found') return this.unavailable(id, token, state.failure);
      if (rediagnosing) return { kind: 'ready', next: { kind: 'fail', reason: 'sentry-unavailable' } };
      await this.options.diagnoses.dropBeforeStart(id, 'deleted');
      return { kind: 'skipped' };
    }
    if (state.value.status !== 'unresolved' && !rediagnosing) {
      await this.options.diagnoses.dropBeforeStart(id, state.value.status);
      return { kind: 'skipped' };
    }
    // 이벤트 데이터는 감지할 때가 아니라 진단을 시작할 때 최신 것 하나를 받는다.
    /** 최신 이벤트. */
    const event = await api.latestEvent(organization, diagnosis.issueId);
    if (context.stopped()) return { kind: 'skipped' };
    if (!event.ok) return this.unavailable(id, token, event.failure);

    /** 앱이 정한 오류 이슈 정보. */
    const facts = eventFacts(event.value, state.value);
    /** 저장소 git 상태. */
    const git = await this.options.repoState(repo.path);
    if (context.stopped()) return { kind: 'skipped' };
    /** 같은 오류 이슈의 앞선 진단. 완료한 진단의 파일은 지금도 있을 때만 경로를 적는다. */
    const prior = await this.priorDiagnosis(id);
    if (context.stopped()) return { kind: 'skipped' };
    // 지시를 덧붙인 다시 진단만 앞선 보고서와 쌓인 지시를 넘긴다. 지시 없는 다시 진단은 쌓인 지시가 비어 있어 처음부터 한다.
    /** 넘길 직전 결과. */
    const rediagnosis = rediagnosing && diagnosis.report && diagnosis.directives.length > 0 ? { previous: diagnosis.report, directives: diagnosis.directives } : null;
    /** 저장소의 재현 설정. 재현하지 않는 OS면 `null`. */
    const setting = this.reproductionSetting(diagnosis.projectId);
    /** 입력 문서. 재현하는 진단은 사본 경로를 함께 적는다. */
    const document = (workspace: string | null) =>
      diagnosisInputDocument({ repository: repo.path, workspace, issue: diagnosis.issue, origin: diagnosis.origin, event: event.value, facts, prior: prior.report, rediagnosis });
    /** 실행에 넘길 것. */
    const input: DiagnosisRunInput = {
      repository: repo.path,
      document,
      instructionContext: { rediagnosisWithPrevious: rediagnosis !== null, priorDiagnosis: prior.report !== null },
      base: {
        event: facts,
        priorDiagnosis: prior.info,
        run: { repository: repo.path, headCommit: git.headCommit, uncommittedChanges: git.uncommittedChanges, reproductionAllowed: setting?.enabled === true, mcpServers: null },
      },
    };
    /** 지금 저장소가 재현을 허용하는지 여부. */
    const allowed = setting?.enabled === true;
    // 재현을 끈 다시 진단은 앞선 보고서의 재현 칸과 첨부를 그대로 옮긴다. 그사이 재현 허용을 껐으면 옮기지 않고 불가(허용 안 됨)다.
    /** 옮길 앞선 재현. */
    const carried = allowed && rediagnosing && diagnosis.keepReproduction && diagnosis.report ? diagnosis.report : null;
    /** 이어서 돌릴 실행. 재현은 시작할 때 재현 자원을 쥔 진단만 한다. */
    const run =
      allowed && startedReproducing && carried === null && this.options.reproduction
        ? this.reproducingRun(diagnosis, input, setting.envFile, this.options.reproduction)
        : this.readOnlyRun(diagnosis, input, carried);
    return { kind: 'ready', next: { kind: 'run', run } };
  }

  /**
   * 진단의 앞선 진단. 검토 대기 중인 앞선 보고서는 입력에 참고로 넘길 보고서와 함께, 완료한 진단은 날짜와 내보낸 파일 경로만 돌려준다.
   * 완료한 진단의 내보낸 파일이 그 자리에 없으면 경로 없이 날짜만 적는다.
   */
  private async priorDiagnosis(id: number): Promise<{ info: PriorDiagnosis | null; report: DiagnosisReport | null }> {
    /** 목록이 아는 앞선 진단. */
    const found = await this.options.diagnoses.priorOf(id);
    if (!found) return { info: null, report: null };
    if (found.info.kind !== 'completed' || found.info.exportPath === null) return { info: found.info, report: found.report };
    /** 파일이 지금도 있는지 여부. */
    const exists = await this.options.exportFileExists(found.info.exportPath).catch(() => false);
    return { info: exists ? found.info : { ...found.info, exportPath: null }, report: null };
  }

  async save(id: number, _detectedAt: number, pending: PendingDiagnosisReport, runs: readonly RunRecord[]): Promise<boolean> {
    /** 첨부를 어떻게 할지와 보고서. */
    const { attachmentChange, ...report } = pending;
    return this.options.diagnoses.saveReport(id, { ...report, run: this.runInfo(report.run, runs) }, runs, attachmentChange);
  }

  async fail(id: number, _detectedAt: number | null, failure: TargetFailure<SentryFailureReason>, runs: readonly RunRecord[]): Promise<boolean> {
    // 시간 초과로 실패한 것이 재현하던 진단이었는지 남긴다. 그래야 [재현 없이 다시 시도]를 보인다.
    return this.options.diagnoses.markFailed(id, this.reproducingNow.has(id) ? { ...failure, reproducing: true } : failure, runs);
  }

  async needsRepoCheck(id: number, _detectedAt: number, repoCheck: DiagnosisRepoCheck, runs: readonly RunRecord[]): Promise<boolean> {
    return this.options.diagnoses.markRepoWaiting(id, repoCheck, runs);
  }

  async addRuns(id: number, runs: readonly RunRecord[]): Promise<void> {
    await this.options.diagnoses.addRuns(id, runs);
  }

  /** 프로젝트 저장소의 재현 설정. 재현하지 않는 OS이거나 재현 준비가 없으면 `null`. */
  private reproductionSetting(projectId: string): ReproductionRepoSetting | null {
    /** 재현에 필요한 것. */
    const reproduction = this.options.reproduction;
    return reproduction && reproduction.platform === 'darwin' ? reproduction.setting(projectId) : null;
  }

  /** 이 진단이 재현하는 진단으로 도는지 본다. 재현 허용이 켜진 저장소이고, 재현을 끈 다시 진단이 아니다. */
  private reproduces(diagnosis: SentryDiagnosis): boolean {
    return this.reproductionSetting(diagnosis.projectId)?.enabled === true && !(isRediagnosing(diagnosis) && diagnosis.keepReproduction) && !diagnosis.withoutReproduction;
  }

  /** 쓸 수 있는 토큰. 토큰이 없거나 "토큰 확인 필요"면 `null`. */
  private usableToken(): string | null {
    return this.options.connection.state().problem === null ? this.options.connection.token() : null;
  }

  /**
   * 시작 직전 확인이나 이벤트 받기가 실패했다. 일시적 실패(네트워크, `5xx`, `429`)와 토큰 문제는 진단 실패로 두지 않고 Sentry 어댑터만 멈춘다.
   * 토큰 거부(`401`)는 "토큰 확인 필요"를 올리고 토큰이 바뀔 때까지, 한도는 초기화 시각까지, 나머지는 잠시 기다렸다가 다시 준비한다.
   * 기다려도 풀리지 않을 실패(`403`, `404`, 그 밖의 `4xx`, 앱이 모르는 응답 모양)는 그 진단만 "Sentry에서 오류 데이터를 가져오지 못함" 실패로 둔다.
   * 멈추면 이 진단이 대기열 맨 앞에서 기다리므로, 이런 실패로 멈추면 다른 진단까지 막히기 때문이다. 사용자가 [다시 시도]할 수 있다.
   */
  private unavailable(id: number, token: string, failure: SentryApiFailure): Preparation<SentryTargetTypes> {
    this.options.logger.warn('sentry-adapter.sentry-unavailable', { diagnosisId: id, failure: failure.kind });
    switch (failure.kind) {
      case 'unauthorized':
        this.options.connection.reportApiFailure(token, failure);
        return { kind: 'adapter-paused' };
      case 'rate-limited':
        return {
          kind: 'retry-later',
          afterMs: Math.max(failure.resetAt === undefined ? SENTRY_RETRY_DELAY_MS : failure.resetAt - this.options.clock.now(), MIN_SENTRY_RETRY_DELAY_MS),
        };
      case 'network':
        return { kind: 'retry-later', afterMs: SENTRY_RETRY_DELAY_MS };
      case 'http':
        if (failure.status >= 500) return { kind: 'retry-later', afterMs: SENTRY_RETRY_DELAY_MS };
        return { kind: 'ready', next: { kind: 'fail', reason: 'sentry-unavailable' } };
      case 'forbidden':
      case 'not-found':
      case 'unexpected-response':
        return { kind: 'ready', next: { kind: 'fail', reason: 'sentry-unavailable' } };
    }
  }

  /**
   * 읽기 전용 진단 실행. 지금의 초안 실행과 같은 읽기 전용 경계로 돈다(MCP 없음, 묻지 않고 20분에 끊음).
   * 비밀 파일 패턴은 실행마다 설정에서 새로 읽는다. 받은 결과는 Flow 초안과 같은 근거 위치 검사와 비밀 파일 근거 검사를 거친다.
   * 재현 칸은 에이전트가 답할 수 없으므로 앱이 "불가(허용 안 됨)"로 채운다. `carried`가 있으면(재현을 끈 다시 진단) 그 보고서의
   * 재현 칸과 첨부를 그대로 옮기고 앞선 첨부 폴더를 지우지 않는다.
   */
  private readOnlyRun(diagnosis: SentryDiagnosis, input: DiagnosisRunInput, carried: DiagnosisReport | null): TargetRun<SentryTargetTypes, DiagnosisOutput> {
    return {
      kind: 'diagnosis',
      step: DIAGNOSING_STEP,
      omittedContextItems: 0,
      request: async (model) => this.readOnlyRequest(input, model),
      read: readDiagnosisReading,
      check: async (output, request) => {
        /** 근거 검사의 결과. */
        const checked = await this.checkedEvidence(diagnosis, output, input.repository, request);
        if (checked.kind === 'rejected') return checked;
        return {
          kind: 'passed',
          fixes: checked.fixes,
          next: {
            kind: 'save',
            result: {
              ...reportBody(output, checked.evidence),
              reproduction: carried
                ? structuredClone(carried.reproduction)
                : // 시간 초과 뒤 재현 없이 다시 시도한 진단은 허용 여부와 상관없이 "불가(시간 초과)"다. 이 경로의 보고서에만 나온다.
                  { result: 'impossible', impossibleReason: diagnosis.withoutReproduction ? 'timed-out' : 'not-allowed', method: '', steps: [] },
              attachments: carried ? structuredClone(carried.attachments) : [],
              omittedAttachments: carried?.omittedAttachments ?? 0,
              attachmentChange: carried ? { kind: 'keep' } : { kind: 'replace', staged: null },
              ...input.base,
            },
          },
        };
      },
    };
  }

  /**
   * 재현하는 진단 실행. 실행마다(일시적 실패의 다시 실행 포함) 원본의 새 사본을 만들어 그 안에서 재현 경계로 돌리고, 실행하는 에이전트에 등록된 MCP를 싣는다.
   * 실은 서버와 빠진 서버·까닭은 보고서의 실행 정보에 이름만 적는다. 일부 서버가 뜨지 않아도 실행은 진행한다.
   * 결과의 첨부는 사본을 지우기 전에 옮겨 둔다. 첫 실행 전에 켜져 있던 시뮬레이터·에뮬레이터를 기록하고,
   * 생성이 끝나면(정리) 새로 켜진 것만 끄고 사본을 뒤에서 지운다. 사본을 만들지 못하면 그 실행은 읽기 전용으로 돌고
   * 재현 칸은 앱이 "불가(환경 실패)"로 채운다.
   */
  private reproducingRun(
    diagnosis: SentryDiagnosis,
    input: DiagnosisRunInput,
    envFile: string | null,
    reproduction: SentryReproductionOptions,
  ): TargetRun<SentryTargetTypes, DiagnosisOutput | ReproducingDiagnosisOutput> {
    /** 이번 생성의 재현 상태. */
    const session: {
      /** 지금 실행의 사본. 없거나 지웠으면 `null`. */
      copy: string | null;
      /** 지금 실행이 사본을 만들지 못했는지 여부. */
      copyFailed: boolean;
      /** 첫 실행 전에 켜져 있던 시뮬레이터·에뮬레이터. 기록하기 전이면 `null`. */
      devicesBefore: DeviceSnapshot | null;
      /** 옮겨 둔 첨부 폴더. 없으면 `null`. */
      staged: string | null;
    } = { copy: null, copyFailed: false, devicesBefore: null, staged: null };
    /** 지금 사본을 뒤에서 지운다. */
    const dropCopy = () => {
      if (session.copy === null) return;
      void reproduction.copies.remove(session.copy);
      session.copy = null;
    };
    return {
      kind: 'diagnosis',
      step: DIAGNOSING_STEP,
      omittedContextItems: 0,
      request: async (model, agent) => {
        session.devicesBefore ??= await reproduction.devices.snapshot().catch((error: unknown) => {
          this.options.logger.warn('sentry-adapter.devices-snapshot-failed', { diagnosisId: diagnosis.id, ...errorKind(error) });
          return { ios: [], android: [] };
        });
        // 다시 실행은 앞 실행이 고친 사본을 쓰지 않고 새 사본에서 돈다.
        dropCopy();
        try {
          session.copy = await reproduction.copies.create(input.repository, envFile);
          session.copyFailed = false;
        } catch (error) {
          session.copyFailed = true;
          this.options.logger.warn('sentry-adapter.copy-failed', { diagnosisId: diagnosis.id, ...errorKind(error) });
        }
        if (session.copy === null) {
          this.reproducingNow.delete(diagnosis.id);
          return this.readOnlyRequest(input, model);
        }
        this.reproducingNow.add(diagnosis.id);
        /** 실을 MCP. 정의를 읽지 못하면 서버 없이 진행한다. */
        const mcp = await reproduction.mcp(agent, input.repository).catch((error: unknown) => {
          this.options.logger.warn('sentry-adapter.mcp-load-failed', { diagnosisId: diagnosis.id, ...errorKind(error) });
          return { servers: [], env: {}, skipped: [] };
        });
        /** 지금 설정. */
        const settings = await this.options.settingsStore.load();
        return {
          instructions: reproducingDiagnosisInstructions(input.base.event.missingData, input.instructionContext),
          input: input.document(session.copy),
          outputSchema: reproducingDiagnosisSchema(),
          readRoots: [session.copy],
          secretPatterns: [...settings.extraSecretPatterns],
          model,
          timeoutMs: DIAGNOSIS_TIMEOUT_MS,
          reproduction: { copyRoot: session.copy, sourceRoot: input.repository, mcp },
          // 재현하는 진단만 상한 5분 전에 연장을 묻는다. 사본을 만들지 못해 읽기 전용으로 도는 실행은 묻지 않고 상한에서 끊긴다.
          timeExtension: {
            limitMs: DIAGNOSIS_TIMEOUT_MS,
            ...REPRODUCTION_TIME_EXTENSION,
            extendedMessage: DIAGNOSIS_EXTENDED_MESSAGE,
            wrapUpMessage: DIAGNOSIS_WRAP_UP_MESSAGE,
            onAsk: () => this.options.diagnoses.announceTimeExtension(diagnosis.id),
          },
        };
      },
      read: (output) => (session.copyFailed ? readDiagnosisReading(output) : readReproducingReading(output)),
      check: async (output, request, report) => {
        /** 사본. 사본을 만들지 못한 실행이면 `null`. */
        const copy = request.reproduction?.copyRoot ?? null;
        // 사본 안에서 돈 에이전트가 근거의 저장소를 사본 경로로 적었으면 원본 경로로 고친다. 원본과 사본은 같은 파일이다.
        /** 원본 경로로 고친 출력. */
        const fixed = copy === null ? output : { ...output, evidence: output.evidence.map((item) => (item.repository === copy ? { ...item, repository: input.repository } : item)) };
        /** 근거 검사의 결과. */
        const checked = await this.checkedEvidence(diagnosis, fixed, input.repository, request);
        if (checked.kind === 'rejected') return checked;
        if (copy === null || !isReproducingOutput(fixed)) {
          return {
            kind: 'passed',
            fixes: checked.fixes,
            next: {
              kind: 'save',
              result: {
                ...reportBody(fixed, checked.evidence),
                reproduction: { result: 'impossible', impossibleReason: 'env-failed', method: COPY_FAILED_METHOD, steps: [] },
                attachments: [],
                omittedAttachments: 0,
                attachmentChange: { kind: 'replace', staged: null },
                ...input.base,
              },
            },
          };
        }
        // 사본을 지우기 전에 허용한 종류와 한도 안의 첨부를 옮겨 둔다. 진단 폴더에는 보고서를 저장할 때 넣는다.
        if (session.staged !== null) await reproduction.attachments.discard(session.staged);
        session.staged = await reproduction.attachments.createStaging();
        /** 옮긴 첨부. */
        const staged = await stageReproductionAttachments({
          copyRoot: copy,
          paths: fixed.reproduction.attachments,
          stagingDir: session.staged,
          secretPatterns: request.secretPatterns,
        });
        /** 에이전트가 쓴 재현 칸. 첨부 경로는 사본 안 경로라 보고서에 남기지 않는다. */
        const agentReproduction = { result: fixed.reproduction.result, impossibleReason: fixed.reproduction.impossibleReason, method: fixed.reproduction.method, steps: fixed.reproduction.steps };
        return {
          kind: 'passed',
          fixes: checked.fixes,
          next: {
            kind: 'save',
            result: {
              ...reportBody(fixed, checked.evidence),
              reproduction: agentReproduction,
              attachments: staged.attachments,
              omittedAttachments: staged.omitted,
              attachmentChange: { kind: 'replace', staged: staged.attachments.length > 0 ? session.staged : null },
              ...input.base,
              run: { ...input.base.run, mcpServers: mcpRunInfo(request.reproduction?.mcp ?? null, report.mcpFailedServers ?? []) },
            },
          },
        };
      },
      release: async () => {
        this.reproducingNow.delete(diagnosis.id);
        // 프로세스는 실행기가 이미 끝냈다. 새로 켠 시뮬레이터를 끄고 끝나기를 기다린 뒤에 다음 재현 진단이 시작한다. 사본 삭제는 기다리지 않는다.
        dropCopy();
        if (session.devicesBefore !== null) {
          await reproduction.devices.shutDownNew(session.devicesBefore).catch((error: unknown) =>
            this.options.logger.warn('sentry-adapter.devices-shutdown-failed', { diagnosisId: diagnosis.id, ...errorKind(error) }),
          );
        }
        // 보고서를 저장했으면 이미 진단 폴더로 넣어 없는 폴더다.
        if (session.staged !== null) await reproduction.attachments.discard(session.staged);
      },
    };
  }

  /** 읽기 전용 진단의 실행 요청. 비밀 파일 패턴은 실행마다 설정에서 새로 읽는다. */
  private async readOnlyRequest(input: DiagnosisRunInput, model: string | null) {
    /** 지금 설정. */
    const settings = await this.options.settingsStore.load();
    return {
      instructions: readOnlyDiagnosisInstructions(input.base.event.missingData, input.instructionContext),
      input: input.document(null),
      outputSchema: readOnlyDiagnosisSchema(),
      readRoots: [input.repository],
      secretPatterns: [...settings.extraSecretPatterns],
      model,
      timeoutMs: DIAGNOSIS_TIMEOUT_MS,
    };
  }

  /** Flow 초안과 같은 근거 위치 검사와 비밀 파일 근거 검사. 비밀 파일을 근거로 들면 결과 전체를 버린다. */
  private async checkedEvidence(diagnosis: SentryDiagnosis, output: DiagnosisOutput, repository: string, request: TargetRunRequest) {
    /** 근거 검사의 결과. */
    const check = await checkEvidence(output.evidence, { repositories: [repository], secretPatterns: withDefaultSecretPatterns(request.secretPatterns) });
    if (check.kind === 'secret-evidence') {
      this.options.logger.warn('sentry-adapter.secret-evidence', { diagnosisId: diagnosis.id });
      return { kind: 'rejected' as const, fixes: check.fixes, reason: 'secret-evidence' as const };
    }
    return { kind: 'checked' as const, fixes: check.fixes, evidence: check.evidence };
  }

  /** 실행 정보를 채운다. 에이전트와 버전은 마지막 실행, 걸린 시간은 이번 생성의 첫 실행 시작부터 마지막 실행 끝까지다. */
  private runInfo(base: PendingDiagnosisReport['run'], runs: readonly RunRecord[]): DiagnosisRunInfo {
    /** 이번 생성의 첫 실행. 결과를 저장할 때는 실행이 하나 이상 있다. */
    const first = runs[0];
    /** 이번 생성의 마지막 실행. 결과를 낸 실행이다. */
    const last = runs.at(-1);
    return {
      ...base,
      agent: last?.agent ?? 'claude-code',
      cliVersion: last?.cliVersion ?? null,
      durationMs: first && last ? Math.max(0, last.finishedAt - first.startedAt) : 0,
      createdAt: this.options.clock.now(),
    };
  }
}

/** 준비가 정해 실행에 넘기는 것. */
interface DiagnosisRunInput {
  /** 원본 저장소(절대 경로). 근거의 저장소다. */
  repository: string;
  /** 입력 문서를 쓴다. 재현하는 진단은 사본 경로를 넘긴다. */
  document: (workspace: string | null) => string;
  /** 지침에 더할 구획. */
  instructionContext: DiagnosisInstructionContext;
  /** 앱이 채우는 칸. */
  base: Pick<PendingDiagnosisReport, 'event' | 'run' | 'priorDiagnosis'>;
}

/** 에이전트가 쓴 보고서 칸. 근거는 위치를 확인한 것이다. */
function reportBody(output: DiagnosisOutput, evidence: DiagnosisReport['evidence']): Pick<DiagnosisReport, 'summary' | 'cause' | 'improvements' | 'openQuestions' | 'evidence'> {
  return { summary: output.summary, cause: output.cause, improvements: output.improvements, openQuestions: output.openQuestions, evidence };
}

/** 로그에 남길 오류 이름과 코드. 오류 문장에는 경로가 들 수 있어 남기지 않는다. */
function errorKind(error: unknown): Pick<LogFields, 'errorName' | 'errorCode'> {
  /** 오류 칸. */
  const fields = errorFields(error);
  return { errorName: fields.errorName ?? null, errorCode: fields.errorCode ?? null };
}

/** 실행 정보에 적을 MCP 서버. 연결하지 못한 서버는 실린 서버에서 빼고 "연결 실패"로 적는다. */
function mcpRunInfo(mcp: ReproductionMcp | null, failed: readonly string[]): DiagnosisMcpServers {
  /** 실은 서버 이름. */
  const servers = (mcp?.servers ?? []).map((server) => server.name);
  return {
    loaded: servers.filter((name) => !failed.includes(name)),
    skipped: [...(mcp?.skipped ?? []), ...servers.filter((name) => failed.includes(name)).map((name) => ({ name, reason: 'connection-failed' as const }))],
  };
}

/** 재현 칸이 있는 출력인지 본다. */
function isReproducingOutput(output: DiagnosisOutput | ReproducingDiagnosisOutput): output is ReproducingDiagnosisOutput {
  return 'reproduction' in output;
}

/** 재현하는 진단의 구조화 출력을 읽는다. 스키마 모양이 아니면 구조 실패다. */
function readReproducingReading(output: unknown): RunReading<ReproducingDiagnosisOutput> {
  /** 앱이 읽은 출력. */
  const read = readReproducingDiagnosisOutput(output);
  return read ? { kind: 'output', output: read } : { kind: 'failed', reason: 'invalid-output', detail: '구조화 출력이 재현하는 진단 스키마 모양이 아닙니다.' };
}

/** 진단 실행의 구조화 출력을 읽는다. 스키마 모양이 아니면 구조 실패다. */
function readDiagnosisReading(output: unknown): RunReading<DiagnosisOutput> {
  /** 앱이 읽은 출력. */
  const read = readDiagnosisOutput(output);
  return read ? { kind: 'output', output: read } : { kind: 'failed', reason: 'invalid-output', detail: '구조화 출력이 진단 실행 스키마 모양이 아닙니다.' };
}
