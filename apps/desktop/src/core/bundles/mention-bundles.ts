import type { BundleContext, BundleContextResult } from '../flow/bundle-context';
import { mentionLocationKey, type Mention } from '../detection/mention';
import type { MyAnswer, PlaceLookup } from '../flow/mention-judgement';
import type { Logger } from '../logging/logger';
import type { Clock } from '../ports/clock';
import type { AppNotification, Notifier } from '../ports/notifier';
import type { StateStore } from '../ports/state-store';
import { SerialQueue } from '../serial-queue';
import {
  activeMentions,
  bundlePlaceKey,
  compareBundles,
  compareMentions,
  countsForReview,
  isProcessed,
  isRestorable,
  judgeAnswered,
  type BundlePlace,
  type MentionBundle,
  type RecordedAnswer,
  type UnsavedBundle,
} from './mention-bundle';

/** 멘션 묶음에 필요한 포트. */
export interface MentionBundlesOptions {
  /** 묶음을 두는 상태 저장소. */
  stateStore: StateStore;
  /** 저장소 확인 필요 묶음을 알릴 OS 알림. */
  notifier: Notifier;
  /** 묶음을 만들고 처리한 시각을 읽는 시계. */
  clock: Clock;
  /** 진단 로그. ID와 개수만 남긴다. */
  logger: Logger;
  /** 지금 키로 묶음 자리의 내 답을 Flow에서 조회한다. 쓸 키가 없거나 조회하지 못하면 `null`. 이미 답함에서 되돌릴 때 쓴다. */
  findMyAnswers: (place: BundlePlace) => Promise<MyAnswer[] | null>;
  /** 지금 키로 묶음의 맥락을 Flow에서 새로 조회한다. 쓸 키가 없으면 `null`. */
  collectContext: (bundle: MentionBundle) => Promise<BundleContextResult | null>;
}

/**
 * 멘션 묶음. 감지한 멘션을 묶음 자리(`postId`, `remarkId`)로 묶고, 무시와 되돌리기를 처리한다.
 * 작은 창 대기열, 펼친 창 목록, 트레이 숫자, 저장소 확인 필요 OS 알림이 이 상태를 따른다.
 * 묶음을 바꾸는 일은 감지와 사용자 행동이 서로 끼어들지 않게 맡긴 순서대로 하나씩 한다.
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

  /** 트레이 숫자. 검토 대기 가운데 준비됨과 저장소 확인 필요 묶음 수다. */
  reviewCount(): number {
    return this.bundles.filter((bundle) => countsForReview(bundle.status)).length;
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
   * 자리마다 `lookups`의 내 답으로 "이미 답함"을 판정하고, 모든 멘션이 빠진 묶음은 초안 없이 이미 답함으로 둔다.
   * 새로 저장소 확인 필요가 된 묶음이 있으면 OS 알림을 하나 띄운다.
   */
  async addDetected(mentions: readonly Mention[], lookups: ReadonlyMap<string, PlaceLookup>, baselineAlarmId: string): Promise<void> {
    /** 멘션을 넣어 처리되지 않은 채로 남은 묶음. 맥락을 새로 조회한다. */
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
          entry = { bundle: open ? structuredClone(open) : newBundle(mention, now), added: new Set() };
          touched.set(place, entry);
        }
        entry.bundle.mentions.push({ ...mention, answered: false });
        entry.added.add(location);
      }

      /** 저장할 묶음. */
      const updated = [...touched].map(([place, { bundle, added }]) => applyDetection(bundle, added, lookups.get(place), now));
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

      /** 새로 저장소 확인 필요가 된 묶음. 대기열 순서다. */
      const waiting = saved.filter((bundle) => createdIds.has(bundle.id) && countsForReview(bundle.status)).sort(compareBundles);
      if (waiting.length > 0) this.options.notifier.notify(repoCheckNotification(waiting));
      return saved.filter((bundle) => !isProcessed(bundle.status)).map((bundle) => bundle.id);
    });
    // 묶음이 바뀌면 초안을 새로 만드므로, 그때 넘길 맥락을 Flow에서 새로 조회한다.
    await this.refreshContexts(changed);
  }

  /**
   * 묶음들의 맥락을 Flow에서 새로 조회해 비교 기준으로 저장한다. 감지 때 받은 내용은 쓰지 않는다.
   * 조회하지 못한 묶음은 전에 저장한 맥락을 그대로 둔다. 같은 묶음을 거듭 조회하면 마지막으로 시작한 조회의 결과만 저장한다.
   * 조회한 묶음들은 한 번에 저장해 듣는 쪽에 한 번 알린다.
   */
  async refreshContexts(bundleIds: readonly number[]): Promise<void> {
    /** 묶음마다 조회한 결과. 저장할 것만 남는다. */
    const fetched = await Promise.all(bundleIds.map((bundleId) => this.fetchContext(bundleId)));
    /** 묶음 ID마다 저장할 맥락. */
    const contexts = new Map(fetched.filter((item) => item !== null).map(({ bundleId, context }) => [bundleId, context]));
    if (contexts.size === 0) return;

    await this.lane.run(async () => {
      /** 맥락을 바꾼 묶음. */
      const next = this.bundles.filter((bundle) => contexts.has(bundle.id)).map((bundle) => ({ ...bundle, context: contexts.get(bundle.id)! }));
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
    const request = this.nextContextRequest++;
    this.contextRequests.set(bundleId, request);

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

  /** 묶음을 무시한다. 처리됨의 "무시함"이 되고, 7일 안에 되돌릴 수 있다. 이미 처리됨이면 아무것도 하지 않는다. */
  ignore(bundleId: number): Promise<void> {
    return this.change(bundleId, 'bundle.ignored', (bundle) => {
      if (isProcessed(bundle.status)) return null;
      return { ...bundle, status: 'ignored', processedAt: this.options.clock.now() };
    });
  }

  /**
   * 무시함이나 이미 답함에서 되돌린다. 초안이 없으므로 저장소 확인 필요로 돌아간다.
   * 이미 답함에서 되돌리면 그때 Flow에 있는 내 답을 새로 조회해 이후 "이미 답함" 판정에서 빼기로 기록한다.
   * 같은 답으로 다시 처리됨이 되지 않게 하려는 것이고, 그 답으로 빠졌던 멘션도 다시 든다. 조회하지 못하면 판정 때 기록한 답만 뺀다.
   * 무시함에서 되돌리면 답을 빼지 않아, 이미 답한 앞선 멘션은 빠진 채로 둔다.
   */
  async restore(bundleId: number): Promise<void> {
    /** 되돌릴 묶음. */
    const bundle = this.bundles.find((item) => item.id === bundleId);
    if (!bundle || !isRestorable(bundle.status)) return;
    /** 지금 Flow에 있는 내 답. 이미 답함이 아니거나 조회하지 못하면 `null`. */
    const current = bundle.status === 'already-answered' ? await this.options.findMyAnswers(bundle).catch(() => null) : null;

    // 조회하는 사이에 상태가 바뀌었을 수 있으므로 줄에 들어가 지금 값으로 다시 본다.
    await this.change(bundleId, 'bundle.restored', (latest) => {
      if (!isRestorable(latest.status)) return null;
      /** 되돌린 뒤의 내 답 기록. */
      const answers = latest.status === 'already-answered' ? excludeAnswers(latest.answers, current ?? []) : latest.answers;
      return {
        ...latest,
        status: 'repo-check-needed',
        processedAt: null,
        newMentionCount: 0,
        answers,
        mentions: judgeAnswered(latest.mentions, answers),
      };
    });
    // 되돌리면 초안을 새로 만드므로 맥락도 새로 조회한다.
    if (this.bundles.some((item) => item.id === bundleId && !isProcessed(item.status))) await this.refreshContexts([bundleId]);
  }

  /** 묶음 하나를 `update`로 바꿔 저장한다. `update`가 `null`을 돌려주면 바꾸지 않는다. 없는 묶음이면 아무것도 하지 않는다. */
  private change(bundleId: number, event: string, update: (bundle: MentionBundle) => MentionBundle | null): Promise<void> {
    return this.lane.run(async () => {
      /** 바꿀 묶음. */
      const bundle = this.bundles.find((item) => item.id === bundleId);
      /** 바꾼 묶음. */
      const next = bundle && update(structuredClone(bundle));
      if (!next) return;

      await this.options.stateStore.saveBundle(next);
      this.bundles = this.bundles.map((item) => (item.id === bundleId ? next : item));
      this.options.logger.info(event, { bundleId, status: next.status });
      this.emit();
    });
  }

  /** 자리의 처리되지 않은 묶음. 되돌린 묶음과 새 묶음이 함께 있으면 가장 최근에 만든 묶음이다. */
  private openBundleAt(place: string): MentionBundle | undefined {
    return this.bundles
      .filter((bundle) => !isProcessed(bundle.status) && bundlePlaceKey(bundle) === place)
      .sort((a, b) => b.id - a.id)[0];
  }

  /** 듣는 쪽에 묶음이 바뀌었다고 알린다. */
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** 멘션 하나로 시작하는 새 묶음. 초안을 아직 만들지 않으므로 저장소 확인 필요로 올라온다. */
function newBundle(mention: Mention, now: number): UnsavedBundle {
  return {
    id: null,
    postId: mention.postId,
    remarkId: mention.remarkId,
    projectId: mention.projectId,
    status: 'repo-check-needed',
    postTitle: '',
    connectUrl: null,
    mentions: [],
    answers: [],
    newMentionCount: 0,
    createdAt: now,
    processedAt: null,
    context: null,
  };
}

/**
 * 멘션을 넣은 묶음에 자리를 조회한 결과를 반영한다. 게시물 제목·주소와 내 답을 바꾸고 "이미 답함"을 다시 판정한다.
 * 기존 묶음에 합친 멘션 가운데 묶음에 남은 수만큼 "새 멘션"을 늘리고, 모든 멘션이 빠지면 이미 답함으로 옮긴다.
 */
function applyDetection(bundle: UnsavedBundle, added: ReadonlySet<string>, lookup: PlaceLookup | undefined, now: number): UnsavedBundle {
  /** 반영한 묶음. */
  const next: UnsavedBundle = { ...bundle };
  if (lookup?.post) {
    next.postTitle = lookup.post.title || next.postTitle;
    next.connectUrl = lookup.post.connectUrl ?? next.connectUrl;
  }
  // 내 답을 조회하지 못했으면 이미 아는 답으로 판정한다. 모르는 답 때문에 멘션을 건너뛰지 않는다.
  if (lookup?.myAnswers) next.answers = mergeAnswers(next.answers, lookup.myAnswers);
  next.mentions = judgeAnswered(next.mentions, next.answers);

  /** 이번에 넣은 멘션 가운데 묶음에 남은 수. */
  const addedActive = next.mentions.filter((mention) => !mention.answered && added.has(mentionLocationKey(mention))).length;
  if (bundle.id !== null) next.newMentionCount += addedActive;
  if (activeMentions(next).length === 0) {
    next.status = 'already-answered';
    next.processedAt = now;
  }
  return next;
}

/** 새로 조회한 내 답으로 기록을 바꾼다. 되돌릴 때 빼기로 기록한 답은 그대로 남기고, Flow에서 지워진 답은 뺀다. */
function mergeAnswers(recorded: readonly RecordedAnswer[], fetched: readonly MyAnswer[]): RecordedAnswer[] {
  /** 빼기로 기록한 답. */
  const excluded = recorded.filter((answer) => answer.excluded);
  /** 빼기로 기록한 답의 ID. */
  const excludedIds = new Set(excluded.map((answer) => answer.answerId));
  return [...excluded, ...fetched.filter((answer) => !excludedIds.has(answer.answerId)).map((answer) => ({ ...answer, excluded: false }))];
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

/** 새로 저장소 확인 필요가 된 묶음의 OS 알림. 송신자 이름만 넣고 Flow 글 본문은 넣지 않는다. 누르면 첫 묶음을 연다. */
function repoCheckNotification(waiting: readonly MentionBundle[]): AppNotification {
  /** 대기열에서 가장 앞의 묶음. */
  const first = waiting[0]!;
  /** 그 묶음에서 답할 멘션(가장 최근 멘션)의 송신자 이름. */
  const sender = activeMentions(first).at(-1)?.senderName ?? '';
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
