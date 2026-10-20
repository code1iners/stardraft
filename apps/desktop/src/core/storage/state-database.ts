import Database from 'better-sqlite3';
import type { StateStore } from '../ports/state-store';

/** 열린 `state.db` 연결. */
export type StateDatabase = Database.Database;

/**
 * 이 앱이 아는 `state.db` 마이그레이션. 배열의 n번째(0부터)가 `user_version` n을 n+1로 올린다.
 * 마지막 버전이 곧 이 앱이 아는 `user_version`이다. 이미 나간 항목은 고치지 않고, 바꿀 것은 새 항목으로 더한다.
 * `app_meta`는 옛 버전 앱이 다운그레이드 안내에 쓸 버전을 읽는 곳이라 이름과 열을 바꾸지 않는다.
 */
export const STATE_MIGRATIONS: readonly string[] = [
  // 1: 데이터를 쓴 앱 버전, 계정, 기준점.
  `
  CREATE TABLE app_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    app_version TEXT NOT NULL
  ) STRICT;
  CREATE TABLE account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    user_id TEXT NOT NULL
  ) STRICT;
  CREATE TABLE detection (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    baseline_alarm_id TEXT NOT NULL
  ) STRICT;
  `,
];

/** `state.db`를 연다. 파일이 없으면 빈 DB를 만든다. 형식 검사 전이라 설정은 바꾸지 않는다. */
export function openStateDatabase(path: string): StateDatabase {
  return new Database(path);
}

/** `state.db`의 형식 버전(`PRAGMA user_version`). */
export function readStateSchemaVersion(db: StateDatabase): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/** 이 DB를 마지막으로 쓴 앱 버전. 기록이 없거나 읽을 수 없으면 `null`. */
export function readStateAppVersion(db: StateDatabase): string | null {
  try {
    /** `app_meta`의 한 줄. */
    const row = db.prepare('SELECT app_version FROM app_meta WHERE id = 1').get() as { app_version: unknown } | undefined;
    return typeof row?.app_version === 'string' ? row.app_version : null;
  } catch {
    return null;
  }
}

/**
 * 연결 설정을 켠다. WAL은 파일에 남고, `secure_delete`와 외래 키는 연결마다 켠다.
 * `secure_delete`는 지운 행을 0으로 덮어, 보관 기간이 지나 지운 Flow 글이 파일에 남지 않게 한다.
 */
export function configureStateDatabase(db: StateDatabase): void {
  db.pragma('journal_mode = WAL');
  db.pragma('secure_delete = ON');
  db.pragma('foreign_keys = ON');
}

/** 지금 버전부터 마지막 버전까지 한 트랜잭션으로 올린다. 하나라도 실패하면 올리기 전 그대로 남는다. */
export function migrateStateDatabase(db: StateDatabase, migrations: readonly string[]): void {
  /** 올리기 전 버전. */
  const from = readStateSchemaVersion(db);
  db.transaction(() => {
    for (let version = from; version < migrations.length; version += 1) {
      db.exec(migrations[version] ?? '');
      db.pragma(`user_version = ${version + 1}`);
    }
  })();
}

/** 이 DB를 마지막으로 쓴 앱 버전을 남긴다. */
export function recordStateAppVersion(db: StateDatabase, appVersion: string): void {
  db.prepare(
    'INSERT INTO app_meta (id, app_version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET app_version = excluded.app_version',
  ).run(appVersion);
}

/** 형식 검사를 마친 DB를 지금 상태 그대로 다른 파일에 복사한다. WAL에만 있는 내용도 사본에 들어간다. */
export function copyStateDatabase(db: StateDatabase, targetPath: string): void {
  db.prepare('VACUUM INTO ?').run(targetPath);
}

/** `state.db`를 쓰는 상태 저장소. 연결을 열고 마이그레이션하는 일은 `openAppData`가 한다. */
export class SqliteStateStore implements StateStore {
  constructor(private readonly db: StateDatabase) {}

  async getAccountUserId(): Promise<string | null> {
    /** 계정 한 줄. */
    const row = this.db.prepare('SELECT user_id FROM account WHERE id = 1').get() as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  async setAccountUserId(userId: string): Promise<void> {
    this.db
      .prepare('INSERT INTO account (id, user_id) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET user_id = excluded.user_id')
      .run(userId);
  }

  async getBaselineAlarmId(): Promise<string | null> {
    /** 감지 상태 한 줄. */
    const row = this.db.prepare('SELECT baseline_alarm_id FROM detection WHERE id = 1').get() as
      | { baseline_alarm_id: string }
      | undefined;
    return row?.baseline_alarm_id ?? null;
  }

  async setBaselineAlarmId(alarmId: string): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO detection (id, baseline_alarm_id) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET baseline_alarm_id = excluded.baseline_alarm_id',
      )
      .run(alarmId);
  }
}
