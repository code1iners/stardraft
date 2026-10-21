import { describe, expect, it } from 'vitest';
import { developerTerms, sourceWords } from './style-check';

/** 멘션 원문과 스레드가 비어 있을 때 뺄 단어. */
const NO_SOURCE = sourceWords([]);

describe('문체 검사', () => {
  it.each([
    ['백틱', '설정은 `retry` 값으로 정합니다.', '`retry`'],
    ['파일 확장자처럼 생긴 말', '실제 서비스 설정은 application-prod.yml에 있습니다.', 'application-prod.yml'],
    ['경로 구분자', '이 내용은 src/main 폴더에 있습니다.', 'src/main'],
    ['Windows 경로 구분자', '이 내용은 config\\prod 폴더에 있습니다.', 'config\\prod'],
    ['점 표기 키', '재시도 횟수는 spring.retry.max-attempts로 정합니다.', 'spring.retry.max-attempts'],
    ['camelCase', '재시도 횟수는 retryCount가 정합니다.', 'retryCount'],
    ['snake_case', '재시도 횟수는 retry_count가 정합니다.', 'retry_count'],
    ['대문자 상수', '재시도 횟수는 MAX_RETRY로 정합니다.', 'MAX_RETRY'],
  ])('%s를 개발자 용어로 짚는다', (_rule, text, term) => {
    expect(developerTerms(text, NO_SOURCE)).toEqual([term]);
  });

  it('쉬운 말, 날짜, 소수, 한글 사이의 빗금, 밑줄 없는 약어는 짚지 않는다', () => {
    expect(developerTerms('실제 서비스에서는 재시도를 5번 합니다. 간격은 2초씩 늘어납니다.', NO_SOURCE)).toEqual([]);
    expect(developerTerms('10/21에 바뀐 값은 2.5초입니다. 읽기/쓰기 모두 됩니다.', NO_SOURCE)).toEqual([]);
    expect(developerTerms('409 오류는 API가 같은 요청을 거절했다는 뜻입니다.', NO_SOURCE)).toEqual([]);
  });

  it('한 문장에 여러 용어가 있으면 나온 순서대로 한 번씩 돌려준다', () => {
    expect(developerTerms('retryCount는 RetryConfig.kt에 있고 retryCount를 바꾸면 됩니다.', NO_SOURCE)).toEqual(['retryCount', 'RetryConfig.kt']);
  });

  it('멘션 원문과 스레드에 나온 단어는 뺀다', () => {
    /** 송신자가 직접 쓴 글. */
    const source = sourceWords(['@[테스트 사용자](me@example.test) application-prod.yml의 retryCount가 몇인가요?', '`MAX_RETRY`도 궁금합니다.']);

    expect(developerTerms('application-prod.yml의 retryCount는 5입니다.', source)).toEqual([]);
    expect(developerTerms('`MAX_RETRY`는 MAX_RETRY와 같습니다.', source)).toEqual([]);
    expect(developerTerms('retryDelay는 2초입니다.', source)).toEqual(['retryDelay']);
  });

  it('멘션 표기의 사용자 ID는 원문 단어로 세지 않는다', () => {
    /** 멘션 표기만 있는 원문. */
    const source = sourceWords(['@[테스트 사용자](me@example.test) 질문']);

    expect(developerTerms('me@example.test로 보내 주세요.', source)).toEqual(['me@example.test']);
  });
});
