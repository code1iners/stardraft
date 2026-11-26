import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { baseName, exportDiagnosisReport, reportMarkdown } from './diagnosis-export';
import type { DiagnosisReport, SentryDiagnosis } from './sentry-diagnosis';

/** 시험이 만든 임시 폴더. */
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 임시 폴더를 만든다. */
function makeDir(): string {
  /** 만든 폴더. */
  const dir = mkdtempSync(join(tmpdir(), 'diagnosis-export-'));
  tempDirs.push(dir);
  return dir;
}

/** 감지 시각. 2026-11-26 09:50(PC 시간대). 이 시각의 날짜가 파일 이름에 들어간다. */
const DETECTED_AT = new Date(2026, 10, 26, 9, 50).getTime();

/** 재현 칸만 고를 수 있는 가짜 보고서. 실제 오류가 아니다. */
function report(reproduction: Partial<DiagnosisReport['reproduction']> = {}): DiagnosisReport {
  return {
    summary: '결제 화면에서 금액이 비면 예외가 납니다.',
    reproduction: { result: 'failure', impossibleReason: null, method: '개발 서버에서 세 번 시도', steps: ['결제 화면을 연다', '금액을 비운다'], ...reproduction },
    cause: { text: '금액 검사가 없습니다. [근거 1]', confidence: 'medium' },
    improvements: ['금액 검사를 넣는다'],
    openQuestions: ['다른 화면도 같은가'],
    evidence: [{ id: 1, explanation: '금액을 그대로 쓴다', repository: '/fake/web', path: 'src/pay.ts', startLine: 10, endLine: 12, located: true }],
    event: { eventId: 'e1', release: 'web@1.2.0', firstRelease: 'web@1.0.0', lastRelease: null, sourceMaps: 'applied', missingData: [], stackHead: [] },
    run: {
      repository: '/fake/web',
      headCommit: 'a'.repeat(40),
      uncommittedChanges: false,
      agent: 'claude-code',
      cliVersion: '2.1.300',
      reproductionAllowed: true,
      durationMs: 134_000,
      createdAt: DETECTED_AT + 60_000,
    },
    priorDiagnosis: null,
  };
}

/** 가짜 진단. 프로젝트 이름과 짧은 ID로 파일 이름이 정해진다. */
function diagnosis(overrides: Partial<SentryDiagnosis> = {}, projectName = '가짜 프로젝트', shortId = 'WEB-1A'): SentryDiagnosis {
  return {
    id: 5,
    projectId: '11',
    issueId: '9001',
    origin: 'new',
    regressionEventId: null,
    detectedAt: DETECTED_AT,
    status: 'ready',
    repoCheck: null,
    issue: {
      shortId,
      title: '가짜 오류: 금액이 비었습니다',
      culprit: 'src/pay.ts',
      level: 'error',
      environment: 'production',
      firstSeen: DETECTED_AT - 3_600_000,
      lastSeen: DETECTED_AT,
      count: 3,
      userCount: 1,
      permalink: 'https://org-a.sentry.io/issues/9001/',
      platform: 'javascript',
      organizationName: '가짜 조직',
      projectName,
    },
    report: report(),
    failure: null,
    runs: [],
    completedAt: null,
    lastExport: null,
    directives: [],
    rediagnosisFailure: null,
    ...overrides,
  };
}

/** 첨부 파일을 만든 폴더와 그 파일 이름. */
function makeAttachments(...names: string[]): { dir: string; names: string[] } {
  /** 첨부가 놓인 폴더. */
  const dir = makeDir();
  for (const name of names) writeFileSync(join(dir, name), `내용 ${name}`);
  return { dir, names };
}

describe('보고서 파일 이름', () => {
  it('날짜(감지한 날) - 프로젝트 이름 - 짧은 ID 순서다', () => {
    expect(baseName(diagnosis())).toBe('2026-11-26-가짜-프로젝트-WEB-1A');
  });

  it('파일 이름에 못 쓰는 글자는 바꾸고, 짧은 ID가 없으면 오류 이슈 ID를 쓴다', () => {
    expect(baseName(diagnosis({}, 'a/b:c*d?', ''))).toBe('2026-11-26-a-b-c-d-issue-9001');
    expect(baseName(diagnosis({}, '..', 'X'))).toBe('2026-11-26-sentry-X');
  });
});

describe('보고서 내보내기', () => {
  it('설정 폴더가 없으면 만들고 `날짜-프로젝트-짧은 ID.md`로 쓴다', async () => {
    const folder = join(makeDir(), '없던', '폴더');

    const result = await exportDiagnosisReport({ diagnosis: diagnosis(), folder, attachmentNames: [], attachmentsDir: makeDir() });

    expect(result.fileName).toBe('2026-11-26-가짜-프로젝트-WEB-1A.md');
    expect(result.path).toBe(join(folder, result.fileName));
    expect(readFileSync(result.path, 'utf8')).toContain('# 가짜 오류: 금액이 비었습니다');
  });

  it('같은 이름이 있으면 덮어쓰지 않고 -2, -3을 붙인다', async () => {
    const folder = makeDir();
    /** 한 번 내보낸다. */
    const exportOnce = () => exportDiagnosisReport({ diagnosis: diagnosis(), folder, attachmentNames: [], attachmentsDir: folder });

    const first = await exportOnce();
    const second = await exportOnce();
    const third = await exportOnce();

    expect([first.fileName, second.fileName, third.fileName]).toEqual([
      '2026-11-26-가짜-프로젝트-WEB-1A.md',
      '2026-11-26-가짜-프로젝트-WEB-1A-2.md',
      '2026-11-26-가짜-프로젝트-WEB-1A-3.md',
    ]);
    expect(readdirSync(folder)).toHaveLength(3);
  });

  it('같은 이름의 파일이 이미 있으면 그 내용은 그대로 둔다', async () => {
    const folder = makeDir();
    writeFileSync(join(folder, '2026-11-26-가짜-프로젝트-WEB-1A.md'), '내가 쓴 글');

    const result = await exportDiagnosisReport({ diagnosis: diagnosis(), folder, attachmentNames: [], attachmentsDir: folder });

    expect(readFileSync(join(folder, '2026-11-26-가짜-프로젝트-WEB-1A.md'), 'utf8')).toBe('내가 쓴 글');
    expect(result.fileName).toBe('2026-11-26-가짜-프로젝트-WEB-1A-2.md');
  });

  it('같은 이름의 폴더가 이미 있으면 그 이름을 건너뛰어 첨부가 섞이지 않는다', async () => {
    const folder = makeDir();
    mkdirSync(join(folder, '2026-11-26-가짜-프로젝트-WEB-1A'));
    const { dir, names } = makeAttachments('화면.png');

    const result = await exportDiagnosisReport({ diagnosis: diagnosis(), folder, attachmentNames: names, attachmentsDir: dir });

    expect(result.fileName).toBe('2026-11-26-가짜-프로젝트-WEB-1A-2.md');
    expect(readdirSync(join(folder, '2026-11-26-가짜-프로젝트-WEB-1A'))).toEqual([]);
    expect(readdirSync(join(folder, '2026-11-26-가짜-프로젝트-WEB-1A-2'))).toEqual(['화면.png']);
  });

  it('첨부가 있으면 보고서와 같은 이름의 폴더에 복사하고 상대 링크로 건다', async () => {
    const folder = makeDir();
    const { dir, names } = makeAttachments('화면 1.png', 'run.log');

    const result = await exportDiagnosisReport({ diagnosis: diagnosis(), folder, attachmentNames: names, attachmentsDir: dir });
    /** 쓴 마크다운. */
    const markdown = readFileSync(result.path, 'utf8');
    /** 첨부 폴더. */
    const attachmentFolder = join(folder, '2026-11-26-가짜-프로젝트-WEB-1A');

    expect(readdirSync(attachmentFolder).sort()).toEqual(['run.log', '화면 1.png']);
    expect(readFileSync(join(attachmentFolder, 'run.log'), 'utf8')).toBe('내용 run.log');
    // 이미지는 그림으로, 로그는 링크로 걸고 주소의 공백은 인코딩한다. 앱 데이터의 원본은 그대로다.
    expect(markdown).toContain('- ![화면 1.png](2026-11-26-%EA%B0%80%EC%A7%9C-%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8-WEB-1A/%ED%99%94%EB%A9%B4%201.png)');
    expect(markdown).toContain('- [run.log](');
    expect(existsSync(join(dir, 'run.log'))).toBe(true);
  });

  it('첨부가 없으면 첨부 폴더를 만들지 않는다', async () => {
    const folder = makeDir();

    await exportDiagnosisReport({ diagnosis: diagnosis(), folder, attachmentNames: [], attachmentsDir: makeDir() });

    expect(readdirSync(folder)).toEqual(['2026-11-26-가짜-프로젝트-WEB-1A.md']);
  });

  it('첨부를 복사하지 못하면 이번에 만든 파일과 폴더를 지우고 실패한다', async () => {
    const folder = makeDir();

    await expect(exportDiagnosisReport({ diagnosis: diagnosis(), folder, attachmentNames: ['없는 파일.png'], attachmentsDir: makeDir() })).rejects.toThrow();

    expect(readdirSync(folder)).toEqual([]);
  });

  it('보고서가 없는 진단은 내보내지 않는다', async () => {
    await expect(exportDiagnosisReport({ diagnosis: diagnosis({ report: null }), folder: makeDir(), attachmentNames: [], attachmentsDir: makeDir() })).rejects.toThrow('보고서가 없습니다');
  });
});

describe('보고서 마크다운', () => {
  /** 줄 머리의 `## ` 제목들. */
  const headings = (markdown: string) => [...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1]);

  it('제목 → 요약 → 재현 → 원인과 확신도 → 개선 방향 → 근거 → 남은 의문 → 오류 이슈 정보 → 실행 정보 순서다', () => {
    /** 쓴 마크다운. */
    const markdown = reportMarkdown(diagnosis(), report(), 'x', []);

    expect(markdown.startsWith('# 가짜 오류: 금액이 비었습니다\n')).toBe(true);
    expect(headings(markdown)).toEqual(['요약', '재현', '원인과 확신도', '개선 방향', '근거', '남은 의문', '오류 이슈 정보', '실행 정보']);
    expect(markdown).toContain('확신도: 중간');
    expect(markdown).toContain('[근거 1] 금액을 그대로 쓴다 — `web/src/pay.ts:10-12`');
    expect(markdown).toContain('- Sentry: https://org-a.sentry.io/issues/9001/');
    expect(markdown).toContain('- 에이전트: Claude Code 2.1.300');
  });

  it('오류 이슈 정보에 앞선 진단이 적힌다: 검토 대기 중이었으면 그 사실을, 완료한 뒤의 재발이면 완료한 날짜와 내보낸 파일 경로를(없으면 날짜만)', () => {
    /** 앞선 진단별 마크다운. */
    const of = (priorDiagnosis: DiagnosisReport['priorDiagnosis']) => reportMarkdown(diagnosis(), { ...report(), priorDiagnosis }, 'x', []);
    /** 2026-11-20 15:30(PC 시간대). */
    const completedAt = new Date(2026, 10, 20, 15, 30).getTime();

    expect(of(null)).not.toContain('앞선 진단');
    expect(of({ kind: 'in-review' })).toContain('- 앞선 진단: 검토 대기 중인 앞선 보고서가 있음');
    expect(of({ kind: 'completed', completedAt, exportPath: '/내보냄/old.md' })).toContain('- 앞선 진단: 앞서 진단함(2026-11-20)\n- 앞서 내보낸 파일: /내보냄/old.md');
    /** 파일이 없는 경우. */
    const dateOnly = of({ kind: 'completed', completedAt, exportPath: null });
    expect(dateOnly).toContain('- 앞선 진단: 앞서 진단함(2026-11-20)');
    expect(dateOnly).not.toContain('앞서 내보낸 파일');
  });

  it('"시도한 것"은 재현이 실패·불가일 때만 넣고, 성공이면 재현 순서만 넣는다', () => {
    /** 재현 결과별 마크다운. */
    const of = (reproduction: Partial<DiagnosisReport['reproduction']>) => reportMarkdown(diagnosis(), report(reproduction), 'x', []);

    expect(of({ result: 'failure' })).toContain('**시도한 것**\n\n- 결제 화면을 연다\n- 금액을 비운다');
    expect(of({ result: 'impossible', impossibleReason: 'no-tool' })).toContain('- 결과: 불가(도구 없음)');
    expect(of({ result: 'impossible', impossibleReason: 'no-tool' })).toContain('**시도한 것**');
    expect(of({ result: 'success' })).not.toContain('시도한 것');
    expect(of({ result: 'success' })).toContain('1. 결제 화면을 연다\n2. 금액을 비운다');
  });

  it('시도한 것이 없는 실패·불가는 빈 목록을 쓰지 않는다', () => {
    expect(reportMarkdown(diagnosis(), report({ result: 'impossible', impossibleReason: 'not-allowed', method: '', steps: [] }), 'x', [])).not.toContain('시도한 것');
  });

  it('위치를 찾지 못한 근거에는 그 사실을 적는다', () => {
    /** 위치를 못 찾은 근거만 있는 보고서. */
    const unlocated = { ...report(), evidence: [{ id: 2, explanation: '추정', repository: '/fake/web', path: 'x.ts', startLine: 3, endLine: 3, located: false }] };

    expect(reportMarkdown(diagnosis(), unlocated, 'x', [])).toContain('`web/x.ts:3` (위치를 찾을 수 없음)');
  });
});
