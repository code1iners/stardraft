import { withDefaultSecretPatterns } from '../agent/secret-patterns';
import { FETCHING_CONTEXT_STEP, WRITING_DRAFT_STEP } from '../agent/progress-steps';
import { activeMentions, mentionSetKey, type MentionBundle, type RepoCheck } from '../bundles/mention-bundle';
import type { MentionBundles, RunPreparation } from '../bundles/mention-bundles';
import { contextDocument, omittedItemCount } from '../flow/bundle-context';
import type { RunRecord } from '../generation/generation-run';
import type { Preparation, PrepareContext, RunReading, TargetAdapter, TargetFailure, TargetRun } from '../generation/target-adapter';
import type { Clock } from '../ports/clock';
import type { SettingsStore } from '../ports/settings-store';
import { draftOutputSchema, readDraftOutput, sentenceCount, type ContextFailureReason, type Draft, type DraftOutput } from './draft';
import { checkDraftOutput } from './draft-check';
import { draftInputDocument, draftInstructions, type RegenerationInput, type RunDataSource } from './draft-input';

/** Flow 멘션 묶음의 대상 종류. 생성 대기열 표에 남는 값이다. */
export const FLOW_TARGET_KIND = 'flow';

/** 초안 실행의 제한 시간(밀리초). 넘기면 프로세스 트리를 끝내고 "시간 초과"로 실패한다. 설정에서 바꿀 수 없다. */
export const DRAFT_TIMEOUT_MS = 10 * 60 * 1000;
/** Flow에 닿지 못해(네트워크 오류) 멈춘 Flow 어댑터가 다시 조회하기까지 기다리는 시간(밀리초). 폴링이 다음 주기에 다시 조회하는 것과 같다. */
const FLOW_RETRY_DELAY_MS = 60_000;
/** 요청 한도에 걸려 멈춘 Flow 어댑터가 기다리는 가장 짧은 시간(밀리초). Flow가 알려 준 시간이 이보다 짧아도 이만큼은 기다린다. */
const MIN_FLOW_RETRY_DELAY_MS = 1_000;

/**
 * Flow 어댑터의 타입 묶음. 시작 표식은 생성을 시작할 때 묶음에 든 멘션 위치(`mentionSetKey`)다.
 * 결과는 초안, 저장소 대기는 저장소 확인 필요의 까닭, 실행 전 실패는 맥락 조회 실패다.
 */
export interface FlowTargetTypes {
  /** 생성을 시작할 때 묶음에 든 멘션 위치. */
  job: string;
  /** 저장할 초안. */
  result: Draft;
  /** 저장소 확인 필요의 까닭. */
  repoWait: RepoCheck;
  /** 맥락 조회 실패. */
  failureReason: ContextFailureReason;
}

/** Flow 어댑터에 필요한 것. */
export interface FlowTargetAdapterOptions {
  /** 생성 중 묶음을 찾고 실행 결과를 맡길 멘션 묶음. 실행 직전의 저장소 매핑 확인도 맡는다. */
  bundles: MentionBundles;
  /** Flow에 쓸 키가 있는지 본다. 키가 없거나 "키 확인 필요"면 거짓이고, Flow 묶음은 키를 쓸 수 있게 될 때까지 기다린다. */
  flowKeyUsable: () => boolean;
  /** Flow 키를 쓸 수 있는지가 바뀔 수 있을 때마다(계정, "키 확인 필요") `listener`를 부르게 한다. 돌려준 함수를 부르면 그만 부른다. */
  onFlowKeyChange: (listener: () => void) => () => void;
  /** 추가 지침과 추가 비밀 파일 패턴을 읽는 설정 저장소. 실행마다 새로 읽어 다음 실행부터 바뀐 값을 쓴다. */
  settingsStore: SettingsStore;
  /** 답변 명의자인 내 이름. 모르면 `null`. */
  myName: () => string | null;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: (projectId: string) => Promise<string | null>;
  /** 초안을 만든 시각을 읽는 시계. */
  clock: Clock;
}

/** 묶음 하나를 만드는 생성 한 번의 입력. 맥락 문서는 한 번 만들어 초안 실행에 넘긴다. */
interface FlowGenerationInput {
  /** 입력 문서의 데이터 구획에 넣을 Flow 내용. */
  data: RunDataSource;
  /** 맥락에서 길이 상한 때문에 뺀 항목 수. 실행 기록에 남긴다. */
  omitted: number;
  /** 재생성 입력. 처음 입력만 넘기면 `null`. */
  regeneration: RegenerationInput | null;
}

/**
 * Flow 어댑터. 생성 대기열에서 Flow 멘션 묶음(담당 업무 초안 포함)의 생성 중 묶음을 맡는다. 멘션 묶음 모듈을 감싼다.
 * 준비는 읽을 저장소(고른 구성이나 저장소 매핑) 확인 → 맥락 조회와 "이미 답함" 확인 순서다. 매핑도 고른 구성도 없으면 실행 없이
 * 묶음이 저장소 매핑 필요로 기다리고, 정해 둔 폴더가 없으면 저장소 확인 필요로 멈춘다. Flow 키를 쓸 수 없거나 Flow에 닿지 못하면
 * 묶음을 실패로 두지 않고 Flow 어댑터만 멈춘다. 결과는 멘션 묶음에 맡겨 준비됨이나 실패로 옮긴다.
 */
export class FlowTargetAdapter implements TargetAdapter<FlowTargetTypes> {
  /** Flow 멘션 묶음의 대상 종류. */
  readonly kind = FLOW_TARGET_KIND;
  /** 준비하는 동안 보일 진행 단계. 맥락을 새로 조회하는 단계다. */
  readonly preparingStep = FETCHING_CONTEXT_STEP;

  constructor(private readonly options: FlowTargetAdapterOptions) {}

  generatingTargets(): number[] {
    return this.options.bundles.idsWithStatus('generating');
  }

  requestedByUser(bundleId: number): boolean {
    return this.options.bundles.get(bundleId)?.manual === true;
  }

  onTargetsChange(listener: () => void): () => void {
    return this.options.bundles.onChange(listener);
  }

  connectionUsable(): boolean {
    return this.options.flowKeyUsable();
  }

  onConnectionChange(listener: () => void): () => void {
    return this.options.onFlowKeyChange(listener);
  }

  begin(bundleId: number): string | null {
    /** 실행할 묶음. */
    const bundle = this.options.bundles.get(bundleId);
    return bundle?.status === 'generating' ? mentionSetKey(bundle) : null;
  }

  /** 묶음이 생성 중이고, 멘션 위치가 주어졌으면 생성을 시작할 때와 같은지 본다. 새 멘션이 합쳐지면 멘션 위치가 달라진다. */
  isGenerating(bundleId: number, mentionSet: string | null): boolean {
    /** 지금 묶음. */
    const bundle = this.options.bundles.get(bundleId);
    if (!bundle || bundle.status !== 'generating') return false;
    return mentionSet === null || mentionSetKey(bundle) === mentionSet;
  }

  async prepare(bundleId: number, _mentionSet: string, context: PrepareContext): Promise<Preparation<FlowTargetTypes>> {
    // 기다리는 사이에 매핑이 사라졌으면 저장소 매핑 필요로, 매핑된 폴더가 사라졌으면 저장소 확인 필요로 멘션 묶음이 올린다.
    /** 읽을 저장소(고른 구성이나 저장소 매핑)를 확인한 결과. 저장소 대기가 되었으면 `null`. */
    const runRepos = await this.options.bundles.reposForRun(bundleId);
    if (context.stopped() || !runRepos) return { kind: 'skipped' };

    // 맥락을 새로 조회하고, 그 사이 Flow에 내 답이 생겼으면 실행하지 않는다.
    /** 실행 직전 준비의 결과. */
    const prepared = await this.options.bundles.prepareRun(bundleId);
    if (context.stopped()) return { kind: 'skipped' };
    switch (prepared.kind) {
      case 'skipped':
      case 'answered':
      case 'unassigned':
        return { kind: 'skipped' };
      // 쓸 키가 없거나 Flow가 키를 거부했으면 묶음이 아니라 키의 문제다. "키 확인 필요"가 풀릴 때까지 Flow 어댑터를 멈춘다.
      case 'key-unusable':
        return { kind: 'adapter-paused' };
      // 지금 Flow에 닿지 못했으면(네트워크 오류, 요청 한도) 다음 묶음도 같으므로, 요청 한도면 Flow가 알려 준 시간을, 모르면 폴링 주기만큼 멈춘다.
      case 'flow-unreachable':
        return { kind: 'retry-later', afterMs: Math.max(prepared.retryAfterMs ?? FLOW_RETRY_DELAY_MS, MIN_FLOW_RETRY_DELAY_MS) };
      case 'unavailable':
        return { kind: 'ready', next: { kind: 'fail', reason: prepared.reason } };
      case 'prepared':
        break;
    }

    /** 이번 생성의 입력. */
    const input = await this.generationInput(prepared);
    return { kind: 'ready', next: { kind: 'run', run: this.draftRun(input, runRepos.repos) } };
  }

  async save(bundleId: number, mentionSet: string, draft: Draft, runs: readonly RunRecord[]): Promise<boolean> {
    return this.options.bundles.saveDraft(bundleId, draft, runs, mentionSet);
  }

  async fail(bundleId: number, mentionSet: string | null, failure: TargetFailure<ContextFailureReason>, runs: readonly RunRecord[]): Promise<boolean> {
    return this.options.bundles.markFailed(bundleId, failure, runs, mentionSet);
  }

  async needsRepoCheck(bundleId: number, mentionSet: string, repoCheck: RepoCheck, runs: readonly RunRecord[]): Promise<boolean> {
    return this.options.bundles.markRepoCheckNeeded(bundleId, repoCheck, runs, mentionSet);
  }

  async addRuns(bundleId: number, runs: readonly RunRecord[]): Promise<void> {
    await this.options.bundles.addRuns(bundleId, runs);
  }

  /** 데이터 구획에 넣을 Flow 내용과 맥락에서 길이 상한 때문에 뺀 항목 수, 재생성 입력을 만든다. 생성 한 번에 한 번 만든다. */
  private async generationInput(prepared: Extract<RunPreparation, { kind: 'prepared' }>): Promise<FlowGenerationInput> {
    /** 길이 상한을 적용한 맥락 문서. */
    const document = contextDocument(prepared.context);
    return {
      data: {
        assignment: !!prepared.bundle.assignment,
        mentions: activeMentions(prepared.bundle),
        context: prepared.context,
        contextText: document.text,
        myName: this.options.myName(),
        projectTitle: await this.options.projectTitle(prepared.bundle.projectId).catch(() => null),
      },
      omitted: omittedItemCount(document.omissions),
      regeneration: regenerationInputOf(prepared.bundle),
    };
  }

  /**
   * 초안 실행. 지침과 비밀 파일 패턴은 실행마다 설정에서 새로 읽어, 설정을 바꾸면 실행 중인 실행은 그대로 끝나고 다음 실행부터 바뀐 값을 쓴다.
   * 첫 저장소가 cwd가 된다. 받은 초안은 출력 검증으로 내용 불일치를 고치고 근거 위치를 확인한 뒤 저장한다.
   */
  private draftRun(input: FlowGenerationInput, repositories: readonly string[]): TargetRun<FlowTargetTypes, DraftOutput> {
    /** 입력 문서. 다시 실행해도 같은 입력을 넘긴다. */
    const document = draftInputDocument({ ...input.data, repositories, regeneration: input.regeneration });
    /** 요구를 고쳐 다시 만들 때의 고친 요구. 에이전트가 낸 요구를 이것으로 덮어쓴다. */
    const fixedRequirement = input.regeneration?.path === 'requirement' ? input.regeneration.requirement : null;
    return {
      kind: 'draft',
      step: WRITING_DRAFT_STEP,
      omittedContextItems: input.omitted,
      request: async (model) => {
        /** 지금 설정. */
        const settings = await this.options.settingsStore.load();
        return {
          instructions: draftInstructions(settings.extraInstructions),
          input: document,
          outputSchema: draftOutputSchema(),
          readRoots: [...repositories],
          secretPatterns: [...settings.extraSecretPatterns],
          model,
          timeoutMs: DRAFT_TIMEOUT_MS,
        };
      },
      read: readDraftReading,
      check: async (output, request) => {
        // 근거가 비밀 파일이면 결과 전체를 버리고 "비밀 파일을 근거로 듦" 실패로 바꾼다. 다시 실행하지 않는다.
        /** 출력 검증의 결과. */
        const check = await checkDraftOutput(output, {
          repositories,
          secretPatterns: withDefaultSecretPatterns(request.secretPatterns),
          fixedRequirement,
        });
        if (check.kind === 'secret-evidence') return { kind: 'rejected', fixes: check.fixes, reason: 'secret-evidence' };
        return {
          kind: 'passed',
          fixes: check.fixes,
          next: { kind: 'save', result: { ...check.output, repositories: [...repositories], autoSelection: null, createdAt: this.options.clock.now() } },
        };
      },
    };
  }
}

/** 초안 실행의 구조화 출력을 읽는다. 초안 실행 스키마 모양인지와 문장이 있는지만 본다. */
function readDraftReading(output: unknown): RunReading<DraftOutput> {
  /** 앱이 읽은 초안. 스키마 모양이 아니면 `null`. */
  const draft = readDraftOutput(output);
  if (!draft) return { kind: 'failed', reason: 'invalid-output', detail: '구조화 출력이 초안 실행 스키마 모양이 아닙니다.' };
  if (sentenceCount(draft) === 0) return { kind: 'failed', reason: 'empty-draft', detail: null };
  return { kind: 'output', output: draft };
}

/**
 * 묶음의 재생성에서 초안 실행에 더해 넘길 재생성 입력을 만든다. 지시를 덧붙였으면 직전 결과와 지금까지 덧붙인 지시 전부,
 * 요구를 고쳤으면 고친 요구다. 다시 만들기와 처음 만드는 묶음은 처음 입력만 넘기므로 `null`이다.
 */
function regenerationInputOf(bundle: MentionBundle): RegenerationInput | null {
  /** 묶음의 재생성. */
  const regeneration = bundle.regeneration;
  if (regeneration?.path === 'directive' && regeneration.previous) {
    return { path: 'directive', previous: regeneration.previous, directives: bundle.directives };
  }
  if (regeneration?.path === 'requirement' && bundle.fixedRequirement !== null) return { path: 'requirement', requirement: bundle.fixedRequirement };
  return null;
}
