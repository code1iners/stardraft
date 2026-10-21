import { compareMentions, type MentionBundle, type MinimalRecord, type UnsavedBundle } from '../bundles/mention-bundle';
import { mentionLocationKey, type MentionLocation } from '../detection/mention';
import type { FlowEmployee } from '../ports/flow-api';
import type { StateStore } from '../ports/state-store';

/** 메모리에만 두는 상태 저장소. */
export class MemoryStateStore implements StateStore {
  /** 저장한 계정. */
  account: FlowEmployee | null = null;
  /** 저장한 기준점. */
  baselineAlarmId: string | null = null;
  /** 저장한 멘션 묶음. 묶음 ID마다 하나다. */
  private readonly bundles = new Map<number, MentionBundle>();
  /** 처리됨 목록에서 빠진 묶음의 최소 기록. 묶음 ID마다 하나다. */
  private readonly records = new Map<number, MinimalRecord>();
  /** 다음에 줄 묶음 ID. 지운 ID를 다시 쓰지 않는다. */
  private nextBundleId = 1;

  async getAccount(): Promise<FlowEmployee | null> {
    return this.account && { ...this.account };
  }

  async setAccount(account: FlowEmployee): Promise<void> {
    this.account = { ...account };
  }

  async resetForAccount(account: FlowEmployee): Promise<void> {
    this.baselineAlarmId = null;
    this.bundles.clear();
    this.records.clear();
    this.account = { ...account };
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
    return [...this.bundles.values(), ...this.records.values()].some((item) =>
      item.mentions.some((mention) => mentionLocationKey(mention) === key),
    );
  }

  async listBundles(): Promise<MentionBundle[]> {
    return [...this.bundles.values()].sort((a, b) => a.id - b.id).map(cloneBundle);
  }

  async saveDetectedBundles(bundles: readonly UnsavedBundle[], baselineAlarmId: string): Promise<MentionBundle[]> {
    // SQLite 저장소처럼, 다른 묶음에 이미 든 멘션 위치가 있으면 아무것도 바꾸지 않고 실패한다.
    for (const bundle of bundles) this.assertOwnLocations(bundle);

    /** 저장한 묶음. */
    const saved = bundles.map((bundle) => ({ ...cloneBundle(bundle as MentionBundle), id: bundle.id ?? this.nextBundleId++ }));
    for (const bundle of saved) this.bundles.set(bundle.id, sortedMentions(bundle));
    this.baselineAlarmId = baselineAlarmId;
    return saved.map(cloneBundle);
  }

  async saveBundle(bundle: MentionBundle): Promise<void> {
    if (!this.bundles.has(bundle.id)) throw new Error(`저장하지 않은 묶음 ${bundle.id}입니다.`);
    this.assertOwnLocations(bundle);
    this.bundles.set(bundle.id, sortedMentions(cloneBundle(bundle)));
  }

  async listMinimalRecords(): Promise<MinimalRecord[]> {
    return [...this.records.values()].sort((a, b) => a.bundleId - b.bundleId).map((record) => structuredClone(record));
  }

  async archiveBundles(records: readonly MinimalRecord[]): Promise<void> {
    // SQLite 저장소처럼, 저장하지 않은 묶음이 하나라도 있으면 아무것도 바꾸지 않고 실패한다.
    for (const record of records) {
      if (!this.bundles.has(record.bundleId)) throw new Error(`저장하지 않은 묶음 ${record.bundleId}입니다.`);
    }
    for (const record of records) {
      this.bundles.delete(record.bundleId);
      this.records.set(record.bundleId, structuredClone(record));
    }
  }

  /** 묶음의 멘션 위치가 다른 묶음에 이미 들어 있으면 실패한다. */
  private assertOwnLocations(bundle: UnsavedBundle): void {
    for (const other of this.bundles.values()) {
      if (other.id === bundle.id) continue;
      /** 다른 묶음의 멘션 위치. */
      const taken = new Set(other.mentions.map(mentionLocationKey));
      if (bundle.mentions.some((mention) => taken.has(mentionLocationKey(mention)))) {
        throw new Error(`멘션 위치가 이미 묶음 ${other.id}에 있습니다.`);
      }
    }
  }
}

/** 묶음을 깊이 복사한다. 저장소 밖에서 바꿔도 저장한 값이 바뀌지 않게 한다. */
function cloneBundle(bundle: MentionBundle): MentionBundle {
  return structuredClone(bundle);
}

/** 멘션을 알림 시각 순서로 맞춘 묶음. */
function sortedMentions(bundle: MentionBundle): MentionBundle {
  return { ...bundle, mentions: [...bundle.mentions].sort(compareMentions) };
}
