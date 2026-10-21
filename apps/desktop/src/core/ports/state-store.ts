import type { MentionBundle, MinimalRecord, UnsavedBundle } from '../bundles/mention-bundle';
import type { MentionLocation } from '../detection/mention';
import type { FlowEmployee } from './flow-api';

/**
 * 상태 저장소 포트(`state.db`).
 * 계정과 기준점, 멘션 묶음부터 시작해, 초안·게시 기록 같은 상태를 다루는 메서드를 차례로 더한다.
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
  /**
   * 이 멘션 위치를 이미 기록해 두었는지 본다. 같은 멘션 위치에서 다시 온 알림은 글이 수정됐더라도 다시 감지하지 않는다.
   * 묶음에 든 멘션과 처리됨 목록에서 빠진 묶음의 최소 기록을 함께 본다.
   */
  hasMentionLocation(location: MentionLocation): Promise<boolean>;
  /** 저장한 멘션 묶음 전부. 묶음마다 멘션은 알림 시각 순서다. */
  listBundles(): Promise<MentionBundle[]>;
  /**
   * 감지한 멘션을 넣은 묶음들을 저장하고 기준점을 옮긴다. 둘을 한 트랜잭션으로 해서, 저장하지 못한 멘션을 기준점이 지나치지 않게 한다.
   * 묶음마다 묶음·멘션·내 답을 주어진 값으로 맞춘다. ID가 없는 새 묶음은 ID를 받는다. 저장한 묶음을 같은 순서로 돌려준다.
   * 한 멘션 위치는 한 묶음에만 든다. 다른 묶음에 이미 든 멘션 위치를 주면 실패하고 아무것도 바꾸지 않는다.
   */
  saveDetectedBundles(bundles: readonly UnsavedBundle[], baselineAlarmId: string): Promise<MentionBundle[]>;
  /** 이미 저장한 묶음 하나를 주어진 값으로 맞춘다. 무시·되돌리기처럼 상태를 바꿀 때 쓴다. */
  saveBundle(bundle: MentionBundle): Promise<void>;
  /** 처리됨 목록에서 빠져 최소 기록만 남은 묶음 전부. 묶음 ID 순서다. */
  listMinimalRecords(): Promise<MinimalRecord[]>;
  /**
   * 처리됨 목록에서 빠지는 묶음마다 전체 기록(묶음, 멘션, 내 답)을 지우고 주어진 최소 기록만 남긴다. 한 트랜잭션으로 한다.
   * 지운 Flow 글과 초안이 파일에 남지 않게 한다. 최소 기록의 `bundleId`가 지울 묶음이다.
   */
  archiveBundles(records: readonly MinimalRecord[]): Promise<void>;
}
