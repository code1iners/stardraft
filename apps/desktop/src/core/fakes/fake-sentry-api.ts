import type {
  SentryApi,
  SentryApiFailure,
  SentryApiResult,
  SentryErrorIssue,
  SentryEvent,
  SentryIssueFilter,
  SentryOrganization,
  SentryProject,
  SentryRegression,
} from '../ports/sentry-api';

/** 가짜 Sentry가 들고 있는 오류 이슈 하나. */
export interface FakeSentryIssue {
  /** 오류 이슈 ID. */
  id: string;
  /** 속한 프로젝트 ID. */
  projectId: string;
  /** 오류 제목. */
  title: string;
  /** 레벨. */
  level: string;
  /** 상태. 미해결, 해결됨, 보관됨이다. */
  status: 'unresolved' | 'resolved' | 'ignored';
  /** 미해결의 하위 상태. 재발은 `regressed`, 보관했다가 다시 늘어난 것은 `escalating`이다. */
  substatus: 'new' | 'ongoing' | 'regressed' | 'escalating' | null;
  /** 환경마다 그 환경에서 처음 보인 시각(Unix epoch 밀리초). 이벤트가 든 환경만 있다. */
  firstSeenByEnvironment: Record<string, number>;
  /** 오류 이슈 상세의 재발 활동. 오래된 것부터다. */
  regressions: SentryRegression[];
  /** 다른 오류 이슈로 병합됐는지 여부. 참이면 상세 조회가 병합됨으로 답한다. */
  merged: boolean;
  /** 최신 이벤트. 없으면 최신 이벤트 조회가 `404`다. */
  latestEvent: SentryEvent | null;
}

/** 가짜 Sentry API가 받은 호출. */
export interface FakeSentryCall {
  /** 부른 메서드. */
  method:
    | 'listOrganizations'
    | 'listProjects'
    | 'probeErrorIssues'
    | 'listNewErrorIssues'
    | 'listRegressedErrorIssues'
    | 'latestRegression'
    | 'errorIssueState'
    | 'latestEvent';
  /** 쓴 토큰. */
  token: string;
  /** 프로젝트 ID나 오류 이슈 ID. 없으면 `null`. */
  target: string | null;
  /** 신규 조회의 기준 시각. 없으면 `null`. */
  firstSeenAfter: number | null;
}

/** 다음 호출에 줄 실패의 대본. `target`이 있으면 그 프로젝트나 오류 이슈에 거는 호출에만 쓴다. */
interface ScriptedFailure {
  method: FakeSentryCall['method'];
  target: string | null;
  failure: SentryApiFailure;
}

/**
 * 메모리 안의 조직·프로젝트·오류 이슈·재발 활동으로 Sentry API 포트를 흉내 낸다. core의 감지 규칙을 포트 경계에서 검사할 때 쓴다.
 * 신규 조회는 미해결이고 처음 보인 시각(환경을 주면 그 환경 기준)이 기준보다 뒤인 것, 재발 조회는 `regressed`이고 환경을 주면
 * 그 환경의 이벤트가 있는 것(그 환경에서 재발했는지가 아니다)을 레벨로 걸러 돌려준다. `failNext`로 다음 호출을 원하는 실패로 바꾼다.
 */
export class FakeSentryApi {
  /** 받은 호출. 순서대로 쌓인다. */
  readonly calls: FakeSentryCall[] = [];
  /** 조직. */
  organizations: SentryOrganization[] = [];
  /** 조직 slug마다 프로젝트. */
  readonly projects = new Map<string, SentryProject[]>();
  /** 오류 이슈. ID가 키다. */
  readonly issues = new Map<string, FakeSentryIssue>();
  /** 받아 주는 토큰. 다른 토큰은 `401`이다. */
  token = 'fake-sentry-token';
  /** 호출마다 답하기 전에 기다릴 일. 조회하는 사이에 다른 일이 끼어드는 경우를 흉내 낸다. */
  beforeAnswer: ((call: FakeSentryCall) => Promise<void>) | null = null;
  /** 다음 호출들에 줄 실패. */
  private readonly failures: ScriptedFailure[] = [];

  /** 오류 이슈를 더하거나 바꾼다. 처음 보인 시각은 환경 하나로 줄 수 있다. */
  addIssue(issue: Partial<FakeSentryIssue> & Pick<FakeSentryIssue, 'id' | 'projectId'> & { firstSeen?: number; environment?: string }): FakeSentryIssue {
    /** 넣을 오류 이슈. */
    const value: FakeSentryIssue = {
      title: `시험 오류 ${issue.id}`,
      level: 'error',
      status: 'unresolved',
      substatus: 'new',
      regressions: [],
      merged: false,
      latestEvent: fakeEvent(issue.id),
      ...issue,
      firstSeenByEnvironment: issue.firstSeenByEnvironment ?? { [issue.environment ?? 'production']: issue.firstSeen ?? 0 },
    };
    this.issues.set(value.id, value);
    return value;
  }

  /** 해결된 오류 이슈가 이 이벤트로 재발했다. 재발 활동이 더해지고 하위 상태가 `regressed`가 된다. */
  regress(issueId: string, eventId: string, at: number): void {
    /** 재발한 오류 이슈. */
    const issue = this.issues.get(issueId)!;
    issue.status = 'unresolved';
    issue.substatus = 'regressed';
    issue.regressions.push({ eventId, at });
  }

  /** 다음 `method` 호출 한 번(`target`을 주면 그 대상에 거는 호출)을 이 실패로 바꾼다. */
  failNext(method: FakeSentryCall['method'], failure: SentryApiFailure, target: string | null = null): void {
    this.failures.push({ method, target, failure });
  }

  /** 토큰 하나로 부르는 Sentry API 포트. */
  readonly connect = (token: string): SentryApi => ({
    listOrganizations: () => this.answer({ method: 'listOrganizations', token, target: null, firstSeenAfter: null }, () => [...this.organizations]),
    listProjects: (organization) =>
      this.answer({ method: 'listProjects', token, target: null, firstSeenAfter: null }, () => [...(this.projects.get(organization.slug) ?? [])]),
    probeErrorIssues: (_organization, projectId) => this.answer({ method: 'probeErrorIssues', token, target: projectId, firstSeenAfter: null }, () => undefined),
    listNewErrorIssues: (_organization, filter, firstSeenAfter) =>
      this.answer({ method: 'listNewErrorIssues', token, target: filter.projectId, firstSeenAfter }, () =>
        this.matching(filter)
          .filter((issue) => issue.status === 'unresolved' && firstSeenOf(issue, filter.environment) > firstSeenAfter)
          .sort((a, b) => firstSeenOf(a, filter.environment) - firstSeenOf(b, filter.environment))
          .map((issue) => listItem(issue, filter.environment)),
      ),
    listRegressedErrorIssues: (_organization, filter) =>
      this.answer({ method: 'listRegressedErrorIssues', token, target: filter.projectId, firstSeenAfter: null }, () =>
        this.matching(filter)
          .filter((issue) => issue.status === 'unresolved' && issue.substatus === 'regressed')
          .map((issue) => listItem(issue, filter.environment)),
      ),
    latestRegression: (_organization, issueId) =>
      this.answer({ method: 'latestRegression', token, target: issueId, firstSeenAfter: null }, () => {
        /** 활동을 읽을 오류 이슈. */
        const issue = this.issues.get(issueId);
        if (!issue) return NOT_FOUND;
        return issue.regressions.at(-1) ?? null;
      }),
    errorIssueState: (_organization, issueId) =>
      this.answer({ method: 'errorIssueState', token, target: issueId, firstSeenAfter: null }, () => {
        /** 상태를 읽을 오류 이슈. 지운 오류 이슈는 없다. */
        const issue = this.issues.get(issueId);
        if (!issue) return NOT_FOUND;
        return { status: issue.merged ? 'merged' : issue.status, firstRelease: 'fake@1.0.0', lastRelease: 'fake@1.0.1' };
      }),
    latestEvent: (_organization, issueId) =>
      this.answer({ method: 'latestEvent', token, target: issueId, firstSeenAfter: null }, () => {
        /** 최신 이벤트를 읽을 오류 이슈. */
        const issue = this.issues.get(issueId);
        return issue?.latestEvent ? structuredClone(issue.latestEvent) : NOT_FOUND;
      }),
  });

  /** 프로젝트·환경·레벨 필터에 맞는 오류 이슈. 환경을 주면 그 환경의 이벤트가 있는 것만이다. */
  private matching(filter: SentryIssueFilter): FakeSentryIssue[] {
    return [...this.issues.values()].filter(
      (issue) =>
        issue.projectId === filter.projectId &&
        (filter.levels as readonly string[]).includes(issue.level) &&
        (filter.environment === null || filter.environment in issue.firstSeenByEnvironment),
    );
  }

  /** 호출을 기록하고, 대본의 실패나 모르는 토큰이면 실패로, 아니면 `value`로 답한다. */
  private async answer<T>(call: FakeSentryCall, value: () => T | typeof NOT_FOUND): Promise<SentryApiResult<T>> {
    this.calls.push(call);
    await this.beforeAnswer?.(call);
    /** 이 호출에 걸린 대본 실패. */
    const index = this.failures.findIndex((item) => item.method === call.method && (item.target === null || item.target === call.target));
    if (index !== -1) return { ok: false, failure: this.failures.splice(index, 1)[0]!.failure };
    if (call.token !== this.token) return { ok: false, failure: { kind: 'unauthorized' } };
    /** 답할 값. */
    const result = value();
    return result === NOT_FOUND ? { ok: false, failure: { kind: 'not-found' } } : { ok: true, value: result };
  }
}

/** 없는 대상을 가리키는 표시. */
const NOT_FOUND = Symbol('not-found');

/** 환경 기준 처음 보인 시각. 환경이 없으면 모든 환경 중 가장 이른 시각이다. */
function firstSeenOf(issue: FakeSentryIssue, environment: string | null): number {
  if (environment !== null) return issue.firstSeenByEnvironment[environment] ?? Number.POSITIVE_INFINITY;
  return Math.min(...Object.values(issue.firstSeenByEnvironment));
}

/** 목록 응답 한 항목. */
function listItem(issue: FakeSentryIssue, environment: string | null): SentryErrorIssue {
  return {
    id: issue.id,
    shortId: `FAKE-${issue.id}`,
    title: issue.title,
    culprit: 'app/fake',
    level: issue.level,
    firstSeen: firstSeenOf(issue, environment),
    lastSeen: issue.regressions.at(-1)?.at ?? firstSeenOf(issue, environment),
    count: 1,
    userCount: 1,
    permalink: `https://fake.sentry.test/issues/${issue.id}/`,
    platform: 'javascript',
  };
}

/** 가짜 최신 이벤트. 앱 코드 프레임 하나짜리 스택트레이스와 breadcrumb 하나, release, 환경·레벨 태그를 담는다. */
export function fakeEvent(issueId: string, overrides: Partial<SentryEvent> = {}): SentryEvent {
  return {
    eventId: `event-${issueId}`,
    platform: 'javascript',
    release: 'fake@1.0.1',
    message: null,
    tags: [
      { key: 'environment', value: 'production' },
      { key: 'level', value: 'error' },
    ],
    exceptions: [
      {
        type: 'TypeError',
        value: '시험 오류 메시지',
        module: null,
        frames: [{ filename: 'src/fake.ts', function: 'fakeHandler', lineNo: 2, colNo: 5, inApp: true, context: [[2, 'throw new TypeError();']] }],
        hasRawStacktrace: true,
      },
    ],
    breadcrumbs: [{ timestamp: '2026-11-26T11:59:00Z', category: 'navigation', level: 'info', message: '/fake' }],
    request: { method: 'GET', url: 'https://app.fake.test/fake' },
    user: { id: 'user-1', username: null },
    contexts: [{ name: 'browser', summary: 'Chrome 120' }],
    processingErrors: [],
    ...overrides,
  };
}
