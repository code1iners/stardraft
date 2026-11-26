import type { AssignmentState } from '../detection/assignment-detection';
import type { MentionBundle, MinimalRecord, UnsavedBundle } from '../bundles/mention-bundle';
import type { MentionLocation } from '../detection/mention';
import type { UpdateAttempt } from '../update/update-restart';
import type { FlowEmployee } from './flow-api';

/** 계정을 바꿀 때 떠나는 계정에 남기는 것. */
export interface AccountLeaving {
  /** 떠나는 시각. 떠나는 계정이 마지막으로 쓴 시각이 되어 30일 삭제의 기준이 된다. */
  now: number;
  /** 떠날 때의 비밀 파일 패턴(기본 목록과 추가 패턴 전부). 돌아왔을 때 그 사이에 추가된 패턴이 있는지 견준다. */
  secretPatterns: readonly string[];
}

/** 계정을 바꾼 결과. */
export interface AccountSwitchResult {
  /** 보관해 둔 계정으로 돌아왔는지 여부. 처음 넣는 계정(30일이 지나 지운 계정 포함)이면 거짓이다. */
  returning: boolean;
  /** 돌아온 계정이 떠날 때의 비밀 파일 패턴. 처음 넣는 계정이거나 남긴 패턴이 없으면 `null`. */
  secretPatternsWhenLeft: string[] | null;
}

/**
 * 상태 저장소 포트(`state.db`).
 * 계정과 기준점, 멘션 묶음부터 시작해, 초안·게시 기록 같은 상태를 다루는 메서드를 차례로 더한다.
 * Flow 기록은 계정마다 보관하고, 계정에 매인 메서드는 움직이는 계정(지금 넣은 키의 계정)의 기록만 다룬다.
 */
export interface StateStore {
  /** 계정의 담당 업무 감지 기준과 보류 후보. */
  getAssignmentState(): Promise<AssignmentState | null>;
  /** 기준과 보류 후보를 저장한다. 계정이 바뀌었으면 저장하지 않는다. */
  setAssignmentState(state: AssignmentState): Promise<void>;
  /**
   * 업무별 최초 묶음을 한 번만 만든다. 처리 기록과 묶음은 원자적으로 저장한다.
   * ID가 있는 묶음을 주면 같은 본문의 기존 묶음에 배정 자료를 더해 저장하고 처리 기록은 그 묶음을 가리킨다.
   */
  addAssignmentBundle(bundle: UnsavedBundle, accountId: string): Promise<MentionBundle | null>;
  /** 움직이는 계정(지금 넣은 키의 계정). 없으면 `null`. */
  getAccount(): Promise<FlowEmployee | null>;
  /**
   * 처음 넣는 계정을 움직이는 계정으로 저장하거나, 움직이는 계정의 이름·소속·이메일을 바꾼다.
   * 계정 없이 쌓인 기록이 있으면 처음 넣는 계정이 이어받는다. 다른 계정으로 바꾸는 일은 `switchAccount`로만 한다.
   */
  setAccount(account: FlowEmployee): Promise<void>;
  /**
   * 다른 계정으로 바꾼다. 지금 계정의 기록은 지우지 않고 보관하며, 마지막으로 쓴 시각(`now`)과 그때의 비밀 파일 패턴을 남긴다.
   * 보관해 둔 계정이면 그 계정의 기록이 다시 움직이고, 처음 넣는 계정이면 빈 기록으로 시작한다.
   * 이 뒤로 계정에 매인 읽기와 쓰기(묶음, 최소 기록, 기준점, 담당 업무, 대기열의 Flow 줄)는 새 계정의 기록만 다룬다.
   */
  switchAccount(account: FlowEmployee, leaving: AccountLeaving): Promise<AccountSwitchResult>;
  /** 이 사용자의 기록을 보관해 두었는지 본다. 움직이는 계정이거나 지워진 계정이면 거짓이다. */
  isStoredAccount(userId: string): Promise<boolean>;
  /**
   * 마지막으로 쓴 시각이 `cutoff`보다 이른 보관 계정의 기록 전체(기준점, 최소 기록, 담당 업무 기록, 대기열의 Flow 줄, 계정 줄)를 지운다.
   * 지운 글이 파일과 WAL에 남지 않게 한다. 움직이는 계정은 지우지 않는다. 지운 계정 수를 돌려준다.
   */
  deleteAccountsUnusedBefore(cutoff: number): Promise<number>;
  /** 보관 중인 계정들의 묶음 전부. 처리됨 정리가 보관 중인 계정에도 7일 규칙을 적용할 때 쓴다. */
  listStoredBundles(): Promise<MentionBundle[]>;
  /** 이미 본 가장 큰 `alarmId`(기준점). 감지를 시작하기 전이면 `null`. */
  getBaselineAlarmId(): Promise<string | null>;
  /**
   * 움직이는 계정의 기준점을 저장한다. `accountId`를 주면 그 계정이 지금 움직이는 계정일 때만 저장한다.
   * 조회하는 사이에 계정을 바꿨으면 떠난 계정의 조회 결과로 새 계정의 기준점을 덮지 않게 한다.
   */
  setBaselineAlarmId(alarmId: string, accountId?: string): Promise<void>;
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
  /**
   * 최근 멘션 확인에서 고른 수동 요청 묶음 하나를 저장하고 ID를 받는다. 저장한 묶음은 수동 요청 표시를 가진다.
   * 기준점과 담당 업무 감지 상태는 바꾸지 않는다. `replacedRecordIds`의 최소 기록을 지우고, 묶음 저장과 한 트랜잭션으로 한다.
   * 담당 업무 묶음이면 그 업무의 처리 기록도 이 묶음을 가리키게 함께 저장해, 이후 자동 감지가 같은 업무로 묶음을 또 만들지 않게 한다.
   * 다른 묶음에 이미 든 멘션 위치를 주면 실패하고 아무것도 바꾸지 않는다.
   */
  addManualBundle(bundle: UnsavedBundle, replacedRecordIds: readonly number[]): Promise<MentionBundle>;
  /** 이미 저장한 묶음 하나를 주어진 값으로 맞춘다. 무시·되돌리기처럼 상태를 바꿀 때 쓴다. */
  saveBundle(bundle: MentionBundle): Promise<void>;
  /** 처리됨 목록에서 빠져 최소 기록만 남은 묶음 전부. 묶음 ID 순서다. */
  listMinimalRecords(): Promise<MinimalRecord[]>;
  /**
   * 처리됨 목록에서 빠지는 묶음마다 전체 기록(묶음, 멘션, 내 답)을 지우고 주어진 최소 기록만 남긴다. 한 트랜잭션으로 한다.
   * 지운 Flow 글과 초안이 파일에 남지 않게 한다. 최소 기록의 `bundleId`가 지울 묶음이고, 최소 기록은 그 묶음의 계정에 남는다(보관 중인 계정의 묶음도 된다).
   */
  archiveBundles(records: readonly MinimalRecord[]): Promise<void>;
  /**
   * 묶음의 전체 기록(묶음, 멘션, 내 답)을 지우고 최소 기록도 남기지 않는다. 한 트랜잭션으로 한다.
   * 지운 Flow 글과 초안이 파일에 남지 않게 한다. 저장하지 않은 묶음이 하나라도 있으면 실패하고 아무것도 지우지 않는다.
   */
  deleteBundles(bundleIds: readonly number[]): Promise<void>;
  /**
   * 받은 파일의 서명 검증에 실패한 업데이트 버전들. 이 버전들은 앱을 다시 켠 뒤에도 자동으로 다시 받지 않는다. 없으면 빈 배열이다.
   * 계정과 상관없는 앱의 기록이다.
   */
  getSignatureFailedVersions(): Promise<string[]>;
  /** 서명 검증에 실패한 업데이트 버전을 더한다. 이미 있으면 그대로 둔다. */
  addSignatureFailedVersion(version: string): Promise<void>;
  /** 서명 검증에 실패한 업데이트 버전에서 뺀다. [다시 시도]로 받은 그 버전이 검증을 통과했을 때 쓴다. */
  removeSignatureFailedVersion(version: string): Promise<void>;
  /**
   * 마지막 "업데이트 시도". 다시 시작하기 직전에 남기고, 다시 켰을 때 버전을 견줘 설치 실패인지 본 뒤 지운다. 없으면 `null`.
   * 계정과 상관없는 앱의 기록이다.
   */
  getUpdateAttempt(): Promise<UpdateAttempt | null>;
  /** "업데이트 시도"를 남긴다. 앞서 남긴 것은 바꾼다. */
  setUpdateAttempt(attempt: UpdateAttempt): Promise<void>;
  /** "업데이트 시도"를 지운다. */
  clearUpdateAttempt(): Promise<void>;
}
