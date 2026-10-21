import { readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path';
import { matchesSecretPattern } from '../agent/secret-patterns';
import type { AgentEvidence, Draft, DraftEvidence, DraftOutput, DraftParagraph } from './draft';

/** 출력 검증에 필요한 것. */
export interface DraftCheckOptions {
  /** 읽기 범위로 넘긴 저장소(절대 경로). 근거의 `repository`는 이 가운데 하나여야 한다. */
  repositories: readonly string[];
  /** 비밀 파일 패턴 전부(기본 목록과 추가 패턴). 근거 경로가 하나라도 맞으면 결과 전체를 버린다. */
  secretPatterns: readonly string[];
  /** 사용자가 고친 요구. 요구를 고쳐 재생성한 실행이면 에이전트가 낸 요구를 이것으로 덮어쓴다. 아니면 `null`. */
  fixedRequirement: string | null;
}

/** 출력 검증을 마친 초안. 근거마다 위치를 찾았는지가 붙는다. */
export type CheckedDraftOutput = Pick<Draft, 'requirement' | 'paragraphs' | 'evidence'>;

/**
 * 출력 검증의 결과. `fixes`는 앱이 고친 내용 불일치와 위치를 찾지 못한 근거로, 실행 기록에만 남긴다.
 * `secret-evidence`면 결과 전체를 버리고 묶음을 "비밀 파일을 근거로 듦" 실패로 둔다.
 */
export type DraftCheck =
  /** 고친 초안. */
  | { kind: 'draft'; output: CheckedDraftOutput; fixes: string[] }
  /** 근거 경로가 비밀 파일 패턴에 맞았다. */
  | { kind: 'secret-evidence'; fixes: string[] };

/**
 * 스키마 모양을 통과한 초안 실행의 출력을 검증한다. 비밀 파일 근거 → 내용 불일치 → 근거 위치 순서다.
 * 내용 불일치는 실패로 돌리지 않고 근거가 줄어드는 쪽으로 고친다. 위치를 찾지 못한 근거는 지우지 않고 표시만 하며, 문장의 번호는 그대로 둔다.
 * 근거 설명이 실제 코드와 맞는지는 보지 않는다(사람의 몫). 문장이 0개인 초안("빈 초안")은 이 검증 전에 걸러진다.
 */
export async function checkDraftOutput(output: DraftOutput, options: DraftCheckOptions): Promise<DraftCheck> {
  /** 비밀 파일 패턴에 맞는 근거. */
  const secret = await firstSecretEvidence(output.evidence, options);
  if (secret) return { kind: 'secret-evidence', fixes: [`비밀 파일 패턴에 맞는 근거: ${secret.id}번(${secret.path})`] };

  /** 고친 내용 불일치. */
  const fixes: string[] = [];
  /** 요구. 사용자가 고친 요구가 있으면 그것으로 덮어쓰고 요약은 에이전트가 새로 만든 것을 쓴다. */
  const requirement = { ...output.requirement };
  if (options.fixedRequirement !== null && requirement.text !== options.fixedRequirement) {
    requirement.text = options.fixedRequirement;
    fixes.push('에이전트가 낸 요구를 사용자가 고친 요구로 덮어씀');
  }
  /** 번호를 다시 매긴 문단과 근거. */
  const numbered = renumber(output, fixes);

  /** 위치를 확인한 근거. */
  const evidence: DraftEvidence[] = [];
  for (const item of numbered.evidence) {
    /** 위치를 찾지 못한 까닭. 찾았으면 `null`. */
    const problem = await locationProblem(item, options.repositories);
    if (problem) fixes.push(`위치를 찾을 수 없는 근거: ${item.id}번(${problem})`);
    evidence.push({ ...item, located: problem === null });
  }
  return { kind: 'draft', output: { requirement, paragraphs: numbered.paragraphs, evidence }, fixes };
}

/**
 * 문장의 근거 번호와 근거 목록을 맞춘다.
 * - 없는 근거 번호와 한 문장 안에서 거듭 나온 번호는 지운다. 남은 번호가 없는 문장은 근거 없음이다.
 * - 같은 번호의 근거가 여럿이면 처음 것만 그 번호로 가리킬 수 있다. 나머지는 참조 없는 근거다.
 * - 문장에 나온 순서대로 1부터 다시 매기고, 어느 문장도 참조하지 않는 근거는 원래 순서대로 목록 끝에 둔다.
 */
function renumber(output: DraftOutput, fixes: string[]): { paragraphs: DraftParagraph[]; evidence: AgentEvidence[] } {
  /** 에이전트가 낸 번호마다 그 번호로 처음 나온 근거. */
  const byId = new Map<number, AgentEvidence>();
  for (const item of output.evidence) {
    if (byId.has(item.id)) fixes.push(`겹친 근거 번호: ${item.id}번이 여러 근거에 붙음`);
    else byId.set(item.id, item);
  }

  /** 에이전트가 낸 번호 → 새 번호. 문장에 처음 나온 순서다. */
  const newIds = new Map<number, number>();
  /** 번호를 바꾼 문단. */
  const paragraphs = output.paragraphs.map((paragraph, paragraphIndex) => ({
    sentences: paragraph.sentences.map((sentence, sentenceIndex) => {
      /** 이 문장에 남긴 새 번호. */
      const ids: number[] = [];
      for (const id of sentence.evidence) {
        if (!byId.has(id)) {
          fixes.push(`없는 근거 번호를 지움: ${id}번(${paragraphIndex + 1}문단 ${sentenceIndex + 1}번째 문장)`);
          continue;
        }
        if (!newIds.has(id)) newIds.set(id, newIds.size + 1);
        /** 이 번호가 가리키는 근거의 새 번호. */
        const newId = newIds.get(id) as number;
        if (ids.includes(newId)) fixes.push(`한 문장에 거듭 나온 근거 번호를 지움: ${id}번(${paragraphIndex + 1}문단 ${sentenceIndex + 1}번째 문장)`);
        else ids.push(newId);
      }
      return { text: sentence.text, evidence: ids };
    }),
  }));

  /** 참조된 근거(새 번호 순)와 참조 없는 근거(원래 순서). */
  const referenced = [...newIds.entries()].map(([id, newId]) => ({ ...(byId.get(id) as AgentEvidence), id: newId }));
  /** 어느 문장도 가리키지 않는 근거. 목록 끝에서 이어 매긴다. */
  const unreferenced = output.evidence.filter((item) => !newIds.has(item.id) || byId.get(item.id) !== item);
  for (const item of unreferenced) fixes.push(`어느 문장도 참조하지 않는 근거를 목록 끝에 둠: 원래 ${item.id}번`);
  /** 새 번호를 매긴 근거. */
  const evidence = [...referenced, ...unreferenced.map((item, index) => ({ ...item, id: referenced.length + index + 1 }))];

  /** 번호가 바뀐 근거의 "원래→새" 표기. 참조 없는 근거는 앞의 기록에 원래 번호가 있다. */
  const changed = [...newIds.entries()].filter(([id, newId]) => id !== newId).map(([id, newId]) => `${id}→${newId}`);
  if (changed.length > 0) fixes.push(`근거 번호를 나온 순서대로 다시 매김: ${changed.join(', ')}`);
  return { paragraphs, evidence };
}

/**
 * 근거 경로가 비밀 파일 패턴에 맞는 첫 근거. 없으면 `null`.
 * 에이전트가 적은 경로와, 저장소 안에서 실제로 가리키는 파일(심볼릭 링크를 푼 경로)을 모두 본다. 저장소나 파일이 맞지 않아도 경로만으로 본다.
 */
async function firstSecretEvidence(evidence: readonly AgentEvidence[], options: DraftCheckOptions): Promise<AgentEvidence | null> {
  for (const item of evidence) {
    if (matchesSecretPattern(normalizedPath(item.path), options.secretPatterns)) return item;
    /** 저장소 안에서 실제로 가리키는 파일의 저장소 기준 경로. 찾지 못하면 `null`. */
    const real = await realPathInRepository(item, options.repositories);
    if (real !== null && matchesSecretPattern(real, options.secretPatterns)) return item;
  }
  return null;
}

/** 근거 위치를 찾지 못한 까닭. 넘긴 저장소 안의 파일이고 줄 범위가 파일 길이 안이면 `null`이다. */
async function locationProblem(item: AgentEvidence, repositories: readonly string[]): Promise<string | null> {
  if (!passedRepository(item.repository, repositories)) return '넘기지 않은 저장소';
  if (!isRelativeInside(item.path)) return '저장소 밖 경로';
  /** 심볼릭 링크를 푼 파일의 저장소 기준 경로. */
  const real = await realPathInRepository(item, repositories);
  if (real === null) return '파일 없음 또는 저장소 밖을 가리킴';
  /** 줄 수. 파일이 아니면 `null`. */
  const lines = await lineCount(join(await realpath(item.repository), real));
  if (lines === null) return '파일 없음 또는 저장소 밖을 가리킴';
  if (item.startLine < 1 || item.endLine < item.startLine || item.endLine > lines) return `줄 범위가 파일 길이(${lines}줄)를 넘음`;
  return null;
}

/** 근거의 저장소가 넘긴 저장소 가운데 하나인지 본다. 끝의 경로 구분자 같은 표기 차이는 무시한다. */
function passedRepository(repository: string, repositories: readonly string[]): boolean {
  return isAbsolute(repository) && repositories.some((passed) => resolve(passed) === resolve(repository));
}

/** 저장소 기준 상대 경로이고 `..`로 위로 올라가지 않는지 본다. 절대 경로(드라이브 문자, UNC 포함)는 받지 않는다. */
function isRelativeInside(path: string): boolean {
  if (path.trim() === '' || posix.isAbsolute(path) || win32.isAbsolute(path)) return false;
  return !path.split(/[\\/]/).includes('..');
}

/**
 * 근거가 저장소 안에서 실제로 가리키는 파일의 저장소 기준 경로(`/` 구분). 심볼릭 링크를 모두 푼다.
 * 넘긴 저장소가 아니거나, 상대 경로가 아니거나, 파일이 없거나, 푼 경로가 저장소 밖이면 `null`.
 */
async function realPathInRepository(item: AgentEvidence, repositories: readonly string[]): Promise<string | null> {
  if (!passedRepository(item.repository, repositories) || !isRelativeInside(item.path)) return null;
  try {
    /** 저장소 루트의 실제 경로. */
    const root = await realpath(item.repository);
    /** 근거 파일의 실제 경로. */
    const file = await realpath(join(item.repository, item.path));
    /** 루트 기준 경로. */
    const inside = relative(root, file);
    if (inside === '' || isAbsolute(inside) || inside.split(sep).includes('..')) return null;
    return inside.split(sep).join('/');
  } catch {
    return null;
  }
}

/** 파일의 줄 수. 마지막 줄 끝의 줄바꿈은 줄로 세지 않는다. 일반 파일이 아니거나 읽지 못하면 `null`. */
async function lineCount(path: string): Promise<number | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    /** 파일 내용. */
    const content = await readFile(path);
    if (content.length === 0) return 0;
    /** 줄바꿈 수. */
    let newlines = 0;
    for (const byte of content) if (byte === 0x0a) newlines += 1;
    return content.at(-1) === 0x0a ? newlines : newlines + 1;
  } catch {
    return null;
  }
}

/** 비밀 파일 패턴과 맞춰 볼 경로. 구분자를 `/`로 바꾸고 앞의 `./`와 `/`를 뗀다. */
function normalizedPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^(?:\.?\/)+/, '');
}
