import type { FlowEmployee, FlowProject } from '../ports/flow-api';

/** 가짜 Flow 서버가 요청 하나에 줄 응답. */
export type FakeFlowReply =
  /** 이 상태 코드와 본문(JSON), 헤더로 답한다. */
  | { status: number; body?: unknown; headers?: Record<string, string> }
  /** 응답 없이 연결이 끊긴다. fetch가 실패한다. */
  | { network: 'error' }
  /** 중단 신호가 올 때까지 답하지 않는다. */
  | { network: 'hang' };

/** 가짜 Flow 서버가 받은 요청. */
export interface FakeFlowRequest {
  /** HTTP 메서드. */
  method: string;
  /** 요청 주소 전체. */
  url: string;
  /** `x-flow-api-key` 헤더 값. 없으면 `null`. */
  apiKey: string | null;
  /** fetch의 캐시 모드. 정하지 않았으면 `null`. */
  cache: NonNullable<RequestInit['cache']> | null;
  /** 쿠키를 싣고 받는지. 정하지 않았으면 `null`. */
  credentials: NonNullable<RequestInit['credentials']> | null;
  /** 리디렉트를 따라가는지. 정하지 않았으면 `null`. */
  redirect: NonNullable<RequestInit['redirect']> | null;
  /** `content-type` 헤더 값. 없으면 `null`. */
  contentType: string | null;
  /** 요청 본문. 문자열로 보낸 그대로이고, 없으면 `null`. */
  body: string | null;
}

/**
 * Flow 공개 API를 흉내 내는 fetch. Flow 어댑터를 바깥 경계(HTTP)에서 검사할 때 쓴다.
 * 키(`x-flow-api-key`)마다 계정을 두고 `GET /user/employees/me`와 `GET /user/projects/participants`에 Flow 응답 봉투로 답하며, 모르는 키에는 `401`을 준다.
 * `replyNext`로 다음 응답을 원하는 상태 코드나 연결 실패로 바꿀 수 있고, 받은 요청은 `requests`에 남는다.
 */
export class FakeFlowServer {
  /** 받은 요청. 받은 순서대로 쌓인다. */
  readonly requests: FakeFlowRequest[] = [];
  /** 키마다 그 키 소유자의 구성원 정보. */
  private readonly accounts = new Map<string, FlowEmployee>();
  /** 키마다 그 키 소유자가 참여한 Flow 프로젝트. */
  private readonly projects = new Map<string, FlowProject[]>();
  /** 계정 대신 먼저 줄 응답. 요청마다 앞에서 하나씩 꺼낸다. */
  private readonly queued: FakeFlowReply[] = [];

  /** 이 키를 가진 계정을 둔다. */
  addAccount(apiKey: string, employee: FlowEmployee): void {
    this.accounts.set(apiKey, employee);
  }

  /** 이 키 소유자가 참여한 Flow 프로젝트를 둔다. */
  setProjects(apiKey: string, projects: FlowProject[]): void {
    this.projects.set(apiKey, projects);
  }

  /** 다음 요청들에 차례로 줄 응답을 뒤에 더한다. */
  replyNext(...replies: FakeFlowReply[]): void {
    this.queued.push(...replies);
  }

  /** Flow 어댑터에 넣을 fetch. */
  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    /** 요청 헤더. */
    const headers = new Headers(init.headers);
    /** 요청에 실린 키. */
    const apiKey = headers.get('x-flow-api-key');
    this.requests.push({
      method: init.method ?? 'GET',
      url,
      apiKey,
      cache: init.cache ?? null,
      credentials: init.credentials ?? null,
      redirect: init.redirect ?? null,
      contentType: headers.get('content-type'),
      body: typeof init.body === 'string' ? init.body : null,
    });

    /** 이번 요청에 줄 응답. */
    const reply = this.queued.shift() ?? this.replyFor(url, apiKey);
    if ('network' in reply) {
      if (reply.network === 'hang') return waitForAbort(init.signal ?? null);
      throw new TypeError('fetch failed');
    }
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  };

  /** 대본이 없을 때 키와 주소로 정하는 응답. */
  private replyFor(url: string, apiKey: string | null): FakeFlowReply {
    /** 키 소유자. */
    const employee = apiKey === null ? undefined : this.accounts.get(apiKey);
    if (!employee) return flowError(401, 'UNAUTHORIZED');
    /** 요청 경로. */
    const path = new URL(url).pathname;
    if (path === '/user/projects/participants') {
      return { status: 200, body: flowEnvelope({ hasNext: false, projects: this.projects.get(apiKey ?? '') ?? [] }) };
    }
    if (path !== '/user/employees/me') return flowError(404, 'NOT_FOUND');
    return {
      status: 200,
      body: flowEnvelope({
        userId: employee.userId,
        fullname: employee.name,
        divisionName: employee.division,
        email: employee.email,
      }),
    };
  }
}

/** 성공 응답 봉투. 실호출에서 본 모양(`response.success`·`code`·`message`·`data`)을 따른다. */
export function flowEnvelope(data: unknown): unknown {
  return { response: { success: true, code: 200, message: 'success', data } };
}

/** 실패 응답. 실호출에서 본 오류 봉투 모양을 따른다. */
function flowError(status: number, code: string): FakeFlowReply {
  return { status, body: { response: { success: false, code: status, message: 'error', error: { code, message: code } } } };
}

/** 중단 신호가 오면 fetch처럼 실패하는 약속. */
function waitForAbort(signal: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}
