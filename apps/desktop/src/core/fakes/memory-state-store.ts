import { mentionLocationKey, type Mention, type MentionLocation } from '../detection/mention';
import { compareAlarmIds } from '../flow/alarm-id';
import type { FlowEmployee } from '../ports/flow-api';
import type { StateStore } from '../ports/state-store';

/** 메모리에만 두는 상태 저장소. */
export class MemoryStateStore implements StateStore {
  /** 저장한 계정. */
  account: FlowEmployee | null = null;
  /** 저장한 기준점. */
  baselineAlarmId: string | null = null;
  /** 저장한 멘션. 멘션 위치마다 하나다. */
  private readonly mentions = new Map<string, Mention>();

  async getAccount(): Promise<FlowEmployee | null> {
    return this.account && { ...this.account };
  }

  async setAccount(account: FlowEmployee): Promise<void> {
    this.account = { ...account };
  }

  async resetForAccount(account: FlowEmployee): Promise<void> {
    this.baselineAlarmId = null;
    this.mentions.clear();
    this.account = { ...account };
  }

  async getBaselineAlarmId(): Promise<string | null> {
    return this.baselineAlarmId;
  }

  async setBaselineAlarmId(alarmId: string): Promise<void> {
    this.baselineAlarmId = alarmId;
  }

  async hasMentionLocation(location: MentionLocation): Promise<boolean> {
    return this.mentions.has(mentionLocationKey(location));
  }

  async addDetectedMentions(mentions: readonly Mention[], baselineAlarmId: string): Promise<Mention[]> {
    /** 새로 저장한 멘션. */
    const added = mentions.filter((mention) => !this.mentions.has(mentionLocationKey(mention)));
    for (const mention of added) this.mentions.set(mentionLocationKey(mention), { ...mention });
    this.baselineAlarmId = baselineAlarmId;
    return added.map((mention) => ({ ...mention }));
  }

  async listMentions(): Promise<Mention[]> {
    return [...this.mentions.values()]
      .sort((a, b) => a.registeredDateTime.localeCompare(b.registeredDateTime) || compareAlarmIds(a.alarmId, b.alarmId))
      .map((mention) => ({ ...mention }));
  }

  async countMentions(): Promise<number> {
    return this.mentions.size;
  }
}
