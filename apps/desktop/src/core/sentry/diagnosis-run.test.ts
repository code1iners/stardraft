import { describe, expect, it } from 'vitest';
import { fakeEvent } from '../fakes/fake-sentry-api';
import {
  diagnosisInputDocument,
  eventFacts,
  readDiagnosisOutput,
  readOnlyDiagnosisInstructions,
  readOnlyDiagnosisSchema,
  readReproducingDiagnosisOutput,
  reproducingDiagnosisInstructions,
  reproducingDiagnosisSchema,
} from './diagnosis-run';

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

describe('재현하는 진단: 지침과 출력 스키마', () => {
  it('출력 스키마에 재현(결과, 불가 사유, 방법, 순서, 첨부)이 있고 모든 칸이 필수다', () => {
    /** 스키마. */
    const schema = reproducingDiagnosisSchema() as { properties: Record<string, { properties?: Record<string, unknown>; required?: string[] }>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(['summary', 'reproduction', 'cause', 'improvements', 'open_questions', 'evidence']);
    expect(schema.required).toEqual(Object.keys(schema.properties));
    expect(schema.properties.reproduction?.required).toEqual(['result', 'impossible_reason', 'method', 'steps', 'attachments']);
    expect(schema.properties.reproduction?.properties?.result).toEqual({ type: 'string', enum: ['success', 'failure', 'impossible'] });
    expect(schema.properties.reproduction?.properties?.impossible_reason).toEqual({ type: ['string', 'null'], enum: ['no_tool', 'insufficient_data', 'env_failed', null] });
  });

  it('지침에 재현하는 진단 절차(루프, 재현과 최소화, 가설, 계측, 사본 안 코드 고치기, 시간 배분, 안내 문서, 운영 서버와 외부 도구 금지)가 들어 있다', () => {
    /** 지침. */
    const instructions = reproducingDiagnosisInstructions([]);
    for (const phrase of [
      '피드백 루프',
      '최소화',
      '가설을 3~5개',
      '계측',
      '사본 안에서 코드를 고쳐',
      '패치 파일',
      '10분쯤',
      '20분',
      'package.json',
      '운영 서버로 데이터를 바꾸는 요청을 보내지 않습니다',
      '외부로 보내거나 쓰는 도구를 쓰지 않습니다',
      '사람에게 묻지 않습니다',
      'high를 쓰지 않습니다',
    ]) {
      expect(instructions).toContain(phrase);
    }
    // 읽기 전용 진단의 지침에는 재현·계측이 없다.
    expect(readOnlyDiagnosisInstructions([])).not.toContain('피드백 루프');
  });

  it('재현 칸과 첨부 경로를 읽는다. 불가가 아니면 불가 사유를 비우고, 불가인데 사유가 없으면 구조 실패다', () => {
    /** 재현 칸이 있는 출력. */
    const output = (reproduction: Record<string, unknown>) => ({ ...OUTPUT, reproduction });

    expect(
      readReproducingDiagnosisOutput(
        output({ result: 'success', impossible_reason: 'no_tool', method: ' 브라우저 3번 중 3번 ', steps: ['로그인', ' '], attachments: ['shots/a.png'] }),
      )?.reproduction,
    ).toEqual({ result: 'success', impossibleReason: null, method: '브라우저 3번 중 3번', steps: ['로그인'], attachments: ['shots/a.png'] });
    expect(
      readReproducingDiagnosisOutput(output({ result: 'impossible', impossible_reason: 'env_failed', method: '', steps: ['pnpm dev'], attachments: [] }))?.reproduction,
    ).toMatchObject({ result: 'impossible', impossibleReason: 'env-failed' });
    expect(readReproducingDiagnosisOutput(output({ result: 'impossible', impossible_reason: null, method: '', steps: [], attachments: [] }))).toBeNull();
    expect(readReproducingDiagnosisOutput(OUTPUT)).toBeNull();
  });

  it('입력 문서에 재현 사본 경로를 적고, 근거에는 원본 저장소 경로를 쓰게 한다', () => {
    /** 입력 문서. */
    const document = diagnosisInputDocument({
      repository: '/fake/repo',
      workspace: '/private/var/fake/run-1',
      issue: {
        shortId: 'FAKE-1',
        title: '가짜 오류',
        culprit: '',
        level: 'error',
        environment: null,
        firstSeen: 0,
        lastSeen: null,
        count: null,
        userCount: null,
        permalink: null,
        platform: null,
        organizationName: '가짜 조직',
        projectName: '가짜 프로젝트',
      },
      origin: 'new',
      event: fakeEvent('1'),
      facts: eventFacts(fakeEvent('1'), STATE),
    });
    expect(document).toContain('# 재현 사본\n- /private/var/fake/run-1');
    expect(document.indexOf('\n# 재현 사본\n')).toBeLessThan(document.indexOf('\n# 데이터\n'));
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
