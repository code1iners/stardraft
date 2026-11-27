import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeSentryServer, sentryOrganizationBody } from '../fakes/fake-sentry-server';
import type { SentryOrganization } from '../ports/sentry-api';
import { HttpSentryApi } from './http-sentry-api';

/** 시험용 토큰. 실제 값이 아니다. */
const TOKEN = 'fake-sentry-token-1';

/** 시험용 조직. */
function organization(index: number, regionUrl = 'https://us.sentry.io'): SentryOrganization {
  return { id: String(index), slug: `org-${index}`, name: `조직 ${index}`, regionUrl };
}

/** 가짜 Sentry 서버에 토큰 하나로 붙인 Sentry 어댑터. */
function connect(server: FakeSentryServer, token = TOKEN, clock = new FakeClock()): HttpSentryApi {
  return new HttpSentryApi({ token, fetch: server.fetch, clock });
}

describe('Sentry 어댑터: 조직 목록', () => {
  it('Bearer 토큰으로 GET https://sentry.io/api/0/organizations/를 부르고 조직별 지역 주소를 돌려준다(캐시·쿠키·리디렉트 없이)', async () => {
    const server = new FakeSentryServer();
    server.addToken(TOKEN, [organization(1), organization(2, 'https://de.sentry.io')]);

    const result = await connect(server).listOrganizations();

    expect(result).toEqual({ ok: true, value: [organization(1), organization(2, 'https://de.sentry.io')] });
    expect(server.requests).toEqual([
      { method: 'GET', url: 'https://sentry.io/api/0/organizations/', token: TOKEN, cache: 'no-store', credentials: 'omit', redirect: 'error' },
    ]);
  });

  it('Link 헤더에 다음 쪽이 있다고 하는 동안 커서로 쪽을 끝까지 넘겨 모두 읽는다', async () => {
    const server = new FakeSentryServer();
    server.pageSize = 2;
    server.addToken(TOKEN, [1, 2, 3, 4, 5].map((index) => organization(index)));

    const result = await connect(server).listOrganizations();

    expect(result.ok && result.value.map((item) => item.slug)).toEqual(['org-1', 'org-2', 'org-3', 'org-4', 'org-5']);
    expect(server.requests.map((request) => request.url)).toEqual([
      'https://sentry.io/api/0/organizations/',
      'https://sentry.io/api/0/organizations/?cursor=0%3A2%3A0',
      'https://sentry.io/api/0/organizations/?cursor=0%3A4%3A0',
    ]);
  });

  it('results가 false인 다음 쪽 링크는 따라가지 않는다', async () => {
    const server = new FakeSentryServer();
    server.addToken(TOKEN, [organization(1)]);

    await connect(server).listOrganizations();

    expect(server.requests).toHaveLength(1);
  });

  it('서버가 다음 쪽이 있다고 계속 답해도 쪽 수 상한에서 멈춘다', async () => {
    /** 매번 새 커서의 다음 쪽이 있다고 답하는 서버. 같은 커서가 되풀이되면 따로 멈추므로 커서를 매번 바꾼다. */
    let calls = 0;
    const endless = async (): Promise<Response> => {
      calls += 1;
      return new Response(JSON.stringify([sentryOrganizationBody(organization(calls))]), {
        status: 200,
        headers: { link: `<https://sentry.io/api/0/organizations/?&cursor=0:${calls}:0>; rel="next"; results="true"; cursor="0:${calls}:0"` },
      });
    };

    const result = await new HttpSentryApi({ token: TOKEN, fetch: endless, clock: new FakeClock() }).listOrganizations();

    expect(result.ok).toBe(true);
    expect(calls).toBe(50);
  });

  it.each([
    [401, { kind: 'unauthorized' }],
    [403, { kind: 'forbidden' }],
    [429, { kind: 'rate-limited' }],
    [500, { kind: 'http', status: 500 }],
  ])('%i 응답은 실패 이유로 바꾼다', async (status, failure) => {
    const server = new FakeSentryServer();
    server.replyNext({ status, body: { detail: 'x' } });

    expect(await connect(server).listOrganizations()).toEqual({ ok: false, failure });
  });

  it('401·403 응답의 본문이 JSON이 아니어도(Sentry 앞단의 HTML) 응답 코드로 판정한다', async () => {
    const html = async (): Promise<Response> => new Response('<html>blocked</html>', { status: 403, headers: { 'content-type': 'text/html' } });

    const result = await new HttpSentryApi({ token: TOKEN, fetch: html, clock: new FakeClock() }).listOrganizations();

    expect(result).toEqual({ ok: false, failure: { kind: 'forbidden' } });
  });

  it('모르는 토큰은 401로 실패한다', async () => {
    const server = new FakeSentryServer();

    expect(await connect(server, 'unknown').listOrganizations()).toEqual({ ok: false, failure: { kind: 'unauthorized' } });
  });

  it('응답 없이 연결이 끊기면 network 실패다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ network: 'error' });

    expect(await connect(server).listOrganizations()).toEqual({ ok: false, failure: { kind: 'network' } });
  });

  it('응답이 제한 시간 안에 오지 않으면 요청을 끊고 network 실패로 본다', async () => {
    const server = new FakeSentryServer();
    const clock = new FakeClock();
    server.replyNext({ network: 'hang' });

    const pending = connect(server, TOKEN, clock).listOrganizations();
    clock.advance(20_000);

    expect(await pending).toEqual({ ok: false, failure: { kind: 'network' } });
  });

  it('조직 배열이 아니거나 항목의 모양이 맞지 않으면 unexpected-response다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 200, body: { organizations: [] } }, { status: 200, body: [{ slug: 'a' }] });

    expect(await connect(server).listOrganizations()).toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
    expect(await connect(server).listOrganizations()).toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
  });

  it('토큰을 보낼 곳이 되는 지역 주소가 sentry.io의 https 주소가 아니면 받아들이지 않는다', async () => {
    for (const regionUrl of ['http://us.sentry.io', 'https://evil.example.com', 'https://sentry.io.evil.test', 'https://user:pw@us.sentry.io']) {
      const server = new FakeSentryServer();
      server.addToken(TOKEN, [organization(1, regionUrl)]);

      expect(await connect(server).listOrganizations()).toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
    }
  });

  it('헤더에 실을 수 없는 토큰은 요청을 보내지 않고 거부된 것으로 본다', async () => {
    const server = new FakeSentryServer();

    expect(await connect(server, 'bad token\n').listOrganizations()).toEqual({ ok: false, failure: { kind: 'unauthorized' } });
    expect(server.requests).toEqual([]);
  });
});

describe('Sentry 어댑터: 프로젝트 목록과 오류 이슈 확인', () => {
  /** 시험용 조직의 프로젝트. */
  const PROJECTS = [
    { id: '11', slug: 'web', name: '웹', environments: ['production', 'development'] },
    { id: '12', slug: 'batch', name: '배치', environments: [] },
  ];

  it('조직의 지역 주소로 프로젝트 목록을 부르고 환경 목록까지 읽는다', async () => {
    const server = new FakeSentryServer();
    server.addToken(TOKEN, [organization(1, 'https://de.sentry.io')]);
    server.addProjects(TOKEN, 'org-1', PROJECTS);

    const result = await connect(server).listProjects(organization(1, 'https://de.sentry.io'));

    expect(result).toEqual({ ok: true, value: PROJECTS });
    expect(server.requests.map((request) => request.url)).toEqual(['https://de.sentry.io/api/0/organizations/org-1/projects/?per_page=100']);
    expect(server.requests[0]).toMatchObject({ token: TOKEN, cache: 'no-store', credentials: 'omit', redirect: 'error' });
  });

  it('프로젝트의 환경 이름은 문자열만 받고 겹침은 한 번만 둔다. 환경이 없으면 빈 목록이다', async () => {
    const server = new FakeSentryServer();
    server.addToken(TOKEN, [organization(1)]);
    server.replyNext({ status: 200, body: [{ id: 7, slug: 'x', name: '', environments: ['a', 'a', '', 3] }, { id: '8', slug: 'y' }] });

    const result = await connect(server).listProjects(organization(1));

    expect(result).toEqual({
      ok: true,
      value: [
        { id: '7', slug: 'x', name: 'x', environments: ['a'] },
        { id: '8', slug: 'y', name: 'y', environments: [] },
      ],
    });
  });

  it('모양이 다른 응답은 알 수 없는 응답으로 본다', async () => {
    const server = new FakeSentryServer();
    server.addToken(TOKEN, [organization(1)]);

    server.replyNext({ status: 200, body: { detail: 'x' } });
    expect(await connect(server).listProjects(organization(1))).toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
    server.replyNext({ status: 200, body: [{ slug: 'no-id' }] });
    expect(await connect(server).listProjects(organization(1))).toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
  });

  it('토큰을 실을 곳이므로 sentry.io 계열이 아닌 지역 주소로는 부르지 않는다', async () => {
    const server = new FakeSentryServer();
    server.addToken(TOKEN, [organization(1)]);

    const result = await connect(server).listProjects(organization(1, 'https://evil.example.com'));

    expect(result).toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
    expect(await connect(server).probeErrorIssues(organization(1, 'http://sentry.io'), '11')).toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
    expect(server.requests).toEqual([]);
  });

  it('프로젝트 목록도 Link 헤더의 다음 쪽을 끝까지 넘긴다', async () => {
    const server = new FakeSentryServer();
    server.addToken(TOKEN, [organization(1)]);
    /** 첫 쪽과 둘째 쪽. */
    const link = (next: boolean) => `<https://us.sentry.io/x>; rel="next"; results="${next}"; cursor="0:100:0"`;
    server.replyNext(
      { status: 200, body: [PROJECTS[0]], headers: { link: link(true) } },
      { status: 200, body: [PROJECTS[1]], headers: { link: link(false) } },
    );

    const result = await connect(server).listProjects(organization(1));

    expect(result.ok && result.value.map((project) => project.id)).toEqual(['11', '12']);
    expect(server.requests[1]?.url).toContain('cursor=0%3A100%3A0');
  });

  it('오류 이슈 확인은 환경 없이 프로젝트 하나를 한 건만 부른다', async () => {
    const server = new FakeSentryServer();
    server.addToken(TOKEN, [organization(1)]);

    const result = await connect(server).probeErrorIssues(organization(1), '11');

    expect(result).toEqual({ ok: true, value: undefined });
    expect(server.requests.map((request) => request.url)).toEqual(['https://us.sentry.io/api/0/organizations/org-1/issues/?project=11&limit=1']);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not-found'],
    [429, 'rate-limited'],
  ])('오류 이슈 확인이 %i이면 %s로 구분한다', async (status, kind) => {
    const server = new FakeSentryServer();
    server.addToken(TOKEN, [organization(1)]);
    server.replyNext({ status });

    expect(await connect(server).probeErrorIssues(organization(1), '11')).toEqual({ ok: false, failure: { kind } });
  });
});

describe('Sentry 어댑터: 감지 조회', () => {
  /** 시험용 프로젝트 필터. */
  const FILTER = { projectId: '11', environment: 'production', levels: ['fatal', 'error'] } as const;
  /** 2026-11-26T00:00:00Z. */
  const T0 = Date.UTC(2026, 10, 26);

  /** 목록 응답 한 항목. 실제 응답처럼 `count`는 문자열이다. */
  function issueBody(id: string, firstSeen: string): Record<string, unknown> {
    return {
      id,
      shortId: `WEB-${id}`,
      title: `TypeError: 시험 오류 ${id}`,
      culprit: 'app/pages/checkout',
      level: 'error',
      status: 'unresolved',
      substatus: 'new',
      firstSeen,
      lastSeen: '2026-11-26T01:00:00Z',
      count: '12',
      userCount: 3,
      permalink: `https://org-1.sentry.io/issues/${id}/`,
      platform: 'javascript',
      project: { id: '11', slug: 'web', name: '웹' },
    };
  }

  it('신규 조회는 지역 주소로 미해결·처음 보인 시각·레벨을 검색 쿼리로, 프로젝트·환경을 파라미터로 걸고 처음 보인 순으로 부른다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 200, body: [issueBody('101', '2026-11-26T00:30:00.123456Z')] });

    const result = await connect(server).listNewErrorIssues(organization(1, 'https://de.sentry.io'), FILTER, T0);

    expect(server.requests.map((request) => request.url)).toEqual([
      'https://de.sentry.io/api/0/organizations/org-1/issues/?project=11&environment=production&query=is%3Aunresolved%20firstSeen%3A%3E2026-11-26T00%3A00%3A00.000Z%20level%3A%5Bfatal%2Cerror%5D&sort=new&limit=100',
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: '101',
          shortId: 'WEB-101',
          title: 'TypeError: 시험 오류 101',
          culprit: 'app/pages/checkout',
          level: 'error',
          firstSeen: Date.parse('2026-11-26T00:30:00.123Z'),
          lastSeen: Date.parse('2026-11-26T01:00:00Z'),
          count: 12,
          userCount: 3,
          permalink: 'https://org-1.sentry.io/issues/101/',
          platform: 'javascript',
        },
      ],
    });
  });

  it('레벨이 하나면 목록 문법 없이 걸고, 환경 필터가 없으면 환경 파라미터를 보내지 않는다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 200, body: [] });

    await connect(server).listNewErrorIssues(organization(1), { projectId: '11', environment: null, levels: ['error'] }, T0);

    expect(server.requests[0]?.url).toBe(
      'https://us.sentry.io/api/0/organizations/org-1/issues/?project=11&query=is%3Aunresolved%20firstSeen%3A%3E2026-11-26T00%3A00%3A00.000Z%20level%3Aerror&sort=new&limit=100',
    );
  });

  it('재발 조회는 is:regressed와 레벨을 걸고 마지막 발생 순으로 부른다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 200, body: [] });

    expect(await connect(server).listRegressedErrorIssues(organization(1), FILTER)).toEqual({ ok: true, value: [] });
    expect(server.requests[0]?.url).toBe(
      'https://us.sentry.io/api/0/organizations/org-1/issues/?project=11&environment=production&query=is%3Aregressed%20level%3A%5Bfatal%2Cerror%5D&sort=date&limit=100',
    );
  });

  it('오류 이슈 목록도 Link 헤더의 다음 쪽을 끝까지 넘긴다', async () => {
    const server = new FakeSentryServer();
    /** 다음 쪽이 있는지 알리는 Link 헤더. */
    const link = (next: boolean) => `<https://us.sentry.io/x>; rel="next"; results="${next}"; cursor="1764115200000:0:0"`;
    server.replyNext(
      { status: 200, body: [issueBody('1', '2026-11-26T00:01:00Z')], headers: { link: link(true) } },
      { status: 200, body: [issueBody('2', '2026-11-26T00:02:00Z')], headers: { link: link(false) } },
    );

    const result = await connect(server).listRegressedErrorIssues(organization(1), FILTER);

    expect(result.ok && result.value.map((issue) => issue.id)).toEqual(['1', '2']);
    expect(server.requests[1]?.url).toContain('&cursor=1764115200000%3A0%3A0');
  });

  it('처음 보인 시각을 읽을 수 없는 항목이 있으면 알 수 없는 응답이다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 200, body: [{ id: '1', title: 'x' }] });

    expect(await connect(server).listNewErrorIssues(organization(1), FILTER, T0)).toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
  });

  it('조직에 없는 환경 이름이면 Sentry가 404를 주고 not-found로 구분한다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 404, body: { detail: 'The requested resource does not exist' } });

    expect(await connect(server).listNewErrorIssues(organization(1), FILTER, T0)).toEqual({ ok: false, failure: { kind: 'not-found' } });
  });

  it('429는 X-Sentry-Rate-Limit-Reset(UTC epoch 초)을 한도 초기화 시각(밀리초)으로 읽는다. 헤더가 없으면 시각이 없다', async () => {
    const server = new FakeSentryServer();
    server.replyNext(
      { status: 429, body: { detail: 'x' }, headers: { 'x-sentry-rate-limit-reset': '1764115260' } },
      { status: 429, body: { detail: 'x' } },
    );

    expect(await connect(server).listRegressedErrorIssues(organization(1), FILTER)).toEqual({
      ok: false,
      failure: { kind: 'rate-limited', resetAt: 1_764_115_260_000 },
    });
    expect(await connect(server).listRegressedErrorIssues(organization(1), FILTER)).toEqual({ ok: false, failure: { kind: 'rate-limited' } });
  });

  it('재발은 오류 이슈 상세 활동의 가장 최근 set_regression에서 재발을 일으킨 이벤트 ID와 시각을 읽는다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({
      status: 200,
      body: {
        id: '101',
        activity: [
          { id: '9', type: 'set_resolved', dateCreated: '2026-11-26T03:00:00.000000Z', data: {} },
          { id: '8', type: 'set_regression', dateCreated: '2026-11-26T02:00:00.654321Z', data: { version: '', event_id: 'b'.repeat(32) } },
          { id: '7', type: 'set_regression', dateCreated: '2026-11-25T02:00:00Z', data: { version: '', event_id: 'a'.repeat(32) } },
          { id: '1', type: 'first_seen', dateCreated: '2026-11-24T00:00:00Z', data: {} },
        ],
      },
    });

    const result = await connect(server).latestRegression(organization(1), '101');

    expect(server.requests[0]?.url).toBe('https://us.sentry.io/api/0/organizations/org-1/issues/101/');
    expect(result).toEqual({ ok: true, value: { eventId: 'b'.repeat(32), at: Date.parse('2026-11-26T02:00:00.654Z') } });
  });

  it('재발 활동이 없거나 이벤트 ID가 없으면 재발 없음(null)이다', async () => {
    const server = new FakeSentryServer();
    server.replyNext(
      { status: 200, body: { id: '101', activity: [{ id: '1', type: 'first_seen', dateCreated: '2026-11-24T00:00:00Z', data: {} }] } },
      { status: 200, body: { id: '101', activity: [{ id: '2', type: 'set_regression', dateCreated: '2026-11-24T00:00:00Z', data: { version: '' } }] } },
    );

    expect(await connect(server).latestRegression(organization(1), '101')).toEqual({ ok: true, value: null });
    expect(await connect(server).latestRegression(organization(1), '101')).toEqual({ ok: true, value: null });
  });

  it('오류 이슈 상세가 404(삭제됨)이면 not-found다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 404, body: { detail: 'x' } });

    expect(await connect(server).latestRegression(organization(1), '101')).toEqual({ ok: false, failure: { kind: 'not-found' } });
  });
});

describe('Sentry 어댑터: 진단 시작 때의 조회', () => {
  it('시작 직전 확인은 오류 이슈 상세를 리디렉트를 따라가지 않고 불러 상태와 최초·최근 release를 읽는다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 200, body: { id: '101', status: 'unresolved', firstRelease: { version: 'web@1.0.0' }, lastRelease: { version: 'web@1.2.0' } } });

    const result = await connect(server).errorIssueState(organization(1), '101');

    expect(server.requests[0]).toMatchObject({ url: 'https://us.sentry.io/api/0/organizations/org-1/issues/101/?collapse=stats,tags', redirect: 'manual' });
    expect(result).toEqual({ ok: true, value: { status: 'unresolved', firstRelease: 'web@1.0.0', lastRelease: 'web@1.2.0' } });
  });

  it.each([
    ['resolved', 'resolved'],
    ['ignored', 'ignored'],
    ['pending_deletion', 'deleted'],
    ['deletion_in_progress', 'deleted'],
    ['pending_merge', 'merged'],
    ['reprocessing', 'unresolved'],
  ])('오류 이슈 상세의 status %s는 %s로 읽는다', async (status, expected) => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 200, body: { id: '101', status, firstRelease: null, lastRelease: null } });

    expect(await connect(server).errorIssueState(organization(1), '101')).toEqual({ ok: true, value: { status: expected, firstRelease: null, lastRelease: null } });
  });

  it('다른 오류 이슈로 병합되어 리디렉트되면 병합됨이고, 404면 not-found다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 302, headers: { location: 'https://us.sentry.io/api/0/organizations/org-1/issues/202/' } }, { status: 404, body: { detail: 'x' } });

    expect(await connect(server).errorIssueState(organization(1), '101')).toEqual({ ok: true, value: { status: 'merged', firstRelease: null, lastRelease: null } });
    expect(await connect(server).errorIssueState(organization(1), '101')).toEqual({ ok: false, failure: { kind: 'not-found' } });
  });

  it('최신 이벤트에서 스택트레이스·breadcrumbs·요청·사용자·컨텍스트·release·태그·플랫폼을 읽고, 요청 주소의 쿼리와 사용자 이메일은 버린다', async () => {
    const server = new FakeSentryServer();
    server.replyNext({
      status: 200,
      body: {
        id: 'abc',
        eventID: 'e'.repeat(32),
        platform: 'javascript',
        release: { version: 'web@1.2.0' },
        tags: [
          { key: 'environment', value: 'production' },
          { key: 'level', value: 'error' },
        ],
        user: { id: 7, email: 'someone@fake.test', ip_address: '10.0.0.1' },
        contexts: { browser: { name: 'Chrome', version: '120.0' }, empty: {} },
        errors: [{ type: 'js_no_source', data: {} }],
        entries: [
          {
            type: 'exception',
            data: {
              values: [
                {
                  type: 'TypeError',
                  value: "Cannot read properties of undefined (reading 'id')",
                  module: null,
                  stacktrace: {
                    frames: [
                      { filename: 'node_modules/lib.js', function: 'call', lineNo: 10, colNo: 1, inApp: false, context: [] },
                      { filename: './src/order.ts', function: 'firstOrder', lineNo: 42, colNo: 7, inApp: true, context: [[42, '  return orders[0].id;']] },
                    ],
                  },
                  rawStacktrace: { frames: [] },
                },
              ],
            },
          },
          { type: 'breadcrumbs', data: { values: [{ timestamp: '2026-11-26T11:59:00Z', category: 'fetch', level: 'info', message: 'GET /orders' }] } },
          { type: 'request', data: { method: 'GET', url: 'https://app.fake.test/orders?token=fake-secret#top', headers: [['Cookie', 'x']] } },
        ],
      },
    });

    const result = await connect(server).latestEvent(organization(1), '101');

    expect(server.requests[0]?.url).toBe('https://us.sentry.io/api/0/organizations/org-1/issues/101/events/latest/');
    expect(result).toEqual({
      ok: true,
      value: {
        eventId: 'e'.repeat(32),
        platform: 'javascript',
        release: 'web@1.2.0',
        message: null,
        tags: [
          { key: 'environment', value: 'production' },
          { key: 'level', value: 'error' },
        ],
        exceptions: [
          {
            type: 'TypeError',
            value: "Cannot read properties of undefined (reading 'id')",
            module: null,
            frames: [
              { filename: 'node_modules/lib.js', function: 'call', lineNo: 10, colNo: 1, inApp: false, context: [] },
              { filename: './src/order.ts', function: 'firstOrder', lineNo: 42, colNo: 7, inApp: true, context: [[42, '  return orders[0].id;']] },
            ],
            hasRawStacktrace: true,
          },
        ],
        breadcrumbs: [{ timestamp: '2026-11-26T11:59:00Z', category: 'fetch', level: 'info', message: 'GET /orders' }],
        request: { method: 'GET', url: 'https://app.fake.test/orders' },
        user: { id: '7', username: null },
        contexts: [{ name: 'browser', summary: 'Chrome 120.0' }],
        processingErrors: ['js_no_source'],
      },
    });
  });

  it('최신 이벤트를 받지 못하면 실패 이유를 그대로 돌려준다(429는 한도 초기화 시각과 함께)', async () => {
    const server = new FakeSentryServer();
    server.replyNext({ status: 429, headers: { 'x-sentry-rate-limit-reset': '1800000000' } }, { network: 'error' });

    expect(await connect(server).latestEvent(organization(1), '101')).toEqual({ ok: false, failure: { kind: 'rate-limited', resetAt: 1_800_000_000_000 } });
    expect(await connect(server).latestEvent(organization(1), '101')).toEqual({ ok: false, failure: { kind: 'network' } });
  });
});
