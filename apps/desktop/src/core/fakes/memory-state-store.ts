import type { FlowEmployee } from '../ports/flow-api';
import type { StateStore } from '../ports/state-store';

/** 메모리에만 두는 상태 저장소. */
export class MemoryStateStore implements StateStore {
  /** 저장한 계정. */
  account: FlowEmployee | null = null;
  /** 저장한 기준점. */
  baselineAlarmId: string | null = null;

  async getAccount(): Promise<FlowEmployee | null> {
    return this.account && { ...this.account };
  }

  async setAccount(account: FlowEmployee): Promise<void> {
    this.account = { ...account };
  }

  async resetForAccount(account: FlowEmployee): Promise<void> {
    this.baselineAlarmId = null;
    this.account = { ...account };
  }

  async getBaselineAlarmId(): Promise<string | null> {
    return this.baselineAlarmId;
  }

  async setBaselineAlarmId(alarmId: string): Promise<void> {
    this.baselineAlarmId = alarmId;
  }
}
