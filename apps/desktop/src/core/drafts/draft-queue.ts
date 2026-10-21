import { FETCHING_CONTEXT_STEP, WRITING_DRAFT_STEP } from '../agent/progress-steps';
import { activeMentions, type MentionBundle } from '../bundles/mention-bundle';
import type { MentionBundles, RunPreparation } from '../bundles/mention-bundles';
import { mentionLocationKey } from '../detection/mention';
import { contextDocument, omittedItemCount } from '../flow/bundle-context';
import { errorFields, type Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { Executor, ExecutorOutcome, ExecutorReport, ExecutorRunRequest } from '../ports/executor';
import type { SettingsStore } from '../ports/settings-store';
import type { RepoResolution } from '../repos/repo-mappings';
import { draftOutputSchema, readDraftOutput, sentenceCount, type DraftOutput, type RunFailureReason, type RunRecord } from './draft';
import { draftInputDocument, draftInstructions } from './draft-input';

/** 초안 실행의 제한 시간(밀리초). 넘기면 프로세스 트리를 끝내고 "시간 초과"로 실패한다. 설정에서 바꿀 수 없다. */
export const DRAFT_TIMEOUT_MS = 10 * 60 * 1000;
/** 구조 실패일 때 실행하는 최대 횟수. 처음 실행과 다시 시도 1회다. */
const MAX_STRUCTURE_ATTEMPTS = 2;

/** 초안 실행에 쓸 에이전트. */
export interface DraftAgent {
  /** 기본 에이전트의 실행기. */
  executor: Executor;
  /** 고른 모델. 기본 모델(에이전트가 정함)이면 `null`. */
  model: string | null;
}

/** 생성 중 묶음의 진행. 작은 창과 펼친 창에 진행 단계 한 줄과 읽은 파일 수로 보인다. */
export type DraftProgress =
  /** 대기열에서 차례를 기다린다. 에이전트 연결을 기다리는 것도 여기에 든다. */
  | { status: 'waiting' }
  /** 실행하고 있다. */
  | { status: 'running'; step: string; filesRead: number };

/** 초안 대기열에 필요한 것. */
export interface DraftQueueOptions {
  /** 생성 중 묶음을 찾고 실행 결과를 맡길 멘션 묶음. */
  bundles: MentionBundles;
  /** 지금 실행에 쓸 에이전트. 에이전트 연결이 없으면 `null`이고, 대기열은 연결될 때까지 기다린다. */
  agent: () => DraftAgent | null;
  /** 에이전트 연결이나 기본 에이전트·모델이 바뀔 때마다 `listener`를 부르게 한다. 돌려준 함수를 부르면 그만 부른다. */
  onAgentChange: (listener: () => void) => () => void;
  /** Flow 프로젝트의 저장소 매핑을 지금 폴더 상태로 확인한다. */
  resolveRepos: (projectId: string) => Promise<RepoResolution>;
  /** 추가 지침과 추가 비밀 파일 패턴을 읽는 설정 저장소. 실행마다 새로 읽어 다음 실행부터 바뀐 값을 쓴다. */
  settingsStore: SettingsStore;
  /** 답변 명의자인 내 이름. 모르면 `null`. */
  myName: () => string | null;
  /** Flow 프로젝트 이름. 모르면 `null`. */
  projectTitle: (projectId: string) => Promise<string | null>;
  /** 실행 시작·종료 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. ID와 개수만 남기고 Flow 글과 초안은 남기지 않는다. */
  logger: Logger;
}

/** 앱이 실행을 멈춘 까닭. `user`는 [취소], `bundle-changed`는 묶음이 바뀜, `app-quit`은 앱 종료다. */
type Interruption = 'user' | 'bundle-changed' | 'app-quit';

/** 실행하고 있는 묶음. */
interface RunningDraft {
  /** 묶음 ID. */
  bundleId: number;
  /** 실행을 끊는 장치. 끊으면 실행기가 프로세스 트리를 끝낸다. */
  abort: AbortController;
  /** 앱이 실행을 멈춘 까닭. 멈추지 않았으면 `null`. */
  interruption: Interruption | null;
  /** 실행을 시작할 때 묶음에 든 멘션 위치. 실행 중에 바뀌면(새 멘션이 합쳐짐) 처음부터 다시 만든다. 시작하기 전이면 `null`. */
  mentionSet: string | null;
  /** 마지막 진행 단계. */
  step: string;
  /** 지금 실행에서 읽은 파일 수. */
  filesRead: number;
}

/** 에이전트 실행 한 번의 결과를 읽은 것. */
type RunVerdict =
  /** 초안을 받았다. */
  | { kind: 'draft'; output: DraftOutput }
  /** 구조 실패. 구조화 출력이 없거나 초안 실행 스키마 모양이 아니다. 1회 다시 시도한다. */
  | { kind: 'structure-failure'; detail: string }
  /** 다시 시도하지 않는 실패. */
  | { kind: 'failed'; reason: RunFailureReason; detail: string | null };

/** 실행 한 번을 마친 결과와 그 실행 기록. */
interface RunAttempt {
  /** 결과를 읽은 것. */
  verdict: RunVerdict;
  /** 실행 기록. */
  record: RunRecord;
}

/**
 * 초안 대기열. 생성 중 묶음을 하나씩 꺼내 초안 실행을 돌리는 직렬 대기열의 기본형이다(한 번에 하나만 실행한다).
 * 실행 직전에 저장소 매핑과 "이미 답함"을 다시 확인하고, 맥락을 새로 조회해 입력 문서를 만든다.
 * 결과는 멘션 묶음에 맡겨 준비됨이나 실패로 옮기고, 실행마다 실행 기록을 남긴다. 실행 중인 묶음의 진행 단계는 메모리에만 둔다.
 */
export class DraftQueue {
  /** 차례를 기다리는 생성 중 묶음의 ID. 앞에서부터 꺼낸다. */
  private waiting: number[] = [];
  /** 실행하고 있는 묶음. 없으면 `null`. */
  private running: RunningDraft | null = null;
  /** 대기열 상태. `stopped`면 새 실행을 시작하지 않는다. */
  private status: 'idle' | 'started' | 'stopped' = 'idle';
  /** 묶음과 에이전트 연결 구독을 끊는 함수. */
  private readonly unsubscribes: (() => void)[] = [];
  /** 진행이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();

  constructor(private readonly options: DraftQueueOptions) {}

  /**
   * 대기열을 시작한다. 이미 생성 중인 묶음을 작은 창 대기열 순서로 넣고, 묶음과 에이전트 연결이 바뀔 때마다 다시 본다.
   * 새로 생성 중이 된 묶음(감지, 되돌리기, 다시 시도)은 대기열 끝에 들어간다.
   */
  start(): void {
    if (this.status !== 'idle') return;
    this.status = 'started';
    this.unsubscribes.push(
      this.options.bundles.onChange(() => this.sync()),
      this.options.onAgentChange(() => this.pump()),
    );
    this.sync();
  }

  /** 대기열을 멈춘다. 앱을 끝낼 때 부른다. 실행 중인 실행은 끊어 프로세스 트리를 끝내고, 묶음은 생성 중으로 둔다. */
  stop(): void {
    if (this.status === 'stopped') return;
    this.status = 'stopped';
    for (const unsubscribe of this.unsubscribes.splice(0)) unsubscribe();
    if (this.running) this.interrupt(this.running, 'app-quit');
  }

  /** 생성 중 묶음의 진행. 대기열에 없으면 `null`. */
  progress(bundleId: number): DraftProgress | null {
    if (this.running?.bundleId === bundleId) return { status: 'running', step: this.running.step, filesRead: this.running.filesRead };
    return this.waiting.includes(bundleId) ? { status: 'waiting' } : null;
  }

  /** 진행(대기열, 진행 단계, 읽은 파일 수)이 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 생성 중 묶음을 취소한다. 실행 중이면 실행을 끊어 프로세스 트리를 끝내고, 기다리는 중이면 바로 "취소함" 실패로 둔다.
   * 실행을 끊은 묶음은 실행이 멈춘 뒤 마지막 단계와 함께 "취소함" 실패가 된다.
   */
  async cancel(bundleId: number): Promise<void> {
    if (this.running?.bundleId === bundleId) {
      this.interrupt(this.running, 'user');
      return;
    }
    if (!this.waiting.includes(bundleId)) return;
    await this.options.bundles.markFailed(bundleId, { reason: 'cancelled', detail: null, lastStep: null }, []);
  }

  /** 묶음 상태에 대기열을 맞추고, 실행 중인 묶음이 바뀌었으면 실행을 멈춘다. */
  private sync(): void {
    if (this.status !== 'started') return;
    /** 생성 중 묶음. 작은 창 대기열 순서다. */
    const generating = this.options.bundles.idsWithStatus('generating');
    /** 바꾸기 전의 대기열. */
    const before = this.waiting.join(',');
    // 생성 중이 아니게 된 묶음(취소함, 저장소 확인 필요 등)은 빼고, 새로 생성 중이 된 묶음은 끝에 넣는다.
    this.waiting = this.waiting.filter((bundleId) => generating.includes(bundleId));
    for (const bundleId of generating) {
      if (bundleId !== this.running?.bundleId && !this.waiting.includes(bundleId)) this.waiting.push(bundleId);
    }
    // 실행 중인 묶음에 새 멘션이 합쳐졌거나 묶음이 생성 중이 아니게 되었으면 실행을 멈춘다. 생성 중으로 남았으면 처음부터 다시 만든다.
    if (this.running && !this.isStillGenerating(this.running)) this.interrupt(this.running, 'bundle-changed');
    if (this.waiting.join(',') !== before) this.emit();
    this.pump();
  }

  /** 실행 중인 묶음이 실행을 시작할 때 그대로 생성 중인지 본다. 멘션이 합쳐지면 멘션 위치가 달라진다. */
  private isStillGenerating(entry: RunningDraft): boolean {
    /** 지금 묶음. */
    const bundle = this.options.bundles.get(entry.bundleId);
    if (!bundle || bundle.status !== 'generating') return false;
    return entry.mentionSet === null || mentionSetOf(bundle) === entry.mentionSet;
  }

  /** 실행하고 있지 않고 에이전트 연결이 있으면 대기열 맨 앞 묶음을 실행한다. */
  private pump(): void {
    if (this.status !== 'started' || this.running) return;
    /** 다음에 실행할 묶음. */
    const bundleId = this.waiting[0];
    if (bundleId === undefined) return;
    /** 지금 실행에 쓸 에이전트. */
    const agent = this.options.agent();
    if (!agent) return;

    this.waiting.shift();
    /** 실행하는 묶음. */
    const entry: RunningDraft = { bundleId, abort: new AbortController(), interruption: null, mentionSet: null, step: FETCHING_CONTEXT_STEP, filesRead: 0 };
    this.running = entry;
    this.emit();
    void this.generate(entry, agent)
      .catch((error: unknown) => this.failAfterCrash(entry, error))
      .finally(() => {
        this.running = null;
        this.emit();
        this.pump();
      });
  }

  /**
   * 묶음 하나의 초안을 만든다. 저장소 매핑 확인 → 맥락 조회와 "이미 답함" 확인 → 초안 실행 순서다.
   * 구조 실패는 1회 다시 실행하고, 그 밖의 실패는 다시 실행하지 않는다.
   */
  private async generate(entry: RunningDraft, agent: DraftAgent): Promise<void> {
    /** 실행할 묶음. */
    const bundle = this.options.bundles.get(entry.bundleId);
    if (!bundle || bundle.status !== 'generating') return;
    entry.mentionSet = mentionSetOf(bundle);

    // 기다리는 사이에 저장소 매핑이 지워졌거나 폴더가 사라졌을 수 있으므로 실행 직전에 다시 확인한다.
    /** 저장소 매핑을 확인한 결과. */
    const resolution = await this.options.resolveRepos(bundle.projectId);
    if (entry.interruption) return this.afterInterruption(entry, []);
    if (resolution.kind !== 'mapped') {
      await this.options.bundles.markRepoCheckNeeded(
        entry.bundleId,
        resolution.kind === 'missing' ? { kind: 'missing-folders', paths: resolution.paths } : null,
      );
      return;
    }

    // 맥락을 새로 조회하고, 그 사이 Flow에 내 답이 생겼으면 실행하지 않는다.
    /** 실행 직전 준비의 결과. */
    const prepared = await this.options.bundles.prepareRun(entry.bundleId);
    if (entry.interruption) return this.afterInterruption(entry, []);
    if (prepared.kind === 'skipped' || prepared.kind === 'answered') return;
    if (prepared.kind === 'unavailable') {
      await this.options.bundles.markFailed(entry.bundleId, { reason: prepared.reason, detail: null, lastStep: entry.step }, []);
      return;
    }

    /** 실행기에 넘길 요청과 맥락에서 뺀 항목 수. */
    const { request, omitted } = await this.draftRequest(prepared, resolution.repos, agent);
    /** 이번 생성에서 남긴 실행 기록. */
    const runs: RunRecord[] = [];
    for (let attempt = 1; ; attempt += 1) {
      /** 실행 한 번의 결과. */
      const { verdict, record } = await this.runOnce(entry, agent, request, omitted);
      runs.push(record);
      if (entry.interruption) return this.afterInterruption(entry, runs);
      // 구조 실패는 한 번 더 실행한다. 두 번째도 구조 실패면 실패로 둔다.
      if (verdict.kind === 'structure-failure' && attempt < MAX_STRUCTURE_ATTEMPTS) continue;

      if (verdict.kind === 'draft') {
        await this.options.bundles.saveDraft(
          entry.bundleId,
          { ...verdict.output, repositories: [...resolution.repos], createdAt: this.options.clock.now() },
          runs,
        );
      } else {
        await this.options.bundles.markFailed(
          entry.bundleId,
          verdict.kind === 'structure-failure'
            ? { reason: 'invalid-output', detail: verdict.detail, lastStep: entry.step }
            : { reason: verdict.reason, detail: verdict.detail, lastStep: entry.step },
          runs,
        );
      }
      return;
    }
  }

  /** 초안 실행의 요청을 만든다. 지침과 비밀 파일 패턴은 실행마다 설정에서 새로 읽는다. 첫 저장소가 작업 폴더다. */
  private async draftRequest(
    prepared: Extract<RunPreparation, { kind: 'prepared' }>,
    repositories: readonly string[],
    agent: DraftAgent,
  ): Promise<{ request: Omit<ExecutorRunRequest, 'signal' | 'onProgress'>; omitted: number }> {
    /** 지금 설정. */
    const settings = await this.options.settingsStore.load();
    /** 길이 상한을 적용한 맥락 문서. */
    const document = contextDocument(prepared.context);
    /** 표준 입력으로 넘길 입력 문서. */
    const input = draftInputDocument({
      mentions: activeMentions(prepared.bundle),
      context: prepared.context,
      contextText: document.text,
      myName: this.options.myName(),
      projectTitle: await this.options.projectTitle(prepared.bundle.projectId).catch(() => null),
      repositories,
    });
    return {
      request: {
        kind: 'draft',
        instructions: draftInstructions(settings.extraInstructions),
        input,
        outputSchema: draftOutputSchema(repositories),
        readRoots: [...repositories],
        secretPatterns: [...settings.extraSecretPatterns],
        model: agent.model,
        timeoutMs: DRAFT_TIMEOUT_MS,
      },
      omitted: omittedItemCount(document.omissions),
    };
  }

  /** 에이전트를 한 번 실행하고 결과와 실행 기록을 돌려준다. 진행 단계는 실행기가 알리는 대로 바꾼다. */
  private async runOnce(
    entry: RunningDraft,
    agent: DraftAgent,
    request: Omit<ExecutorRunRequest, 'signal' | 'onProgress'>,
    omitted: number,
  ): Promise<RunAttempt> {
    this.setProgress(entry, WRITING_DRAFT_STEP, 0);
    /** 시작 시각. */
    const startedAt = this.options.clock.now();
    this.options.logger.info('draft.run-started', { bundleId: entry.bundleId, agent: agent.executor.agent });

    /** 실행기가 알려 준 것. 실행기가 예외를 던지면 `null`. */
    let report: ExecutorReport | null = null;
    try {
      report = await agent.executor.run({
        ...request,
        signal: entry.abort.signal,
        onProgress: ({ step, filesRead }) => this.setProgress(entry, step, filesRead),
      });
    } catch (error) {
      this.options.logger.error('draft.executor-crashed', { bundleId: entry.bundleId, ...errorFields(error) });
    }

    /** 결과를 읽은 것. */
    const verdict: RunVerdict = report ? readVerdict(report.outcome) : { kind: 'failed', reason: 'app-error', detail: null };
    /** 실행 기록. 앱이 실행을 멈췄으면 그 까닭이 결과다. */
    const record: RunRecord = {
      kind: 'draft',
      agent: agent.executor.agent,
      cliVersion: report?.cliVersion ?? null,
      model: report?.model ?? agent.model,
      startedAt,
      finishedAt: this.options.clock.now(),
      result: entry.interruption ? (entry.interruption === 'bundle-changed' ? 'bundle-changed' : 'cancelled') : resultOf(verdict),
      detail: verdict.kind === 'draft' ? null : verdict.detail,
      lastStep: entry.step,
      fixes: [],
      omittedContextItems: omitted,
      costUsd: report?.usage?.costUsd ?? null,
      inputTokens: report?.usage?.inputTokens ?? null,
      outputTokens: report?.usage?.outputTokens ?? null,
    };
    this.options.logger.info('draft.run-finished', {
      bundleId: entry.bundleId,
      result: record.result,
      durationMs: record.finishedAt - record.startedAt,
      filesRead: entry.filesRead,
    });
    return { verdict, record };
  }

  /**
   * 앱이 멈춘 실행을 정리한다. [취소]면 "취소함" 실패, 묶음이 바뀌었으면 기록만 남기고 생성 중으로 남았을 때 대기열 맨 앞에서 처음부터 다시 만든다.
   * 앱을 끝내는 중이면 상태 저장소를 건드리지 않는다.
   */
  private async afterInterruption(entry: RunningDraft, runs: RunRecord[]): Promise<void> {
    switch (entry.interruption) {
      case 'user':
        await this.options.bundles.markFailed(entry.bundleId, { reason: 'cancelled', detail: null, lastStep: entry.step }, runs);
        return;
      case 'bundle-changed':
        await this.options.bundles.addRuns(entry.bundleId, runs);
        if (this.status === 'started' && this.options.bundles.get(entry.bundleId)?.status === 'generating') this.waiting.unshift(entry.bundleId);
        return;
      case 'app-quit':
      case null:
        return;
    }
  }

  /** 예상하지 못한 오류로 실행이 끝나면 묶음을 실패로 두어 생성 중에 멈춰 있지 않게 한다. */
  private async failAfterCrash(entry: RunningDraft, error: unknown): Promise<void> {
    this.options.logger.error('draft.generation-crashed', { bundleId: entry.bundleId, ...errorFields(error) });
    if (this.status !== 'started') return;
    try {
      await this.options.bundles.markFailed(entry.bundleId, { reason: 'app-error', detail: null, lastStep: entry.step }, []);
    } catch (saveError) {
      this.options.logger.error('draft.failure-save-failed', { bundleId: entry.bundleId, ...errorFields(saveError) });
    }
  }

  /** 실행을 끊는다. 먼저 정한 까닭을 남긴다. */
  private interrupt(entry: RunningDraft, interruption: Interruption): void {
    entry.interruption ??= interruption;
    entry.abort.abort();
  }

  /** 실행 중인 묶음의 진행 단계를 바꾸고 알린다. 이미 끝난 실행이면 아무것도 하지 않는다. */
  private setProgress(entry: RunningDraft, step: string, filesRead: number): void {
    if (this.running !== entry) return;
    entry.step = step;
    entry.filesRead = filesRead;
    this.emit();
  }

  /** 듣는 쪽에 진행이 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 묶음에 든 멘션 위치를 한 문자열로 나타낸다. 이미 답함으로 빠진 멘션도 넣어, 판정이 바뀌어도 같은 값이다. */
function mentionSetOf(bundle: MentionBundle): string {
  return bundle.mentions.map(mentionLocationKey).sort().join('\n');
}

/** 실행기의 결과를 읽는다. 구조화 출력은 초안 실행 스키마 모양인지와 문장이 있는지만 본다. */
function readVerdict(outcome: ExecutorOutcome): RunVerdict {
  switch (outcome.type) {
    case 'completed': {
      /** 앱이 읽은 초안. 스키마 모양이 아니면 `null`. */
      const output = readDraftOutput(outcome.output);
      if (!output) return { kind: 'structure-failure', detail: '구조화 출력이 초안 실행 스키마 모양이 아닙니다.' };
      if (sentenceCount(output) === 0) return { kind: 'failed', reason: 'empty-draft', detail: null };
      return { kind: 'draft', output };
    }
    case 'invalid-output':
      return { kind: 'structure-failure', detail: outcome.detail };
    case 'timed-out':
      return { kind: 'failed', reason: 'timed-out', detail: null };
    case 'cancelled':
      return { kind: 'failed', reason: 'cancelled', detail: null };
    case 'failed':
      return { kind: 'failed', reason: outcome.reason, detail: outcome.detail };
  }
}

/** 실행 결과를 실행 기록의 결과로 바꾼다. */
function resultOf(verdict: RunVerdict): RunRecord['result'] {
  switch (verdict.kind) {
    case 'draft':
      return 'succeeded';
    case 'structure-failure':
      return 'invalid-output';
    case 'failed':
      return verdict.reason;
  }
}
