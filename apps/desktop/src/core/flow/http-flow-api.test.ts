import { describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { FakeFlowServer, flowEnvelope } from '../fakes/fake-flow-server';
import { HttpFlowApi } from './http-flow-api';

/** 가짜 Flow 서버에 키 하나로 붙인 Flow 어댑터. */
function connect(server: FakeFlowServer, apiKey = 'fake-key-1', clock = new FakeClock()): HttpFlowApi {
  return new HttpFlowApi({ apiKey, fetch: server.fetch, clock });
}

describe('Flow 어댑터: 키 소유자의 구성원 정보 조회', () => {
  it('x-flow-api-key 헤더로 GET https://api.flow.team/user/employees/me를 부르고 이름·소속·이메일을 돌려준다(캐시·쿠키·리디렉트 없이)', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope({
        userId: 'me@example.test',
        fullname: '테스트 사용자',
        divisionName: '테스트 팀',
        email: 'me@example.test',
      }),
    });

    const result = await connect(server).getMe();

    expect(result).toEqual({
      ok: true,
      value: { userId: 'me@example.test', name: '테스트 사용자', division: '테스트 팀', email: 'me@example.test' },
    });
    expect(server.requests).toEqual([
      {
        method: 'GET',
        url: 'https://api.flow.team/user/employees/me',
        apiKey: 'fake-key-1',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      },
    ]);
  });

  it('구성원 정보가 data 바로 아래 객체에 들어 있어도 읽는다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope({
        employee: { userId: 'me@example.test', fullname: '테스트 사용자', divisionName: '테스트 팀', email: 'me@example.test' },
      }),
    });

    await expect(connect(server).getMe()).resolves.toEqual({
      ok: true,
      value: { userId: 'me@example.test', name: '테스트 사용자', division: '테스트 팀', email: 'me@example.test' },
    });
  });

  it('이름이나 이메일이 비어 있으면 사용자 ID로 대신하고, 소속은 빈 채로 둔다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 200, body: flowEnvelope({ userId: 'me@example.test', fullname: '', email: null }) });

    await expect(connect(server).getMe()).resolves.toEqual({
      ok: true,
      value: { userId: 'me@example.test', name: 'me@example.test', division: '', email: 'me@example.test' },
    });
  });

  it('401이면 키가 거부됐다고 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 401, body: { response: { success: false, code: 401, message: 'error' } } });

    await expect(connect(server).getMe()).resolves.toEqual({ ok: false, failure: { kind: 'unauthorized' } });
  });

  it('429면 한도에 걸렸다고 돌려주고, Retry-After의 초나 날짜를 기다릴 시간(밀리초)으로 바꾼다', async () => {
    const server = new FakeFlowServer();
    /** 2026-10-20 09:00:00 UTC. */
    const clock = new FakeClock(Date.UTC(2026, 9, 20, 9, 0, 0));
    server.replyNext(
      { status: 429, headers: { 'retry-after': '3' } },
      { status: 429, headers: { 'retry-after': 'Tue, 20 Oct 2026 09:00:45 GMT' } },
      { status: 429 },
    );
    /** 같은 키로 붙인 어댑터. */
    const flow = connect(server, 'fake-key-1', clock);

    await expect(flow.getMe()).resolves.toEqual({ ok: false, failure: { kind: 'rate-limited', retryAfterMs: 3_000 } });
    await expect(flow.getMe()).resolves.toEqual({ ok: false, failure: { kind: 'rate-limited', retryAfterMs: 45_000 } });
    await expect(flow.getMe()).resolves.toEqual({ ok: false, failure: { kind: 'rate-limited', retryAfterMs: null } });
  });

  it('연결이 끊겨 응답을 받지 못하면 연결 실패로 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ network: 'error' });

    await expect(connect(server).getMe()).resolves.toEqual({ ok: false, failure: { kind: 'network' } });
  });

  it('제한 시간(20초) 안에 응답이 오지 않으면 요청을 끊고 연결 실패로 돌려준다', async () => {
    const server = new FakeFlowServer();
    const clock = new FakeClock();
    server.replyNext({ network: 'hang' });
    /** 아직 끝나지 않은 요청. */
    const pending = connect(server, 'fake-key-1', clock).getMe();

    clock.advance(20_000);

    await expect(pending).resolves.toEqual({ ok: false, failure: { kind: 'network' } });
  });

  it('그 밖의 응답 코드는 코드를 담아 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 503 });

    await expect(connect(server).getMe()).resolves.toEqual({ ok: false, failure: { kind: 'http', status: 503 } });
  });

  it('성공 응답이라도 JSON이 아니거나 봉투나 사용자 ID가 없으면 응답 모양이 다르다고 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext(
      { status: 200, body: undefined },
      { status: 200, body: { userId: 'me@example.test' } },
      { status: 200, body: flowEnvelope({ fullname: '테스트 사용자' }) },
      { status: 200, body: flowEnvelope({ userId: '   ' }) },
    );
    /** 같은 키로 붙인 어댑터. */
    const flow = connect(server);

    for (let call = 0; call < 4; call += 1) {
      await expect(flow.getMe()).resolves.toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
    }
  });

  it('헤더에 실을 수 없는 글자(공백, 줄바꿈, 한글)가 든 키는 보내지 않고 키가 거부됐다고 돌려준다', async () => {
    const server = new FakeFlowServer();

    for (const apiKey of ['fake key', 'fake-key\n', '가짜키', '']) {
      await expect(connect(server, apiKey).getMe()).resolves.toEqual({ ok: false, failure: { kind: 'unauthorized' } });
    }
    expect(server.requests).toEqual([]);
  });
});
