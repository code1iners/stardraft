import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { compareMentions, type BundleStatus, type MentionBundle, type RepoCheck, type UnsavedBundle } from '../bundles/mention-bundle';
import type { Draft, DraftFailure, RunRecord } from '../drafts/draft';
import type { BundleContext } from '../flow/bundle-context';
import type { MentionLocation } from '../detection/mention';
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
  // 4: 멘션 묶음과 묶음에 기록한 내 답. 멘션은 묶음에 들고 Flow 원문과 "이미 답함" 표시를 갖는다.
  // 이미 감지한 멘션은 자리마다 저장소 확인 필요 묶음으로 옮긴다. 원문은 받아 둔 적이 없어 비워 둔다.
  `
  CREATE TABLE mention_bundle (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    status TEXT NOT NULL,
    post_title TEXT NOT NULL,
    connect_url TEXT,
    new_mention_count INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    processed_at INTEGER
  ) STRICT;
  INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at)
    SELECT post_id, remark_id, min(project_id), 'repo-check-needed', '', NULL, 0, min(detected_at), NULL
    FROM mention GROUP BY post_id, remark_id ORDER BY min(registered_date_time), post_id, remark_id;
  CREATE TABLE mention_v4 (
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    reply_id TEXT NOT NULL,
    bundle_id INTEGER NOT NULL REFERENCES mention_bundle (id),
    project_id TEXT NOT NULL,
    alarm_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    registered_date_time TEXT NOT NULL,
    detected_at INTEGER NOT NULL,
    text TEXT NOT NULL,
    answered INTEGER NOT NULL,
    PRIMARY KEY (post_id, remark_id, reply_id)
  ) STRICT;
  INSERT INTO mention_v4
    SELECT m.post_id, m.remark_id, m.reply_id, b.id, m.project_id, m.alarm_id, m.sender_id, m.sender_name,
      m.registered_date_time, m.detected_at, '', 0
    FROM mention m JOIN mention_bundle b ON b.post_id = m.post_id AND b.remark_id = m.remark_id;
  DROP TABLE mention;
  ALTER TABLE mention_v4 RENAME TO mention;
  CREATE INDEX mention_bundle_id ON mention (bundle_id);
  CREATE TABLE bundle_answer (
    bundle_id INTEGER NOT NULL REFERENCES mention_bundle (id) ON DELETE CASCADE,
    answer_id TEXT NOT NULL,
    registered_date_time TEXT NOT NULL,
    excluded INTEGER NOT NULL,
    PRIMARY KEY (bundle_id, answer_id)
  ) STRICT;
  `,
  // 5: 묶음마다 마지막으로 조회한 맥락(비교 기준). JSON 한 덩어리로 둔다. 이미 있던 묶음은 조회한 적이 없어 비워 둔다.
  `
  ALTER TABLE mention_bundle ADD COLUMN context TEXT;
  `,
  // 6: 초안 실행의 결과. 저장소 확인 필요의 사유, 초안(요구·문단·근거·쓴 저장소), 실패 사유, 실행 기록을 맥락처럼 JSON으로 둔다.
  // 모두 묶음의 전체 기록이라 보관 기간이 지나면 묶음 줄에서 함께 지운다. 이미 있던 묶음은 초안을 만든 적이 없어 비워 둔다.
  `
  ALTER TABLE mention_bundle ADD COLUMN repo_check TEXT;
  ALTER TABLE mention_bundle ADD COLUMN draft TEXT;
  ALTER TABLE mention_bundle ADD COLUMN failure TEXT;
  ALTER TABLE mention_bundle ADD COLUMN runs TEXT NOT NULL DEFAULT '[]';
  `,
  // 7: 근거마다 위치를 찾았는지(`located`). 근거 위치 검증 전에 만든 초안의 근거는 보이던 대로 위치를 찾은 근거로 둔다.
  `
  UPDATE mention_bundle
     SET draft = json_set(draft, '$.evidence', (
           SELECT json_group_array(json_set(value, '$.located', json('true')) ORDER BY key)
             FROM json_each(draft, '$.evidence')))
   WHERE draft IS NOT NULL;
  `,
  // 8: 자동 선택. 초안에 자동 선택의 내력(`autoSelection`), 실패에 실패한 실행의 종류(`runKind`)를 둔다.
  // 자동 선택 전에 만든 초안은 저장소 매핑으로 만든 것이라 내력이 없고, 그때의 실패는 어느 실행에서 났는지 남기지 않았다.
  // 저장소 확인 필요의 새 사유는 `repo_check` JSON에 그대로 담기므로 열을 바꾸지 않는다.
  `
  UPDATE mention_bundle SET draft = json_set(draft, '$.autoSelection', json('null')) WHERE draft IS NOT NULL;
  UPDATE mention_bundle SET failure = json_set(failure, '$.runKind', json('null')) WHERE failure IS NOT NULL;
  `,
  // 9: 저장소 선택 창. 사용자가 고른 구성(저장소 절대 경로 배열)을 JSON으로 둔다. 이미 있던 묶음은 고른 적이 없어 비워 둔다.
  `
  ALTER TABLE mention_bundle ADD COLUMN user_repos TEXT;
  `,
  // 10: 초안 편집과 받는 사람. 편집본(편집기 텍스트)과 받는 사람에서 뺀 사람의 사용자 ID 배열(JSON)을 둔다.
  // 이미 있던 묶음은 편집하거나 뺀 적이 없다.
  `
  ALTER TABLE mention_bundle ADD COLUMN edited_text TEXT;
  ALTER TABLE mention_bundle ADD COLUMN removed_recipients TEXT NOT NULL DEFAULT '[]';
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

  async listBundles(): Promise<MentionBundle[]> {
    /** 묶음마다 멘션. 알림 시각, 같으면 alarmId 크기 순서다. */
    const mentions = groupBy(
      this.db
        .prepare(
          `SELECT bundle_id, post_id, remark_id, reply_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at, text, answered
           FROM mention ORDER BY bundle_id, registered_date_time, length(alarm_id), alarm_id`,
        )
        .all() as MentionRow[],
    );
    /** 묶음마다 기록한 내 답. 기록한 순서다. */
    const answers = groupBy(
      this.db.prepare('SELECT bundle_id, answer_id, registered_date_time, excluded FROM bundle_answer ORDER BY bundle_id, rowid').all() as AnswerRow[],
    );
    /** 묶음 줄. */
    const rows = this.db.prepare('SELECT * FROM mention_bundle ORDER BY id').all() as BundleRow[];
    return rows.map((row) => ({
      id: row.id,
      postId: row.post_id,
      remarkId: row.remark_id,
      projectId: row.project_id,
      status: row.status as BundleStatus,
      postTitle: row.post_title,
      connectUrl: row.connect_url,
      mentions: (mentions.get(row.id) ?? []).map((mention) => ({
        postId: mention.post_id,
        remarkId: mention.remark_id,
        replyId: mention.reply_id,
        projectId: mention.project_id,
        alarmId: mention.alarm_id,
        senderId: mention.sender_id,
        senderName: mention.sender_name,
        registeredDateTime: mention.registered_date_time,
        detectedAt: mention.detected_at,
        text: mention.text,
        answered: mention.answered === 1,
      })),
      answers: (answers.get(row.id) ?? []).map((answer) => ({
        answerId: answer.answer_id,
        registeredDateTime: answer.registered_date_time,
        excluded: answer.excluded === 1,
      })),
      newMentionCount: row.new_mention_count,
      createdAt: row.created_at,
      processedAt: row.processed_at,
      context: readJson<BundleContext>(row.context),
      repoCheck: readJson<RepoCheck>(row.repo_check),
      userRepos: readJson<string[]>(row.user_repos),
      draft: readJson<Draft>(row.draft),
      editedText: row.edited_text,
      removedRecipients: readJson<string[]>(row.removed_recipients) ?? [],
      failure: readJson<DraftFailure>(row.failure),
      runs: readJson<RunRecord[]>(row.runs) ?? [],
    }));
  }

  async saveDetectedBundles(bundles: readonly UnsavedBundle[], baselineAlarmId: string): Promise<MentionBundle[]> {
    return this.db.transaction(() => {
      /** 저장한 묶음. */
      const saved = bundles.map((bundle) => this.writeBundle(bundle));
      this.writeBaseline(baselineAlarmId);
      return saved;
    })();
  }

  async saveBundle(bundle: MentionBundle): Promise<void> {
    this.db.transaction(() => this.writeBundle(bundle))();
  }

  /**
   * 묶음 한 줄을 넣거나 바꾸고, 그 묶음의 멘션과 내 답을 주어진 값으로 맞춘다. 새 묶음은 ID를 받는다.
   * 다른 묶음에 이미 든 멘션 위치는 기본 키가 막아 실패한다. 트랜잭션 안에서만 부른다.
   */
  private writeBundle(bundle: UnsavedBundle): MentionBundle {
    /** 묶음 줄의 값. */
    const values = {
      postId: bundle.postId,
      remarkId: bundle.remarkId,
      projectId: bundle.projectId,
      status: bundle.status,
      postTitle: bundle.postTitle,
      connectUrl: bundle.connectUrl,
      newMentionCount: bundle.newMentionCount,
      createdAt: bundle.createdAt,
      processedAt: bundle.processedAt,
      context: jsonOrNull(bundle.context),
      repoCheck: jsonOrNull(bundle.repoCheck),
      userRepos: jsonOrNull(bundle.userRepos),
      draft: jsonOrNull(bundle.draft),
      editedText: bundle.editedText,
      removedRecipients: JSON.stringify(bundle.removedRecipients),
      failure: jsonOrNull(bundle.failure),
      runs: JSON.stringify(bundle.runs),
    };
    /** 묶음 ID. */
    let id = bundle.id;
    if (id === null) {
      id = Number(
        this.db
          .prepare(
            `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at,
               context, repo_check, user_repos, draft, edited_text, removed_recipients, failure, runs)
             VALUES (@postId, @remarkId, @projectId, @status, @postTitle, @connectUrl, @newMentionCount, @createdAt, @processedAt,
               @context, @repoCheck, @userRepos, @draft, @editedText, @removedRecipients, @failure, @runs)`,
          )
          .run(values).lastInsertRowid,
      );
    } else {
      /** 바꾼 줄 수. */
      const { changes } = this.db
        .prepare(
          `UPDATE mention_bundle SET post_id = @postId, remark_id = @remarkId, project_id = @projectId, status = @status, post_title = @postTitle,
             connect_url = @connectUrl, new_mention_count = @newMentionCount, created_at = @createdAt, processed_at = @processedAt,
             context = @context, repo_check = @repoCheck, user_repos = @userRepos, draft = @draft, edited_text = @editedText,
             removed_recipients = @removedRecipients, failure = @failure, runs = @runs
           WHERE id = @id`,
        )
        .run({ ...values, id });
      if (changes === 0) throw new Error(`저장하지 않은 묶음 ${id}입니다.`);
    }

    this.db.prepare('DELETE FROM mention WHERE bundle_id = ?').run(id);
    /** 멘션 하나를 넣는 문장. */
    const insertMention = this.db.prepare(
      `INSERT INTO mention (post_id, remark_id, reply_id, bundle_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at, text, answered)
       VALUES (@postId, @remarkId, @replyId, @bundleId, @projectId, @alarmId, @senderId, @senderName, @registeredDateTime, @detectedAt, @text, @answered)`,
    );
    for (const mention of bundle.mentions) insertMention.run({ ...mention, bundleId: id, answered: mention.answered ? 1 : 0 });

    this.db.prepare('DELETE FROM bundle_answer WHERE bundle_id = ?').run(id);
    /** 내 답 하나를 넣는 문장. */
    const insertAnswer = this.db.prepare(
      'INSERT INTO bundle_answer (bundle_id, answer_id, registered_date_time, excluded) VALUES (@bundleId, @answerId, @registeredDateTime, @excluded)',
    );
    for (const answer of bundle.answers) insertAnswer.run({ ...answer, bundleId: id, excluded: answer.excluded ? 1 : 0 });

    return { ...structuredClone(bundle), id, mentions: structuredClone(bundle.mentions).sort(compareMentions) };
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

/**
 * 묶음 줄에 JSON으로 둔 값을 읽는다. 없거나 읽을 수 없으면 `null`이다.
 * 맥락은 조회하지 않은 것으로, 초안·실패 사유는 없는 것으로 보고 다음 조회와 실행이 새로 채운다.
 */
function readJson<T>(json: string | null): T | null {
  if (json === null) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** 값을 JSON으로 쓴다. `null`이면 열을 비운다. */
function jsonOrNull(value: unknown): string | null {
  return value === null ? null : JSON.stringify(value);
}

/** 묶음 ID마다 줄을 모은다. 줄 순서는 그대로다. */
function groupBy<T extends { bundle_id: number }>(rows: readonly T[]): Map<number, T[]> {
  /** 묶음 ID마다 모은 줄. */
  const groups = new Map<number, T[]>();
  for (const row of rows) groups.set(row.bundle_id, [...(groups.get(row.bundle_id) ?? []), row]);
  return groups;
}

/** `mention_bundle` 표의 한 줄. */
interface BundleRow {
  /** 묶음 ID. */
  id: number;
  /** 게시물 ID. */
  post_id: string;
  /** 댓글 스레드 묶음이면 댓글 ID, 본문 묶음이면 `"-1"`. */
  remark_id: string;
  /** Flow 프로젝트 ID. */
  project_id: string;
  /** 묶음 상태. */
  status: string;
  /** 게시물 제목. */
  post_title: string;
  /** "Flow에서 열기" 주소. */
  connect_url: string | null;
  /** 합쳐진 새 멘션 수. */
  new_mention_count: number;
  /** 만든 시각(Unix epoch 밀리초). */
  created_at: number;
  /** 처리한 시각(Unix epoch 밀리초). */
  processed_at: number | null;
  /** 마지막으로 조회한 맥락의 JSON. 조회하지 않았으면 `null`. */
  context: string | null;
  /** 저장소 확인 필요 사유의 JSON. 사유가 없으면 `null`. */
  repo_check: string | null;
  /** 사용자가 저장소 선택 창에서 고른 구성의 JSON. 고른 적이 없으면 `null`. */
  user_repos: string | null;
  /** 초안의 JSON. 아직 없으면 `null`. */
  draft: string | null;
  /** 편집본. 편집하지 않았으면 `null`. */
  edited_text: string | null;
  /** 받는 사람에서 뺀 사람의 사용자 ID 배열의 JSON. */
  removed_recipients: string;
  /** 생성이 실패한 까닭의 JSON. 실패가 아니면 `null`. */
  failure: string | null;
  /** 실행 기록 배열의 JSON. */
  runs: string;
}

/** `bundle_answer` 표의 한 줄. */
interface AnswerRow {
  /** 묶음 ID. */
  bundle_id: number;
  /** 내 답(댓글·대댓글)의 ID. */
  answer_id: string;
  /** 쓴 시각(Flow 형식). */
  registered_date_time: string;
  /** 되돌릴 때 빼기로 기록했으면 1. */
  excluded: number;
}

/** `mention` 표의 한 줄. */
interface MentionRow {
  /** 든 묶음 ID. */
  bundle_id: number;
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
  /** Flow 원문. */
  text: string;
  /** "이미 답함"으로 묶음에서 빠졌으면 1. */
  answered: number;
}
