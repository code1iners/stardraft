import { rm } from 'node:fs/promises';
import { errorFields, type Logger } from '../logging/logger';
import type { CancelScheduled, Clock } from '../ports/clock';
import type { StateStore } from '../ports/state-store';
import type { DownloadedUpdate, UpdateFeed, UpdateManifest } from '../ports/update-feed';
import type { BlockedLocationReason } from './install-location';
import { verifyDownloadedUpdate } from './update-verification';

/** 앱을 켜고 처음 확인하기까지 기다리는 시간(밀리초). */
const FIRST_CHECK_DELAY_MS = 60_000;
/** 확인 간격(밀리초). 설정에서 바꿀 수 없다. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** 앱 내 업데이트의 상태. */
export type UpdateStatus =
  /** 이번 실행에서 아직 확인하지 않았다. */
  | { kind: 'idle' }
  /** 새 버전을 확인하고 있다. */
  | { kind: 'checking' }
  /** 지금 버전이 최신이다. `checkedAt`은 마지막으로 확인한 시각(Unix epoch 밀리초)이다. */
  | { kind: 'up-to-date'; checkedAt: number }
  /** 확인이나 다운로드가 실패했다(네트워크 등). 다음 확인에서 저절로 다시 시도한다. `failedAt`은 실패한 시각이다. */
  | { kind: 'check-failed'; failedAt: number }
  /** 새 버전의 업데이트 파일을 받고 있다. `percent`는 받은 비율(0~100의 정수)이다. */
  | { kind: 'downloading'; version: string; percent: number }
  /** 받은 파일의 서명을 확인했다. 사용자가 [다시 시작]을 누르면 설치한다. */
  | { kind: 'ready'; version: string }
  /** 받은 파일의 서명이 맞지 않아 파일을 지우고 설치하지 않았다. 지금 버전을 계속 쓴다. */
  | { kind: 'signature-failed'; version: string }
  /** 앱이 스스로 바꿀 수 없는 위치라 새 버전을 받지 않았다. 사이트에서 받게 안내한다. */
  | { kind: 'location-blocked'; version: string; reason: BlockedLocationReason };

/**
 * 확인을 시작한 까닭. `schedule`은 정해진 시점(켜고 1분 뒤, 4시간마다, 잠자기에서 깨어났을 때),
 * `user`는 설정 "일반"의 [지금 확인], `retry`는 서명 검증 실패 뒤의 [다시 시도]다.
 */
type CheckTrigger = 'schedule' | 'user' | 'retry';

/** 앱 내 업데이트에 필요한 포트와 값. */
export interface InAppUpdateOptions {
  /** 새 버전을 찾고 받는 업데이트 피드. */
  feed: UpdateFeed;
  /** 지금 앱 버전. */
  currentVersion: string;
  /** 서명을 검증할 Ed25519 공개 키 목록. 앱에서는 앱 소스의 공개 키 목록이다. */
  publicKeys: readonly string[];
  /** 앱이 스스로 바꿀 수 없는 위치인지 본다. 바꿀 수 있으면 `null`, 아니면 그 까닭이다. */
  checkLocation: () => Promise<BlockedLocationReason | null>;
  /** 서명 검증에 실패한 버전을 남기는 상태 저장소. */
  stateStore: Pick<StateStore, 'getSignatureFailedVersion' | 'setSignatureFailedVersion'>;
  /** 확인 시점을 재는 시계. */
  clock: Clock;
  /** 진단 로그. */
  logger: Logger;
}

/** 앱 내 업데이트. 공개 Release에서 새 버전을 확인하고 받아, 서명을 확인한 뒤 설치 준비됨으로 둔다. */
export class InAppUpdate {
  /** 지금 상태. */
  private status: UpdateStatus = { kind: 'idle' };
  /** 진행 중인 확인과 다운로드. */
  private inFlight: Promise<void> | null = null;
  /** 정해진 확인을 하는지 여부. `start`가 켜고 `stop`이 끈다. */
  private running = false;
  /** 예약한 다음 확인을 지우는 함수. */
  private cancelScheduled: CancelScheduled | null = null;
  /** 마지막으로 확인에 성공한 시각(Unix epoch 밀리초). 아직 없으면 `null`. */
  private lastCheckedAt: number | null = null;
  /**
   * 받은 파일의 서명 검증에 실패한 버전. 이 버전은 [다시 시도]를 누를 때만 다시 받는다. 다시 켠 뒤에도 그렇게 state.db에 남긴다.
   * 아직 state.db에서 읽지 않았으면 `undefined`다.
   */
  private signatureFailedVersion: string | null | undefined = undefined;
  /** 상태가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(status: UpdateStatus) => void>();

  constructor(private readonly options: InAppUpdateOptions) {}

  /** 지금 상태. */
  state(): UpdateStatus {
    return this.status;
  }

  /** 상태가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 켜고 1분 뒤 처음 확인하고, 그 뒤 확인을 마칠 때마다 4시간 뒤에 다시 확인한다. */
  start(): void {
    this.running = true;
    this.schedule(FIRST_CHECK_DELAY_MS);
  }

  /** 다음 확인을 멈춘다. 앱을 끝낼 때 부른다. 진행 중인 확인과 다운로드는 끝까지 간다. */
  stop(): void {
    this.running = false;
    this.cancelScheduled?.();
    this.cancelScheduled = null;
  }

  /** 설정 "일반"의 [지금 확인]. 바로 확인하고 확인하는 동안 "확인 중"을 보인다. 확인이 진행 중이면 그 확인을 기다린다. */
  checkNow(): Promise<void> {
    return this.inFlight ?? this.run('user');
  }

  /**
   * 잠자기에서 깨어났을 때 부른다. 잠든 동안에는 타이머가 멈춰 정해진 확인이 잠든 시간만큼 밀린다.
   * 마지막 확인이 4시간보다 오래됐으면(아직 확인하지 못했으면) 바로 확인하고, 아니면 다음 확인을 마지막 확인에서 4시간이 되는 때로 다시 예약한다.
   */
  checkIfDue(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    /** 마지막으로 확인에 성공한 뒤 지난 시간(밀리초). 아직 확인하지 못했으면 무한대다. */
    const sinceLastCheck = this.lastCheckedAt === null ? Infinity : this.options.clock.now() - this.lastCheckedAt;
    if (sinceLastCheck >= CHECK_INTERVAL_MS) return this.run('schedule');
    if (this.running) this.schedule(CHECK_INTERVAL_MS - sinceLastCheck);
    return Promise.resolve();
  }

  /**
   * 서명 검증 실패 뒤의 [다시 시도]. 실패한 버전도 다시 받는다. 서명 검증 실패가 아니면 아무것도 하지 않는다.
   * 진행 중인 확인은 실패한 버전을 받지 않으므로, 끝나기를 기다린 뒤 다시 확인한다. 기다리는 사이 다른 확인이 이어지면 그것도 기다린다.
   */
  async retry(): Promise<void> {
    while (this.inFlight) await this.inFlight;
    if (this.status.kind !== 'signature-failed') return;
    await this.run('retry');
  }

  /** 진행 중인 확인과 다운로드가 끝나면 풀린다. 진행 중인 일이 없으면 바로 풀린다. */
  whenIdle(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  /** 확인과 다운로드를 한 번 하고 다음 확인을 예약한다. 진행 중이면 그 일이 끝나기를 기다린다. */
  private run(trigger: CheckTrigger): Promise<void> {
    this.inFlight ??= this.checkAndDownload(trigger)
      .catch((error: unknown) => this.options.logger.error('update.check-crashed', errorFields(error)))
      .finally(() => {
        this.inFlight = null;
        if (this.running) this.schedule(CHECK_INTERVAL_MS);
      });
    return this.inFlight;
  }

  /** `delayMs` 뒤에 확인하도록 예약한다. 앞서 예약한 확인은 지운다. */
  private schedule(delayMs: number): void {
    this.cancelScheduled?.();
    this.cancelScheduled = this.options.clock.after(delayMs, () => {
      this.cancelScheduled = null;
      void this.run('schedule');
    });
  }

  /**
   * 새 버전을 확인하고, 있으면 받는다. 서명 검증에 실패한 버전은 [다시 시도]일 때만 받는다.
   * 사용자가 볼 안내가 있는 상태(설치 준비됨, 서명 검증 실패, 스스로 바꿀 수 없는 위치)는 정해진 확인이 "확인 중"으로 덮지 않고, 확인이 실패해도 그대로 둔다.
   */
  private async checkAndDownload(trigger: CheckTrigger): Promise<void> {
    /** 확인을 시작할 때의 상태. */
    const before = this.status;
    /** 확인하는 동안 "확인 중"을 보일지 여부. 확인이 실패하면 확인 실패를 보일지도 이것으로 정한다. */
    const showsChecking = trigger !== 'schedule' || !holdsNotice(before);
    if (showsChecking) this.setStatus({ kind: 'checking' });
    /** 찾은 새 버전의 안내. */
    let manifest: UpdateManifest | null;
    try {
      manifest = await this.options.feed.check();
    } catch (error) {
      this.options.logger.warn('update.check-failed', errorFields(error));
      if (showsChecking) this.setStatus({ kind: 'check-failed', failedAt: this.options.clock.now() });
      return;
    }
    this.lastCheckedAt = this.options.clock.now();
    if (!manifest) {
      this.setStatus({ kind: 'up-to-date', checkedAt: this.lastCheckedAt });
      return;
    }
    // 이미 받아 서명을 확인한 버전이면 다시 받지 않고, "확인 중"을 보였으면 설치 준비됨으로 돌린다.
    if (before.kind === 'ready' && before.version === manifest.version) {
      this.setStatus(before);
      return;
    }
    if (trigger !== 'retry' && manifest.version === (await this.failedVersion())) {
      this.options.logger.info('update.failed-version-skipped', { version: manifest.version });
      this.setStatus({ kind: 'signature-failed', version: manifest.version });
      return;
    }
    // 확인할 때마다 앱의 위치를 본다. 바꿀 수 없는 곳이면 설치할 때 관리자 인증 창이 뜨거나 거부되므로 받지 않는다.
    /** 앱이 스스로 바꿀 수 없는 위치의 까닭. */
    const blocked = await this.blockedLocation();
    if (blocked) {
      this.options.logger.info('update.location-blocked', { version: manifest.version, reason: blocked });
      this.setStatus({ kind: 'location-blocked', version: manifest.version, reason: blocked });
      return;
    }
    this.setStatus({ kind: 'downloading', version: manifest.version, percent: 0 });
    /** 받은 파일. */
    let downloaded: DownloadedUpdate;
    try {
      downloaded = await this.options.feed.download((percent) =>
        this.setStatus({ kind: 'downloading', version: manifest.version, percent: Math.min(100, Math.max(0, Math.floor(percent))) }),
      );
    } catch (error) {
      // 네트워크 손상은 electron-updater의 sha512 확인에서 먼저 걸린다. 서명 검증 실패와 달리 다음 확인에서 같은 버전을 다시 받는다.
      this.options.logger.warn('update.download-failed', { version: manifest.version, ...errorFields(error) });
      this.setStatus({ kind: 'check-failed', failedAt: this.options.clock.now() });
      return;
    }
    /** 받은 버전. */
    const version = downloaded.manifest.version;
    /** 검증이 실패한 까닭. 통과하면 `null`. */
    const failure = await verifyDownloadedUpdate(downloaded, this.options.currentVersion, this.options.publicKeys);
    if (failure) {
      this.options.logger.warn('update.signature-failed', { version, reason: failure });
      // 설치하지 않을 파일이 남아 있지 않게 지운다. 지우지 못해도 설치 준비됨이 아니므로 설치되지 않는다.
      await rm(downloaded.file, { force: true }).catch((error: unknown) =>
        this.options.logger.error('update.file-delete-failed', { version, ...errorFields(error) }),
      );
      await this.rememberFailedVersion(version);
      this.setStatus({ kind: 'signature-failed', version });
      return;
    }
    // [다시 시도]로 받은 실패한 버전이 통과했으면 더는 실패한 버전이 아니다.
    if ((await this.failedVersion()) === version) await this.rememberFailedVersion(null);
    this.options.logger.info('update.ready', { version });
    this.setStatus({ kind: 'ready', version });
  }

  /** 앱이 스스로 바꿀 수 없는 위치의 까닭. 위치를 보지 못하면 쓸 수 있다고 확인되지 않은 것이므로 권한이 없는 것으로 본다. */
  private async blockedLocation(): Promise<BlockedLocationReason | null> {
    try {
      return await this.options.checkLocation();
    } catch (error) {
      this.options.logger.error('update.location-check-failed', errorFields(error));
      return 'no-permission';
    }
  }

  /** 상태를 바꾸고, 바뀌었으면 듣는 쪽에 알린다. */
  private setStatus(status: UpdateStatus): void {
    if (JSON.stringify(status) === JSON.stringify(this.status)) return;
    this.status = status;
    for (const listener of this.listeners) listener(status);
  }

  /** 서명 검증에 실패한 버전. 처음 한 번 state.db에서 읽는다. 읽지 못하면 없는 것으로 본다. */
  private async failedVersion(): Promise<string | null> {
    if (this.signatureFailedVersion === undefined) {
      try {
        this.signatureFailedVersion = await this.options.stateStore.getSignatureFailedVersion();
      } catch (error) {
        this.options.logger.error('update.failed-version-read-failed', errorFields(error));
        this.signatureFailedVersion = null;
      }
    }
    return this.signatureFailedVersion;
  }

  /** 서명 검증에 실패한 버전을 바꾸고 state.db에 남긴다. 남기지 못해도 이번 실행에서는 기억한다. */
  private async rememberFailedVersion(version: string | null): Promise<void> {
    this.signatureFailedVersion = version;
    try {
      await this.options.stateStore.setSignatureFailedVersion(version);
    } catch (error) {
      this.options.logger.error('update.failed-version-save-failed', errorFields(error));
    }
  }
}

/** 사용자가 볼 안내가 있는 상태인지 본다. 이런 상태는 정해진 확인이 "확인 중"이나 확인 실패로 덮지 않는다. */
function holdsNotice(status: UpdateStatus): boolean {
  return status.kind === 'ready' || status.kind === 'signature-failed' || status.kind === 'location-blocked';
}
