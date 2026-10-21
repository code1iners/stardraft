import { describe, expect, it } from 'vitest';
import { splitMentionMarkup } from './mention-markup';

describe('Flow 어댑터: 화면에 보일 멘션 표기', () => {
  it('@[이름](사용자 ID) 표기를 @이름 조각으로 바꾸고, 사용자 ID는 남기지 않는다', () => {
    expect(splitMentionMarkup('@[테스트 사용자](me@example.test) 재시도는 @[보낸 사람](sender@example.test)님 확인')).toEqual([
      { text: '@테스트 사용자', mention: true },
      { text: ' 재시도는 ', mention: false },
      { text: '@보낸 사람', mention: true },
      { text: '님 확인', mention: false },
    ]);
  });

  it('표기가 없으면 글 전체를 조각 하나로, 빈 글은 빈 목록으로 돌려준다. 줄바꿈은 그대로 둔다', () => {
    expect(splitMentionMarkup('첫 줄\n둘째 줄')).toEqual([{ text: '첫 줄\n둘째 줄', mention: false }]);
    expect(splitMentionMarkup('')).toEqual([]);
  });
});
