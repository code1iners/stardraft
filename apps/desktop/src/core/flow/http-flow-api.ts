import type { Clock } from '../ports/clock';
import type { FlowAlarm, FlowAlarmPage, FlowApi, FlowApiFailure, FlowApiResult, FlowEmployee, FlowProject } from '../ports/flow-api';

/** Flow 공개 API 주소. 모든 회사가 같은 주소를 쓰므로 설정으로 받지 않는다. 코드에서 이 주소는 여기에만 둔다. */
const FLOW_API_BASE_URL = 'https://api.flow.team';
/** 응답을 기다리는 최대 시간(밀리초). 넘으면 요청을 끊고 응답을 받지 못한 것으로 본다. */
const RESPONSE_TIMEOUT_MS = 20_000;
/** 헤더 값으로 보낼 수 있는 키. 공백 없는 ASCII 글자만이다. */
const HEADER_SAFE_KEY = /^[\x21-\x7e]+$/;
/** 참여 Flow 프로젝트 목록을 이어 받는 최대 쪽 수. 서버가 `hasNext`를 계속 참으로 줘도 여기서 멈춘다. */
const MAX_PROJECT_PAGES = 50;
/** 멘션 알림 목록 한 쪽의 크기. */
const ALARM_PAGE_SIZE = 20;

/** Flow 어댑터가 요청을 보낼 때 쓰는 fetch. Electron `net.fetch`와 Node `fetch` 모두 이 모양이다. */
export type FlowFetch = (url: string, init: RequestInit) => Promise<Response>;

/** HTTP Flow API를 만드는 데 필요한 값. */
export interface HttpFlowApiOptions {
  /** 요청마다 `x-flow-api-key` 헤더로 보낼 개인 API 키. */
  apiKey: string;
  /** 요청을 보낼 fetch. */
  fetch: FlowFetch;
  /** 응답 제한 시간을 재고 `Retry-After` 날짜를 계산하는 시계. */
  clock: Clock;
}

/**
 * 개인 API 키 하나로 Flow 공개 API를 부르는 Flow API 포트의 어댑터.
 * Flow 응답의 모양(응답 봉투, 필드 이름)을 아는 곳은 이 어댑터뿐이다.
 */
export class HttpFlowApi implements FlowApi {
  constructor(private readonly options: HttpFlowApiOptions) {}

  async getMe(): Promise<FlowApiResult<FlowEmployee>> {
    /** 응답 봉투의 data를 읽은 결과. */
    const result = await this.get('/user/employees/me');
    if (!result.ok) return result;

    /** data에서 읽은 구성원 정보. */
    const employee = readEmployee(result.value);
    return employee ? { ok: true, value: employee } : UNEXPECTED_RESPONSE;
  }

  /**
   * `GET /user/projects/participants`로 참여 Flow 프로젝트를 모두 받는다.
   * 문서는 항목 필드(`projectId`, `title`, `projectUrl`)만 밝히고 data 안의 위치와 쪽 나눔은 밝히지 않는다(실호출은 안 함).
   * 그래서 data 자체나 data 바로 아래에서 `projectId`가 든 배열을 읽고, 알림 목록처럼 `hasNext`·`lastCursor`가 오면 다음 쪽을 이어 받는다.
   */
  async listParticipantProjects(): Promise<FlowApiResult<FlowProject[]>> {
    /** 받은 프로젝트. 같은 ID는 처음 것만 둔다. */
    const projects = new Map<string, FlowProject>();
    /** 다음 쪽을 받을 커서. 첫 쪽은 `null`. */
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PROJECT_PAGES; page += 1) {
      /** 이번 쪽의 경로. */
      const path = cursor === null ? '/user/projects/participants' : `/user/projects/participants?cursor=${encodeURIComponent(cursor)}`;
      /** 응답 봉투의 data를 읽은 결과. */
      const result = await this.get(path);
      if (!result.ok) return result;

      /** data에서 읽은 한 쪽. */
      const read = readProjectPage(result.value);
      if (!read) return UNEXPECTED_RESPONSE;
      for (const project of read.projects) if (!projects.has(project.projectId)) projects.set(project.projectId, project);
      if (read.nextCursor === null || read.nextCursor === cursor) break;
      cursor = read.nextCursor;
    }
    return { ok: true, value: [...projects.values()] };
  }

  /**
   * `GET /user/alarms?filters=MENTION&size=20`으로 멘션 알림 한 쪽을 받는다.
   * 모바일에서 먼저 읽은 멘션도 놓치지 않게 `readYn`은 보내지 않는다. 응답은 `data.alarms` 아래의 `hasNext`·`lastCursor`·`alarms[]`다.
   */
  async listMentionAlarms(cursor: string | null): Promise<FlowApiResult<FlowAlarmPage>> {
    /** 이번 쪽의 경로. */
    const path = `/user/alarms?filters=MENTION&size=${ALARM_PAGE_SIZE}${cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`;
    /** 응답 봉투의 data를 읽은 결과. */
    const result = await this.get(path);
    if (!result.ok) return result;

    /** data에서 읽은 한 쪽. */
    const page = readAlarmPage(result.value);
    return page ? { ok: true, value: page } : UNEXPECTED_RESPONSE;
  }

  /**
   * GET 요청을 보내고 응답 봉투의 data를 돌려준다.
   * 제한 시간 안에 본문까지 받지 못하면 요청을 끊고 응답을 받지 못한 것으로 본다.
   */
  private async get(path: string): Promise<FlowApiResult<unknown>> {
    // 헤더에 실을 수 없는 키는 fetch가 연결 오류처럼 실패하므로, 보내기 전에 맞지 않는 키로 판정한다.
    if (!HEADER_SAFE_KEY.test(this.options.apiKey)) return { ok: false, failure: { kind: 'unauthorized' } };

    /** 제한 시간이 지나면 요청을 끊는 신호. */
    const controller = new AbortController();
    /** 제한 시간 예약을 지우는 함수. */
    const cancelTimeout = this.options.clock.after(RESPONSE_TIMEOUT_MS, () => controller.abort());
    try {
      /** 받은 응답. */
      let response: Response;
      try {
        // Flow 글이 HTTP 캐시로 디스크에 남지 않게 캐시를 쓰지 않는다. 키 인증이라 쿠키도 싣거나 받지 않는다.
        // 리디렉트를 따라가면 키 헤더가 다른 출처로 갈 수 있으므로 리디렉트는 실패로 본다.
        response = await this.options.fetch(`${FLOW_API_BASE_URL}${path}`, {
          method: 'GET',
          headers: { 'x-flow-api-key': this.options.apiKey, accept: 'application/json' },
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        });
      } catch {
        return NETWORK_FAILURE;
      }

      if (!response.ok) {
        // 실패 응답의 본문은 읽지 않으므로 연결을 놓아 준다.
        void response.body?.cancel().catch(() => {});
        return { ok: false, failure: this.failureOf(response) };
      }

      /** JSON으로 읽은 본문. */
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        // 본문을 받는 도중 제한 시간이 지난 것과 본문이 JSON이 아닌 것을 나눈다.
        return controller.signal.aborted ? NETWORK_FAILURE : UNEXPECTED_RESPONSE;
      }
      return isRecord(body) && isRecord(body.response) ? { ok: true, value: body.response.data } : UNEXPECTED_RESPONSE;
    } finally {
      cancelTimeout();
    }
  }

  /** 실패 응답 코드를 실패 이유로 바꾼다. */
  private failureOf(response: Response): FlowApiFailure {
    if (response.status === 401) return { kind: 'unauthorized' };
    if (response.status === 429) {
      return { kind: 'rate-limited', retryAfterMs: retryAfterMs(response.headers.get('retry-after'), this.options.clock.now()) };
    }
    return { kind: 'http', status: response.status };
  }
}

/** 응답을 받지 못한 결과. */
const NETWORK_FAILURE: FlowApiResult<never> = { ok: false, failure: { kind: 'network' } };
/** 성공 응답의 본문이 앱이 아는 모양이 아닌 결과. */
const UNEXPECTED_RESPONSE: FlowApiResult<never> = { ok: false, failure: { kind: 'unexpected-response' } };

/** `Retry-After` 헤더(초 또는 HTTP 날짜)를 지금부터 기다릴 밀리초로 바꾼다. 없거나 읽을 수 없으면 `null`. */
function retryAfterMs(header: string | null, now: number): number | null {
  if (header === null) return null;
  /** 앞뒤 공백을 뺀 헤더 값. */
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value) * 1_000;

  /** HTTP 날짜로 읽은 시각. */
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * `GET /user/employees/me`의 data에서 앱이 쓰는 구성원 정보를 읽는다. 사용자 ID가 없으면 `null`.
 * 문서는 응답 필드(`userId`, `fullname`, `divisionName`, `email`)만 밝히고 data 안의 위치는 밝히지 않는다.
 * 그래서 data 자체와 data 바로 아래 객체 가운데 사용자 ID가 있는 첫 객체를 읽는다.
 */
function readEmployee(data: unknown): FlowEmployee | null {
  if (!isRecord(data)) return null;
  /** 사용자 ID가 있는 객체. */
  const record = [data, ...Object.values(data)].find((candidate) => isRecord(candidate) && trimmedString(candidate.userId));
  if (!isRecord(record)) return null;

  /** 사용자 ID(이메일 형식). 이름이나 이메일이 비면 화면에 대신 보인다. */
  const userId = trimmedString(record.userId);
  return {
    userId,
    name: trimmedString(record.fullname) || userId,
    division: trimmedString(record.divisionName),
    email: trimmedString(record.email) || userId,
  };
}

/** 멘션 알림 목록 한 쪽을 읽는다. `data.alarms.alarms` 배열이 없으면 `null`. */
function readAlarmPage(data: unknown): FlowAlarmPage | null {
  /** `hasNext`·`lastCursor`·`alarms[]`를 담은 객체. */
  const list = isRecord(data) ? data.alarms : null;
  if (!isRecord(list) || !Array.isArray(list.alarms)) return null;

  /** 다음 쪽 커서. `hasNext`가 참이고 `lastCursor`가 있을 때만 있다. */
  const lastCursor = list.hasNext === true ? idString(list.lastCursor) : '';
  return {
    alarms: list.alarms.flatMap((item): FlowAlarm[] => {
      if (!isRecord(item)) return [];
      /** 알림 ID. 없으면 기준점으로 쓸 수 없으므로 건너뛴다. */
      const alarmId = idString(item.alarmId);
      if (!alarmId) return [];
      return [
        {
          alarmId,
          projectId: idString(item.projectId),
          postId: idString(item.postId),
          remarkId: idString(item.remarkId),
          replyId: idString(item.replyId),
          receiverId: trimmedString(item.receiverId),
          registerId: trimmedString(item.registerId),
          registeredDateTime: idString(item.registeredDateTime),
        },
      ];
    }),
    nextCursor: lastCursor || null,
  };
}

/** 참여 Flow 프로젝트 목록 한 쪽. */
interface ProjectPage {
  /** 이 쪽의 프로젝트. */
  projects: FlowProject[];
  /** 다음 쪽을 받을 커서. 마지막 쪽이면 `null`. */
  nextCursor: string | null;
}

/** 참여 Flow 프로젝트 목록 한 쪽을 읽는다. 프로젝트 배열을 찾지 못하면 `null`. */
function readProjectPage(data: unknown): ProjectPage | null {
  /** 프로젝트 항목 배열. data 자체가 배열이거나 data 바로 아래의 배열이다. */
  const items = Array.isArray(data) ? data : isRecord(data) ? projectArrayIn(Object.values(data)) : null;
  if (!items) return null;

  /** 다음 쪽 커서. `hasNext`가 참이고 `lastCursor`가 있을 때만 있다. */
  const lastCursor = isRecord(data) && data.hasNext === true ? idString(data.lastCursor) : '';
  return {
    projects: items.flatMap((item) => {
      if (!isRecord(item)) return [];
      /** 프로젝트 ID. 숫자로 와도 문자열로 맞춘다. */
      const projectId = idString(item.projectId);
      if (!projectId) return [];
      return [{ projectId, title: trimmedString(item.title), projectUrl: trimmedString(item.projectUrl) || null }];
    }),
    nextCursor: lastCursor || null,
  };
}

/**
 * data 바로 아래 값 가운데 프로젝트 배열을 고른다. `projectId`가 든 배열을 먼저 고르고,
 * 없으면 배열이 하나뿐일 때만 그 배열을 빈 목록으로 본다. 관련 없는 빈 배열을 목록으로 잘못 읽지 않기 위해서다.
 */
function projectArrayIn(values: unknown[]): unknown[] | null {
  /** data 바로 아래의 배열. */
  const arrays = values.filter((value): value is unknown[] => Array.isArray(value));
  return arrays.find((array) => array.some(hasProjectId)) ?? (arrays.length === 1 ? (arrays[0] ?? null) : null);
}

/** 프로젝트 ID가 든 항목인지 본다. */
function hasProjectId(item: unknown): boolean {
  return isRecord(item) && idString(item.projectId) !== '';
}

/** 문자열이나 숫자로 온 ID를 문자열로 바꾼다. 없으면 빈 문자열. */
function idString(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return trimmedString(value);
}

/** 문자열이면 앞뒤 공백을 뺀 값, 아니면 빈 문자열. */
function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 필드를 읽을 수 있는 객체인지 확인한다. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
