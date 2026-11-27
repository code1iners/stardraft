import { describe, expect, it } from 'vitest';
import { testNotification } from './notification-test-text';

describe('알림 시험 문구', () => {
  it('앱 이름을 제목에 넣고, 본문은 초안이 아니라 결과가 준비되면 알린다고 말한다', () => {
    expect(testNotification('스타드래프트')).toEqual({
      title: '스타드래프트 알림 시험',
      body: '알림이 이렇게 보입니다. 결과가 준비되면 같은 방식으로 알려 드립니다.',
    });
  });
});
