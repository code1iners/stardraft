import { errorFields, type Logger } from '../logging/logger';
import type { SettingsStore } from '../ports/settings-store';

/** 로그인 시 자동 시작에 필요한 것. */
export interface LaunchAtLoginOptions {
  /** 켜짐 여부를 두는 설정 저장소. */
  settingsStore: SettingsStore;
  /** 진단 로그. */
  logger: Logger;
  /** OS 로그인 항목에 등록하거나 뺀다. 실패하면 던진다. */
  applyToSystem: (enabled: boolean) => void;
}

/**
 * 로그인 시 자동 시작. [감지 시작]이 켜고, 설정 "일반"의 토글로 끄고 켠다.
 * OS 로그인 항목을 먼저 바꾸고, 성공했을 때만 `settings.json`에 저장한다.
 */
export class LaunchAtLogin {
  /** 저장된 켜짐 여부. */
  private on = false;
  /** 켜짐 여부가 바뀔 때 부를 함수. */
  private readonly listeners = new Set<(enabled: boolean) => void>();

  constructor(private readonly options: LaunchAtLoginOptions) {}

  /** 저장된 켜짐 여부를 읽는다. */
  async load(): Promise<void> {
    this.on = (await this.options.settingsStore.load()).launchAtLogin;
  }

  /** 켜져 있는지 여부. */
  enabled(): boolean {
    return this.on;
  }

  /** 켜짐 여부가 바뀔 때마다 `listener`를 부른다. 돌려준 함수를 부르면 그만 부른다. */
  onChange(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 켜거나 끈다. OS 로그인 항목이나 설정을 바꾸지 못하면 로그만 남기고 그대로 둔다. */
  async set(enabled: boolean): Promise<void> {
    try {
      this.options.applyToSystem(enabled);
    } catch (error) {
      this.options.logger.error('launch-at-login.apply-failed', { enabled, ...errorFields(error) });
      return;
    }
    try {
      // 다른 칸의 변경을 덮지 않게 저장 직전에 설정을 다시 읽는다.
      /** 저장 직전의 설정. */
      const settings = await this.options.settingsStore.load();
      await this.options.settingsStore.save({ ...settings, launchAtLogin: enabled });
    } catch (error) {
      this.options.logger.error('launch-at-login.save-failed', { enabled, ...errorFields(error) });
      // 설정과 OS 로그인 항목이 어긋나지 않게 OS 쪽을 되돌린다.
      try {
        this.options.applyToSystem(this.on);
      } catch {
        // 되돌리지 못해도 이미 남긴 로그로 충분하다.
      }
      return;
    }
    this.on = enabled;
    this.options.logger.info('launch-at-login.changed', { enabled });
    for (const listener of this.listeners) listener(enabled);
  }
}
