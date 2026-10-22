import type { Logger as UpdaterLogger, ProgressInfo, UpdateCheckResult, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../core/fakes/fake-clock';
import { createLogger } from '../core/logging/logger';
import { electronUpdateFeed, type ElectronUpdater } from './update-feed';

/** 가짜 서명 하나(64바이트 base64). 어댑터는 서명을 검증하지 않고 그대로 넘긴다. */
const SIGNATURE = Buffer.alloc(64, 1).toString('base64');

/** 가짜 zip의 sha512. */
const ZIP_SHA512 = Buffer.alloc(64, 2).toString('base64');
/** yml을 읽은 것 같은 가짜 파일 항목. electron-builder가 쓰지 않는 서명 목록 필드가 있다. */
const ZIP_ENTRY = { url: 'Stardraft-0.2.0-arm64-mac.zip', sha512: ZIP_SHA512, size: 1024, stardraftSignatures: [SIGNATURE] };
/** yml을 읽은 것 같은 가짜 업데이트 안내. */
const UPDATE_INFO: UpdateInfo = {
  version: '0.2.0',
  files: [ZIP_ENTRY],
  path: 'Stardraft-0.2.0-arm64-mac.zip',
  sha512: ZIP_SHA512,
  releaseDate: '2026-10-22T01:00:00.000Z',
};

/** electron-updater의 `autoUpdater`처럼 이벤트를 내는 가짜 업데이터. 실제 GitHub에는 닿지 않는다. */
class FakeElectronUpdater extends EventEmitter implements ElectronUpdater {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  disableDifferentialDownload = false;
  disableWebInstaller = false;
  allowDowngrade = true;
  allowPrerelease = true;
  logger: UpdaterLogger | null = null;
  /** `checkForUpdates`가 돌려줄 결과. */
  checkResult: UpdateCheckResult | null = null;
  /** 받는 동안 낼 진행률. */
  progress: number[] = [];
  /** 받기를 실패시킬 오류. */
  downloadError: Error | null = null;

  async checkForUpdates(): Promise<UpdateCheckResult | null> {
    return this.checkResult;
  }

  async downloadUpdate(): Promise<string[]> {
    if (this.downloadError) throw this.downloadError;
    for (const percent of this.progress) this.emit('download-progress', { percent } as ProgressInfo);
    /** electron-updater처럼 안내에 받은 파일 경로를 더한 이벤트. */
    const event: UpdateDownloadedEvent = { ...UPDATE_INFO, downloadedFile: '/fake/cache/pending/Stardraft-0.2.0-arm64-mac.zip' };
    this.emit('update-downloaded', event);
    return [event.downloadedFile];
  }
}

/** 가짜 업데이터로 업데이트 피드를 만든다. 남긴 진단 로그 줄도 돌려준다. */
function setup() {
  const updater = new FakeElectronUpdater();
  /** 남긴 진단 로그 줄. */
  const logLines: string[] = [];
  const feed = electronUpdateFeed(updater, createLogger([{ write: (line) => logLines.push(line) }], new FakeClock()));
  return { updater, feed, logLines };
}

describe('electron-updater 업데이트 피드', () => {
  it('받기와 설치는 앱이 정하도록, 찾자마자 받기·끌 때 설치·차등 다운로드·웹 설치 파일·다운그레이드·사전 릴리스를 끈다', () => {
    const { updater } = setup();

    expect(updater).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      disableDifferentialDownload: true,
      disableWebInstaller: true,
      allowDowngrade: false,
      allowPrerelease: false,
    });
  });

  it('새 버전이 있으면 버전과 yml을 읽은 그대로의 파일 항목(서명 목록 필드 포함)을 돌려준다', async () => {
    const { updater, feed } = setup();
    updater.checkResult = { isUpdateAvailable: true, updateInfo: UPDATE_INFO, versionInfo: UPDATE_INFO };

    await expect(feed.check()).resolves.toEqual({
      version: '0.2.0',
      files: [{ url: 'Stardraft-0.2.0-arm64-mac.zip', sha512: ZIP_SHA512, size: 1024, stardraftSignatures: [SIGNATURE] }],
    });
  });

  it('새 버전이 없거나 업데이터가 꺼져 있으면 null이다', async () => {
    const { updater, feed } = setup();
    updater.checkResult = { isUpdateAvailable: false, updateInfo: UPDATE_INFO, versionInfo: UPDATE_INFO };
    await expect(feed.check()).resolves.toBeNull();

    updater.checkResult = null;
    await expect(feed.check()).resolves.toBeNull();
  });

  it('받는 동안 받은 비율을 알리고, update-downloaded의 받은 파일과 안내를 돌려준다', async () => {
    const { updater, feed } = setup();
    updater.progress = [12.5, 100];
    /** 알린 비율. */
    const percents: number[] = [];

    /** 받은 결과. */
    const outcome = await feed.download((percent) => percents.push(percent));

    expect(percents).toEqual([12.5, 100]);
    expect(outcome).toEqual({
      kind: 'downloaded',
      update: { file: '/fake/cache/pending/Stardraft-0.2.0-arm64-mac.zip', manifest: { version: '0.2.0', files: UPDATE_INFO.files } },
    });
  });

  it('받은 파일의 sha512가 안내와 달라 electron-updater가 거부하면(ERR_CHECKSUM_MISMATCH) 던지지 않고 sha512 불일치를 돌려준다', async () => {
    const { updater, feed } = setup();
    // builder-util-runtime의 newError처럼 code를 붙인 오류다.
    updater.downloadError = Object.assign(new Error('sha512 checksum mismatch, expected AAAA, got BBBB'), { code: 'ERR_CHECKSUM_MISMATCH' });

    await expect(feed.download(() => {})).resolves.toEqual({ kind: 'sha512-mismatch' });
  });

  it('받지 못하면(네트워크 오류, 받다가 끊김) 그 오류를 그대로 던진다', async () => {
    const { updater, feed } = setup();
    updater.downloadError = new Error('net::ERR_CONNECTION_RESET');

    await expect(feed.download(() => {})).rejects.toThrow('net::ERR_CONNECTION_RESET');
  });

  it('electron-updater가 낸 오류 이벤트는 앱을 멈추지 않고 진단 로그에 남긴다', () => {
    const { updater, logLines } = setup();

    expect(() => updater.emit('error', new Error('Code signature did not pass validation'))).not.toThrow();
    expect(logLines.some((line) => line.includes('"update.updater-error"') && line.includes('did not pass validation'))).toBe(true);
  });

  it('electron-updater의 로그를 수준 그대로 진단 로그에 남긴다', () => {
    const { updater, logLines } = setup();

    updater.logger?.info('Checking for update');
    updater.logger?.warn('Cannot download differentially');

    expect(logLines.some((line) => line.includes('"info"') && line.includes('"update.updater-log"') && line.includes('Checking for update'))).toBe(true);
    expect(
      logLines.some((line) => line.includes('"warn"') && line.includes('"update.updater-log"') && line.includes('Cannot download differentially')),
    ).toBe(true);
  });
});
