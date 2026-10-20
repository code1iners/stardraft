import { copyFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { errorFields, type Logger } from '../logging/logger';
import { DEFAULT_SETTINGS, type SettingsStore } from '../ports/settings-store';
import type { StateStore } from '../ports/state-store';
import { writeFileAtomic } from './atomic-file';
import {
  FileSettingsStore,
  readSettingsFile,
  serializeSettingsFile,
  SETTINGS_MIGRATIONS,
  type SettingsFile,
  type SettingsMigration,
} from './file-settings-store';
import { newerDataMessage } from './newer-data';
import {
  configureStateDatabase,
  copyStateDatabase,
  migrateStateDatabase,
  openStateDatabase,
  readStateAppVersion,
  readStateSchemaVersion,
  recordStateAppVersion,
  SqliteStateStore,
  STATE_MIGRATIONS,
  type StateDatabase,
} from './state-database';

/** 설정 파일 이름. */
export const SETTINGS_FILE_NAME = 'settings.json';
/** 상태 DB 파일 이름. */
export const STATE_FILE_NAME = 'state.db';
/** 마이그레이션 전 사본을 두는 폴더 이름. */
export const BACKUPS_DIR_NAME = 'backups';

/** 데이터 폴더를 여는 데 필요한 값. */
export interface OpenAppDataOptions {
  /** 데이터 폴더. 없으면 만든다. */
  dataDir: string;
  /** 지금 앱 버전. 데이터에 남기고, 사본 폴더 이름에 쓴다. */
  appVersion: string;
  /** 진단 로그. */
  logger: Logger;
  /** `state.db` 마이그레이션. 테스트가 바꿔 넣는다. */
  stateMigrations?: readonly string[];
  /** `settings.json` 마이그레이션. 테스트가 바꿔 넣는다. */
  settingsMigrations?: readonly SettingsMigration[];
}

/** 형식 검사와 마이그레이션을 마친 데이터. */
export interface AppData {
  kind: 'ready';
  /** 설정 저장소. */
  settingsStore: SettingsStore;
  /** 상태 저장소. */
  stateStore: StateStore;
  /** `state.db` 연결을 닫는다. 앱이 끝날 때 부른다. */
  close(): void;
}

/** 앱이 아는 것보다 새 형식의 데이터라 열지 않았다. 데이터는 건드리지 않았다. */
export interface NewerData {
  kind: 'newer-data';
  /** 데이터를 쓴 앱 버전. 모르면 `null`. */
  createdByVersion: string | null;
  /** 사용자에게 보일 안내. */
  message: string;
}

/**
 * 데이터 폴더의 `settings.json`과 `state.db`를 연다.
 *
 * 1. 두 파일의 형식 버전을 읽는다. 하나라도 앱이 아는 것보다 새로우면 아무것도 바꾸지 않고 `newer-data`를 돌려준다.
 * 2. 올려야 할 기존 데이터가 있으면, 올리기 직전에 두 파일의 사본을 `backups/before-v<앱 버전>/`에 남긴다.
 * 3. `state.db`와 `settings.json`을 마지막 형식으로 올린다. 첫 실행이면 두 파일을 만든다.
 */
export async function openAppData({
  dataDir,
  appVersion,
  logger,
  stateMigrations = STATE_MIGRATIONS,
  settingsMigrations = SETTINGS_MIGRATIONS,
}: OpenAppDataOptions): Promise<AppData | NewerData> {
  /** 이 앱이 아는 `settings.json` 형식 버전. */
  const latestSettingsVersion = settingsMigrations.length + 1;
  /** 이 앱이 아는 `state.db` 형식 버전. */
  const latestStateVersion = stateMigrations.length;
  /** 설정 파일 경로. */
  const settingsPath = join(dataDir, SETTINGS_FILE_NAME);

  await mkdir(dataDir, { recursive: true });
  /** 디스크의 설정 파일. */
  const settingsFile = await readSettingsFile(settingsPath);
  /** 열린 `state.db`. */
  const db = openStateDatabase(join(dataDir, STATE_FILE_NAME));

  try {
    /** 디스크의 `state.db` 형식 버전. */
    const stateVersion = readStateSchemaVersion(db);

    // 새 버전이 만든 데이터면 아무것도 바꾸지 않고 멈춘다.
    if (stateVersion > latestStateVersion) {
      return newerData(db, logger, readStateAppVersion(db), { stateVersion, latestStateVersion });
    }
    if (settingsFile.kind === 'found' && settingsFile.schemaVersion > latestSettingsVersion) {
      return newerData(db, logger, settingsFile.appVersion, {
        settingsVersion: settingsFile.schemaVersion,
        latestSettingsVersion,
      });
    }

    // 기존 데이터를 올려야 하면 올리기 직전에 사본을 남긴다. 첫 실행으로 만든 빈 DB는 남길 것이 없다.
    /** 기존 `state.db`를 올려야 하는지 여부. */
    const migratesState = stateVersion > 0 && stateVersion < latestStateVersion;
    /** 기존 `settings.json`을 올려야 하는지 여부. */
    const migratesSettings = settingsFile.kind === 'found' && settingsFile.schemaVersion < latestSettingsVersion;
    if (migratesState || migratesSettings) {
      await backUpBeforeMigration({ dataDir, appVersion, db, stateVersion, settingsPath, settingsFile, logger });
    }

    // state.db를 마지막 형식으로 올린다.
    configureStateDatabase(db);
    migrateStateDatabase(db, stateMigrations);
    recordStateAppVersion(db, appVersion);
    if (stateVersion !== latestStateVersion) {
      logger.info('app-data.state-migrated', { fromVersion: stateVersion, toVersion: latestStateVersion });
    }

    // settings.json을 마지막 형식으로 올리거나, 첫 실행이면 기본 설정으로 만든다.
    if (settingsFile.kind === 'missing') {
      await writeFileAtomic(
        settingsPath,
        serializeSettingsFile({ ...DEFAULT_SETTINGS, schemaVersion: latestSettingsVersion }, appVersion),
      );
    } else if (migratesSettings) {
      await writeFileAtomic(
        settingsPath,
        serializeSettingsFile(migrateSettings(settingsFile.raw, settingsFile.schemaVersion, settingsMigrations), appVersion),
      );
      logger.info('app-data.settings-migrated', {
        fromVersion: settingsFile.schemaVersion,
        toVersion: latestSettingsVersion,
      });
    }

    return {
      kind: 'ready',
      settingsStore: new FileSettingsStore({ filePath: settingsPath, appVersion, schemaVersion: latestSettingsVersion }),
      stateStore: new SqliteStateStore(db),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    logger.error('app-data.open-failed', errorFields(error));
    throw error;
  }
}

/** DB를 닫고 새 버전 데이터라고 알린다. */
function newerData(
  db: StateDatabase,
  logger: Logger,
  createdByVersion: string | null,
  versions: Record<string, number>,
): NewerData {
  db.close();
  logger.warn('app-data.newer-data', { ...versions, createdByVersion });
  return { kind: 'newer-data', createdByVersion, message: newerDataMessage(createdByVersion) };
}

/** 마이그레이션 전 사본에 필요한 값. */
interface BackupInput {
  dataDir: string;
  appVersion: string;
  db: StateDatabase;
  stateVersion: number;
  settingsPath: string;
  settingsFile: SettingsFile;
  logger: Logger;
}

/**
 * 올리기 전의 `state.db`와 `settings.json`을 `backups/before-v<앱 버전>/`에 복사한다.
 * 같은 버전으로 다시 올리는 경우(앞선 마이그레이션이 실패해 되돌아간 경우)에는 덮어쓴다. 지우는 일은 업데이트 쪽이 맡는다.
 */
async function backUpBeforeMigration({
  dataDir,
  appVersion,
  db,
  stateVersion,
  settingsPath,
  settingsFile,
  logger,
}: BackupInput): Promise<void> {
  /** 사본 폴더. */
  const backupDir = join(dataDir, BACKUPS_DIR_NAME, `before-v${appVersion}`);
  await mkdir(backupDir, { recursive: true });

  if (stateVersion > 0) {
    /** `state.db` 사본 경로. */
    const stateCopy = join(backupDir, STATE_FILE_NAME);
    await rm(stateCopy, { force: true });
    copyStateDatabase(db, stateCopy);
  }
  if (settingsFile.kind === 'found') {
    await copyFile(settingsPath, join(backupDir, SETTINGS_FILE_NAME));
  }
  logger.info('app-data.backup-created', {
    backupDir,
    stateVersion,
    settingsVersion: settingsFile.kind === 'found' ? settingsFile.schemaVersion : null,
  });
}

/** `settings.json` 내용을 `from` 버전에서 마지막 버전까지 올린다. */
function migrateSettings(
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
