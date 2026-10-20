import { constants, existsSync } from 'node:fs';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { errorFields, type Logger } from '../logging/logger';
import { DEFAULT_SETTINGS, type SettingsStore } from '../ports/settings-store';
import type { StateStore } from '../ports/state-store';
import { writeFileAtomic } from './atomic-file';
import {
  FileSettingsStore,
  migrateSettings,
  readSettingsFile,
  serializeSettingsFile,
  SETTINGS_MIGRATIONS,
  type SettingsFile,
  type SettingsMigration,
} from './file-settings-store';
import {
  copyStateDatabase,
  inspectStateDatabase,
  openStateDatabase,
  SqliteStateStore,
  STATE_MIGRATIONS,
} from './state-database';

/** 설정 파일 이름. */
const SETTINGS_FILE_NAME = 'settings.json';
/** 상태 DB 파일 이름. */
const STATE_FILE_NAME = 'state.db';
/** 마이그레이션 전 사본을 두는 폴더 이름. */
const BACKUPS_DIR_NAME = 'backups';

/** 데이터 폴더를 여는 데 필요한 값. */
export interface OpenAppDataOptions {
  /** 데이터 폴더. 없으면 만든다. */
  dataDir: string;
  /** 지금 앱 버전. 데이터에 남기고, 사본 폴더 이름에 쓴다. */
  appVersion: string;
  /** 진단 로그. */
  logger: Logger;
  /** `state.db` 마이그레이션. 테스트가 더 새 앱을 흉내 낼 때 바꿔 넣는다. */
  stateMigrations?: readonly string[];
  /** `settings.json` 마이그레이션. 테스트가 더 새 앱을 흉내 낼 때 바꿔 넣는다. */
  settingsMigrations?: readonly SettingsMigration[];
}

/** 형식 검사와 마이그레이션을 마친 데이터. */
export interface AppData {
  /** 결과 종류. */
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
  /** 결과 종류. */
  kind: 'newer-data';
  /** 데이터를 쓴 앱 버전. 모르면 `null`. */
  createdByVersion: string | null;
  /** 사용자에게 보일 안내. */
  message: string;
}

/**
 * 데이터 폴더의 `settings.json`과 `state.db`를 연다.
 *
 * 1. 두 파일의 형식 버전을 바꾸지 않고 읽는다. 하나라도 앱이 아는 것보다 새로우면 아무것도 쓰지 않고 `newer-data`를 돌려준다.
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
  /** 상태 DB 경로. */
  const statePath = join(dataDir, STATE_FILE_NAME);

  try {
    await mkdir(dataDir, { recursive: true });
    /** 디스크의 설정 파일. */
    const settingsFile = await readSettingsFile(settingsPath);
    /** 디스크의 `state.db` 형식. */
    const state = inspectStateDatabase(statePath);

    // 새 버전이 만든 데이터면 아무것도 바꾸지 않고 멈춘다.
    if (state.schemaVersion > latestStateVersion) {
      logger.warn('app-data.newer-state', { stateVersion: state.schemaVersion, latestStateVersion });
      return newerData(state.appVersion);
    }
    if (settingsFile.kind === 'found' && settingsFile.schemaVersion > latestSettingsVersion) {
      logger.warn('app-data.newer-settings', { settingsVersion: settingsFile.schemaVersion, latestSettingsVersion });
      return newerData(settingsFile.appVersion);
    }

    // 기존 데이터를 올려야 하면 올리기 직전에 사본을 남긴다. 파일이 없던 첫 실행은 남길 것이 없다.
    /** 기존 `state.db`를 올려야 하는지 여부. */
    const migratesState = state.schemaVersion > 0 && state.schemaVersion < latestStateVersion;
    /** 기존 `settings.json`을 올려야 하는지 여부. */
    const migratesSettings = settingsFile.kind === 'found' && settingsFile.schemaVersion < latestSettingsVersion;
    if (migratesState || migratesSettings) {
      await backUpBeforeMigration({
        backupDir: join(dataDir, BACKUPS_DIR_NAME, `before-v${appVersion}`),
        statePath: state.schemaVersion > 0 ? statePath : null,
        settingsPath: settingsFile.kind === 'found' ? settingsPath : null,
      });
      logger.info('app-data.backup-created', {
        appVersion,
        stateVersion: state.schemaVersion,
        settingsVersion: settingsFile.kind === 'found' ? settingsFile.schemaVersion : null,
      });
    }

    /** 마지막 형식으로 올린 `state.db` 연결. */
    const db = openStateDatabase(statePath, stateMigrations, appVersion);
    if (state.schemaVersion !== latestStateVersion) {
      logger.info('app-data.state-migrated', { fromVersion: state.schemaVersion, toVersion: latestStateVersion });
    }

    try {
      await writeLatestSettings(settingsPath, settingsFile, latestSettingsVersion, settingsMigrations, appVersion);
    } catch (error) {
      db.close();
      throw error;
    }
    if (migratesSettings) {
      logger.info('app-data.settings-migrated', { fromVersion: settingsFile.schemaVersion, toVersion: latestSettingsVersion });
    }

    return {
      kind: 'ready',
      settingsStore: new FileSettingsStore(settingsPath, appVersion),
      stateStore: new SqliteStateStore(db),
      close: () => db.close(),
    };
  } catch (error) {
    logger.error('app-data.open-failed', errorFields(error));
    throw error;
  }
}

/** 앱이 아는 것보다 새 형식의 데이터라는 결과. 안내 문구는 스펙의 원문이다. */
function newerData(createdByVersion: string | null): NewerData {
  /** 안내에 넣을 버전 표기. 버전을 모르면 쓰지 않는다. */
  const version = createdByVersion ? `(v${createdByVersion})` : '';
  return {
    kind: 'newer-data',
    createdByVersion,
    message: `이 데이터는 더 새 버전${version}에서 만들어졌습니다. 새 버전을 다시 설치하세요.`,
  };
}

/** 마이그레이션 전 사본에 필요한 값. */
interface BackupTargets {
  /** 사본을 둘 폴더. */
  backupDir: string;
  /** 복사할 `state.db`. 올릴 기존 DB가 없으면 `null`. */
  statePath: string | null;
  /** 복사할 `settings.json`. 파일이 없으면 `null`. */
  settingsPath: string | null;
}

/**
 * 올리기 전의 `state.db`와 `settings.json`을 사본 폴더에 복사한다.
 * 이미 있는 사본은 덮어쓰지 않는다. 같은 버전으로 다시 올리는 경우(예: `state.db`만 올라가고 `settings.json` 쓰기가 실패한 뒤)
 * 먼저 남긴 사본만이 올리기 전 원본이기 때문이다. 지우는 일은 업데이트 쪽이 맡는다.
 */
async function backUpBeforeMigration({ backupDir, statePath, settingsPath }: BackupTargets): Promise<void> {
  await mkdir(backupDir, { recursive: true });

  /** `state.db` 사본 경로. */
  const stateCopy = join(backupDir, STATE_FILE_NAME);
  if (statePath && !existsSync(stateCopy)) copyStateDatabase(statePath, stateCopy);

  if (settingsPath) {
    try {
      await copyFile(settingsPath, join(backupDir, SETTINGS_FILE_NAME), constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

/** `settings.json`을 마지막 형식으로 쓴다. 첫 실행이면 기본 설정을, 옛 형식이면 올린 내용을 쓰고, 이미 마지막 형식이면 두고 본다. */
async function writeLatestSettings(
  settingsPath: string,
  settingsFile: SettingsFile,
  latestVersion: number,
  migrations: readonly SettingsMigration[],
  appVersion: string,
): Promise<void> {
  if (settingsFile.kind === 'missing') {
    await writeFileAtomic(settingsPath, serializeSettingsFile({ ...DEFAULT_SETTINGS, schemaVersion: latestVersion }, appVersion));
  } else if (settingsFile.schemaVersion < latestVersion) {
    /** 마지막 형식으로 올린 내용. */
    const migrated = migrateSettings(settingsFile.raw, settingsFile.schemaVersion, migrations);
    await writeFileAtomic(settingsPath, serializeSettingsFile(migrated, appVersion));
  }
}
