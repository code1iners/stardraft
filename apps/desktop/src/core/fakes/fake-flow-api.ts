import type { FlowApi, FlowApiResult, FlowEmployee } from '../ports/flow-api';

/** 가짜 Flow API가 기본으로 쓰는 키 소유자. 실제 사람이나 회사가 아니다. */
export const FAKE_ME: FlowEmployee = {
  userId: 'me@example.test',
  name: '테스트 사용자',
  division: '테스트 팀',
  email: 'me@example.test',
};

/**
 * 메모리 안의 데이터로 응답하는 Flow API.
 * 응답 코드는 대본으로 바꿀 수 있고, 받은 요청은 `requests`에 남는다.
 */
export class FakeFlowApi implements FlowApi {
  /** 받은 요청을 `메서드 경로` 형식으로 받은 순서대로 쌓는다. */
  readonly requests: string[] = [];
  /** `getMe`가 돌려줄 응답. */
  private meResult: FlowApiResult<FlowEmployee> = { ok: true, value: FAKE_ME };

  /** `getMe`가 앞으로 돌려줄 응답을 바꾼다. */
  respondToGetMe(result: FlowApiResult<FlowEmployee>): void {
    this.meResult = result;
  }

  async getMe(): Promise<FlowApiResult<FlowEmployee>> {
    this.requests.push('GET /user/employees/me');
    return this.meResult;
  }
}
