import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock } from '../fakes/fake-clock';
import { createLogger } from '../logging/logger';
import { MigrationBackups } from './migration-backups';

/** 지금 시각. 2026-10-22 10:00:00 한국 표준시. */
const NOW = Date.UTC(2026, 9, 22, 1, 0, 0);
/** 하루(밀리초). */
const DAY_MS = 24 * 60 * 60 * 1000;

/** 테스트마다 만드는 데이터 폴더. */
let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'stardraft-backups-'));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

/** 앱이 마이그레이션 직전에 남기는 것처럼 사본 폴더를 만든다. */
function makeBackup(version: string): void {
  /** 사본 폴더. */
  const folder = join(dataDir, 'backups', `before-v${version}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'state.db'), '가짜 state.db');
  writeFileSync(join(folder, 'settings.json'), '{}');
}

/** 남은 사본 폴더 이름. */
function remainingBackups(): string[] {
  return readdirSync(join(dataDir, 'backups')).sort();
}

/** 사본 정리를 만든다. */
function backupsWith(clock: FakeClock): MigrationBackups {
  return new MigrationBackups({ dataDir, clock, logger: createLogger([{ write: () => {} }], clock) });
}

describe('마이그레이션 전 사본', () => {
  it('새 버전이 정상으로 뜬 때부터 7일이 지나면 지우고, 그 전에는 남긴다. 켜 둔 앱도 하루마다 다시 본다', async () => {
    makeBackup('0.2.0');
    const clock = new FakeClock(NOW);
    const backups = backupsWith(clock);

    await backups.start();
    expect(remainingBackups()).toEqual(['before-v0.2.0']);

    clock.advance(6 * DAY_MS);
    await backups.whenIdle();
    expect(remainingBackups()).toEqual(['before-v0.2.0']);

    clock.advance(DAY_MS);
    await backups.whenIdle();
    expect(remainingBackups()).toEqual([]);
    backups.stop();
  });

  it('다시 켜도 처음 정상으로 뜬 때부터 센다', async () => {
    makeBackup('0.2.0');
    const first = backupsWith(new FakeClock(NOW));
    await first.start();
    first.stop();

    const relaunched = backupsWith(new FakeClock(NOW + 7 * DAY_MS));
    await relaunched.start();
    relaunched.stop();

    expect(remainingBackups()).toEqual([]);
  });

  it('업데이트 직후 생긴 사본은 그 실행부터 세어, 앞선 버전의 사본과 따로 지운다', async () => {
    makeBackup('0.2.0');
    const first = backupsWith(new FakeClock(NOW));
    await first.start();
    first.stop();

    makeBackup('0.3.0');
    const updated = backupsWith(new FakeClock(NOW + 3 * DAY_MS));
    await updated.start();
    updated.stop();
    const later = backupsWith(new FakeClock(NOW + 7 * DAY_MS));
    await later.start();
    later.stop();

    expect(remainingBackups()).toEqual(['before-v0.3.0']);
  });

  it('사본 폴더가 없으면 아무것도 하지 않는다', async () => {
    const backups = backupsWith(new FakeClock(NOW));

    await backups.start();
    backups.stop();

    expect(existsSync(join(dataDir, 'backups'))).toBe(false);
  });
});
