import { isSourceGone, markContextMentions, type BundleContext, type BundleContextResult } from '../flow/bundle-context';
import { mentionLocationKey, mentionLocationOf, type Mention } from '../detection/mention';
import type { AutoSelection, ContextFailureReason, Draft, DraftFailure, Regeneration, RegenerationPath, RunRecord } from '../drafts/draft';
import type { MyAnswer, PlaceLookup } from '../flow/mention-judgement';
import type { Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { AppNotification, Notifier } from '../ports/notifier';
import type { StateStore } from '../ports/state-store';
import { bundleRecipients, draftEditorText, isPostable, postableBody } from '../drafts/post-body';
import { isSameFlowUser } from '../flow/user-id';
import { missingFolders, type RepoResolution } from '../repos/repo-mappings';
import { SerialQueue } from '../serial-queue';
import {
  activeMentions,
  bundlePlaceKey,
  canEditDraft,
  canPickRepos,
  canRegenerate,
  compareBundles,
  compareMentions,
  countsForReview,
  isProcessed,
  isDraftTouched,
  isRestorable,
  isWatched,
  judgeAnswered,
  listGroupOf,
  mentionSetKey,
  type BundledMention,
  type BundlePlace,
  type BundleStatus,
  type MentionBundle,
  type PostedAnswerRanges,
  type PostFailureReason,
  type RecordedAnswer,
  type RepoCheck,
  type UnsavedBundle,
} from './mention-bundle';

/** 멘션 묶음에 필요한 포트. */
export interface MentionBundlesOptions {
  /** 묶음을 두는 상태 저장소. */
  stateStore: StateStore;
  /** 초안 준비됨과 저장소 확인 필요 묶음을 알릴 OS 알림. */
  notifier: Notifier;
  /** 묶음을 만들고 처리한 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. ID와 개수만 남긴다. */
  logger: Logger;
  /** 지금 키로 묶음 자리의 내 답을 Flow에서 조회한다. 쓸 키가 없거나 조회하지 못하면 `null`. 이미 답함에서 되돌릴 때 쓴다. */
  findMyAnswers: (place: BundlePlace) => Promise<MyAnswer[] | null>;
  /** 지금 키로 묶음의 맥락과 묶음 자리의 내 답을 Flow에서 새로 조회한다. 쓸 키가 없으면 `null`. */
  collectContext: (bundle: MentionBundle) => Promise<BundleContextResult | null>;
  /** Flow 프로젝트의 저장소 매핑을 지금 폴더 상태로 확인한다. 초안 없는 묶음을 생성 중으로 올릴지 정하고, 초안 실행 직전에 다시 확인한다. */
  resolveRepos: (projectId: string) => Promise<RepoResolution>;
}

/**
 * 생성을 시작할 때 읽을 저장소를 확인한 결과. 사용자가 저장소 선택 창에서 고른 구성이 있으면 그 구성(`user`)을,
 * 없으면 저장소 매핑을 보고 매핑의 폴더가 모두 있으면 그 저장소(`mapped`)를 읽고, 매핑이 없으면(`unmapped`) 작업 폴더에서 자동 선택으로 정한다.
 * 자동 선택으로 정한 초안을 다시 만들면 선택 실행을 다시 돌리지 않고 직전 초안의 저장소와 그 내력(`auto-selected`)을 쓴다.
 */
export type RunRepos =
  | Exclude<RepoResolution, { kind: 'missing-folders' }>
  | { kind: 'user'; repos: string[] }
  | { kind: 'auto-selected'; repos: string[]; autoSelection: AutoSelection };

/** 준비됨 묶음을 다시 만드는 사용자 행동. 다시 만들기, 지시를 덧붙여 다시 만들기, 요구 고치기다. */
export type RegenerationRequest =
  | { path: 'again' }
  /** 덧붙일 지시. 앞뒤 공백을 떼고 비어 있으면 받지 않는다. */
  | { path: 'directive'; directive: string }
  /** 고친 요구. 앞뒤 공백을 떼고 비어 있으면 받지 않는다. */
  | { path: 'requirement'; requirement: string };

/** 초안 실행 직전 준비의 결과. */
export type RunPreparation =
  /** 맥락을 새로 조회해 비교 기준으로 저장했다. 묶음은 이미 답한 멘션을 뺀 지금 상태다. */
  | { kind: 'prepared'; bundle: MentionBundle; context: BundleContext }
  /** Flow에 이미 내 답이 있어 초안 없이 처리됨의 "이미 답함"으로 옮겼다. */
  | { kind: 'answered' }
  /** 쓸 키가 없거나 Flow가 키를 거부해(`401`) 맥락을 조회하지 못했다. 묶음의 실패가 아니라 "키 확인 필요"를 풀 일이다. */
  | { kind: 'key-unusable' }
  /**
   * 지금 Flow에 닿지 못했다(네트워크 오류, 요청 한도 `429`). 묶음의 실패가 아니라 잠시 뒤 다시 조회할 일이다.
   * `retryAfterMs`는 요청 한도일 때 Flow가 알려 준 기다릴 시간이고, 모르면 `null`.
   */
  | { kind: 'flow-unreachable'; retryAfterMs: number | null }
  /** 맥락을 조회하지 못했다. */
  | { kind: 'unavailable'; reason: ContextFailureReason }
  /** 묶음이 없거나 더는 생성 중이 아니다. */
  | { kind: 'skipped' };

/**
 * 멘션 묶음. 감지한 멘션을 묶음 자리(`postId`, `remarkId`)로 묶고, 초안 실행의 결과와 무시·되돌리기를 저장한다.
 * 작은 창 대기열, 펼친 창 목록, 트레이 표시, OS 알림이 이 상태를 따른다. 초안 실행은 초안 대기열이 돌리고 결과를 여기에 맡긴다.
 * 묶음을 바꾸는 일은 감지, 초안 대기열, 사용자 행동이 서로 끼어들지 않게 맡긴 순서대로 하나씩 한다.
 */
export class MentionBundles {
  /** 저장한 묶음 전부. 저장소와 같은 내용을 들고 있다. */
  private bundles: MentionBundle[] = [];
  /** 묶음을 바꾸는 일을 하나씩 하는 줄. */
  private readonly lane = new SerialQueue();
  /** 묶음이 바뀔 때 부를 함수. */
  private readonly listeners = new Set<() => void>();
  /** 묶음마다 마지막으로 시작한 맥락 조회의 번호. 늦게 끝난 옛 조회가 새 조회의 결과를 덮지 않게 한다. */
  private readonly contextRequests = new Map<number, number>();
  /** 다음 맥락 조회의 번호. */
  private nextContextRequest = 1;

  constructor(private readonly options: MentionBundlesOptions) {}

  /** 저장한 묶음을 읽는다. 앱을 시작할 때와 다른 계정으로 바꿔 기록을 비운 뒤에 부른다. */
  load(): Promise<void> {
    return this.lane.run(async () => {
      this.bundles = await this.options.stateStore.listBundles();
      this.emit();
    });
  }

  /** 묶음 전부. 작은 창 대기열 순서(가장 오래된 미처리 멘션 순)이고, 처리됨 묶음은 그 뒤에 최근에 처리한 것부터 온다. */
  state(): MentionBundle[] {
    return [...this.bundles].sort(compareBundles).map((bundle) => structuredClone(bundle));
  }

  /** 묶음 하나. 없으면 `null`. */
  get(bundleId: number): MentionBundle | null {
    /** 찾은 묶음. */
    const bundle = this.bundles.find((item) => item.id === bundleId);
    return bundle ? structuredClone(bundle) : null;
  }

  /** 이 상태인 묶음의 ID. 작은 창 대기열 순서다. 초안 대기열이 생성 중 묶음을 찾고, 트레이가 실패와 생성 중을 표시할 때 쓴다. */
  idsWithStatus(status: BundleStatus): number[] {
    return this.bundles
      .filter((bundle) => bundle.status === status)
      .sort(compareBundles)
      .map((bundle) => bundle.id);
  }

  /** 트레이 숫자. 검토 대기 가운데 준비됨과 저장소 확인 필요 묶음 수다. */
  reviewCount(): number {
    return this.bundles.filter((bundle) => countsForReview(bundle.status)).length;
  }

  /** 이 PC가 게시해 기록한 글의 ID(`commentId`, `replyId`) 전부. */
  postedIds(): Set<string> {
    return new Set(this.bundles.flatMap((bundle) => (bundle.posting?.postedId ? [bundle.posting.postedId] : [])));
  }

  /** 실패나 게시 실패 묶음이 있는지 본다. 트레이에 빨간 점을 띄운다. */
  hasFailure(): boolean {
    return this.bundles.some((bundle) => listGroupOf(bundle.status) === 'failed');
  }

  /** 묶음이 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * 판정을 통과한 멘션을 묶음에 넣고 기준점을 옮긴다. 둘은 함께 저장한다.
   * 같은 자리에 처리되지 않은 묶음이 있으면 합치고, 없거나 처리됨뿐이면 새 묶음을 만든다.
   * 새 묶음은 저장소 매핑의 폴더가 모두 있거나 매핑이 없으면(자동 선택) 생성 중, 매핑된 폴더가 없으면 저장소 확인 필요로 올린다.
   * 자리마다 `lookups`의 내 답으로 "이미 답함"을 판정하고, 모든 멘션이 빠진 묶음은 초안 없이 이미 답함으로 둔다.
   * 새로 저장소 확인 필요가 된 묶음이 있으면 OS 알림을 하나 띄운다.
   */
  async addDetected(mentions: readonly Mention[], lookups: ReadonlyMap<string, PlaceLookup>, baselineAlarmId: string): Promise<void> {
    /** 멘션이 온 Flow 프로젝트마다 저장소 매핑을 확인한 결과. 새 묶음의 상태를 정한다. */
    const resolutions = await this.resolveProjects(mentions.map((mention) => mention.projectId));
    /** 멘션을 넣어 초안 없이 기다리게 된 묶음. 원문 영역에 보일 맥락을 새로 조회한다. */
    const changed = await this.lane.run(async (): Promise<number[]> => {
      /** 지금 시각. */
      const now = this.options.clock.now();
      /** 이번에 바뀌는 묶음과 새로 넣은 멘션. 자리마다 하나다. */
      const touched = new Map<string, { bundle: UnsavedBundle; added: Set<string> }>();
      /** 이미 묶음에 든 멘션 위치. 같은 위치는 한 묶음에만 넣는다. */
      const known = new Set(this.bundles.flatMap((bundle) => bundle.mentions.map(mentionLocationKey)));

      for (const mention of [...mentions].sort(compareMentions)) {
        /** 멘션 위치. */
        const location = mentionLocationKey(mention);
        if (known.has(location)) continue;
        known.add(location);

        /** 묶음 자리. */
        const place = bundlePlaceKey(mention);
        /** 이 자리에서 이번에 바뀌는 묶음. */
        let entry = touched.get(place);
        if (!entry) {
          /** 이 자리의 처리되지 않은 묶음. */
          const open = this.openBundleAt(place);
          entry = { bundle: open ? structuredClone(open) : newBundle(mention, now, resolutions.get(mention.projectId)), added: new Set() };
          touched.set(place, entry);
        }
        entry.bundle.mentions.push({ ...mention, answered: false, gone: false, goneExcluded: false });
        entry.added.add(location);
      }

      /** 이 PC가 게시한 글마다 그 글이 답한 멘션 위치. */
      const ranges = this.postedRanges();
      /** 저장할 묶음. 자리마다 조회한 결과로 "이미 답함"을 판정한다. */
      const updated = [...touched].map(([place, { bundle, added }]) => {
        return applyDetection(bundle, added, lookups.get(place), now, ranges);
      });
      /** 저장한 묶음. */
      const saved = await this.options.stateStore.saveDetectedBundles(updated, baselineAlarmId);
      if (saved.length === 0) return [];

      /** 새로 만든 묶음의 ID. 저장소는 준 순서대로 돌려주므로, ID 없이 넘긴 자리의 묶음이다. */
      const createdIds = new Set(saved.filter((_, index) => updated[index]?.id === null).map((bundle) => bundle.id));
      this.bundles = [...this.bundles.filter((bundle) => !saved.some((item) => item.id === bundle.id)), ...saved];
      for (const bundle of saved) {
        this.options.logger.info(createdIds.has(bundle.id) ? 'bundle.created' : 'bundle.merged', {
          bundleId: bundle.id,
          status: bundle.status,
          mentionCount: activeMentions(bundle).length,
          answeredCount: bundle.mentions.length - activeMentions(bundle).length,
        });
      }
      this.emit();

      /** 새로 저장소 확인 필요가 된 묶음. 대기열 순서다. 생성 중 묶음은 초안이 준비될 때 알린다. */
      const waiting = saved.filter((bundle) => createdIds.has(bundle.id) && countsForReview(bundle.status)).sort(compareBundles);
      if (waiting.length > 0) this.options.notifier.notify(repoCheckNotification(waiting));
      return saved.filter(showsContextWithoutDraft).map((bundle) => bundle.id);
    });
    // 초안 없이 기다리는 묶음은 원문 영역의 "스레드 보기"에 보일 맥락을 새로 조회한다.
    // 생성 중 묶음은 초안 실행 직전에, 준비됨 묶음은 다시 만들 때 조회한다. 준비됨 묶음의 맥락은 초안을 만들 때 넘긴 비교 기준이라 덮지 않는다.
    await this.refreshContexts(changed);
  }

  /**
   * 묶음들의 맥락을 Flow에서 새로 조회해 저장한다. 감지 때 받은 내용은 쓰지 않는다.
   * 조회하지 못한 묶음은 전에 저장한 맥락을 그대로 두고, 그사이 생성 중이 되었거나 초안이 생긴 묶음은 바꾸지 않는다.
   * 같은 묶음을 거듭 조회하면 마지막으로 시작한 조회의 결과만 저장한다. 조회한 묶음들은 한 번에 저장해 듣는 쪽에 한 번 알린다.
   */
  async refreshContexts(bundleIds: readonly number[]): Promise<void> {
    /** 묶음마다 조회한 결과. 저장할 것만 남는다. */
    const fetched = await Promise.all(bundleIds.map((bundleId) => this.fetchContext(bundleId)));
    /** 묶음 ID마다 저장할 맥락. */
    const contexts = new Map(fetched.filter((item) => item !== null).map(({ bundleId, context }) => [bundleId, context]));
    if (contexts.size === 0) return;

    await this.lane.run(async () => {
      /** 맥락을 바꾼 묶음. */
      const next = this.bundles
        .filter((bundle) => contexts.has(bundle.id) && showsContextWithoutDraft(bundle))
        .map((bundle) => ({ ...bundle, context: contexts.get(bundle.id)! }));
      for (const bundle of next) {
        await this.options.stateStore.saveBundle(bundle);
        this.bundles = this.bundles.map((item) => (item.id === bundle.id ? bundle : item));
        this.options.logger.info('bundle.context-saved', { bundleId: bundle.id });
      }
      if (next.length > 0) this.emit();
    });
  }

  /** 묶음 하나의 맥락을 조회한다. 조회하지 못했거나, 그 사이 같은 묶음의 조회가 새로 시작됐으면 `null`. */
  private async fetchContext(bundleId: number): Promise<{ bundleId: number; context: BundleContext } | null> {
    /** 조회할 묶음. */
    const bundle = this.bundles.find((item) => item.id === bundleId);
    if (!bundle) return null;
    /** 이 조회의 번호. */
    const request = this.startContextRequest(bundleId);

    /** 조회한 결과. 쓸 키가 없거나 조회 중 예외가 나면 `null`. */
    const result = await this.options.collectContext(structuredClone(bundle)).catch(() => null);
    if (this.contextRequests.get(bundleId) !== request) return null;
    this.contextRequests.delete(bundleId);
    if (!result?.ok) {
      this.options.logger.warn('bundle.context-failed', { bundleId, reason: result ? result.failure.kind : 'no-key' });
      return null;
    }
    return { bundleId, context: result.context };
  }

  /** 묶음의 새 맥락 조회 번호를 받는다. 앞서 시작한 같은 묶음의 조회는 결과를 버리게 된다. */
  private startContextRequest(bundleId: number): number {
    /** 이 조회의 번호. */
    const request = this.nextContextRequest++;
    this.contextRequests.set(bundleId, request);
    return request;
  }

  /**
   * 준비된 뒤의 변화 감시. 사용자 행동을 기다리는 묶음(준비됨, 실패, 게시 실패, 저장소 확인 필요)마다 Flow 내용을 대기열 순서로 다시 조회한다.
   * 알림 폴링이 끝날 때마다 부른다. 검토 화면을 열 때는 부르지 않는다.
   * 쓸 키가 없거나 Flow에 닿지 못하면(키 거부, 연결 실패, 요청 한도) 다른 묶음도 같으므로 이번 감시를 멈춘다.
   */
  async watchWaiting(): Promise<void> {
    /** 감시할 묶음. 대기열 순서다. */
    const ids = this.bundles
      .filter((bundle) => isWatched(bundle.status))
      .sort(compareBundles)
      .map((bundle) => bundle.id);
    for (const bundleId of ids) {
      if ((await this.watch(bundleId)) === 'stop') break;
    }
  }

  /**
   * 묶음 하나의 Flow 내용을 다시 조회해 반영한다. 다른 묶음의 감시를 멈춰야 하면 `stop`이다.
   * 게시물이 지워졌거나(`404`) 볼 수 없거나(`403`) 머리 댓글이 지워졌으면(목록에 없음, 대댓글 목록의 `412`) 멘션이 모두 사라진 것으로 본다.
   * 서버 오류나 모르는 응답은 그 묶음만 이번 감시에서 건너뛴다. 네트워크 오류, `5xx`, `429`는 사라진 것으로 보지 않는다.
   */
  private async watch(bundleId: number): Promise<'continue' | 'stop'> {
    /** 감시할 묶음. */
    const bundle = this.bundles.find((item) => item.id === bundleId);
    if (!bundle || !isWatched(bundle.status)) return 'continue';
    /** 이 조회의 번호. 늦게 끝난 옛 조회가 이 결과를 덮지 않게 한다. */
    const request = this.startContextRequest(bundleId);
    /** 조회한 결과. 쓸 키가 없으면 `null`. */
    let result: BundleContextResult | null;
    try {
      result = await this.options.collectContext(structuredClone(bundle));
    } catch {
      // 예외 문구에 Flow 글이 섞일 수 있어 로그에는 남기지 않는다.
      this.options.logger.warn('bundle.watch-failed', { bundleId, reason: 'crashed' });
      return 'continue';
    }
    if (this.contextRequests.get(bundleId) !== request) return 'continue';
    this.contextRequests.delete(bundleId);
    if (result === null) return 'stop';

    /** 반영할 관찰. */
    let observed: WatchObservation;
    if (result.ok) {
      observed = {
        kind: 'found',
        context: result.context,
        myAnswers: result.myAnswers,
        goneMentions: new Set(result.goneMentions.map(mentionLocationKey)),
      };
    } else if (isSourceGone(result.failure)) {
      observed = { kind: 'gone' };
    } else {
      /** 조회하지 못한 까닭. */
      const failure = result.failure;
      this.options.logger.warn('bundle.watch-failed', { bundleId, reason: failure.kind, status: failure.kind === 'http' ? failure.status : null });
      return failure.kind === 'unauthorized' || failure.kind === 'network' || failure.kind === 'rate-limited' ? 'stop' : 'continue';
    }

    await this.lane.run(async () => {
      /** 지금 묶음. 조회하는 사이에 바뀌었을 수 있다. */
      const latest = this.bundles.find((item) => item.id === bundleId);
      if (!latest || !isWatched(latest.status)) return;
      /** 관찰을 반영한 묶음. */
      const next = applyWatch(latest, observed, this.options.clock.now(), this.postedRanges());
      if (sameIgnoringFetchTime(next, latest)) return;

      await this.options.stateStore.saveBundle(next);
      this.bundles = this.bundles.map((item) => (item.id === bundleId ? next : item));
      this.options.logger.info(next.status === latest.status ? 'bundle.watched' : `bundle.${next.status}-after-ready`, {
        bundleId,
        status: next.status,
        goneCount: next.mentions.filter((mention) => mention.gone).length,
      });
      this.emit();
    });
    return 'continue';
  }

  /**
   * 초안 실행 직전에 맥락을 Flow에서 새로 조회해 비교 기준으로 저장하고, 같은 조회에서 찾은 내 답으로 "이미 답함"을 다시 판정한다(감지 때와 같은 규칙).
   * 내가 마지막으로 답한 글보다 앞선 멘션은 묶음에서 빼고, 모두 빠지면 초안 없이 처리됨의 "이미 답함"으로 옮긴다.
   * 쓸 키가 없거나 Flow가 키를 거부했거나 지금 Flow에 닿지 못하면(네트워크 오류, 요청 한도) 묶음을 바꾸지 않고 그렇게 알린다.
   * 생성 중이 아닌 묶음은 바꾸지 않는다.
   */
  async prepareRun(bundleId: number): Promise<RunPreparation> {
    /** 준비할 묶음. */
    const bundle = this.bundles.find((item) => item.id === bundleId);
    if (!bundle || bundle.status !== 'generating') return { kind: 'skipped' };
    // 앞서 시작한 화면용 조회가 늦게 끝나도 이 조회의 맥락을 덮지 않게 번호를 받는다.
    this.startContextRequest(bundleId);
    /** 조회한 결과. 쓸 키가 없으면 `null`. */
    let result: BundleContextResult | null;
    try {
      result = await this.options.collectContext(structuredClone(bundle));
    } catch {
      // 예외 문구에 Flow 글이 섞일 수 있어 로그에는 남기지 않는다.
      this.options.logger.warn('bundle.context-failed', { bundleId, reason: 'crashed' });
      return { kind: 'unavailable', reason: 'flow-unavailable' };
    }
    if (result === null || (!result.ok && result.failure.kind === 'unauthorized')) {
      this.options.logger.warn('bundle.context-failed', { bundleId, reason: result ? 'unauthorized' : 'no-key' });
      return { kind: 'key-unusable' };
    }
    if (!result.ok) {
      /** 조회하지 못한 까닭. */
      const failure = result.failure;
      this.options.logger.warn('bundle.context-failed', { bundleId, reason: failure.kind });
      // 네트워크 오류와 요청 한도는 이 글이 아니라 Flow에 닿는 길의 문제다. 서버 오류는 그 글에서만 생길 수 있어 묶음 실패로 둔다.
      if (failure.kind === 'network') return { kind: 'flow-unreachable', retryAfterMs: null };
      if (failure.kind === 'rate-limited') return { kind: 'flow-unreachable', retryAfterMs: failure.retryAfterMs };
      return { kind: 'unavailable', reason: isSourceGone(failure) ? 'source-gone' : 'flow-unavailable' };
    }

    // 조회하는 사이에 새 멘션이 합쳐졌을 수 있으므로 줄에 들어가 지금 값으로 판정한다.
    return this.lane.run(async (): Promise<RunPreparation> => {
      /** 지금 묶음. */
      const latest = this.bundles.find((item) => item.id === bundleId);
      if (!latest || latest.status !== 'generating') return { kind: 'skipped' };
      /** 새로 찾은 내 답을 더한 기록. 다른 묶음이 게시한 글은 그 묶음의 답이라 뺀다. */
      const answers = mergeAnswers(latest.answers, result.myAnswers);
      /** 다시 판정한 멘션. */
      const mentions = judgeAnswered(latest.mentions, answers, this.postedRanges());
      /** 모든 멘션이 빠졌는지 여부. */
      const answered = activeMentions({ mentions }).length === 0;
      /** 맥락과 판정을 반영한 묶음. 맥락의 멘션 표시는 묶음에 남은 멘션으로 다시 한다. */
      const next: MentionBundle = {
        ...latest,
        answers,
        mentions,
        context: markContextMentions(result.context, { ...latest, mentions }),
        // 비교 기준이 새로 바뀌므로 옛 기준과 견주던 감시 내용은 버린다.
        watchedContext: null,
        ...(answered ? { status: 'already-answered' as const, processedAt: this.options.clock.now() } : {}),
      };
      await this.options.stateStore.saveBundle(next);
      this.bundles = this.bundles.map((item) => (item.id === bundleId ? next : item));
      this.options.logger.info(answered ? 'bundle.answered-before-run' : 'bundle.context-saved', {
        bundleId,
        answeredCount: mentions.length - activeMentions(next).length,
      });
      this.emit();
      return answered ? { kind: 'answered' } : { kind: 'prepared', bundle: structuredClone(next), context: structuredClone(next.context!) };
    });
  }

  /**
   * 생성을 시작할 때 읽을 저장소를 지금 폴더 상태로 다시 확인한다. 기다리는 사이에 매핑이 생겼거나 지워졌거나 폴더가 사라졌을 수 있다.
   * 사용자가 고른 구성이 있으면 저장소 매핑 대신 그 구성을 본다. 폴더가 모두 있으면 읽을 저장소를, 매핑이 없으면 자동 선택으로 정하라고 돌려준다.
   * 읽을 폴더가 하나라도 없으면 자동 선택으로 넘어가지 않고, 생성 중 묶음을 초안 없이 저장소 확인 필요로 올리고 OS 알림을 띄운 뒤 `null`을 돌려준다.
   * 자동 선택으로 정한 초안을 다시 만드는 묶음은 매핑이 여전히 없으면 직전 초안의 저장소를 쓴다. 그 폴더가 사라졌으면 자동 선택을 다시 한다.
   */
  async reposForRun(bundleId: number): Promise<RunRepos | null> {
    /** 실행할 묶음. */
    const bundle = this.bundles.find((item) => item.id === bundleId);
    if (!bundle || bundle.status !== 'generating') return null;
    /** 읽을 저장소를 확인한 결과. */
    const resolution = bundle.userRepos ? await resolveUserRepos(bundle.userRepos) : await this.options.resolveRepos(bundle.projectId);
    /** 직전 초안이 자동 선택으로 정한 저장소. */
    const autoSelected = bundle.regeneration?.autoSelected;
    if (resolution.kind === 'unmapped' && autoSelected && (await missingFolders(autoSelected.repositories)).length === 0) {
      return { kind: 'auto-selected', repos: [...autoSelected.repositories], autoSelection: structuredClone(autoSelected.autoSelection) };
    }
    if (resolution.kind !== 'missing-folders') return resolution;

    /** 저장소 확인 필요가 된 묶음. 그사이 생성 중이 아니게 되었으면 `null`. */
    const changed = await this.change(bundleId, 'bundle.repo-check-needed', (latest) =>
      latest.status === 'generating' ? { ...latest, ...statusWithoutDraft(resolution) } : null,
    );
    if (changed) this.options.notifier.notify(repoCheckNotification([changed]));
    return null;
  }

  /**
   * 생성 중 묶음을 초안 없이 저장소 확인 필요로 옮기고 실행 기록을 더한 뒤 OS 알림을 띄운다. 자동 선택으로 저장소를 정하지 못했을 때 쓴다.
   * `mentionSet`은 생성을 시작할 때의 멘션 위치다. 그 뒤 새 멘션이 합쳐졌으면 처음부터 다시 만들 묶음이므로 옮기지 않는다.
   * 옮겼으면 참이고, 생성 중이 아니거나 멘션이 바뀌었으면 거짓이다.
   */
  async markRepoCheckNeeded(bundleId: number, repoCheck: RepoCheck, runs: readonly RunRecord[], mentionSet: string): Promise<boolean> {
    /** 저장소 확인 필요가 된 묶음. */
    const changed = await this.finishGeneration(bundleId, 'bundle.repo-check-needed', runs, mentionSet, () => ({
      status: 'repo-check-needed',
      repoCheck: structuredClone(repoCheck),
    }));
    if (changed) this.options.notifier.notify(repoCheckNotification([changed]));
    return changed !== null;
  }

  /**
   * 생성 중 묶음에 초안 실행이 만든 초안과 실행 기록을 담아 준비됨으로 옮기고 OS 알림을 띄운다.
   * `mentionSet`은 실행을 시작할 때의 멘션 위치(`mentionSetKey`)다. 그 뒤 새 멘션이 합쳐졌으면 새 멘션이 빠진 초안이므로 저장하지 않는다.
   * 저장했으면 참이고, 생성 중이 아니거나 멘션이 바뀌었으면 거짓이다.
   */
  async saveDraft(bundleId: number, draft: Draft, runs: readonly RunRecord[], mentionSet: string): Promise<boolean> {
    /** 준비됨이 된 묶음. */
    const changed = await this.finishGeneration(bundleId, 'bundle.draft-ready', runs, mentionSet, () => ({
      status: 'ready',
      draft: structuredClone(draft),
      editedText: null,
      failure: null,
      regeneration: null,
    }));
    if (changed) this.options.notifier.notify(draftReadyNotification(changed));
    return changed !== null;
  }

  /**
   * 생성 중 묶음을 실패로 옮기고 실행 기록을 더한다. 실패 화면에 사유와 마지막 단계가 보인다.
   * `mentionSet`을 주면 실행을 시작한 뒤 새 멘션이 합쳐졌을 때 실패로 두지 않는다(처음부터 다시 만들 묶음이다). [취소]처럼 언제나 실패로 둘 때는 `null`이다.
   * 실패로 두었으면 참이고, 아니면 거짓이다.
   */
  async markFailed(bundleId: number, failure: DraftFailure, runs: readonly RunRecord[], mentionSet: string | null): Promise<boolean> {
    /** 실패가 된 묶음. */
    const changed = await this.finishGeneration(bundleId, 'bundle.generation-failed', runs, mentionSet, () => ({
      status: 'failed',
      failure: { ...failure },
    }));
    return changed !== null;
  }

  /** 상태는 그대로 두고 실행 기록만 더한다. 묶음이 바뀌어 멈춘 실행을 남길 때 쓴다. */
  async addRuns(bundleId: number, runs: readonly RunRecord[]): Promise<void> {
    if (runs.length === 0) return;
    await this.change(bundleId, 'bundle.runs-recorded', (bundle) => ({ ...bundle, runs: [...bundle.runs, ...structuredClone(runs)] }));
  }

  /**
   * 생성 중 묶음의 생성을 끝낸다. 실행 기록을 더하고 `update`가 돌려준 값으로 상태를 바꾼다.
   * `mentionSet`을 주면 실행을 시작할 때의 멘션 위치와 지금이 같을 때만 바꾼다. 바꿨으면 바꾼 묶음, 바꾸지 않았으면 `null`.
   */
  private finishGeneration(
    bundleId: number,
    event: string,
    runs: readonly RunRecord[],
    mentionSet: string | null,
    update: () => Pick<MentionBundle, 'status'> & Partial<MentionBundle>,
  ): Promise<MentionBundle | null> {
    return this.change(bundleId, event, (bundle) => {
      if (bundle.status !== 'generating') return null;
      if (mentionSet !== null && mentionSetKey(bundle) !== mentionSet) return null;
      return { ...bundle, ...update(), runs: [...bundle.runs, ...structuredClone(runs)] };
    });
  }

  /** 실패 묶음을 [다시 시도]한다. 생성 중으로 돌아가 초안 대기열에 들어가고, 합쳐진 새 멘션도 이번 초안에 들어간다. */
  async retry(bundleId: number): Promise<void> {
    await this.change(bundleId, 'bundle.retried', (bundle) =>
      bundle.status === 'failed' ? { ...bundle, ...retried } : null,
    );
  }

  /**
   * 준비됨이나 저장소 확인 필요 묶음을 저장소 선택 창에서 고른 구성으로 다시 만든다. 생성 중으로 올라 초안 대기열에 들어간다.
   * 직전 초안과 비교 기준, 저장소 확인 필요 사유는 지운다. 재생성 입력은 처음 입력에 읽을 저장소만 바뀐 것이라 직전 결과를 남겨 둘 까닭이 없다.
   * 저장소를 바꾸면 그때까지의 지시와 고친 요구도 지운다.
   * 고른 구성은 묶음에만 두고 저장소 매핑으로 저장하지 않는다. 구성이 비었거나 그 밖의 상태면 아무것도 하지 않는다.
   */
  async regenerateWithRepos(bundleId: number, repos: readonly string[]): Promise<void> {
    if (repos.length === 0) return;
    await this.change(bundleId, 'bundle.regenerated-with-repos', (bundle) =>
      canPickRepos(bundle.status)
        ? {
            ...bundle,
            ...clearedForRegeneration,
            userRepos: [...repos],
            repoCheck: null,
            directives: [],
            fixedRequirement: null,
            regeneration: null,
          }
        : null,
    );
  }

  /**
   * 준비됨 묶음을 다시 만든다. 다시 만들기, 지시를 덧붙여 다시 만들기, 요구 고치기다. 매번 새 실행이고 생성 중으로 올라 초안 대기열에 들어간다.
   * 직전 초안·편집본과 비교 기준은 바로 지운다. 지시를 덧붙이면 직전 결과를 재생성에 남겨 다음 초안 실행에 넘긴다.
   * 요구를 고치면 그때까지의 지시를 지운다. 받는 사람에서 뺀 사람은 초안 텍스트 밖이라 그대로 둔다.
   * 고친 요구는 한 문장이라 줄바꿈을 공백으로 잇는다. 준비됨이 아니거나 덧붙일 지시나 고친 요구가 비어 있으면 아무것도 하지 않는다.
   */
  async regenerate(bundleId: number, request: RegenerationRequest): Promise<void> {
    /** 경로에 따라 바꿀 지시와 고친 요구. 덧붙일 지시나 고친 요구가 비었으면 `null`. */
    const inputs = regenerationInputsOf(request);
    if (!inputs) return;
    await this.change(bundleId, `bundle.regenerated-${request.path}`, (bundle) => {
      if (!bundle.draft || !canRegenerate(bundle.status)) return null;
      return { ...bundle, ...regenerationOf(bundle, request.path), ...inputs(bundle.directives) };
    });
  }

  /**
   * 준비됨 묶음의 초안을 편집기에서 고친 텍스트를 편집본으로 저장한다. 원래 초안에서 만든 편집기 텍스트와 같아지면 편집본을 지운다.
   * 초안이 없거나 준비됨이 아니면 아무것도 하지 않는다.
   */
  async editDraft(bundleId: number, text: string): Promise<void> {
    await this.change(bundleId, 'bundle.draft-edited', (bundle) => {
      if (!bundle.draft || !canEditDraft(bundle.status)) return null;
      /** 저장할 편집본. */
      const editedText = text === draftEditorText(bundle.draft) ? null : text;
      return editedText === bundle.editedText ? null : { ...bundle, editedText };
    });
  }

  /** "원래 초안으로 되돌리기". 준비됨 묶음의 편집본을 버려, 편집기 텍스트가 원래 초안으로 돌아가고 근거 번호가 다시 보인다. */
  async revertDraftEdit(bundleId: number): Promise<void> {
    await this.change(bundleId, 'bundle.draft-reverted', (bundle) =>
      bundle.editedText !== null && canEditDraft(bundle.status) ? { ...bundle, editedText: null } : null,
    );
  }

  /**
   * 준비됨 묶음의 받는 사람에서 한 사람을 뺀다. 더하는 기능은 없다. `index`는 화면에 보인 받는 사람 목록의 위치, `name`은 그 사람의 이름이다.
   * 화면은 사용자 ID를 모르므로 지금 목록에서 찾고, 그사이 목록이 바뀌어 그 자리의 이름이 다르면 다른 사람을 빼지 않게 아무것도 하지 않는다.
   */
  async removeRecipient(bundleId: number, index: number, name: string): Promise<void> {
    await this.change(bundleId, 'bundle.recipient-removed', (bundle) => {
      if (!canEditDraft(bundle.status)) return null;
      /** 뺄 사람. */
      const recipient = bundleRecipients(bundle)[index];
      if (!recipient || recipient.name !== name) return null;
      return { ...bundle, removedRecipients: [...bundle.removedRecipients, recipient.id] };
    });
  }

  /**
   * 준비됨이나 게시 실패 묶음의 게시를 시작해 게시 중(카운트다운)으로 둔다. 게시 중 묶음은 검토 대기에 남지만 트레이 숫자에서는 빠진다.
   * 게시 실패의 직전 게시 기록은 지운다. 준비됨·게시 실패가 아니거나 게시할 수 없는 글(빈 편집기 텍스트, 상한을 넘는 게시 본문)이면 바꾸지 않는다. 시작했으면 참이다.
   */
  async startPosting(bundleId: number): Promise<boolean> {
    /** 게시 중이 된 묶음. */
    const changed = await this.change(bundleId, 'bundle.posting-started', (bundle) =>
      isPostable(bundle) ? { ...bundle, status: 'posting', posting: null } : null,
    );
    return changed !== null;
  }

  /**
   * 카운트다운 중인 게시를 취소해 준비됨으로 돌린다. 초안·편집본·받는 사람은 그대로다.
   * 게시 요청을 이미 보냈으면(게시 기록이 있음) 취소하지 않는다. 취소했으면 참이다.
   */
  async cancelPosting(bundleId: number): Promise<boolean> {
    /** 준비됨으로 돌아간 묶음. */
    const changed = await this.change(bundleId, 'bundle.posting-cancelled', (bundle) =>
      bundle.status === 'posting' && bundle.posting === null ? { ...bundle, status: 'ready' } : null,
    );
    return changed !== null;
  }

  /**
   * 카운트다운이 끝난 묶음의 게시 요청을 보내기 직전에, "게시 요청 보냄"과 게시 본문을 게시 기록으로 먼저 저장한다.
   * 저장했으면 보낼 게시 본문을 돌려준다. 그사이 취소했거나 이미 보냈으면 `null`이다.
   * 게시할 수 없는 글이 되었으면 보내지 않고 준비됨으로 돌린 뒤 `null`이다.
   */
  async recordPostRequest(bundleId: number): Promise<string | null> {
    /** 게시 기록을 저장한 묶음. */
    const changed = await this.change(bundleId, 'bundle.post-requested', (bundle) => {
      if (bundle.status !== 'posting' || bundle.posting !== null) return null;
      /** 보낼 게시 본문. 게시 중에는 초안과 받는 사람을 바꿀 수 없어 [게시]를 누를 때와 같다. */
      const body = postableBody(bundle);
      return body === null
        ? { ...bundle, status: 'ready' }
        : {
            ...bundle,
            // 게시 중에는 새 멘션이 합쳐지지 않아 지금 남은 멘션이 곧 [게시]를 누를 때 본 멘션이다.
            posting: { body, sentAt: this.options.clock.now(), postedId: null, failure: null, answeredMentions: activeMentions(bundle).map(mentionLocationOf) },
          };
    });
    return changed?.posting?.body ?? null;
  }

  /** 게시 요청이 성공했다. 올라간 글의 ID(`commentId`나 `replyId`)를 게시 기록에 더하고 처리됨의 "게시됨"으로 둔다. */
  async markPosted(bundleId: number, postedId: string): Promise<void> {
    await this.change(bundleId, 'bundle.posted', (bundle) =>
      bundle.status === 'posting' && bundle.posting
        ? { ...bundle, status: 'posted', processedAt: this.options.clock.now(), posting: { ...bundle.posting, postedId } }
        : null,
    );
  }

  /**
   * 게시 요청을 보낸 게시 중 묶음을 게시 실패로 둔다. 게시 기록(보낸 게시 본문)에 사유를 더하고, 초안·편집본·받는 사람은 그대로 둔다.
   * 게시 실패로 두었으면 참이다. 게시 요청을 보낸 게시 중이 아니면 바꾸지 않고 거짓이다.
   */
  async markPostFailed(bundleId: number, failure: PostFailureReason): Promise<boolean> {
    /** 게시 실패가 된 묶음. */
    const changed = await this.change(bundleId, 'bundle.post-failed', (bundle) =>
      bundle.status === 'posting' && bundle.posting && bundle.posting.postedId === null
        ? { ...bundle, status: 'post-failed', posting: { ...bundle.posting, failure } }
        : null,
    );
    return changed !== null;
  }

  /** 게시하지 못한 게시 중 묶음을 준비됨으로 돌린다. 게시 기록은 지우고 초안·편집본·받는 사람은 그대로 둔다. */
  async returnToReady(bundleId: number): Promise<void> {
    await this.change(bundleId, 'bundle.posting-returned', (bundle) =>
      bundle.status === 'posting' ? { ...bundle, status: 'ready', posting: null } : null,
    );
  }

  /** 묶음을 무시한다. 처리됨의 "무시함"이 되고, 7일 안에 되돌릴 수 있다. 이미 처리됨이거나 게시 중이면 아무것도 하지 않는다. */
  async ignore(bundleId: number): Promise<void> {
    await this.change(bundleId, 'bundle.ignored', (bundle) => {
      if (isProcessed(bundle.status) || bundle.status === 'posting') return null;
      return { ...bundle, status: 'ignored', processedAt: this.options.clock.now() };
    });
  }

  /**
   * 무시함, 이미 답함, 원문 사라짐에서 되돌린다. 초안이 있으면 그대로 준비됨이 되고, 없으면 새로 만들도록 생성 중으로 올린다.
   * 초안이 없는데 매핑된 폴더가 사라졌으면 저장소 확인 필요로 돌아간다. 매핑이 없으면 생성 중으로 올라 자동 선택부터 한다.
   * 이미 답함·원문 사라짐에서 되돌리면 그때 있던 내 답과 사라진 멘션을 기록해 이후 판정에서 뺀다. 내 답은 Flow에서 새로 조회한다.
   * 같은 답이나 같은 사라짐으로 다시 처리됨이 되지 않게 하려는 것이고, 그래서 빠졌던 멘션도 다시 든다. 조회하지 못하면 판정 때 기록한 답만 뺀다.
   * 무시함에서 되돌리면 답을 빼지 않아, 이미 답한 앞선 멘션은 빠진 채로 둔다.
   */
  async restore(bundleId: number): Promise<void> {
    /** 되돌릴 묶음. */
    const bundle = this.bundles.find((item) => item.id === bundleId);
    if (!bundle || !isRestorable(bundle.status)) return;
    /** 지금 Flow에 있는 내 답. 자동으로 옮겨진 묶음이 아니거나 조회하지 못하면 `null`. */
    const current = isAutoProcessed(bundle.status) ? await this.options.findMyAnswers(bundle).catch(() => null) : null;
    /** 초안이 없을 때 돌아갈 상태를 정할 저장소 매핑. */
    const resolution = await this.options.resolveRepos(bundle.projectId);

    // 조회하는 사이에 상태가 바뀌었을 수 있으므로 줄에 들어가 지금 값으로 다시 본다.
    /** 되돌린 묶음. */
    const restored = await this.change(bundleId, 'bundle.restored', (latest) => {
      if (!isRestorable(latest.status)) return null;
      /** 판정에서 뺄 것을 기록하는지 여부. */
      const recording = isAutoProcessed(latest.status);
      /** 되돌린 뒤의 내 답 기록. */
      const answers = recording ? excludeAnswers(latest.answers, current ?? []) : latest.answers;
      /** 되돌린 뒤의 멘션. 사라진 멘션은 사라짐 판정에서 빼기로 기록하고 다시 든다. */
      const mentions = judgeAnswered(recording ? latest.mentions.map(excludeGone) : latest.mentions, answers, this.postedRanges());
      /** 처리됨에서 벗어난 묶음. */
      const reopened = { ...latest, processedAt: null, answers, mentions };
      // 초안이 있으면 그대로 준비됨이다. 합쳐진 뒤 다시 만들지 않은 새 멘션 표시도 그대로 둔다.
      if (latest.draft) return { ...reopened, status: 'ready' };
      return { ...reopened, ...statusWithoutDraft(resolution), failure: null, newMentionCount: 0 };
    });
    // 초안 없이 기다리게 되면 원문 영역에 보일 맥락을 새로 조회한다. 생성 중이면 초안 실행 직전에 조회한다.
    if (restored && showsContextWithoutDraft(restored)) await this.refreshContexts([bundleId]);
  }

  /** 묶음 하나를 `update`로 바꿔 저장한다. `update`가 `null`을 돌려주면 바꾸지 않는다. 바꾼 묶음을 돌려주고, 바꾸지 않았거나 없는 묶음이면 `null`. */
  private change(bundleId: number, event: string, update: (bundle: MentionBundle) => MentionBundle | null): Promise<MentionBundle | null> {
    return this.lane.run(async () => {
      /** 바꿀 묶음. */
      const bundle = this.bundles.find((item) => item.id === bundleId);
      /** 바꾼 묶음. */
      const next = bundle ? update(structuredClone(bundle)) : null;
      if (!next) return null;

      await this.options.stateStore.saveBundle(next);
      this.bundles = this.bundles.map((item) => (item.id === bundleId ? next : item));
      this.options.logger.info(event, { bundleId, status: next.status });
      this.emit();
      return structuredClone(next);
    });
  }

  /**
   * 이 PC가 게시한 글마다 그 글이 답한 멘션 위치. 이 PC가 게시한 글은 게시를 누를 때 조회한 내용에 있던 멘션에만 답한 것으로 보기 때문이다.
   * 그래야 게시 중에 들어와 새 묶음이 된 멘션이 그 글 때문에 바로 "이미 답함"으로 숨지 않는다. 다른 PC나 Flow 화면에서 쓴 내 답은 시각으로 판정한다.
   */
  private postedRanges(): PostedAnswerRanges {
    return new Map(
      this.bundles.flatMap((bundle): [string, Set<string>][] =>
        bundle.posting?.postedId ? [[bundle.posting.postedId, new Set(bundle.posting.answeredMentions.map(mentionLocationKey))]] : [],
      ),
    );
  }

  /** Flow 프로젝트마다 저장소 매핑을 한 번씩 확인한다. 확인하다 예외가 나면 매핑이 없는 것으로 본다. */
  private async resolveProjects(projectIds: readonly string[]): Promise<Map<string, RepoResolution>> {
    /** 확인할 Flow 프로젝트. 같은 프로젝트는 한 번만 확인한다. */
    const unique = [...new Set(projectIds)];
    /** 프로젝트마다 확인한 결과. */
    const resolved = await Promise.all(
      unique.map(async (projectId): Promise<[string, RepoResolution]> => [
        projectId,
        await this.options.resolveRepos(projectId).catch((): RepoResolution => ({ kind: 'unmapped' })),
      ]),
    );
    return new Map(resolved);
  }

  /**
   * 자리의 새 멘션을 합칠 묶음. 처리되지 않은 묶음이고, 되돌린 묶음과 새 묶음이 함께 있으면 가장 최근에 만든 묶음이다.
   * 게시 중 묶음에는 합치지 않는다. 게시는 그대로 진행하고 새 멘션은 새 묶음이 된다.
   */
  private openBundleAt(place: string): MentionBundle | undefined {
    return this.bundles
      .filter((bundle) => !isProcessed(bundle.status) && bundle.status !== 'posting' && bundlePlaceKey(bundle) === place)
      .sort((a, b) => b.id - a.id)[0];
  }

  /** 듣는 쪽에 묶음이 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 멘션 하나로 시작하는 새 묶음. 저장소 매핑을 확인한 결과로 생성 중이나 저장소 확인 필요로 올라온다. */
function newBundle(mention: Mention, now: number, resolution: RepoResolution | undefined): UnsavedBundle {
  return {
    id: null,
    postId: mention.postId,
    remarkId: mention.remarkId,
    projectId: mention.projectId,
    ...statusWithoutDraft(resolution ?? { kind: 'unmapped' }),
    postTitle: '',
    connectUrl: null,
    mentions: [],
    answers: [],
    newMentionCount: 0,
    createdAt: now,
    processedAt: null,
    context: null,
    watchedContext: null,
    userRepos: null,
    draft: null,
    editedText: null,
    removedRecipients: [],
    directives: [],
    fixedRequirement: null,
    regeneration: null,
    failure: null,
    runs: [],
    posting: null,
  };
}

/** 실패 묶음을 다시 시도할 때 바꿀 것. 생성 중으로 올라 초안 대기열에 들어가고, 합쳐진 새 멘션도 이번 초안에 들어간다. */
const retried = { status: 'generating', failure: null, newMentionCount: 0 } as const satisfies Partial<MentionBundle>;

/**
 * 다시 만들 때 바로 지우는 것. 직전 초안과 편집본, 비교 기준(초안을 만들 때 넘긴 맥락)과 그것과 견주던 감시 내용이다.
 * 생성 중으로 올라 초안 대기열에 들어간다.
 */
const clearedForRegeneration = {
  status: 'generating',
  draft: null,
  editedText: null,
  context: null,
  watchedContext: null,
  failure: null,
  newMentionCount: 0,
} as const satisfies Partial<MentionBundle>;

/**
 * 준비됨 묶음을 `path` 경로로 다시 만들 때 바꿀 것. 직전 초안과 비교 기준을 지우고 다음 초안 실행에 넘길 재생성을 남긴다.
 * 지시를 덧붙이면 직전 결과를 남기고, 직전 초안이 자동 선택으로 정한 저장소였으면 선택 실행을 다시 돌리지 않게 그 저장소를 남긴다.
 */
function regenerationOf(bundle: Pick<MentionBundle, 'draft'>, path: RegenerationPath): Pick<MentionBundle, 'regeneration'> & typeof clearedForRegeneration {
  /** 직전 초안. */
  const draft = bundle.draft!;
  /** 재생성. */
  const regeneration: Regeneration = {
    path,
    previous: path === 'directive' ? structuredClone({ requirement: draft.requirement, paragraphs: draft.paragraphs, evidence: draft.evidence }) : null,
    autoSelected: draft.autoSelection ? { repositories: [...draft.repositories], autoSelection: structuredClone(draft.autoSelection) } : null,
  };
  return { ...clearedForRegeneration, regeneration };
}

/**
 * 재생성 경로에 따라 묶음의 지시와 고친 요구를 어떻게 바꿀지 정한다. 지금까지의 지시를 받아 바꿀 값을 돌려주는 함수다.
 * 다시 만들기는 지시를 두고 고친 요구를 지운다. 지시를 덧붙이면 끝에 더하고, 요구를 고치면 지시를 비운다.
 * 고친 요구는 한 문장이라 줄바꿈을 공백으로 잇는다. 앞뒤 공백을 뗀 지시나 고친 요구가 비었으면 `null`.
 */
function regenerationInputsOf(
  request: RegenerationRequest,
): ((directives: readonly string[]) => Pick<MentionBundle, 'directives' | 'fixedRequirement'>) | null {
  switch (request.path) {
    case 'again':
      return (directives) => ({ directives: [...directives], fixedRequirement: null });
    case 'directive': {
      /** 덧붙일 지시. */
      const directive = request.directive.trim();
      return directive === '' ? null : (directives) => ({ directives: [...directives, directive], fixedRequirement: null });
    }
    case 'requirement': {
      /** 고친 요구. */
      const requirement = request.requirement.trim().replace(/\s*\n\s*/g, ' ');
      return requirement === '' ? null : () => ({ directives: [], fixedRequirement: requirement });
    }
  }
}

/** 사용자가 고른 구성의 폴더가 지금 모두 있는지 본다. 매핑과 같은 모양으로 돌려준다. */
async function resolveUserRepos(repos: readonly string[]): Promise<RunRepos | Extract<RepoResolution, { kind: 'missing-folders' }>> {
  /** 없는 폴더. */
  const missing = await missingFolders(repos);
  return missing.length > 0 ? { kind: 'missing-folders', paths: missing } : { kind: 'user', repos: [...repos] };
}

/**
 * 초안이 없는 묶음이 저장소 매핑에 따라 갈 상태. 매핑의 폴더가 모두 있거나 매핑이 없으면(자동 선택) 초안을 만들러 생성 중으로 간다.
 * 매핑된 폴더가 사라졌으면 자동 선택으로 넘어가지 않고 "연결된 저장소 폴더를 찾을 수 없음" 사유로 저장소 확인 필요다.
 */
function statusWithoutDraft(resolution: RepoResolution): Pick<MentionBundle, 'status' | 'repoCheck'> {
  switch (resolution.kind) {
    case 'mapped':
    case 'unmapped':
      return { status: 'generating', repoCheck: null };
    case 'missing-folders':
      return { status: 'repo-check-needed', repoCheck: { kind: 'missing-folders', paths: [...resolution.paths] } };
  }
}

/**
 * 원문 영역에 보일 맥락을 감지·되돌리기 때 새로 조회하는 묶음인지 본다. 초안 없이 기다리는 저장소 확인 필요와 실패 묶음이다.
 * 생성 중 묶음은 초안 실행 직전에 조회하고, 준비됨 묶음의 맥락은 초안을 만들 때 넘긴 비교 기준이라 덮지 않는다.
 */
function showsContextWithoutDraft(bundle: MentionBundle): boolean {
  return bundle.draft === null && (bundle.status === 'repo-check-needed' || bundle.status === 'failed');
}

/**
 * 멘션을 넣은 묶음에 자리를 조회한 결과를 반영한다. 게시물 제목·주소와 내 답을 바꾸고 "이미 답함"을 다시 판정한다.
 * 기존 묶음에 합친 멘션 가운데 묶음에 남은 것이 있으면 그 송신자를 받는 사람에 다시 더하고, 묶음 상태에 따라 처리한다.
 * - 생성 중: 처음부터 다시 만드는 초안에 들어가므로 "새 멘션"으로 세지 않는다.
 * - 준비됨(초안·요구·지시를 손대지 않음): 합치고 자동으로 다시 만든다(다시 만들기).
 * - 실패: 합치고 자동으로 다시 시도한다. 재생성 중에 실패했으면 같은 재생성 입력으로 다시 만든다.
 * - 그 밖(손댄 준비됨, 저장소 확인 필요): 합치기만 하고 "새 멘션"을 센다.
 * 모든 멘션이 빠지면 이미 답함으로 옮긴다.
 */
function applyDetection(
  bundle: UnsavedBundle,
  added: ReadonlySet<string>,
  lookup: PlaceLookup | undefined,
  now: number,
  postedRanges: PostedAnswerRanges,
): UnsavedBundle {
  /** 반영한 묶음. */
  let next: UnsavedBundle = { ...bundle };
  if (lookup?.post) {
    next.postTitle = lookup.post.title || next.postTitle;
    next.connectUrl = lookup.post.connectUrl ?? next.connectUrl;
  }
  // 내 답을 조회하지 못했으면 이미 아는 답으로 판정한다. 모르는 답 때문에 멘션을 건너뛰지 않는다.
  if (lookup?.myAnswers) next.answers = mergeAnswers(next.answers, lookup.myAnswers);
  next.mentions = judgeAnswered(next.mentions, next.answers, postedRanges);

  /** 이번에 넣은 멘션 가운데 묶음에 남은 것. */
  const addedActive = next.mentions.filter((mention) => !mention.answered && added.has(mentionLocationKey(mention)));
  // 뺄 때는 이 새 요청이 없었으므로, 새 멘션의 송신자는 전에 받는 사람에서 뺐더라도 다시 더한다.
  next.removedRecipients = next.removedRecipients.filter((id) => !addedActive.some((mention) => isSameFlowUser(mention.senderId, id)));
  if (bundle.id !== null && addedActive.length > 0) next = { ...next, ...mergedNewMentions(next, addedActive.length) };
  if (activeMentions(next).length === 0) {
    next.status = 'already-answered';
    next.processedAt = now;
  }
  return next;
}

/** 변화 감시가 묶음 자리를 다시 조회해 본 것. */
type WatchObservation =
  /**
   * 맥락과 묶음 자리의 내 답을 조회했다. 내 답에서 이 PC의 다른 묶음이 게시한 글은 뺐다.
   * `goneMentions`는 사라진 멘션의 위치(`mentionLocationKey`)다.
   */
  | { kind: 'found'; context: BundleContext; myAnswers: MyAnswer[]; goneMentions: ReadonlySet<string> }
  /** 게시물이나 머리 댓글이 지워졌거나 볼 수 없어, 묶음의 멘션이 모두 사라졌다. */
  | { kind: 'gone' };

/**
 * 준비된 뒤의 변화 감시가 본 것을 묶음에 반영한다.
 * - 새로 찾은 내 답으로 "이미 답함"을 다시 판정한다(감지 때와 같은 규칙).
 * - 사라진 멘션은 묶음에서 뺀다. 되돌릴 때 사라진 것으로 기록한 멘션은 다시 빼지 않는다.
 * - 남아 있던 멘션이 모두 빠지면 처리됨으로 옮기고 초안은 편집본까지 그대로 둔다. 하나라도 내 답으로 빠졌으면 "이미 답함", 아니면 "원문 사라짐"이다.
 * - 조회한 맥락은 초안이 있으면 비교 기준과 견줄 감시 내용으로, 초안이 없으면 원문 영역에 보일 맥락으로 둔다.
 */
function applyWatch(bundle: MentionBundle, observed: WatchObservation, now: number, postedRanges: PostedAnswerRanges): MentionBundle {
  /** 새로 찾은 내 답을 더한 기록. */
  const answers = observed.kind === 'found' ? mergeAnswers(bundle.answers, observed.myAnswers) : bundle.answers;
  /** 다시 판정한 멘션. */
  const mentions = judgeAnswered(bundle.mentions, answers, postedRanges).map((mention) => ({
    ...mention,
    gone: !mention.goneExcluded && (observed.kind === 'gone' || observed.goneMentions.has(mentionLocationKey(mention))),
  }));
  /** 반영한 묶음. */
  let next: MentionBundle = { ...bundle, answers, mentions };
  if (observed.kind === 'found') {
    /** 묶음에 남은 멘션을 표시한 맥락. */
    const context = markContextMentions(observed.context, next);
    next = bundle.draft ? { ...next, watchedContext: context } : { ...next, context };
  }

  /** 감시하기 전에 묶음에 남아 있던 멘션의 위치. */
  const wasActive = new Set(activeMentions(bundle).map(mentionLocationKey));
  if (wasActive.size > 0 && activeMentions(next).length === 0) {
    /** 이번에 내 답으로 빠진 멘션이 있는지 여부. */
    const answered = mentions.some((mention) => mention.answered && wasActive.has(mentionLocationKey(mention)));
    next = { ...next, status: answered ? 'already-answered' : 'source-gone', processedAt: now };
  }
  return next;
}

/** 두 묶음이 맥락을 조회한 시각 말고는 같은지 본다. 변화 감시가 바뀐 것 없이 매번 저장하고 알리지 않게 한다. */
function sameIgnoringFetchTime(a: MentionBundle, b: MentionBundle): boolean {
  /** 조회 시각을 지운 묶음의 JSON. */
  const comparable = (bundle: MentionBundle) =>
    JSON.stringify({
      ...bundle,
      context: bundle.context && { ...bundle.context, fetchedAt: 0 },
      watchedContext: bundle.watchedContext && { ...bundle.watchedContext, fetchedAt: 0 },
    });
  return comparable(a) === comparable(b);
}

/**
 * 기존 묶음에 묶음에 남는 새 멘션 `count`건을 합칠 때 상태에 따라 바꿀 것. 생성 중 묶음은 대기열이 처음부터 다시 만들므로 바꾸지 않는다.
 * 손대지 않은 준비됨은 다시 만들기로, 실패는 다시 시도로 생성 중에 올리고, 그 밖에는 "새 멘션"만 센다.
 */
function mergedNewMentions(bundle: UnsavedBundle, count: number): Partial<MentionBundle> {
  switch (bundle.status) {
    case 'generating':
      return {};
    case 'ready':
      if (bundle.draft && !isDraftTouched(bundle)) return regenerationOf(bundle, 'again');
      break;
    case 'failed':
      return retried;
    default:
      break;
  }
  return { newMentionCount: bundle.newMentionCount + count };
}

/** 새로 조회한 내 답으로 기록을 바꾼다. 되돌릴 때 빼기로 기록한 답은 그대로 남기고, Flow에서 지워진 답은 뺀다. */
function mergeAnswers(recorded: readonly RecordedAnswer[], fetched: readonly MyAnswer[]): RecordedAnswer[] {
  /** 빼기로 기록한 답. */
  const excluded = recorded.filter((answer) => answer.excluded);
  /** 빼기로 기록한 답의 ID. */
  const excludedIds = new Set(excluded.map((answer) => answer.answerId));
  return [...excluded, ...fetched.filter((answer) => !excludedIds.has(answer.answerId)).map((answer) => ({ ...answer, excluded: false }))];
}

/** Flow에 내 답이 생겼거나 멘션이 사라져 자동으로 처리됨이 된 상태인지 본다. 되돌릴 때 그 까닭을 기록해 이후 판정에서 뺀다. */
function isAutoProcessed(status: BundleStatus): boolean {
  return status === 'already-answered' || status === 'source-gone';
}

/** 사라진 멘션을 사라짐 판정에서 빼기로 기록한다. 기록한 멘션은 다시 묶음에 든다. */
function excludeGone(mention: BundledMention): BundledMention {
  return mention.gone ? { ...mention, gone: false, goneExcluded: true } : mention;
}

/** 기록한 답과 지금 Flow에 있는 답을 모두 빼기로 기록한다. */
function excludeAnswers(recorded: readonly RecordedAnswer[], current: readonly MyAnswer[]): RecordedAnswer[] {
  /** 이미 기록한 답의 ID. */
  const recordedIds = new Set(recorded.map((answer) => answer.answerId));
  return [
    ...recorded.map((answer) => ({ ...answer, excluded: true })),
    ...current.filter((answer) => !recordedIds.has(answer.answerId)).map((answer) => ({ ...answer, excluded: true })),
  ];
}

/** 묶음에서 답할 멘션(가장 최근 멘션)의 송신자 이름. 모르면 빈 문자열. */
function latestSenderName(bundle: MentionBundle): string {
  return activeMentions(bundle).at(-1)?.senderName ?? '';
}

/** 새로 저장소 확인 필요가 된 묶음의 OS 알림. 송신자 이름만 넣고 Flow 글 본문은 넣지 않는다. 누르면 첫 묶음을 연다. */
function repoCheckNotification(waiting: readonly MentionBundle[]): AppNotification {
  /** 대기열에서 가장 앞의 묶음. */
  const first = waiting[0]!;
  /** 그 묶음에서 답할 멘션의 송신자 이름. */
  const sender = latestSenderName(first);
  if (waiting.length === 1) {
    return {
      title: '저장소 확인 필요',
      body: sender ? `${sender}님이 나를 멘션했습니다.` : '나를 지목한 멘션이 왔습니다.',
      bundleId: first.id,
    };
  }
  return {
    title: `저장소 확인 필요 ${waiting.length}건`,
    body: sender ? `${sender}님 외 ${waiting.length - 1}건의 멘션이 왔습니다.` : `나를 지목한 멘션 ${waiting.length}건이 왔습니다.`,
    bundleId: first.id,
  };
}

/** 초안이 준비된 묶음의 OS 알림. 송신자 이름만 넣고 Flow 글 본문과 초안은 넣지 않는다. 누르면 그 묶음을 연다. */
function draftReadyNotification(bundle: MentionBundle): AppNotification {
  /** 답할 멘션의 송신자 이름. */
  const sender = latestSenderName(bundle);
  return {
    title: '초안 준비됨',
    body: sender ? `${sender}님 멘션에 답할 초안이 준비됐습니다.` : '나를 지목한 멘션에 답할 초안이 준비됐습니다.',
    bundleId: bundle.id,
  };
}
