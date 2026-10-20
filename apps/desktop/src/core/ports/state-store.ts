import type { FlowEmployee } from './flow-api';

/**
 * 상태 저장소 포트(`state.db`).
 * 계정과 기준점부터 시작해, 멘션 묶음·초안·게시 기록 같은 상태를 다루는 메서드를 차례로 더한다.
 */
export interface StateStore {
  /** 키 확인에 성공한 계정. 없으면 `null`. */
  getAccount(): Promise<FlowEmployee | null>;
  /** 키 확인에 성공한 계정을 저장한다. 같은 계정의 이름·소속·이메일이 바뀌었을 때도 쓴다. */
  setAccount(account: FlowEmployee): Promise<void>;
  /**
   * 기록을 모두 지우고 새 계정으로 처음부터 시작한다. 다른 계정의 키로 바꿀 때 쓴다.
   * 기준점도 지우므로 감지는 첫 실행처럼 기준점을 다시 잡아야 한다.
   */
  resetForAccount(account: FlowEmployee): Promise<void>;
  /** 이미 본 가장 큰 `alarmId`(기준점). 감지를 시작하기 전이면 `null`. */
  getBaselineAlarmId(): Promise<string | null>;
  /** 기준점을 저장한다. */
  setBaselineAlarmId(alarmId: string): Promise<void>;
}
