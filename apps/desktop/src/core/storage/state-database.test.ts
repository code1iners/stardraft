import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BundledMention, UnsavedBundle } from '../bundles/mention-bundle';
import type { BundleContext } from '../flow/bundle-context';
import type { FlowEmployee } from '../ports/flow-api';
import { openStateDatabase, SqliteStateStore, STATE_MIGRATIONS } from './state-database';

/** 테스트마다 만드는 임시 폴더. */
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'stardraft-state-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 앞서 쓰던 가짜 계정. */
const OLD_ACCOUNT: FlowEmployee = { userId: 'old@example.test', name: '옛 사용자', division: '옛 팀', email: 'old@example.test' };
/** 새로 연결한 가짜 계정. */
const NEW_ACCOUNT: FlowEmployee = { userId: 'new@example.test', name: '새 사용자', division: '새 팀', email: 'new@example.test' };

// 상태 저장소 포트에는 아직 행을 지우는 동작이 없어서, 연 DB에 지울 행을 직접 만들어 검사한다.
// 한 줄짜리 값을 덮어쓰는 것만으로는 secure_delete를 꺼도 흔적이 남지 않아 구분되지 않는다.
describe('state.db 연결', () => {
  it('지운 행의 내용이 state.db 파일에 남지 않는다(secure_delete)', () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    db.exec('CREATE TABLE mentions (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
    /** 행 하나를 넣는 문장. */
    const insert = db.prepare('INSERT INTO mentions (body) VALUES (?)');
    for (let index = 0; index < 20; index += 1) insert.run(`가짜 본문 ${index} ${'x'.repeat(40)}`);
    insert.run(`지울 가짜 본문 ${'m'.repeat(40)}`);

    db.prepare('DELETE FROM mentions WHERE body LIKE ?').run('지울%');
    db.close();

    expect(readFileSync(path).includes(Buffer.from('지울 가짜 본문'))).toBe(false);
    expect(readFileSync(path).includes(Buffer.from('가짜 본문 19'))).toBe(true);
  });
});

describe('다른 계정으로 처음부터 시작', () => {
  it('계정과 앱 버전 기록만 남기고 기준점과 다른 모든 기록을 지우며, 지운 글은 state.db와 WAL 어디에도 남지 않는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    const store = new SqliteStateStore(db);
    await store.setAccount(OLD_ACCOUNT);
    await store.setBaselineAlarmId('1001');
    // 뒤 티켓이 더할 표를 흉내 낸다. 외래 키가 있어도 지우는 순서와 상관없이 지워져야 한다.
    db.exec(`
      CREATE TABLE mention_bundles (id TEXT PRIMARY KEY);
      CREATE TABLE mentions (id TEXT PRIMARY KEY, bundle_id TEXT NOT NULL REFERENCES mention_bundles (id), body TEXT NOT NULL);
      INSERT INTO mention_bundles VALUES ('b-1');
      INSERT INTO mentions VALUES ('m-1', 'b-1', '옛 계정의 가짜 멘션 본문');
    `);

    await store.resetForAccount(NEW_ACCOUNT);

    await expect(store.getAccount()).resolves.toEqual(NEW_ACCOUNT);
    await expect(store.getBaselineAlarmId()).resolves.toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS count FROM mentions').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM mention_bundles').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT app_version FROM app_meta').get()).toEqual({ app_version: '0.1.0' });
    /** 옛 계정의 글. */
    const oldBody = Buffer.from('옛 계정의 가짜 멘션 본문');
    expect(readFileSync(path).includes(oldBody)).toBe(false);
    expect(readFileSync(`${path}-wal`).includes(oldBody)).toBe(false);
    db.close();
  });
});

/** 가짜 멘션. 실제 사람이나 글이 아니다. */
function mention(alarmId: string, overrides: Partial<BundledMention> = {}): BundledMention {
  return {
    postId: '90000011',
    remarkId: '-1',
    replyId: '-1',
    projectId: '900001',
    alarmId,
    senderId: 'sender@example.test',
    senderName: '보낸 사람',
    registeredDateTime: '20261020085900',
    detectedAt: 1_000,
    text: '@[테스트 사용자](me@example.test) 가짜 질문',
    answered: false,
    ...overrides,
  };
}

/** 가짜 멘션 묶음. 아직 저장하지 않아 ID가 없다. */
function bundle(mentions: BundledMention[], overrides: Partial<UnsavedBundle> = {}): UnsavedBundle {
  return {
    id: null,
    postId: mentions[0]?.postId ?? '90000011',
    remarkId: mentions[0]?.remarkId ?? '-1',
    projectId: '900001',
    status: 'repo-check-needed',
    postTitle: '가짜 게시물',
    connectUrl: 'https://fake.flow.test/post/90000011',
    mentions,
    answers: [],
    newMentionCount: 0,
    createdAt: 1_000,
    processedAt: null,
    context: null,
    ...overrides,
  };
}

describe('멘션 묶음', () => {
  it('새 묶음을 저장하면 ID를 받고 기준점을 옮기며, 다시 열어도 묶음·멘션·내 답이 그대로 읽힌다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    const store = new SqliteStateStore(db);

    /** 저장한 묶음. */
    const saved = await store.saveDetectedBundles(
      [
        bundle([mention('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020085000' }), mention('101', { remarkId: '700' })], {
          status: 'already-answered',
          processedAt: 2_000,
          answers: [{ answerId: '802', registeredDateTime: '20261020085930', excluded: false }],
        }),
        bundle([mention('103', { postId: 'p2', answered: true })], { connectUrl: null, newMentionCount: 2 }),
      ],
      '103',
    );
    db.close();

    /** 다시 연 저장소. */
    const reopened = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    expect(saved.map((item) => item.id)).toEqual([1, 2]);
    expect(await reopened.getBaselineAlarmId()).toBe('103');
    expect(await reopened.listBundles()).toEqual([
      {
        ...bundle([mention('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020085000' }), mention('101', { remarkId: '700' })], {
          status: 'already-answered',
          processedAt: 2_000,
          answers: [{ answerId: '802', registeredDateTime: '20261020085930', excluded: false }],
        }),
        id: 1,
      },
      { ...bundle([mention('103', { postId: 'p2', answered: true })], { connectUrl: null, newMentionCount: 2 }), id: 2 },
    ]);
    expect(await reopened.hasMentionLocation({ postId: '90000011', remarkId: '700', replyId: '801' })).toBe(true);
    expect(await reopened.hasMentionLocation({ postId: '90000011', remarkId: '700', replyId: '802' })).toBe(false);
  });

  it('저장한 묶음을 다시 저장하면 상태·멘션·내 답을 그 값으로 맞춘다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    /** 처음 저장한 댓글 스레드 묶음. */
    const [first] = await store.saveDetectedBundles(
      [bundle([mention('101', { remarkId: '700' })], { answers: [{ answerId: '9', registeredDateTime: '20261020080000', excluded: false }] })],
      '101',
    );

    // 같은 묶음에 대댓글 멘션을 합친다.
    /** 합친 묶음. */
    const [merged] = await store.saveDetectedBundles(
      [{ ...first!, newMentionCount: 1, mentions: [...first!.mentions, mention('102', { remarkId: '700', replyId: '801', registeredDateTime: '20261020090000' })] }],
      '102',
    );
    // 무시하면서 내 답을 빼기로 기록한다.
    await store.saveBundle({ ...merged!, status: 'ignored', processedAt: 3_000, answers: [{ answerId: '9', registeredDateTime: '20261020080000', excluded: true }] });

    expect(merged?.id).toBe(first?.id);
    expect(await store.listBundles()).toEqual([
      {
        ...merged!,
        status: 'ignored',
        processedAt: 3_000,
        newMentionCount: 1,
        answers: [{ answerId: '9', registeredDateTime: '20261020080000', excluded: true }],
      },
    ]);
    expect((await store.listBundles())[0]?.mentions.map((item) => item.alarmId)).toEqual(['101', '102']);
  });

  it('다른 묶음에 이미 든 멘션 위치를 저장하면 실패하고, 묶음과 기준점을 바꾸지 않는다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.saveDetectedBundles([bundle([mention('101')])], '101');

    await expect(store.saveDetectedBundles([bundle([mention('105', { senderName: '다른 이름' })]), bundle([mention('106', { postId: 'p2' })])], '106')).rejects.toThrow();

    expect((await store.listBundles()).map((item) => [item.id, item.mentions.map((each) => each.alarmId)])).toEqual([[1, ['101']]]);
    expect(await store.getBaselineAlarmId()).toBe('101');
  });

  it('지운 묶음의 ID는 다시 쓰지 않는다(다른 계정으로 처음부터 시작한 뒤에도)', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.setAccount(OLD_ACCOUNT);
    await store.saveDetectedBundles([bundle([mention('101')])], '101');

    await store.resetForAccount(NEW_ACCOUNT);
    /** 새 계정에서 처음 저장한 묶음. */
    const [next] = await store.saveDetectedBundles([bundle([mention('201')])], '201');

    expect(next?.id).toBe(2);
  });

  it('다른 계정으로 처음부터 시작하면 묶음과 멘션도 지운다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.setAccount(OLD_ACCOUNT);
    await store.saveDetectedBundles([bundle([mention('101')], { answers: [{ answerId: '9', registeredDateTime: '20261020080000', excluded: true }] })], '101');

    await store.resetForAccount(NEW_ACCOUNT);

    expect(await store.listBundles()).toEqual([]);
    expect(await store.hasMentionLocation(mention('101'))).toBe(false);
    expect(await store.getBaselineAlarmId()).toBeNull();
  });

  it('형식 3에서 올리면 이미 감지한 멘션은 자리마다 저장소 확인 필요 묶음이 되고, 가장 이른 멘션 순으로 ID를 받는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 3으로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 3), '0.0.9');
    /** 형식 3의 멘션 한 줄을 넣는 문장. */
    const insert = old.prepare(
      `INSERT INTO mention (post_id, remark_id, reply_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at)
       VALUES (?, ?, ?, '900001', ?, 'sender@example.test', '보낸 사람', ?, 1000)`,
    );
    insert.run('90000011', '700', '-1', '101', '20261020085000');
    insert.run('90000011', '700', '801', '102', '20261020085100');
    insert.run('90000011', '-1', '-1', '103', '20261020085200');
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect(
      (await store.listBundles()).map((item) => [item.postId, item.remarkId, item.status, item.mentions.map((each) => [each.alarmId, each.text, each.answered])]),
    ).toEqual([
      ['90000011', '700', 'repo-check-needed', [['101', '', false], ['102', '', false]]],
      ['90000011', '-1', 'repo-check-needed', [['103', '', false]]],
    ]);
  });

  it('묶음에 저장한 맥락(비교 기준)을 다시 열어도 그대로 읽고, 다시 저장하면 새 맥락으로 바꾼다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    const store = new SqliteStateStore(db);
    /** 처음 조회한 맥락. */
    const context: BundleContext = {
      fetchedAt: 2_000,
      post: { title: '가짜 게시물', authorName: '보낸 사람', registeredDateTime: '20261020085000', contents: '본문', attachments: ['설계서.pdf'], mention: false },
      targetThread: {
        id: '700',
        authorName: '보낸 사람',
        registeredDateTime: '20261020085900',
        contents: '@[테스트 사용자](me@example.test) 가짜 질문',
        attachments: [],
        mention: true,
        replies: [{ id: '801', authorName: '동료', registeredDateTime: '20261020090000', contents: '대댓글', attachments: [], mention: false }],
      },
      otherComments: [],
    };
    /** 저장한 묶음. */
    const [saved] = await store.saveDetectedBundles([bundle([mention('101', { remarkId: '700' })], { context })], '101');
    db.close();

    /** 다시 연 저장소. */
    const reopened = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    expect((await reopened.listBundles())[0]?.context).toEqual(context);

    /** 새로 조회한 맥락. */
    const refreshed: BundleContext = { ...context, fetchedAt: 3_000, targetThread: { ...context.targetThread!, replies: [] } };
    await reopened.saveBundle({ ...saved!, context: refreshed });
    expect((await reopened.listBundles())[0]?.context).toEqual(refreshed);
  });

  it('형식 4에서 올리면 이미 있던 묶음은 맥락 없이 그대로 남는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 4로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 4), '0.0.9');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at)
         VALUES ('90000011', '-1', '900001', 'repo-check-needed', '가짜 게시물', NULL, 0, 1000, NULL)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map((item) => [item.postTitle, item.context])).toEqual([['가짜 게시물', null]]);
  });
});
