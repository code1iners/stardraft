import type { DetectionRecord, SentryStore } from '../ports/sentry-store';
import type { DetectionKey, DiagnosisIssue, DiagnosisOrigin, DiagnosisRepoCheck, DiagnosisStatus, SentryDiagnosis } from '../sentry/sentry-diagnosis';
import type { StateDatabase } from './state-database';

/** 중복 억제 키의 이벤트 ID 열에 신규를 적는 값. 기본 키 열이라 `NULL`을 쓰지 않는다. */
const NEW_ISSUE_EVENT_ID = '';

/** `sentry_diagnosis` 한 줄. */
interface DiagnosisRow {
  id: number;
  project_id: string;
  issue_id: string;
  origin: DiagnosisOrigin;
  regression_event_id: string | null;
  detected_at: number;
  status: DiagnosisStatus;
  repo_check: string | null;
  issue: string;
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

  async recordDetection({ projectId, checkpoint, keys, diagnoses }: DetectionRecord): Promise<SentryDiagnosis[]> {
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
      return diagnoses.map((diagnosis): SentryDiagnosis => {
        /** 넣은 결과. */
        const result = insertDiagnosis.run({
          ...diagnosis,
          repoCheck: diagnosis.repoCheck === null ? null : JSON.stringify(diagnosis.repoCheck),
          issue: JSON.stringify(diagnosis.issue),
        });
        return structuredClone({ ...diagnosis, id: Number(result.lastInsertRowid) });
      });
    })();
  }

  async setDiagnosisStatus(id: number, status: DiagnosisStatus, repoCheck: DiagnosisRepoCheck | null): Promise<void> {
    this.db.prepare('UPDATE sentry_diagnosis SET status = ?, repo_check = ? WHERE id = ?').run(status, repoCheck === null ? null : JSON.stringify(repoCheck), id);
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
  };
}
