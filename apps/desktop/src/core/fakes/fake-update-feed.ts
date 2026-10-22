import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DownloadOutcome, InstallFailure, UpdateFeed, UpdateManifest } from '../ports/update-feed';

/** 가짜 피드에 공개한 Release 하나. */
export interface FakeUpdateRelease {
  /** 업데이트 안내. yml을 읽은 내용처럼 버전과 파일 항목을 담는다. */
  manifest: UpdateManifest;
  /** 받은 파일의 이름. electron-updater는 안내 파일 항목의 `url`에서 이 이름을 얻는다. */
  fileName: string;
  /** 받을 파일의 내용. */
  content: string;
}

/**
 * 공개한 Release를 돌려주고, 받으면 그 내용을 임시 폴더에 파일로 쓰는 업데이트 피드. 실제 GitHub에는 닿지 않는다.
 * 받은 내용의 sha512를 안내와 견주지는 않는다. 앱이 업데이터의 확인에 기대지 않고 직접 다시 계산하는지 보려는 것이다.
 */
export class FakeUpdateFeed implements UpdateFeed {
  /** 지금 공개된 최신 Release. `null`이면 지금 버전이 최신이다. */
  latest: FakeUpdateRelease | null = null;
  /** 확인을 실패시킬 오류. 있으면 확인할 때마다 던진다. */
  checkError: Error | null = null;
  /** 다운로드를 실패시킬 오류. 있으면 받을 때마다 던진다. */
  downloadError: Error | null = null;
  /** 참이면 electron-updater처럼 받은 파일의 sha512가 안내와 다르다며 파일을 남기지 않는다. */
  sha512Mismatch = false;
  /** 받는 동안 차례로 알릴 진행률. */
  progress: number[] = [];
  /** 확인한 횟수. */
  checkCount = 0;
  /** 받기 시작한 횟수. 받지 못했거나 sha512가 달라 파일을 남기지 않은 것도 센다. */
  downloadCount = 0;
  /** 받은 파일의 경로. 받은 순서다. */
  readonly downloads: string[] = [];
  /** 설치하며 다시 시작한 횟수. 실제 앱이라면 여기서 꺼진다. */
  installCount = 0;
  /** 설치하지 못했을 때 부를 함수. */
  private readonly installFailureListeners = new Set<(failure: InstallFailure) => void>();
  /** 마지막 확인에서 찾은 Release. electron-updater처럼 받을 때는 이것을 받는다. */
  private found: FakeUpdateRelease | null = null;

  /** `downloadDir`은 받은 파일을 쓸 폴더다. */
  constructor(private readonly downloadDir: string) {}

  async check(): Promise<UpdateManifest | null> {
    this.checkCount += 1;
    if (this.checkError) throw this.checkError;
    this.found = this.latest;
    return this.found && structuredClone(this.found.manifest);
  }

  async download(onProgress: (percent: number) => void): Promise<DownloadOutcome> {
    /** 받을 Release. */
    const release = this.found;
    if (!release) throw new Error('새 버전을 찾기 전에 받으려 했습니다.');
    this.downloadCount += 1;
    if (this.downloadError) throw this.downloadError;

    for (const percent of this.progress) onProgress(percent);
    if (this.sha512Mismatch) return { kind: 'sha512-mismatch' };
    /** 받은 파일의 경로. */
    const file = join(this.downloadDir, release.fileName);
    await writeFile(file, release.content);
    this.downloads.push(file);
    return { kind: 'downloaded', update: { file, manifest: structuredClone(release.manifest) } };
  }

  install(): void {
    this.installCount += 1;
  }

  onInstallFailed(listener: (failure: InstallFailure) => void): () => void {
    this.installFailureListeners.add(listener);
    return () => {
      this.installFailureListeners.delete(listener);
    };
  }

  /** electron-updater처럼 앱 안에서 설치하지 못했다고 알린다. 앱은 꺼지지 않은 채다. */
  failInstall(failure: InstallFailure): void {
    for (const listener of this.installFailureListeners) listener(failure);
  }
}
