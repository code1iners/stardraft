import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeSentryServer } from '../fakes/fake-sentry-server';
import { MemorySentryTokenStore } from '../fakes/memory-sentry-token-store';
import { MemorySettingsStore } from '../fakes/memory-settings-store';
import { RecordingNotifier } from '../fakes/recording-notifier';
import { createLogger, type LogSink } from '../logging/logger';
import type { SentryOrganization } from '../ports/sentry-api';
import { GlobalProblems } from '../problems/global-problems';
import { HttpSentryApi } from './http-sentry-api';
import { SentryConnection } from './sentry-connection';

/** 시험용 토큰. 실제 값이 아니다. */
const TOKEN = 'fake-sentry-token-1';
/** 시험용 조직 둘. */
const ORGS: SentryOrganization[] = [
  { id: '1', slug: 'org-a', name: '조직 A', regionUrl: 'https://us.sentry.io' },
  { id: '2', slug: 'org-b', name: '조직 B', regionUrl: 'https://de.sentry.io' },
];

/** 가짜 Sentry 서버, 메모리 저장소, 전역 문제로 Sentry 연결을 만든다. */
function setup() {
  const clock = new FakeClock(Date.UTC(2026, 10, 26, 9, 0, 0));
  const server = new FakeSentryServer();
  server.addToken(TOKEN, ORGS);
  const tokenStore = new MemorySentryTokenStore();
  const settingsStore = new MemorySettingsStore();
  const notifier = new RecordingNotifier();
  /** 로그에 남은 줄. 토큰이 새는지 본다. */
  const logged: string[] = [];
  const sink: LogSink = { write: (line) => logged.push(line) };
  const logger = createLogger([sink], clock);
  const problems = new GlobalProblems({
    notifier,
    clock,
    logger,
    notificationFor: (problem) => ({ title: problem.cause, body: problem.reason }),
  });
  /** 어댑터가 쓰는 fetch. 테스트가 응답 시점을 늦추려고 바꿔 끼운다. */
  const network = { fetch: server.fetch };
  const connection = new SentryConnection({
    connectSentry: (token) => new HttpSentryApi({ token, fetch: (url, init) => network.fetch(url, init), clock }),
    tokenStore,
    settingsStore,
    logger,
    problems,
  });
  return { connection, server, network, tokenStore, settingsStore, problems, notifier, logged };
}

describe('Sentry 연결: 토큰 확인', () => {
  it('조직 목록이 보이면 토큰을 저장하고 조직 이름과 지역 주소를 설정에 남긴다', async () => {
    const { connection, tokenStore, settingsStore } = setup();

    const outcome = await connection.checkToken(`  ${TOKEN}\n`);

    expect(outcome).toEqual({ kind: 'connected' });
    expect(tokenStore.token).toBe(TOKEN);
    expect(connection.token()).toBe(TOKEN);
    expect(connection.state()).toEqual({ connected: true, organizations: ORGS, tokenCheck: { status: 'idle' }, problem: null });
    expect((await settingsStore.load()).sentryOrganizations).toEqual(ORGS);
  });

  it('다른 설정은 그대로 두고 조직만 바꾼다', async () => {
    const { connection, settingsStore } = setup();
    await settingsStore.save({ ...(await settingsStore.load()), extraInstructions: '지침', repoMappings: { 'id-1': ['/repo'] } });

    await connection.checkToken(TOKEN);

    expect(await settingsStore.load()).toMatchObject({ extraInstructions: '지침', repoMappings: { 'id-1': ['/repo'] } });
  });

  it('401이면 거부로 실패하고 토큰과 조직을 저장하지 않는다', async () => {
    const { connection, tokenStore, settingsStore } = setup();

    const outcome = await connection.checkToken('unknown-token');

    expect(outcome).toEqual({ kind: 'failed', reason: 'unauthorized' });
    expect(tokenStore.token).toBeNull();
    expect((await settingsStore.load()).sentryOrganizations).toEqual([]);
    expect(connection.state()).toMatchObject({ connected: false, tokenCheck: { status: 'idle' } });
  });

  it('403이면 빠진 scope 때문에 실패한다', async () => {
    const { connection, server, tokenStore } = setup();
    server.replyNext({ status: 403, body: { detail: 'You do not have permission' }, headers: { 'www-authenticate': 'Bearer error="insufficient_scope"' } });

    expect(await connection.checkToken(TOKEN)).toEqual({ kind: 'failed', reason: 'scope-missing' });
    expect(tokenStore.token).toBeNull();
  });

  it('응답이 없으면 네트워크 실패이고 옛 연결은 그대로다', async () => {
    const { connection, server, tokenStore } = setup();
    await connection.checkToken(TOKEN);
    server.addToken('other-token', [ORGS[0]!]);
    server.replyNext({ network: 'error' });

    expect(await connection.checkToken('other-token')).toEqual({ kind: 'failed', reason: 'network' });

    expect(tokenStore.token).toBe(TOKEN);
    expect(connection.token()).toBe(TOKEN);
    expect(connection.state().organizations).toEqual(ORGS);
  });

  it('429와 그 밖의 응답 코드를 구분해 실패로 돌려준다', async () => {
    const { connection, server } = setup();
    server.replyNext({ status: 429 }, { status: 500 }, { status: 200, body: { not: 'a list' } });

    expect(await connection.checkToken(TOKEN)).toEqual({ kind: 'failed', reason: 'rate-limited' });
    expect(await connection.checkToken(TOKEN)).toEqual({ kind: 'failed', reason: 'unexpected' });
    expect(await connection.checkToken(TOKEN)).toEqual({ kind: 'failed', reason: 'unexpected' });
  });

  it('조직이 하나도 보이지 않으면 연결하지 않는다', async () => {
    const { connection, server, tokenStore } = setup();
    server.addToken('empty-token', []);

    expect(await connection.checkToken('empty-token')).toEqual({ kind: 'failed', reason: 'no-organizations' });
    expect(tokenStore.token).toBeNull();
  });

  it('토큰을 저장하지 못하면 save-failed이고 옛 연결을 그대로 둔다', async () => {
    const { connection, tokenStore } = setup();
    await connection.checkToken(TOKEN);
    tokenStore.failWrite = true;

    expect(await connection.checkToken(TOKEN)).toEqual({ kind: 'failed', reason: 'save-failed' });
    expect(tokenStore.token).toBe(TOKEN);
    expect(connection.state().connected).toBe(true);
  });

  it('조직을 저장하지 못하면 새 토큰을 옛 토큰으로 되돌린다', async () => {
    const { connection, tokenStore, settingsStore, server } = setup();
    await connection.checkToken(TOKEN);
    server.addToken('next-token', [ORGS[0]!]);
    settingsStore.save = async () => {
      throw new Error('디스크가 가득 찼습니다.');
    };

    expect(await connection.checkToken('next-token')).toEqual({ kind: 'failed', reason: 'save-failed' });

    expect(tokenStore.token).toBe(TOKEN);
    expect(connection.token()).toBe(TOKEN);
  });

  it('새 확인이 앞 확인을 대신한다: 앞 확인의 늦은 결과는 버린다', async () => {
    const { connection, server, network } = setup();
    server.addToken('late-token', [ORGS[1]!]);
    const gate = Promise.withResolvers<void>();
    const slowFetch = server.fetch;
    let first = true;
    network.fetch = async (url, init) => {
      if (first) {
        first = false;
        await gate.promise;
      }
      return slowFetch(url, init);
    };

    const early = connection.checkToken('late-token');
    const later = connection.checkToken(TOKEN);
    gate.resolve();

    expect(await later).toEqual({ kind: 'connected' });
    expect(await early).toEqual({ kind: 'cancelled' });
    expect(connection.token()).toBe(TOKEN);
  });

  it('확인하는 동안 진행 상태가 checking이고, 취소하면 아무것도 바꾸지 않는다', async () => {
    const { connection, server, network, tokenStore } = setup();
    const gate = Promise.withResolvers<void>();
    const original = server.fetch;
    network.fetch = async (url, init) => {
      await gate.promise;
      return original(url, init);
    };
    const states: string[] = [];
    connection.onChange((state) => states.push(state.tokenCheck.status));

    const pending = connection.checkToken(TOKEN);
    expect(connection.state().tokenCheck).toEqual({ status: 'checking' });
    connection.cancelTokenCheck();
    gate.resolve();

    expect(await pending).toEqual({ kind: 'cancelled' });
    expect(states).toEqual(['checking', 'idle']);
    expect(tokenStore.token).toBeNull();
  });

  it('토큰 값이 로그에 남지 않는다', async () => {
    const { connection, server, logged } = setup();
    await connection.checkToken(TOKEN);
    server.replyNext({ status: 403 });
    await connection.checkToken(TOKEN);
    connection.reportApiFailure(TOKEN, { kind: 'unauthorized' });

    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toContain(TOKEN);
  });
});

describe('Sentry 연결: 토큰 문제는 Sentry만 멈춘다', () => {
  it('지금 토큰이 401로 거부되면 거부 이유로, 403이면 scope 부족 이유로 전역 문제를 올리고 알림을 한 번 띄운다', async () => {
    const { connection, problems, notifier } = setup();
    await connection.checkToken(TOKEN);

    connection.reportApiFailure(TOKEN, { kind: 'unauthorized' });
    expect(problems.current()?.problem).toEqual({ cause: 'sentry-token', reason: 'rejected' });
    connection.reportApiFailure(TOKEN, { kind: 'forbidden' });

    expect(problems.current()?.problem).toEqual({ cause: 'sentry-token', reason: 'scope-missing' });
    expect(connection.state().problem).toBe('scope-missing');
    expect(notifier.sent).toHaveLength(1);
  });

  it('Flow 키 문제와 서로 독립이다: Sentry 문제가 있어도 Flow 키 문제를 따로 올리고 내릴 수 있다', async () => {
    const { connection, problems } = setup();
    await connection.checkToken(TOKEN);
    connection.reportApiFailure(TOKEN, { kind: 'unauthorized' });

    problems.raise({ cause: 'flow-key', reason: 'rejected' });
    // 맨 앞에는 Flow 키 문제가 보이지만 Sentry 연결은 자기 문제를 따로 안다.
    expect(problems.current()?.problem.cause).toBe('flow-key');
    expect(connection.state().problem).toBe('rejected');
    problems.resolve('flow-key');

    expect(problems.has('sentry-token')).toBe(true);
    expect(problems.has('flow-key')).toBe(false);
  });

  it('토큰을 바꾸기 전에 보낸 요청의 늦은 거절과, 토큰 문제가 아닌 실패는 문제로 올리지 않는다', async () => {
    const { connection, server, problems } = setup();
    server.addToken('new-token', [ORGS[0]!]);
    await connection.checkToken(TOKEN);
    await connection.checkToken('new-token');

    connection.reportApiFailure(TOKEN, { kind: 'unauthorized' });
    connection.reportApiFailure('new-token', { kind: 'network' });
    connection.reportApiFailure('new-token', { kind: 'rate-limited' });
    connection.reportApiFailure('new-token', { kind: 'http', status: 500 });

    expect(problems.has('sentry-token')).toBe(false);
  });

  it('새 토큰이 확인되면 전역 문제가 해제된다', async () => {
    const { connection, server, problems } = setup();
    await connection.checkToken(TOKEN);
    connection.reportApiFailure(TOKEN, { kind: 'unauthorized' });
    server.addToken('new-token', ORGS);

    await connection.checkToken('new-token');

    expect(problems.has('sentry-token')).toBe(false);
    expect(connection.state().problem).toBeNull();
  });

  it('확인에 실패한 토큰은 전역 문제를 풀지 않는다', async () => {
    const { connection, problems } = setup();
    await connection.checkToken(TOKEN);
    connection.reportApiFailure(TOKEN, { kind: 'unauthorized' });

    await connection.checkToken('unknown-token');

    expect(problems.has('sentry-token')).toBe(true);
  });
});

describe('Sentry 연결: 저장된 토큰 읽기', () => {
  it('앱을 다시 켜면 설정의 조직을 읽고 저장된 토큰을 지금 토큰으로 둔다', async () => {
    const first = setup();
    await first.connection.checkToken(TOKEN);
    const second = setup();
    second.tokenStore.token = first.tokenStore.token;
    await second.settingsStore.save(await first.settingsStore.load());

    await second.connection.load();
    await second.connection.checkStoredToken();

    expect(second.connection.state()).toMatchObject({ connected: true, organizations: ORGS });
    expect(second.connection.token()).toBe(TOKEN);
    expect(second.problems.current()).toBeNull();
  });

  it('토큰을 풀 수 없으면 읽기 불가 이유로 전역 문제를 올리고 쓸 토큰이 없다', async () => {
    const { connection, tokenStore, problems } = setup();
    await connection.checkToken(TOKEN);
    tokenStore.unreadable = true;

    await connection.checkStoredToken();

    expect(problems.current()?.problem).toEqual({ cause: 'sentry-token', reason: 'unreadable' });
  });

  it('조직은 설정에 있는데 토큰 파일이 없으면 읽기 불가다', async () => {
    const { connection, settingsStore, problems } = setup();
    await settingsStore.save({ ...(await settingsStore.load()), sentryOrganizations: ORGS });
    await connection.load();

    await connection.checkStoredToken();

    expect(problems.current()?.problem).toEqual({ cause: 'sentry-token', reason: 'unreadable' });
    expect(connection.state().connected).toBe(true);
    expect(connection.token()).toBeNull();
  });

  it('연결한 적이 없으면 토큰이 없어도 문제가 아니다', async () => {
    const { connection, problems } = setup();
    await connection.load();

    await connection.checkStoredToken();

    expect(problems.current()).toBeNull();
    expect(connection.state().connected).toBe(false);
  });

  it('읽기 불가 상태에서 새 토큰이 확인되면 해제된다', async () => {
    const { connection, tokenStore, problems } = setup();
    await connection.checkToken(TOKEN);
    tokenStore.unreadable = true;
    await connection.checkStoredToken();

    await connection.checkToken(TOKEN);

    expect(problems.has('sentry-token')).toBe(false);
    expect(connection.token()).toBe(TOKEN);
  });
});

describe('Sentry 연결: 연결 끊기', () => {
  it('토큰과 조직만 지우고 다른 설정은 그대로 두며 전역 문제도 해제한다', async () => {
    const { connection, tokenStore, settingsStore, problems } = setup();
    await connection.checkToken(TOKEN);
    await settingsStore.save({ ...(await settingsStore.load()), extraInstructions: '지침', repoMappings: { 'id-1': ['/repo'] } });
    connection.reportApiFailure(TOKEN, { kind: 'unauthorized' });

    expect(await connection.disconnect()).toBe(true);

    expect(tokenStore.token).toBeNull();
    expect(connection.token()).toBeNull();
    expect(connection.state()).toEqual({ connected: false, organizations: [], tokenCheck: { status: 'idle' }, problem: null });
    expect(problems.has('sentry-token')).toBe(false);
    expect(await settingsStore.load()).toMatchObject({ sentryOrganizations: [], extraInstructions: '지침', repoMappings: { 'id-1': ['/repo'] } });
  });

  it('끊은 뒤 다시 켜도 토큰이 없는 것이 문제가 아니다', async () => {
    const first = setup();
    await first.connection.checkToken(TOKEN);
    await first.connection.disconnect();

    await first.connection.load();
    await first.connection.checkStoredToken();

    expect(first.problems.current()).toBeNull();
  });

  it('지우지 못하면 연결을 그대로 두고 false를 돌려준다', async () => {
    const { connection, tokenStore } = setup();
    await connection.checkToken(TOKEN);
    tokenStore.delete = async () => {
      throw new Error('지울 수 없습니다.');
    };

    expect(await connection.disconnect()).toBe(false);
    expect(connection.state().connected).toBe(true);
    expect(connection.token()).toBe(TOKEN);
  });
});
