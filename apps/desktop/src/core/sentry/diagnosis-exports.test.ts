import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger } from '../logging/logger';
import type { SentryErrorIssue } from '../ports/sentry-api';
import type { SentryProjectRegistration } from '../ports/settings-store';
import { openStateDatabase, STATE_MIGRATIONS } from '../storage/state-database';
import { SqliteSentryStore } from '../storage/sqlite-sentry-store';
import { DiagnosisAttachmentFolders } from './diagnosis-attachments';
import { DiagnosisExports, DiagnosisReportFolder } from './diagnosis-exports';
import { SentryDiagnoses } from './sentry-diagnoses';
import { hasExportedCurrentReport, type DiagnosisReport } from './sentry-diagnosis';

/** 지금. */
const NOW = Date.UTC(2026, 10, 26, 12);

/** 시험이 만든 임시 폴더. */
const tempDirs: string[] = [];
/** 시험이 연 DB. */
const openDbs: { close(): void }[] = [];

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더를 만든다. */
function makeDir(): string {
  /** 만든 폴더. */
  const dir = mkdtempSync(join(tmpdir(), 'diagnosis-exports-'));
  tempDirs.push(dir);
  return dir;
}

/** 등록한 프로젝트. */
const REGISTRATION: SentryProjectRegistration = {
  projectId: '11',
  organizationId: '1',
  organizationSlug: 'org-a',
  organizationName: '가짜 조직',
  projectSlug: 'web',
  projectName: '가짜 프로젝트',
  environment: null,
  levels: ['error'],
  registeredAt: new Date(NOW - 3_600_000).toISOString(),
};

/** 목록에서 읽은 오류 이슈. */
function listed(id: string): SentryErrorIssue {
  return { id, shortId: `WEB-${id}`, title: `시험 오류 ${id}`, culprit: 'src/a.ts', level: 'error', firstSeen: NOW - 60_000, lastSeen: NOW, count: 1, userCount: 1, permalink: null, platform: 'javascript' };
}

/** `createdAt`만 다른 가짜 보고서. */
function report(createdAt = NOW): DiagnosisReport {
  return {
    summary: '요약',
    reproduction: { result: 'impossible', impossibleReason: 'not-allowed', method: '', steps: [] },
    cause: { text: '원인', confidence: 'low' },
    improvements: [],
    openQuestions: [],
    evidence: [],
    event: { eventId: 'e1', release: null, firstRelease: null, lastRelease: null, sourceMaps: 'unknown', missingData: [], stackHead: [] },
    run: { repository: '/fake/web', headCommit: null, uncommittedChanges: null, reproductionAllowed: false, agent: 'claude-code', cliVersion: null, durationMs: 1000, createdAt },
    priorDiagnosis: null,
  };
}

/** 실제 SQLite 진단 목록과 임시 폴더로 내보내기를 만든다. */
async function setup() {
  const clock = new FakeClock(NOW);
  const logger = createLogger([{ write: () => {} }], clock);
  /** 앱 데이터와 보고서 폴더. */
  const [dataDir, reportDir] = [makeDir(), join(makeDir(), 'Reports')];
  const db = openStateDatabase(join(dataDir, 'state.db'), STATE_MIGRATIONS, '0.1.0');
  openDbs.push(db);
  const attachments = new DiagnosisAttachmentFolders(dataDir);
  const diagnoses = new SentryDiagnoses({
    store: new SqliteSentryStore(db),
    notifier: new RecordingNotifier(),
    logger,
    clock,
    resolveRepo: async () => ({ kind: 'mapped', path: '/fake/web' }),
    removeAttachments: (id) => attachments.remove(id),
  });
  await diagnoses.load();
  const settingsStore = new MemorySettingsStore();
  const folder = new DiagnosisReportFolder({ settingsStore, defaultFolder: reportDir, logger });
  await folder.load();
  const exports = new DiagnosisExports({ diagnoses, folder, attachments, clock, logger });

  /** 오류 이슈 하나를 감지해 검토 대기 보고서로 만든다. */
  async function ready(issueId = '101', createdAt = NOW): Promise<number> {
    await diagnoses.record({ registration: REGISTRATION, checkpoint: NOW, detectedAt: NOW, detected: [{ origin: 'new', issue: listed(issueId), eventId: null }] });
    /** 방금 만든 진단. */
    const created = diagnoses.list().filter((item) => item.issueId === issueId).at(-1)!;
    await diagnoses.saveReport(created.id, report(createdAt), []);
    return created.id;
  }
  return { clock, diagnoses, attachments, folder, settingsStore, exports, reportDir, ready };
}

describe('보고서 내보내기 흐름', () => {
  it('내보내면 설정 폴더에 파일이 생기고 내보낸 기록이 남지만 상태는 바뀌지 않는다', async () => {
    const { exports, diagnoses, reportDir, ready } = await setup();
    const id = await ready();

    const result = await exports.export(id);

    expect(result?.path.startsWith(reportDir)).toBe(true);
    expect(readdirSync(reportDir)).toHaveLength(1);
    expect(diagnoses.get(id)).toMatchObject({ status: 'ready', lastExport: { path: result?.path, at: NOW, reportCreatedAt: NOW } });
  });

  it('몇 번이든 내보낼 수 있고 파일은 -2로 늘어난다', async () => {
    const { exports, ready, reportDir } = await setup();
    const id = await ready();

    const names = [(await exports.export(id))?.fileName, (await exports.export(id))?.fileName];

    expect(names[1]).toBe(names[0]!.replace(/\.md$/, '-2.md'));
    expect(readdirSync(reportDir)).toHaveLength(2);
  });

  it('첨부가 있으면 앱 데이터의 첨부 폴더에서 보고서 옆으로 복사한다', async () => {
    const { exports, attachments, ready, reportDir } = await setup();
    const id = await ready();
    /** 첨부 폴더에 파일을 만든다. */
    const { mkdirSync } = await import('node:fs');
    mkdirSync(attachments.dirOf(id), { recursive: true });
    writeFileSync(join(attachments.dirOf(id), 'run.log'), '로그');

    const result = await exports.export(id);

    expect(readdirSync(join(reportDir, result!.fileName.replace(/\.md$/, '')))).toEqual(['run.log']);
    // 앱 쪽 첨부는 완료 때까지 그대로 있다.
    expect(existsSync(join(attachments.dirOf(id), 'run.log'))).toBe(true);
  });

  it('보고서가 없는 진단(완료함 등)과 없는 진단은 내보내지 않는다', async () => {
    const { exports, diagnoses, ready, reportDir } = await setup();
    const id = await ready();
    await diagnoses.complete(id);

    expect(await exports.export(id)).toBeNull();
    expect(await exports.export(999)).toBeNull();
    expect(existsSync(reportDir)).toBe(false);
  });

  it('폴더를 만들 수 없으면 실패하고 내보낸 기록을 남기지 않는다', async () => {
    const { exports, diagnoses, folder, ready, reportDir } = await setup();
    const id = await ready();
    // 보고서 폴더가 있어야 할 자리에 파일을 둔다.
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(reportDir, '..'), { recursive: true });
    writeFileSync(reportDir, '폴더가 아닙니다');

    await expect(exports.export(id)).rejects.toThrow();

    expect(folder.path()).toBe(reportDir);
    expect(diagnoses.get(id)?.lastExport).toBeNull();
  });
});

describe('내보냈는지의 기준(완료 확인)', () => {
  it('내보내기 전에는 내보내지 않은 것이고 내보내면 내보낸 것이다', async () => {
    const { exports, diagnoses, ready } = await setup();
    const id = await ready();
    expect(hasExportedCurrentReport(diagnoses.get(id)!)).toBe(false);

    await exports.export(id);

    expect(hasExportedCurrentReport(diagnoses.get(id)!)).toBe(true);
  });

  it('보고서가 새로 생기면(다시 진단) 다시 내보내지 않은 것으로 본다', async () => {
    const { exports, diagnoses, ready } = await setup();
    const id = await ready();
    await exports.export(id);
    /** 내보낸 기록과 보고서. */
    const exported = diagnoses.get(id)!;

    // 다시 진단이 만든 새 보고서를 흉내 낸다: 보고서만 생성 시각이 달라진다.
    expect(hasExportedCurrentReport({ ...exported, report: report(NOW + 1) })).toBe(false);
    expect(hasExportedCurrentReport({ ...exported, report: null })).toBe(false);
  });

  it('완료한 뒤에도 마지막으로 내보낸 파일 경로가 최소 기록에 남는다', async () => {
    const { exports, diagnoses, ready } = await setup();
    const id = await ready();
    const exported = await exports.export(id);

    await diagnoses.complete(id);

    expect(diagnoses.get(id)).toMatchObject({ status: 'completed', report: null, lastExport: { path: exported?.path } });
  });

  it('앱을 다시 켜도 내보낸 기록이 남는다', async () => {
    const { exports, diagnoses, ready } = await setup();
    const id = await ready();
    const exported = await exports.export(id);

    // 표에서 다시 읽는다(저장소는 실제 SQLite).
    await diagnoses.load();

    expect(diagnoses.get(id)?.lastExport?.path).toBe(exported?.path);
  });
});

describe('보고서를 내보낼 폴더 설정', () => {
  it('고르지 않았으면 기본 폴더이고 토큰과 무관하게 읽힌다', async () => {
    const { folder, reportDir } = await setup();

    expect(folder.path()).toBe(reportDir);
    expect(folder.isDefault()).toBe(true);
  });

  it('바꾸면 settings.json에 저장하고 알리며, 다른 설정은 건드리지 않는다', async () => {
    const { folder, settingsStore } = await setup();
    await settingsStore.save({ ...(await settingsStore.load()), parallelWorkCount: 4 });
    /** 알림 횟수. */
    let notified = 0;
    folder.onChange(() => (notified += 1));
    /** 새 폴더. */
    const picked = makeDir();

    await folder.set(picked);

    expect(folder.path()).toBe(picked);
    expect(folder.isDefault()).toBe(false);
    expect(notified).toBe(1);
    expect(await settingsStore.load()).toMatchObject({ diagnosisReportFolder: picked, parallelWorkCount: 4 });
  });

  it('같은 폴더를 다시 고르면 알리지 않고, 기본 폴더를 고르면 고르지 않은 것으로 돌아간다', async () => {
    const { folder, settingsStore, reportDir } = await setup();
    const picked = makeDir();
    await folder.set(picked);
    /** 알림 횟수. */
    let notified = 0;
    folder.onChange(() => (notified += 1));

    await folder.set(picked);
    expect(notified).toBe(0);

    await folder.set(reportDir);
    expect(folder.isDefault()).toBe(true);
    expect((await settingsStore.load()).diagnosisReportFolder).toBeNull();
  });

  it('절대 경로가 아니면 받지 않는다', async () => {
    const { folder, reportDir } = await setup();

    await folder.set('상대/경로');
    await folder.set('');

    expect(folder.path()).toBe(reportDir);
  });

  it('손으로 고친 설정 파일의 상대 경로는 고르지 않은 것으로 읽는다', async () => {
    const { settingsStore, reportDir } = await setup();
    await settingsStore.save({ ...(await settingsStore.load()), diagnosisReportFolder: 'relative' });
    const folder = new DiagnosisReportFolder({ settingsStore, defaultFolder: reportDir, logger: createLogger([{ write: () => {} }], new FakeClock(NOW)) });

    await folder.load();

    expect(folder.path()).toBe(reportDir);
  });
});
