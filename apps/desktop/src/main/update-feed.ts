import type { Logger as UpdaterLogger, ProgressInfo, UpdateCheckResult, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import { errorFields, type Logger } from '../core/logging/logger';
import type { UpdateFeed, UpdateManifest } from '../core/ports/update-feed';

/** 어댑터가 쓰는 electron-updater의 부분. 앱에서는 `autoUpdater`를 넘기고, 테스트는 가짜를 넘긴다. */
export interface ElectronUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  disableDifferentialDownload: boolean;
  disableWebInstaller: boolean;
  allowDowngrade: boolean;
  allowPrerelease: boolean;
  logger: UpdaterLogger | null;
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  downloadUpdate(): Promise<string[]>;
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): unknown;
  on(event: 'update-downloaded', listener: (event: UpdateDownloadedEvent) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/**
 * electron-updater의 `github` provider로 공개 Release에서 새 버전을 찾고 받는 업데이트 피드.
 * 받을지와 설치할 때는 앱이 정한다. 찾자마자 받지 않고(위치 확인 뒤 앱이 받음), 끌 때 설치하지 않는다(사용자가 [다시 시작]을 누를 때만).
 */
export function electronUpdateFeed(updater: ElectronUpdater, logger: Logger): UpdateFeed {
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  // 차등 다운로드는 쓰지 않아 blockmap도 올리지 않는다. 웹 설치 파일도 쓰지 않는다.
  updater.disableDifferentialDownload = true;
  updater.disableWebInstaller = true;
  // 옛 버전 재설치는 지원하지 않고, 사전 릴리스는 잘못 나간 버전을 멈출 때만 쓰므로 받지 않는다.
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  updater.logger = updaterLogger(logger);

  /** 진행 중인 다운로드가 받은 비율을 알릴 곳. 받는 중이 아니면 `null`. */
  let reportProgress: ((percent: number) => void) | null = null;
  /** 마지막으로 받은 업데이트 파일과 그 안내. */
  let lastDownloaded: UpdateDownloadedEvent | null = null;
  updater.on('download-progress', (info) => reportProgress?.(info.percent));
  updater.on('update-downloaded', (event) => {
    lastDownloaded = event;
  });
  // 듣는 곳이 없으면 EventEmitter가 오류를 던져 앱이 멈춘다. Squirrel.Mac의 오류도 이 이벤트로 온다.
  updater.on('error', (error) => logger.warn('update.updater-error', errorFields(error)));

  return {
    async check() {
      /** 확인 결과. 소스 실행처럼 업데이터가 꺼져 있으면 `null`이다. */
      const result = await updater.checkForUpdates();
      return result?.isUpdateAvailable ? manifestOf(result.updateInfo) : null;
    },
    async download(onProgress) {
      reportProgress = onProgress;
      /** 받은 파일의 경로. electron-updater는 update-downloaded를 낸 뒤에 이 약속을 푼다. */
      let files: string[];
      try {
        files = await updater.downloadUpdate();
      } finally {
        reportProgress = null;
      }
      // 이번 다운로드가 낸 update-downloaded인지 받은 파일로 확인한다.
      if (!lastDownloaded || lastDownloaded.downloadedFile !== files[0]) throw new Error('update-downloaded 없이 다운로드가 끝났습니다.');
      return { file: lastDownloaded.downloadedFile, manifest: manifestOf(lastDownloaded) };
    },
  };
}

/** electron-updater가 읽은 업데이트 안내를 앱의 모양으로 바꾼다. 파일 항목은 yml을 읽은 그대로 넘겨 서명 목록 필드를 살린다. */
function manifestOf(info: UpdateInfo): UpdateManifest {
  return { version: String(info.version), files: Array.isArray(info.files) ? [...info.files] : [] };
}

/** electron-updater의 로그를 진단 로그에 같은 수준으로 남기는 로거. */
function updaterLogger(logger: Logger): UpdaterLogger {
  return {
    info: (message: unknown) => logger.info('electron-updater', { message: String(message) }),
    warn: (message: unknown) => logger.warn('electron-updater', { message: String(message) }),
    error: (message: unknown) => logger.error('electron-updater', { message: String(message) }),
  };
}
