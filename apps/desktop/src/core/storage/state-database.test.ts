import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BundledMention, RepoCheck, UnsavedBundle } from '../bundles/mention-bundle';
import type { Draft, RunRecord } from '../drafts/draft';
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

// 포트를 거치지 않고 연결 설정만 보려고, 연 DB에 지울 행을 직접 만들어 검사한다.
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
    gone: false,
    goneExcluded: false,
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
    watchedContext: null,
    repoCheck: null,
    userRepos: null,
    draft: null,
    editedText: null,
    removedRecipients: [],
    directives: [],
    fixedRequirement: null,
    regeneration: null,
    failure: null,
    runs: [],
    posting: null,
    quitDuringCountdown: false,
    trial: false,
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
      post: { title: '가짜 게시물', authorId: 'sender@example.test', authorName: '보낸 사람', registeredDateTime: '20261020085000', contents: '본문', attachments: ['설계서.pdf'], mention: false },
      targetThread: {
        id: '700',
        authorId: 'sender@example.test',
        authorName: '보낸 사람',
        registeredDateTime: '20261020085900',
        contents: '@[테스트 사용자](me@example.test) 가짜 질문',
        attachments: [],
        mention: true,
        replies: [{ id: '801', authorId: 'colleague@example.test', authorName: '동료', registeredDateTime: '20261020090000', contents: '대댓글', attachments: [], mention: false }],
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

  it('초안 실행의 결과(초안과 자동 선택의 내력, 실패 사유와 실패한 실행, 저장소 확인 필요 사유, 실행 기록)를 다시 열어도 그대로 읽는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    /** 저장할 초안. */
    const draft: Draft = {
      requirement: { text: '실제 서비스에서 재시도를 몇 번 하는지 알고 싶다.', summary: '재시도 횟수' },
      paragraphs: [{ sentences: [{ text: '다섯 번까지 다시 시도합니다.', evidence: [1] }] }],
      evidence: [{ id: 1, explanation: '운영 설정에서 횟수를 5로 정합니다.', repository: '/fake/repo-a', path: 'config.yml', startLine: 88, endLine: 88, located: false }],
      repositories: ['/fake/repo-a', '/fake/repo-b'],
      autoSelection: { kind: 'chosen', reason: '재시도 설정을 묻고 있어 서버 저장소를 골랐습니다.' },
      createdAt: 2_000,
    };
    /** 선택 실행이 확신하지 못한 사유. */
    const unsure: RepoCheck = {
      kind: 'unsure',
      reason: '어느 저장소인지 알 수 없습니다.',
      candidates: [
        { name: 'team/api', path: '/fake/work/team/api' },
        { name: 'team/web', path: '/fake/work/team/web' },
      ],
      picked: ['/fake/work/team/web'],
    };
    /** 저장할 실행 기록. */
    const run: RunRecord = {
      kind: 'draft',
      agent: 'claude-code',
      cliVersion: '2.1.305',
      model: 'sonnet',
      startedAt: 1_500,
      finishedAt: 2_000,
      result: 'succeeded',
      detail: null,
      lastStep: '파일 읽는 중: config.yml',
      fixes: [],
      omittedContextItems: 2,
      usage: { costUsd: 0.01, inputTokens: 100, outputTokens: 20 },
    };
    /** 저장한 묶음. */
    const [ready, failed] = await store.saveDetectedBundles(
      [
        bundle([mention('101', { remarkId: '700' })], { status: 'ready', draft, runs: [run] }),
        bundle([mention('102')], {
          status: 'failed',
          failure: { reason: 'timed-out', detail: null, lastStep: '검색 중: retry', runKind: 'selection' },
          runs: [{ ...run, kind: 'selection', result: 'timed-out', usage: null }],
        }),
        bundle([mention('103', { postId: '90000012' })], { repoCheck: { kind: 'missing-folders', paths: ['/fake/gone'] } }),
        bundle([mention('104', { postId: '90000013' })], { repoCheck: { kind: 'no-candidates' } }),
        bundle([mention('105', { postId: '90000014' })], { repoCheck: unsure }),
      ],
      '105',
    );

    /** 다시 연 저장소에서 읽은 묶음. */
    const reopened = await new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0')).listBundles();

    expect(reopened.map(({ status, draft: saved, failure, repoCheck, runs }) => ({ status, draft: saved, failure, repoCheck, runs }))).toEqual([
      { status: 'ready', draft, failure: null, repoCheck: null, runs: [run] },
      {
        status: 'failed',
        draft: null,
        failure: { reason: 'timed-out', detail: null, lastStep: '검색 중: retry', runKind: 'selection' },
        repoCheck: null,
        runs: [{ ...run, kind: 'selection', result: 'timed-out', usage: null }],
      },
      { status: 'repo-check-needed', draft: null, failure: null, repoCheck: { kind: 'missing-folders', paths: ['/fake/gone'] }, runs: [] },
      { status: 'repo-check-needed', draft: null, failure: null, repoCheck: { kind: 'no-candidates' }, runs: [] },
      { status: 'repo-check-needed', draft: null, failure: null, repoCheck: unsure, runs: [] },
    ]);
    expect([ready?.id, failed?.id]).toEqual([1, 2]);
  });

  it('형식 5에서 올리면 이미 있던 묶음은 초안·실패 사유·실행 기록 없이 그대로 남는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 5로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 5), '0.0.9');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at, context)
         VALUES ('90000011', '-1', '900001', 'repo-check-needed', '가짜 게시물', NULL, 0, 1000, NULL, NULL)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map(({ status, draft, failure, repoCheck, runs }) => ({ status, draft, failure, repoCheck, runs }))).toEqual([
      { status: 'repo-check-needed', draft: null, failure: null, repoCheck: null, runs: [] },
    ]);
  });

  it('형식 6에서 올리면 이미 있던 초안의 근거는 순서 그대로 위치를 찾은 근거로 남는다(근거 위치 검증 전에 만든 초안)', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 6으로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 6), '0.0.9');
    /** 근거 위치 검증 전의 초안. 근거에 `located`가 없다. */
    const draft = {
      requirement: { text: '요구', summary: '요약' },
      paragraphs: [{ sentences: [{ text: '문장', evidence: [1, 2] }] }],
      evidence: [
        { id: 1, explanation: '첫 근거', repository: '/fake/repo-a', path: 'a.yml', startLine: 1, endLine: 1 },
        { id: 2, explanation: '둘째 근거', repository: '/fake/repo-a', path: 'b.yml', startLine: 2, endLine: 3 },
      ],
      repositories: ['/fake/repo-a'],
      createdAt: 2_000,
    };
    /** 묶음 하나를 넣는다. */
    const insert = old.prepare(
      `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at, context, draft)
       VALUES (?, '-1', '900001', ?, '가짜 게시물', NULL, 0, 1000, NULL, NULL, ?)`,
    );
    insert.run('90000011', 'ready', JSON.stringify(draft));
    insert.run('90000012', 'repo-check-needed', null);
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map((bundle) => bundle.draft)).toEqual([
      { ...draft, evidence: draft.evidence.map((item) => ({ ...item, located: true })), autoSelection: null },
      null,
    ]);
  });

  it('형식 7에서 올리면 이미 있던 초안은 자동 선택의 내력 없이(저장소 매핑으로 만든 초안), 실패는 실패한 실행의 종류 없이 남는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 7로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 7), '0.0.9');
    /** 자동 선택 전의 초안. `autoSelection`이 없다. */
    const draft = {
      requirement: { text: '요구', summary: '요약' },
      paragraphs: [{ sentences: [{ text: '문장', evidence: [1] }] }],
      evidence: [{ id: 1, explanation: '근거', repository: '/fake/repo-a', path: 'a.yml', startLine: 1, endLine: 1, located: true }],
      repositories: ['/fake/repo-a'],
      createdAt: 2_000,
    };
    /** 자동 선택 전의 실패. `runKind`가 없다. */
    const failure = { reason: 'timed-out', detail: null, lastStep: '초안 쓰는 중' };
    /** 묶음 하나를 넣는다. */
    const insert = old.prepare(
      `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at, context, draft, failure)
       VALUES (?, '-1', '900001', ?, '가짜 게시물', NULL, 0, 1000, NULL, NULL, ?, ?)`,
    );
    insert.run('90000011', 'ready', JSON.stringify(draft), null);
    insert.run('90000012', 'failed', null, JSON.stringify(failure));
    insert.run('90000013', 'repo-check-needed', null, null);
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map(({ draft: saved, failure: failed }) => ({ draft: saved, failure: failed }))).toEqual([
      { draft: { ...draft, autoSelection: null }, failure: null },
      { draft: null, failure: { ...failure, runKind: null } },
      { draft: null, failure: null },
    ]);
  });

  it('저장소 선택 창에서 고른 구성을 다시 열어도 순서 그대로 읽는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    await store.saveDetectedBundles(
      [bundle([mention('101')], { status: 'generating', userRepos: ['/fake/work/web', '/fake/work/api'] }), bundle([mention('102', { postId: '90000012' })])],
      '102',
    );

    /** 다시 연 저장소에서 읽은 묶음. */
    const reopened = await new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0')).listBundles();

    expect(reopened.map((item) => item.userRepos)).toEqual([['/fake/work/web', '/fake/work/api'], null]);
  });

  it('형식 8에서 올리면 이미 있던 묶음은 고른 구성 없이 남는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 8로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 8), '0.0.9');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at)
         VALUES ('90000011', '-1', '900001', 'generating', '가짜 게시물', NULL, 0, 1000, NULL)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map(({ status, userRepos }) => ({ status, userRepos }))).toEqual([{ status: 'generating', userRepos: null }]);
  });

  it('편집본과 받는 사람에서 뺀 사람을 다시 열어도 그대로 읽는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    await store.saveDetectedBundles(
      [
        bundle([mention('101')], { status: 'ready', editedText: '고친 초안\n\n둘째 문단', removedRecipients: ['other@example.test', 'third@example.test'] }),
        bundle([mention('102', { postId: '90000012' })]),
      ],
      '102',
    );

    /** 다시 연 저장소에서 읽은 묶음. */
    const reopened = await new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0')).listBundles();

    expect(reopened.map(({ editedText, removedRecipients }) => ({ editedText, removedRecipients }))).toEqual([
      { editedText: '고친 초안\n\n둘째 문단', removedRecipients: ['other@example.test', 'third@example.test'] },
      { editedText: null, removedRecipients: [] },
    ]);
  });

  it('형식 9에서 올리면 이미 있던 묶음은 편집본과 뺀 받는 사람 없이 남는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 9로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 9), '0.0.9');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at)
         VALUES ('90000011', '-1', '900001', 'ready', '가짜 게시물', NULL, 0, 1000, NULL)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map(({ editedText, removedRecipients }) => ({ editedText, removedRecipients }))).toEqual([
      { editedText: null, removedRecipients: [] },
    ]);
  });
  it('덧붙인 지시, 고친 요구, 다시 만드는 중인 재생성을 다시 열어도 그대로 읽는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    /** 지시를 덧붙여 다시 만드는 중인 재생성. 직전 결과와 자동 선택으로 정한 저장소를 든다. */
    const regeneration = {
      path: 'directive' as const,
      previous: {
        requirement: { text: '재시도 횟수를 알고 싶다.', summary: '재시도 횟수' },
        paragraphs: [{ sentences: [{ text: '다섯 번까지 다시 시도합니다.', evidence: [1] }] }],
        evidence: [{ id: 1, explanation: '설정에서 횟수를 정합니다.', repository: '/fake/repo', path: 'a.yml', startLine: 1, endLine: 2, located: true }],
      },
      autoSelected: { repositories: ['/fake/repo'], autoSelection: { kind: 'chosen' as const, reason: '설정을 묻고 있습니다.' } },
    };
    await store.saveDetectedBundles(
      [
        bundle([mention('101')], { status: 'generating', directives: ['더 짧게', '존댓말로'], regeneration }),
        bundle([mention('102', { postId: '90000012' })], { status: 'ready', fixedRequirement: '운영 환경의 횟수만 알고 싶다.' }),
      ],
      '102',
    );

    /** 다시 연 저장소에서 읽은 묶음. */
    const reopened = await new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0')).listBundles();

    expect(reopened.map(({ directives, fixedRequirement, regeneration }) => ({ directives, fixedRequirement, regeneration }))).toEqual([
      { directives: ['더 짧게', '존댓말로'], fixedRequirement: null, regeneration },
      { directives: [], fixedRequirement: '운영 환경의 횟수만 알고 싶다.', regeneration: null },
    ]);
  });

  it('형식 10에서 올리면 이미 있던 묶음은 지시, 고친 요구, 재생성 없이 남는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 10으로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 10), '0.0.10');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at)
         VALUES ('90000011', '-1', '900001', 'ready', '가짜 게시물', NULL, 0, 1000, NULL)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map(({ directives, fixedRequirement, regeneration }) => ({ directives, fixedRequirement, regeneration }))).toEqual([
      { directives: [], fixedRequirement: null, regeneration: null },
    ]);
  });

  it('게시 기록(보내기 전 기록, 올라간 글의 ID, 게시 실패의 사유)을 다시 열어도 그대로 읽는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    await store.saveDetectedBundles(
      [
        bundle([mention('101')], {
          status: 'posting',
          posting: { body: '@[보낸 사람](sender@example.test) 답\n\n둘째 문단', sentAt: 5_000, postedId: null, failure: null, answeredMentions: [] },
        }),
        bundle([mention('102', { postId: '90000012' })], {
          status: 'posted',
          processedAt: 6_000,
          posting: { body: '답', sentAt: 6_000, postedId: '950000001', failure: null, answeredMentions: [{ postId: '90000012', remarkId: '-1', replyId: '-1' }] },
        }),
        bundle([mention('103', { postId: '90000013' })], { status: 'ready' }),
        bundle([mention('104', { postId: '90000014' })], { status: 'post-failed', posting: { body: '답', sentAt: 7_000, postedId: null, failure: 'no-response', answeredMentions: [] } }),
      ],
      '104',
    );

    /** 다시 연 저장소에서 읽은 묶음. */
    const reopened = await new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0')).listBundles();

    expect(reopened.map(({ status, posting }) => ({ status, posting }))).toEqual([
      { status: 'posting', posting: { body: '@[보낸 사람](sender@example.test) 답\n\n둘째 문단', sentAt: 5_000, postedId: null, failure: null, answeredMentions: [] } },
      {
        status: 'posted',
        posting: { body: '답', sentAt: 6_000, postedId: '950000001', failure: null, answeredMentions: [{ postId: '90000012', remarkId: '-1', replyId: '-1' }] },
      },
      { status: 'ready', posting: null },
      { status: 'post-failed', posting: { body: '답', sentAt: 7_000, postedId: null, failure: 'no-response', answeredMentions: [] } },
    ]);
  });

  it('게시 실패의 사유와 답한 범위가 생기기 전에 적은 게시 기록은 사유 없이, 그 묶음의 멘션에 답한 것으로 읽는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 12로 만든 DB. 게시 기록에 사유와 답한 범위가 없다. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 12), '0.0.12');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at, posting)
         VALUES ('90000011', '700', '900001', 'posted', '가짜 게시물', NULL, 0, 1000, 6000, '{"body":"답","sentAt":5000,"postedId":"950000001"}')`,
      )
      .run();
    old
      .prepare(
        `INSERT INTO mention (post_id, remark_id, reply_id, bundle_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at, text, answered)
         VALUES ('90000011', '700', '801', 1, '900001', '101', 'sender@example.test', '보낸 사람', '20261020085000', 1000, '', 0)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 연 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map(({ posting }) => posting)).toEqual([
      { body: '답', sentAt: 5_000, postedId: '950000001', failure: null, answeredMentions: [{ postId: '90000011', remarkId: '700', replyId: '801' }] },
    ]);
  });

  it('형식 12에서 올리면 이미 있던 멘션은 사라진 적이 없고, 묶음은 변화 감시 내용이 없다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 12로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 12), '0.0.12');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at)
         VALUES ('90000011', '-1', '900001', 'ready', '가짜 게시물', NULL, 0, 1000, NULL)`,
      )
      .run();
    old
      .prepare(
        `INSERT INTO mention (post_id, remark_id, reply_id, bundle_id, project_id, alarm_id, sender_id, sender_name, registered_date_time, detected_at, text, answered)
         VALUES ('90000011', '-1', '-1', 1, '900001', '101', 'sender@example.test', '보낸 사람', '20261020085000', 1000, '', 0)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const [reopened] = await new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0')).listBundles();

    expect(reopened?.watchedContext).toBeNull();
    expect(reopened?.mentions.map(({ answered, gone, goneExcluded }) => ({ answered, gone, goneExcluded }))).toEqual([
      { answered: false, gone: false, goneExcluded: false },
    ]);
  });

  it('사라진 멘션, 사라짐 판정에서 빼기로 기록한 멘션, 변화 감시 내용을 다시 열어도 그대로 읽는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    /** 변화 감시가 조회한 맥락. */
    const watchedContext = {
      fetchedAt: 9_000,
      post: { title: '가짜 게시물', authorId: '', authorName: '', registeredDateTime: '', contents: '본문', attachments: [], mention: true },
      targetThread: null,
      otherComments: [{ id: '710', authorId: '', authorName: '동료', registeredDateTime: '20261020090100', contents: '새 댓글', attachments: [], mention: false, replies: [] }],
    };
    await store.saveDetectedBundles(
      [
        bundle([mention('101', { gone: true }), mention('102', { replyId: '801', remarkId: '700', goneExcluded: true })], {
          remarkId: '700',
          status: 'source-gone',
          watchedContext,
        }),
      ],
      '102',
    );

    /** 다시 연 저장소에서 읽은 묶음. */
    const [reopened] = await new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0')).listBundles();

    expect(reopened?.status).toBe('source-gone');
    expect(reopened?.watchedContext).toEqual(watchedContext);
    expect(reopened?.mentions.map(({ alarmId, gone, goneExcluded }) => ({ alarmId, gone, goneExcluded }))).toEqual([
      { alarmId: '101', gone: true, goneExcluded: false },
      { alarmId: '102', gone: false, goneExcluded: true },
    ]);
  });

  it('형식 11에서 올리면 이미 있던 묶음은 게시 기록 없이 남는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 11로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 11), '0.0.11');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at)
         VALUES ('90000011', '-1', '900001', 'ready', '가짜 게시물', NULL, 0, 1000, NULL)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map(({ status, posting }) => ({ status, posting }))).toEqual([{ status: 'ready', posting: null }]);
  });
});

describe('최소 기록', () => {
  /** 게시됨 본문 묶음의 최소 기록. 올린 글은 본문 멘션과, 게시를 누를 때 조회한 내용에 있던 댓글 멘션에 답했다. */
  const POSTED_RECORD = {
    bundleId: 1,
    postId: '90000011',
    remarkId: '-1',
    mentions: [{ postId: '90000011', remarkId: '-1', replyId: '-1' }],
    status: 'posted' as const,
    processedAt: 6_000,
    posted: {
      postedId: '950000001',
      answeredMentions: [
        { postId: '90000011', remarkId: '-1', replyId: '-1' },
        { postId: '90000011', remarkId: '701', replyId: '-1' },
      ],
    },
  };

  it('묶음을 최소 기록으로 바꾸면 묶음·멘션·내 답은 지우고, 다시 열어도 최소 기록과 그 멘션 위치는 남는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    await store.saveDetectedBundles(
      [
        bundle([mention('101')], {
          status: 'posted',
          processedAt: 6_000,
          answers: [{ answerId: '950000001', registeredDateTime: '20261020090000', excluded: false }],
          posting: { body: '가짜 답', sentAt: 5_000, postedId: '950000001', failure: null, answeredMentions: POSTED_RECORD.posted.answeredMentions },
        }),
        bundle([mention('102', { postId: '90000012' })], { status: 'ready' }),
      ],
      '102',
    );

    await store.archiveBundles([POSTED_RECORD]);

    /** 다시 연 저장소. */
    const reopened = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    expect((await reopened.listBundles()).map(({ id, postId }) => ({ id, postId }))).toEqual([{ id: 2, postId: '90000012' }]);
    await expect(reopened.listMinimalRecords()).resolves.toEqual([POSTED_RECORD]);
    await expect(reopened.hasMentionLocation({ postId: '90000011', remarkId: '-1', replyId: '-1' })).resolves.toBe(true);
    await expect(reopened.hasMentionLocation({ postId: '90000011', remarkId: '701', replyId: '-1' })).resolves.toBe(false);
  });

  it('최소 기록으로 바꾼 묶음의 Flow 원문·송신자 이름·초안·게시 본문은 state.db와 WAL 어디에도 남지 않는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    const store = new SqliteStateStore(db);
    /** 지울 글. 파일에서 찾기 쉽게 길게 둔다. */
    const secret = (label: string) => `${label} ${'q'.repeat(40)}`;
    await store.saveDetectedBundles(
      [
        bundle([mention('101', { text: secret('가짜 원문'), senderName: secret('가짜 송신자') })], {
          status: 'ignored',
          processedAt: 6_000,
          editedText: secret('가짜 편집본'),
          directives: [secret('가짜 지시')],
        }),
      ],
      '101',
    );

    await store.archiveBundles([{ ...POSTED_RECORD, status: 'ignored', posted: null }]);

    for (const label of ['가짜 원문', '가짜 송신자', '가짜 편집본', '가짜 지시']) {
      expect(readFileSync(path).includes(Buffer.from(label))).toBe(false);
      expect(readFileSync(`${path}-wal`).includes(Buffer.from(label))).toBe(false);
    }
    db.close();
  });

  it('지운 묶음의 ID는 최소 기록으로 바꾼 뒤에도 다시 쓰지 않는다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.saveDetectedBundles([bundle([mention('101')], { status: 'ignored', processedAt: 6_000 })], '101');
    await store.archiveBundles([{ ...POSTED_RECORD, status: 'ignored', posted: null }]);

    /** 새로 저장한 묶음. */
    const [saved] = await store.saveDetectedBundles([bundle([mention('102', { postId: '90000012' })])], '102');

    expect(saved?.id).toBe(2);
  });

  it('다른 계정으로 처음부터 시작하면 최소 기록도 지운다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.saveDetectedBundles([bundle([mention('101')], { status: 'ignored', processedAt: 6_000 })], '101');
    await store.archiveBundles([{ ...POSTED_RECORD, status: 'ignored', posted: null }]);

    await store.resetForAccount(NEW_ACCOUNT);

    await expect(store.listMinimalRecords()).resolves.toEqual([]);
    await expect(store.hasMentionLocation({ postId: '90000011', remarkId: '-1', replyId: '-1' })).resolves.toBe(false);
  });

  it('형식 13에서 올리면 최소 기록 없이 이미 있던 묶음이 그대로 남는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 13으로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 13), '0.0.13');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at)
         VALUES ('90000011', '-1', '900001', 'ignored', '가짜 게시물', NULL, 0, 1000, 6000)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map(({ status, processedAt }) => ({ status, processedAt }))).toEqual([{ status: 'ignored', processedAt: 6_000 }]);
    await expect(store.listMinimalRecords()).resolves.toEqual([]);
  });
});

describe('다시 켜기', () => {
  it('카운트다운 중에 앱이 꺼져 준비됨으로 돌린 표시와 시험 묶음 표시를 다시 열어도 그대로 읽는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    await store.saveDetectedBundles(
      [bundle([mention('101')], { status: 'ready', quitDuringCountdown: true }), bundle([mention('102', { postId: '90000012' })], { status: 'generating', trial: true })],
      '102',
    );

    /** 다시 연 저장소. */
    const reopened = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await reopened.listBundles()).map(({ status, quitDuringCountdown, trial }) => ({ status, quitDuringCountdown, trial }))).toEqual([
      { status: 'ready', quitDuringCountdown: true, trial: false },
      { status: 'generating', quitDuringCountdown: false, trial: true },
    ]);
  });

  it('남긴 초안 대기열을 다시 열어도 순서와 자리 그대로 읽고, 다시 남기면 앞서 남긴 것을 바꾼다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    await expect(store.getDraftQueue()).resolves.toEqual([]);

    await store.setDraftQueue([
      { bundleId: 3, priority: 'resume' },
      { bundleId: 1, priority: 'user' },
      { bundleId: 2, priority: 'auto' },
    ]);
    /** 다시 연 저장소. */
    const reopened = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    await expect(reopened.getDraftQueue()).resolves.toEqual([
      { bundleId: 3, priority: 'resume' },
      { bundleId: 1, priority: 'user' },
      { bundleId: 2, priority: 'auto' },
    ]);

    await reopened.setDraftQueue([{ bundleId: 2, priority: 'auto' }]);
    await expect(reopened.getDraftQueue()).resolves.toEqual([{ bundleId: 2, priority: 'auto' }]);
    await reopened.setDraftQueue([]);
    await expect(reopened.getDraftQueue()).resolves.toEqual([]);
  });

  it('묶음을 지우면 묶음·멘션·내 답을 지우고 최소 기록도 남기지 않으며, 지운 글은 state.db와 WAL 어디에도 남지 않는다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const db = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    const store = new SqliteStateStore(db);
    /** 지울 글. 파일에서 찾기 쉽게 길게 둔다. */
    const secret = (label: string) => `${label} ${'q'.repeat(40)}`;
    await store.saveDetectedBundles(
      [
        bundle([mention('101', { text: secret('가짜 시험 원문'), senderName: secret('가짜 시험 송신자') })], {
          status: 'ready',
          trial: true,
          editedText: secret('가짜 시험 편집본'),
          answers: [{ answerId: '950000001', registeredDateTime: '20261020090000', excluded: false }],
        }),
        bundle([mention('102', { postId: '90000012' })], { status: 'ready' }),
      ],
      '102',
    );

    await store.deleteBundles([1]);

    expect((await store.listBundles()).map(({ id }) => id)).toEqual([2]);
    await expect(store.listMinimalRecords()).resolves.toEqual([]);
    await expect(store.hasMentionLocation({ postId: '90000011', remarkId: '-1', replyId: '-1' })).resolves.toBe(false);
    for (const label of ['가짜 시험 원문', '가짜 시험 송신자', '가짜 시험 편집본']) {
      expect(readFileSync(path).includes(Buffer.from(label))).toBe(false);
      expect(readFileSync(`${path}-wal`).includes(Buffer.from(label))).toBe(false);
    }
    db.close();
  });

  it('시험 묶음은 기준점을 옮기지 않고 저장하며, 같은 멘션 위치의 실제 묶음과 함께 둘 수 있고 다시 감지하지 않을 위치로 세지 않는다', async () => {
    const db = openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0');
    const store = new SqliteStateStore(db);
    await store.saveDetectedBundles([bundle([mention('101')], { status: 'ready' })], '101');

    /** 저장한 시험 묶음. 실제 묶음과 같은 멘션 위치다. */
    const trial = await store.addTrialBundle({ ...bundle([mention('101')], { status: 'generating' }), id: null });
    expect(trial).toMatchObject({ id: 2, trial: true, mentions: [expect.objectContaining({ alarmId: '101' })] });
    await store.saveBundle({ ...trial, status: 'ready' });

    expect((await store.listBundles()).map(({ id, trial: isTrial, status, mentions }) => [id, isTrial, status, mentions.length])).toEqual([
      [1, false, 'ready', 1],
      [2, true, 'ready', 1],
    ]);
    await expect(store.getBaselineAlarmId()).resolves.toBe('101');

    // 실제 묶음을 최소 기록으로 옮긴 뒤에도 시험 묶음의 멘션은 다시 감지하지 않을 위치가 아니다.
    await store.deleteBundles([1]);
    await expect(store.hasMentionLocation({ postId: '90000011', remarkId: '-1', replyId: '-1' })).resolves.toBe(false);
    await store.deleteBundles([2]);
    await expect(store.listBundles()).resolves.toEqual([]);
    db.close();
  });

  it('저장하지 않은 묶음이 하나라도 있으면 지우지 못하고 아무것도 바꾸지 않는다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.saveDetectedBundles([bundle([mention('101')], { status: 'ready', trial: true })], '101');

    await expect(store.deleteBundles([1, 9])).rejects.toThrow();

    expect((await store.listBundles()).map(({ id }) => id)).toEqual([1]);
  });

  it('다른 계정으로 처음부터 시작하면 남긴 초안 대기열도 지운다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.setDraftQueue([{ bundleId: 1, priority: 'resume' }]);

    await store.resetForAccount(NEW_ACCOUNT);

    await expect(store.getDraftQueue()).resolves.toEqual([]);
  });

  it('형식 14에서 올리면 이미 있던 묶음은 시험 묶음이 아니고 카운트다운 중 종료 표시도 없으며, 남긴 대기열은 없다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    /** 형식 14로 만든 DB. */
    const old = openStateDatabase(path, STATE_MIGRATIONS.slice(0, 14), '0.0.14');
    old
      .prepare(
        `INSERT INTO mention_bundle (post_id, remark_id, project_id, status, post_title, connect_url, new_mention_count, created_at, processed_at)
         VALUES ('90000011', '-1', '900001', 'posting', '가짜 게시물', NULL, 0, 1000, NULL)`,
      )
      .run();
    old.close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    expect((await store.listBundles()).map(({ status, quitDuringCountdown, trial }) => ({ status, quitDuringCountdown, trial }))).toEqual([
      { status: 'posting', quitDuringCountdown: false, trial: false },
    ]);
    await expect(store.getDraftQueue()).resolves.toEqual([]);
  });
});

describe('앱 내 업데이트', () => {
  it('서명 검증에 실패한 버전을 여럿 남기면 다시 열어도 모두 읽고, 같은 버전은 한 번만 남으며, 뺀 버전은 없다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const first = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    /** 처음 연 저장소. */
    const firstStore = new SqliteStateStore(first);
    await firstStore.addSignatureFailedVersion('0.3.0');
    await firstStore.addSignatureFailedVersion('0.2.0');
    await firstStore.addSignatureFailedVersion('0.2.0');
    first.close();

    /** 다시 연 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));
    await expect(store.getSignatureFailedVersions()).resolves.toEqual(['0.2.0', '0.3.0']);

    await store.removeSignatureFailedVersion('0.2.0');
    await expect(store.getSignatureFailedVersions()).resolves.toEqual(['0.3.0']);
  });

  it('다른 계정으로 처음부터 시작해도 서명 검증에 실패한 버전은 남는다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.addSignatureFailedVersion('0.2.0');

    await store.resetForAccount(NEW_ACCOUNT);

    await expect(store.getSignatureFailedVersions()).resolves.toEqual(['0.2.0']);
  });

  it('형식 16에서 올리면 서명 검증에 실패한 버전이 없다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    openStateDatabase(path, STATE_MIGRATIONS.slice(0, 16), '0.0.16').close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.1.0'));

    await expect(store.getSignatureFailedVersions()).resolves.toEqual([]);
  });

  it('업데이트 시도를 남기면 다시 열어도 읽고, 바꾸면 마지막 것만 남으며, 지우면 없다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    const first = openStateDatabase(path, STATE_MIGRATIONS, '0.1.0');
    /** 처음 연 저장소. */
    const firstStore = new SqliteStateStore(first);
    await expect(firstStore.getUpdateAttempt()).resolves.toBeNull();
    await firstStore.setUpdateAttempt({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: 1_000, rejected: false });
    await firstStore.setUpdateAttempt({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: 1_000, rejected: true });
    first.close();

    /** 다시 연 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.2.0'));
    await expect(store.getUpdateAttempt()).resolves.toEqual({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: 1_000, rejected: true });

    await store.clearUpdateAttempt();
    await expect(store.getUpdateAttempt()).resolves.toBeNull();
  });

  it('다른 계정으로 처음부터 시작해도 업데이트 시도는 남는다', async () => {
    const store = new SqliteStateStore(openStateDatabase(join(dir, 'state.db'), STATE_MIGRATIONS, '0.1.0'));
    await store.setUpdateAttempt({ fromVersion: '0.1.0', toVersion: '0.2.0', attemptedAt: 1_000, rejected: false });

    await store.resetForAccount(NEW_ACCOUNT);

    await expect(store.getUpdateAttempt()).resolves.toMatchObject({ toVersion: '0.2.0' });
  });

  it('형식 17에서 올리면 업데이트 시도가 없다', async () => {
    /** `state.db` 경로. */
    const path = join(dir, 'state.db');
    openStateDatabase(path, STATE_MIGRATIONS.slice(0, 17), '0.1.0').close();

    /** 마지막 형식으로 올린 저장소. */
    const store = new SqliteStateStore(openStateDatabase(path, STATE_MIGRATIONS, '0.2.0'));

    await expect(store.getUpdateAttempt()).resolves.toBeNull();
  });
});
