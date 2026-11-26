import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger } from '../logging/logger';
import type { SentryErrorIssue } from '../ports/sentry-api';
import type { SentryProjectRegistration } from '../ports/settings-store';
import { openStateDatabase, STATE_MIGRATIONS } from '../storage/state-database';
import { SqliteSentryStore } from '../storage/sqlite-sentry-store';
import { COMPLETED_RETENTION_MS, SentryDiagnoses } from './sentry-diagnoses';
import type { DiagnosisReport, SentryDiagnosis } from './sentry-diagnosis';

/** 지금(2026-11-26 12:00 UTC). */
const NOW = Date.UTC(2026, 10, 26, 12);
/** 하루(밀리초). */
const DAY = 24 * 60 * 60 * 1000;
/** 1분. */
const MINUTE = 60_000;

/** 시험이 만든 임시 폴더. */
const tempDirs: string[] = [];
/** 시험이 연 DB. */
const openDbs: { close(): void }[] = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 등록한 프로젝트. */
function registration(projectId = '11'): SentryProjectRegistration {
  return {
    projectId,
    organizationId: '1',
    organizationSlug: 'org-a',
    organizationName: '가짜 조직',
    projectSlug: `p-${projectId}`,
    projectName: `프로젝트 ${projectId}`,
    environment: 'production',
    levels: ['fatal', 'error'],
    registeredAt: new Date(NOW - 60 * MINUTE).toISOString(),
  };
}

/** 목록에서 읽은 오류 이슈. */
function listed(id: string): SentryErrorIssue {
  return {
    id,
    shortId: `FAKE-${id}`,
    title: `시험 오류 ${id}`,
    culprit: 'src/fake.ts',
    level: 'error',
    firstSeen: NOW - 5 * MINUTE,
    lastSeen: NOW - MINUTE,
    count: 3,
    userCount: 1,
    permalink: `https://org-a.sentry.io/issues/${id}/`,
    platform: 'javascript',
  };
}

/** 재현 결과를 고른 보고서. */
function report(result: DiagnosisReport['reproduction']['result'] = 'impossible'): DiagnosisReport {
  return {
    summary: '요약',
    reproduction: { result, impossibleReason: result === 'impossible' ? 'not-allowed' : null, method: '', steps: [] },
    cause: { text: '원인 [근거 1]', confidence: 'medium' },
    improvements: ['고친다'],
    openQuestions: [],
    evidence: [],
    event: { eventId: 'e1', release: null, firstRelease: null, lastRelease: null, sourceMaps: 'unknown', missingData: [], stackHead: [] },
    run: { repository: '/repo', headCommit: null, uncommittedChanges: null, reproductionAllowed: false, agent: 'claude-code', cliVersion: null, durationMs: 1000, createdAt: NOW },
  } as DiagnosisReport;
}

/**
 * 진단 목록을 만든다. 저장소는 실제 SQLite이고 알림과 시계는 가짜다. `removed`는 첨부 폴더를 지우라는 요청을 쌓는다.
 * 같은 저장소로 목록을 다시 만들어 앱을 다시 켠 것을 흉내 낼 수 있다.
 */
async function setup() {
  const clock = new FakeClock(NOW);
  const logger = createLogger([{ write: () => {} }], clock);
  /** 임시 폴더. */
  const dir = mkdtempSync(join(tmpdir(), 'sentry-diagnoses-'));
  tempDirs.push(dir);
  const db = openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0');
  openDbs.push(db);
  const store = new SqliteSentryStore(db);
  const notifier = new RecordingNotifier();
  /** 첨부 폴더를 지우라고 요청받은 진단 ID. */
  const removed: number[] = [];
  /** 진단 목록을 만든다. */
  const open = () =>
    new SentryDiagnoses({
      store,
      notifier,
      logger,
      clock,
      resolveRepo: async () => ({ kind: 'mapped', path: '/repo' }),
      removeAttachments: async (id) => {
        removed.push(id);
      },
    });
  const diagnoses = open();
  await diagnoses.load();
  return { clock, store, notifier, removed, diagnoses, open };
}

/** 신규 오류 이슈 하나를 감지해 대기 진단으로 만들고 그 진단을 돌려준다. */
async function detect(diagnoses: SentryDiagnoses, issueId: string, origin: 'new' | 'regression' = 'new', eventId: string | null = null): Promise<SentryDiagnosis> {
  await diagnoses.record({ registration: registration(), checkpoint: NOW, detectedAt: NOW, detected: [{ origin, issue: listed(issueId), eventId }] });
  /** 방금 만든 진단. 가장 늦게 만든 같은 오류 이슈의 진단이다. */
  const created = diagnoses.list().filter((item) => item.issueId === issueId).at(-1);
  if (!created) throw new Error('진단이 만들어지지 않았습니다.');
  return created;
}

/** 대기 진단에 보고서를 저장해 검토 대기로 둔다. */
async function makeReady(diagnoses: SentryDiagnoses, issueId: string, result: DiagnosisReport['reproduction']['result'] = 'impossible', origin: 'new' | 'regression' = 'new', eventId: string | null = null): Promise<number> {
  /** 감지한 진단. */
  const detected = await detect(diagnoses, issueId, origin, eventId);
  expect(await diagnoses.saveReport(detected.id, report(result), [])).toBe(true);
  return detected.id;
}

describe('진단 보고서 준비됨', () => {
  it('보고서가 저장되면 건마다 알림이 뜨고 본문에는 프로젝트 이름과 재현 결과뿐이다', async () => {
    const { diagnoses, notifier } = await setup();
    const id = await makeReady(diagnoses, '101', 'success');

    expect(notifier.sent).toEqual([
      { title: '진단 보고서 준비됨', body: '프로젝트 11의 오류를 진단했습니다. 재현 성공.', target: { kind: 'diagnosis', id } },
    ]);
    // 오류 제목·메시지가 화면 공유 중에 보이지 않는다.
    expect(JSON.stringify(notifier.sent)).not.toContain('시험 오류');
  });

  it.each([
    ['success', '재현 성공.'],
    ['failure', '재현 실패.'],
    ['impossible', '재현 안 함.'],
  ] as const)('재현 결과 %s는 알림 본문에 "%s"로 쓴다', async (result, text) => {
    const { diagnoses, notifier } = await setup();
    await makeReady(diagnoses, '101', result);

    expect(notifier.sent[0]?.body).toBe(`프로젝트 11의 오류를 진단했습니다. ${text}`);
  });

  it('대기가 아니게 된 진단(취소 등)에는 보고서를 저장하지 않고 알리지도 않는다', async () => {
    const { diagnoses, notifier } = await setup();
    const detected = await detect(diagnoses, '101');
    await diagnoses.markFailed(detected.id, { reason: 'cancelled', detail: null, lastStep: null, runKind: 'diagnosis' }, []);

    expect(await diagnoses.saveReport(detected.id, report(), [])).toBe(false);
    expect(notifier.sent).toEqual([]);
  });

  it('검토 대기 보고서는 트레이 검토 수에 건마다 더해지고, 저장소 대기는 프로젝트마다 1로 함께 센다', async () => {
    const { diagnoses } = await setup();
    await makeReady(diagnoses, '101');
    await makeReady(diagnoses, '102');
    expect(diagnoses.reviewCount()).toBe(2);

    // 매핑이 없는 프로젝트에 오류 이슈 둘이 기다리면 프로젝트 하나로 센다.
    const unmapped = new SentryDiagnoses({
      store: (await setup()).store,
      notifier: new RecordingNotifier(),
      logger: createLogger([{ write: () => {} }], new FakeClock(NOW)),
      resolveRepo: async () => ({ kind: 'unmapped' }),
    });
    await unmapped.load();
    await unmapped.record({
      registration: registration(),
      checkpoint: NOW,
      detectedAt: NOW,
      detected: [
        { origin: 'new', issue: listed('201'), eventId: null },
        { origin: 'new', issue: listed('202'), eventId: null },
      ],
    });
    expect(unmapped.reviewCount()).toBe(1);
  });

  it('진단 실패는 알림 없이 트레이 실패 표시로만 보인다', async () => {
    const { diagnoses, notifier } = await setup();
    const detected = await detect(diagnoses, '101');
    expect(diagnoses.hasFailure()).toBe(false);

    await diagnoses.markFailed(detected.id, { reason: 'timed-out', detail: null, lastStep: null, runKind: 'diagnosis' }, []);

    expect(diagnoses.hasFailure()).toBe(true);
    expect(diagnoses.reviewCount()).toBe(0);
    expect(notifier.sent).toEqual([]);
  });
});

describe('진단 완료', () => {
  it('검토 대기 보고서를 완료하면 최소 기록만 남기고 본문과 첨부 폴더를 지운다', async () => {
    const { clock, diagnoses, store, removed, open } = await setup();
    const id = await makeReady(diagnoses, '101');
    clock.advance(2 * MINUTE);

    await diagnoses.complete(id);

    /** 완료한 진단. */
    const done = diagnoses.get(id);
    expect(done).toMatchObject({ status: 'completed', report: null, failure: null, runs: [], completedAt: NOW + 2 * MINUTE, issueId: '101', regressionEventId: null });
    expect(removed).toEqual([id]);
    // 저장한 줄도 같고, 다시 켜도 완료함에 남는다.
    expect((await store.listDiagnoses()).find((item) => item.id === id)).toMatchObject({ status: 'completed', report: null, completedAt: NOW + 2 * MINUTE });
    /** 다시 켠 목록. */
    const reopened = open();
    await reopened.load();
    expect(reopened.get(id)?.status).toBe('completed');
  });

  it('완료하면 검토 대기 수에서 빠진다', async () => {
    const { diagnoses } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.complete(id);

    expect(diagnoses.reviewCount()).toBe(0);
  });

  it('진단 실패는 지울 본문이 없어도 완료할 수 있다', async () => {
    const { diagnoses } = await setup();
    const detected = await detect(diagnoses, '101');
    await diagnoses.markFailed(detected.id, { reason: 'timed-out', detail: null, lastStep: null, runKind: 'diagnosis' }, []);

    await diagnoses.complete(detected.id);

    expect(diagnoses.get(detected.id)).toMatchObject({ status: 'completed', failure: null });
  });

  it('대기·진행 중인 진단과 이미 완료한 진단은 완료되지 않는다', async () => {
    const { diagnoses, removed } = await setup();
    const waiting = await detect(diagnoses, '101');
    await diagnoses.complete(waiting.id);
    expect(diagnoses.get(waiting.id)?.status).toBe('queued');

    const ready = await makeReady(diagnoses, '102');
    await diagnoses.complete(ready);
    removed.length = 0;
    await diagnoses.complete(ready);

    expect(diagnoses.get(ready)?.status).toBe('completed');
    expect(removed).toEqual([]);
  });

  it('첨부 폴더를 지우지 못해도 완료는 되돌리지 않는다', async () => {
    const { store } = await setup();
    const failing = new SentryDiagnoses({
      store,
      notifier: new RecordingNotifier(),
      logger: createLogger([{ write: () => {} }], new FakeClock(NOW)),
      resolveRepo: async () => ({ kind: 'mapped', path: '/repo' }),
      removeAttachments: async () => {
        throw new Error('폴더를 지우지 못함');
      },
    });
    await failing.load();
    const id = await makeReady(failing, '101');

    await failing.complete(id);

    expect(failing.get(id)?.status).toBe('completed');
  });
});

describe('완료함 7일', () => {
  it('완료한 진단은 7일이 되기 전까지 완료함에 남고, 7일이 되면 목록에서 사라진다', async () => {
    const { clock, diagnoses, removed } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.complete(id);
    removed.length = 0;

    clock.advance(COMPLETED_RETENTION_MS - MINUTE);
    expect(await diagnoses.archiveExpired()).toBe(0);
    expect(diagnoses.get(id)?.status).toBe('completed');

    clock.advance(MINUTE);
    expect(await diagnoses.archiveExpired()).toBe(1);
    expect(diagnoses.get(id)).toBeUndefined();
    // 사라질 때 첨부 폴더도 한 번 더 치운다.
    expect(removed).toEqual([id]);
  });

  it('사라진 완료 진단은 최소 기록(오류 이슈 ID, 재발 식별자, 완료 시각)만 남고 오류 정보는 비워진다', async () => {
    const { clock, diagnoses, store } = await setup();
    const id = await makeReady(diagnoses, '101', 'impossible', 'regression', 'event-9');
    await diagnoses.complete(id);

    clock.advance(7 * DAY);
    await diagnoses.archiveExpired();

    /** 저장소에 남은 줄. */
    const minimal = (await store.listDiagnoses()).find((item) => item.id === id);
    expect(minimal).toMatchObject({ issueId: '101', regressionEventId: 'event-9', status: 'completed', completedAt: NOW, report: null, failure: null, runs: [] });
    expect(minimal?.issue.title).toBe('');
    expect(minimal?.issue.permalink).toBeNull();
    // 중복 억제 기록이 남아 같은 재발을 다시 진단하지 않는다.
    expect(await store.hasDetectionKey({ issueId: '101', eventId: 'event-9' })).toBe(true);
  });

  it('앱을 다시 켜도 7일이 지난 완료 진단은 목록에 오르지 않는다', async () => {
    const { clock, diagnoses, store, open } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.complete(id);

    clock.advance(7 * DAY);
    /** 다시 켠 목록. */
    const reopened = open();
    await reopened.load();

    expect(reopened.get(id)).toBeUndefined();
    // 꺼져 있던 사이 7일이 지난 진단도 켤 때 최소 기록만 남긴다.
    expect((await store.listDiagnoses()).find((item) => item.id === id)).toMatchObject({ issueId: '101', completedAt: NOW, issue: { title: '', projectName: '' } });
  });

  it('7일이 되어도 완료하지 않은 검토 대기 보고서는 사라지지 않는다', async () => {
    const { clock, diagnoses } = await setup();
    const id = await makeReady(diagnoses, '101');

    clock.advance(30 * DAY);
    await diagnoses.archiveExpired();

    expect(diagnoses.get(id)?.status).toBe('ready');
  });

  it('프로젝트 등록을 풀어도 검토 대기 보고서와 완료 기록은 남는다', async () => {
    const { diagnoses } = await setup();
    const ready = await makeReady(diagnoses, '101');
    const done = await makeReady(diagnoses, '102');
    await diagnoses.complete(done);
    const waiting = await detect(diagnoses, '103');

    await diagnoses.removeProject('11');

    expect(diagnoses.get(ready)?.status).toBe('ready');
    expect(diagnoses.get(done)?.status).toBe('completed');
    expect(diagnoses.get(waiting.id)).toBeUndefined();
  });
});

describe('검토 대기와 완료 뒤의 재발', () => {
  it('검토 대기 중 재발은 새 진단을 따로 만들고 앞선 보고서는 그대로 둔다', async () => {
    const { diagnoses } = await setup();
    const first = await makeReady(diagnoses, '101');

    const second = await detect(diagnoses, '101', 'regression', 'event-2');

    expect(second.id).not.toBe(first);
    expect(diagnoses.list().map((item) => `${item.id}:${item.status}`)).toEqual([`${first}:ready`, `${second.id}:queued`]);
    expect(diagnoses.get(first)?.report).not.toBeNull();
  });

  it('완료한 뒤의 재발도 새 진단을 만든다', async () => {
    const { diagnoses } = await setup();
    const first = await makeReady(diagnoses, '101');
    await diagnoses.complete(first);

    const second = await detect(diagnoses, '101', 'regression', 'event-2');

    expect(diagnoses.list().map((item) => `${item.id}:${item.status}`)).toEqual([`${first}:completed`, `${second.id}:queued`]);
  });
});
