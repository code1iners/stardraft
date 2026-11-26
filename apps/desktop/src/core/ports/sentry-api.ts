import type { SentryLevel } from './settings-store';

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

/** 감지 조회가 쓰는 오류 이슈 목록 한 항목. `GET /api/0/organizations/{조직}/issues/` 응답에서 앱이 쓰는 값이다. */
export interface SentryErrorIssue {
  /** 오류 이슈 ID. 신규의 중복 억제 키다. */
  id: string;
  /** 짧은 ID(예: `PROJECT-1A`). 없으면 빈 문자열. */
  shortId: string;
  /** 오류 제목. */
  title: string;
  /** 오류가 난 자리(culprit). 없으면 빈 문자열. */
  culprit: string;
  /** 레벨. 응답에 없으면 빈 문자열. */
  level: string;
  /** 처음 보인 시각(Unix epoch 밀리초). 환경을 걸고 부르면 그 환경에서 처음 보인 시각이다. */
  firstSeen: number;
  /** 마지막으로 보인 시각(Unix epoch 밀리초). 응답에 없으면 `null`. */
  lastSeen: number | null;
  /** 발생 수. 응답에 없으면 `null`. */
  count: number | null;
  /** 영향을 받은 사용자 수. 응답에 없으면 `null`. */
  userCount: number | null;
  /** Sentry 화면 주소. 없으면 `null`. */
  permalink: string | null;
  /** 플랫폼. 없으면 `null`. */
  platform: string | null;
}

/** 오류 이슈 목록 조회의 필터. 등록한 프로젝트의 필터 그대로다. */
export interface SentryIssueFilter {
  /** 프로젝트 ID. */
  projectId: string;
  /** 환경 필터. `null`이면 환경을 걸지 않는다. */
  environment: string | null;
  /** 레벨 필터. 비어 있지 않다. */
  levels: readonly SentryLevel[];
}

/** 오류 이슈 상세의 활동에서 읽은 가장 최근 재발. */
export interface SentryRegression {
  /** 재발을 일으킨 이벤트 ID(`set_regression` 활동의 `data.event_id`). 재발의 중복 억제 키에 쓴다. */
  eventId: string;
  /** 재발 시각(활동의 `dateCreated`, Unix epoch 밀리초). */
  at: number;
}

/** Sentry API 호출이 실패한 이유. */
export type SentryApiFailure =
  /** `404`. 조직이나 프로젝트가 없거나 이 토큰으로 볼 수 없다. */
  | { kind: 'not-found' }
  /** `401`. 토큰이 거부됐다(회수됐거나 잘못 붙여 넣음). */
  | { kind: 'unauthorized' }
  /** `403`. 토큰에 이 호출에 필요한 scope가 없다. */
  | { kind: 'forbidden' }
  /**
   * `429`. Sentry는 `Retry-After`를 주지 않는다. `resetAt`은 `X-Sentry-Rate-Limit-Reset` 헤더(UTC epoch 초)를 밀리초로 바꾼
   * 한도 초기화 시각이고, 헤더가 없거나 읽을 수 없으면 없다.
   */
  | { kind: 'rate-limited'; resetAt?: number }
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
  /**
   * 신규 조회. 미해결이고 처음 보인 시각이 `firstSeenAfter`(Unix epoch 밀리초)보다 뒤인 오류 이슈를 처음 보인 순서로 모두 읽는다.
   * 환경과 레벨 필터를 걸고 쪽을 끝까지 넘긴다. `event:read` scope가 필요하다.
   */
  listNewErrorIssues(organization: SentryOrganization, filter: SentryIssueFilter, firstSeenAfter: number): Promise<SentryApiResult<SentryErrorIssue[]>>;
  /** 재발 조회. `is:regressed`인 오류 이슈를 환경과 레벨 필터를 걸어 모두 읽는다. 쪽을 끝까지 넘긴다. */
  listRegressedErrorIssues(organization: SentryOrganization, filter: SentryIssueFilter): Promise<SentryApiResult<SentryErrorIssue[]>>;
  /** 오류 이슈 상세의 활동에서 가장 최근 재발을 읽는다. 재발 활동이 없으면 `null`. */
  latestRegression(organization: SentryOrganization, issueId: string): Promise<SentryApiResult<SentryRegression | null>>;
}

/** 토큰 하나로 Sentry API를 부르는 클라이언트를 만든다. */
export type ConnectSentry = (token: string) => SentryApi;
