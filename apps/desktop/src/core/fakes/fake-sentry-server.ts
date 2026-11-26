import type { SentryOrganization } from '../ports/sentry-api';

/** 가짜 Sentry 서버가 요청 하나에 줄 응답. */
export type FakeSentryReply =
  /** 이 상태 코드와 본문(JSON), 헤더로 답한다. */
  | { status: number; body?: unknown; headers?: Record<string, string> }
  /** 응답 없이 연결이 끊긴다. fetch가 실패한다. */
  | { network: 'error' }
  /** 중단 신호가 올 때까지 답하지 않는다. */
  | { network: 'hang' };

/** 가짜 Sentry 서버가 받은 요청. */
export interface FakeSentryRequest {
  /** HTTP 메서드. */
  method: string;
  /** 요청 주소 전체. */
  url: string;
  /** `Authorization` 헤더에서 `Bearer `를 뗀 토큰. 없으면 `null`. */
  token: string | null;
  /** fetch의 캐시 모드. 정하지 않았으면 `null`. */
  cache: NonNullable<RequestInit['cache']> | null;
  /** 쿠키를 싣고 받는지. 정하지 않았으면 `null`. */
  credentials: NonNullable<RequestInit['credentials']> | null;
  /** 리디렉트를 따라가는지. 정하지 않았으면 `null`. */
  redirect: NonNullable<RequestInit['redirect']> | null;
}

/** 조직 목록 응답 한 항목을 Sentry 모양으로 만든다. */
export function sentryOrganizationBody(organization: SentryOrganization): unknown {
  return {
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    links: { regionUrl: organization.regionUrl, organizationUrl: `https://${organization.slug}.sentry.io` },
  };
}

/**
 * Sentry API를 흉내 내는 fetch. Sentry 어댑터를 바깥 경계(HTTP)에서 검사할 때 쓴다.
 * 토큰마다 조직 목록을 두고 `GET /api/0/organizations/`에 Sentry 응답 모양으로 답하며, 모르는 토큰에는 `401`을 준다.
 * `replyNext`로 다음 응답을 원하는 상태 코드나 연결 실패로 바꿀 수 있고, 받은 요청은 `requests`에 남는다.
 */
export class FakeSentryServer {
  /** 받은 요청. 받은 순서대로 쌓인다. */
  readonly requests: FakeSentryRequest[] = [];
  /** 토큰마다 그 토큰으로 보이는 조직. */
  private readonly organizations = new Map<string, SentryOrganization[]>();
  /** 조직 목록 대신 먼저 줄 응답. 요청마다 앞에서 하나씩 꺼낸다. */
  private readonly queued: FakeSentryReply[] = [];
  /** 한 쪽에 줄 조직 수. 넘으면 `Link` 헤더로 다음 쪽을 알린다. */
  pageSize = 100;

  /** 이 토큰으로 보이는 조직을 둔다. */
  addToken(token: string, organizations: SentryOrganization[]): void {
    this.organizations.set(token, organizations);
  }

  /** 다음 요청들에 차례로 줄 응답을 뒤에 더한다. */
  replyNext(...replies: FakeSentryReply[]): void {
    this.queued.push(...replies);
  }

  /** Sentry 어댑터에 넣을 fetch. */
  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    /** 요청에 실린 인증 헤더. */
    const authorization = new Headers(init.headers).get('authorization');
    /** 인증 헤더에서 뗀 토큰. */
    const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
    this.requests.push({
      method: init.method ?? 'GET',
      url,
      token,
      cache: init.cache ?? null,
      credentials: init.credentials ?? null,
      redirect: init.redirect ?? null,
    });

    /** 이번 요청에 줄 응답. */
    const reply = this.queued.shift() ?? this.replyFor(url, token);
    if ('network' in reply) {
      if (reply.network === 'error') throw new TypeError('fetch failed');
      return hang(init.signal);
    }
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json', ...reply.headers },
    });
  };

  /** 요청 주소와 토큰에 맞는 응답을 만든다. */
  private replyFor(url: string, token: string | null): FakeSentryReply {
    /** 이 토큰으로 보이는 조직. 모르는 토큰이면 `undefined`. */
    const visible = token === null ? undefined : this.organizations.get(token);
    if (!visible) return { status: 401, body: { detail: 'Invalid token' } };

    /** 요청 주소. */
    const parsed = new URL(url);
    if (parsed.pathname !== '/api/0/organizations/') return { status: 404, body: { detail: 'not found' } };

    /** 이번 쪽의 시작 위치. 커서는 `0:오프셋:0` 모양이다. */
    const offset = Number(parsed.searchParams.get('cursor')?.split(':')[1] ?? 0);
    /** 이번 쪽의 조직. */
    const page = visible.slice(offset, offset + this.pageSize);
    /** 다음 쪽이 있는지 여부. */
    const hasNext = offset + this.pageSize < visible.length;
    /** 다음 쪽 커서. */
    const next = `0:${offset + this.pageSize}:0`;
    return {
      status: 200,
      body: page.map(sentryOrganizationBody),
      headers: {
        link: [
          `<https://sentry.io/api/0/organizations/?&cursor=0:${Math.max(0, offset - this.pageSize)}:1>; rel="previous"; results="${offset > 0}"; cursor="0:${Math.max(0, offset - this.pageSize)}:1"`,
          `<https://sentry.io/api/0/organizations/?&cursor=${next}>; rel="next"; results="${hasNext}"; cursor="${next}"`,
        ].join(', '),
      },
    };
  }
}

/** 중단 신호가 올 때까지 답하지 않는 응답. 신호가 오면 fetch처럼 실패한다. */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}
