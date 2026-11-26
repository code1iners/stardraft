import { withDefaultSecretPatterns } from '../agent/secret-patterns';
import type { MentionBundles } from '../bundles/mention-bundles';
import type { DraftQueue } from '../drafts/draft-queue';
import type { Logger } from '../logging/logger';
import type { FlowEmployee } from '../ports/flow-api';
import type { SettingsStore } from '../ports/settings-store';
import type { StateStore } from '../ports/state-store';
import type { Posting } from '../posting/posting';
import type { FlowAccountRecords } from './flow-account';

/** 계정마다 보관하는 Flow 기록을 바꾸는 데 필요한 것. */
export interface AccountRecordsOptions {
  /** 움직이는 계정의 묶음. 계정을 바꾸고 30일이 지난 계정을 지우며, 돌아온 계정의 끊긴 게시를 정리한다. */
  bundles: Pick<MentionBundles, 'switchAccount' | 'deleteUnusedAccounts' | 'recoverAfterRestart' | 'discardSecretEvidenceDrafts'>;
  /** 초안 대기열. 떠날 때 Flow 초안 생성을 멈추고 돌아오면 그 계정의 대기열로 다시 돈다. */
  drafts: Pick<DraftQueue, 'leaveAccount' | 'resumeAccount'>;
  /** 게시. 떠날 때 게시 대기를 멈추고 돌아오면 응답을 받지 못한 게시를 확인한다. */
  posting: Pick<Posting, 'leaveAccount' | 'recoverAfterRestart'>;
  /** 계정을 보관해 두었는지 보는 상태 저장소. */
  stateStore: Pick<StateStore, 'isStoredAccount'>;
  /** 지금의 비밀 파일 패턴을 읽는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. 사용자 ID는 남기지 않는다. */
  logger: Logger;
}

/**
 * Flow 기록의 계정별 보관에서 계정을 오가는 일. 움직이는 계정은 하나이고, 나머지 계정의 기록은 멈춘 채 보관한다.
 * 떠나는 계정은 그 계정에 한해 앱을 끈 것과 같게 다룬다: 생성 중이던 실행은 끊고, 게시 카운트다운은 게시하지 않고 준비됨으로 되돌리며,
 * 줄 서 있던 Flow 초안은 대기열에서 빠져 보관된다. 진단 같은 다른 종류의 대상은 그대로 돈다.
 * 돌아온 계정은 다시 켠 것과 같게 다룬다: 끊긴 생성은 대기열에 다시 서고, 응답을 못 받은 게시는 실제로 올라갔는지 확인한다.
 * 준비됨 초안은 그대로 두고, 떠나 있던 동안 비밀 파일 패턴이 추가됐을 때만 게시 전 초안을 지금 규칙대로 다시 검사한다.
 */
export class AccountRecords implements FlowAccountRecords {
  /** 돌아온 계정에서 다시 검사할 비밀 파일 패턴. 떠나 있던 동안 패턴이 추가되지 않았으면 `null`. */
  private secretRecheck: string[] | null = null;

  constructor(private readonly options: AccountRecordsOptions) {}

  async isStored(userId: string): Promise<boolean> {
    // 30일이 지난 계정은 지운 뒤에 보므로, 그 계정의 키는 처음 넣는 계정으로 묻는다.
    await this.options.bundles.deleteUnusedAccounts();
    return this.options.stateStore.isStoredAccount(userId);
  }

  async switchTo(account: FlowEmployee): Promise<void> {
    // 게시를 먼저 멈춘다. 카운트다운을 준비됨으로 돌리는 일은 떠나는 계정의 묶음이 아직 움직일 때 해야 한다.
    await this.options.posting.leaveAccount();
    await this.options.drafts.leaveAccount();
    /** 떠날 때의 비밀 파일 패턴. 이 계정으로 돌아왔을 때 그 사이에 추가된 패턴이 있는지 견준다. */
    const patterns = await this.currentSecretPatterns();
    /** 바꾼 결과. */
    const result = await this.options.bundles.switchAccount(account, patterns);
    this.secretRecheck = result.returning && hasAddedPattern(result.secretPatternsWhenLeft, patterns) ? patterns : null;
    this.options.logger.info('account-records.switched', { returning: result.returning, secretRecheck: this.secretRecheck !== null });
  }

  async resume(): Promise<void> {
    // 떠나기 전에 카운트다운을 준비됨으로 돌리지 못한 묶음이 남았으면 다시 켤 때처럼 돌린다.
    await this.options.bundles.recoverAfterRestart();
    /** 다시 검사할 패턴. 한 번만 검사한다. */
    const recheck = this.secretRecheck;
    this.secretRecheck = null;
    if (recheck) await this.options.bundles.discardSecretEvidenceDrafts(await this.currentSecretPatterns());
    await this.options.drafts.resumeAccount();
    this.options.posting.recoverAfterRestart();
  }

  /** 지금의 비밀 파일 패턴(기본 목록과 추가 패턴 전부). */
  private async currentSecretPatterns(): Promise<string[]> {
    return withDefaultSecretPatterns((await this.options.settingsStore.load()).extraSecretPatterns);
  }
}

/** 떠날 때 없던 패턴이 지금 있는지 본다. 떠날 때의 패턴을 모르면 추가된 것으로 본다. */
function hasAddedPattern(whenLeft: readonly string[] | null, now: readonly string[]): boolean {
  if (whenLeft === null) return true;
  /** 떠날 때의 패턴. */
  const before = new Set(whenLeft);
  return now.some((pattern) => !before.has(pattern));
}
