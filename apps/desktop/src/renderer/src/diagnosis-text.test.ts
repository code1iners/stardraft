import { describe, expect, it } from 'vitest';
import {
  attachmentSizeText,
  causeParts,
  diagnosisFailureText,
  diagnosisRunLine,
  diagnosisStatusTag,
  diagnosisTabs,
  priorDiagnosisFacts,
  rediagnosisFailureNotice,
  reproductionTag,
} from './diagnosis-text';

describe('진단 원인 글의 근거 번호', () => {
  it('문장 끝의 `[근거 n]`을 번호 조각으로 나누고 번호 앞 공백은 글에서 뺀다', () => {
    expect(causeParts('빈 배열을 읽습니다. [근거 1]')).toEqual([{ text: '빈 배열을 읽습니다.' }, { cite: 1 }]);
  });

  it('번호 여럿과 번호 뒤의 글을 순서대로 나눈다', () => {
    expect(causeParts('A가 원인입니다. [근거 1] [근거 12] 그래서 B도 봅니다.')).toEqual([
      { text: 'A가 원인입니다.' },
      { cite: 1 },
      { cite: 12 },
      { text: ' 그래서 B도 봅니다.' },
    ]);
  });

  it('근거 표기가 없는 글은 한 조각이고, 빈 글은 조각이 없다', () => {
    expect(causeParts('근거 없이 적은 원인')).toEqual([{ text: '근거 없이 적은 원인' }]);
    expect(causeParts('')).toEqual([]);
  });

  it('`[근거 없음]`처럼 번호가 없는 표기는 번호로 읽지 않는다', () => {
    expect(causeParts('추정입니다. [근거 없음]')).toEqual([{ text: '추정입니다. [근거 없음]' }]);
  });
});

describe('진단 목록과 탭의 글', () => {
  it('재현 태그는 성공 초록, 실패 노랑, 불가는 테두리만 있는 `재현 안 함`이다', () => {
    expect(reproductionTag({ result: 'success', impossibleReason: null, method: '', steps: [] })).toEqual({ label: '재현 성공', tone: 'success' });
    expect(reproductionTag({ result: 'failure', impossibleReason: null, method: '', steps: [] })).toEqual({ label: '재현 실패', tone: 'warn' });
    expect(reproductionTag({ result: 'impossible', impossibleReason: 'no-tool', method: '', steps: [] })).toEqual({ label: '재현 안 함', tone: 'outline' });
  });

  it('탭 이름은 보고서 · 근거 n · 첨부 n · 정보다', () => {
    /** 근거 둘이 든 보고서. 탭 이름에는 근거 수만 쓰인다. */
    const report = { evidence: [{}, {}] } as Parameters<typeof diagnosisTabs>[0];

    expect(diagnosisTabs(report, 3).map((tab) => tab.label)).toEqual(['보고서', '근거 2', '첨부 3', '정보']);
  });

  it('실행 줄은 보고서가 없으면 없다', () => {
    expect(diagnosisRunLine(null)).toBeNull();
  });

  it('첨부 크기는 바이트, KB, MB로 줄여 보인다', () => {
    expect([12, 2048, 3 * 1024 * 1024].map(attachmentSizeText)).toEqual(['12B', '2.0KB', '3.0MB']);
  });
});

describe('다시 진단과 앞선 진단의 글', () => {
  it('다시 진단하는 동안에는 기다리든 돌든 `다시 진단 중` 회색 태그다', () => {
    for (const status of ['queued', 'running'] as const) {
      expect(diagnosisStatusTag({ status, repoWait: null, rediagnosing: true })).toEqual({ label: '다시 진단 중', tone: 'generating' });
    }
    expect(diagnosisStatusTag({ status: 'queued', repoWait: null, rediagnosing: false })).toEqual({ label: '대기', tone: 'generating' });
    expect(diagnosisStatusTag({ status: 'running', repoWait: null })).toEqual({ label: '진단 중', tone: 'generating' });
    // 다시 진단하지 못하고 돌아온 진단은 그냥 준비됨이다.
    expect(diagnosisStatusTag({ status: 'ready', repoWait: null, rediagnosing: false })).toEqual({ label: '준비됨', tone: 'ready' });
  });

  it('돌아온 보고서 위 알림 줄은 사유와 앞선 보고서를 그대로 둔다는 말을 적는다', () => {
    expect(rediagnosisFailureNotice({ reason: 'cancelled', detail: null, lastStep: null })).toBe(
      '다시 진단하지 못했습니다: 취소함: 진단을 취소했습니다. 앞선 보고서를 그대로 둡니다.',
    );
    expect(diagnosisFailureText({ reason: 'repository-unavailable', detail: null, lastStep: null })).toBe('연결한 저장소를 찾을 수 없습니다.');
  });

  it('앞선 진단이 없으면 줄이 없고, 검토 대기 중이면 그 사실만 적는다', () => {
    expect(priorDiagnosisFacts(null)).toEqual([]);
    expect(priorDiagnosisFacts({ kind: 'in-review' })).toEqual([{ label: '앞선 진단', value: '검토 대기 중인 앞선 보고서가 있음' }]);
  });

  it('완료한 뒤의 재발이면 완료한 날짜와 내보낸 파일 경로를, 파일이 없으면 날짜만 적는다', () => {
    /** 2026-11-20 15:30(PC 시간대). */
    const completedAt = new Date(2026, 10, 20, 15, 30).getTime();

    expect(priorDiagnosisFacts({ kind: 'completed', completedAt, exportPath: '/내보냄/a.md' })).toEqual([
      { label: '앞선 진단', value: '앞서 진단함(2026-11-20)' },
      { label: '앞서 내보낸 파일', value: '/내보냄/a.md' },
    ]);
    expect(priorDiagnosisFacts({ kind: 'completed', completedAt, exportPath: null })).toEqual([{ label: '앞선 진단', value: '앞서 진단함(2026-11-20)' }]);
  });
});
