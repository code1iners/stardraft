import { errorFields, type Logger } from '../logging/logger';
import type { CancelScheduled, Clock } from '../ports/clock';
import type { ConnectSentry, SentryApi, SentryApiFailure, SentryIssueFilter, SentryOrganization } from '../ports/sentry-api';
import type { SentryProjectRegistration } from '../ports/settings-store';
import type { DetectedIssue, SentryDiagnoses } from './sentry-diagnoses';
import type { SentryConnectionState } from './sentry-connection';

/** Sentry를 조회하는 주기(밀리초). 설정에서 바꿀 수 없다. */
export const SENTRY_POLL_INTERVAL_MS = 5 * 60_000;
/** 신규를 따라잡는 범위(밀리초). 이보다 앞서 처음 보인 신규는 진단하지 않고 체크포인트만 옮긴다. */
export const SENTRY_CATCH_UP_MS = 7 * 24 * 60 * 60_000;
/** 체크포인트보다 앞에서 겹쳐 조회하는 폭(밀리초). Sentry가 오류 이슈를 늦게 색인해도 놓치지 않게 한다. 겹친 것은 중복 억제 기록이 거른다. */
export const SENTRY_OVERLAP_MS = 10 * 60_000;
/** 한도 초기화 시각이 지금보다 앞이어도 다시 조회하기까지 기다리는 가장 짧은 시간(밀리초). */
const MIN_RETRY_DELAY_MS = 1_000;

/** Sentry 감지에 필요한 것. */
export interface SentryDetectionOptions {
  /** 토큰 하나로 Sentry API를 부르는 클라이언트를 만든다. */
  connectSentry: ConnectSentry;
  /** 지금 쓰는 토큰과 조직, "토큰 확인 필요", 거절 보고를 가진 Sentry 연결. */
  connection: {
    token(): string | null;
    state(): Pick<SentryConnectionState, 'organizations' | 'problem'>;
    reportApiFailure(token: string, failure: SentryApiFailure): void;
  };
  /** 등록한 프로젝트와 그 접근 상태. */
  projects: {
    registrations(): SentryProjectRegistration[];
    reportAccess(projectId: string, access: 'ok' | 'inaccessible'): void;
  };
  /** 감지 결과를 진단으로 만드는 진단 목록. 체크포인트도 여기서 읽는다. */
  diagnoses: Pick<SentryDiagnoses, 'checkpoint' | 'record'>;
  /** 주기와 기준 시각을 재는 시계. */
  clock: Clock;
  /** 진단 로그. 프로젝트 ID와 개수만 남긴다. */
  logger: Logger;
}

/** 프로젝트 하나를 조회한 결과. */
type ProjectOutcome =
  /** 조회했다(진단 대상이 없었을 수도 있다). */
  | { kind: 'done' }
  /** 이 프로젝트만 실패했다. 체크포인트는 옮기지 않는다. 다음 프로젝트로 간다. */
  | { kind: 'failed' }
  /** 토큰이 거부됐다. 이번 조회를 멈춘다. */
  | { kind: 'token-rejected' }
  /** 한도에 걸렸다. 이번 조회를 멈추고 이 시각까지 미룬다. 시각을 모르면 `null`. */
  | { kind: 'rate-limited'; resetAt: number | null };

/**
 * Sentry 감지: 등록한 프로젝트마다 신규와 재발 오류 이슈를 5분마다 조회해 진단 목록에 넣는다.
 * 프로젝트는 하나씩 차례로 부르고, 한 프로젝트의 실패는 다른 프로젝트를 막지 않는다. Flow 감지와는 별개 모듈이다.
 * Sentry의 상태는 바꾸지 않는다(조회만 한다).
 */
export class SentryDetection {
  /** 감지 중인지 여부. */
  private running = false;
  /** 진행 중인 조회. */
  private inFlight: Promise<void> | null = null;
  /** 진행 중인 조회가 끝난 뒤 바로 할 조회. */
  private queued: Promise<void> | null = null;
  /** 예약한 다음 조회를 지우는 함수. */
  private cancelScheduled: CancelScheduled | null = null;
  /** 한도에 걸려 이 시각(Unix epoch 밀리초) 전에는 조회하지 않는다. */
  private notBefore = 0;

  constructor(private readonly options: SentryDetectionOptions) {}

  /**
   * 감지를 시작한다. 바로 조회하고 그 뒤 5분마다 조회한다. 돌려준 약속은 이번 조회가 끝나면 풀린다.
   * 앱을 켤 때, [감지 시작], 토큰을 새로 확인했을 때 부른다.
   */
  start(): Promise<void> {
    this.running = true;
    return this.pollNow();
  }

  /** 지금 바로 조회한다. 절전에서 깼을 때 부른다. 감지 중이 아니면 아무것도 하지 않는다. 한도에 걸린 동안은 앞당기지 않는다. */
  checkNow(): Promise<void> {
    return this.pollNow();
  }

  /** 폴링을 멈춘다. 앱을 끝낼 때 부른다. 진행 중인 조회는 끝까지 간다. */
  stop(): void {
    this.running = false;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  /** 지금 조회한다. 진행 중인 조회가 있으면 그것이 끝난 뒤 한 번 더 조회한다. */
  private pollNow(): Promise<void> {
    if (!this.running) return Promise.resolve();
    /** 한도가 풀리기까지 남은 시간. */
    const wait = this.notBefore - this.options.clock.now();
    if (wait > 0) {
      this.schedule(wait);
      return Promise.resolve();
    }
    if (this.inFlight) {
      this.queued ??= this.inFlight.then(() => {
        this.queued = null;
        return this.pollNow();
      });
      return this.queued;
    }
    this.cancelScheduled?.();
    this.cancelScheduled = null;
    this.inFlight = this.pollAndSchedule().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** 한 번 조회하고 다음 조회를 예약한다. */
  private async pollAndSchedule(): Promise<void> {
    /** 한도 초기화 시각. 한도에 걸리지 않았으면 `undefined`. */
    let resetAt: number | null | undefined;
    try {
      resetAt = await this.poll();
    } catch (error) {
      this.options.logger.error('sentry-detection.poll-failed', errorFields(error));
    }
    if (!this.running) return;
    if (resetAt === undefined) {
      this.schedule(SENTRY_POLL_INTERVAL_MS);
      return;
    }
    // 한도 초기화 시각이 없으면 다음 주기까지 미룬다.
    /** 다시 조회할 때까지의 시간. */
    const delay = resetAt === null ? SENTRY_POLL_INTERVAL_MS : Math.max(MIN_RETRY_DELAY_MS, resetAt - this.options.clock.now());
    this.notBefore = this.options.clock.now() + delay;
    this.schedule(delay);
  }

  /** `delayMs` 뒤에 조회하도록 예약한다. 앞서 예약한 조회는 지운다. */
  private schedule(delayMs: number): void {
    this.cancelScheduled?.();
    this.cancelScheduled = this.options.clock.after(delayMs, () => {
      this.cancelScheduled = null;
      void this.pollNow();
    });
  }

  /** 등록한 프로젝트를 하나씩 조회한다. 한도에 걸리면 한도 초기화 시각(모르면 `null`)을, 아니면 `undefined`를 돌려준다. */
  private async poll(): Promise<number | null | undefined> {
    /** 연결 상태. */
    const { organizations, problem } = this.options.connection.state();
    /** 쓸 토큰. "토큰 확인 필요"인 동안은 부르지 않는다. */
    const token = problem === null ? this.options.connection.token() : null;
    if (token === null) {
      this.options.logger.info('sentry-detection.poll-skipped', { hasToken: this.options.connection.token() !== null, problem });
      return undefined;
    }
    /** 이 토큰으로 부르는 Sentry API. */
    const api = this.options.connectSentry(token);
    for (const registration of this.options.projects.registrations()) {
      /** 프로젝트의 조직. 조직 목록에 없으면 부를 주소를 모른다. */
      const organization = organizations.find((item) => item.id === registration.organizationId);
      if (!organization) {
        this.options.logger.warn('sentry-detection.organization-missing', { projectId: registration.projectId });
        continue;
      }
      /** 이 프로젝트를 조회한 결과. */
      const outcome = await this.pollProject(api, token, organization, registration);
      if (outcome.kind === 'token-rejected') return undefined;
      if (outcome.kind === 'rate-limited') return outcome.resetAt;
    }
    return undefined;
  }

  /** 프로젝트 하나의 신규와 재발을 조회하고, 성공하면 진단 대상과 체크포인트를 함께 저장한다. */
  private async pollProject(api: SentryApi, token: string, organization: SentryOrganization, registration: SentryProjectRegistration): Promise<ProjectOutcome> {
    const { clock, logger } = this.options;
    const { projectId } = registration;
    /** 조회를 시작한 시각. 성공하면 새 체크포인트가 된다. */
    const startedAt = clock.now();
    /** 기준 시각. 이보다 앞선 신규와 재발은 건너뛴다. */
    const baseline = Date.parse(registration.registeredAt);
    /** 체크포인트. 처음 조회하면 기준 시각이다. */
    const checkpoint = (await this.options.diagnoses.checkpoint(projectId)) ?? baseline;
    /** 프로젝트 필터. */
    const filter: SentryIssueFilter = { projectId, environment: registration.environment, levels: registration.levels };

    /** 신규 조회. 체크포인트보다 조금 앞에서 겹쳐 부른다. */
    const fresh = await api.listNewErrorIssues(organization, filter, checkpoint - SENTRY_OVERLAP_MS);
    if (!fresh.ok) return this.failed(token, registration, fresh.failure);
    /** 재발 조회. */
    const regressed = await api.listRegressedErrorIssues(organization, filter);
    if (!regressed.ok) return this.failed(token, registration, regressed.failure);

    /** 진단 대상. */
    const detected: DetectedIssue[] = [];
    /** 7일보다 앞서 처음 보여 진단하지 않는 신규 수. */
    let catchUpSkipped = 0;
    for (const issue of fresh.value) {
      if (issue.firstSeen <= baseline) continue;
      if (issue.firstSeen < startedAt - SENTRY_CATCH_UP_MS) {
        catchUpSkipped += 1;
        continue;
      }
      detected.push({ origin: 'new', issue, eventId: null });
    }
    for (const issue of regressed.value) {
      /** 가장 최근 재발. */
      const regression = await api.latestRegression(organization, issue.id);
      if (!regression.ok) {
        // 목록에 있던 오류 이슈가 그사이 지워졌으면 그 오류 이슈만 건너뛴다.
        if (regression.failure.kind === 'not-found') continue;
        return this.failed(token, registration, regression.failure);
      }
      if (regression.value === null) {
        logger.warn('sentry-detection.regression-activity-missing', { projectId });
        continue;
      }
      if (regression.value.at <= baseline) continue;
      detected.push({ origin: 'regression', issue, eventId: regression.value.eventId });
    }
    // 잡힌 것은 처음 보인 순서대로 선다. 같은 오류 이슈면 신규가 먼저다.
    detected.sort((a, b) => a.issue.firstSeen - b.issue.firstSeen || (a.origin === b.origin ? 0 : a.origin === 'new' ? -1 : 1));

    if (catchUpSkipped > 0) logger.info('sentry-detection.catch-up-skipped', { projectId, count: catchUpSkipped });
    await this.options.diagnoses.record({ registration, checkpoint: startedAt, detectedAt: clock.now(), detected });
    this.options.projects.reportAccess(projectId, 'ok');
    return { kind: 'done' };
  }

  /** 프로젝트 조회가 실패했다. 실패의 범위(그 프로젝트, 토큰, 한도)를 정한다. 체크포인트는 옮기지 않는다. */
  private failed(token: string, registration: SentryProjectRegistration, failure: SentryApiFailure): ProjectOutcome {
    this.options.logger.warn('sentry-detection.project-failed', { projectId: registration.projectId, failure: failure.kind });
    switch (failure.kind) {
      case 'unauthorized':
        // 조회에 쓴 토큰으로 알린다. 그사이 토큰을 바꿨으면 연결이 무시한다.
        this.options.connection.reportApiFailure(token, failure);
        return { kind: 'token-rejected' };
      case 'rate-limited':
        return { kind: 'rate-limited', resetAt: failure.resetAt ?? null };
      // 등록할 때 `event:read`를 확인했으므로 뒤의 `403`은 그 프로젝트의 접근 거부로 본다.
      case 'not-found':
      case 'forbidden':
        this.options.projects.reportAccess(registration.projectId, 'inaccessible');
        return { kind: 'failed' };
      case 'network':
      case 'http':
      case 'unexpected-response':
        return { kind: 'failed' };
    }
  }
}
