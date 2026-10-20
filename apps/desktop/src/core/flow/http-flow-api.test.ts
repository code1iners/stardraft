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

describe('Flow 어댑터: 참여 Flow 프로젝트 목록 조회', () => {
  it('GET /user/projects/participants를 부르고 projectId·title·projectUrl을 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope({
        projects: [
          { projectId: '101', title: '가짜 프로젝트 A', projectUrl: 'https://flow.example.test/p/101' },
          { projectId: 102, title: ' 가짜 프로젝트 B ', projectUrl: null },
        ],
      }),
    });

    const result = await connect(server).listParticipantProjects();

    expect(result).toEqual({
      ok: true,
      value: [
        { projectId: '101', title: '가짜 프로젝트 A', projectUrl: 'https://flow.example.test/p/101' },
        { projectId: '102', title: '가짜 프로젝트 B', projectUrl: null },
      ],
    });
    expect(server.requests.map(({ method, url, apiKey }) => ({ method, url, apiKey }))).toEqual([
      { method: 'GET', url: 'https://api.flow.team/user/projects/participants', apiKey: 'fake-key-1' },
    ]);
  });

  it('data가 배열 자체여도 읽고, projectId가 없는 항목은 건너뛴다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope([{ projectId: '7', title: '' }, { title: 'ID 없음' }]),
    });

    await expect(connect(server).listParticipantProjects()).resolves.toEqual({
      ok: true,
      value: [{ projectId: '7', title: '', projectUrl: null }],
    });
  });

  it('hasNext가 참이면 lastCursor를 cursor로 넘겨 다음 쪽을 이어 받는다', async () => {
    const server = new FakeFlowServer();
    server.replyNext(
      {
        status: 200,
        body: flowEnvelope({ hasNext: true, lastCursor: 55, projects: [{ projectId: '1', title: '하나', projectUrl: '' }] }),
      },
      { status: 200, body: flowEnvelope({ hasNext: false, lastCursor: 56, projects: [{ projectId: '2', title: '둘' }] }) },
    );

    const result = await connect(server).listParticipantProjects();

    expect(result).toEqual({
      ok: true,
      value: [
        { projectId: '1', title: '하나', projectUrl: null },
        { projectId: '2', title: '둘', projectUrl: null },
      ],
    });
    expect(server.requests.map((request) => request.url)).toEqual([
      'https://api.flow.team/user/projects/participants',
      'https://api.flow.team/user/projects/participants?cursor=55',
    ]);
  });

  it('다음 쪽에서 실패하면 그 실패를 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 200, body: flowEnvelope({ hasNext: true, lastCursor: 1, projects: [] }) }, { status: 401 });

    await expect(connect(server).listParticipantProjects()).resolves.toEqual({ ok: false, failure: { kind: 'unauthorized' } });
  });

  it('관련 없는 빈 배열이 앞에 있어도 projectId가 든 배열을 읽는다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 200, body: flowEnvelope({ tags: [], projects: [{ projectId: '5', title: '다섯' }] }) });

    await expect(connect(server).listParticipantProjects()).resolves.toEqual({
      ok: true,
      value: [{ projectId: '5', title: '다섯', projectUrl: null }],
    });
  });

  it('빈 배열이 여럿이라 어느 것이 목록인지 알 수 없으면 응답 모양이 다르다고 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 200, body: flowEnvelope({ tags: [], projects: [] }) });

    await expect(connect(server).listParticipantProjects()).resolves.toEqual({
      ok: false,
      failure: { kind: 'unexpected-response' },
    });
  });

  it('프로젝트 목록을 찾을 수 없는 응답은 응답 모양이 다르다고 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 200, body: flowEnvelope({ message: '목록 없음' }) });

    await expect(connect(server).listParticipantProjects()).resolves.toEqual({
      ok: false,
      failure: { kind: 'unexpected-response' },
    });
  });

  it('가짜 서버는 키 소유자의 참여 프로젝트로 답한다', async () => {
    const server = new FakeFlowServer();
    server.addAccount('fake-key-1', { userId: 'me@example.test', name: '나', division: '', email: 'me@example.test' });
    server.setProjects('fake-key-1', [{ projectId: '9', title: '가짜', projectUrl: 'https://flow.example.test/p/9' }]);

    await expect(connect(server).listParticipantProjects()).resolves.toEqual({
      ok: true,
      value: [{ projectId: '9', title: '가짜', projectUrl: 'https://flow.example.test/p/9' }],
    });
  });
});
