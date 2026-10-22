import { errorFields, type Logger } from '../logging/logger';
import type { CancelScheduled, Clock } from '../ports/clock';
import type { StateStore } from '../ports/state-store';
import type { InstallFailure, UpdateFeed } from '../ports/update-feed';
import type { InAppUpdate, UpdateStatus } from './in-app-update';

/** 다시 시작을 에이전트 실행 때문에 미루는 가장 긴 시간(밀리초). 지나면 실행을 끊고 다시 시작한다(다시 켜면 대기열에 다시 들어감). */
export const DRAFT_WAIT_LIMIT_MS = 10 * 60 * 1000;
/** 설치를 맡긴 뒤 앱이 꺼지기를 기다리는 가장 긴 시간(밀리초). 이만큼 지나도 꺼지지 않고 오류도 없으면 설치하지 못한 것으로 본다. */
const INSTALL_TIMEOUT_MS = 2 * 60 * 1000;

/** 다시 시작하기 직전에 남기는 "업데이트 시도". 다시 켰을 때 버전을 견줘 설치 실패인지 본다. */
export interface UpdateAttempt {
  /** 다시 시작할 때의 앱 버전. */
  fromVersion: string;
  /** 설치할 새 버전. */
  toVersion: string;
  /** 다시 시작한 시각(Unix epoch 밀리초). */
  attemptedAt: number;
  /** Squirrel.Mac이 새 번들의 코드 서명을 거부해 앱이 꺼지지 않았는지 여부. 그러면 다시 시도해도 소용이 없다. */
  rejected: boolean;
}

/** 설치 실패의 까닭. `not-applied`는 다시 켰는데 버전이 그대로이거나 설치 중 오류가 난 것, `rejected`는 Squirrel.Mac이 앱 안에서 거부한 것이다. */
export type InstallFailureReason = 'not-applied' | 'rejected';

/** 다시 시작을 미뤄야 하는 일. 둘 다 거짓이면 바로 다시 시작한다. */
export interface RestartBlockers {
  /** 에이전트 실행이 진행 중이다. */
  drafting: boolean;
  /** 게시 카운트다운이나 게시 요청이 진행 중이다. */
  posting: boolean;
}

/** 다시 시작을 미룰지 정하는 데 필요한 초안 대기열과 게시의 상태. */
export interface RestartActivity {
  /** 지금 다시 시작을 미뤄야 하는 일. */
  blockers(): RestartBlockers;
  /** 미뤄야 하는 일이 바뀔 수 있을 때마다 `listener`를 부르게 한다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: () => void): () => void;
  /** 참이면 다시 시작을 기다리는 동안 초안 대기열이 다음 실행을 시작하지 않는다. 거짓이면 다시 돈다. 폴링은 그대로다. */
  holdDrafts(held: boolean): void;
}

/** 작은 창·메뉴·설정에 보일 업데이트 상태. 앱 내 업데이트의 상태에 다시 시작 대기와 설치 실패를 더했다. */
export type UpdateDisplayStatus =
  | UpdateStatus
  /** 다시 시작을 눌렀지만 진행 중인 일이 끝나기를 기다린다. `waitingFor`는 기다리는 일이다. */
  | { kind: 'restart-pending'; version: string; waitingFor: RestartBlockers }
  /** 새 버전으로 업데이트하지 못했다. */
  | { kind: 'install-failed'; version: string; reason: InstallFailureReason };

/** 앱 내 업데이트의 화면 상태 전체. */
export interface UpdateState {
  /** 보일 상태. */
  status: UpdateDisplayStatus;
  /** 업데이트 직후 첫 실행이면 업데이트한 버전. 아니면 `null`. */
  justUpdated: string | null;
  /** macOS 다시 시작 확인 화면에 보일 새 버전. 확인 화면을 띄우지 않았으면 `null`. */
  restartConfirm: string | null;
  /** 작은 창에서 닫은 띠의 이름들. 같은 이름의 띠는 다시 보이지 않는다. */
  dismissedBanners: string[];
}

/** 다시 시작의 단계. */
type RestartStep =
  /** 다시 시작을 누르지 않았다. */
  | { kind: 'none' }
  /** macOS 확인 화면을 띄웠다. */
  | { kind: 'confirming'; version: string }
  /** 진행 중인 일이 끝나기를 기다린다. */
  | { kind: 'waiting'; version: string }
  /** 편집기 내용을 저장하고 설치를 맡겼다. 앱이 곧 꺼진다. */
  | { kind: 'restarting'; version: string };

/** 다시 시작에 필요한 것. */
export interface UpdateRestartOptions {
  /** 새 버전을 확인하고 받는 앱 내 업데이트. 설치 준비됨일 때만 다시 시작한다. */
  update: Pick<InAppUpdate, 'state' | 'onChange' | 'checkNow'>;
  /** 받아 둔 업데이트를 설치하는 업데이트 피드. */
  feed: Pick<UpdateFeed, 'install' | 'onInstallFailed'>;
  /** 지금 앱 버전. */
  currentVersion: string;
  /** 다시 시작 전에 확인 화면을 띄울지 여부. macOS는 다시 켜질 때 키체인 허용을 묻기 때문에 띄운다. */
  confirmsBeforeRestart: boolean;
  /** 초안 대기열과 게시의 상태. */
  activity: RestartActivity;
  /** 편집기 내용 같은 묶음 저장이 끝나기를 기다린다. */
  saveEdits: () => Promise<void>;
  /** "업데이트 시도"를 남기는 상태 저장소. */
  stateStore: Pick<StateStore, 'getUpdateAttempt' | 'setUpdateAttempt' | 'clearUpdateAttempt'>;
  /** 에이전트 실행을 기다리는 시간을 재는 시계. */
  clock: Clock;
  /** 진단 로그. */
  logger: Logger;
}

/**
 * 앱 내 업데이트의 다시 시작. 설치는 사용자가 [다시 시작]을 누를 때만 한다.
 * macOS는 먼저 확인 화면을 띄우고, 에이전트 실행(최대 10분)·게시 카운트다운·게시 요청이 끝날 때까지 미룬 뒤,
 * 편집기 내용을 저장하고 "업데이트 시도"를 남기고 설치하며 다시 시작한다.
 * 다시 켰을 때 그 기록으로 업데이트 직후 첫 실행인지 설치 실패인지 정한다.
 */
export class UpdateRestart {
  /** 다시 시작의 단계. */
  private step: RestartStep = { kind: 'none' };
  /** 설치하지 못한 버전과 까닭. 없으면 `null`. */
  private installFailure: { version: string; reason: InstallFailureReason } | null = null;
  /** 업데이트 직후 첫 실행이면 업데이트한 버전. */
  private justUpdated: string | null = null;
  /** 작은 창에서 닫은 띠의 이름들. 앱을 다시 켜면 잊는다. */
  private readonly dismissedBanners: string[] = [];
  /** 에이전트 실행을 기다리는 시간이 지났는지 여부. 지나면 실행은 기다리지 않는다. */
  private draftWaitExpired = false;
  /** 기다리는 동안의 예약(에이전트 실행을 기다리는 끝, 설치를 맡긴 뒤 꺼지기를 기다리는 끝)을 지우는 함수. */
  private cancelTimer: CancelScheduled | null = null;
  /** 진행 중인 일의 변화 구독을 끊는 함수. 기다리지 않으면 `null`. */
  private unsubscribeActivity: (() => void) | null = null;
  /** 마지막으로 남긴 "업데이트 시도". 설치하지 못했을 때 그 까닭을 더해 다시 남긴다. */
  private attempt: UpdateAttempt | null = null;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(state: UpdateState) => void>();
  /** 마지막으로 알린 상태의 JSON. 같은 상태는 다시 알리지 않는다. */
  private lastJson: string;

  constructor(private readonly options: UpdateRestartOptions) {
    this.lastJson = JSON.stringify(this.state());
    options.update.onChange(() => this.updateChanged());
    options.feed.onInstallFailed((failure) => void this.installFailed(failure));
  }

  /**
   * 앱을 켤 때 앞선 "업데이트 시도"를 보고 지운다. 버전이 새 버전이면 업데이트 직후 첫 실행이고, 그대로면 설치 실패다.
   * 둘 다 아니면(사이트에서 다른 버전을 설치함) 아무것도 보이지 않는다. 읽지 못하면 없는 것으로 본다.
   */
  async load(): Promise<void> {
    /** 앞선 시도. */
    let attempt: UpdateAttempt | null = null;
    try {
      attempt = await this.options.stateStore.getUpdateAttempt();
      if (attempt) await this.options.stateStore.clearUpdateAttempt();
    } catch (error) {
      this.options.logger.error('update.attempt-read-failed', errorFields(error));
    }
    if (!attempt) return;
    if (attempt.toVersion === this.options.currentVersion) {
      this.options.logger.info('update.installed', { fromVersion: attempt.fromVersion, version: attempt.toVersion });
      this.justUpdated = attempt.toVersion;
    } else if (attempt.fromVersion === this.options.currentVersion) {
      /** 설치하지 못한 까닭. */
      const reason: InstallFailureReason = attempt.rejected ? 'rejected' : 'not-applied';
      this.options.logger.warn('update.install-failed', { version: attempt.toVersion, reason });
      this.installFailure = { version: attempt.toVersion, reason };
    }
    this.emit();
  }

  /** 지금 화면 상태. */
  state(): UpdateState {
    return {
      status: this.displayStatus(),
      justUpdated: this.justUpdated,
      restartConfirm: this.step.kind === 'confirming' ? this.step.version : null,
      dismissedBanners: [...this.dismissedBanners],
    };
  }

  /** 화면 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * [다시 시작]. 메뉴, 작은 창 띠, 설정 "일반"에서 누른다. 설치 준비됨이 아니거나 이미 다시 시작하는 중이면 아무것도 하지 않는다.
   * 확인 화면을 띄우는 OS면 확인 화면을 띄우고 기다린다. 아니면 바로 다시 시작한다(진행 중인 일이 있으면 미룬다).
   */
  async requestRestart(): Promise<void> {
    /** 앱 내 업데이트의 상태. */
    const status = this.options.update.state();
    if (status.kind !== 'ready' || this.step.kind !== 'none' || this.isRejected(status.version)) return;
    if (this.options.confirmsBeforeRestart) {
      this.setStep({ kind: 'confirming', version: status.version });
      return;
    }
    await this.begin(status.version);
  }

  /** 확인 화면의 [다시 시작]. */
  async confirm(): Promise<void> {
    if (this.step.kind !== 'confirming') return;
    await this.begin(this.step.version);
  }

  /** 확인 화면의 [나중에]. 작은 창이 닫혀도 부른다. */
  cancelConfirm(): void {
    if (this.step.kind === 'confirming') this.setStep({ kind: 'none' });
  }

  /** "다시 시작 대기"의 [지금 다시 시작]. 진행 중인 에이전트 실행은 앱이 꺼지며 끊기고 다시 켜면 대기열에 다시 들어간다. */
  async restartNow(): Promise<void> {
    if (this.step.kind !== 'waiting') return;
    await this.restart(this.step.version);
  }

  /** "다시 시작 대기"의 [취소]. 대기를 풀고 초안 대기열을 다시 돌린다. */
  cancelRestart(): void {
    if (this.step.kind !== 'waiting') return;
    this.options.logger.info('update.restart-cancelled', { version: this.step.version });
    this.release();
  }

  /**
   * 설치 실패의 [다시 시도]. 받아 둔 업데이트를 다시 확인해 설치 준비됨이 되면 다시 시작한다.
   * 앱 안에서 거부된 버전은 다시 시도해도 소용이 없어 아무것도 하지 않는다.
   */
  async retryInstall(): Promise<void> {
    if (this.installFailure?.reason !== 'not-applied') return;
    this.installFailure = null;
    this.emit();
    if (this.options.update.state().kind !== 'ready') await this.options.update.checkNow();
    await this.requestRestart();
  }

  /** 작은 창의 띠를 닫는다. `banner`는 띠의 이름이고, 같은 이름의 띠는 다시 보이지 않는다. */
  dismissBanner(banner: string): void {
    if (this.dismissedBanners.includes(banner)) return;
    this.dismissedBanners.push(banner);
    this.emit();
  }

  /** 다시 시작을 시작한다. 다음 실행을 잡아 두고, 진행 중인 일이 있으면 끝날 때까지 기다린다. */
  private async begin(version: string): Promise<void> {
    this.options.activity.holdDrafts(true);
    this.draftWaitExpired = false;
    if (!hasBlocker(this.blockers())) {
      await this.restart(version);
      return;
    }
    this.options.logger.info('update.restart-pending', { version, ...this.blockers() });
    this.setStep({ kind: 'waiting', version });
    this.unsubscribeActivity = this.options.activity.onChange(() => void this.activityChanged());
    this.cancelTimer = this.options.clock.after(DRAFT_WAIT_LIMIT_MS, () => {
      this.cancelTimer = null;
      this.draftWaitExpired = true;
      void this.activityChanged();
    });
  }

  /** 기다리는 동안 진행 중인 일이 바뀌었다. 기다릴 일이 없으면 다시 시작하고, 아니면 기다리는 일을 다시 알린다. */
  private async activityChanged(): Promise<void> {
    if (this.step.kind !== 'waiting') return;
    if (hasBlocker(this.blockers())) {
      this.emit();
      return;
    }
    await this.restart(this.step.version);
  }

  /** 편집기 내용을 저장하고 "업데이트 시도"를 남긴 뒤 설치를 맡긴다. 앱이 꺼지며 진행 중인 실행은 끊긴다. */
  private async restart(version: string): Promise<void> {
    this.stopWaiting();
    this.setStep({ kind: 'restarting', version });
    try {
      await this.options.saveEdits();
    } catch (error) {
      this.options.logger.error('update.save-before-restart-failed', errorFields(error));
    }
    this.attempt = { fromVersion: this.options.currentVersion, toVersion: version, attemptedAt: this.options.clock.now(), rejected: false };
    await this.saveAttempt(this.attempt);
    this.options.logger.info('update.restarting', { version });
    // 앱이 꺼지지 않고 오류도 오지 않으면 다시 시작을 누를 수 없게 멈춰 있지 않도록 설치하지 못한 것으로 본다.
    this.cancelTimer = this.options.clock.after(INSTALL_TIMEOUT_MS, () => {
      this.cancelTimer = null;
      void this.installFailed('timed-out');
    });
    try {
      this.options.feed.install();
    } catch (error) {
      this.options.logger.error('update.install-crashed', errorFields(error));
      await this.installFailed('failed');
    }
  }

  /**
   * 앱 안에서 설치하지 못했다. 앱은 켜진 채라 설치 실패를 보이고 초안 대기열을 다시 돌린다.
   * 거부됐으면 다시 켜도 그렇게 보이게 기록에 남기고, 설치 오류면 이미 알렸으므로 기록을 지운다.
   * 시간 초과(`timed-out`)는 늦게라도 꺼져 설치됐을 수 있어 기록을 남겨 다시 켤 때 버전으로 정한다.
   */
  private async installFailed(failure: InstallFailure | 'timed-out'): Promise<void> {
    if (this.step.kind !== 'restarting') return;
    /** 설치하지 못한 버전. */
    const version = this.step.version;
    /** 설치하지 못한 까닭. */
    const reason: InstallFailureReason = failure === 'rejected' ? 'rejected' : 'not-applied';
    this.options.logger.warn('update.install-failed', { version, reason });
    this.installFailure = { version, reason };
    this.release();
    if (this.attempt && failure === 'rejected') await this.saveAttempt({ ...this.attempt, rejected: true });
    if (failure === 'failed') await this.clearAttempt();
  }

  /** 앱 내 업데이트의 상태가 바뀌었다. 확인 화면이나 대기 중에 설치 준비됨이 아니게 되면(더 새 버전을 받는 중 등) 다시 시작을 거둔다. */
  private updateChanged(): void {
    /** 지금 상태. */
    const status = this.options.update.state();
    /** 다시 시작하려던 버전. */
    const pending = this.step.kind === 'confirming' || this.step.kind === 'waiting' ? this.step.version : null;
    if (pending !== null && !(status.kind === 'ready' && status.version === pending)) {
      this.options.logger.info('update.restart-withdrawn', { version: pending, status: status.kind });
      this.release();
      return;
    }
    this.emit();
  }

  /** 다시 시작을 거두고 초안 대기열을 다시 돌린다. */
  private release(): void {
    this.stopWaiting();
    this.options.activity.holdDrafts(false);
    this.setStep({ kind: 'none' });
  }

  /** 기다리던 예약과 구독을 끊는다. */
  private stopWaiting(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
    this.unsubscribeActivity?.();
    this.unsubscribeActivity = null;
  }

  /** 지금 기다려야 하는 일. 에이전트 실행을 기다리는 시간이 지났으면 실행은 기다리지 않는다. */
  private blockers(): RestartBlockers {
    /** 진행 중인 일. */
    const current = this.options.activity.blockers();
    return { drafting: current.drafting && !this.draftWaitExpired, posting: current.posting };
  }

  /** "업데이트 시도"를 남긴다. 남기지 못해도 다시 시작은 한다. 다시 켰을 때 설치 실패를 알아채지 못할 뿐이다. */
  private async saveAttempt(attempt: UpdateAttempt): Promise<void> {
    try {
      await this.options.stateStore.setUpdateAttempt(attempt);
    } catch (error) {
      this.options.logger.error('update.attempt-save-failed', errorFields(error));
    }
  }

  /** "업데이트 시도"를 지운다. 지우지 못하면 다음 실행에서 설치 실패를 한 번 더 보일 뿐이다. */
  private async clearAttempt(): Promise<void> {
    try {
      await this.options.stateStore.clearUpdateAttempt();
    } catch (error) {
      this.options.logger.error('update.attempt-clear-failed', errorFields(error));
    }
  }

  /** 앱 안에서 거부된 버전인지 본다. 다시 시작해도 같은 까닭으로 거부된다. */
  private isRejected(version: string): boolean {
    return this.installFailure?.reason === 'rejected' && this.installFailure.version === version;
  }

  /**
   * 보일 상태. 다시 시작 대기가 가장 앞이다. 설치 실패는 그 버전에 머무는 동안(확인 중, 최신, 같은 버전을 다시 받거나 받아 둠) 앱 내 업데이트의 상태보다 앞서고,
   * 더 새 버전을 받거나 안내할 일(서명 검증 실패, 스스로 바꿀 수 없는 위치)이 생기면 그 상태를 보인다.
   */
  private displayStatus(): UpdateDisplayStatus {
    if (this.step.kind === 'waiting') return { kind: 'restart-pending', version: this.step.version, waitingFor: this.blockers() };
    /** 앱 내 업데이트의 상태. */
    const status = this.options.update.state();
    /** 설치 실패. */
    const failure = this.installFailure;
    if (failure && failureOutranks(status, failure.version)) return { kind: 'install-failed', ...failure };
    return status;
  }

  /** 단계를 바꾸고 알린다. */
  private setStep(step: RestartStep): void {
    this.step = step;
    this.emit();
  }

  /** 화면 상태가 바뀌었으면 듣는 쪽에 알린다. */
  private emit(): void {
    /** 지금 화면 상태. */
    const state = this.state();
    /** 견줄 JSON. */
    const json = JSON.stringify(state);
    if (json === this.lastJson) return;
    this.lastJson = json;
    for (const listener of this.listeners) listener(state);
  }
}

/** 기다려야 하는 일이 있는지 본다. */
function hasBlocker(blockers: RestartBlockers): boolean {
  return blockers.drafting || blockers.posting;
}

/** 설치 실패를 앱 내 업데이트의 상태보다 앞세울지 본다. 그 버전에 머무는 동안만이다. */
function failureOutranks(status: UpdateStatus, failedVersion: string): boolean {
  switch (status.kind) {
    case 'idle':
    case 'checking':
    case 'up-to-date':
    case 'check-failed':
      return true;
    case 'downloading':
    case 'ready':
      return status.version === failedVersion;
    case 'signature-failed':
    case 'location-blocked':
      return false;
  }
}
