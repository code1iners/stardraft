import type { DetectionRecord, SentryStore } from '../ports/sentry-store';
import type { RunRecord } from '../generation/generation-run';
import type {
  DetectionKey,
  DiagnosisExport,
  DiagnosisFailure,
  DiagnosisIssue,
  DiagnosisOrigin,
  DiagnosisReport,
  DiagnosisRepoCheck,
  DiagnosisStatus,
  SentryDiagnosis,
} from '../sentry/sentry-diagnosis';
import type { StateDatabase } from './state-database';

/** 중복 억제 키의 이벤트 ID 열에 신규를 적는 값. 기본 키 열이라 `NULL`을 쓰지 않는다. */
const NEW_ISSUE_EVENT_ID = '';

/** 목록에서 사라진 완료 진단에 남기는 오류 이슈 정보. 최소 기록에는 오류 이슈 ID만 있고 나머지는 비운다. */
const BLANK_ISSUE: DiagnosisIssue = {
  shortId: '',
  title: '',
  culprit: '',
  level: '',
  environment: null,
  firstSeen: 0,
  lastSeen: null,
  count: null,
  userCount: null,
  permalink: null,
  platform: null,
  organizationName: '',
  projectName: '',
};

/** `sentry_diagnosis` 한 줄. */
interface DiagnosisRow {
  /** 진단 ID. */
  id: number;
  /** 등록한 Sentry 프로젝트 ID. */
  project_id: string;
  /** 오류 이슈 ID. */
  issue_id: string;
  /** 신규인지 재발인지. */
  origin: DiagnosisOrigin;
  /** 재발을 일으킨 이벤트 ID. 신규면 `NULL`. */
  regression_event_id: string | null;
  /** 감지한 시각(Unix epoch 밀리초). */
  detected_at: number;
  /** 상태. */
  status: DiagnosisStatus;
  /** 저장소 대기 사유(JSON). 저장소 대기가 아니면 `NULL`. */
  repo_check: string | null;
  /** 오류 이슈 정보(JSON). */
  issue: string;
  /** 진단 보고서(JSON). 검토 대기가 아니면 `NULL`. */
  report: string | null;
  /** 진단 실패의 까닭(JSON). 진단 실패가 아니면 `NULL`. */
  failure: string | null;
  /** 실행 기록(JSON 배열). */
  runs: string;
  /** 완료한 시각(Unix epoch 밀리초). 완료가 아니면 `NULL`. */
  completed_at: number | null;
  /** 마지막으로 내보낸 기록(JSON). 내보낸 적 없으면 `NULL`. */
  last_export: string | null;
  /** 쌓인 지시(JSON 배열). */
  directives: string;
  /** 마지막 다시 진단이 실패해 앞선 보고서로 돌아왔다는 기록(JSON). 없으면 `NULL`. */
  rediagnosis_failure: string | null;
}

/**
 * `state.db`의 `sentry_` 표를 쓰는 Sentry 진단 저장소. 상태 저장소와 같은 연결을 쓰지만 Flow 계정과 무관하다.
 * 연결을 열고 마이그레이션하는 일은 `openStateDatabase`가 한다.
 */
export class SqliteSentryStore implements SentryStore {
  constructor(private readonly db: StateDatabase) {}

  async getCheckpoint(projectId: string): Promise<number | null> {
    /** 체크포인트 한 줄. */
    const row = this.db.prepare('SELECT checked_at FROM sentry_checkpoint WHERE project_id = ?').get(projectId) as { checked_at: number } | undefined;
    return row?.checked_at ?? null;
  }

  async hasDetectionKey({ issueId, eventId }: DetectionKey): Promise<boolean> {
    return this.db.prepare('SELECT 1 FROM sentry_detection_key WHERE issue_id = ? AND event_id = ?').get(issueId, eventId ?? NEW_ISSUE_EVENT_ID) !== undefined;
  }

  async listDiagnoses(): Promise<SentryDiagnosis[]> {
    return (this.db.prepare('SELECT * FROM sentry_diagnosis ORDER BY id').all() as DiagnosisRow[]).map(diagnosisOf);
  }

  async recordDetection({ projectId, checkpoint, keys, diagnoses, replaced = [] }: DetectionRecord): Promise<SentryDiagnosis[]> {
    /** 키 한 줄을 넣는 문장. */
    const insertKey = this.db.prepare(
      'INSERT INTO sentry_detection_key (issue_id, event_id, project_id) VALUES (?, ?, ?) ON CONFLICT (issue_id, event_id) DO NOTHING',
    );
    /** 진단 한 줄을 넣는 문장. */
    const insertDiagnosis = this.db.prepare(
      `INSERT INTO sentry_diagnosis (project_id, issue_id, origin, regression_event_id, detected_at, status, repo_check, issue)
       VALUES (@projectId, @issueId, @origin, @regressionEventId, @detectedAt, @status, @repoCheck, @issue)`,
    );
    return this.db.transaction(() => {
      this.db
        .prepare('INSERT INTO sentry_checkpoint (project_id, checked_at) VALUES (?, ?) ON CONFLICT (project_id) DO UPDATE SET checked_at = excluded.checked_at')
        .run(projectId, checkpoint);
      for (const key of keys) insertKey.run(key.issueId, key.eventId ?? NEW_ISSUE_EVENT_ID, projectId);
      /** 자리를 내준 진단 실패를 지우는 문장. */
      const remove = this.db.prepare('DELETE FROM sentry_diagnosis WHERE id = ?');
      for (const id of replaced) remove.run(id);
      return diagnoses.map((diagnosis): SentryDiagnosis => {
        /** 넣은 결과. */
        const result = insertDiagnosis.run({
          ...diagnosis,
          repoCheck: diagnosis.repoCheck === null ? null : JSON.stringify(diagnosis.repoCheck),
          issue: JSON.stringify(diagnosis.issue),
        });
        return structuredClone({
          ...diagnosis,
          id: Number(result.lastInsertRowid),
          report: null,
          failure: null,
          runs: [],
          completedAt: null,
          lastExport: null,
          directives: [],
          rediagnosisFailure: null,
        });
      });
    })();
  }

  async setDiagnosisStatus(id: number, status: DiagnosisStatus, repoCheck: DiagnosisRepoCheck | null): Promise<void> {
    this.db.prepare('UPDATE sentry_diagnosis SET status = ?, repo_check = ? WHERE id = ?').run(status, repoCheck === null ? null : JSON.stringify(repoCheck), id);
  }

  async updateDiagnosis(diagnosis: SentryDiagnosis): Promise<void> {
    this.db
      .prepare(
        'UPDATE sentry_diagnosis SET status = ?, repo_check = ?, report = ?, failure = ?, runs = ?, completed_at = ?, last_export = ?, directives = ?, rediagnosis_failure = ? WHERE id = ?',
      )
      .run(
        diagnosis.status,
        jsonOrNull(diagnosis.repoCheck),
        jsonOrNull(diagnosis.report),
        jsonOrNull(diagnosis.failure),
        JSON.stringify(diagnosis.runs),
        diagnosis.completedAt,
        jsonOrNull(diagnosis.lastExport),
        JSON.stringify(diagnosis.directives),
        jsonOrNull(diagnosis.rediagnosisFailure),
        diagnosis.id,
      );
  }

  async removeDiagnosis(id: number): Promise<void> {
    this.db.prepare('DELETE FROM sentry_diagnosis WHERE id = ?').run(id);
  }

  async scrubCompleted(ids: readonly number[]): Promise<void> {
    /** 비운 오류 이슈 정보. */
    const blankIssue = JSON.stringify(BLANK_ISSUE);
    /** 줄 하나를 비우는 문장. 완료가 아닌 줄은 건드리지 않는다. */
    const scrub = this.db.prepare(
      "UPDATE sentry_diagnosis SET issue = ?, report = NULL, failure = NULL, runs = '[]', repo_check = NULL, directives = '[]', rediagnosis_failure = NULL WHERE id = ? AND status = 'completed'",
    );
    this.db.transaction(() => {
      for (const id of ids) scrub.run(blankIssue, id);
    })();
  }

  async removeProject(projectId: string, statuses: readonly DiagnosisStatus[]): Promise<number[]> {
    return this.db.transaction(() => {
      this.db.prepare('DELETE FROM sentry_checkpoint WHERE project_id = ?').run(projectId);
      this.db.prepare('DELETE FROM sentry_detection_key WHERE project_id = ?').run(projectId);
      /** 지울 진단. */
      const ids = (
        this.db
          .prepare(`SELECT id FROM sentry_diagnosis WHERE project_id = ? AND status IN (${statuses.map(() => '?').join(', ') || 'NULL'}) ORDER BY id`)
          .all(projectId, ...statuses) as { id: number }[]
      ).map((row) => row.id);
      /** 진단 한 줄을 지우는 문장. */
      const remove = this.db.prepare('DELETE FROM sentry_diagnosis WHERE id = ?');
      for (const id of ids) remove.run(id);
      return ids;
    })();
  }
}

/** 표 한 줄을 진단으로 읽는다. */
function diagnosisOf(row: DiagnosisRow): SentryDiagnosis {
  return {
    id: row.id,
    projectId: row.project_id,
    issueId: row.issue_id,
    origin: row.origin,
    regressionEventId: row.regression_event_id,
    detectedAt: row.detected_at,
    status: row.status,
    repoCheck: row.repo_check === null ? null : (JSON.parse(row.repo_check) as DiagnosisRepoCheck),
    issue: JSON.parse(row.issue) as DiagnosisIssue,
    report: row.report === null ? null : reportOf(row.report),
    failure: row.failure === null ? null : (JSON.parse(row.failure) as DiagnosisFailure),
    runs: JSON.parse(row.runs) as RunRecord[],
    completedAt: row.completed_at,
    lastExport: row.last_export === null ? null : (JSON.parse(row.last_export) as DiagnosisExport),
    directives: JSON.parse(row.directives) as string[],
    rediagnosisFailure: row.rediagnosis_failure === null ? null : (JSON.parse(row.rediagnosis_failure) as DiagnosisFailure),
  };
}

/** 저장된 보고서를 읽는다. 앞선 진단 칸이 생기기 전에 저장한 보고서는 앞선 진단이 없는 것으로 본다. */
function reportOf(json: string): DiagnosisReport {
  /** 읽은 보고서. */
  const report = JSON.parse(json) as Omit<DiagnosisReport, 'priorDiagnosis'> & { priorDiagnosis?: DiagnosisReport['priorDiagnosis'] };
  return { ...report, priorDiagnosis: report.priorDiagnosis ?? null };
}

/** 값을 JSON으로 쓴다. `null`이면 `NULL`이다. */
function jsonOrNull(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}
