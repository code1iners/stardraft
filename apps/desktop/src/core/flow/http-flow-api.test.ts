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

describe('Flow 어댑터: 멘션 알림 목록 조회', () => {
  it('readYn 없이 GET /user/alarms?filters=MENTION&size=20을 부르고, 알림의 멘션 위치와 송신자·수신자·시각을 문자열로 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope({
        alarms: {
          hasNext: false,
          lastCursor: '',
          alarms: [
            {
              alarmId: '9000000002',
              alarmType: null,
              mentionYn: 'Y',
              readYn: 'Y',
              projectId: 900001,
              postId: '90000011',
              remarkId: '900000021',
              replyId: '-1',
              receiverId: 'me@example.test',
              registerId: 'sender@example.test',
              registerName: ' 보낸 사람 ',
              registeredDateTime: '20261019093000',
            },
          ],
        },
      }),
    });

    const result = await connect(server).listMentionAlarms(null);

    expect(result).toEqual({
      ok: true,
      value: {
        alarms: [
          {
            alarmId: '9000000002',
            projectId: '900001',
            postId: '90000011',
            remarkId: '900000021',
            replyId: '-1',
            receiverId: 'me@example.test',
            registerId: 'sender@example.test',
            registerName: '보낸 사람',
            registeredDateTime: '20261019093000',
          },
        ],
        nextCursor: null,
      },
    });
    expect(server.requests.map((request) => [request.method, request.url])).toEqual([
      ['GET', 'https://api.flow.team/user/alarms?filters=MENTION&size=20'],
    ]);
  });

  it('cursor를 주면 그 쪽을 받고, hasNext가 참이면 lastCursor를 다음 커서로 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 200, body: flowEnvelope({ alarms: { hasNext: true, lastCursor: 40, alarms: [] } }) });

    const result = await connect(server).listMentionAlarms('20');

    expect(result).toEqual({ ok: true, value: { alarms: [], nextCursor: '40' } });
    expect(server.requests[0]?.url).toBe('https://api.flow.team/user/alarms?filters=MENTION&size=20&cursor=20');
  });

  it('alarmId가 없는 항목은 건너뛰고, 알림 배열을 찾을 수 없는 응답은 응답 모양이 다르다고 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext(
      { status: 200, body: flowEnvelope({ alarms: { hasNext: false, alarms: [{ postId: '1' }, { alarmId: 7 }] } }) },
      { status: 200, body: flowEnvelope({ hasNext: false }) },
    );
    const api = connect(server);

    await expect(api.listMentionAlarms(null)).resolves.toMatchObject({ ok: true, value: { alarms: [{ alarmId: '7' }] } });
    await expect(api.listMentionAlarms(null)).resolves.toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
  });

  it('401이면 키가 거부됐다고 돌려준다', async () => {
    const server = new FakeFlowServer();

    await expect(connect(server).listMentionAlarms(null)).resolves.toEqual({ ok: false, failure: { kind: 'unauthorized' } });
  });
});

/** 게시물 본문 `content`의 JSON 문자열. 실호출에서 본 컴포넌트 모양(`COMPS`·`COMP_TYPE`·`COMP_DETAIL`)을 따른다. */
function postContent(...components: unknown[]): string {
  return JSON.stringify({ COMPS: components });
}

describe('Flow 어댑터: 게시물 조회', () => {
  it('GET /user/posts/{postId}를 부르고, 본문 JSON의 TEXT 컴포넌트에서 CONTENTS와 MENTIONS를 꺼낸다(이미지 등은 건너뜀)', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope({
        projectId: '900001',
        postId: '90000011',
        title: '가짜 제목',
        contentJsonYn: 'Y',
        content: postContent(
          {
            COMP_TYPE: 'TEXT',
            COMP_DETAIL: { CONTENTS: '@[테스트 사용자](me@example.test) 확인 부탁', MENTIONS: ['me@example.test'], HASHTAGS: [] },
          },
          { COMP_TYPE: 'IMAGE', COMP_DETAIL: { FILE_NM: 'fake.png' } },
          { COMP_TYPE: 'TEXT', COMP_DETAIL: { CONTENTS: '둘째 문단' } },
        ),
        outContent: '테스트 사용자 확인 부탁',
      }),
    });

    const result = await connect(server).getPost('90000011');

    expect(result).toEqual({
      ok: true,
      value: {
        postId: '90000011',
        textComponents: [
          { contents: '@[테스트 사용자](me@example.test) 확인 부탁', mentions: ['me@example.test'] },
          { contents: '둘째 문단', mentions: [] },
        ],
      },
    });
    expect(server.requests.map(({ method, url }) => [method, url])).toEqual([['GET', 'https://api.flow.team/user/posts/90000011']]);
  });

  it('본문이 JSON이 아니면(contentJsonYn이 Y가 아님) 본문 전체를 글 조각 하나로 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope({ postId: 5, contentJsonYn: 'N', content: '@[테스트 사용자](me@example.test) 평문 본문' }),
    });

    await expect(connect(server).getPost('5')).resolves.toEqual({
      ok: true,
      value: { postId: '5', textComponents: [{ contents: '@[테스트 사용자](me@example.test) 평문 본문', mentions: [] }] },
    });
  });

  it('본문이 JSON이라면서 읽을 수 없으면 응답 모양이 다르다고 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext(
      { status: 200, body: flowEnvelope({ postId: '5', contentJsonYn: 'Y', content: '{깨진 JSON' }) },
      { status: 200, body: flowEnvelope({ postId: '5', contentJsonYn: 'Y', content: JSON.stringify({ NOT_COMPS: [] }) }) },
    );
    const api = connect(server);

    await expect(api.getPost('5')).resolves.toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
    await expect(api.getPost('5')).resolves.toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
  });

  it('지워졌거나(404) 권한이 없으면(403) 응답 코드를 담아 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 404 }, { status: 403 });
    const api = connect(server);

    await expect(api.getPost('5')).resolves.toEqual({ ok: false, failure: { kind: 'http', status: 404 } });
    await expect(api.getPost('5')).resolves.toEqual({ ok: false, failure: { kind: 'http', status: 403 } });
  });

  it('ID는 경로에 넣을 수 있게 인코딩한다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 404 });

    await connect(server).getPost('a/b');

    expect(server.requests[0]?.url).toBe('https://api.flow.team/user/posts/a%2Fb');
  });
});

describe('Flow 어댑터: 댓글·대댓글 조회', () => {
  it('GET /user/comments/{postId}?replyYn=Y로 댓글과 처음 대댓글을 받고, 대댓글이 더 있는지(replyHasNext)를 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope({
        hasNext: true,
        lastCursor: 6,
        comments: [
          {
            projectId: '900001',
            postId: '90000011',
            commentId: '900000021',
            contents: '@[테스트 사용자](me@example.test) 질문',
            registerId: 'sender@example.test',
            systemCode: '',
            replies: [{ replyId: 9000081, parentCommentId: '900000021', contents: '대댓글' }],
            replyHasNext: true,
          },
          { commentId: 900000022, contents: '시스템 댓글', systemCode: 'A00^^', replies: [], replyHasNext: false },
          { contents: 'ID 없음' },
        ],
      }),
    });

    const result = await connect(server).listComments('90000011', null);

    expect(result).toEqual({
      ok: true,
      value: {
        comments: [
          {
            commentId: '900000021',
            contents: '@[테스트 사용자](me@example.test) 질문',
            replies: [{ replyId: '9000081', contents: '대댓글' }],
            replyHasNext: true,
          },
          { commentId: '900000022', contents: '시스템 댓글', replies: [], replyHasNext: false },
        ],
        nextCursor: '6',
      },
    });
    expect(server.requests.map(({ method, url }) => [method, url])).toEqual([
      ['GET', 'https://api.flow.team/user/comments/90000011?replyYn=Y'],
    ]);
  });

  it('cursor를 주면 그 쪽을 받고, hasNext가 거짓이면 다음 커서가 없다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 200, body: flowEnvelope({ hasNext: false, lastCursor: 0, comments: [] }) });

    await expect(connect(server).listComments('90000011', '6')).resolves.toEqual({ ok: true, value: { comments: [], nextCursor: null } });
    expect(server.requests[0]?.url).toBe('https://api.flow.team/user/comments/90000011?replyYn=Y&cursor=6');
  });

  it('댓글 배열이 없는 응답은 응답 모양이 다르다고 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 200, body: flowEnvelope({ hasNext: false }) });

    await expect(connect(server).listComments('1', null)).resolves.toEqual({ ok: false, failure: { kind: 'unexpected-response' } });
  });

  it('GET /user/comments/{postId}/replies/{commentId}로 대댓글 한 쪽을 받고, 다음 쪽 커서를 돌려준다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope({
        hasNext: true,
        lastCursor: 20,
        replies: [
          { replyId: '9000090', parentCommentId: '900000021', contents: '열한째 대댓글' },
          { replyId: 9000091, contents: '@[테스트 사용자](me@example.test) 열두째' },
        ],
      }),
    });

    const result = await connect(server).listReplies('90000011', '900000021', '10');

    expect(result).toEqual({
      ok: true,
      value: {
        replies: [
          { replyId: '9000090', contents: '열한째 대댓글' },
          { replyId: '9000091', contents: '@[테스트 사용자](me@example.test) 열두째' },
        ],
        nextCursor: '20',
      },
    });
    expect(server.requests.map(({ method, url }) => [method, url])).toEqual([
      ['GET', 'https://api.flow.team/user/comments/90000011/replies/900000021?cursor=10'],
    ]);
  });

  it('대댓글 목록이 다른 이름의 배열로 와도 replyId가 든 배열을 읽는다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({ status: 200, body: flowEnvelope({ hasNext: false, items: [{ replyId: '1', contents: '하나' }] }) });

    await expect(connect(server).listReplies('9', '8', null)).resolves.toEqual({
      ok: true,
      value: { replies: [{ replyId: '1', contents: '하나' }], nextCursor: null },
    });
    expect(server.requests[0]?.url).toBe('https://api.flow.team/user/comments/9/replies/8');
  });

  it('대댓글 목록이 알림 목록처럼 한 겹 더 감싸여 와도 읽고, 그 안의 커서를 쓴다', async () => {
    const server = new FakeFlowServer();
    server.replyNext({
      status: 200,
      body: flowEnvelope({ replies: { hasNext: true, lastCursor: 30, replies: [{ replyId: '1', contents: '하나' }] } }),
    });

    await expect(connect(server).listReplies('9', '8', '20')).resolves.toEqual({
      ok: true,
      value: { replies: [{ replyId: '1', contents: '하나' }], nextCursor: '30' },
    });
  });
});
