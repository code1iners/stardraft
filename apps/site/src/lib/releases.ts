// 서버 엔드포인트와 페이지가 함께 쓰는 Release 정보의 모양과 주소. 브라우저에서도 import하므로 Node 모듈을 쓰지 않는다.

/** 사이트에서 받을 수 있는 설치 파일의 OS. 다운로드 주소의 마지막 칸에 그대로 쓴다. */
export type InstallerOs = 'mac' | 'windows';

/** 설치 파일 OS 목록. 페이지에 그리는 순서이기도 하다. */
export const INSTALLER_OSES: readonly InstallerOs[] = ['mac', 'windows'];

/** 다운로드 사이트 주소. */
export const SITE_URL = 'https://stardraft.squadify.app/';

/** Release를 올리는 GitHub 저장소 이름. 주인은 배포 환경에서 받는다. */
export const RELEASE_REPO = 'stardraft';

/** 사람이 받는 설치 파일 하나. 앱이 쓰는 zip과 안내 파일(yml)은 넣지 않는다. */
export type InstallerFile = {
  /** 설치 파일의 OS. */
  os: InstallerOs;
  /** Release에 올라간 파일 이름. */
  name: string;
  /** 파일 크기(바이트). */
  size: number;
  /** GitHub가 계산한 SHA256(16진수 소문자). GitHub가 값을 주지 않은 파일은 null. */
  sha256: string | null;
};

/** 공개 Release 하나의 요약. */
export type ReleaseSummary = {
  /** 앞의 `v`를 뺀 버전. */
  version: string;
  /** 공개한 시각(ISO 8601). */
  date: string;
  /** 릴리스 노트 원문. 비어 있으면 빈 문자열. */
  notes: string;
  /** GitHub의 Release 페이지 주소. */
  url: string;
  /** 사람이 받는 설치 파일. OS마다 하나씩, 올라간 것만 든다. */
  files: InstallerFile[];
};

/** `/api/releases`의 응답 본문. */
export type ReleasesPayload = {
  /** 최근 공개 Release. 새 버전이 앞이다. */
  releases: ReleaseSummary[];
};

/** OS마다 설치 파일 이름. 빌드 설정의 산출물 이름과 같다. */
export function installerFileName(version: string, os: InstallerOs): string {
  return os === 'mac' ? `Stardraft-${version}-arm64.dmg` : `Stardraft-Setup-${version}.exe`;
}

/** 가장 최근 공개 버전의 설치 파일을 받는 주소. */
export function latestDownloadPath(os: InstallerOs): string {
  return `/download/${os}`;
}

/** 정해진 버전의 설치 파일을 받는 주소. */
export function versionDownloadPath(version: string, os: InstallerOs): string {
  return `/download/${version}/${os}`;
}

/** 저장소의 GitHub Release 목록 주소. */
export function releaseListUrl(owner: string): string {
  return `https://github.com/${owner}/${RELEASE_REPO}/releases`;
}
