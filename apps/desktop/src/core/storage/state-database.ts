import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import type { Mention, MentionLocation } from '../detection/mention';
import type { FlowEmployee } from '../ports/flow-api';
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
  // 2: 설정 창의 계정 카드에 보일 계정의 이름·소속·이메일. 사용자 ID만 있던 계정은 이름과 이메일 자리를 사용자 ID로 채운다.
  `
  ALTER TABLE account ADD COLUMN name TEXT NOT NULL DEFAULT '';
  ALTER TABLE account ADD COLUMN division TEXT NOT NULL DEFAULT '';
  ALTER TABLE account ADD COLUMN email TEXT NOT NULL DEFAULT '';
  UPDATE account SET name = user_id, email = user_id;
  `,
  // 3: 판정을 통과한 멘션. 멘션 위치로 식별하므로 같은 위치는 한 줄이다.
  `
  CREATE TABLE mention (
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    reply_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    alarm_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    registered_date_time TEXT NOT NULL,
    detected_at INTEGER NOT NULL,
    PRIMARY KEY (post_id, remark_id, reply_id)
  ) STRICT;
  `,
];

/** 다른 계정으로 처음부터 시작할 때도 지우지 않는 표. 옛 버전 앱이 다운그레이드 안내에 쓰는 앱 버전 기록이다. */
const TABLES_KEPT_ON_RESET: ReadonlySet<string> = new Set(['app_meta']);

/** 열기 전에 읽은 `state.db`의 형식. */
export interface StateDatabaseInfo {
  /** `PRAGMA user_version`. 파일이 없으면 0이다. */
  schemaVersion: number;
  /** 이 DB를 마지막으로 쓴 앱 버전. 기록이 없거나 읽을 수 없으면 `null`. */
  appVersion: string | null;
}

/**
 * `state.db`를 바꾸지 않고 형식을 읽는다. 파일이 없으면 만들지 않는다.
 * 읽기 전용 연결은 닫을 때 체크포인트를 하지 않으므로, 새 버전이 WAL에만 남긴 내용도 그대로 남는다.
 */
export function inspectStateDatabase(path: string): StateDatabaseInfo {
  if (!existsSync(path)) return { schemaVersion: 0, appVersion: null };

  /** 읽기 전용 연결. */
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return { schemaVersion: db.pragma('user_version', { simple: true }) as number, appVersion: readAppVersion(db) };
  } finally {
    db.close();
  }
}

/** 지금 내용 그대로 다른 파일에 복사한다. WAL에만 있는 내용도 사본에 들어간다. */
export function copyStateDatabase(path: string, targetPath: string): void {
  /** 읽기 전용 연결. */
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    db.prepare('VACUUM INTO ?').run(targetPath);
  } finally {
    db.close();
  }
}

/**
 * `state.db`를 열어 마지막 형식으로 올리고, 이 앱 버전을 남긴다. 파일이 없으면 만든다.
 * 형식 검사(`inspectStateDatabase`)를 마친 뒤에만 부른다.
 */
export function openStateDatabase(path: string, migrations: readonly string[], appVersion: string): StateDatabase {
  /** 읽기·쓰기 연결. */
  const db = new Database(path);
  try {
    // WAL은 파일에 남고, secure_delete와 외래 키는 연결마다 켠다.
    // secure_delete는 지운 행을 0으로 덮어, 보관 기간이 지나 지운 Flow 글이 파일에 남지 않게 한다.
    db.pragma('journal_mode = WAL');
    db.pragma('secure_delete = ON');
    db.pragma('foreign_keys = ON');

    // 지금 버전부터 마지막 버전까지 한 트랜잭션으로 올린다. 하나라도 실패하면 올리기 전 그대로 남는다.
    /** 올리기 전 버전. */
    const from = db.pragma('user_version', { simple: true }) as number;
    db.transaction(() => {
      for (let version = from; version < migrations.length; version += 1) {
        db.exec(migrations[version] ?? '');
        db.pragma(`user_version = ${version + 1}`);
      }
    })();

    db.prepare(
      'INSERT INTO app_meta (id, app_version) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET app_version = excluded.app_version',
    ).run(appVersion);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** `app_meta`에 남은 앱 버전. */
function readAppVersion(db: StateDatabase): string | null {
  try {
    /** `app_meta`의 한 줄. */
    const row = db.prepare('SELECT app_version FROM app_meta WHERE id = 1').get() as { app_version: unknown } | undefined;
    return typeof row?.app_version === 'string' ? row.app_version : null;
  } catch {
    return null;
  }
}

/** `state.db`를 쓰는 상태 저장소. 연결을 열고 마이그레이션하는 일은 `openStateDatabase`가 한다. */
export class SqliteStateStore implements StateStore {
  constructor(private readonly db: StateDatabase) {}

  async getAccount(): Promise<FlowEmployee | null> {
    /** 계정 한 줄. */
    const row = this.db.prepare('SELECT user_id, name, division, email FROM account WHERE id = 1').get() as
      | { user_id: string; name: string; division: string; email: string }
      | undefined;
    return row ? { userId: row.user_id, name: row.name, division: row.division, email: row.email } : null;
  }

  async setAccount(account: FlowEmployee): Promise<void> {
    this.writeAccount(account);
  }

  async resetForAccount(account: FlowEmployee): Promise<void> {
    // 뒤 티켓이 더하는 표도 빠짐없이 지우도록, 표 목록을 코드에 적지 않고 DB에서 읽는다.
    /** 지울 표 이름. */
    const tables = (this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[])
      .map((row) => row.name)
      .filter((name) => !name.startsWith('sqlite_') && !TABLES_KEPT_ON_RESET.has(name));

    // 모두 지우고 새 계정을 넣는 일을 한 트랜잭션으로 한다. 중간에 실패하면 지우기 전 그대로 남는다.
    this.db.transaction(() => {
      // 표끼리 외래 키가 있어도 지우는 순서와 상관없이 지우도록 검사를 커밋 때로 미룬다. 커밋 때는 모두 비어 있다.
      this.db.pragma('defer_foreign_keys = ON');
      for (const table of tables) this.db.exec(`DELETE FROM "${table.replaceAll('"', '""')}"`);
      this.writeAccount(account);
    })();

    // secure_delete는 본 파일의 지운 자리만 덮으므로, 옛 계정의 글이 WAL에 남지 않게 본 파일에 반영하고 WAL을 비운다.
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /** 계정 한 줄을 넣거나 바꾼다. */
  private writeAccount(account: FlowEmployee): void {
    this.db
      .prepare(
        `INSERT INTO account (id, user_id, name, division, email) VALUES (1, @userId, @name, @division, @email)
         ON CONFLICT (id) DO UPDATE SET
           user_id = excluded.user_id, name = excluded.name, division = excluded.division, email = excluded.email`,
      )
      .run(account);
  }

  async getBaselineAlarmId(): Promise<string | null> {
    /** 감지 상태 한 줄. */
    const row = this.db.prepare('SELECT baseline_alarm_id FROM detection WHERE id = 1').get() as
      | { baseline_alarm_id: string }
      | undefined;
    return row?.baseline_alarm_id ?? null;
  }

  async setBaselineAlarmId(alarmId: string): Promise<void> {
    this.writeBaseline(alarmId);
  }

  async hasMentionLocation({ postId, remarkId, replyId }: MentionLocation): Promise<boolean> {
    return (
      this.db.prepare('SELECT 1 FROM mention WHERE post_id = ? AND remark_id = ? AND reply_id = ?').get(postId, remarkId, replyId) !==
      undefined
    );
  }

  async addDetectedMentions(mentions: readonly Mention[], baselineAlarmId: string): Promise<Mention[]> {
    /** 멘션 하나를 넣는 문장. 같은 멘션 위치가 있으면 넣지 않는다. */
    const insert = this.db.prepare(
      `INSERT INTO mention (post_id, remark_id, reply_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at)
       VALUES (@postId, @remarkId, @replyId, @projectId, @alarmId, @senderId, @senderName, @registeredDateTime, @detectedAt)
       ON CONFLICT DO NOTHING`,
    );
    return this.db.transaction(() => {
      /** 새로 넣은 멘션. */
      const added = mentions.filter((mention) => insert.run(mention).changes > 0);
      this.writeBaseline(baselineAlarmId);
      return added.map((mention) => ({ ...mention }));
    })();
  }

  async listMentions(): Promise<Mention[]> {
    /** 멘션 줄. 알림 시각, 같으면 alarmId 크기 순서다. */
    const rows = this.db
      .prepare(
        `SELECT post_id, remark_id, reply_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at
         FROM mention ORDER BY registered_date_time, length(alarm_id), alarm_id`,
      )
      .all() as MentionRow[];
    return rows.map((row) => ({
      postId: row.post_id,
      remarkId: row.remark_id,
      replyId: row.reply_id,
      projectId: row.project_id,
      alarmId: row.alarm_id,
      senderId: row.sender_id,
      senderName: row.sender_name,
      registeredDateTime: row.registered_date_time,
      detectedAt: row.detected_at,
    }));
  }

  async countMentions(): Promise<number> {
    return (this.db.prepare('SELECT count(*) AS count FROM mention').get() as { count: number }).count;
  }

  /** 기준점 한 줄을 넣거나 바꾼다. */
  private writeBaseline(alarmId: string): void {
    this.db
      .prepare(
        'INSERT INTO detection (id, baseline_alarm_id) VALUES (1, ?) ON CONFLICT (id) DO UPDATE SET baseline_alarm_id = excluded.baseline_alarm_id',
      )
      .run(alarmId);
  }
}

/** `mention` 표의 한 줄. */
interface MentionRow {
  /** 게시물 ID. */
  post_id: string;
  /** 댓글 ID. 본문 멘션이면 `"-1"`. */
  remark_id: string;
  /** 대댓글 ID. 대댓글 멘션이 아니면 `"-1"`. */
  reply_id: string;
  /** Flow 프로젝트 ID. */
  project_id: string;
  /** 멘션을 알린 알림 ID. */
  alarm_id: string;
  /** 송신자의 사용자 ID. */
  sender_id: string;
  /** 송신자 이름. */
  sender_name: string;
  /** 알림 시각(Flow 형식). */
  registered_date_time: string;
  /** 감지한 시각(Unix epoch 밀리초). */
  detected_at: number;
}
