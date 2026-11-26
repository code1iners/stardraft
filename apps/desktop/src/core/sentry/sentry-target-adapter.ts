import { DIAGNOSING_STEP, FETCHING_SENTRY_EVENT_STEP } from '../agent/progress-steps';
import { withDefaultSecretPatterns } from '../agent/secret-patterns';
import { checkEvidence } from '../drafts/draft-check';
import type { RunRecord } from '../generation/generation-run';
import type { Preparation, PrepareContext, RunReading, TargetAdapter, TargetFailure, TargetRun } from '../generation/target-adapter';
import type { Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { ConnectSentry, SentryApiFailure } from '../ports/sentry-api';
import type { SettingsStore } from '../ports/settings-store';
import type { RepoGitState } from '../repos/repo-git-state';
import {
  DIAGNOSIS_TIMEOUT_MS,
  diagnosisInputDocument,
  eventFacts,
  readDiagnosisOutput,
  readOnlyDiagnosisInstructions,
  readOnlyDiagnosisSchema,
  type DiagnosisOutput,
} from './diagnosis-run';
import type { SentryConnection } from './sentry-connection';
import type { SentryDiagnoses } from './sentry-diagnoses';
import type { DiagnosisRepoCheck, DiagnosisReport, DiagnosisRunInfo, SentryDiagnosis } from './sentry-diagnosis';
import type { SentryProjects } from './sentry-projects';

/** Sentry 진단의 대상 종류. 생성 대기열 표에 남는 값이라 바꾸지 않는다. */
export const SENTRY_TARGET_KIND = 'sentry';

/** Sentry에 닿지 못해(네트워크 오류, 서버 오류) 멈춘 Sentry 어댑터가 다시 준비하기까지 기다리는 시간(밀리초). */
const SENTRY_RETRY_DELAY_MS = 60_000;
/** 요청 한도에 걸려 멈춘 Sentry 어댑터가 기다리는 가장 짧은 시간(밀리초). */
const MIN_SENTRY_RETRY_DELAY_MS = 1_000;
/** 오류 이슈를 볼 수 없게 됐을 때(`403`, 조직 목록에서 사라짐) 다시 준비하기까지 기다리는 시간(밀리초). 감지 폴링 주기와 같다. */
const SENTRY_ACCESS_RETRY_DELAY_MS = 5 * 60_000;

/** 결과를 저장할 때 실행 기록으로 채울 칸을 뺀 보고서. 실행 정보의 에이전트·버전·걸린 시간·생성 시각은 저장할 때 채운다. */
export type PendingDiagnosisReport = Omit<DiagnosisReport, 'run'> & {
  /** 준비할 때 정한 실행 정보. */
  run: Pick<DiagnosisRunInfo, 'repository' | 'headCommit' | 'uncommittedChanges' | 'reproductionAllowed'>;
};

/**
 * Sentry 어댑터의 타입 묶음. 시작 표식은 진단을 감지한 시각, 결과는 실행 정보를 채우기 전의 보고서,
 * 저장소 대기는 저장소 대기 사유다. 실행 전에 남기는 어댑터 고유의 실패 사유는 없다.
 */
export interface SentryTargetTypes {
  /** 진단을 감지한 시각. */
  job: number;
  /** 실행 정보를 채우기 전의 보고서. */
  result: PendingDiagnosisReport;
  /** 저장소 대기 사유. */
  repoWait: DiagnosisRepoCheck;
  /** 실행 전 실패 사유. 없다. */
  failureReason: never;
}

/** Sentry 어댑터에 필요한 것. */
export interface SentryTargetAdapterOptions {
  /** 진단을 찾고 결과를 맡길 진단 목록. */
  diagnoses: SentryDiagnoses;
  /** 진단할 프로젝트의 저장소와 조직을 정한다. */
  projects: Pick<SentryProjects, 'resolveRepo' | 'organizationFor'>;
  /** Sentry 토큰과 "토큰 확인 필요". 토큰 문제는 Sentry 어댑터만 멈춘다. */
  connection: Pick<SentryConnection, 'token' | 'state' | 'reportApiFailure' | 'onChange'>;
  /** 토큰 하나로 Sentry API를 부르는 클라이언트를 만든다. */
  connectSentry: ConnectSentry;
  /** 추가 비밀 파일 패턴을 읽는 설정 저장소. 실행마다 새로 읽는다. 사용자 추가 지침은 진단에 붙이지 않는다. */
  settingsStore: SettingsStore;
  /** 저장소의 HEAD 해시와 커밋하지 않은 변경 유무를 읽는다. */
  repoState: (repository: string) => Promise<RepoGitState>;
  /** 보고서를 만든 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. 오류 제목과 경로는 남기지 않는다. */
  logger: Logger;
}

/**
 * Sentry 어댑터. 생성 대기열에서 Sentry 진단을 맡는다. 감지된 진단은 `auto` 칸에, [다시 시도]한 진단은 `user` 칸에 선다.
 * 준비는 저장소 확인 → 시작 직전 오류 이슈 상태 확인 → 최신 이벤트 받기 → 저장소 git 상태 읽기 순서다.
 * 해결·보관·삭제·병합된 오류 이슈는 조용히 빼고, Sentry에 닿지 못하거나 토큰이 거부되면 진단을 실패로 두지 않고 Sentry 어댑터만 멈춘다.
 * 지금은 모든 진단이 읽기 전용 진단으로 돈다(재현은 재현 허용이 생긴 뒤에 더한다).
 */
export class SentryTargetAdapter implements TargetAdapter<SentryTargetTypes> {
  /** Sentry 진단의 대상 종류. */
  readonly kind = SENTRY_TARGET_KIND;
  /** 준비하는 동안 보일 진행 단계. */
  readonly preparingStep = FETCHING_SENTRY_EVENT_STEP;

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

  begin(id: number): number | null {
    /** 실행할 진단. */
    const diagnosis = this.options.diagnoses.get(id);
    return diagnosis?.status === 'queued' ? diagnosis.detectedAt : null;
  }

  isGenerating(id: number, detectedAt: number | null): boolean {
    /** 지금 진단. */
    const diagnosis = this.options.diagnoses.get(id);
    return diagnosis?.status === 'queued' && (detectedAt === null || diagnosis.detectedAt === detectedAt);
  }

  async prepare(id: number, _detectedAt: number, context: PrepareContext): Promise<Preparation<SentryTargetTypes>> {
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
    /** 부를 조직. 조직 목록에 없으면 부를 주소를 모르므로 감지 주기만큼 기다렸다가 다시 본다. */
    const organization = this.options.projects.organizationFor(diagnosis.projectId);
    if (organization === null) {
      this.options.logger.warn('sentry-adapter.organization-missing', { diagnosisId: id });
      return { kind: 'retry-later', afterMs: SENTRY_ACCESS_RETRY_DELAY_MS };
    }
    /** 이 토큰으로 부르는 Sentry API. */
    const api = this.options.connectSentry(token);

    // 시작 직전 확인: 그사이 해결·보관·삭제·병합됐으면 진단하지 않는다. 실행 중에는 다시 보지 않는다.
    /** 오류 이슈 상태. */
    const state = await api.errorIssueState(organization, diagnosis.issueId);
    if (context.stopped()) return { kind: 'skipped' };
    if (!state.ok) return this.unavailable(id, token, state.failure);
    if (state.value.status !== 'unresolved') {
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
    return {
      kind: 'ready',
      next: {
        kind: 'run',
        run: this.readOnlyRun(diagnosis, {
          repository: repo.path,
          document: diagnosisInputDocument({ repository: repo.path, issue: diagnosis.issue, origin: diagnosis.origin, event: event.value, facts }),
          base: {
            event: facts,
            run: { repository: repo.path, headCommit: git.headCommit, uncommittedChanges: git.uncommittedChanges, reproductionAllowed: false },
          },
        }),
      },
    };
  }

  async save(id: number, _detectedAt: number, pending: PendingDiagnosisReport, runs: readonly RunRecord[]): Promise<boolean> {
    return this.options.diagnoses.saveReport(id, { ...pending, run: this.runInfo(pending.run, runs) }, runs);
  }

  async fail(id: number, _detectedAt: number | null, failure: TargetFailure<never>, runs: readonly RunRecord[]): Promise<boolean> {
    return this.options.diagnoses.markFailed(id, failure, runs);
  }

  async needsRepoCheck(id: number, _detectedAt: number, repoCheck: DiagnosisRepoCheck, runs: readonly RunRecord[]): Promise<boolean> {
    return this.options.diagnoses.markRepoWaiting(id, repoCheck, runs);
  }

  async addRuns(id: number, runs: readonly RunRecord[]): Promise<void> {
    await this.options.diagnoses.addRuns(id, runs);
  }

  /** 쓸 수 있는 토큰. 토큰이 없거나 "토큰 확인 필요"면 `null`. */
  private usableToken(): string | null {
    return this.options.connection.state().problem === null ? this.options.connection.token() : null;
  }

  /**
   * 시작 직전 확인이나 이벤트 받기가 실패했다. 지워진 오류 이슈(`404`)는 조용히 빼고, 나머지는 진단 실패로 두지 않고 Sentry 어댑터만 멈춘다.
   * 토큰 거부(`401`)는 "토큰 확인 필요"를 올리고 토큰이 바뀔 때까지, 한도는 초기화 시각까지, 나머지는 잠시 기다렸다가 다시 준비한다.
   * `403`은 등록할 때 `event:read`를 확인했으므로 감지처럼 그 프로젝트를 볼 수 없게 된 것으로 보고 감지 주기만큼 기다린다.
   */
  private async unavailable(id: number, token: string, failure: SentryApiFailure): Promise<Preparation<SentryTargetTypes>> {
    this.options.logger.warn('sentry-adapter.sentry-unavailable', { diagnosisId: id, failure: failure.kind });
    switch (failure.kind) {
      case 'not-found':
        await this.options.diagnoses.dropBeforeStart(id, 'deleted');
        return { kind: 'skipped' };
      case 'unauthorized':
        this.options.connection.reportApiFailure(token, failure);
        return { kind: 'adapter-paused' };
      case 'forbidden':
        return { kind: 'retry-later', afterMs: SENTRY_ACCESS_RETRY_DELAY_MS };
      case 'rate-limited':
        return {
          kind: 'retry-later',
          afterMs: Math.max(failure.resetAt === undefined ? SENTRY_RETRY_DELAY_MS : failure.resetAt - this.options.clock.now(), MIN_SENTRY_RETRY_DELAY_MS),
        };
      case 'network':
      case 'http':
      case 'unexpected-response':
        return { kind: 'retry-later', afterMs: SENTRY_RETRY_DELAY_MS };
    }
  }

  /**
   * 읽기 전용 진단 실행. 지금의 초안 실행과 같은 읽기 전용 경계로 돈다(MCP 없음, 묻지 않고 20분에 끊음).
   * 비밀 파일 패턴은 실행마다 설정에서 새로 읽는다. 받은 결과는 Flow 초안과 같은 근거 위치 검사와 비밀 파일 근거 검사를 거치고,
   * 재현 칸은 에이전트가 답할 수 없으므로 앱이 "불가(허용 안 됨)"로 채운다.
   */
  private readOnlyRun(
    diagnosis: SentryDiagnosis,
    input: { repository: string; document: string; base: Pick<PendingDiagnosisReport, 'event' | 'run'> },
  ): TargetRun<SentryTargetTypes, DiagnosisOutput> {
    return {
      kind: 'diagnosis',
      step: DIAGNOSING_STEP,
      omittedContextItems: 0,
      request: async (model) => {
        /** 지금 설정. */
        const settings = await this.options.settingsStore.load();
        return {
          instructions: readOnlyDiagnosisInstructions(input.base.event.missingData),
          input: input.document,
          outputSchema: readOnlyDiagnosisSchema(),
          readRoots: [input.repository],
          secretPatterns: [...settings.extraSecretPatterns],
          model,
          timeoutMs: DIAGNOSIS_TIMEOUT_MS,
        };
      },
      read: readDiagnosisReading,
      check: async (output, request) => {
        /** 근거 검사의 결과. */
        const check = await checkEvidence(output.evidence, {
          repositories: [input.repository],
          secretPatterns: withDefaultSecretPatterns(request.secretPatterns),
        });
        if (check.kind === 'secret-evidence') {
          this.options.logger.warn('sentry-adapter.secret-evidence', { diagnosisId: diagnosis.id });
          return { kind: 'rejected', fixes: check.fixes, reason: 'secret-evidence' };
        }
        return {
          kind: 'passed',
          fixes: check.fixes,
          next: {
            kind: 'save',
            result: {
              summary: output.summary,
              reproduction: { result: 'impossible', impossibleReason: 'not-allowed', method: '', steps: [] },
              cause: output.cause,
              improvements: output.improvements,
              openQuestions: output.openQuestions,
              evidence: check.evidence,
              ...input.base,
            },
          },
        };
      },
    };
  }

  /** 실행 정보를 채운다. 에이전트와 버전은 마지막 실행, 걸린 시간은 이번 생성의 첫 실행 시작부터 마지막 실행 끝까지다. */
  private runInfo(base: PendingDiagnosisReport['run'], runs: readonly RunRecord[]): DiagnosisRunInfo {
    /** 첫 실행과 마지막 실행. 결과를 저장할 때는 실행이 하나 이상 있다. */
    const first = runs[0];
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

/** 진단 실행의 구조화 출력을 읽는다. 스키마 모양이 아니면 구조 실패다. */
function readDiagnosisReading(output: unknown): RunReading<DiagnosisOutput> {
  /** 앱이 읽은 출력. */
  const read = readDiagnosisOutput(output);
  return read ? { kind: 'output', output: read } : { kind: 'failed', reason: 'invalid-output', detail: '구조화 출력이 진단 실행 스키마 모양이 아닙니다.' };
}
