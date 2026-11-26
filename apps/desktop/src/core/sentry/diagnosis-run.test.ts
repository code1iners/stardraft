import { describe, expect, it } from 'vitest';
import { fakeEvent } from '../fakes/fake-sentry-api';
import { eventFacts, readDiagnosisOutput, readOnlyDiagnosisSchema } from './diagnosis-run';

/** 가짜 오류 이슈 상태. */
const STATE = { status: 'unresolved', firstRelease: 'web@1.0.0', lastRelease: 'web@1.2.0' } as const;

/** 올바른 출력. */
const OUTPUT = {
  summary: ' 요약입니다. ',
  cause: { text: '원인입니다. [근거 1]', confidence: 'low' },
  improvements: ['고칠 방향', '  '],
  open_questions: [],
  evidence: [{ id: 1, explanation: '설명', repository: '/fake/repo', path: 'src/a.ts', start_line: 3, end_line: 4 }],
};

describe('진단 실행: 출력 스키마와 결과 읽기', () => {
  it('읽기 전용 진단의 출력 스키마에는 재현이 없고 모든 칸이 필수다', () => {
    /** 스키마. */
    const schema = readOnlyDiagnosisSchema() as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(['summary', 'cause', 'improvements', 'open_questions', 'evidence']);
    expect(schema.required).toEqual(Object.keys(schema.properties));
  });

  it('스키마 모양의 출력을 읽어 공백과 빈 항목을 정리한다', () => {
    expect(readDiagnosisOutput(OUTPUT)).toEqual({
      summary: '요약입니다.',
      cause: { text: '원인입니다. [근거 1]', confidence: 'low' },
      improvements: ['고칠 방향'],
      openQuestions: [],
      evidence: [{ id: 1, explanation: '설명', repository: '/fake/repo', path: 'src/a.ts', startLine: 3, endLine: 4 }],
    });
  });

  it.each([
    ['확신도가 정한 값이 아님', { ...OUTPUT, cause: { text: '원인', confidence: 'certain' } }],
    ['요약이 비어 있음', { ...OUTPUT, summary: '  ' }],
    ['재현 대신 다른 모양', { ...OUTPUT, improvements: 'x' }],
    ['근거의 줄 번호가 정수가 아님', { ...OUTPUT, evidence: [{ ...OUTPUT.evidence[0], start_line: '3' }] }],
  ])('%s이면 구조 실패(null)다', (_label, output) => {
    expect(readDiagnosisOutput(output)).toBeNull();
  });
});

describe('진단 실행: 앱이 정하는 오류 이슈 정보', () => {
  it('소스맵 처리 오류가 있으면 소스맵 적용 안 됨이고, 앱 코드 프레임과 release가 없으면 없는 데이터에 적는다', () => {
    /** 앱 코드 프레임 없이 소스맵 오류가 난 이벤트. */
    const event = fakeEvent('101', { release: null, processingErrors: ['js_invalid_sourcemap_location'] });
    event.exceptions[0]!.frames[0]!.inApp = false;

    expect(eventFacts(event, STATE)).toMatchObject({
      release: null,
      firstRelease: 'web@1.0.0',
      lastRelease: 'web@1.2.0',
      sourceMaps: 'failed',
      missingData: ['앱 코드 프레임 없음', '소스맵 적용 안 됨', 'release 없음'],
    });
  });

  it('스택 앞부분은 가장 안쪽 예외와 오류가 난 자리부터 거슬러 올라간 프레임이다', () => {
    /** 프레임 둘짜리 이벤트. */
    const event = fakeEvent('101');
    event.exceptions[0]!.frames.unshift({ filename: 'src/outer.ts', function: 'outer', lineNo: 9, colNo: null, inApp: true, context: [] });

    expect(eventFacts(event, STATE).stackHead).toEqual(['TypeError: 시험 오류 메시지', '[앱] src/fake.ts:2:5 fakeHandler', '[앱] src/outer.ts:9 outer']);
  });
});
