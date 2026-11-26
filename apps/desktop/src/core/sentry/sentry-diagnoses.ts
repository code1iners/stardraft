import type { Logger } from '../logging/logger';
import type { AppNotification, Notifier } from '../ports/notifier';
import type { SentryErrorIssue } from '../ports/sentry-api';
import type { SentryProjectRegistration } from '../ports/settings-store';
import type { SentryStore } from '../ports/sentry-store';
import { SerialQueue } from '../serial-queue';
import {
  absorbsRegression,
  isRepoWaiting,
  STATUSES_REMOVED_ON_UNREGISTER,
  type DetectionKey,
  type DiagnosisOrigin,
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
}

/**
 * Sentry 진단 목록. 감지 결과를 중복 억제 규칙대로 진단으로 만들고, 저장소 대기(저장소 매핑 필요, 저장소 확인 필요)를
 * 프로젝트 단위로 알리고 다시 판정해 재개한다. 이 단계에서는 진단을 실행하지 않는다.
 */
export class SentryDiagnoses {
  /** 진단 전부. ID 순서다. */
  private diagnoses: SentryDiagnosis[] = [];
  /** 저장과 다시 판정, 등록 해제가 서로 끼어들지 않게 한다. */
  private readonly updates = new SerialQueue();
  /** 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: SentryDiagnosesOptions) {}

  /** 저장된 진단을 읽는다. 앱이 시작할 때 한 번 부른다. */
  async load(): Promise<void> {
    await this.updates.run(async () => {
      this.diagnoses = await this.options.store.listDiagnoses();
    });
    this.emit();
  }

  /** 진단 전부. ID 순서다. */
  list(): SentryDiagnosis[] {
    return structuredClone(this.diagnoses);
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
      const saved = await this.options.store.recordDetection({ projectId: registration.projectId, checkpoint, keys, diagnoses: created });
      /** 이 프로젝트가 저장 전에 이미 저장소 대기였는지 여부. 그렇다면 이미 알렸다. */
      const alreadyWaiting = this.diagnoses.some((item) => item.projectId === registration.projectId && isRepoWaiting(item));
      this.diagnoses = [...this.diagnoses, ...saved];
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
      return ids;
    });
    this.options.logger.info('sentry-diagnoses.project-removed', { count: removed.length });
    this.emit();
  }

  /** 트레이 검토 수에 더할 수. 저장소 대기는 프로젝트마다 1로 센다. */
  reviewCount(): number {
    return new Set(this.diagnoses.filter(isRepoWaiting).map((item) => item.projectId)).size;
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
