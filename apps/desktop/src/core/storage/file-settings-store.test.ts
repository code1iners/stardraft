import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION } from '../ports/settings-store';
import { FileSettingsStore } from './file-settings-store';

/** 테스트마다 만드는 임시 데이터 폴더. */
let dataDir: string;
/** 임시 데이터 폴더의 `settings.json`. */
let settingsPath: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'stardraft-settings-'));
  settingsPath = join(dataDir, 'settings.json');
});

afterEach(() => {
  chmodSync(dataDir, 0o755);
  rmSync(dataDir, { recursive: true, force: true });
});

/** 테스트 대상 설정 저장소. */
function createStore(appVersion = '0.1.0'): FileSettingsStore {
  return new FileSettingsStore(settingsPath, appVersion);
}

describe('설정 파일 저장소', () => {
  it('설정 파일이 없으면 기본 설정을 돌려준다', async () => {
    await expect(createStore().load()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it('저장한 설정을 다시 켠 앱이 그대로 읽는다', async () => {
    const settings = { ...DEFAULT_SETTINGS, workFolders: ['/fake/workspace'], launchAtLogin: true };

    await createStore().save(settings);

    await expect(createStore().load()).resolves.toEqual(settings);
  });

  it('파일에는 형식 버전과 저장한 앱 버전이 남고, 임시 파일은 남지 않는다', async () => {
    await createStore('0.3.1').save(DEFAULT_SETTINGS);

    /** 저장된 파일 내용. */
    const saved = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    expect(saved).toMatchObject({ schemaVersion: 1, appVersion: '0.3.1' });
    expect(readdirSync(dataDir)).toEqual(['settings.json']);
  });

  it('임시 파일을 쓰지 못하면 저장이 실패하고 원래 파일은 그대로다', async () => {
    await createStore().save({ ...DEFAULT_SETTINGS, extraInstructions: '원래 지침' });
    /** 실패 전 파일 내용. */
    const before = readFileSync(settingsPath, 'utf8');
    chmodSync(dataDir, 0o555);

    await expect(createStore().save({ ...DEFAULT_SETTINGS, extraInstructions: '새 지침' })).rejects.toThrow();

    expect(readFileSync(settingsPath, 'utf8')).toBe(before);
    expect(readdirSync(dataDir)).toEqual(['settings.json']);
  });

  it('잇달아 바꾼 설정은 마지막 것이 남는다', async () => {
    const store = createStore();

    await Promise.all(
      Array.from({ length: 20 }, (_, index) => store.save({ ...DEFAULT_SETTINGS, extraInstructions: `지침 ${index}` })),
    );

    await expect(createStore().load()).resolves.toMatchObject({ extraInstructions: '지침 19' });
    expect(readdirSync(dataDir)).toEqual(['settings.json']);
  });

  it('같은 형식 버전에서 빠진 필드는 기본값으로 채운다', async () => {
    writeFileSync(settingsPath, JSON.stringify({ schemaVersion: 1, extraInstructions: '가짜 지침' }));

    await expect(createStore().load()).resolves.toEqual({ ...DEFAULT_SETTINGS, extraInstructions: '가짜 지침' });
  });

  it('재현 키가 없던 옛 파일은 재현 허용 없음과 재현 도구 권한 자동으로 읽는다. 스키마 버전은 올리지 않는다', async () => {
    writeFileSync(settingsPath, JSON.stringify({ schemaVersion: 1, extraInstructions: '가짜 지침' }));

    const settings = await createStore().load();

    expect(settings.reproductionRepos).toEqual({});
    expect(settings.reproductionTools).toEqual({ mode: 'auto', enabledServers: {} });
    expect(SETTINGS_SCHEMA_VERSION).toBe(1);
  });

  it('옛 작업 폴더 키는 설정에 없고, 파일에는 그대로 남으며 형식 버전도 그대로다', async () => {
    writeFileSync(settingsPath, JSON.stringify({ schemaVersion: 1, workFolders: ['/fake/code'], extraInstructions: '가짜 지침' }));
    const store = createStore();

    /** 읽은 설정. */
    const loaded = await store.load();
    await store.save({ ...loaded, launchAtLogin: true });

    expect(DEFAULT_SETTINGS).not.toHaveProperty('workFolders');
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toMatchObject({ schemaVersion: 1, workFolders: ['/fake/code'], launchAtLogin: true });
  });
});
