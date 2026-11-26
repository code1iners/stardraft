import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { DiagnosisAttachmentFolders } from './diagnosis-attachments';
import { COMPLETED_RETENTION_MS, SentryDiagnoses } from './sentry-diagnoses';
import { hasExportedCurrentReport, type DiagnosisReport, type DiagnosisFailure, type SentryDiagnosis } from './sentry-diagnosis';

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
    run: { repository: '/repo', headCommit: null, uncommittedChanges: null, reproductionAllowed: false, agent: 'claude-code', cliVersion: null, durationMs: 1000, createdAt: NOW, mcpServers: null },
    priorDiagnosis: null,
    attachments: [],
    omittedAttachments: 0,
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

/** 다시 진단을 시작하기 전 보고서와 구분되는, 새 보고서. 생성 시각이 다르다. */
function newerReport(): DiagnosisReport {
  /** 앞선 보고서와 같은 모양의 보고서. */
  const base = report();
  return { ...base, summary: '새 요약', run: { ...base.run, createdAt: NOW + MINUTE } };
}

/** 취소한 실행의 실패. */
const CANCELLED: DiagnosisFailure = { reason: 'cancelled', detail: null, lastStep: null, runKind: null };

describe('다시 진단', () => {
  it('지시 없이 다시 진단하면 앞선 보고서를 보관한 채 대기가 되고 쌓인 지시를 비우며 user 칸에 선다', async () => {
    const { diagnoses } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.rediagnose(id, '더 짧게');
    await diagnoses.saveReport(id, newerReport(), []);

    expect(await diagnoses.rediagnose(id, null)).toBe(true);

    const current = diagnoses.get(id)!;
    expect(current).toMatchObject({ status: 'queued', directives: [], rediagnosisFailure: null });
    expect(current.report?.summary).toBe('새 요약');
    expect(isRediagnosingNow(current)).toBe(true);
    expect(diagnoses.requestedByUser(id)).toBe(true);
    expect(diagnoses.generatingIds()).toContain(id);
  });

  it('지시를 덧붙이면 지시가 앞뒤 공백 없이 쌓이고, 빈 지시로는 다시 진단하지 않는다', async () => {
    const { diagnoses } = await setup();
    const id = await makeReady(diagnoses, '101');

    expect(await diagnoses.rediagnose(id, '   ')).toBe(false);
    expect(diagnoses.get(id)?.status).toBe('ready');

    expect(await diagnoses.rediagnose(id, '  더 짧게  ')).toBe(true);
    expect(diagnoses.get(id)?.directives).toEqual(['더 짧게']);
    await diagnoses.saveReport(id, newerReport(), []);
    await diagnoses.rediagnose(id, '근거를 더');
    expect(diagnoses.get(id)?.directives).toEqual(['더 짧게', '근거를 더']);
  });

  it('검토 대기가 아닌 진단은 다시 진단하지 않는다', async () => {
    const { diagnoses } = await setup();
    const waiting = await detect(diagnoses, '101');
    const done = await makeReady(diagnoses, '102');
    await diagnoses.complete(done);

    expect(await diagnoses.rediagnose(waiting.id, null)).toBe(false);
    expect(await diagnoses.rediagnose(done, null)).toBe(false);
    expect(await diagnoses.rediagnose(9999, null)).toBe(false);
  });

  it('다시 진단하는 동안에는 내보내기 기록도 완료도 다시 시도도 하지 않는다', async () => {
    const { diagnoses } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.rediagnose(id, null);

    expect(await diagnoses.recordExport(id, { path: '/x.md', at: NOW, reportCreatedAt: NOW })).toBe(false);
    await diagnoses.complete(id);
    await diagnoses.retry(id);

    expect(diagnoses.get(id)).toMatchObject({ status: 'queued', lastExport: null });
    expect(diagnoses.get(id)?.report).not.toBeNull();
  });

  it('다시 진단하는 동안의 재발은 새 진단을 만들지 않고 키만 기록한다', async () => {
    const { diagnoses, store } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.rediagnose(id, null);

    await detect(diagnoses, '101', 'regression', 'event-2').catch(() => undefined);

    expect(diagnoses.list().filter((item) => item.issueId === '101')).toHaveLength(1);
    expect(await store.hasDetectionKey({ issueId: '101', eventId: 'event-2' })).toBe(true);
  });

  it('새 보고서가 나오면 앞선 보고서와 첨부를 바꾸고 내보내지 않은 것으로 돌아가며 준비됨 알림이 뜬다', async () => {
    const { diagnoses, notifier, removed } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.recordExport(id, { path: '/x.md', at: NOW, reportCreatedAt: NOW });
    expect(hasExportedCurrentReport(diagnoses.get(id)!)).toBe(true);
    notifier.sent.length = 0;
    await diagnoses.rediagnose(id, '더 짧게');
    expect(removed).toEqual([]);

    expect(await diagnoses.saveReport(id, newerReport(), [])).toBe(true);

    const current = diagnoses.get(id)!;
    expect(current).toMatchObject({ status: 'ready', directives: ['더 짧게'], rediagnosisFailure: null });
    expect(current.report?.summary).toBe('새 요약');
    expect(hasExportedCurrentReport(current)).toBe(false);
    expect(removed).toEqual([id]);
    expect(notifier.sent).toHaveLength(1);
    expect(notifier.sent[0]).toMatchObject({ title: '진단 보고서 준비됨', target: { kind: 'diagnosis', id } });
  });

  it('처음 진단의 보고서는 첨부 폴더를 지우지 않는다', async () => {
    const { removed, diagnoses } = await setup();
    await makeReady(diagnoses, '101');

    expect(removed).toEqual([]);
  });

  it('실패하거나 취소하면 진단 실패가 아니라 앞선 보고서의 검토 대기로 돌아오고 지시는 남는다', async () => {
    const { diagnoses } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.rediagnose(id, '더 짧게');

    expect(await diagnoses.markFailed(id, CANCELLED, [])).toBe(true);

    const current = diagnoses.get(id)!;
    expect(current).toMatchObject({ status: 'ready', failure: null, directives: ['더 짧게'], rediagnosisFailure: CANCELLED });
    expect(current.report?.summary).toBe('요약');
    expect(diagnoses.hasFailure()).toBe(false);
    expect(diagnoses.reviewCount()).toBe(1);
    expect(diagnoses.requestedByUser(id)).toBe(false);
  });

  it('돌아온 보고서는 다시 내보내고 완료할 수 있고, 새 다시 진단을 시작하면 실패 기록이 지워진다', async () => {
    const { diagnoses } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.rediagnose(id, null);
    await diagnoses.markFailed(id, CANCELLED, []);
    expect(await diagnoses.recordExport(id, { path: '/x.md', at: NOW, reportCreatedAt: NOW })).toBe(true);

    await diagnoses.rediagnose(id, '한 번 더');

    expect(diagnoses.get(id)?.rediagnosisFailure).toBeNull();
  });

  it('다시 진단 중 저장소 매핑이나 폴더가 사라지면 저장소 대기로 가지 않고 앞선 보고서로 돌아와 알린다', async () => {
    const { diagnoses, notifier } = await setup();
    const id = await makeReady(diagnoses, '101');
    notifier.sent.length = 0;
    await diagnoses.rediagnose(id, null);

    expect(await diagnoses.markRepoWaiting(id, { kind: 'unmapped' }, [])).toBe(true);

    expect(diagnoses.get(id)).toMatchObject({ status: 'ready', repoCheck: null, rediagnosisFailure: { reason: 'repository-unavailable' } });
    expect(notifier.sent).toEqual([]);
  });

  it('다시 진단 중 프로젝트 등록을 풀면 취소로 보고 앞선 보고서를 남긴다', async () => {
    const { diagnoses } = await setup();
    const id = await makeReady(diagnoses, '101');
    const plain = await detect(diagnoses, '102');
    await diagnoses.rediagnose(id, null);

    await diagnoses.removeProject('11');

    expect(diagnoses.get(id)).toMatchObject({ status: 'ready', rediagnosisFailure: { reason: 'cancelled' } });
    expect(diagnoses.get(plain.id)).toBeUndefined();
  });

  it('다시 진단 중인 진단과 지시, 실패 기록은 앱을 다시 켜도 남는다', async () => {
    const { diagnoses, open } = await setup();
    const running = await makeReady(diagnoses, '101');
    const returned = await makeReady(diagnoses, '102');
    await diagnoses.rediagnose(running, '더 짧게');
    await diagnoses.rediagnose(returned, '근거를 더');
    await diagnoses.markFailed(returned, CANCELLED, []);

    const reopened = open();
    await reopened.load();

    expect(reopened.get(running)).toMatchObject({ status: 'queued', directives: ['더 짧게'] });
    expect(reopened.get(running)?.report?.summary).toBe('요약');
    expect(reopened.get(returned)).toMatchObject({ status: 'ready', directives: ['근거를 더'], rediagnosisFailure: CANCELLED });
  });

  it('완료하면 쌓인 지시와 실패 기록을 지운다', async () => {
    const { diagnoses, store } = await setup();
    const id = await makeReady(diagnoses, '101');
    await diagnoses.rediagnose(id, '더 짧게');
    await diagnoses.markFailed(id, CANCELLED, []);

    await diagnoses.complete(id);

    expect(diagnoses.get(id)).toMatchObject({ status: 'completed', directives: [], rediagnosisFailure: null });
    expect((await store.listDiagnoses()).find((item) => item.id === id)).toMatchObject({ directives: [], rediagnosisFailure: null });
  });
});

/** 다시 진단하는 중인지(대기인데 보고서가 있는지). */
function isRediagnosingNow(diagnosis: SentryDiagnosis): boolean {
  return diagnosis.status === 'queued' && diagnosis.report !== null;
}

describe('앞선 진단', () => {
  it('같은 오류 이슈의 앞선 보고서가 검토 대기 중이면 그 보고서를 참고로 알려 준다', async () => {
    const { diagnoses } = await setup();
    const first = await makeReady(diagnoses, '101');
    const second = await detect(diagnoses, '101', 'regression', 'event-2');

    const prior = await diagnoses.priorOf(second.id);

    expect(prior?.info).toEqual({ kind: 'in-review' });
    expect(prior?.report?.summary).toBe('요약');
    expect(await diagnoses.priorOf(first)).toBeNull();
  });

  it('완료한 뒤의 재발에는 보고서를 넘기지 않고 완료한 날짜와 마지막으로 내보낸 파일 경로를 알려 준다', async () => {
    const { diagnoses, clock } = await setup();
    const first = await makeReady(diagnoses, '101');
    await diagnoses.recordExport(first, { path: '/내보냄/a.md', at: NOW, reportCreatedAt: NOW });
    clock.advance(DAY);
    await diagnoses.complete(first);
    const second = await detect(diagnoses, '101', 'regression', 'event-2');

    const prior = await diagnoses.priorOf(second.id);

    expect(prior).toEqual({ info: { kind: 'completed', completedAt: NOW + DAY, exportPath: '/내보냄/a.md' }, report: null });
  });

  it('내보낸 적 없이 완료했으면 경로 없이 날짜만 알려 주고, 가장 최근에 완료한 진단을 쓴다', async () => {
    const { diagnoses, clock } = await setup();
    const first = await makeReady(diagnoses, '101');
    await diagnoses.complete(first);
    clock.advance(DAY);
    const again = await detect(diagnoses, '101', 'regression', 'event-2');
    await diagnoses.saveReport(again.id, report(), []);
    clock.advance(DAY);
    await diagnoses.complete(again.id);
    const third = await detect(diagnoses, '101', 'regression', 'event-3');

    expect((await diagnoses.priorOf(third.id))?.info).toEqual({ kind: 'completed', completedAt: NOW + 2 * DAY, exportPath: null });
  });

  it('검토 대기 보고서가 완료한 진단보다 우선하고, 나중에 만든 진단은 앞선 진단이 아니다', async () => {
    const { diagnoses } = await setup();
    const done = await makeReady(diagnoses, '101');
    await diagnoses.complete(done);
    const review = await detect(diagnoses, '101', 'regression', 'event-2');
    await diagnoses.saveReport(review.id, report(), []);
    const latest = await detect(diagnoses, '101', 'regression', 'event-3');

    expect((await diagnoses.priorOf(latest.id))?.info).toEqual({ kind: 'in-review' });
    expect((await diagnoses.priorOf(review.id))?.info.kind).toBe('completed');
  });

  it('완료함에서 사라진 지 오래된 완료 진단도 앞선 진단으로 찾는다(완료 최소 기록은 기한이 없다)', async () => {
    const { diagnoses, clock } = await setup();
    const first = await makeReady(diagnoses, '101');
    await diagnoses.recordExport(first, { path: '/내보냄/a.md', at: NOW, reportCreatedAt: NOW });
    await diagnoses.complete(first);
    clock.advance(30 * DAY);
    await diagnoses.archiveExpired();
    expect(diagnoses.get(first)).toBeUndefined();
    const second = await detect(diagnoses, '101', 'regression', 'event-2');

    expect(await diagnoses.priorOf(second.id)).toEqual({ info: { kind: 'completed', completedAt: NOW, exportPath: '/내보냄/a.md' }, report: null });
  });

  it('다른 오류 이슈의 진단은 앞선 진단이 아니다', async () => {
    const { diagnoses } = await setup();
    await makeReady(diagnoses, '101');
    const other = await detect(diagnoses, '102');

    expect(await diagnoses.priorOf(other.id)).toBeNull();
  });
});

describe('재현 첨부와 재현도 다시 하기', () => {
  /** 실제 첨부 폴더를 쓰는 진단 목록을 만든다. */
  async function setupWithFolders() {
    const env = await setup();
    const dataDir = mkdtempSync(join(tmpdir(), 'sentry-attachments-'));
    tempDirs.push(dataDir);
    const folders = new DiagnosisAttachmentFolders(dataDir);
    const diagnoses = new SentryDiagnoses({
      store: env.store,
      notifier: env.notifier,
      logger: createLogger([{ write: () => {} }], env.clock),
      clock: env.clock,
      resolveRepo: async () => ({ kind: 'mapped', path: '/repo' }),
      removeAttachments: (id) => folders.remove(id),
      replaceAttachments: (id, staged) => folders.replace(id, staged),
      discardAttachments: (staged) => folders.discard(staged),
    });
    await diagnoses.load();
    /** `files`를 담은 옮겨 둔 첨부 폴더를 만든다. */
    const staged = async (...files: string[]) => {
      const dir = await folders.createStaging();
      for (const file of files) writeFileSync(join(dir, file), file);
      return dir;
    };
    return { ...env, diagnoses, folders, staged };
  }

  it('처음 진단의 첨부를 진단 폴더에 넣고, 재현하는 다시 진단이 성공하면 앞선 첨부를 지운 뒤 새 첨부를 넣어 새 첨부가 남는다', async () => {
    const { diagnoses, folders, staged } = await setupWithFolders();
    const detected = await detect(diagnoses, '101');
    expect(await diagnoses.saveReport(detected.id, report('failure'), [], { kind: 'replace', staged: await staged('old.png') })).toBe(true);
    expect(await folders.list(detected.id)).toEqual(['old.png']);
    await diagnoses.rediagnose(detected.id, null);

    expect(await diagnoses.saveReport(detected.id, report('success'), [], { kind: 'replace', staged: await staged('new.png', 'server.log') })).toBe(true);

    expect(await folders.list(detected.id)).toEqual(['new.png', 'server.log']);
  });

  it('지시를 덧붙이며 재현도 다시 하기를 끄면 그 다시 진단은 앞선 재현 칸과 첨부를 옮기기로 표시되고, 성공해도 앞선 첨부가 그대로 남는다', async () => {
    const { diagnoses, folders, staged, open } = await setupWithFolders();
    const detected = await detect(diagnoses, '101');
    await diagnoses.saveReport(detected.id, report('success'), [], { kind: 'replace', staged: await staged('shot.png') });

    await diagnoses.rediagnose(detected.id, '원인을 더 자세히', { reproduce: false });
    expect(diagnoses.get(detected.id)?.keepReproduction).toBe(true);
    // 앱을 다시 켜도 고른 값이 남는다.
    const reopened = open();
    await reopened.load();
    expect(reopened.get(detected.id)?.keepReproduction).toBe(true);

    expect(await diagnoses.saveReport(detected.id, report('success'), [], { kind: 'keep' })).toBe(true);

    expect(await folders.list(detected.id)).toEqual(['shot.png']);
    expect(diagnoses.get(detected.id)?.keepReproduction).toBe(false);
  });

  it('지시 없는 다시 진단은 늘 재현하고, 재현을 끈 다시 진단이 실패해 돌아와도 표시를 되돌린다', async () => {
    const { diagnoses } = await setupWithFolders();
    const id = (await detect(diagnoses, '101')).id;
    await diagnoses.saveReport(id, report('success'), []);

    await diagnoses.rediagnose(id, null, { reproduce: false });
    expect(diagnoses.get(id)?.keepReproduction).toBe(false);
    await diagnoses.markFailed(id, CANCELLED, []);

    await diagnoses.rediagnose(id, '다시', { reproduce: false });
    await diagnoses.markFailed(id, CANCELLED, []);
    expect(diagnoses.get(id)?.keepReproduction).toBe(false);
  });

  it('그사이 취소돼 보고서를 저장하지 못하면 옮겨 둔 첨부를 버린다', async () => {
    const { diagnoses, folders, staged } = await setupWithFolders();
    const id = (await detect(diagnoses, '101')).id;
    await diagnoses.markFailed(id, CANCELLED, []);
    const dir = await staged('a.png');

    expect(await diagnoses.saveReport(id, report('success'), [], { kind: 'replace', staged: dir })).toBe(false);

    expect(existsSync(dir)).toBe(false);
    expect(await folders.list(id)).toEqual([]);
  });
});
