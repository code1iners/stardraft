/** Flow 구성원 정보. `GET /user/employees/me` 응답에서 앱이 쓰는 값이다. */
export interface FlowEmployee {
  /** Flow 사용자 ID(이메일 형식). 알림의 `receiverId`와 같은 값이다. */
  userId: string;
  /** 이름. */
  name: string;
  /** 소속. */
  division: string;
  /** 이메일. */
  email: string;
}

/** Flow API 호출이 실패한 이유. */
export type FlowApiFailure =
  /** `401`. 키가 맞지 않거나 삭제·변경됐다. */
  | { kind: 'unauthorized' }
  /** `429`. `Retry-After`가 있으면 기다릴 시간(밀리초)을 담는다. */
  | { kind: 'rate-limited'; retryAfterMs: number | null }
  /** 응답을 받지 못했다. */
  | { kind: 'network' }
  /** 그 밖의 응답 코드. */
  | { kind: 'http'; status: number }
  /** 성공 응답을 받았지만 본문이 앱이 아는 모양이 아니다. */
  | { kind: 'unexpected-response' };

/** Flow API 호출 결과. */
export type FlowApiResult<T> = { ok: true; value: T } | { ok: false; failure: FlowApiFailure };

/**
 * Flow API 포트.
 * Flow 전용 코드는 이 포트의 어댑터 한 곳에 모은다. 알림 조회, 맥락 조회, 게시는 이 포트에 차례로 더한다.
 */
export interface FlowApi {
  /** 키 소유자 본인의 구성원 정보를 조회한다. 키 확인에 쓴다. */
  getMe(): Promise<FlowApiResult<FlowEmployee>>;
}
