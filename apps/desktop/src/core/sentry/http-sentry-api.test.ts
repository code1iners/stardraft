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
