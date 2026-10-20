import Database from 'better-sqlite3';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeEncryption } from '../fakes/fake-encryption';
import { createLogger } from '../logging/logger';
import type { FlowEmployee } from '../ports/flow-api';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../ports/settings-store';
import { openAppData, type AppData, type OpenAppDataOptions } from './app-data';
import { SETTINGS_MIGRATIONS } from './file-settings-store';
import { STATE_MIGRATIONS } from './state-database';

/** 테스트마다 만드는 임시 데이터 폴더. */
let dataDir: string;
/** 테스트가 연 데이터. 끝나면 닫는다. */
let opened: AppData | null = null;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'stardraft-data-'));
});

afterEach(() => {
  opened?.close();
  opened = null;
  rmSync(dataDir, { recursive: true, force: true });
});

/** 아무 데도 남기지 않는 로거. */
const silentLogger = createLogger([], new FakeClock());

/** 테스트용 Flow 계정. 실제 사람이 아니다. */
const FAKE_ACCOUNT: FlowEmployee = {
  userId: 'fake-user-1@example.test',
  name: '테스트 사용자',
  division: '테스트 팀',
  email: 'fake-user-1@example.test',
};

/** 임시 데이터 폴더를 열고, 준비됐으면 테스트가 끝날 때 닫게 기록한다. */
async function open(options: Partial<OpenAppDataOptions> = {}) {
  const result = await openAppData({
    dataDir,
    appVersion: '0.1.0',
    logger: silentLogger,
    encryption: new FakeEncryption(),
    ...options,
  });
  if (result.kind === 'ready') opened = result;
  return result;
}

/** 열어서 준비된 데이터. 준비되지 않으면 테스트를 실패시킨다. */
async function openReady(options: Partial<OpenAppDataOptions> = {}): Promise<AppData> {
  const result = await open(options);
  if (result.kind !== 'ready') throw new Error(`준비되지 않음: ${result.message}`);
  return result;
}

/** 열었던 데이터를 닫는다. 다시 켜는 상황을 흉내 낼 때 쓴다. */
function closeOpened(): void {
  opened?.close();
  opened = null;
}

/** 데이터 폴더의 파일. */
const statePath = () => join(dataDir, 'state.db');
const settingsPath = () => join(dataDir, 'settings.json');

/** 다른 앱 버전이 만든 `state.db`를 흉내 낸다. */
function writeStateDb(userVersion: number, setup: string, appVersion: string | null): void {
  const db = new Database(statePath());
  db.exec(setup);
  if (appVersion) {
    db.exec('CREATE TABLE IF NOT EXISTS app_meta (id INTEGER PRIMARY KEY CHECK (id = 1), app_version TEXT NOT NULL)');
    db.prepare('INSERT INTO app_meta (id, app_version) VALUES (1, ?)').run(appVersion);
  }
  db.pragma(`user_version = ${userVersion}`);
  db.close();
}

/** `state.db`의 `user_version`. */
function readUserVersion(path = statePath()): number {
  const db = new Database(path, { readonly: true });
  try {
    return db.pragma('user_version', { simple: true }) as number;
  } finally {
    db.close();
  }
}

describe('데이터 폴더 열기', () => {
  it('첫 실행이면 데이터 폴더에 settings.json과 state.db를 만든다', async () => {
    const nested = join(dataDir, 'Stardraft');

    const data = await openReady({ dataDir: nested });

    expect(readdirSync(nested)).toEqual(expect.arrayContaining(['settings.json', 'state.db']));
    expect(readdirSync(nested)).not.toContain('backups');
    await expect(data.settingsStore.load()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(JSON.parse(readFileSync(join(nested, 'settings.json'), 'utf8'))).toMatchObject({
      schemaVersion: SETTINGS_SCHEMA_VERSION,
    });
    closeOpened();
    expect(readUserVersion(join(nested, 'state.db'))).toBe(STATE_MIGRATIONS.length);
  });

  it('상태 저장소에 저장한 계정(이름·소속·이메일 포함)과 기준점이 다시 켠 뒤에도 남는다', async () => {
    const first = await openReady();
    await first.stateStore.setAccount(FAKE_ACCOUNT);
    await first.stateStore.setBaselineAlarmId('1001');
    closeOpened();

    const second = await openReady();

    await expect(second.stateStore.getAccount()).resolves.toEqual(FAKE_ACCOUNT);
    await expect(second.stateStore.getBaselineAlarmId()).resolves.toBe('1001');
  });

  it('처음에는 계정과 기준점이 없다', async () => {
    const data = await openReady();

    await expect(data.stateStore.getAccount()).resolves.toBeNull();
    await expect(data.stateStore.getBaselineAlarmId()).resolves.toBeNull();
  });

  it('Flow 개인 API 키는 데이터 폴더의 파일에 암호문으로 남고, 다시 켠 뒤에도 읽힌다', async () => {
    const first = await openReady();
    await first.secretStore.writeFlowApiKey('fake-key-1');
    closeOpened();

    const second = await openReady();

    await expect(second.secretStore.readFlowApiKey()).resolves.toEqual({ kind: 'found', value: 'fake-key-1' });
    expect(readdirSync(dataDir)).toContain('flow-api-key.bin');
    expect(readFileSync(join(dataDir, 'flow-api-key.bin')).includes(Buffer.from('fake-key-1'))).toBe(false);
  });

  it('state.db는 WAL로 쓴다', async () => {
    const data = await openReady();
    await data.stateStore.setBaselineAlarmId('1');

    expect(existsSync(`${statePath()}-wal`)).toBe(true);
  });
});

describe('다운그레이드 차단', () => {
  it('앱이 아는 것보다 큰 user_version이면 실행하지 않고 만든 버전을 안내하며, 데이터를 건드리지 않는다', async () => {
    writeStateDb(
      STATE_MIGRATIONS.length + 5,
      "CREATE TABLE future_mentions (id TEXT); INSERT INTO future_mentions VALUES ('m-1');",
      '0.9.0',
    );
    writeFileSync(settingsPath(), JSON.stringify({ ...DEFAULT_SETTINGS, workFolders: ['/fake/code'] }));
    /** 열기 전 두 파일 내용. */
    const stateBefore = readFileSync(statePath());
    const settingsBefore = readFileSync(settingsPath());

    const result = await open();

    expect(result).toEqual({
      kind: 'newer-data',
      createdByVersion: '0.9.0',
      message: '이 데이터는 더 새 버전(v0.9.0)에서 만들어졌습니다. 새 버전을 다시 설치하세요.',
    });
    expect(readFileSync(statePath()).equals(stateBefore)).toBe(true);
    expect(readFileSync(settingsPath()).equals(settingsBefore)).toBe(true);
    expect(readdirSync(dataDir).sort()).toEqual(['settings.json', 'state.db']);
  });

  it('새 버전이 WAL에만 남긴 내용도 건드리지 않는다', async () => {
    // 새 버전 앱이 체크포인트 전에 꺼진 상태를 흉내 낸다. 연결을 연 채로 본 파일과 WAL 파일을 복사한다.
    /** 새 버전 앱이 쓰던 DB 경로. */
    const livePath = join(dataDir, 'live.db');
    const live = new Database(livePath);
    live.pragma('journal_mode = WAL');
    live.pragma('wal_autocheckpoint = 0');
    live.exec("CREATE TABLE app_meta (id INTEGER PRIMARY KEY, app_version TEXT NOT NULL); INSERT INTO app_meta VALUES (1, '0.9.0');");
    live.pragma(`user_version = ${STATE_MIGRATIONS.length + 1}`);
    writeFileSync(statePath(), readFileSync(livePath));
    writeFileSync(`${statePath()}-wal`, readFileSync(`${livePath}-wal`));
    live.close();
    rmSync(livePath);
    /** 열기 전 두 파일 내용. */
    const stateBefore = readFileSync(statePath());
    const walBefore = readFileSync(`${statePath()}-wal`);

    const result = await open();

    expect(result).toMatchObject({ kind: 'newer-data', createdByVersion: '0.9.0' });
    expect(readFileSync(statePath()).equals(stateBefore)).toBe(true);
    expect(readFileSync(`${statePath()}-wal`).equals(walBefore)).toBe(true);
  });

  it('settings.json만 새 버전이고 state.db가 없으면 state.db를 만들지 않는다', async () => {
    writeFileSync(settingsPath(), JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION + 1, appVersion: '0.7.2' }));

    const result = await open();

    expect(result).toMatchObject({ kind: 'newer-data', createdByVersion: '0.7.2' });
    expect(readdirSync(dataDir)).toEqual(['settings.json']);
  });

  it('새 state.db에서 만든 버전을 읽지 못하면 버전 없이 안내한다', async () => {
    writeStateDb(STATE_MIGRATIONS.length + 1, 'CREATE TABLE renamed_meta (v TEXT);', null);

    const result = await open();

    expect(result).toMatchObject({
      kind: 'newer-data',
      createdByVersion: null,
      message: '이 데이터는 더 새 버전에서 만들어졌습니다. 새 버전을 다시 설치하세요.',
    });
  });

  it('앱이 아는 것보다 큰 schemaVersion이면 실행하지 않고, state.db도 마이그레이션하지 않는다', async () => {
    writeStateDb(1, 'SELECT 1;', '0.1.0');
    writeFileSync(settingsPath(), JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION + 1, appVersion: '0.7.2' }));
    /** 열기 전 파일 내용. */
    const settingsBefore = readFileSync(settingsPath());
    /** 아직 버전 1까지만 아는 앱이 열기 전 상태를 흉내 내려고, 마이그레이션을 하나 더 둔 앱으로 연다. */
    const stateMigrations = [...STATE_MIGRATIONS, 'CREATE TABLE added_later (id INTEGER);'];

    const result = await open({ stateMigrations });

    expect(result).toMatchObject({ kind: 'newer-data', createdByVersion: '0.7.2' });
    expect(readFileSync(settingsPath()).equals(settingsBefore)).toBe(true);
    expect(readUserVersion()).toBe(1);
    expect(existsSync(join(dataDir, 'backups'))).toBe(false);
  });
});

describe('마이그레이션', () => {
  it('state.db를 올리기 직전에 state.db와 settings.json의 사본을 앱 버전 이름으로 남긴다', async () => {
    const first = await openReady({ appVersion: '0.1.0' });
    await first.stateStore.setAccount(FAKE_ACCOUNT);
    await first.settingsStore.save({ ...DEFAULT_SETTINGS, workFolders: ['/fake/code'] });
    closeOpened();
    /** 마이그레이션 전 settings.json 내용. */
    const settingsBefore = readFileSync(settingsPath(), 'utf8');

    const second = await openReady({
      appVersion: '0.2.0',
      stateMigrations: [...STATE_MIGRATIONS, "CREATE TABLE mention_bundles (id TEXT PRIMARY KEY, status TEXT NOT NULL);"],
    });

    // 올린 뒤에도 원래 기록은 남는다.
    await expect(second.stateStore.getAccount()).resolves.toEqual(FAKE_ACCOUNT);
    closeOpened();
    expect(readUserVersion()).toBe(STATE_MIGRATIONS.length + 1);

    // 사본은 올리기 전 내용 그대로다.
    /** 사본 폴더. */
    const backupDir = join(dataDir, 'backups', 'before-v0.2.0');
    expect(readdirSync(backupDir).sort()).toEqual(['settings.json', 'state.db']);
    expect(readUserVersion(join(backupDir, 'state.db'))).toBe(STATE_MIGRATIONS.length);
    expect(readFileSync(join(backupDir, 'settings.json'), 'utf8')).toBe(settingsBefore);
    /** 사본 DB. */
    const backup = new Database(join(backupDir, 'state.db'), { readonly: true });
    expect(backup.prepare('SELECT user_id FROM account').get()).toEqual({ user_id: FAKE_ACCOUNT.userId });
    backup.close();
  });

  it('사용자 ID만 담던 버전 1의 계정은 올린 뒤에도 남고, 이름과 이메일 자리는 사용자 ID로 채운다', async () => {
    writeStateDb(
      1,
      `${STATE_MIGRATIONS[0]} INSERT INTO account (id, user_id) VALUES (1, 'fake-user-1@example.test');`,
      '0.1.0',
    );

    const data = await openReady({ appVersion: '0.2.0' });

    await expect(data.stateStore.getAccount()).resolves.toEqual({
      userId: 'fake-user-1@example.test',
      name: 'fake-user-1@example.test',
      division: '',
      email: 'fake-user-1@example.test',
    });
  });

  it('settings.json을 올리기 직전에도 사본을 남기고, 올린 형식으로 다시 쓴다', async () => {
    await openReady({ appVersion: '0.1.0' });
    closeOpened();
    /** 마이그레이션 전 settings.json 내용. */
    const settingsBefore = readFileSync(settingsPath(), 'utf8');

    await openReady({
      appVersion: '0.2.0',
      settingsMigrations: [(raw) => ({ ...raw, workFolders: ['/fake/migrated'] })],
    });

    expect(JSON.parse(readFileSync(settingsPath(), 'utf8'))).toMatchObject({
      schemaVersion: 2,
      appVersion: '0.2.0',
      workFolders: ['/fake/migrated'],
    });
    expect(readFileSync(join(dataDir, 'backups', 'before-v0.2.0', 'settings.json'), 'utf8')).toBe(settingsBefore);
  });

  it('같은 버전으로 다시 올릴 때 먼저 남긴 사본을 덮어쓰지 않는다', async () => {
    const first = await openReady({ appVersion: '0.1.0' });
    await first.stateStore.setBaselineAlarmId('1001');
    closeOpened();
    /** 마이그레이션을 하나 더 둔 0.2.0. */
    const stateMigrations = [...STATE_MIGRATIONS, 'CREATE TABLE added_later (id INTEGER);'];
    /** 0.2.0이 settings.json도 올리게 한 변환. */
    const settingsMigrations = [(raw: Record<string, unknown>) => raw];
    await openReady({ appVersion: '0.2.0', stateMigrations, settingsMigrations });
    closeOpened();
    // state.db는 올라갔는데 settings.json 쓰기가 실패해 옛 형식으로 남은 상황을 흉내 낸다.
    writeFileSync(settingsPath(), JSON.stringify({ ...DEFAULT_SETTINGS, appVersion: '0.1.0' }));

    await openReady({ appVersion: '0.2.0', stateMigrations, settingsMigrations });
    closeOpened();

    expect(readUserVersion(join(dataDir, 'backups', 'before-v0.2.0', 'state.db'))).toBe(STATE_MIGRATIONS.length);
  });

  it('형식이 그대로면 사본을 만들지 않는다', async () => {
    await openReady({ appVersion: '0.1.0' });
    closeOpened();

    await openReady({ appVersion: '0.1.1' });

    expect(existsSync(join(dataDir, 'backups'))).toBe(false);
  });

  it('마이그레이션 SQL이 실패하면 state.db는 올리기 전 버전 그대로다', async () => {
    const first = await openReady();
    await first.stateStore.setBaselineAlarmId('1001');
    closeOpened();

    await expect(
      open({ appVersion: '0.2.0', stateMigrations: [...STATE_MIGRATIONS, 'CREATE TABLE ok (id INTEGER); SELECT * FROM missing_table;'] }),
    ).rejects.toThrow();

    expect(readUserVersion()).toBe(STATE_MIGRATIONS.length);
    /** 실패 뒤의 DB. */
    const db = new Database(statePath(), { readonly: true });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'ok'").get()).toBeUndefined();
    db.close();
  });

  it('앱이 아는 settings.json 형식 버전은 마이그레이션 수와 맞는다', () => {
    expect(SETTINGS_SCHEMA_VERSION).toBe(SETTINGS_MIGRATIONS.length + 1);
  });
});
