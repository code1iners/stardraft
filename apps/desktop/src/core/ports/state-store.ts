/**
 * 상태 저장소 포트(`state.db`).
 * 계정과 기준점부터 시작해, 멘션 묶음·초안·게시 기록 같은 상태를 다루는 메서드를 차례로 더한다.
 */
export interface StateStore {
  /** 키 확인 때 저장한 계정의 Flow 사용자 ID. 없으면 `null`. */
  getAccountUserId(): Promise<string | null>;
  /** 키 확인에 성공한 계정의 Flow 사용자 ID를 저장한다. */
  setAccountUserId(userId: string): Promise<void>;
  /** 이미 본 가장 큰 `alarmId`(기준점). 감지를 시작하기 전이면 `null`. */
  getBaselineAlarmId(): Promise<string | null>;
  /** 기준점을 저장한다. */
  setBaselineAlarmId(alarmId: string): Promise<void>;
}
