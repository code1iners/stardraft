import type { StateStore } from '../ports/state-store';

/** 메모리에만 두는 상태 저장소. */
export class MemoryStateStore implements StateStore {
  /** 저장한 계정의 Flow 사용자 ID. */
  accountUserId: string | null = null;
  /** 저장한 기준점. */
  baselineAlarmId: string | null = null;

  async getAccountUserId(): Promise<string | null> {
    return this.accountUserId;
  }

  async setAccountUserId(userId: string): Promise<void> {
    this.accountUserId = userId;
  }

  async getBaselineAlarmId(): Promise<string | null> {
    return this.baselineAlarmId;
  }

  async setBaselineAlarmId(alarmId: string): Promise<void> {
    this.baselineAlarmId = alarmId;
  }
}
