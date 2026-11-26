import type { AssignmentState } from '../detection/assignment-detection';
import { compareMentions, type MentionBundle, type MinimalRecord, type UnsavedBundle } from '../bundles/mention-bundle';
import { mentionLocationKey, type MentionLocation } from '../detection/mention';
import { FLOW_TARGET_KIND } from '../drafts/flow-target-adapter';
import { isSameFlowUser } from '../flow/user-id';
import type { QueuedTarget } from '../generation/generation-run';
import type { FlowEmployee } from '../ports/flow-api';
import type { GenerationQueueStore } from '../ports/generation-queue-store';
import type { AccountSwitchResult, StateStore } from '../ports/state-store';
import type { UpdateAttempt } from '../update/update-restart';

/** 한 계정의 Flow 기록. SQLite 저장소처럼 계정마다 따로 보관한다. */
interface AccountRecords {
  /** 계정. 계정을 넣기 전의 기록이면 `null`. */
  profile: FlowEmployee | null;
  /** 보관할 때(떠날 때) 적은 마지막으로 쓴 시각. */
  lastUsedAt: number;
  /** 떠날 때의 비밀 파일 패턴. */
  secretPatterns: string[] | null;
  /** 감지 기준점. */
  baselineAlarmId: string | null;
  /** 담당 업무 감지 상태. */
  assignmentState: AssignmentState | null;
  /** 이미 묶음을 만든 업무. 묶음 보관 기간과 독립적이다. */
  assignmentTasks: Set<string>;
  /** 이 계정의 묶음 ID. */
  bundleIds: Set<number>;
  /** 이 계정의 최소 기록. 묶음 ID마다 하나다. */
  records: Map<number, MinimalRecord>;
  /** 이 계정의 대기열 Flow 줄. */
  flowQueue: QueuedTarget[];
}

/** 계정을 넣기 전의 기록이 쓰는 키. 처음 넣는 계정이 이어받는다. */
const NO_ACCOUNT = '';

/** 메모리에만 두는 상태 저장소. SQLite 저장소처럼 Flow 기록을 계정마다 보관하고 움직이는 계정의 기록만 다룬다. */
export class MemoryStateStore implements StateStore, GenerationQueueStore {
  /** 계정마다의 기록. 키는 계정의 사용자 ID다. */
  private readonly accounts = new Map<string, AccountRecords>([[NO_ACCOUNT, emptyRecords(null)]]);
  /** 움직이는 계정의 키. 계정을 넣기 전이면 빈 키다. */
  private activeKey = NO_ACCOUNT;
  /** 저장한 멘션 묶음 전부. 묶음 ID마다 하나다. 어느 계정의 것인지는 계정 기록이 안다. */
  private readonly bundles = new Map<number, MentionBundle>();
  /** 다음에 줄 묶음 ID. 지운 ID를 다시 쓰지 않는다. */
  private nextBundleId = 1;
  /** 계정에 매이지 않은 대기열 줄. */
  private unboundQueue: QueuedTarget[] = [];
  /** 서명 검증에 실패한 업데이트 버전들. 계정과 상관없다. */
  private readonly signatureFailedVersions = new Set<string>();
  /** 마지막 "업데이트 시도". 계정과 상관없다. */
  private updateAttempt: UpdateAttempt | null = null;

  /** 움직이는 계정. 테스트가 직접 넣으면 그 계정으로 연결된 것으로 본다(처음 넣는 계정이면 계정 없이 쌓인 기록을 이어받는다). */
  get account(): FlowEmployee | null {
    return this.active().profile;
  }

  set account(account: FlowEmployee | null) {
    if (account === null) {
      this.activeKey = NO_ACCOUNT;
      return;
    }
    this.activate(account, 0);
  }

  /** 움직이는 계정의 기준점. 테스트가 직접 읽고 쓴다. */
  get baselineAlarmId(): string | null {
    return this.active().baselineAlarmId;
  }

  set baselineAlarmId(alarmId: string | null) {
    this.active().baselineAlarmId = alarmId;
  }

  async getAssignmentState(): Promise<AssignmentState | null> {
    return structuredClone(this.active().assignmentState);
  }

  async setAssignmentState(state: AssignmentState): Promise<void> {
    if (this.account && isSameFlowUser(this.account.userId, state.accountId)) this.active().assignmentState = structuredClone(state);
  }

  async addAssignmentBundle(bundle: UnsavedBundle, accountId: string): Promise<MentionBundle | null> {
    if (!this.account || !isSameFlowUser(this.account.userId, accountId) || !bundle.assignment) return null;
    /** 업무 키. */
    const key = JSON.stringify([bundle.projectId, bundle.assignment.taskId]);
    if (this.active().assignmentTasks.has(key)) return null;
    /** 멘션 기준점을 바꾸지 않는 저장. */
    const saved = { ...structuredClone(bundle), id: bundle.id ?? this.nextBundleId++ };
    this.putBundle(sortedMentions(saved));
    this.active().assignmentTasks.add(key);
    return saved;
  }

  async getAccount(): Promise<FlowEmployee | null> {
    return this.account && { ...this.account };
  }

  async setAccount(account: FlowEmployee): Promise<void> {
    if (this.account && !isSameFlowUser(this.account.userId, account.userId)) throw new Error('다른 계정은 계정 바꾸기로만 연결합니다.');
    this.activate(account, 0);
  }

  async switchAccount(account: FlowEmployee, { now, secretPatterns }: { now: number; secretPatterns: readonly string[] }): Promise<AccountSwitchResult> {
    /** 떠나는 계정의 기록. */
    const leaving = this.account ? this.active() : null;
    if (leaving) {
      leaving.lastUsedAt = now;
      leaving.secretPatterns = [...secretPatterns];
    }
    /** 보관해 둔 계정이면 그 기록. */
    const stored = this.storedKeyOf(account.userId);
    /** 돌아온 계정이 떠날 때의 패턴. */
    const secretPatternsWhenLeft = stored === null ? null : (this.accounts.get(stored)!.secretPatterns ?? null);
    if (leaving) this.activeKey = NO_ACCOUNT;
    this.activate(account, now);
    return { returning: stored !== null, secretPatternsWhenLeft: secretPatternsWhenLeft && [...secretPatternsWhenLeft] };
  }

  async isStoredAccount(userId: string): Promise<boolean> {
    return this.storedKeyOf(userId) !== null;
  }

  async deleteAccountsUnusedBefore(cutoff: number): Promise<number> {
    /** 지울 계정. */
    const expired = [...this.accounts].filter(([key, records]) => key !== NO_ACCOUNT && key !== this.activeKey && records.lastUsedAt < cutoff);
    for (const [key, records] of expired) {
      for (const bundleId of records.bundleIds) this.bundles.delete(bundleId);
      this.accounts.delete(key);
    }
    return expired.length;
  }

  async listStoredBundles(): Promise<MentionBundle[]> {
    /** 보관 중인 계정들의 묶음 ID. */
    const ids = new Set([...this.accounts].filter(([key]) => key !== NO_ACCOUNT && key !== this.activeKey).flatMap(([, records]) => [...records.bundleIds]));
    return [...this.bundles.values()].filter((bundle) => ids.has(bundle.id)).sort((a, b) => a.id - b.id).map(cloneBundle);
  }

  async getBaselineAlarmId(): Promise<string | null> {
    return this.baselineAlarmId;
  }

  async setBaselineAlarmId(alarmId: string): Promise<void> {
    this.baselineAlarmId = alarmId;
  }

  async hasMentionLocation(location: MentionLocation): Promise<boolean> {
    /** 찾는 멘션 위치. */
    const key = mentionLocationKey(location);
    return [...this.activeBundles(), ...this.active().records.values()].some((item) =>
      item.mentions.some((mention) => mentionLocationKey(mention) === key),
    );
  }

  async listBundles(): Promise<MentionBundle[]> {
    return this.activeBundles().sort((a, b) => a.id - b.id).map(cloneBundle);
  }

  async saveDetectedBundles(bundles: readonly UnsavedBundle[], baselineAlarmId: string): Promise<MentionBundle[]> {
    // SQLite 저장소처럼, 다른 묶음에 이미 든 멘션 위치가 있으면 아무것도 바꾸지 않고 실패한다.
    for (const bundle of bundles) this.assertOwnLocations(bundle);

    /** 저장한 묶음. */
    const saved = bundles.map((bundle) => ({ ...cloneBundle(bundle as MentionBundle), id: bundle.id ?? this.nextBundleId++ }));
    for (const bundle of saved) this.putBundle(sortedMentions(bundle));
    this.baselineAlarmId = baselineAlarmId;
    return saved.map(cloneBundle);
  }

  async addManualBundle(bundle: UnsavedBundle, replacedRecordIds: readonly number[]): Promise<MentionBundle> {
    // SQLite 저장소처럼, 다른 묶음에 이미 든 멘션 위치가 있으면 최소 기록도 지우지 않고 실패한다.
    this.assertOwnLocations(bundle);
    for (const recordId of replacedRecordIds) this.active().records.delete(recordId);
    /** 저장한 묶음. */
    const saved = { ...cloneBundle(bundle as MentionBundle), id: this.nextBundleId++, manual: true };
    this.putBundle(sortedMentions(saved));
    if (bundle.assignment) this.active().assignmentTasks.add(JSON.stringify([bundle.projectId, bundle.assignment.taskId]));
    return cloneBundle(saved);
  }

  async saveBundle(bundle: MentionBundle): Promise<void> {
    if (!this.active().bundleIds.has(bundle.id)) throw new Error(`저장하지 않은 묶음 ${bundle.id}입니다.`);
    this.assertOwnLocations(bundle);
    this.bundles.set(bundle.id, sortedMentions(cloneBundle(bundle)));
  }

  async listMinimalRecords(): Promise<MinimalRecord[]> {
    return [...this.active().records.values()].sort((a, b) => a.bundleId - b.bundleId).map((record) => structuredClone(record));
  }

  async archiveBundles(records: readonly MinimalRecord[]): Promise<void> {
    // SQLite 저장소처럼, 저장하지 않은 묶음이 하나라도 있으면 아무것도 바꾸지 않고 실패한다. 최소 기록은 그 묶음의 계정에 남는다.
    for (const record of records) {
      if (!this.bundles.has(record.bundleId)) throw new Error(`저장하지 않은 묶음 ${record.bundleId}입니다.`);
    }
    for (const record of records) {
      /** 묶음의 계정 기록. */
      const owner = [...this.accounts.values()].find((item) => item.bundleIds.has(record.bundleId))!;
      this.bundles.delete(record.bundleId);
      owner.bundleIds.delete(record.bundleId);
      owner.records.set(record.bundleId, structuredClone(record));
    }
  }

  async deleteBundles(bundleIds: readonly number[]): Promise<void> {
    // SQLite 저장소처럼, 저장하지 않은 묶음이 하나라도 있으면 아무것도 지우지 않고 실패한다.
    for (const bundleId of bundleIds) {
      if (!this.active().bundleIds.has(bundleId)) throw new Error(`저장하지 않은 묶음 ${bundleId}입니다.`);
    }
    for (const bundleId of bundleIds) {
      this.bundles.delete(bundleId);
      this.active().bundleIds.delete(bundleId);
    }
  }

  async getGenerationQueue(): Promise<QueuedTarget[]> {
    return structuredClone([...this.active().flowQueue, ...this.unboundQueue]);
  }

  async setGenerationQueue(queue: readonly QueuedTarget[]): Promise<void> {
    this.active().flowQueue = structuredClone(queue.filter((queued) => queued.kind === FLOW_TARGET_KIND));
    this.unboundQueue = structuredClone(queue.filter((queued) => queued.kind !== FLOW_TARGET_KIND));
  }

  async getSignatureFailedVersions(): Promise<string[]> {
    return [...this.signatureFailedVersions];
  }

  async addSignatureFailedVersion(version: string): Promise<void> {
    this.signatureFailedVersions.add(version);
  }

  async removeSignatureFailedVersion(version: string): Promise<void> {
    this.signatureFailedVersions.delete(version);
  }

  async getUpdateAttempt(): Promise<UpdateAttempt | null> {
    return this.updateAttempt && { ...this.updateAttempt };
  }

  async setUpdateAttempt(attempt: UpdateAttempt): Promise<void> {
    this.updateAttempt = { ...attempt };
  }

  async clearUpdateAttempt(): Promise<void> {
    this.updateAttempt = null;
  }

  /** 움직이는 계정의 기록. */
  private active(): AccountRecords {
    return this.accounts.get(this.activeKey)!;
  }

  /** 움직이는 계정의 묶음. */
  private activeBundles(): MentionBundle[] {
    /** 움직이는 계정의 묶음 ID. */
    const ids = this.active().bundleIds;
    return [...this.bundles.values()].filter((bundle) => ids.has(bundle.id));
  }

  /** 묶음을 움직이는 계정의 것으로 넣거나 바꾼다. */
  private putBundle(bundle: MentionBundle): void {
    this.bundles.set(bundle.id, bundle);
    this.active().bundleIds.add(bundle.id);
  }

  /** 보관 중인(움직이지 않는) 같은 사람의 계정 키. 없으면 `null`. */
  private storedKeyOf(userId: string): string | null {
    for (const key of this.accounts.keys()) {
      if (key !== NO_ACCOUNT && key !== this.activeKey && isSameFlowUser(key, userId)) return key;
    }
    return null;
  }

  /** 계정을 움직이는 계정으로 둔다. 계정을 넣기 전이었으면 계정 없이 쌓인 기록을 이어받는다. */
  private activate(account: FlowEmployee, now: number): void {
    /** 같은 사람의 기존 키. */
    const existing = [...this.accounts.keys()].find((key) => key !== NO_ACCOUNT && isSameFlowUser(key, account.userId));
    if (existing) {
      this.accounts.get(existing)!.profile = { ...account, userId: existing };
      this.accounts.get(existing)!.secretPatterns = null;
      this.activeKey = existing;
      return;
    }
    /** 새 계정의 기록. 계정을 넣기 전이었으면 그 기록을 이어받는다. */
    const records = this.activeKey === NO_ACCOUNT ? this.accounts.get(NO_ACCOUNT)! : emptyRecords(null);
    records.profile = { ...account };
    records.lastUsedAt = now;
    if (this.activeKey === NO_ACCOUNT) this.accounts.set(NO_ACCOUNT, emptyRecords(null));
    this.accounts.set(account.userId, records);
    this.activeKey = account.userId;
  }

  /** 묶음의 멘션 위치가 같은 계정의 다른 묶음에 이미 들어 있으면 실패한다. */
  private assertOwnLocations(bundle: UnsavedBundle): void {
    for (const other of this.activeBundles()) {
      if (other.id === bundle.id) continue;
      /** 다른 묶음의 멘션 위치. */
      const taken = new Set(other.mentions.map(mentionLocationKey));
      if (bundle.mentions.some((mention) => taken.has(mentionLocationKey(mention)))) {
        throw new Error(`멘션 위치가 이미 묶음 ${other.id}에 있습니다.`);
      }
    }
  }
}

/** 빈 계정 기록. */
function emptyRecords(profile: FlowEmployee | null): AccountRecords {
  return {
    profile,
    lastUsedAt: 0,
    secretPatterns: null,
    baselineAlarmId: null,
    assignmentState: null,
    assignmentTasks: new Set(),
    bundleIds: new Set(),
    records: new Map(),
    flowQueue: [],
  };
}

/** 묶음을 깊이 복사한다. 저장소 밖에서 바꿔도 저장한 값이 바뀌지 않게 한다. */
function cloneBundle(bundle: MentionBundle): MentionBundle {
  return structuredClone(bundle);
}

/** 멘션을 알림 시각 순서로 맞춘 묶음. */
function sortedMentions(bundle: MentionBundle): MentionBundle {
  return { ...bundle, mentions: [...bundle.mentions].sort(compareMentions) };
}
