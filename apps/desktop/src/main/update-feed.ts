import type { Logger as UpdaterLogger, ProgressInfo, UpdateCheckResult, UpdateDownloadedEvent, UpdateInfo } from 'electron-updater';
import { errorFields, type Logger } from '../core/logging/logger';
import type { InstallFailure, UpdateFeed, UpdateManifest } from '../core/ports/update-feed';

/** electron-updater가 받은 파일의 sha512가 업데이트 안내와 다를 때 던지는 오류 코드. 이때 받은 파일은 이미 지웠다. */
const CHECKSUM_MISMATCH_CODE = 'ERR_CHECKSUM_MISMATCH';
/** Squirrel.Mac이 새 번들의 코드 서명을 거부할 때 오류 문구에 들어 있는 말. 이 버전은 앱 안에서 설치할 수 없다. */
const SQUIRREL_REJECTED_TEXT = 'did not pass validation';

/** 어댑터가 쓰는 electron-updater의 부분. 앱에서는 `autoUpdater`를 넘기고, 테스트는 가짜를 넘긴다. */
export interface ElectronUpdater {
  /** 새 버전을 찾자마자 받을지 여부. */
  autoDownload: boolean;
  /** 받은 업데이트를 앱을 끌 때 설치할지 여부. */
  autoInstallOnAppQuit: boolean;
  /** 차등 다운로드(blockmap으로 바뀐 부분만 받기)를 끌지 여부. */
  disableDifferentialDownload: boolean;
  /** Windows 웹 설치 파일(설치 중에 패키지를 받는 설치 파일)을 쓰지 않을지 여부. */
  disableWebInstaller: boolean;
  /** 지금보다 낮은 버전으로 바꾸는 것을 허용할지 여부. */
  allowDowngrade: boolean;
  /** 사전 릴리스를 받을지 여부. */
  allowPrerelease: boolean;
  /** electron-updater가 자기 로그를 남길 곳. */
  logger: UpdaterLogger | null;
  /** 새 버전을 확인한다. 업데이터가 꺼져 있으면(소스 실행) `null`. 확인하지 못하면 던진다. */
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  /** 마지막 확인에서 찾은 버전을 받는다. 받은 파일의 경로를 돌려주고, 첫 경로가 업데이트 파일이다. 받지 못하면 던진다. */
  downloadUpdate(): Promise<string[]>;
  /**
   * 받아 둔 업데이트를 설치하며 앱을 끄고 다시 켠다. `isSilent`와 `isForceRunAfter`는 Windows 설치 파일을 창 없이 돌리고 설치 뒤 앱을 켤지 여부다.
   * macOS는 이때 Squirrel.Mac에 업데이트를 넘기고, 거부하면 앱을 끄지 않고 `error`를 낸다.
   */
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  /** 받는 동안 받은 비율을 알린다. */
  on(event: 'download-progress', listener: (info: ProgressInfo) => void): unknown;
  /** 다 받았다. 업데이트 안내에 받은 파일 경로(`downloadedFile`)를 더한 값을 준다. */
  on(event: 'update-downloaded', listener: (event: UpdateDownloadedEvent) => void): unknown;
  /** 확인·다운로드·설치 중의 오류. 듣는 곳이 없으면 EventEmitter가 던진다. */
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
  /** 설치를 맡긴 뒤인지 여부. 그 뒤의 오류는 설치하지 못한 것이다. */
  let installing = false;
  /** 설치하지 못했을 때 부를 함수. */
  const installFailureListeners = new Set<(failure: InstallFailure) => void>();
  updater.on('download-progress', (info) => reportProgress?.(info.percent));
  updater.on('update-downloaded', (event) => {
    lastDownloaded = event;
  });
  // 듣는 곳이 없으면 EventEmitter가 오류를 던져 앱이 멈춘다. Squirrel.Mac의 오류도 이 이벤트로 온다.
  updater.on('error', (error) => {
    logger.warn('update.updater-error', errorFields(error));
    if (!installing) return;
    installing = false;
    /** 설치하지 못한 까닭. */
    const failure: InstallFailure = String(error?.message ?? '').includes(SQUIRREL_REJECTED_TEXT) ? 'rejected' : 'failed';
    for (const listener of installFailureListeners) listener(failure);
  });

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
      } catch (error) {
        // 끝까지 받았지만 sha512가 안내와 다르다. 받다가 끊긴 것은 네트워크 오류로 오므로 여기에 들지 않는다.
        if ((error as NodeJS.ErrnoException).code === CHECKSUM_MISMATCH_CODE) return { kind: 'sha512-mismatch' };
        throw error;
      } finally {
        reportProgress = null;
      }
      // 이번 다운로드가 낸 update-downloaded인지 받은 파일로 확인한다.
      if (!lastDownloaded || lastDownloaded.downloadedFile !== files[0]) throw new Error('update-downloaded 없이 다운로드가 끝났습니다.');
      return { kind: 'downloaded', update: { file: lastDownloaded.downloadedFile, manifest: manifestOf(lastDownloaded) } };
    },
    install() {
      installing = true;
      // Windows는 사용자별 설치라 UAC 없이 조용히 설치하고 새 버전을 켠다. macOS는 두 인수를 쓰지 않는다.
      updater.quitAndInstall(true, true);
    },
    onInstallFailed(listener) {
      installFailureListeners.add(listener);
      return () => {
        installFailureListeners.delete(listener);
      };
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
    info: (message: unknown) => logger.info('update.updater-log', { message: String(message) }),
    warn: (message: unknown) => logger.warn('update.updater-log', { message: String(message) }),
    error: (message: unknown) => logger.error('update.updater-log', { message: String(message) }),
  };
}
