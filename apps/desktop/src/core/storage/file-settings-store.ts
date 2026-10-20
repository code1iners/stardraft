import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, type Settings, type SettingsStore } from '../ports/settings-store';
import { writeFileAtomic } from './atomic-file';
import { NewerDataError } from './newer-data';

/**
 * `settings.json`을 한 형식 버전 올리는 변환. 배열의 n번째(0부터)가 버전 n+1을 n+2로 올린다.
 * 변환이 끝나면 `schemaVersion`은 호출하는 쪽이 올린다.
 */
export type SettingsMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * 이 앱이 아는 `settings.json` 마이그레이션. 형식을 바꿀 때 여기에 변환을 더하고 `SETTINGS_SCHEMA_VERSION`을 올린다.
 * 두 값이 어긋나지 않는지는 테스트가 확인한다.
 */
export const SETTINGS_MIGRATIONS: readonly SettingsMigration[] = [];

/** 디스크에서 읽은 `settings.json`. */
export type SettingsFile =
  /** 파일이 없다. 첫 실행이다. */
  | { kind: 'missing' }
  /** 파일을 읽었다. */
  | {
      kind: 'found';
      /** 파일 내용 그대로. */
      raw: Record<string, unknown>;
      /** 파일의 형식 버전. */
      schemaVersion: number;
      /** 마지막으로 저장한 앱 버전. 기록이 없으면 `null`. */
      appVersion: string | null;
    };

/** 파일 설정 저장소의 설정. */
export interface FileSettingsStoreOptions {
  /** `settings.json` 경로. */
  filePath: string;
  /** 지금 앱 버전. 저장할 때 파일에 남겨, 옛 버전이 이 파일을 만났을 때 안내에 쓴다. */
  appVersion: string;
  /** 이 앱이 아는 형식 버전. */
  schemaVersion?: number;
}

/**
 * `settings.json`을 쓰는 설정 저장소.
 * 바꾸는 즉시 저장하므로 저장이 잇달아 올 수 있다. 저장은 부른 순서대로 하나씩, 임시 파일에 쓴 뒤 이름을 바꾸는 방식으로 한다.
 */
export class FileSettingsStore implements SettingsStore {
  /** `settings.json` 경로. */
  private readonly filePath: string;
  /** 지금 앱 버전. */
  private readonly appVersion: string;
  /** 이 앱이 아는 형식 버전. */
  private readonly schemaVersion: number;
  /** 마지막으로 맡은 저장. 다음 저장은 이것이 끝난 뒤에 한다. */
  private lastWrite: Promise<void> = Promise.resolve();

  constructor({ filePath, appVersion, schemaVersion = SETTINGS_SCHEMA_VERSION }: FileSettingsStoreOptions) {
    this.filePath = filePath;
    this.appVersion = appVersion;
    this.schemaVersion = schemaVersion;
  }

  async load(): Promise<Settings> {
    /** 디스크의 설정 파일. */
    const file = await readSettingsFile(this.filePath);
    if (file.kind === 'missing') return structuredClone(DEFAULT_SETTINGS);
    if (file.schemaVersion > this.schemaVersion) throw new NewerDataError(file.appVersion);

    // 파일에만 있는 앱 버전 기록은 설정 값이 아니라서 뺀다.
    /** 파일의 설정 값. */
    const stored = { ...file.raw };
    delete stored.appVersion;
    return { ...structuredClone(DEFAULT_SETTINGS), ...stored } as Settings;
  }

  save(settings: Settings): Promise<void> {
    /** 저장할 파일 내용. */
    const data = serializeSettingsFile({ ...settings }, this.appVersion);
    /** 이번 저장. 앞 저장이 실패했어도 이번 저장은 한다. */
    const write = this.lastWrite.catch(() => {}).then(() => writeFileAtomic(this.filePath, data));
    this.lastWrite = write;
    return write;
  }
}

/** `settings.json`에 쓸 내용. 설정 값 뒤에 저장한 앱 버전을 붙인다. */
export function serializeSettingsFile(raw: Record<string, unknown>, appVersion: string): string {
  return `${JSON.stringify({ ...raw, appVersion }, null, 2)}\n`;
}

/** `settings.json`을 읽는다. 형식 버전이 없거나 JSON이 아니면 실패한다. */
export async function readSettingsFile(filePath: string): Promise<SettingsFile> {
  /** 파일 내용. */
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }

  /** JSON으로 푼 내용. */
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    // JSON 오류 메시지에는 파일 내용 일부가 들어가므로 그대로 던지지 않는다.
    throw new Error('settings.json이 올바른 JSON이 아닙니다.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('settings.json이 객체가 아닙니다.');
  }
  /** 객체로 본 내용. */
  const record = raw as Record<string, unknown>;
  if (typeof record.schemaVersion !== 'number' || !Number.isInteger(record.schemaVersion)) {
    throw new Error('settings.json에 schemaVersion이 없습니다.');
  }
  return {
    kind: 'found',
    raw: record,
    schemaVersion: record.schemaVersion,
    appVersion: typeof record.appVersion === 'string' ? record.appVersion : null,
  };
}
