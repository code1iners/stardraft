import type { AgentId, ExecutorFailureReason, ExecutorUsage, RunKind } from '../ports/executor';

/** 에이전트가 이해한 요구. */
export interface DraftRequirement {
  /** 요구 한 문장. */
  text: string;
  /** 목록 행에 보일 짧은 요약. */
  summary: string;
}

/** 초안 문장 하나. */
export interface DraftSentence {
  /** 문장. */
  text: string;
  /** 이 문장을 뒷받침하는 근거 번호. 비어 있으면 근거 없는 문장이다. */
  evidence: number[];
}

/** 초안 문단 하나. */
export interface DraftParagraph {
  /** 문단의 문장. 나온 순서다. */
  sentences: DraftSentence[];
}

/** 근거 하나. 넘긴 저장소 안 한 파일의 연속된 줄 범위다. */
export interface DraftEvidence {
  /** 근거 번호. 초안 문장이 이 번호로 가리킨다. */
  id: number;
  /** 근거를 쉬운 말로 적은 설명. */
  explanation: string;
  /** 넘긴 저장소 가운데 하나(절대 경로). 에이전트가 적은 그대로이고, 넘긴 저장소인지는 출력 검증이 본다. */
  repository: string;
  /** 저장소 루트 기준 상대 경로. */
  path: string;
  /** 시작 줄. 1부터 센다. */
  startLine: number;
  /** 끝 줄. 이 줄까지 포함한다. */
  endLine: number;
  /**
   * 근거 위치를 찾았는지 여부. 거짓이면 화면에 "위치를 찾을 수 없음"으로 보이고 "에디터에서 열기"가 꺼진다.
   * 넘긴 저장소 안의 경로가 아니거나, 파일이 없거나, 줄 범위가 파일 길이를 넘으면 거짓이다.
   */
  located: boolean;
}

/** 자동 선택으로 초안의 저장소를 정한 내력. 저장소 영역에 자동으로 고른 이유로 보인다. */
export type AutoSelection =
  /** 작업 폴더에서 찾은 후보가 하나라 선택 실행 없이 그 저장소를 썼다. */
  | { kind: 'single-candidate' }
  /** 선택 실행이 골랐다. */
  | {
      kind: 'chosen';
      /** 선택 실행이 적은 이유. 에이전트가 비워 두었으면 빈 문자열이고 화면에는 "이유 없음"으로 보인다. */
      reason: string;
    };

/** 초안 실행이 만든 초안(원래 초안). 요구, 문단과 문장, 근거를 담는다. */
export interface Draft {
  /** 에이전트가 이해한 요구. */
  requirement: DraftRequirement;
  /** 초안 문단. */
  paragraphs: DraftParagraph[];
  /** 근거. 에이전트가 낸 순서다. */
  evidence: DraftEvidence[];
  /** 초안을 만들 때 읽기 범위로 넘긴 저장소(절대 경로). 첫 저장소가 실행의 cwd였다. */
  repositories: string[];
  /** 저장소를 자동 선택으로 정했으면 그 내력. 저장소 매핑으로 정했으면 `null`. 자동 선택 결과는 매핑으로 저장하지 않는다. */
  autoSelection: AutoSelection | null;
  /** 만든 시각(Unix epoch 밀리초). */
  createdAt: number;
}

/** 초안 실행 직전에 맥락을 조회하지 못한 사유. */
export type ContextFailureReason =
  /** Flow에서 멘션 묶음의 내용을 가져오지 못했다(연결 실패, 키 거부, 요청 한도, 서버 오류). */
  | 'flow-unavailable'
  /** Flow에서 원문을 찾지 못했다(지워짐, 볼 권한 없음, 머리 댓글 지워짐). */
  | 'source-gone';

/**
 * 묶음이 실패한 사유. 실행기가 알려 준 실패 이유(CLI 없음, 미로그인, 과부하 등)는 그대로 쓴다.
 * 맥락 조회 실패는 초안 실행 전에 일어난 것이고, `app-error`는 앱의 예외다.
 */
export type DraftFailureReason =
  /** 취소함. 사용자가 생성을 취소했다. */
  | 'cancelled'
  /** 시간 초과. 초안 실행이 10분 안에 끝나지 않았다. */
  | 'timed-out'
  /** 구조 실패. 다시 시도해도 구조화 출력이 없거나 앱이 읽을 수 없었다. */
  | 'invalid-output'
  /** 빈 초안. 초안 문장이 하나도 없었다. */
  | 'empty-draft'
  /** 비밀 파일을 근거로 듦. 근거 경로가 비밀 파일 패턴에 맞아 결과 전체를 버렸다. */
  | 'secret-evidence'
  /** 앱 안에서 예상하지 못한 오류가 났다. */
  | 'app-error'
  | ContextFailureReason
  | ExecutorFailureReason;

/** 묶음 하나를 만들 때 돌리는 실행의 종류. 선택 실행과 초안 실행이다. */
export type GenerationRunKind = Exclude<RunKind, 'check'>;

/** 묶음이 실패한 까닭. 실패 화면에 오류와 마지막 단계로 보인다. */
export interface DraftFailure {
  /** 사유. */
  reason: DraftFailureReason;
  /** 에이전트가 알려 준 오류 원문. 없으면 `null`. */
  detail: string | null;
  /** 실패할 때의 마지막 진행 단계. 실행을 시작하기 전이면 `null`. */
  lastStep: string | null;
  /** 실패한 실행의 종류. 실행을 시작하기 전에 실패했으면(맥락 조회 실패, 기다리는 중 취소 등) `null`. */
  runKind: GenerationRunKind | null;
}

/** 에이전트를 실행해서 생긴 실패 사유. 맥락을 조회하지 못한 실패는 실행 전에 일어나므로 들지 않는다. */
export type RunFailureReason = Exclude<DraftFailureReason, ContextFailureReason>;

/**
 * 실행 하나의 결과. 성공, 묶음이 바뀌어 멈춤, 또는 실패 사유다.
 * `bundle-changed`는 실행 중에 새 멘션이 합쳐졌거나 묶음이 처리됨이 되어 앱이 실행을 멈춘 것이다. 생성 중으로 남았으면 처음부터 다시 만든다.
 */
export type RunResult = 'succeeded' | 'bundle-changed' | RunFailureReason;

/**
 * 실행 기록. 에이전트를 한 번 실행할 때마다 남긴다. 화면에는 상세 머리의 실행 줄만 보이고 비용은 보이지 않는다.
 * 묶음의 전체 기록에 속해 묶음과 함께 지운다.
 */
export interface RunRecord {
  /** 실행의 종류. */
  kind: RunKind;
  /** 실행한 에이전트. */
  agent: AgentId;
  /** 실행에서 본 CLI 버전. 모르면 `null`. */
  cliVersion: string | null;
  /** 에이전트가 쓴 모델. 모르면 고른 모델이고, 기본 모델을 골랐으면 `null`일 수 있다. */
  model: string | null;
  /** 시작 시각(Unix epoch 밀리초). */
  startedAt: number;
  /** 끝난 시각(Unix epoch 밀리초). */
  finishedAt: number;
  /** 결과. */
  result: RunResult;
  /** 에이전트가 알려 준 오류 원문. 없으면 `null`. */
  detail: string | null;
  /** 마지막 진행 단계. */
  lastStep: string | null;
  /** 앱이 고친 내용 불일치. 화면에는 알리지 않는다. */
  fixes: string[];
  /** 맥락에서 길이 상한 때문에 뺀 항목 수. */
  omittedContextItems: number;
  /** 에이전트가 알려 준 비용과 토큰 수. 알려 주지 않았으면 `null`. */
  usage: ExecutorUsage | null;
}

/** 에이전트가 낸 근거. 위치를 확인하기 전이다. */
export type AgentEvidence = Omit<DraftEvidence, 'located'>;

/** 초안 실행의 구조화 출력을 앱이 읽은 것. 근거의 줄 번호 이름만 바꿨고, 내용 불일치와 근거 위치는 아직 보지 않았다. */
export interface DraftOutput extends Pick<Draft, 'requirement' | 'paragraphs'> {
  /** 근거. 에이전트가 낸 순서다. */
  evidence: AgentEvidence[];
}

/**
 * 초안 실행의 출력 스키마. `--json-schema`로 강제한다.
 * Codex의 `--output-schema`에도 쓸 수 있게 모든 속성을 `required`로 두고 다른 속성을 받지 않는다.
 * 근거의 `repository`는 문자열이면 받는다. 넘긴 저장소가 아닌 값은 구조 실패로 돌리지 않고 출력 검증이 위치를 찾을 수 없는 근거로 다룬다.
 */
export function draftOutputSchema(): Record<string, unknown> {
  return objectSchema({
    requirement: objectSchema({ text: { type: 'string' }, summary: { type: 'string' } }),
    paragraphs: {
      type: 'array',
      items: objectSchema({
        sentences: {
          type: 'array',
          items: objectSchema({ text: { type: 'string' }, evidence: { type: 'array', items: { type: 'integer' } } }),
        },
      }),
    },
    evidence: {
      type: 'array',
      items: objectSchema({
        id: { type: 'integer' },
        explanation: { type: 'string' },
        repository: { type: 'string' },
        path: { type: 'string' },
        start_line: { type: 'integer' },
        end_line: { type: 'integer' },
      }),
    },
  });
}

/** 모든 속성이 `required`이고 다른 속성을 받지 않는 객체 스키마. 선택 실행의 출력 스키마도 같은 모양을 쓴다. */
export function objectSchema(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/**
 * 초안 실행의 구조화 출력을 읽는다. 스키마 모양이 아니면 `null`(구조 실패)이다.
 * 앞뒤 공백을 떼고, 비어 있는 문장과 문장이 없는 문단은 뺀다. 내용끼리 맞는지(없는 근거 번호 등)는 보지 않는다.
 */
export function readDraftOutput(output: unknown): DraftOutput | null {
  /** 출력의 최상위 값. */
  const root = asRecord(output);
  /** 요구. */
  const requirement = asRecord(root?.requirement);
  if (!root || !requirement || typeof requirement.text !== 'string' || typeof requirement.summary !== 'string') return null;
  if (!Array.isArray(root.paragraphs) || !Array.isArray(root.evidence)) return null;

  /** 읽은 문단. */
  const paragraphs: DraftParagraph[] = [];
  for (const item of root.paragraphs) {
    /** 문단의 문장 목록. */
    const sentences = asRecord(item)?.sentences;
    if (!Array.isArray(sentences)) return null;
    /** 읽은 문장. */
    const read: DraftSentence[] = [];
    for (const sentence of sentences) {
      /** 문장 하나. */
      const fields = asRecord(sentence);
      if (!fields || typeof fields.text !== 'string' || !isIntegerArray(fields.evidence)) return null;
      if (fields.text.trim() !== '') read.push({ text: fields.text.trim(), evidence: [...fields.evidence] });
    }
    if (read.length > 0) paragraphs.push({ sentences: read });
  }

  /** 읽은 근거. */
  const evidence: AgentEvidence[] = [];
  for (const item of root.evidence) {
    /** 근거 하나. */
    const fields = asRecord(item);
    if (
      !fields ||
      !Number.isInteger(fields.id) ||
      typeof fields.explanation !== 'string' ||
      typeof fields.repository !== 'string' ||
      typeof fields.path !== 'string' ||
      !Number.isInteger(fields.start_line) ||
      !Number.isInteger(fields.end_line)
    ) {
      return null;
    }
    evidence.push({
      id: fields.id as number,
      explanation: fields.explanation.trim(),
      repository: fields.repository,
      path: fields.path,
      startLine: fields.start_line as number,
      endLine: fields.end_line as number,
    });
  }

  return { requirement: { text: requirement.text.trim(), summary: requirement.summary.trim() }, paragraphs, evidence };
}

/** 초안의 문장 수. */
export function sentenceCount(output: Pick<Draft, 'paragraphs'>): number {
  return output.paragraphs.reduce((sum, paragraph) => sum + paragraph.sentences.length, 0);
}

/** 객체면 필드를 읽을 수 있게, 아니면 `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** 정수만 든 배열인지 본다. */
function isIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => Number.isInteger(item));
}
