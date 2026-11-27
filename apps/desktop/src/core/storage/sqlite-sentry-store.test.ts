import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FlowEmployee } from '../ports/flow-api';
import type { UnsavedDiagnosis } from '../sentry/sentry-diagnosis';
import { openStateDatabase, SqliteStateStore, STATE_MIGRATIONS } from './state-database';
import { SqliteSentryStore } from './sqlite-sentry-store';

/** 테스트마다 만드는 임시 폴더. */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stardraft-sentry-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더의 `state.db`를 열어 Sentry 저장소와 상태 저장소를 만든다. */
function open() {
  const db = openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0');
  return { db, sentry: new SqliteSentryStore(db), state: new SqliteStateStore(db) };
}

/** 가짜 진단. */
function diagnosis(issueId: string, overrides: Partial<UnsavedDiagnosis> = {}): UnsavedDiagnosis {
  return {
    projectId: 'p1',
    issueId,
    origin: 'new',
    regressionEventId: null,
    detectedAt: 1_000,
    status: 'queued',
    repoCheck: null,
    issue: {
      shortId: `WEB-${issueId}`,
      title: `시험 오류 ${issueId}`,
      culprit: 'app/checkout',
      level: 'error',
      environment: 'production',
      firstSeen: 500,
      lastSeen: 900,
      count: 3,
      userCount: 1,
      permalink: null,
      platform: 'javascript',
      organizationName: '가짜 조직',
      projectName: '가짜 프로젝트',
    },
    ...overrides,
  };
}

describe('Sentry 진단 저장소', () => {
  it('조회 한 번의 체크포인트, 중복 억제 키, 새 진단을 저장하고 다시 열어도 읽는다', async () => {
    const first = open();
    const saved = await first.sentry.recordDetection({
      projectId: 'p1',
      checkpoint: 2_000,
      keys: [
        { issueId: '101', eventId: null },
        { issueId: '102', eventId: 'e'.repeat(32) },
      ],
      diagnoses: [
        diagnosis('101'),
        diagnosis('102', { origin: 'regression', regressionEventId: 'e'.repeat(32), status: 'repo-check-needed', repoCheck: { kind: 'missing-folder', path: '/repo' } }),
      ],
    });
    first.db.close();

    const reopened = open();
    expect(await reopened.sentry.getCheckpoint('p1')).toBe(2_000);
    expect(await reopened.sentry.getCheckpoint('p2')).toBeNull();
    expect(await reopened.sentry.hasDetectionKey({ issueId: '101', eventId: null })).toBe(true);
    expect(await reopened.sentry.hasDetectionKey({ issueId: '102', eventId: 'e'.repeat(32) })).toBe(true);
    expect(await reopened.sentry.hasDetectionKey({ issueId: '102', eventId: null })).toBe(false);
    expect(await reopened.sentry.hasDetectionKey({ issueId: '102', eventId: 'f'.repeat(32) })).toBe(false);
    expect(await reopened.sentry.listDiagnoses()).toEqual(saved);
    expect(saved.map((item) => item.issueId)).toEqual(['101', '102']);
    expect(saved[1]).toMatchObject({ status: 'repo-check-needed', repoCheck: { kind: 'missing-folder', path: '/repo' } });
    reopened.db.close();
  });

  it('체크포인트는 덮어쓰고, 이미 있는 중복 억제 키는 그대로 둔다', async () => {
    const { db, sentry } = open();
    await sentry.recordDetection({ projectId: 'p1', checkpoint: 1_000, keys: [{ issueId: '101', eventId: null }], diagnoses: [] });
    await sentry.recordDetection({ projectId: 'p1', checkpoint: 3_000, keys: [{ issueId: '101', eventId: null }], diagnoses: [] });

    expect(await sentry.getCheckpoint('p1')).toBe(3_000);
    expect(await sentry.hasDetectionKey({ issueId: '101', eventId: null })).toBe(true);
    db.close();
  });

  it('진단의 상태와 저장소 대기 사유를 바꾼다', async () => {
    const { db, sentry } = open();
    const [saved] = await sentry.recordDetection({
      projectId: 'p1',
      checkpoint: 1,
      keys: [],
      diagnoses: [diagnosis('101', { status: 'repo-check-needed', repoCheck: { kind: 'unmapped' } })],
    });

    await sentry.setDiagnosisStatus(saved!.id, 'queued', null);

    expect(await sentry.listDiagnoses()).toEqual([{ ...saved, status: 'queued', repoCheck: null }]);
    db.close();
  });

  it('등록을 푼 프로젝트의 체크포인트·중복 억제 기록·주어진 상태의 진단만 지우고 다른 프로젝트는 그대로 둔다', async () => {
    const { db, sentry } = open();
    await sentry.recordDetection({ projectId: 'p1', checkpoint: 1, keys: [{ issueId: '101', eventId: null }], diagnoses: [diagnosis('101')] });
    const [other] = await sentry.recordDetection({
      projectId: 'p2',
      checkpoint: 2,
      keys: [{ issueId: '201', eventId: null }],
      diagnoses: [diagnosis('201', { projectId: 'p2' })],
    });

    const removed = await sentry.removeProject('p1', ['queued', 'repo-check-needed']);

    expect(removed).toHaveLength(1);
    expect(await sentry.getCheckpoint('p1')).toBeNull();
    expect(await sentry.hasDetectionKey({ issueId: '101', eventId: null })).toBe(false);
    expect(await sentry.listDiagnoses()).toEqual([other]);
    expect(await sentry.getCheckpoint('p2')).toBe(2);
    db.close();
  });

  it('Flow 계정을 처음 넣거나 바꾸거나 보관 계정을 지워도 Sentry 기록은 그대로다', async () => {
    const { db, sentry, state } = open();
    const me: FlowEmployee = { userId: 'a@example.test', name: '가', division: '팀', email: 'a@example.test' };
    const other: FlowEmployee = { userId: 'b@example.test', name: '나', division: '팀', email: 'b@example.test' };
    // 계정을 넣기 전에 쌓인 기록은 처음 넣는 계정이 이어받으므로, Sentry 기록을 먼저 만들어 이어받기에도 휩쓸리지 않는지 본다.
    const saved = await sentry.recordDetection({ projectId: 'p1', checkpoint: 5, keys: [{ issueId: '101', eventId: null }], diagnoses: [diagnosis('101')] });
    await state.setAccount(me);

    await state.switchAccount(other, { now: 10, secretPatterns: [] });
    await state.deleteAccountsUnusedBefore(1_000);

    expect(await sentry.listDiagnoses()).toEqual(saved);
    expect(await sentry.getCheckpoint('p1')).toBe(5);
    expect(await sentry.hasDetectionKey({ issueId: '101', eventId: null })).toBe(true);
    db.close();
  });

  it('형식 24에서 올리면 sentry_ 표가 비어 생긴다', async () => {
    const path = join(dir, 'state.db');
    openStateDatabase(path, STATE_MIGRATIONS.slice(0, 24), '0.1.0').close();

    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    const sentry = new SqliteSentryStore(db);

    expect(db.pragma('user_version', { simple: true })).toBe(STATE_MIGRATIONS.length);
    expect(
      (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'sentry\\_%' ESCAPE '\\' ORDER BY name").all() as { name: string }[]).map(
        (row) => row.name,
      ),
    ).toEqual(['sentry_checkpoint', 'sentry_detection_key', 'sentry_diagnosis']);
    expect(await sentry.listDiagnoses()).toEqual([]);
    db.close();
  });

  it('형식 25의 진단은 올린 뒤 보고서·실패·완료 시각 없이, 실행 기록은 비어 읽힌다', async () => {
    const path = join(dir, 'state.db');
    /** 형식 25로 연 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 25), '0.1.0');
    old
      .prepare(
        `INSERT INTO sentry_diagnosis (project_id, issue_id, origin, regression_event_id, detected_at, status, repo_check, issue)
         VALUES ('p1', '101', 'new', NULL, 1000, 'queued', NULL, ?)`,
      )
      .run(JSON.stringify(diagnosis('101').issue));
    old.close();

    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    expect(await new SqliteSentryStore(db).listDiagnoses()).toMatchObject([{ issueId: '101', status: 'queued', report: null, failure: null, runs: [], completedAt: null }]);
    db.close();
  });

  it('형식 29의 진단은 올린 뒤 재현 없이 다시 시도가 아닌 것으로 읽히고, 켠 값은 다시 열어도 남는다. 재현하던 진단의 실패 표시도 JSON 그대로 남는다', async () => {
    const path = join(dir, 'state.db');
    /** 형식 29로 연 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 29), '0.1.0');
    old
      .prepare(
        `INSERT INTO sentry_diagnosis (project_id, issue_id, origin, regression_event_id, detected_at, status, repo_check, issue)
         VALUES ('p1', '101', 'new', NULL, 1000, 'queued', NULL, ?)`,
      )
      .run(JSON.stringify(diagnosis('101').issue));
    old.close();

    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    const sentry = new SqliteSentryStore(db);
    const [before] = await sentry.listDiagnoses();
    expect(before).toMatchObject({ issueId: '101', withoutReproduction: false });
    await sentry.updateDiagnosis({
      ...before!,
      withoutReproduction: true,
      status: 'failed',
      failure: { reason: 'timed-out', detail: null, lastStep: null, runKind: 'diagnosis', reproducing: true },
    });
    db.close();

    const reopened = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    expect(await new SqliteSentryStore(reopened).listDiagnoses()).toMatchObject([{ withoutReproduction: true, failure: { reproducing: true } }]);
    reopened.close();
  });

  it('진단의 보고서·실패·실행 기록·완료 시각을 쓰고 다시 열어도 읽으며, 진단 하나를 지워도 중복 억제 기록은 남는다', async () => {
    const first = open();
    const [saved] = await first.sentry.recordDetection({ projectId: 'p1', checkpoint: 2_000, keys: [{ issueId: '101', eventId: null }], diagnoses: [diagnosis('101')] });
    /** 진단 실패로 바꾼 진단. */
    const failed = {
      ...saved!,
      status: 'failed' as const,
      failure: { reason: 'timed-out' as const, detail: null, lastStep: '오류 진단하는 중', runKind: 'diagnosis' as const },
      runs: [
        {
          kind: 'diagnosis' as const,
          agent: 'claude-code' as const,
          cliVersion: '2.1.300',
          model: null,
          startedAt: 1,
          finishedAt: 2,
          result: 'timed-out' as const,
          detail: null,
          lastStep: null,
          fixes: [],
          omittedContextItems: 0,
          usage: null,
        },
      ],
    };
    await first.sentry.updateDiagnosis(failed);
    first.db.close();

    const reopened = open();
    expect(await reopened.sentry.listDiagnoses()).toEqual([failed]);
    await reopened.sentry.updateDiagnosis({ ...failed, status: 'completed', failure: null, runs: [], completedAt: 9_000 });
    expect((await reopened.sentry.listDiagnoses())[0]).toMatchObject({ status: 'completed', completedAt: 9_000, runs: [] });

    await reopened.sentry.removeDiagnosis(saved!.id);
    expect(await reopened.sentry.listDiagnoses()).toEqual([]);
    expect(await reopened.sentry.hasDetectionKey({ issueId: '101', eventId: null })).toBe(true);
    reopened.db.close();
  });

  it('새 재발로 자리를 내준 진단 실패는 새 진단과 한 트랜잭션으로 지운다', async () => {
    const { db, sentry } = open();
    const [failed] = await sentry.recordDetection({ projectId: 'p1', checkpoint: 2_000, keys: [], diagnoses: [diagnosis('101', { status: 'failed' })] });

    const [replacement] = await sentry.recordDetection({
      projectId: 'p1',
      checkpoint: 3_000,
      keys: [{ issueId: '101', eventId: 'r'.repeat(32) }],
      diagnoses: [diagnosis('101', { origin: 'regression', regressionEventId: 'r'.repeat(32) })],
      replaced: [failed!.id],
    });

    expect((await sentry.listDiagnoses()).map((item) => item.id)).toEqual([replacement!.id]);
    db.close();
  });
});
