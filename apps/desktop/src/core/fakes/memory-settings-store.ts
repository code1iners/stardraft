import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '../ports/settings-store';

/** 메모리에만 두는 설정 저장소. */
export class MemorySettingsStore implements SettingsStore {
  /** 지금 저장된 설정. */
  settings: Settings;

  constructor(initial: Partial<Settings> = {}) {
    this.settings = structuredClone({ ...DEFAULT_SETTINGS, ...initial });
  }

  async load(): Promise<Settings> {
    return structuredClone(this.settings);
  }

  async save(settings: Settings): Promise<void> {
    this.settings = structuredClone(settings);
  }
}
