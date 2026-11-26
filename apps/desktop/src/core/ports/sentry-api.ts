/** 토큰으로 볼 수 있는 Sentry 조직. `GET /api/0/organizations/` 응답에서 앱이 쓰는 값이다. */
export interface SentryOrganization {
  /** 조직 ID. */
  id: string;
  /** 조직 slug. 이후 호출의 경로에 쓴다. */
  slug: string;
  /** 화면에 보일 조직 이름. */
  name: string;
  /** 이 조직의 지역 주소(`links.regionUrl`). 이후 이 조직에 거는 호출의 기준 주소다. */
  regionUrl: string;
}

/** 조직의 Sentry 프로젝트. `GET /api/0/organizations/{조직}/projects/` 응답에서 앱이 쓰는 값이다. */
export interface SentryProject {
  /** 프로젝트 ID. 등록의 키다. 이름이 바뀌어도 이 값은 그대로다. */
  id: string;
  /** 프로젝트 slug. */
  slug: string;
  /** 화면에 보일 프로젝트 이름. */
  name: string;
  /** 프로젝트에 이벤트가 들어온 환경 이름. 환경 필터를 이 목록에서 고른다. */
  environments: string[];
}

/** Sentry API 호출이 실패한 이유. */
export type SentryApiFailure =
  /** `404`. 조직이나 프로젝트가 없거나 이 토큰으로 볼 수 없다. */
  | { kind: 'not-found' }
  /** `401`. 토큰이 거부됐다(회수됐거나 잘못 붙여 넣음). */
  | { kind: 'unauthorized' }
  /** `403`. 토큰에 이 호출에 필요한 scope가 없다. */
  | { kind: 'forbidden' }
  /** `429`. Sentry는 `Retry-After`를 주지 않는다. */
  | { kind: 'rate-limited' }
  /** 응답을 받지 못했다. */
  | { kind: 'network' }
  /** 그 밖의 응답 코드. */
  | { kind: 'http'; status: number }
  /** 성공 응답을 받았지만 본문이 앱이 아는 모양이 아니다. */
  | { kind: 'unexpected-response' };

/** Sentry API 호출 결과. */
export type SentryApiResult<T> = { ok: true; value: T } | { ok: false; failure: SentryApiFailure };

/**
 * Sentry API 포트.
 * Sentry 전용 코드는 이 포트의 어댑터 한 곳에 모은다. 지원하는 Sentry는 공식 sentry.io뿐이라 서버 주소를 받지 않는다.
 */
export interface SentryApi {
  /** 토큰으로 보이는 조직을 모두 읽는다. 쪽을 끝까지 넘기며, `org:read` scope가 필요하다. */
  listOrganizations(): Promise<SentryApiResult<SentryOrganization[]>>;
  /** 조직의 프로젝트를 모두 읽는다. 조직의 지역 주소로 부르고, `org:read` scope가 필요하다. */
  listProjects(organization: SentryOrganization): Promise<SentryApiResult<SentryProject[]>>;
  /**
   * 프로젝트의 오류 이슈 목록을 한 건만 읽어 `event:read`가 있는지 확인한다. 환경은 걸지 않는다.
   * 이벤트가 아직 없는 환경 이름을 주면 Sentry가 `404`를 주므로 환경 필터와 무관하게 읽어야 한다.
   */
  probeErrorIssues(organization: SentryOrganization, projectId: string): Promise<SentryApiResult<void>>;
}

/** 토큰 하나로 Sentry API를 부르는 클라이언트를 만든다. */
export type ConnectSentry = (token: string) => SentryApi;
