/** 업데이트 안내 파일(`latest.yml`, `latest-mac.yml`)을 읽은 내용. */
export interface UpdateManifest {
  /** 새 버전. */
  version: string;
  /** 파일 항목. yml을 읽은 그대로라 서명 목록 필드도 들어 있다. 형식은 받은 파일을 검증할 때 본다. */
  files: readonly unknown[];
}

/** 다 받은 업데이트 파일. */
export interface DownloadedUpdate {
  /** 받은 업데이트 파일의 절대 경로. */
  file: string;
  /** 이 파일을 받을 때 쓴 업데이트 안내. */
  manifest: UpdateManifest;
}

/** 업데이트 파일을 끝까지 받은 결과. */
export type DownloadOutcome =
  /** 받은 파일의 sha512가 업데이트 안내와 같다(electron-updater의 `update-downloaded`). 서명은 앱이 따로 검증한다. */
  | { kind: 'downloaded'; update: DownloadedUpdate }
  /** 받은 파일의 sha512가 업데이트 안내와 달라 업데이터가 받은 파일을 지웠다. 받은 파일이 안내와 다르므로 서명 검증 실패와 같게 다룬다. */
  | { kind: 'sha512-mismatch' };

/**
 * 업데이트 피드 포트. 공개 Release에서 새 버전을 찾고 그 업데이트 파일을 받는다.
 * 앱에서는 electron-updater의 `github` provider가 맡고, 테스트는 가짜 피드를 쓴다.
 */
export interface UpdateFeed {
  /** 지금 버전보다 새 버전을 찾는다. 있으면 그 업데이트 안내, 없으면 `null`. 확인하지 못하면 던진다. */
  check(): Promise<UpdateManifest | null>;
  /**
   * 마지막 확인에서 찾은 새 버전의 업데이트 파일을 받는다. 받은 비율(0~100)을 `onProgress`로 알린다.
   * 끝까지 받으면 그 결과를 돌려준다. 받지 못하면(네트워크 오류, 받다가 끊김 등) 던진다.
   */
  download(onProgress: (percent: number) => void): Promise<DownloadOutcome>;
}
