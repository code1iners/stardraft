import type { Clock } from '../ports/clock';
import type { SentryApi, SentryApiFailure, SentryApiResult, SentryOrganization, SentryProject } from '../ports/sentry-api';

/** Sentry 공식 서비스 주소. 지원하는 Sentry는 sentry.io뿐이므로 설정으로 받지 않는다. 코드에서 이 주소는 여기에만 둔다. */
const SENTRY_BASE_URL = 'https://sentry.io';
/** 응답을 기다리는 최대 시간(밀리초). 넘으면 요청을 끊고 응답을 받지 못한 것으로 본다. */
const RESPONSE_TIMEOUT_MS = 20_000;
/** 조직 목록을 이어 받는 최대 쪽 수. 서버가 다음 쪽이 있다고 계속 답해도 여기서 멈춘다. */
const MAX_ORGANIZATION_PAGES = 50;
/** 프로젝트 목록을 이어 받는 최대 쪽 수. */
const MAX_PROJECT_PAGES = 50;
/** 헤더 값으로 보낼 수 있는 토큰. 공백 없는 ASCII 글자만이다. */
const HEADER_SAFE_TOKEN = /^[\x21-\x7e]+$/;

/** Sentry 어댑터가 요청을 보낼 때 쓰는 fetch. Electron `net.fetch`와 Node `fetch` 모두 이 모양이다. */
export type SentryFetch = (url: string, init: RequestInit) => Promise<Response>;

/** HTTP Sentry API를 만드는 데 필요한 값. */
export interface HttpSentryApiOptions {
  /** 요청마다 `Authorization: Bearer`로 보낼 개인 토큰. */
  token: string;
  /** 요청을 보낼 fetch. */
  fetch: SentryFetch;
  /** 응답 제한 시간을 재는 시계. */
  clock: Clock;
}

/**
 * 개인 토큰 하나로 sentry.io API를 부르는 Sentry API 포트의 어댑터.
 * Sentry 응답의 모양(필드 이름, `Link` 헤더 쪽 나눔)을 아는 곳은 이 어댑터뿐이다. 토큰은 로그에도 오류에도 남기지 않는다.
 */
export class HttpSentryApi implements SentryApi {
  constructor(private readonly options: HttpSentryApiOptions) {}

  /**
   * `GET /api/0/organizations/`로 조직을 모두 받는다. 응답은 조직 배열이고, 다음 쪽은 `Link` 헤더의
   * `rel="next"`에 `results="true"`가 붙어 있을 때만 그 `cursor`로 이어 받는다.
   */
  async listOrganizations(): Promise<SentryApiResult<SentryOrganization[]>> {
    /** 받은 조직. 같은 ID는 처음 것만 둔다. */
    const organizations = new Map<string, SentryOrganization>();
    /** 다음 쪽을 받을 커서. 첫 쪽은 `null`. */
    let cursor: string | null = null;
    for (let page = 0; page < MAX_ORGANIZATION_PAGES; page += 1) {
      /** 이번 쪽의 경로. */
      const path = cursor === null ? '/api/0/organizations/' : `/api/0/organizations/?cursor=${encodeURIComponent(cursor)}`;
      /** 이번 쪽을 읽은 결과. */
      const result = await this.get(SENTRY_BASE_URL, path);
      if (!result.ok) return result;

      if (!Array.isArray(result.value.json)) return UNEXPECTED_RESPONSE;
      for (const item of result.value.json) {
        /** 읽은 조직. */
        const organization = readOrganization(item);
        if (!organization) return UNEXPECTED_RESPONSE;
        if (!organizations.has(organization.id)) organizations.set(organization.id, organization);
      }

      /** 다음 쪽 커서. */
      const next = nextCursor(result.value.link);
      if (next === null || next === cursor) break;
      cursor = next;
    }
    return { ok: true, value: [...organizations.values()] };
  }

  /**
   * `GET /api/0/organizations/{조직}/projects/`로 조직의 프로젝트를 모두 받는다. 조직의 지역 주소로 부르고,
   * 다음 쪽은 조직 목록과 같은 `Link` 헤더 규칙으로 이어 받는다.
   */
  async listProjects(organization: SentryOrganization): Promise<SentryApiResult<SentryProject[]>> {
    /** 토큰을 실을 기준 주소. */
    const base = readRegionUrl(organization.regionUrl);
    if (base === null) return UNEXPECTED_RESPONSE;
    /** 받은 프로젝트. 같은 ID는 처음 것만 둔다. */
    const projects = new Map<string, SentryProject>();
    /** 다음 쪽을 받을 커서. 첫 쪽은 `null`. */
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PROJECT_PAGES; page += 1) {
      /** 이번 쪽의 경로. */
      const path: string = `/api/0/organizations/${encodeURIComponent(organization.slug)}/projects/?per_page=100${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
      /** 이번 쪽을 읽은 결과. */
      const result = await this.get(base, path);
      if (!result.ok) return result;

      if (!Array.isArray(result.value.json)) return UNEXPECTED_RESPONSE;
      for (const item of result.value.json) {
        /** 읽은 프로젝트. */
        const project = readProject(item);
        if (!project) return UNEXPECTED_RESPONSE;
        if (!projects.has(project.id)) projects.set(project.id, project);
      }

      /** 다음 쪽 커서. */
      const next = nextCursor(result.value.link);
      if (next === null || next === cursor) break;
      cursor = next;
    }
    return { ok: true, value: [...projects.values()] };
  }

  /** `GET /api/0/organizations/{조직}/issues/?project={ID}&limit=1`로 오류 이슈 목록을 한 건만 읽는다. 본문은 배열인지만 본다. */
  async probeErrorIssues(organization: SentryOrganization, projectId: string): Promise<SentryApiResult<void>> {
    /** 토큰을 실을 기준 주소. */
    const base = readRegionUrl(organization.regionUrl);
    if (base === null) return UNEXPECTED_RESPONSE;
    /** 이번 확인의 경로. */
    const path = `/api/0/organizations/${encodeURIComponent(organization.slug)}/issues/?project=${encodeURIComponent(projectId)}&limit=1`;
    /** 읽은 결과. */
    const result = await this.get(base, path);
    if (!result.ok) return result;
    return Array.isArray(result.value.json) ? { ok: true, value: undefined } : UNEXPECTED_RESPONSE;
  }

  /** `baseUrl`의 `path`를 GET으로 불러 JSON 본문과 `Link` 헤더를 읽는다. */
  private async get(baseUrl: string, path: string): Promise<SentryApiResult<{ json: unknown; link: string | null }>> {
    // 헤더에 실을 수 없는 토큰은 fetch가 연결 오류처럼 실패하므로, 보내기 전에 맞지 않는 토큰으로 판정한다.
    if (!HEADER_SAFE_TOKEN.test(this.options.token)) return { ok: false, failure: { kind: 'unauthorized' } };

    /** 제한 시간이 지나면 요청을 끊는 신호. */
    const controller = new AbortController();
    /** 제한 시간 예약을 지우는 함수. */
    const cancelTimeout = this.options.clock.after(RESPONSE_TIMEOUT_MS, () => controller.abort());
    try {
      /** 받은 응답. */
      let response: Response;
      try {
        // 조직 정보가 HTTP 캐시로 디스크에 남지 않게 캐시를 쓰지 않고, 토큰 인증이라 쿠키도 싣거나 받지 않는다.
        // 리디렉트를 따라가면 토큰 헤더가 다른 출처로 갈 수 있으므로 리디렉트는 실패로 본다.
        response = await this.options.fetch(`${baseUrl}${path}`, {
          method: 'GET',
          headers: { authorization: `Bearer ${this.options.token}`, accept: 'application/json' },
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        });
      } catch {
        return NETWORK_FAILURE;
      }

      if (!response.ok) {
        // 실패 응답의 본문(HTML일 수 있다)은 읽지 않으므로 연결을 놓아 준다.
        void response.body?.cancel().catch(() => {});
        return { ok: false, failure: failureOf(response.status) };
      }

      /** JSON으로 읽은 응답 본문. */
      let json: unknown;
      try {
        json = await response.json();
      } catch {
        // 본문을 받는 도중 제한 시간이 지난 것과 본문이 JSON이 아닌 것을 나눈다.
        return controller.signal.aborted ? NETWORK_FAILURE : UNEXPECTED_RESPONSE;
      }
      return { ok: true, value: { json, link: response.headers.get('link') } };
    } finally {
      cancelTimeout();
    }
  }
}

/** 응답을 받지 못한 결과. */
const NETWORK_FAILURE: SentryApiResult<never> = { ok: false, failure: { kind: 'network' } };
/** 성공 응답의 본문이 앱이 아는 모양이 아닌 결과. */
const UNEXPECTED_RESPONSE: SentryApiResult<never> = { ok: false, failure: { kind: 'unexpected-response' } };

/** 실패 응답 코드를 실패 이유로 바꾼다. */
function failureOf(status: number): SentryApiFailure {
  if (status === 401) return { kind: 'unauthorized' };
  if (status === 404) return { kind: 'not-found' };
  if (status === 403) return { kind: 'forbidden' };
  if (status === 429) return { kind: 'rate-limited' };
  return { kind: 'http', status };
}

/** 조직 목록 항목 하나를 읽는다. 모양이 맞지 않거나 지역 주소가 sentry.io가 아니면 `null`. */
function readOrganization(item: unknown): SentryOrganization | null {
  if (!isRecord(item) || !isRecord(item.links)) return null;
  /** 문자열이나 숫자로 올 수 있는 조직 ID. */
  const id = typeof item.id === 'number' ? String(item.id) : item.id;
  if (typeof id !== 'string' || id === '' || typeof item.slug !== 'string' || item.slug === '') return null;
  /** 지역 주소. 이 주소로 토큰을 보내므로 sentry.io의 https 주소만 받는다. */
  const regionUrl = readRegionUrl(item.links.regionUrl);
  if (regionUrl === null) return null;
  return { id, slug: item.slug, name: typeof item.name === 'string' && item.name !== '' ? item.name : item.slug, regionUrl };
}

/** 프로젝트 목록 항목 하나를 읽는다. 모양이 맞지 않으면 `null`. 환경은 문자열만 받고 겹치는 이름은 한 번만 둔다. */
function readProject(item: unknown): SentryProject | null {
  if (!isRecord(item)) return null;
  /** 문자열이나 숫자로 올 수 있는 프로젝트 ID. */
  const id = typeof item.id === 'number' ? String(item.id) : item.id;
  if (typeof id !== 'string' || id === '' || typeof item.slug !== 'string' || item.slug === '') return null;
  /** 프로젝트에 이벤트가 들어온 환경. 응답에 없으면 비어 있다. */
  const environments = Array.isArray(item.environments)
    ? [...new Set(item.environments.filter((name): name is string => typeof name === 'string' && name !== ''))]
    : [];
  return { id, slug: item.slug, name: typeof item.name === 'string' && item.name !== '' ? item.name : item.slug, environments };
}

/** 지역 주소를 읽어 끝의 `/`를 뺀 출처로 돌려준다. sentry.io 계열의 https 주소가 아니면 `null`. */
function readRegionUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  /** 읽은 주소. */
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return null;
  if (url.hostname !== 'sentry.io' && !url.hostname.endsWith('.sentry.io')) return null;
  return url.origin;
}

/** `Link` 헤더에서 `rel="next"`이고 `results="true"`인 항목의 커서를 읽는다. 다음 쪽이 없으면 `null`. */
function nextCursor(link: string | null): string | null {
  if (link === null) return null;
  for (const entry of link.matchAll(/<[^>]*>([^<]*)/g)) {
    /** 이 항목의 속성들. */
    const attributes = entry[1] ?? '';
    if (!/rel="next"/.test(attributes) || !/results="true"/.test(attributes)) continue;
    /** 이 항목의 커서. */
    const cursor = /cursor="([^"]+)"/.exec(attributes)?.[1];
    if (cursor) return cursor;
  }
  return null;
}

/** 값이 객체인지 본다. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
