import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import {
  compareMentions,
  type BundleStatus,
  type MentionBundle,
  type MinimalRecord,
  type PostingRecord,
  type ProcessedStatus,
  type RepoCheck,
  type UnsavedBundle,
} from '../bundles/mention-bundle';
import type { Draft, DraftFailure, Regeneration, RunRecord } from '../drafts/draft';
import type { QueuePriority, QueuedDraft } from '../drafts/draft-queue';
import type { BundleContext } from '../flow/bundle-context';
import { mentionLocationOf, type MentionLocation } from '../detection/mention';
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
  // 11: 재생성. 덧붙인 지시(문자열 배열 JSON), 고친 요구, 다시 만드는 중인 재생성(경로·직전 결과·자동 선택으로 정한 저장소의 JSON)을 둔다.
  // 이미 있던 묶음은 지시를 덧붙이거나 요구를 고친 적이 없고 처음 만든 초안이다.
  `
  ALTER TABLE mention_bundle ADD COLUMN directives TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE mention_bundle ADD COLUMN fixed_requirement TEXT;
  ALTER TABLE mention_bundle ADD COLUMN regeneration TEXT;
  `,
  // 12: 게시. 게시 기록(게시 본문, 게시 요청을 보낸 시각, 올라간 글의 ID)을 JSON으로 둔다. 게시 요청을 보내기 직전에 먼저 적는다.
  // 이미 있던 묶음은 게시한 적이 없다.
  `
  ALTER TABLE mention_bundle ADD COLUMN posting TEXT;
  `,
  // 13: 준비된 뒤의 변화 감시. 멘션마다 사라져 빠졌는지와 되돌릴 때 사라짐 판정에서 빼기로 기록했는지를 두고,
  // 묶음마다 감시가 마지막으로 조회한 맥락을 JSON으로 둔다. 이미 있던 멘션은 사라진 적이 없고, 묶음은 감시한 적이 없다.
  `
  ALTER TABLE mention ADD COLUMN gone INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE mention ADD COLUMN gone_excluded INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE mention_bundle ADD COLUMN watched_context TEXT;
  `,
  // 14: 보관. 처리됨 목록에서 빠진 묶음의 최소 기록(ID와 상태만)을 전체 기록(`mention_bundle`, `mention`, `bundle_answer`)과 다른 표에 둔다.
  // 묶음 자리·마지막 상태·처리한 시각·이 PC가 게시한 글의 ID, 묶음에 있던 멘션 위치, 그 글이 답한 멘션 위치다. 송신자 이름과 글 내용은 넣지 않는다.
  // 묶음을 최소 기록으로 바꿀 때 멘션 위치를 `mention`에서 옮기므로, 한 위치는 묶음과 최소 기록 가운데 한 곳에만 있다. 이미 있던 묶음은 아직 목록에서 빠지지 않았다.
  `
  CREATE TABLE minimal_record (
    bundle_id INTEGER PRIMARY KEY,
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('posted', 'ignored', 'already-answered', 'source-gone')),
    processed_at INTEGER NOT NULL,
    posted_id TEXT
  ) STRICT;
  CREATE TABLE minimal_record_mention (
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    reply_id TEXT NOT NULL,
    bundle_id INTEGER NOT NULL REFERENCES minimal_record (bundle_id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, remark_id, reply_id)
  ) STRICT;
  CREATE INDEX minimal_record_mention_bundle_id ON minimal_record_mention (bundle_id);
  CREATE TABLE minimal_record_answered (
    bundle_id INTEGER NOT NULL REFERENCES minimal_record (bundle_id) ON DELETE CASCADE,
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    reply_id TEXT NOT NULL,
    PRIMARY KEY (bundle_id, post_id, remark_id, reply_id)
  ) STRICT;
  `,
  // 15: 다시 켜기. 묶음마다 카운트다운 중에 앱이 꺼져 준비됨으로 돌렸는지와 시험 묶음인지를 두고,
  // 앱을 끌 때 남긴 초안 대기열(실행할 순서, 묶음, 대기열 자리)을 둔다. 대기열은 다시 켤 때 읽고 비우므로 묶음과 외래 키로 묶지 않는다.
  // 이미 있던 묶음은 시험 묶음이 아니고 카운트다운 중에 꺼진 적이 없으며, 남긴 대기열은 없다.
  `
  ALTER TABLE mention_bundle ADD COLUMN quit_during_countdown INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE mention_bundle ADD COLUMN trial INTEGER NOT NULL DEFAULT 0;
  CREATE TABLE draft_queue (
    position INTEGER PRIMARY KEY,
    bundle_id INTEGER NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('resume', 'user', 'auto'))
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

    this.clearWal();
  }

  /** secure_delete는 본 파일의 지운 자리만 덮으므로, 지운 글이 WAL에 남지 않게 본 파일에 반영하고 WAL을 비운다. */
  private clearWal(): void {
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
      this.db
        .prepare(
          `SELECT 1 FROM mention WHERE post_id = @postId AND remark_id = @remarkId AND reply_id = @replyId
           UNION ALL
           SELECT 1 FROM minimal_record_mention WHERE post_id = @postId AND remark_id = @remarkId AND reply_id = @replyId`,
        )
        .get({ postId, remarkId, replyId }) !== undefined
    );
  }

  async listBundles(): Promise<MentionBundle[]> {
    /** 묶음마다 멘션. 알림 시각, 같으면 alarmId 크기 순서다. */
    const mentions = groupBy(
      this.db
        .prepare(
          `SELECT bundle_id, post_id, remark_id, reply_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at, text, answered,
             gone, gone_excluded
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
        gone: mention.gone === 1,
        goneExcluded: mention.gone_excluded === 1,
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
      watchedContext: readJson<BundleContext>(row.watched_context),
      repoCheck: readJson<RepoCheck>(row.repo_check),
      userRepos: readJson<string[]>(row.user_repos),
      draft: readJson<Draft>(row.draft),
      editedText: row.edited_text,
      removedRecipients: readJson<string[]>(row.removed_recipients) ?? [],
      directives: readJson<string[]>(row.directives) ?? [],
      fixedRequirement: row.fixed_requirement,
      regeneration: readJson<Regeneration>(row.regeneration),
      failure: readJson<DraftFailure>(row.failure),
      runs: readJson<RunRecord[]>(row.runs) ?? [],
      posting: postingRecordOf(readJson<PostingRecord>(row.posting), mentions.get(row.id) ?? []),
      quitDuringCountdown: row.quit_during_countdown === 1,
      trial: row.trial === 1,
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
      watchedContext: jsonOrNull(bundle.watchedContext),
      repoCheck: jsonOrNull(bundle.repoCheck),
      userRepos: jsonOrNull(bundle.userRepos),
      draft: jsonOrNull(bundle.draft),
      editedText: bundle.editedText,
      removedRecipients: JSON.stringify(bundle.removedRecipients),
      directives: JSON.stringify(bundle.directives),
      fixedRequirement: bundle.fixedRequirement,
      regeneration: jsonOrNull(bundle.regeneration),
      failure: jsonOrNull(bundle.failure),
      runs: JSON.stringify(bundle.runs),
      posting: jsonOrNull(bundle.posting),
      quitDuringCountdown: bundle.quitDuringCountdown ? 1 : 0,
      trial: bundle.trial ? 1 : 0,
    };
    /** 묶음 ID. */
    let id = bundle.id;
    if (id === null) {
      id = Number(
        this.db
          .prepare(
            `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at,
               context, watched_context, repo_check, user_repos, draft, edited_text, removed_recipients, directives, fixed_requirement, regeneration, failure, runs, posting,
               quit_during_countdown, trial)
             VALUES (@postId, @remarkId, @projectId, @status, @postTitle, @connectUrl, @newMentionCount, @createdAt, @processedAt,
               @context, @watchedContext, @repoCheck, @userRepos, @draft, @editedText, @removedRecipients, @directives, @fixedRequirement, @regeneration, @failure, @runs, @posting,
               @quitDuringCountdown, @trial)`,
          )
          .run(values).lastInsertRowid,
      );
    } else {
      /** 바꾼 줄 수. */
      const { changes } = this.db
        .prepare(
          `UPDATE mention_bundle SET post_id = @postId, remark_id = @remarkId, project_id = @projectId, status = @status, post_title = @postTitle,
             connect_url = @connectUrl, new_mention_count = @newMentionCount, created_at = @createdAt, processed_at = @processedAt,
             context = @context, watched_context = @watchedContext, repo_check = @repoCheck, user_repos = @userRepos, draft = @draft, edited_text = @editedText,
             removed_recipients = @removedRecipients, directives = @directives, fixed_requirement = @fixedRequirement,
             regeneration = @regeneration, failure = @failure, runs = @runs, posting = @posting,
             quit_during_countdown = @quitDuringCountdown, trial = @trial
           WHERE id = @id`,
        )
        .run({ ...values, id });
      if (changes === 0) throw new Error(`저장하지 않은 묶음 ${id}입니다.`);
    }

    this.db.prepare('DELETE FROM mention WHERE bundle_id = ?').run(id);
    /** 멘션 하나를 넣는 문장. */
    const insertMention = this.db.prepare(
      `INSERT INTO mention (post_id, remark_id, reply_id, bundle_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at, text, answered,
         gone, gone_excluded)
       VALUES (@postId, @remarkId, @replyId, @bundleId, @projectId, @alarmId, @senderId, @senderName, @registeredDateTime, @detectedAt, @text, @answered,
         @gone, @goneExcluded)`,
    );
    for (const mention of bundle.mentions) {
      insertMention.run({
        ...mention,
        bundleId: id,
        answered: mention.answered ? 1 : 0,
        gone: mention.gone ? 1 : 0,
        goneExcluded: mention.goneExcluded ? 1 : 0,
      });
    }

    this.db.prepare('DELETE FROM bundle_answer WHERE bundle_id = ?').run(id);
    /** 내 답 하나를 넣는 문장. */
    const insertAnswer = this.db.prepare(
      'INSERT INTO bundle_answer (bundle_id, answer_id, registered_date_time, excluded) VALUES (@bundleId, @answerId, @registeredDateTime, @excluded)',
    );
    for (const answer of bundle.answers) insertAnswer.run({ ...answer, bundleId: id, excluded: answer.excluded ? 1 : 0 });

    return { ...structuredClone(bundle), id, mentions: structuredClone(bundle.mentions).sort(compareMentions) };
  }

  async listMinimalRecords(): Promise<MinimalRecord[]> {
    /** 최소 기록마다 묶음에 있던 멘션 위치. */
    const mentions = groupBy(
      this.db.prepare('SELECT bundle_id, post_id, remark_id, reply_id FROM minimal_record_mention ORDER BY bundle_id, rowid').all() as LocationRow[],
    );
    /** 최소 기록마다 이 PC가 게시한 글이 답한 멘션 위치. */
    const answered = groupBy(
      this.db.prepare('SELECT bundle_id, post_id, remark_id, reply_id FROM minimal_record_answered ORDER BY bundle_id, rowid').all() as LocationRow[],
    );
    /** 최소 기록 줄. */
    const rows = this.db.prepare('SELECT * FROM minimal_record ORDER BY bundle_id').all() as MinimalRecordRow[];
    return rows.map((row) => ({
      bundleId: row.bundle_id,
      postId: row.post_id,
      remarkId: row.remark_id,
      mentions: (mentions.get(row.bundle_id) ?? []).map(locationOfRow),
      status: row.status as ProcessedStatus,
      processedAt: row.processed_at,
      posted: row.posted_id === null ? null : { postedId: row.posted_id, answeredMentions: (answered.get(row.bundle_id) ?? []).map(locationOfRow) },
    }));
  }

  async archiveBundles(records: readonly MinimalRecord[]): Promise<void> {
    if (records.length === 0) return;
    /** 최소 기록 한 줄을 넣는 문장. */
    const insertRecord = this.db.prepare(
      `INSERT INTO minimal_record (bundle_id, post_id, remark_id, status, processed_at, posted_id)
       VALUES (@bundleId, @postId, @remarkId, @status, @processedAt, @postedId)`,
    );
    /** 묶음에 있던 멘션 위치 하나를 넣는 문장. */
    const insertMention = this.db.prepare(
      'INSERT INTO minimal_record_mention (post_id, remark_id, reply_id, bundle_id) VALUES (@postId, @remarkId, @replyId, @bundleId)',
    );
    /** 묶음의 멘션을 지우는 문장. */
    const deleteMentions = this.db.prepare('DELETE FROM mention WHERE bundle_id = ?');
    /** 묶음에 기록한 내 답을 지우는 문장. */
    const deleteAnswers = this.db.prepare('DELETE FROM bundle_answer WHERE bundle_id = ?');
    /** 묶음 줄을 지우는 문장. */
    const deleteBundle = this.db.prepare('DELETE FROM mention_bundle WHERE id = ?');
    /** 게시한 글이 답한 멘션 위치 하나를 넣는 문장. 같은 위치가 거듭 들어 있어도 한 줄이다. */
    const insertAnswered = this.db.prepare(
      'INSERT OR IGNORE INTO minimal_record_answered (bundle_id, post_id, remark_id, reply_id) VALUES (@bundleId, @postId, @remarkId, @replyId)',
    );

    // 묶음마다 전체 기록을 지우고 최소 기록을 넣는다. 하나라도 실패하면 아무것도 바뀌지 않는다.
    this.db.transaction(() => {
      for (const record of records) {
        deleteMentions.run(record.bundleId);
        deleteAnswers.run(record.bundleId);
        /** 지운 묶음 줄 수. */
        const { changes } = deleteBundle.run(record.bundleId);
        if (changes === 0) throw new Error(`저장하지 않은 묶음 ${record.bundleId}입니다.`);

        insertRecord.run({
          bundleId: record.bundleId,
          postId: record.postId,
          remarkId: record.remarkId,
          status: record.status,
          processedAt: record.processedAt,
          postedId: record.posted?.postedId ?? null,
        });
        for (const location of record.mentions) insertMention.run({ ...mentionLocationOf(location), bundleId: record.bundleId });
        for (const location of record.posted?.answeredMentions ?? []) insertAnswered.run({ ...mentionLocationOf(location), bundleId: record.bundleId });
      }
    })();

    this.clearWal();
  }

  async deleteBundles(bundleIds: readonly number[]): Promise<void> {
    if (bundleIds.length === 0) return;
    /** 묶음의 멘션을 지우는 문장. */
    const deleteMentions = this.db.prepare('DELETE FROM mention WHERE bundle_id = ?');
    /** 묶음에 기록한 내 답을 지우는 문장. */
    const deleteAnswers = this.db.prepare('DELETE FROM bundle_answer WHERE bundle_id = ?');
    /** 묶음 줄을 지우는 문장. */
    const deleteBundle = this.db.prepare('DELETE FROM mention_bundle WHERE id = ?');

    // 하나라도 실패하면 아무것도 지우지 않는다.
    this.db.transaction(() => {
      for (const bundleId of bundleIds) {
        deleteMentions.run(bundleId);
        deleteAnswers.run(bundleId);
        /** 지운 묶음 줄 수. */
        const { changes } = deleteBundle.run(bundleId);
        if (changes === 0) throw new Error(`저장하지 않은 묶음 ${bundleId}입니다.`);
      }
    })();

    this.clearWal();
  }

  async getDraftQueue(): Promise<QueuedDraft[]> {
    /** 남긴 대기열의 줄. 실행할 순서다. */
    const rows = this.db.prepare('SELECT bundle_id, priority FROM draft_queue ORDER BY position').all() as { bundle_id: number; priority: string }[];
    return rows.map((row) => ({ bundleId: row.bundle_id, priority: row.priority as QueuePriority }));
  }

  async setDraftQueue(queue: readonly QueuedDraft[]): Promise<void> {
    /** 대기열 한 줄을 넣는 문장. */
    const insert = this.db.prepare('INSERT INTO draft_queue (position, bundle_id, priority) VALUES (?, ?, ?)');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM draft_queue').run();
      queue.forEach(({ bundleId, priority }, position) => insert.run(position, bundleId, priority));
    })();
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
 * 저장한 게시 기록. 게시 실패의 사유가 생기기 전에 적은 기록은 사유가 없으므로 `null`로 채운다.
 * 답한 범위가 생기기 전에 적은 기록은 그때 판정하던 대로 그 묶음의 멘션에 답한 것으로 채운다.
 */
function postingRecordOf(record: PostingRecord | null, mentions: readonly MentionRow[]): PostingRecord | null {
  return (
    record && {
      ...record,
      failure: record.failure ?? null,
      answeredMentions: record.answeredMentions ?? mentions.map((mention) => ({ postId: mention.post_id, remarkId: mention.remark_id, replyId: mention.reply_id })),
    }
  );
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

/** 멘션 위치 줄에서 멘션 위치만 떼어 낸다. */
function locationOfRow({ post_id, remark_id, reply_id }: LocationRow): MentionLocation {
  return { postId: post_id, remarkId: remark_id, replyId: reply_id };
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
  /** 변화 감시가 마지막으로 조회한 맥락의 JSON. 감시하지 않았으면 `null`. */
  watched_context: string | null;
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
  /** 덧붙인 지시 배열의 JSON. */
  directives: string;
  /** 고친 요구. 고친 적이 없으면 `null`. */
  fixed_requirement: string | null;
  /** 다시 만드는 중인 재생성의 JSON. 없으면 `null`. */
  regeneration: string | null;
  /** 생성이 실패한 까닭의 JSON. 실패가 아니면 `null`. */
  failure: string | null;
  /** 실행 기록 배열의 JSON. */
  runs: string;
  /** 게시 기록의 JSON. 게시 요청을 보내기 전이면 `null`. */
  posting: string | null;
  /** 카운트다운 중에 앱이 꺼져 준비됨으로 돌렸으면 1. */
  quit_during_countdown: number;
  /** 시험 묶음이면 1. */
  trial: number;
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
  /** 사라져 묶음에서 빠졌으면 1. */
  gone: number;
  /** 되돌릴 때 사라짐 판정에서 빼기로 기록했으면 1. */
  gone_excluded: number;
}

/** `minimal_record` 표의 한 줄. */
interface MinimalRecordRow {
  /** 빠지기 전 묶음의 ID. */
  bundle_id: number;
  /** 게시물 ID. */
  post_id: string;
  /** 댓글 스레드 묶음이면 댓글 ID, 본문 묶음이면 `"-1"`. */
  remark_id: string;
  /** 마지막 상태. */
  status: string;
  /** 처리한 시각(Unix epoch 밀리초). */
  processed_at: number;
  /** 이 PC가 게시한 글의 ID. 게시됨이 아니면 `null`. */
  posted_id: string | null;
}

/** `minimal_record_mention`·`minimal_record_answered` 표의 한 줄. */
interface LocationRow {
  /** 최소 기록의 묶음 ID. */
  bundle_id: number;
  /** 게시물 ID. */
  post_id: string;
  /** 댓글 ID. 본문 멘션이면 `"-1"`. */
  remark_id: string;
  /** 대댓글 ID. 대댓글 멘션이 아니면 `"-1"`. */
  reply_id: string;
}
