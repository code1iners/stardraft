import { describe, expect, it } from 'vitest';
import { FakeFlowApi } from './fake-flow-api';

describe('가짜 Flow API', () => {
  it('대본으로 바꾼 응답을 돌려주고 받은 요청을 기록한다', async () => {
    const flow = new FakeFlowApi();
    flow.respondToGetMe({ ok: false, failure: { kind: 'unauthorized' } });

    const result = await flow.getMe();

    expect(result).toEqual({ ok: false, failure: { kind: 'unauthorized' } });
    expect(flow.requests).toEqual(['GET /user/employees/me']);
  });

  it('대본이 없으면 가짜 계정으로 키 확인에 성공한다', async () => {
    const flow = new FakeFlowApi();

    const result = await flow.getMe();

    expect(result).toEqual({ ok: true, value: expect.objectContaining({ userId: 'me@example.test' }) });
  });
});
