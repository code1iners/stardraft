import type { AssignmentState } from '../detection/assignment-detection';
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
import type { Draft, DraftFailure, Regeneration } from '../drafts/draft';
import { isQueuePriority, type QueuedTarget, type RunRecord } from '../generation/generation-run';
import type { BundleContext } from '../flow/bundle-context';
import { mentionLocationOf, type MentionLocation } from '../detection/mention';
import type { FlowEmployee } from '../ports/flow-api';
import type { GenerationQueueStore } from '../ports/generation-queue-store';
import type { AccountLeaving, AccountSwitchResult, StateStore } from '../ports/state-store';
import { FLOW_TARGET_KIND } from '../drafts/flow-target-adapter';
import { isSameFlowUser } from '../flow/user-id';
import type { UpdateAttempt } from '../update/update-restart';

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
  // 마지막으로 남긴 초안 대기열(실행할 순서, 묶음, 대기열 자리)을 둔다. 대기열은 바뀔 때마다 통째로 바꿔 쓰고,
  // 다시 켤 때 생성 중이 아닌 묶음은 건너뛰므로 묶음과 외래 키로 묶지 않는다.
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
  // 16: 최근 멘션으로 시험. 시험 묶음의 멘션은 실제 묶음의 멘션(`mention`)과 다른 표에 둔다.
  // 시험은 이미 감지한 멘션으로도 하므로 같은 멘션 위치가 실제 묶음에 있어도 들어가야 하고, 감지가 다시 감지하지 않을 위치(`hasMentionLocation`)로 세면 안 된다.
  // 이미 있던 시험 묶음은 없다(시험을 만드는 기능이 이 형식과 함께 생긴다).
  `
  CREATE TABLE trial_mention (
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
    gone INTEGER NOT NULL,
    gone_excluded INTEGER NOT NULL,
    PRIMARY KEY (bundle_id, post_id, remark_id, reply_id)
  ) STRICT;
  `,
  // 17: 앱 내 업데이트. 받은 파일의 서명 검증에 실패한 버전마다 한 줄을 두어, 앱을 다시 켠 뒤에도 그 버전들을 자동으로 다시 받지 않는다.
  // 하나만 두면 더 새 버전마저 실패한 뒤 그 버전을 사전 릴리스로 내렸을 때 앞 버전을 다시 받는다.
  // 이미 있던 앱은 서명 검증에 실패한 적이 없다(앱 내 업데이트가 이 형식과 함께 생긴다).
  `
  CREATE TABLE update_signature_failure (
    version TEXT PRIMARY KEY
  ) STRICT;
  `,
  // 18: 앱 내 업데이트의 "업데이트 시도". 다시 시작하기 직전에 한 줄을 남기고, 다시 켰을 때 버전을 견줘 설치 실패인지 본 뒤 지운다.
  // `rejected`는 Squirrel.Mac이 앱 안에서 거부해 앱이 꺼지지 않은 것이다. 이미 있던 앱은 다시 시작한 적이 없다.
  `
  CREATE TABLE update_attempt (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    from_version TEXT NOT NULL,
    to_version TEXT NOT NULL,
    attempted_at INTEGER NOT NULL,
    rejected INTEGER NOT NULL CHECK (rejected IN (0, 1))
  ) STRICT;
  `,
  // 담당 업무의 감지 기준과 최초 묶음 기록은 멘션 기준점과 분리한다.
  `
  ALTER TABLE mention_bundle ADD COLUMN assignment TEXT;
  CREATE TABLE assignment_detection (id INTEGER PRIMARY KEY CHECK (id = 1), state TEXT NOT NULL) STRICT;
  CREATE TABLE assignment_record (project_id TEXT NOT NULL, task_id TEXT NOT NULL, bundle_id INTEGER NOT NULL,
    PRIMARY KEY (project_id, task_id)) STRICT;
  `,
  // 20: 담당 해제. 초안이 생기기 전에 담당자에서 빠져 생성을 멈춘 묶음(`unassigned`)도 처리됨이라 최소 기록에 남는다.
  // SQLite는 CHECK를 바꿀 수 없어 최소 기록 표를 새로 만들어 옮긴다. 부모 표를 지우면 외래 키가 자식 행을 함께 지우므로
  // 자식 표를 먼저 옮기고 지운 뒤 부모를 지우고, 이름을 바꿀 때 자식의 외래 키가 새 부모 이름을 따라간다. 이미 있던 기록은 그대로다.
  `
  CREATE TABLE minimal_record_new (
    bundle_id INTEGER PRIMARY KEY,
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('posted', 'ignored', 'already-answered', 'source-gone', 'unassigned')),
    processed_at INTEGER NOT NULL,
    posted_id TEXT
  ) STRICT;
  INSERT INTO minimal_record_new (bundle_id, post_id, remark_id, status, processed_at, posted_id)
    SELECT bundle_id, post_id, remark_id, status, processed_at, posted_id FROM minimal_record;
  CREATE TABLE minimal_record_mention_new (
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    reply_id TEXT NOT NULL,
    bundle_id INTEGER NOT NULL REFERENCES minimal_record_new (bundle_id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, remark_id, reply_id)
  ) STRICT;
  INSERT INTO minimal_record_mention_new (post_id, remark_id, reply_id, bundle_id)
    SELECT post_id, remark_id, reply_id, bundle_id FROM minimal_record_mention;
  CREATE TABLE minimal_record_answered_new (
    bundle_id INTEGER NOT NULL REFERENCES minimal_record_new (bundle_id) ON DELETE CASCADE,
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    reply_id TEXT NOT NULL,
    PRIMARY KEY (bundle_id, post_id, remark_id, reply_id)
  ) STRICT;
  INSERT INTO minimal_record_answered_new (bundle_id, post_id, remark_id, reply_id)
    SELECT bundle_id, post_id, remark_id, reply_id FROM minimal_record_answered;
  DROP TABLE minimal_record_answered;
  DROP TABLE minimal_record_mention;
  DROP TABLE minimal_record;
  ALTER TABLE minimal_record_new RENAME TO minimal_record;
  ALTER TABLE minimal_record_mention_new RENAME TO minimal_record_mention;
  ALTER TABLE minimal_record_answered_new RENAME TO minimal_record_answered;
  CREATE INDEX minimal_record_mention_bundle_id ON minimal_record_mention (bundle_id);
  `,
  // 21: 최근 멘션 확인. 사용자가 목록에서 골라 만든 수동 요청 묶음인지를 묶음마다 둔다. 이미 있던 묶음은 감지로 만든 것이다.
  `
  ALTER TABLE mention_bundle ADD COLUMN manual INTEGER NOT NULL DEFAULT 0;
  `,
  // 22: 시험 폐지. 최근 멘션 확인이 시험을 대신하므로, 앱이 꺼진 채 남아 있던 시험 묶음은 기록째(멘션, 내 답, 대기열 자리) 지우고
  // 시험 묶음의 멘션 표(`trial_mention`)와 시험 표시 열을 없앤다. 게시할 수 없는 묶음이 목록에 남지 않게 하며, 일반 묶음과 최소 기록은 건드리지 않는다.
  `
  DELETE FROM draft_queue WHERE bundle_id IN (SELECT id FROM mention_bundle WHERE trial = 1);
  DELETE FROM bundle_answer WHERE bundle_id IN (SELECT id FROM mention_bundle WHERE trial = 1);
  DELETE FROM trial_mention;
  DELETE FROM mention_bundle WHERE trial = 1;
  DROP TABLE trial_mention;
  ALTER TABLE mention_bundle DROP COLUMN trial;
  `,
  // 23: 생성 대기열. 대기열이 Flow 묶음 말고 다른 종류의 대상도 담도록 대상 종류(`kind`)를 두고, 묶음 ID 열을 대상 ID(`target_id`)로 바꾼다.
  // 이미 있던 줄은 모두 Flow 묶음이다. 종류 열에 기본값을 두지 않으려고 표를 새로 만들어 옮긴다.
  `
  CREATE TABLE draft_queue_new (
    position INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('resume', 'user', 'auto'))
  ) STRICT;
  INSERT INTO draft_queue_new (position, kind, target_id, priority) SELECT position, 'flow', bundle_id, priority FROM draft_queue;
  DROP TABLE draft_queue;
  ALTER TABLE draft_queue_new RENAME TO draft_queue;
  `,
  // 24: Flow 기록의 계정별 보관. 다른 계정의 키로 바꿔도 기록을 지우지 않고 계정마다 보관한다.
  // 계정 표는 계정마다 한 줄이 되고 움직이는 계정 표시, 마지막으로 쓴 시각, 떠날 때의 비밀 파일 패턴을 갖는다.
  // 기준점과 담당 업무 감지 상태는 계정마다 한 줄, 묶음·최소 기록·담당 업무 기록·대기열의 Flow 줄은 계정 열을 갖는다.
  // 멘션과 최소 기록의 멘션 위치는 뿌리의 계정을 함께 적어, "이미 본 것"의 유일성이 계정 안에서만 걸리게 한다.
  // 이미 있던 줄은 모두 지금 계정의 것으로 채운다. 계정이 없던 설치본의 줄은 빈 계정('')으로 두고, 처음 넣는 계정이 이어받는다.
  `
  CREATE TABLE detection_new (account_id TEXT PRIMARY KEY, baseline_alarm_id TEXT NOT NULL) STRICT;
  INSERT INTO detection_new SELECT coalesce((SELECT user_id FROM account WHERE id = 1), ''), baseline_alarm_id FROM detection;
  DROP TABLE detection;
  ALTER TABLE detection_new RENAME TO detection;

  CREATE TABLE assignment_detection_new (account_id TEXT PRIMARY KEY, state TEXT NOT NULL) STRICT;
  INSERT INTO assignment_detection_new SELECT coalesce((SELECT user_id FROM account WHERE id = 1), ''), state FROM assignment_detection;
  DROP TABLE assignment_detection;
  ALTER TABLE assignment_detection_new RENAME TO assignment_detection;

  CREATE TABLE assignment_record_new (
    account_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    bundle_id INTEGER NOT NULL,
    PRIMARY KEY (account_id, project_id, task_id)
  ) STRICT;
  INSERT INTO assignment_record_new SELECT coalesce((SELECT user_id FROM account WHERE id = 1), ''), project_id, task_id, bundle_id FROM assignment_record;
  DROP TABLE assignment_record;
  ALTER TABLE assignment_record_new RENAME TO assignment_record;

  ALTER TABLE mention_bundle ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
  UPDATE mention_bundle SET account_id = coalesce((SELECT user_id FROM account WHERE id = 1), '');
  CREATE INDEX mention_bundle_account_id ON mention_bundle (account_id);

  CREATE TABLE mention_new (
    account_id TEXT NOT NULL,
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
    gone INTEGER NOT NULL DEFAULT 0,
    gone_excluded INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, post_id, remark_id, reply_id)
  ) STRICT;
  INSERT INTO mention_new
    SELECT b.account_id, m.post_id, m.remark_id, m.reply_id, m.bundle_id, m.project_id, m.alarm_id, m.sender_id, m.sender_name,
      m.registered_date_time, m.detected_at, m.text, m.answered, m.gone, m.gone_excluded
    FROM mention m JOIN mention_bundle b ON b.id = m.bundle_id;
  DROP TABLE mention;
  ALTER TABLE mention_new RENAME TO mention;
  CREATE INDEX mention_bundle_id ON mention (bundle_id);

  ALTER TABLE minimal_record ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
  UPDATE minimal_record SET account_id = coalesce((SELECT user_id FROM account WHERE id = 1), '');
  CREATE INDEX minimal_record_account_id ON minimal_record (account_id);

  CREATE TABLE minimal_record_mention_new (
    account_id TEXT NOT NULL,
    post_id TEXT NOT NULL,
    remark_id TEXT NOT NULL,
    reply_id TEXT NOT NULL,
    bundle_id INTEGER NOT NULL REFERENCES minimal_record (bundle_id) ON DELETE CASCADE,
    PRIMARY KEY (account_id, post_id, remark_id, reply_id)
  ) STRICT;
  INSERT INTO minimal_record_mention_new
    SELECT r.account_id, m.post_id, m.remark_id, m.reply_id, m.bundle_id
    FROM minimal_record_mention m JOIN minimal_record r ON r.bundle_id = m.bundle_id;
  DROP TABLE minimal_record_mention;
  ALTER TABLE minimal_record_mention_new RENAME TO minimal_record_mention;
  CREATE INDEX minimal_record_mention_bundle_id ON minimal_record_mention (bundle_id);

  CREATE TABLE draft_queue_new (
    id INTEGER PRIMARY KEY,
    position INTEGER NOT NULL,
    kind TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('resume', 'user', 'auto')),
    account_id TEXT
  ) STRICT;
  INSERT INTO draft_queue_new (position, kind, target_id, priority, account_id)
    SELECT position, kind, target_id, priority,
      CASE WHEN kind = 'flow' THEN coalesce((SELECT user_id FROM account WHERE id = 1), '') ELSE NULL END
    FROM draft_queue ORDER BY position;
  DROP TABLE draft_queue;
  ALTER TABLE draft_queue_new RENAME TO draft_queue;

  CREATE TABLE account_new (
    user_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    division TEXT NOT NULL,
    email TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0, 1)),
    last_used_at INTEGER NOT NULL,
    secret_patterns TEXT
  ) STRICT;
  INSERT INTO account_new SELECT user_id, name, division, email, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL FROM account;
  DROP TABLE account;
  ALTER TABLE account_new RENAME TO account;
  CREATE UNIQUE INDEX account_active ON account (active) WHERE active = 1;
  `,
  // 25: Sentry 오류 이슈 감지. 프로젝트별 체크포인트, 중복 억제 기록(신규는 이벤트 ID가 빈 문자열), 진단을 둔다.
  // Flow 계정과 무관한 기록이라 계정 열(`account_id`)을 두지 않는다. 계정 열이 있으면 계정 이어받기와 30일 삭제가 건드린다.
  // 진단의 상태 열에는 검사를 두지 않아, 뒤 단계가 상태를 더해도 표를 다시 만들지 않는다.
  `
  CREATE TABLE sentry_checkpoint (project_id TEXT PRIMARY KEY, checked_at INTEGER NOT NULL) STRICT;
  CREATE TABLE sentry_detection_key (
    issue_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    PRIMARY KEY (issue_id, event_id)
  ) STRICT;
  CREATE INDEX sentry_detection_key_project_id ON sentry_detection_key (project_id);
  CREATE TABLE sentry_diagnosis (
    id INTEGER PRIMARY KEY,
    project_id TEXT NOT NULL,
    issue_id TEXT NOT NULL,
    origin TEXT NOT NULL CHECK (origin IN ('new', 'regression')),
    regression_event_id TEXT,
    detected_at INTEGER NOT NULL,
    status TEXT NOT NULL,
    repo_check TEXT,
    issue TEXT NOT NULL
  ) STRICT;
  CREATE INDEX sentry_diagnosis_project_id ON sentry_diagnosis (project_id);
  `,
  // 26: 읽기 전용 진단. 진단에 보고서(JSON), 진단 실패의 까닭(JSON), 실행 기록(JSON 배열), 완료 시각을 둔다.
  // 기존 줄은 감지만 된 진단(대기, 저장소 대기)이라 보고서·실패·완료 시각이 없고 실행 기록은 빈 배열이다.
  `
  ALTER TABLE sentry_diagnosis ADD COLUMN report TEXT;
  ALTER TABLE sentry_diagnosis ADD COLUMN failure TEXT;
  ALTER TABLE sentry_diagnosis ADD COLUMN runs TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE sentry_diagnosis ADD COLUMN completed_at INTEGER;
  `,
  // 27: 보고서 내보내기. 진단에 마지막으로 내보낸 기록(JSON: 파일 경로, 시각, 내보낸 보고서의 생성 시각)을 둔다.
  // 기존 줄은 내보낸 적이 없어 `NULL`이다. 완료 최소 기록에도 이 칸이 남는다.
  `
  ALTER TABLE sentry_diagnosis ADD COLUMN last_export TEXT;
  `,
  // 28: 다시 진단. 진단에 쌓인 지시(JSON 배열)와, 마지막 다시 진단이 실패해 앞선 보고서로 돌아왔다는 기록(JSON)을 둔다.
  // 기존 줄은 다시 진단한 적이 없어 지시는 빈 배열이고 실패 기록은 `NULL`이다.
  `
  ALTER TABLE sentry_diagnosis ADD COLUMN directives TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE sentry_diagnosis ADD COLUMN rediagnosis_failure TEXT;
  `,
  // 29: 재현하는 진단. 지시를 덧붙인 다시 진단에서 "재현도 다시 하기"를 껐는지(앞선 재현 칸과 첨부를 그대로 옮길지)를 둔다.
  // 기존 줄은 그런 다시 진단이 없어 0이다. 보고서의 첨부 목록은 보고서 JSON 안에 있어 열을 더하지 않는다.
  `
  ALTER TABLE sentry_diagnosis ADD COLUMN keep_reproduction INTEGER NOT NULL DEFAULT 0;
  `,
];

/** 계정에 매이는 대기열 줄의 종류. Flow 초안만 계정에 매이고, 다른 종류(진단 등)는 계정과 무관하다. */
const ACCOUNT_BOUND_QUEUE_KIND = FLOW_TARGET_KIND;

/** 계정을 넣은 적 없는 설치본의 Flow 기록이 쓰는 빈 계정. 처음 넣는 계정이 이 기록을 이어받는다. */
const NO_ACCOUNT = '';

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

/**
 * `state.db`를 쓰는 상태 저장소. 연결을 열고 마이그레이션하는 일은 `openStateDatabase`가 한다.
 * Flow 기록은 계정마다 보관하고, 읽고 쓰는 일은 움직이는 계정(지금 넣은 키의 계정)의 기록만 다룬다.
 * 보관 중인 계정의 기록은 처리됨 정리(`listStoredBundles`, `archiveBundles`)와 30일 삭제만 건드린다.
 */
export class SqliteStateStore implements StateStore, GenerationQueueStore {
  constructor(private readonly db: StateDatabase) {}

  async getAccount(): Promise<FlowEmployee | null> {
    /** 움직이는 계정 한 줄. */
    const row = this.db.prepare('SELECT user_id, name, division, email FROM account WHERE active = 1').get() as
      | { user_id: string; name: string; division: string; email: string }
      | undefined;
    return row ? { userId: row.user_id, name: row.name, division: row.division, email: row.email } : null;
  }

  async setAccount(account: FlowEmployee): Promise<void> {
    /** 지금 움직이는 계정. */
    const active = this.activeAccountId();
    if (active !== null && !isSameFlowUser(active, account.userId)) throw new Error('다른 계정은 계정 바꾸기로만 연결합니다.');
    this.db.transaction(() => {
      if (active !== null) {
        this.db.prepare('UPDATE account SET name = @name, division = @division, email = @email WHERE active = 1').run(account);
        return;
      }
      // 처음 넣는 계정은 계정 없이 쌓인 기록(계정을 넣기 전 설치본의 줄)을 이어받는다.
      // 마지막으로 쓴 시각은 보관할 때(떠날 때) 다시 적으므로, 움직이는 동안의 값은 30일 삭제에 쓰이지 않는다.
      this.activate(account, Date.now());
      this.adoptUnboundRecords(this.activeAccountId()!);
    })();
  }

  async switchAccount(account: FlowEmployee, { now, secretPatterns }: AccountLeaving): Promise<AccountSwitchResult> {
    return this.db.transaction((): AccountSwitchResult => {
      // 떠나는 계정은 기록을 그대로 두고 보관한다. 돌아왔을 때 떠나 있던 동안 더한 비밀 파일 패턴을 알 수 있게 그때의 패턴을 남긴다.
      /** 떠나는 계정이 있었는지 여부. */
      const left = this.db
        .prepare('UPDATE account SET active = 0, last_used_at = ?, secret_patterns = ? WHERE active = 1')
        .run(now, JSON.stringify(secretPatterns)).changes > 0;
      /** 보관해 둔 계정이면 그 줄. */
      const stored = this.storedAccountRow(account.userId);
      this.activate(account, now);
      if (!left) this.adoptUnboundRecords(this.activeAccountId()!);
      return { returning: stored !== null, secretPatternsWhenLeft: stored ? readJson<string[]>(stored.secret_patterns) : null };
    })();
  }

  async isStoredAccount(userId: string): Promise<boolean> {
    return this.storedAccountRow(userId) !== null;
  }

  async deleteAccountsUnusedBefore(cutoff: number): Promise<number> {
    /** 지울 계정. 움직이는 계정은 지우지 않는다. */
    const expired = (this.db.prepare('SELECT user_id FROM account WHERE active = 0 AND last_used_at < ?').all(cutoff) as { user_id: string }[]).map(
      (row) => row.user_id,
    );
    if (expired.length === 0) return 0;

    /** 계정에 매인 표. */
    const tables = this.accountBoundTables();
    // 기준점과 최소 기록까지 그 계정의 기록 전체를 한 트랜잭션으로 지운다. 최소 기록의 답한 범위는 외래 키로 함께 지워진다.
    this.db.transaction(() => {
      // 표끼리 외래 키가 있어도 지우는 순서와 상관없이 지우도록 검사를 커밋 때로 미룬다.
      this.db.pragma('defer_foreign_keys = ON');
      for (const accountId of expired) {
        // 내 답은 계정 열 없이 묶음을 따르므로 묶음을 지우기 전에 지운다.
        this.db.prepare('DELETE FROM bundle_answer WHERE bundle_id IN (SELECT id FROM mention_bundle WHERE account_id = ?)').run(accountId);
        for (const table of tables) this.db.prepare(`DELETE FROM ${table} WHERE account_id = ?`).run(accountId);
        this.db.prepare('DELETE FROM account WHERE user_id = ?').run(accountId);
      }
    })();
    this.clearWal();
    return expired.length;
  }

  /** secure_delete는 본 파일의 지운 자리만 덮으므로, 지운 글이 WAL에 남지 않게 본 파일에 반영하고 WAL을 비운다. */
  private clearWal(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /** 움직이는 계정의 사용자 ID. 계정을 넣은 적이 없으면 `null`. */
  private activeAccountId(): string | null {
    /** 움직이는 계정 한 줄. */
    const row = this.db.prepare('SELECT user_id FROM account WHERE active = 1').get() as { user_id: string } | undefined;
    return row?.user_id ?? null;
  }

  /** 지금 읽고 쓰는 Flow 기록의 계정. 계정을 넣은 적이 없으면 빈 계정이다. */
  private scope(): string {
    return this.activeAccountId() ?? NO_ACCOUNT;
  }

  /** 보관 중인(움직이지 않는) 계정의 줄. 사용자 ID는 `isSameFlowUser`와 같게 대소문자와 앞뒤 공백을 가리지 않는다. 없으면 `null`. */
  private storedAccountRow(userId: string): { user_id: string; secret_patterns: string | null } | null {
    /** 같은 사람의 계정 줄. */
    const row = this.db
      .prepare('SELECT user_id, secret_patterns, active FROM account WHERE lower(trim(user_id)) = lower(trim(?))')
      .get(userId) as { user_id: string; secret_patterns: string | null; active: number } | undefined;
    return row && row.active === 0 ? row : null;
  }

  /**
   * 계정을 움직이는 계정으로 둔다. 보관해 둔 같은 사람의 줄이 있으면 그 줄의 사용자 ID를 그대로 두고 이름·소속·이메일만 바꾼다.
   * 움직이는 계정은 하나뿐이므로, 다른 계정을 먼저 보관한 뒤에 부른다. 트랜잭션 안에서만 부른다.
   */
  private activate(account: FlowEmployee, now: number): void {
    /** 같은 사람의 기존 줄. */
    const existing = this.db.prepare('SELECT user_id FROM account WHERE lower(trim(user_id)) = lower(trim(?))').get(account.userId) as
      | { user_id: string }
      | undefined;
    if (existing) {
      this.db
        .prepare('UPDATE account SET name = ?, division = ?, email = ?, active = 1, last_used_at = ?, secret_patterns = NULL WHERE user_id = ?')
        .run(account.name, account.division, account.email, now, existing.user_id);
      return;
    }
    this.db
      .prepare('INSERT INTO account (user_id, name, division, email, active, last_used_at, secret_patterns) VALUES (?, ?, ?, ?, 1, ?, NULL)')
      .run(account.userId, account.name, account.division, account.email, now);
  }

  /** 계정 없이 쌓인 Flow 기록을 `accountId`의 것으로 옮긴다. 트랜잭션 안에서만 부른다. */
  private adoptUnboundRecords(accountId: string): void {
    for (const table of this.accountBoundTables()) this.db.prepare(`UPDATE ${table} SET account_id = ? WHERE account_id = ?`).run(accountId, NO_ACCOUNT);
  }

  /**
   * 계정 열(`account_id`)이 있는 표. 뒤 티켓이 계정에 매인 표를 더해도 이어받기와 30일 삭제에서 빠지지 않게, 표 목록을 코드에 적지 않고 DB에서 읽는다.
   * 계정 열 없이 뿌리를 따르는 표(내 답, 최소 기록의 답한 범위)는 들지 않는다.
   */
  private accountBoundTables(): string[] {
    return (
      this.db
        .prepare(
          `SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) c
           WHERE m.type = 'table' AND c.name = 'account_id' ORDER BY m.name`,
        )
        .all() as { name: string }[]
    ).map((row) => `"${row.name.replaceAll('"', '""')}"`);
  }

  async getBaselineAlarmId(): Promise<string | null> {
    /** 움직이는 계정의 감지 상태 한 줄. */
    const row = this.db.prepare('SELECT baseline_alarm_id FROM detection WHERE account_id = ?').get(this.scope()) as
      | { baseline_alarm_id: string }
      | undefined;
    return row?.baseline_alarm_id ?? null;
  }

  async setBaselineAlarmId(alarmId: string, accountId?: string): Promise<void> {
    /** 움직이는 계정. */
    const active = this.activeAccountId();
    if (accountId !== undefined && (active === null || !isSameFlowUser(active, accountId))) return;
    this.writeBaseline(alarmId);
  }

  async hasMentionLocation({ postId, remarkId, replyId }: MentionLocation): Promise<boolean> {
    // 회사가 달라 같은 ID가 나와도 섞이지 않게, 움직이는 계정의 기록에서만 찾는다.
    return (
      this.db
        .prepare(
          `SELECT 1 FROM mention WHERE account_id = @account AND post_id = @postId AND remark_id = @remarkId AND reply_id = @replyId
           UNION ALL
           SELECT 1 FROM minimal_record_mention WHERE account_id = @account AND post_id = @postId AND remark_id = @remarkId AND reply_id = @replyId`,
        )
        .get({ account: this.scope(), postId, remarkId, replyId }) !== undefined
    );
  }

  async listBundles(): Promise<MentionBundle[]> {
    return this.readBundles('account_id = ?', [this.scope()]);
  }

  async listStoredBundles(): Promise<MentionBundle[]> {
    return this.readBundles('account_id IN (SELECT user_id FROM account WHERE active = 0)', []);
  }

  /** `where`에 맞는 묶음 줄과 그 멘션·내 답을 읽는다. */
  private readBundles(where: string, params: readonly unknown[]): MentionBundle[] {
    /** 묶음마다 멘션. 알림 시각, 같으면 alarmId 크기 순서다. */
    const mentions = groupBy(
      this.db
        .prepare(
          `SELECT * FROM (
             SELECT bundle_id, post_id, remark_id, reply_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at, text, answered,
               gone, gone_excluded
             FROM mention WHERE bundle_id IN (SELECT id FROM mention_bundle WHERE ${where})
           ) ORDER BY bundle_id, registered_date_time, length(alarm_id), alarm_id`,
        )
        .all(...params) as MentionRow[],
    );
    /** 묶음마다 기록한 내 답. 기록한 순서다. */
    const answers = groupBy(
      this.db
        .prepare(
          `SELECT bundle_id, answer_id, registered_date_time, excluded FROM bundle_answer
           WHERE bundle_id IN (SELECT id FROM mention_bundle WHERE ${where}) ORDER BY bundle_id, rowid`,
        )
        .all(...params) as AnswerRow[],
    );
    /** 묶음 줄. */
    const rows = this.db.prepare(`SELECT * FROM mention_bundle WHERE ${where} ORDER BY id`).all(...params) as BundleRow[];
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
      repoCheck: readRepoCheck(row.repo_check),
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
      manual: row.manual === 1,
      ...(row.assignment ? { assignment: JSON.parse(row.assignment) as NonNullable<MentionBundle['assignment']> } : {}),
    }));
  }

  async getAssignmentState(): Promise<AssignmentState | null> {
    /** 움직이는 계정의 담당 업무 감지 기록. */
    const row = this.db.prepare('SELECT state FROM assignment_detection WHERE account_id = ?').get(this.scope()) as { state: string } | undefined;
    return row ? JSON.parse(row.state) as AssignmentState : null;
  }

  async setAssignmentState(state: AssignmentState): Promise<void> {
    /** 움직이는 계정. */
    const active = this.activeAccountId();
    if (active === null || !isSameFlowUser(active, state.accountId)) return;
    this.db.prepare('INSERT OR REPLACE INTO assignment_detection (account_id, state) VALUES (?, ?)').run(active, JSON.stringify(state));
  }

  async addAssignmentBundle(bundle: UnsavedBundle, accountId: string): Promise<MentionBundle | null> {
    /** 움직이는 계정. */
    const active = this.activeAccountId();
    if (active === null || !isSameFlowUser(active, accountId) || !bundle.assignment) return null;
    return this.db.transaction(() => {
      if (this.db.prepare('SELECT 1 FROM assignment_record WHERE account_id = ? AND project_id = ? AND task_id = ?').get(active, bundle.projectId, bundle.assignment!.taskId)) return null;
      /** 초안 성공이 아니라 묶음 발견 기록이다. 실패는 같은 묶음에서 재시도한다. */
      const saved = this.writeBundle(bundle);
      this.db.prepare('INSERT INTO assignment_record (account_id, project_id, task_id, bundle_id) VALUES (?, ?, ?, ?)').run(active, bundle.projectId, bundle.assignment!.taskId, saved.id);
      return saved;
    })();
  }

  async saveDetectedBundles(bundles: readonly UnsavedBundle[], baselineAlarmId: string): Promise<MentionBundle[]> {
    return this.db.transaction(() => {
      /** 저장한 묶음. */
      const saved = bundles.map((bundle) => this.writeBundle(bundle));
      this.writeBaseline(baselineAlarmId);
      return saved;
    })();
  }

  async addManualBundle(bundle: UnsavedBundle, replacedRecordIds: readonly number[]): Promise<MentionBundle> {
    /** 움직이는 계정. */
    const account = this.scope();
    return this.db.transaction(() => {
      // 최소 기록의 멘션 위치·게시 범위는 외래 키로 함께 지워진다.
      for (const recordId of replacedRecordIds) this.db.prepare('DELETE FROM minimal_record WHERE bundle_id = ? AND account_id = ?').run(recordId, account);
      /** 저장한 묶음. */
      const saved = this.writeBundle({ ...bundle, id: null, manual: true });
      // 전에 처리한 업무면 처리 기록이 옛 묶음을 가리키고 있어 새 묶음으로 바꾼다.
      if (bundle.assignment) {
        this.db
          .prepare('INSERT OR REPLACE INTO assignment_record (account_id, project_id, task_id, bundle_id) VALUES (?, ?, ?, ?)')
          .run(account, bundle.projectId, bundle.assignment.taskId, saved.id);
      }
      return saved;
    })();
  }

  async saveBundle(bundle: MentionBundle): Promise<void> {
    this.db.transaction(() => this.writeBundle(bundle))();
  }

  /**
   * 움직이는 계정의 묶음 한 줄을 넣거나 바꾸고, 그 묶음의 멘션과 내 답을 주어진 값으로 맞춘다. 새 묶음은 ID를 받는다.
   * 같은 계정의 다른 묶음에 이미 든 멘션 위치는 기본 키가 막아 실패한다. 다른 계정의 묶음은 바꾸지 않는다. 트랜잭션 안에서만 부른다.
   */
  private writeBundle(bundle: UnsavedBundle): MentionBundle {
    /** 묶음의 계정. */
    const account = this.scope();
    /** 묶음 줄의 값. */
    const values = {
      account,
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
      manual: bundle.manual ? 1 : 0,
      assignment: jsonOrNull(bundle.assignment ?? null),
    };
    /** 묶음 ID. */
    let id = bundle.id;
    if (id === null) {
      id = Number(
        this.db
          .prepare(
            `INSERT INTO mention_bundle (account_id, post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at,
               context, watched_context, repo_check, user_repos, draft, edited_text, removed_recipients, directives, fixed_requirement, regeneration, failure, runs, posting,
               quit_during_countdown, manual, assignment)
             VALUES (@account, @postId, @remarkId, @projectId, @status, @postTitle, @connectUrl, @newMentionCount, @createdAt, @processedAt,
               @context, @watchedContext, @repoCheck, @userRepos, @draft, @editedText, @removedRecipients, @directives, @fixedRequirement, @regeneration, @failure, @runs, @posting,
               @quitDuringCountdown, @manual, @assignment)`,
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
             quit_during_countdown = @quitDuringCountdown, manual = @manual, assignment = @assignment
           WHERE id = @id AND account_id = @account`,
        )
        .run({ ...values, id });
      if (changes === 0) throw new Error(`저장하지 않은 묶음 ${id}입니다.`);
    }

    this.db.prepare('DELETE FROM mention WHERE bundle_id = ?').run(id);
    /** 멘션 하나를 넣는 문장. */
    const insertMention = this.db.prepare(
      `INSERT INTO mention (account_id, post_id, remark_id, reply_id, bundle_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at, text,
         answered, gone, gone_excluded)
       VALUES (@account, @postId, @remarkId, @replyId, @bundleId, @projectId, @alarmId, @senderId, @senderName, @registeredDateTime, @detectedAt, @text,
         @answered, @gone, @goneExcluded)`,
    );
    for (const mention of bundle.mentions) {
      insertMention.run({
        ...mention,
        account,
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
    /** 움직이는 계정. */
    const account = this.scope();
    /** 최소 기록마다 묶음에 있던 멘션 위치. */
    const mentions = groupBy(
      this.db
        .prepare('SELECT bundle_id, post_id, remark_id, reply_id FROM minimal_record_mention WHERE account_id = ? ORDER BY bundle_id, rowid')
        .all(account) as LocationRow[],
    );
    /** 최소 기록마다 이 PC가 게시한 글이 답한 멘션 위치. */
    const answered = groupBy(
      this.db
        .prepare(
          `SELECT bundle_id, post_id, remark_id, reply_id FROM minimal_record_answered
           WHERE bundle_id IN (SELECT bundle_id FROM minimal_record WHERE account_id = ?) ORDER BY bundle_id, rowid`,
        )
        .all(account) as LocationRow[],
    );
    /** 최소 기록 줄. */
    const rows = this.db.prepare('SELECT * FROM minimal_record WHERE account_id = ? ORDER BY bundle_id').all(account) as MinimalRecordRow[];
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
    /** 묶음의 계정을 읽는 문장. 최소 기록은 그 묶음의 계정에 남는다(보관 중인 계정의 묶음도 정리한다). */
    const accountOf = this.db.prepare('SELECT account_id FROM mention_bundle WHERE id = ?');
    /** 최소 기록 한 줄을 넣는 문장. */
    const insertRecord = this.db.prepare(
      `INSERT INTO minimal_record (bundle_id, account_id, post_id, remark_id, status, processed_at, posted_id)
       VALUES (@bundleId, @account, @postId, @remarkId, @status, @processedAt, @postedId)`,
    );
    /** 묶음에 있던 멘션 위치 하나를 넣는 문장. */
    const insertMention = this.db.prepare(
      'INSERT INTO minimal_record_mention (account_id, post_id, remark_id, reply_id, bundle_id) VALUES (@account, @postId, @remarkId, @replyId, @bundleId)',
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
        /** 묶음의 계정. */
        const row = accountOf.get(record.bundleId) as { account_id: string } | undefined;
        if (!row) throw new Error(`저장하지 않은 묶음 ${record.bundleId}입니다.`);
        deleteMentions.run(record.bundleId);
        deleteAnswers.run(record.bundleId);
        deleteBundle.run(record.bundleId);

        insertRecord.run({
          bundleId: record.bundleId,
          account: row.account_id,
          postId: record.postId,
          remarkId: record.remarkId,
          status: record.status,
          processedAt: record.processedAt,
          postedId: record.posted?.postedId ?? null,
        });
        for (const location of record.mentions) insertMention.run({ ...mentionLocationOf(location), account: row.account_id, bundleId: record.bundleId });
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
    /** 움직이는 계정의 묶음 줄을 지우는 문장. */
    const deleteBundle = this.db.prepare('DELETE FROM mention_bundle WHERE id = ? AND account_id = ?');
    /** 움직이는 계정. */
    const account = this.scope();

    // 하나라도 실패하면 아무것도 지우지 않는다.
    this.db.transaction(() => {
      for (const bundleId of bundleIds) {
        deleteMentions.run(bundleId);
        deleteAnswers.run(bundleId);
        /** 지운 묶음 줄 수. */
        const { changes } = deleteBundle.run(bundleId, account);
        if (changes === 0) throw new Error(`저장하지 않은 묶음 ${bundleId}입니다.`);
      }
    })();

    this.clearWal();
  }

  async getGenerationQueue(): Promise<QueuedTarget[]> {
    /** 남긴 대기열 가운데 움직이는 계정의 Flow 줄과 계정에 매이지 않은 줄. 실행할 순서다. */
    const rows = this.db
      .prepare('SELECT kind, target_id, priority FROM draft_queue WHERE account_id IS NULL OR account_id = ? ORDER BY position, id')
      .all(this.scope()) as { kind: string; target_id: number; priority: string }[];
    // 표의 검사가 자리를 막아 두지만, 이 앱이 모르는 자리가 있으면 그 줄만 빼고 화면 순서에 맡긴다.
    return rows.flatMap(({ kind, target_id: targetId, priority }) => (isQueuePriority(priority) ? [{ kind, targetId, priority }] : []));
  }

  async setGenerationQueue(queue: readonly QueuedTarget[]): Promise<void> {
    /** 움직이는 계정. 보관 중인 계정의 Flow 줄은 그대로 둔다. */
    const account = this.scope();
    /** 대기열 한 줄을 넣는 문장. */
    const insert = this.db.prepare('INSERT INTO draft_queue (position, kind, target_id, priority, account_id) VALUES (?, ?, ?, ?, ?)');
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM draft_queue WHERE account_id IS NULL OR account_id = ?').run(account);
      queue.forEach(({ kind, targetId, priority }, position) =>
        insert.run(position, kind, targetId, priority, kind === ACCOUNT_BOUND_QUEUE_KIND ? account : null),
      );
    })();
  }

  async getSignatureFailedVersions(): Promise<string[]> {
    /** 서명 검증에 실패한 버전마다 한 줄. */
    const rows = this.db.prepare('SELECT version FROM update_signature_failure ORDER BY version').all() as { version: string }[];
    return rows.map((row) => row.version);
  }

  async addSignatureFailedVersion(version: string): Promise<void> {
    this.db.prepare('INSERT INTO update_signature_failure (version) VALUES (?) ON CONFLICT (version) DO NOTHING').run(version);
  }

  async removeSignatureFailedVersion(version: string): Promise<void> {
    this.db.prepare('DELETE FROM update_signature_failure WHERE version = ?').run(version);
  }

  async getUpdateAttempt(): Promise<UpdateAttempt | null> {
    /** 남긴 업데이트 시도. */
    const row = this.db.prepare('SELECT from_version, to_version, attempted_at, rejected FROM update_attempt WHERE id = 1').get() as
      | { from_version: string; to_version: string; attempted_at: number; rejected: number }
      | undefined;
    return row ? { fromVersion: row.from_version, toVersion: row.to_version, attemptedAt: row.attempted_at, rejected: row.rejected === 1 } : null;
  }

  async setUpdateAttempt(attempt: UpdateAttempt): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO update_attempt (id, from_version, to_version, attempted_at, rejected) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET from_version = excluded.from_version, to_version = excluded.to_version,
           attempted_at = excluded.attempted_at, rejected = excluded.rejected`,
      )
      .run(attempt.fromVersion, attempt.toVersion, attempt.attemptedAt, attempt.rejected ? 1 : 0);
  }

  async clearUpdateAttempt(): Promise<void> {
    this.db.prepare('DELETE FROM update_attempt').run();
  }

  /** 움직이는 계정의 기준점 한 줄을 넣거나 바꾼다. */
  private writeBaseline(alarmId: string): void {
    this.db
      .prepare(
        'INSERT INTO detection (account_id, baseline_alarm_id) VALUES (?, ?) ON CONFLICT (account_id) DO UPDATE SET baseline_alarm_id = excluded.baseline_alarm_id',
      )
      .run(this.scope(), alarmId);
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

/**
 * 저장소 대기의 사유를 읽는다. 자동 선택 때 저장한 옛 사유(후보 없음, 확신 없음, 코드와 무관함)는 저장소 매핑 필요로 읽는다.
 * 저장된 값은 고치지 않으며, 앱을 켤 때의 다시 판정이 묶음을 맞는 상태로 옮긴다.
 */
function readRepoCheck(json: string | null): RepoCheck | null {
  /** 저장된 사유. */
  const stored = readJson<{ kind?: string }>(json);
  if (stored === null) return null;
  return stored.kind === 'missing-folders' ? (stored as RepoCheck) : { kind: 'unmapped' };
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
  /** 최근 멘션 확인에서 고른 수동 요청 묶음이면 1. */
  manual: number;
  /** 별도 감지 사유인 담당 업무 자료. */
  assignment: string | null;
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
