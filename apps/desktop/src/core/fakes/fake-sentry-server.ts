import type { SentryOrganization, SentryProject } from '../ports/sentry-api';

/** 가짜 Sentry 서버가 요청 하나에 줄 응답. */
export type FakeSentryReply =
  /** 이 상태 코드와 본문(JSON), 헤더로 답한다. */
  | { status: number; body?: unknown; headers?: Record<string, string> }
  /** 응답 없이 연결이 끊긴다. fetch가 실패한다. */
  | { network: 'error' }
  /** 조직 하위 경로에 대한 응답 구현은 아래 확장에 둔다. */
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

/** 프로젝트 목록 응답 한 항목을 Sentry 모양으로 만든다. 앱이 읽지 않는 필드도 몇 개 실어 응답이 넉넉한 것을 흉내 낸다. */
export function sentryProjectBody(project: SentryProject): unknown {
  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    platform: 'javascript',
    isMember: true,
    hasAccess: true,
    environments: project.environments,
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
  /** 토큰과 조직 slug마다 그 조직에서 보이는 프로젝트. 키는 `토큰\n조직 slug`다. */
  private readonly projects = new Map<string, SentryProject[]>();
  /** 토큰이 `event:read` scope를 갖지 못한 것으로 보고 오류 이슈 목록에 `403`을 줄 토큰. */
  private readonly withoutEventRead = new Set<string>();
  /** 프로젝트 ID마다 오류 이슈 목록에 줄 상태 코드. 없으면 `200`이다. */
  private readonly issueStatuses = new Map<string, number>();
  /** 조직 목록 대신 먼저 줄 응답. 요청마다 앞에서 하나씩 꺼낸다. */
  private readonly queued: FakeSentryReply[] = [];
  /** 한 쪽에 줄 조직 수. 넘으면 `Link` 헤더로 다음 쪽을 알린다. */
  pageSize = 100;

  /** 이 토큰으로 보이는 조직을 둔다. */
  addToken(token: string, organizations: SentryOrganization[]): void {
    this.organizations.set(token, organizations);
  }

  /** 이 토큰으로 이 조직에서 보이는 프로젝트를 둔다. */
  addProjects(token: string, organizationSlug: string, projects: SentryProject[]): void {
    this.projects.set(`${token}\n${organizationSlug}`, projects);
  }

  /** 이 토큰에서 오류 이슈 목록을 읽지 못하게 한다(`event:read` 없음, `403`). */
  denyEventRead(token: string): void {
    this.withoutEventRead.add(token);
  }

  /** 이 프로젝트의 오류 이슈 목록이 줄 상태 코드를 바꾼다. 없는 프로젝트나 접근 거부를 흉내 낼 때 쓴다. */
  setIssueStatus(projectId: string, status: number): void {
    this.issueStatuses.set(projectId, status);
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

  /** 조직의 프로젝트 목록과 오류 이슈 목록에 답한다. */
  private replyForOrganization(token: string, organizationSlug: string, resource: string, url: URL): FakeSentryReply {
    if (resource === 'projects') {
      /** 이 조직에서 보이는 프로젝트. */
      const visible = this.projects.get(`${token}\n${organizationSlug}`);
      return visible ? { status: 200, body: visible.map(sentryProjectBody) } : { status: 404, body: { detail: 'The requested resource does not exist' } };
    }
    if (this.withoutEventRead.has(token)) return { status: 403, body: { detail: 'You do not have permission to perform this action.' } };
    /** 요청한 프로젝트 ID. */
    const projectId = url.searchParams.get('project') ?? '';
    return { status: this.issueStatuses.get(projectId) ?? 200, body: [] };
  }

  /** 요청 주소와 토큰에 맞는 응답을 만든다. */
  private replyFor(url: string, token: string | null): FakeSentryReply {
    /** 이 토큰으로 보이는 조직. 모르는 토큰이면 `undefined`. */
    const visible = token === null ? undefined : this.organizations.get(token);
    if (!visible) return { status: 401, body: { detail: 'Invalid token' } };

    /** 요청 주소. */
    const parsed = new URL(url);
    /** 조직 하위 경로(`/api/0/organizations/{조직}/projects/`, `…/issues/`). */
    const nested = /^\/api\/0\/organizations\/([^/]+)\/(projects|issues)\/$/.exec(parsed.pathname);
    if (nested) return this.replyForOrganization(token ?? '', decodeURIComponent(nested[1] ?? ''), nested[2] ?? '', parsed);
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

/** 조직 하위 경로에 대한 응답 구현은 아래 확장에 둔다. */
/** 중단 신호가 올 때까지 답하지 않는 응답. 신호가 오면 fetch처럼 실패한다. */
function hang(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
}
