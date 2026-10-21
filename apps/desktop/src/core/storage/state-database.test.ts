import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Mention } from '../detection/mention';
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
function mention(alarmId: string, overrides: Partial<Mention> = {}): Mention {
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
    ...overrides,
  };
}

describe('감지한 멘션', () => {
  it('멘션을 멘션 위치로 저장하고 기준점을 옮기며, 다시 열어도 그대로 읽힌다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    const store = new SqliteStateStore(db);

    /** 새로 저장한 멘션. */
    const added = await store.addDetectedMentions(
      [mention('102', { remarkId: '700', registeredDateTime: '20261020085000' }), mention('101', { remarkId: '700', replyId: '801' })],
      '103',
    );
    db.close();

    /** 다시 연 저장소. */
    const reopened = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    expect(added.map((item) => item.alarmId)).toEqual(['102', '101']);
    expect(await reopened.getBaselineAlarmId()).toBe('103');
    expect(await reopened.listMentions()).toEqual([
      mention('102', { remarkId: '700', registeredDateTime: '20261020085000' }),
      mention('101', { remarkId: '700', replyId: '801' }),
    ]);
    expect(await reopened.countMentions()).toBe(2);
    expect(await reopened.hasMentionLocation({ postId: '90000011', remarkId: '700', replyId: '801' })).toBe(true);
    expect(await reopened.hasMentionLocation({ postId: '90000011', remarkId: '700', replyId: '802' })).toBe(false);
  });

  it('이미 기록한 멘션 위치는 다시 저장하지 않고, 새로 저장한 멘션만 돌려준다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.addDetectedMentions([mention('101')], '101');

    /** 두 번째로 저장한 멘션. */
    const added = await store.addDetectedMentions([mention('105', { senderName: '다른 이름' }), mention('106', { postId: 'p2' })], '106');

    expect(added.map((item) => item.alarmId)).toEqual(['106']);
    expect((await store.listMentions()).map((item) => [item.postId, item.alarmId, item.senderName])).toEqual([
      ['90000011', '101', '보낸 사람'],
      ['p2', '106', '보낸 사람'],
    ]);
    expect(await store.getBaselineAlarmId()).toBe('106');
  });

  it('다른 계정으로 처음부터 시작하면 감지한 멘션도 지운다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.setAccount(OLD_ACCOUNT);
    await store.addDetectedMentions([mention('101')], '101');

    await store.resetForAccount(NEW_ACCOUNT);

    expect(await store.countMentions()).toBe(0);
    expect(await store.hasMentionLocation(mention('101'))).toBe(false);
    expect(await store.getBaselineAlarmId()).toBeNull();
  });
});
