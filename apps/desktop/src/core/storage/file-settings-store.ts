import { readFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS, type Settings, type SettingsStore } from '../ports/settings-store';
import { writeFileAtomic } from './atomic-file';

/**
 * `settings.json`을 한 형식 버전 올리는 변환. 배열의 n번째(0부터)가 버전 n+1을 n+2로 올린다.
 * 변환이 끝나면 `schemaVersion`은 `migrateSettings`가 올린다.
 */
export type SettingsMigration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * 이 앱이 아는 `settings.json` 마이그레이션. 형식을 바꿀 때 여기에 변환을 더하고 `SETTINGS_SCHEMA_VERSION`을 올린다.
 * 형식 버전이 1부터 시작해 마지막 버전은 변환 수 + 1이다. 두 값이 어긋나지 않는지는 테스트가 확인한다.
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

/**
 * `settings.json`을 쓰는 설정 저장소. 형식 검사와 마이그레이션은 `openAppData`가 먼저 마친다.
 * 바꾸는 즉시 저장하므로 저장이 잇달아 올 수 있다. 저장은 부른 순서대로 하나씩, 임시 파일에 쓴 뒤 이름을 바꾸는 방식으로 한다.
 */
export class FileSettingsStore implements SettingsStore {
  /** 마지막으로 맡은 저장. 다음 저장은 이것이 끝난 뒤에 한다. */
  private lastWrite: Promise<void> = Promise.resolve();

  /**
   * @param filePath `settings.json` 경로.
   * @param appVersion 지금 앱 버전. 저장할 때 파일에 남겨, 옛 버전이 이 파일을 만났을 때 안내에 쓴다.
   */
  constructor(
    private readonly filePath: string,
    private readonly appVersion: string,
  ) {}

  async load(): Promise<Settings> {
    /** 디스크의 설정 파일. */
    const file = await readSettingsFile(this.filePath);
    if (file.kind === 'missing') return structuredClone(DEFAULT_SETTINGS);

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

/** `settings.json` 내용을 `from` 버전에서 마지막 버전(변환 수 + 1)까지 올린다. */
export function migrateSettings(
  raw: Record<string, unknown>,
  from: number,
  migrations: readonly SettingsMigration[],
): Record<string, unknown> {
  /** 올리는 중인 내용. */
  let current = raw;
  for (let version = from; version <= migrations.length; version += 1) {
    /** 이 버전을 다음 버전으로 올리는 변환. */
    const migrate = migrations[version - 1];
    if (!migrate) throw new Error(`settings.json 형식 버전 ${version}을 올릴 수 없습니다.`);
    current = { ...migrate(current), schemaVersion: version + 1 };
  }
  return current;
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
