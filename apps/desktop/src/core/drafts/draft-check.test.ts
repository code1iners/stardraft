import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SECRET_PATTERNS } from '../agent/secret-patterns';
import type { AgentEvidence, DraftOutput, DraftSentence } from './draft';
import { checkDraftOutput } from './draft-check';

/** 테스트마다 만드는 임시 폴더. 가짜 저장소와 저장소 밖 파일을 둔다. */
let workDir: string;
/** 넘긴 가짜 저장소 둘. */
let repos: { a: string; b: string };

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'stardraft-check-'));
  repos = { a: join(workDir, 'repo-a'), b: join(workDir, 'repo-b') };
  // 줄 수가 정해진 가짜 소스 파일. 마지막 줄 끝의 줄바꿈은 줄로 세지 않는다.
  writeLines(join(repos.a, 'src/retry.ts'), 10);
  writeLines(join(repos.a, 'src/config.ts'), 3);
  writeLines(join(repos.b, 'docs/retry.md'), 5);
  writeLines(join(workDir, 'outside.ts'), 20);
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/** `lines`줄짜리 파일을 만든다. 폴더가 없으면 만든다. */
function writeLines(path: string, lines: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Array.from({ length: lines }, (_, index) => `line ${index + 1}`).join('\n') + '\n');
}

/** 저장소 A의 `src/retry.ts` 1–2번째 줄을 가리키는 근거. 다른 값은 `overrides`로 바꾼다. */
function evidence(id: number, overrides: Partial<AgentEvidence> = {}): AgentEvidence {
  return { id, explanation: `설명 ${id}`, repository: repos.a, path: 'src/retry.ts', startLine: 1, endLine: 2, ...overrides };
}

/** 문장마다 근거 번호를 붙인 한 문단짜리 초안 출력. */
function output(citations: number[][], items: AgentEvidence[]): DraftOutput {
  return {
    requirement: { text: '재시도 횟수를 알고 싶다.', summary: '재시도 횟수' },
    paragraphs: [{ sentences: citations.map((ids, index): DraftSentence => ({ text: `문장 ${index + 1}`, evidence: ids })) }],
    evidence: items,
  };
}

/** 기본 검사 조건. 저장소 둘을 넘겼고, 비밀 파일 패턴은 기본 목록이며, 요구를 고치지 않았다. */
function options(overrides: Partial<Parameters<typeof checkDraftOutput>[1]> = {}): Parameters<typeof checkDraftOutput>[1] {
  return { repositories: [repos.a, repos.b], secretPatterns: DEFAULT_SECRET_PATTERNS, fixedRequirement: null, ...overrides };
}

/** 검사를 통과한 초안 출력. 비밀 파일 근거로 버려졌으면 테스트가 실패한다. */
async function checked(draft: DraftOutput, checkOptions = options()) {
  /** 검사 결과. */
  const result = await checkDraftOutput(draft, checkOptions);
  if (result.kind !== 'draft') throw new Error(`초안이 버려졌습니다: ${result.kind}`);
  return result;
}

/** 문장마다의 근거 번호. */
function citationsOf(draft: Pick<DraftOutput, 'paragraphs'>): number[][] {
  return draft.paragraphs.flatMap((paragraph) => paragraph.sentences.map((sentence) => sentence.evidence));
}

describe('출력 검증: 내용 불일치', () => {
  it('없는 근거 번호를 참조하면 그 번호를 지우고, 남은 번호가 없는 문장은 근거 없음이 된다', async () => {
    const result = await checked(output([[1, 7], [9]], [evidence(1)]));

    expect(citationsOf(result.output)).toEqual([[1], []]);
    expect(result.output.evidence.map((item) => item.id)).toEqual([1]);
    expect(result.fixes).toEqual(['없는 근거 번호를 지움: 7번(1문단 1번째 문장)', '없는 근거 번호를 지움: 9번(1문단 2번째 문장)']);
  });

  it('어느 문장도 참조하지 않는 근거는 지우지 않고 목록 끝에 남기며, 번호는 문장에 나온 순서대로 다시 매긴다', async () => {
    const result = await checked(output([[2]], [evidence(1), evidence(2)]));

    expect(citationsOf(result.output)).toEqual([[1]]);
    expect(result.output.evidence.map(({ id, explanation }) => [id, explanation])).toEqual([
      [1, '설명 2'],
      [2, '설명 1'],
    ]);
    expect(result.fixes).toEqual(['어느 문장도 참조하지 않는 근거를 목록 끝에 둠: 원래 1번', '근거 번호를 나온 순서대로 다시 매김: 2→1']);
  });

  it('근거 번호가 겹치거나 건너뛰면 나온 순서대로 1부터 다시 매긴다. 같은 번호의 근거가 여럿이면 처음 것만 그 번호로 가리키고, 한 문장의 거듭 나온 번호는 하나로 줄인다', async () => {
    const result = await checked(output([[3], [5, 3, 3]], [evidence(3), evidence(5), evidence(3, { explanation: '겹친 번호의 둘째 근거' })]));

    expect(citationsOf(result.output)).toEqual([[1], [2, 1]]);
    expect(result.output.evidence.map(({ id, explanation }) => [id, explanation])).toEqual([
      [1, '설명 3'],
      [2, '설명 5'],
      [3, '겹친 번호의 둘째 근거'],
    ]);
    expect(result.fixes).toEqual([
      '겹친 근거 번호: 3번이 여러 근거에 붙음',
      '한 문장에 거듭 나온 근거 번호를 지움: 3번(1문단 2번째 문장)',
      '어느 문장도 참조하지 않는 근거를 목록 끝에 둠: 원래 3번',
      '근거 번호를 나온 순서대로 다시 매김: 3→1, 5→2',
    ]);
  });

  it('번호가 이미 1부터 나온 순서대로이고 모든 근거를 참조하면 고친 것이 없다', async () => {
    const result = await checked(output([[1], [], [1, 2]], [evidence(1), evidence(2, { repository: repos.b, path: 'docs/retry.md' })]));

    expect(citationsOf(result.output)).toEqual([[1], [], [1, 2]]);
    expect(result.output.evidence.every((item) => item.located)).toBe(true);
    expect(result.fixes).toEqual([]);
  });

  it('요구를 고쳐 재생성한 실행에서 에이전트가 다른 요구를 내면 사용자가 고친 요구로 덮어쓰고, 요약은 에이전트가 새로 만든 것을 쓴다', async () => {
    const changed = await checked(output([[1]], [evidence(1)]), options({ fixedRequirement: '운영 환경의 재시도 횟수만 알고 싶다.' }));
    const same = await checked(output([[1]], [evidence(1)]), options({ fixedRequirement: '재시도 횟수를 알고 싶다.' }));

    expect(changed.output.requirement).toEqual({ text: '운영 환경의 재시도 횟수만 알고 싶다.', summary: '재시도 횟수' });
    expect(changed.fixes).toEqual(['에이전트가 낸 요구를 사용자가 고친 요구로 덮어씀']);
    expect(same.fixes).toEqual([]);
  });

  it('근거의 저장소가 넘긴 저장소가 아니면 위치를 찾을 수 없는 근거로 두고, 그 근거를 단 문장의 번호는 그대로 둔다', async () => {
    // 저장소 밖(넘기지 않은 상위 폴더)에 실제로 있는 파일이어도 위치를 찾을 수 없는 근거다.
    const result = await checked(output([[1, 2]], [evidence(1, { repository: workDir, path: 'outside.ts' }), evidence(2, { repository: 'repo-a' })]));

    expect(citationsOf(result.output)).toEqual([[1, 2]]);
    expect(result.output.evidence.map((item) => item.located)).toEqual([false, false]);
    expect(result.fixes).toEqual(['위치를 찾을 수 없는 근거: 1번(넘기지 않은 저장소)', '위치를 찾을 수 없는 근거: 2번(넘기지 않은 저장소)']);
  });

  it('끝 경로 구분자 같은 표기 차이만 있는 저장소는 넘긴 저장소로 본다', async () => {
    const result = await checked(output([[1]], [evidence(1, { repository: `${repos.a}/` })]));

    expect(result.output.evidence[0]?.located).toBe(true);
  });
});

describe('출력 검증: 근거 위치', () => {
  it('저장소 안 경로가 아니면(.., 절대 경로, 저장소 밖을 가리키는 심볼릭 링크) 위치를 찾을 수 없음이 되고 번호는 그대로다', async () => {
    symlinkSync(join(workDir, 'outside.ts'), join(repos.a, 'src/outside-link.ts'));
    symlinkSync(workDir, join(repos.a, 'parent-link'));

    const result = await checked(
      output(
        [[1], [2], [3], [4], [5]],
        [
          evidence(1, { path: '../outside.ts' }),
          evidence(2, { path: 'src/../../outside.ts' }),
          evidence(3, { path: join(workDir, 'outside.ts') }),
          evidence(4, { path: 'src/outside-link.ts' }),
          evidence(5, { path: 'parent-link/outside.ts' }),
        ],
      ),
    );

    expect(citationsOf(result.output)).toEqual([[1], [2], [3], [4], [5]]);
    expect(result.output.evidence.map((item) => item.located)).toEqual([false, false, false, false, false]);
    expect(result.fixes).toEqual([
      '위치를 찾을 수 없는 근거: 1번(저장소 밖 경로)',
      '위치를 찾을 수 없는 근거: 2번(저장소 밖 경로)',
      '위치를 찾을 수 없는 근거: 3번(저장소 밖 경로)',
      '위치를 찾을 수 없는 근거: 4번(파일 없음 또는 저장소 밖을 가리킴)',
      '위치를 찾을 수 없는 근거: 5번(파일 없음 또는 저장소 밖을 가리킴)',
    ]);
  });

  it('Windows 절대 경로(드라이브 문자, UNC)도 저장소 밖 경로다', async () => {
    const result = await checked(output([[1, 2]], [evidence(1, { path: 'C:\\repo\\src\\retry.ts' }), evidence(2, { path: '\\\\server\\share\\retry.ts' })]));

    expect(result.output.evidence.map((item) => item.located)).toEqual([false, false]);
  });

  it('저장소 안의 파일을 가리키는 심볼릭 링크와 ./로 시작하는 경로는 위치를 찾은 근거다', async () => {
    symlinkSync(join(repos.a, 'src/retry.ts'), join(repos.a, 'src/retry-link.ts'));

    const result = await checked(output([[1, 2]], [evidence(1, { path: 'src/retry-link.ts' }), evidence(2, { path: './src/config.ts' })]));

    expect(result.output.evidence.map((item) => item.located)).toEqual([true, true]);
    expect(result.fixes).toEqual([]);
  });

  it('파일이 없거나 파일이 아니면(폴더) 위치를 찾을 수 없음이 된다', async () => {
    const result = await checked(output([[1, 2]], [evidence(1, { path: 'src/missing.ts' }), evidence(2, { path: 'src' })]));

    expect(result.output.evidence.map((item) => item.located)).toEqual([false, false]);
    expect(result.fixes).toEqual(['위치를 찾을 수 없는 근거: 1번(파일 없음 또는 저장소 밖을 가리킴)', '위치를 찾을 수 없는 근거: 2번(파일 없음 또는 저장소 밖을 가리킴)']);
  });

  it('줄 범위가 파일 길이를 넘거나 1보다 작거나 거꾸로면 위치를 찾을 수 없음이 되고, 마지막 줄까지는 찾은 근거다', async () => {
    const result = await checked(
      output(
        [[1, 2, 3, 4, 5]],
        [
          evidence(1, { startLine: 10, endLine: 10 }),
          evidence(2, { startLine: 9, endLine: 11 }),
          evidence(3, { startLine: 0, endLine: 1 }),
          evidence(4, { startLine: 3, endLine: 2 }),
          evidence(5, { repository: repos.b, path: 'docs/retry.md', startLine: 1, endLine: 5 }),
        ],
      ),
    );

    expect(result.output.evidence.map((item) => item.located)).toEqual([true, false, false, false, true]);
    expect(result.fixes).toEqual([
      '위치를 찾을 수 없는 근거: 2번(줄 범위가 파일 길이(10줄)를 넘음)',
      '위치를 찾을 수 없는 근거: 3번(줄 범위가 파일 길이(10줄)를 넘음)',
      '위치를 찾을 수 없는 근거: 4번(줄 범위가 파일 길이(10줄)를 넘음)',
    ]);
  });

  it('마지막 줄 끝에 줄바꿈이 없는 파일도 마지막 줄까지 센다', async () => {
    writeFileSync(join(repos.a, 'src/no-newline.ts'), 'a\nb\nc');

    const result = await checked(output([[1, 2]], [evidence(1, { path: 'src/no-newline.ts', startLine: 3, endLine: 3 }), evidence(2, { path: 'src/no-newline.ts', startLine: 4, endLine: 4 })]));

    expect(result.output.evidence.map((item) => item.located)).toEqual([true, false]);
  });
});

describe('출력 검증: 비밀 파일 근거', () => {
  it.each([
    '.env',
    'config/.env.example',
    'deploy/server.pem',
    'deploy/tls.key',
    'android/release.keystore',
    'home/id_rsa.pub',
    '.npmrc',
    'secrets/db/password.txt',
    '.git/config',
    'config\\.env.local',
    './.ENV',
    '../other-repo/.env',
  ])('근거 경로 %s는 비밀 파일 패턴(기본 목록)에 맞아 결과 전체를 버린다', async (path) => {
    const result = await checkDraftOutput(output([[1], [2]], [evidence(1), evidence(2, { path })]), options());

    expect(result).toEqual({ kind: 'secret-evidence', fixes: [`비밀 파일 패턴에 맞는 근거: 2번(${path})`] });
  });

  it('넘기지 않은 저장소의 근거나 참조 없는 근거여도 경로가 비밀 파일이면 결과 전체를 버린다', async () => {
    const result = await checkDraftOutput(output([[1]], [evidence(1), evidence(2, { repository: join(workDir, 'repo-c'), path: 'id_ed25519' })]), options());

    expect(result.kind).toBe('secret-evidence');
  });

  it('저장소 안의 비밀 파일을 가리키는 심볼릭 링크를 근거로 들어도 결과 전체를 버린다', async () => {
    writeLines(join(repos.a, '.env'), 2);
    symlinkSync(join(repos.a, '.env'), join(repos.a, 'src/settings.ts'));

    const result = await checkDraftOutput(output([[1]], [evidence(1, { path: 'src/settings.ts', startLine: 1, endLine: 1 })]), options());

    expect(result).toEqual({ kind: 'secret-evidence', fixes: ['비밀 파일 패턴에 맞는 근거: 1번(src/settings.ts)'] });
  });

  it('사용자가 추가한 패턴도 적용한다', async () => {
    const result = await checkDraftOutput(
      output([[1]], [evidence(1, { path: 'config/db.secret.yml' })]),
      options({ secretPatterns: [...DEFAULT_SECRET_PATTERNS, '*.secret.yml'] }),
    );

    expect(result.kind).toBe('secret-evidence');
  });

  it.each(['src/main/resources/application-prod.yml', 'src/environment.ts', '.envrc', 'src/keystore.ts', 'docs/secrets.md'])(
    '근거 경로 %s는 비밀 파일이 아니다',
    async (path) => {
      const result = await checkDraftOutput(output([[1]], [evidence(1, { path })]), options());

      expect(result.kind).toBe('draft');
    },
  );
});
