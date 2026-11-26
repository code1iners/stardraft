import type { RunRecord } from '../generation/generation-run';
import { errorFields, type Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { AppNotification, Notifier } from '../ports/notifier';
import type { SentryErrorIssue, SentryIssueStatus } from '../ports/sentry-api';
import type { SentryProjectRegistration } from '../ports/settings-store';
import type { SentryStore } from '../ports/sentry-store';
import { SerialQueue } from '../serial-queue';
import {
  absorbsRegression,
  isRepoWaiting,
  replacedByRegression,
  STATUSES_REMOVED_ON_UNREGISTER,
  type DetectionKey,
  type DiagnosisExport,
  type DiagnosisFailure,
  type DiagnosisOrigin,
  type DiagnosisReport,
  type DiagnosisRepoCheck,
  type DiagnosisStatus,
  type SentryDiagnosis,
  type UnsavedDiagnosis,
} from './sentry-diagnosis';
import type { SentryRepoResolution } from './sentry-projects';

/** 조회 한 번에서 진단 대상으로 잡힌 오류 이슈. */
export interface DetectedIssue {
  /** 신규인지 재발인지. */
  origin: DiagnosisOrigin;
  /** 목록에서 읽은 오류 이슈. */
  issue: SentryErrorIssue;
  /** 재발이면 재발을 일으킨 이벤트 ID. 신규면 `null`. */
  eventId: string | null;
}

/** 한 프로젝트의 조회 결과. */
export interface ProjectDetection {
  /** 조회한 프로젝트의 등록. 조회하는 동안 등록이 풀렸으면 저장하지 않는다. */
  registration: SentryProjectRegistration;
  /** 새 체크포인트. 조회를 시작한 시각이다. */
  checkpoint: number;
  /** 감지한 시각. */
  detectedAt: number;
  /** 진단 대상으로 잡힌 오류 이슈. 처음 보인 순서다. */
  detected: readonly DetectedIssue[];
}

/** Sentry 진단 목록에 필요한 것. */
export interface SentryDiagnosesOptions {
  /** 진단과 체크포인트, 중복 억제 기록을 두는 저장소. */
  store: SentryStore;
  /** 저장소 대기 OS 알림. */
  notifier: Notifier;
  /** 진단 로그. 오류 제목과 경로는 남기지 않는다. */
  logger: Logger;
  /** 프로젝트의 저장소를 지금 폴더 상태로 정한다. */
  resolveRepo: (projectId: string) => Promise<SentryRepoResolution>;
  /** 조회 결과를 저장하기 직전에 등록이 그대로인지 본다. 없으면 늘 그대로로 본다. */
  isRegistered?: (registration: SentryProjectRegistration) => boolean;
  /** 완료 시각과 완료함의 7일을 읽는 시계. 없으면 시스템 시각이다. */
  clock?: Clock;
  /** 완료하거나 완료함에서 사라질 진단의 첨부 폴더를 지운다. 없으면 지우지 않는다. 폴더가 없어도 실패하지 않아야 한다. */
  removeAttachments?: (diagnosisId: number) => Promise<void>;
}

/** 하루(밀리초). */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 완료한 진단을 목록에 `완료함`으로 남기는 기간. 완료한 때부터 센다. 설정에서 바꿀 수 없다. */
export const COMPLETED_RETENTION_MS = 7 * DAY_MS;

/** 완료함에서 사라질 때가 됐는지 본다. 완료한 지 7일이 된 완료 진단이다. */
function isExpired(diagnosis: Pick<SentryDiagnosis, 'status' | 'completedAt'>, now: number): boolean {
  return diagnosis.status === 'completed' && diagnosis.completedAt !== null && now - diagnosis.completedAt >= COMPLETED_RETENTION_MS;
}

/**
 * Sentry 진단 목록. 감지 결과를 중복 억제 규칙대로 진단으로 만들고, 저장소 대기(저장소 매핑 필요, 저장소 확인 필요)를
 * 프로젝트 단위로 알리고 다시 판정해 재개한다. 진단 실행은 생성 대기열의 Sentry 어댑터가 하고, 그 결과(보고서, 진단 실패,
 * 저장소 대기)와 사용자 행동([다시 시도], [완료])을 이 목록이 저장한다.
 */
export class SentryDiagnoses {
  /** 진단 전부. ID 순서다. */
  private diagnoses: SentryDiagnosis[] = [];
  /** 사용자가 [다시 시도]로 대기가 된 진단 ID. 생성 대기열의 `user` 칸에 선다. 대기를 벗어나면 뺀다. */
  private readonly userRequested = new Set<number>();
  /** 저장과 다시 판정, 등록 해제가 서로 끼어들지 않게 한다. */
  private readonly updates = new SerialQueue();
  /** 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: SentryDiagnosesOptions) {}

  /**
   * 저장된 진단을 읽는다. 앱이 시작할 때 한 번 부른다. 완료함에서 사라질 때가 된 완료 진단은 목록에 올리지 않고 최소 기록만 남긴다
   * (앱이 꺼진 사이 7일이 지난 진단도 여기서 비운다).
   * 표에 없는 진단의 첨부 폴더를 치우는 일은 부르는 쪽이 `ids()`로 한다.
   */
  async load(): Promise<void> {
    await this.updates.run(async () => {
      /** 저장된 진단 전부. */
      const stored = await this.options.store.listDiagnoses();
      /** 지금 시각. */
      const now = this.now();
      this.diagnoses = stored.filter((item) => !isExpired(item, now));
      /** 앱이 꺼진 사이 7일이 지났지만 아직 오류 정보가 남은 완료 진단. 이미 비운 진단은 다시 쓰지 않는다. */
      const unscrubbed = stored.filter((item) => isExpired(item, now) && item.issue.projectName !== '').map((item) => item.id);
      if (unscrubbed.length > 0) await this.options.store.scrubCompleted(unscrubbed);
    });
    this.emit();
  }

  /** 지금 목록에 있는 진단 ID. 표에 없는 진단의 첨부 폴더를 치울 때 쓴다. */
  ids(): number[] {
    return this.diagnoses.map((item) => item.id);
  }

  /** 진단 전부. ID 순서다. */
  list(): SentryDiagnosis[] {
    return structuredClone(this.diagnoses);
  }

  /** 진단 하나. 없으면 `undefined`. */
  get(id: number): SentryDiagnosis | undefined {
    /** 찾은 진단. */
    const diagnosis = this.diagnoses.find((item) => item.id === id);
    return diagnosis && structuredClone(diagnosis);
  }

  /** 생성 대기열에서 차례를 기다려야 하는 진단 ID. 대기(진행 중 포함)인 진단이고, 감지한 순서(ID 순서)다. */
  generatingIds(): number[] {
    return this.diagnoses.filter((item) => item.status === 'queued').map((item) => item.id);
  }

  /** 사용자가 [다시 시도]로 대기가 된 진단인지 본다. */
  requestedByUser(id: number): boolean {
    return this.userRequested.has(id);
  }

  /**
   * 시작 직전 확인에서 오류 이슈가 해결·보관·삭제·병합됐으면 진단을 조용히 뺀다. 화면에 남기지 않고 로그에만 적는다.
   * 중복 억제 기록은 남겨, 같은 신규나 재발을 다시 진단하지 않는다. 그사이 대기가 아니게 되었으면 그대로 둔다.
   */
  async dropBeforeStart(id: number, status: Exclude<SentryIssueStatus, 'unresolved'>): Promise<void> {
    /** 뺐는지 여부. */
    const dropped = await this.updates.run(async () => {
      if (this.find(id)?.status !== 'queued') return false;
      await this.options.store.removeDiagnosis(id);
      this.diagnoses = this.diagnoses.filter((item) => item.id !== id);
      this.userRequested.delete(id);
      return true;
    });
    if (!dropped) return;
    this.options.logger.info('sentry-diagnoses.dropped-before-start', { diagnosisId: id, issueStatus: status });
    this.emit();
  }

  /** 보고서를 저장해 검토 대기로 둔다. 그사이 대기가 아니게 되었으면(취소, 등록 해제) 저장하지 않고 거짓이다. */
  async saveReport(id: number, report: DiagnosisReport, runs: readonly RunRecord[]): Promise<boolean> {
    /** 알릴 진단. 저장하지 못했으면 `null`. */
    let announce: SentryDiagnosis | null = null;
    /** 저장했는지 여부. */
    const saved = await this.change(id, (diagnosis) => {
      if (diagnosis.status !== 'queued') return false;
      Object.assign(diagnosis, { status: 'ready', report, failure: null, runs: [...diagnosis.runs, ...runs] });
      announce = structuredClone(diagnosis);
      return true;
    });
    if (saved && announce) this.options.notifier.notify(reportReadyNotification(announce));
    return saved;
  }

  /**
   * 진단 실패로 둔다. 재시도 뒤에도 실패했거나 취소한 진단이고 자동으로 더 재시도하지 않는다.
   * 그사이 대기가 아니게 되었으면 기록하지 않고 거짓이다.
   */
  async markFailed(id: number, failure: DiagnosisFailure, runs: readonly RunRecord[]): Promise<boolean> {
    return this.change(id, (diagnosis) => {
      if (diagnosis.status !== 'queued') return false;
      Object.assign(diagnosis, { status: 'failed', failure, runs: [...diagnosis.runs, ...runs] });
      return true;
    });
  }

  /**
   * 기다리는 사이 매핑이나 폴더가 사라져 실행하지 못한 진단을 저장소 대기로 둔다. 그 Sentry 프로젝트에 기다리던 진단이 없었으면 Sentry 프로젝트 단위로 알린다.
   * 그사이 대기가 아니게 되었으면 거짓이다.
   */
  async markRepoWaiting(id: number, repoCheck: DiagnosisRepoCheck, runs: readonly RunRecord[]): Promise<boolean> {
    /** 알릴 진단. 이미 기다리던 프로젝트면 `null`. */
    let announce: SentryDiagnosis | null = null;
    /** 기록했는지 여부. */
    const recorded = await this.change(id, (diagnosis) => {
      if (diagnosis.status !== 'queued') return false;
      /** 이 프로젝트가 이미 저장소 대기였는지 여부. */
      const alreadyWaiting = this.diagnoses.some((item) => item.projectId === diagnosis.projectId && isRepoWaiting(item));
      Object.assign(diagnosis, { status: 'repo-check-needed', repoCheck, runs: [...diagnosis.runs, ...runs] });
      if (!alreadyWaiting) announce = structuredClone(diagnosis);
      return true;
    });
    if (announce) this.announceRepoWait([announce]);
    return recorded;
  }

  /** 진단을 그대로 두고 실행 기록만 더한다. */
  async addRuns(id: number, runs: readonly RunRecord[]): Promise<void> {
    if (runs.length === 0) return;
    await this.change(id, (diagnosis) => {
      diagnosis.runs = [...diagnosis.runs, ...runs];
      return true;
    });
  }

  /** 진단 실패를 [다시 시도]한다. 대기가 되고 사용자 요청이라 생성 대기열의 `user` 칸에 선다. */
  async retry(id: number): Promise<void> {
    await this.change(
      id,
      (diagnosis) => {
        if (diagnosis.status !== 'failed') return false;
        Object.assign(diagnosis, { status: 'queued', failure: null });
        return true;
      },
      { requestedByUser: true },
    );
  }

  /**
   * 보고서를 내보낸 기록을 남긴다. 검토 대기 보고서가 대상이고, 몇 번이든 부를 수 있으며 상태는 바꾸지 않는다.
   * 그사이 완료하거나 보고서가 없어졌으면 기록하지 않고 거짓이다. 이미 내보낸 파일은 그대로 남는다.
   */
  async recordExport(id: number, exported: DiagnosisExport): Promise<boolean> {
    return this.change(id, (diagnosis) => {
      if (diagnosis.status !== 'ready' || diagnosis.report === null) return false;
      diagnosis.lastExport = exported;
      return true;
    });
  }

  /**
   * 진단을 완료한다. 진단 실패와 검토 대기 보고서가 대상이다. 최소 기록(오류 이슈 ID, 재발 식별자, 완료 시각)만 남기고
   * 보고서·실패·실행 기록과 첨부 폴더를 지운다. 완료한 진단은 7일 동안 `완료함`으로 목록에 남는다.
   * Sentry에는 아무 요청도 보내지 않고 되돌릴 수 없다. 대기·진행 중(다시 진단 포함)이거나 이미 완료한 진단이면 아무것도 하지 않는다.
   * 지금 보이는 보고서를 내보냈는지 묻는 확인은 부르는 쪽(내보내기 단계)이 거친다.
   */
  async complete(id: number): Promise<void> {
    /** 완료 시각. */
    const now = this.now();
    /** 완료했는지 여부. */
    const completed = await this.change(id, (diagnosis) => {
      if (diagnosis.status !== 'failed' && diagnosis.status !== 'ready') return false;
      Object.assign(diagnosis, { status: 'completed', report: null, failure: null, runs: [], completedAt: now });
      return true;
    });
    if (completed) await this.removeAttachmentsOf(id);
  }

  /**
   * 완료한 지 7일이 된 진단을 목록에서 빼고 최소 기록만 남긴다(첨부 폴더도 지운다). 앱을 켤 때와 하루에 한 번, 잠자기에서 깰 때 부른다.
   * 프로젝트 등록을 풀어도 완료 진단은 남으므로 프로젝트와 무관하게 센다. 뺀 진단 수를 돌려준다.
   */
  async archiveExpired(): Promise<number> {
    /** 목록에서 뺀 진단 ID. */
    const expired = await this.updates.run(async () => {
      /** 지금 시각. */
      const now = this.now();
      /** 사라질 진단 ID. */
      const ids = this.diagnoses.filter((item) => isExpired(item, now)).map((item) => item.id);
      if (ids.length === 0) return ids;
      await this.options.store.scrubCompleted(ids);
      this.diagnoses = this.diagnoses.filter((item) => !ids.includes(item.id));
      return ids;
    });
    for (const id of expired) await this.removeAttachmentsOf(id);
    if (expired.length > 0) {
      this.options.logger.info('sentry-diagnoses.archived', { count: expired.length });
      this.emit();
    }
    return expired.length;
  }

  /** 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 프로젝트의 감지 체크포인트. 아직 조회에 성공한 적 없으면 `null`. */
  checkpoint(projectId: string): Promise<number | null> {
    return this.options.store.getCheckpoint(projectId);
  }

  /**
   * 한 프로젝트의 조회 결과를 저장한다. 이미 기록한 중복 억제 키는 건너뛰고, 같은 오류 이슈의 진단이 대기나 저장소 대기로 있으면
   * 새 진단을 만들지 않고 키만 기록한다. 새 진단은 지금 저장소 상태에 따라 대기나 저장소 대기가 된다.
   * 체크포인트, 키, 진단은 한 트랜잭션으로 저장한다. 조회하는 사이에 등록이 풀렸으면 아무것도 저장하지 않는다.
   */
  async record({ registration, checkpoint, detectedAt, detected }: ProjectDetection): Promise<void> {
    /** 새로 저장소 대기가 된 진단. */
    const waiting = await this.updates.run(async (): Promise<SentryDiagnosis[] | null> => {
      if (this.options.isRegistered && !this.options.isRegistered(registration)) return null;
      /** 기록할 키. */
      const keys: DetectionKey[] = [];
      /** 만들 진단. */
      const created: UnsavedDiagnosis[] = [];
      /** 새 진단에 자리를 내주고 지울 진단 실패. */
      const replaced: number[] = [];
      /** 이 프로젝트의 저장소. 진단을 만들 때만 확인한다. */
      let repo: SentryRepoResolution | null = null;
      for (const { origin, issue, eventId } of detected) {
        /** 이 오류 이슈의 중복 억제 키. */
        const key: DetectionKey = { issueId: issue.id, eventId: origin === 'new' ? null : eventId };
        if (keys.some((item) => sameKey(item, key)) || (await this.options.store.hasDetectionKey(key))) continue;
        keys.push(key);
        /** 같은 오류 이슈의 진단 가운데 새 재발을 흡수하는 것. 이번 조회에서 만든 것도 본다. */
        const absorbing = [...this.diagnoses, ...created].some((item) => item.issueId === issue.id && absorbsRegression(item.status));
        if (absorbing) continue;
        // 진단 실패가 남은 오류 이슈면 그 실패를 새 진단으로 바꾼다. 새 진단은 끝에 서서 `auto` 칸에 들어간다.
        for (const item of this.diagnoses) if (item.issueId === issue.id && replacedByRegression(item.status) && !replaced.includes(item.id)) replaced.push(item.id);
        repo ??= await this.options.resolveRepo(registration.projectId);
        created.push({
          projectId: registration.projectId,
          issueId: issue.id,
          origin,
          regressionEventId: origin === 'regression' ? eventId : null,
          detectedAt,
          ...statusOf(repo),
          issue: {
            shortId: issue.shortId,
            title: issue.title,
            culprit: issue.culprit,
            level: issue.level,
            environment: registration.environment,
            firstSeen: issue.firstSeen,
            lastSeen: issue.lastSeen,
            count: issue.count,
            userCount: issue.userCount,
            permalink: issue.permalink,
            platform: issue.platform,
            organizationName: registration.organizationName,
            projectName: registration.projectName,
          },
        });
      }
      /** 저장한 진단. */
      const saved = await this.options.store.recordDetection({ projectId: registration.projectId, checkpoint, keys, diagnoses: created, replaced });
      /** 이 프로젝트가 저장 전에 이미 저장소 대기였는지 여부. 그렇다면 이미 알렸다. */
      const alreadyWaiting = this.diagnoses.some((item) => item.projectId === registration.projectId && isRepoWaiting(item));
      this.diagnoses = [...this.diagnoses.filter((item) => !replaced.includes(item.id)), ...saved];
      if (replaced.length > 0) this.options.logger.info('sentry-diagnoses.failed-replaced', { count: replaced.length });
      if (saved.length > 0) this.options.logger.info('sentry-diagnoses.detected', { count: saved.length, absorbed: keys.length - saved.length });
      return alreadyWaiting ? [] : saved.filter(isRepoWaiting);
    });
    if (waiting === null) return;
    this.announceRepoWait(waiting);
    this.emit();
  }

  /**
   * 저장소 대기 진단의 저장소를 다시 판정한다. 매핑이 생겼고 폴더가 있으면 대기가 되고, 사유가 바뀌면 사유만 바꾼다.
   * 앱을 켤 때, 매핑이 바뀔 때, 절전에서 깰 때, 저장소 확인 필요가 있는 동안 60초마다 부른다. 대기가 된 진단 수를 돌려준다.
   */
  async resumeRepoWaiting(): Promise<number> {
    /** 대기가 된 진단 수. */
    const resumed = await this.updates.run(async () => {
      /** 프로젝트마다 다시 정한 저장소. */
      const repos = new Map<string, SentryRepoResolution>();
      /** 대기가 된 수. */
      let count = 0;
      /** 바뀐 것이 있는지 여부. */
      let changed = false;
      for (const diagnosis of this.diagnoses) {
        if (!isRepoWaiting(diagnosis)) continue;
        if (!repos.has(diagnosis.projectId)) repos.set(diagnosis.projectId, await this.options.resolveRepo(diagnosis.projectId));
        /** 다시 정한 상태. */
        const next = statusOf(repos.get(diagnosis.projectId)!);
        if (next.status === diagnosis.status && JSON.stringify(next.repoCheck) === JSON.stringify(diagnosis.repoCheck)) continue;
        await this.options.store.setDiagnosisStatus(diagnosis.id, next.status, next.repoCheck);
        if (next.status !== 'queued') this.userRequested.delete(diagnosis.id);
        diagnosis.status = next.status;
        diagnosis.repoCheck = next.repoCheck;
        changed = true;
        if (next.status === 'queued') count += 1;
      }
      return { count, changed };
    });
    if (resumed.changed) this.emit();
    return resumed.count;
  }

  /** 저장소 확인 필요(폴더 없음)로 기다리는 진단이 있는지 본다. 있는 동안 60초마다 다시 판정한다. */
  hasMissingFolderWaiting(): boolean {
    return this.diagnoses.some((item) => isRepoWaiting(item) && item.repoCheck?.kind === 'missing-folder');
  }

  /** 등록을 푼 프로젝트의 체크포인트와 중복 억제 기록을 지우고, 기다리던 진단을 목록에서 조용히 뺀다. */
  async removeProject(projectId: string): Promise<void> {
    /** 뺀 진단 ID. */
    const removed = await this.updates.run(async () => {
      /** 지운 진단 ID. */
      const ids = await this.options.store.removeProject(projectId, STATUSES_REMOVED_ON_UNREGISTER);
      this.diagnoses = this.diagnoses.filter((item) => !ids.includes(item.id));
      for (const id of ids) this.userRequested.delete(id);
      return ids;
    });
    this.options.logger.info('sentry-diagnoses.project-removed', { count: removed.length });
    this.emit();
  }

  /** 트레이 검토 수에 더할 수. 검토 대기 보고서는 건마다, 저장소 대기는 프로젝트마다 1로 센다. */
  reviewCount(): number {
    return this.diagnoses.filter((item) => item.status === 'ready').length + new Set(this.diagnoses.filter(isRepoWaiting).map((item) => item.projectId)).size;
  }

  /** 진단 실패가 있는지 본다. 트레이에 "!"로만 보이고 OS 알림은 없다. */
  hasFailure(): boolean {
    return this.diagnoses.some((item) => item.status === 'failed');
  }

  /** 프로젝트에서 저장소 매핑이 없어 기다리는 진단 수. 설정의 "저장소 매핑 없음 · n건 대기"다. */
  waitingForMapping(projectId: string): number {
    return this.diagnoses.filter((item) => item.projectId === projectId && isRepoWaiting(item) && item.repoCheck?.kind === 'unmapped').length;
  }

  /**
   * 방금 저장소 대기가 된 진단을 프로젝트 단위로 알린다. 부르는 쪽이 그 프로젝트에 이미 기다리던 진단이 없을 때만 넘긴다.
   * 알림을 누르면 그 프로젝트의 첫 건을 연다. 본문에는 프로젝트 이름만 넣고 오류 제목은 넣지 않는다.
   */
  private announceRepoWait(waiting: readonly SentryDiagnosis[]): void {
    /** 프로젝트마다 첫 건. */
    const firsts = new Map<string, SentryDiagnosis>();
    for (const diagnosis of waiting) if (!firsts.has(diagnosis.projectId)) firsts.set(diagnosis.projectId, diagnosis);
    for (const first of firsts.values()) this.options.notifier.notify(repoWaitNotification(first));
  }

  /** 지금 시각. */
  private now(): number {
    return this.options.clock?.now() ?? Date.now();
  }

  /** 진단의 첨부 폴더를 지운다. 실패해도 완료는 되돌리지 않고 로그만 남긴다. 다음 시작 때 표에 없는 폴더로 치워진다. */
  private async removeAttachmentsOf(id: number): Promise<void> {
    try {
      await this.options.removeAttachments?.(id);
    } catch (error) {
      this.options.logger.warn('sentry-diagnoses.attachments-remove-failed', errorFields(error));
    }
  }

  /** 진단 하나. 복사하지 않은 원본이다. */
  private find(id: number): SentryDiagnosis | undefined {
    return this.diagnoses.find((item) => item.id === id);
  }

  /**
   * 진단 하나를 `apply`로 바꿔 저장하고 알린다. `apply`가 거짓이면 바꾸지 않는다. 대기를 벗어나면 사용자 요청 표시를 지우고,
   * `requestedByUser`면 저장한 뒤에 사용자 요청 표시를 단다. 저장하지 못하면 메모리의 진단도 표시도 그대로 둔다.
   */
  private async change(id: number, apply: (diagnosis: SentryDiagnosis) => boolean, { requestedByUser = false } = {}): Promise<boolean> {
    /** 바꿨는지 여부. */
    const changed = await this.updates.run(async () => {
      /** 바꿀 진단. */
      const current = this.find(id);
      if (!current) return false;
      /** 바꾼 사본. 저장에 성공한 뒤에만 원본을 바꾼다. */
      const next = structuredClone(current);
      if (!apply(next)) return false;
      await this.options.store.updateDiagnosis(next);
      Object.assign(current, next);
      if (next.status !== 'queued') this.userRequested.delete(id);
      else if (requestedByUser) this.userRequested.add(id);
      return true;
    });
    if (changed) this.emit();
    return changed;
  }

  /** 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 저장소 상태에 맞는 진단 상태. */
function statusOf(repo: SentryRepoResolution): { status: DiagnosisStatus; repoCheck: DiagnosisRepoCheck | null } {
  if (repo.kind === 'mapped') return { status: 'queued', repoCheck: null };
  return { status: 'repo-check-needed', repoCheck: repo.kind === 'unmapped' ? { kind: 'unmapped' } : { kind: 'missing-folder', path: repo.path } };
}

/** 두 키가 같은지 본다. */
function sameKey(a: DetectionKey, b: DetectionKey): boolean {
  return a.issueId === b.issueId && a.eventId === b.eventId;
}

/** 저장소 대기 OS 알림. 본문에는 프로젝트 이름만 넣는다. */
function repoWaitNotification(first: SentryDiagnosis): AppNotification {
  /** 본문에 쓸 프로젝트 이름. */
  const project = first.issue.projectName || '이 프로젝트';
  /** 알림이 가리키는 첫 건. */
  const target = { kind: 'diagnosis', id: first.id } as const;
  if (first.repoCheck?.kind === 'missing-folder') {
    return { title: '저장소 확인 필요', body: `${project}에 연결한 저장소 폴더를 찾을 수 없습니다. 폴더가 돌아오거나 매핑을 고치면 이어 갑니다.`, target };
  }
  return { title: '저장소 매핑 필요', body: `${project}에 연결한 저장소가 없습니다. 매핑하면 기다리는 오류를 진단합니다.`, target };
}

/** 재현 결과를 알림 본문에 쓰는 말. 불가는 "재현 안 함"이다. */
const REPRODUCTION_RESULT_TEXT = { success: '재현 성공.', failure: '재현 실패.', impossible: '재현 안 함.' } as const;

/** 진단 보고서 준비됨 OS 알림. 본문에는 프로젝트 이름과 재현 결과만 넣고 오류 제목과 메시지는 넣지 않는다. */
function reportReadyNotification(diagnosis: SentryDiagnosis): AppNotification {
  /** 본문에 쓸 프로젝트 이름. */
  const project = diagnosis.issue.projectName || '이 프로젝트';
  /** 재현 결과. 보고서가 없을 수는 없지만 없으면 재현 안 함으로 본다. */
  const result = diagnosis.report?.reproduction.result ?? 'impossible';
  return {
    title: '진단 보고서 준비됨',
    body: `${project}의 오류를 진단했습니다. ${REPRODUCTION_RESULT_TEXT[result]}`,
    target: { kind: 'diagnosis', id: diagnosis.id },
  };
}
