import { INSTALLER_OSES, installerFileName, type InstallerFile, type InstallerOs, type ReleasesPayload, type ReleaseSummary } from './releases';

/** Release를 읽어 올 GitHub 저장소와 그 요청에 쓰는 것. */
export type ReleaseSource = {
  /** GitHub API를 부르는 fetch. 테스트는 가짜를 넣는다. */
  fetch: typeof fetch;
  /** 저장소 주인. */
  owner: string;
  /** 저장소 이름. */
  repo: string;
  /** 공개 정보만 읽는 토큰. 없으면 인증 없이 부른다(한도가 낮아 로컬 개발에서만). */
  token: string | undefined;
};

/** 엔드포인트가 쓰는 GitHub Release 응답의 일부. */
type GitHubRelease = {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  body: string | null;
  html_url: string;
  assets: GitHubAsset[];
};

/** 엔드포인트가 쓰는 GitHub Release 파일 응답의 일부. */
type GitHubAsset = {
  name: string;
  size: number;
  /** `sha256:<16진수>`. 오래전에 올린 파일은 null일 수 있다. */
  digest: string | null;
  browser_download_url: string;
};

/** 최근 Release를 한 번에 읽는 개수. 사전 릴리스로 멈춘 버전이 끼어도 공개 Release가 남을 만큼 둔다. */
const RELEASE_PAGE_SIZE = 30;

/** GitHub가 정상 응답을 주지 않았을 때. */
class GitHubUnavailableError extends Error {}

/** 주소의 OS 칸을 설치 파일 OS로 읽는다. 모르는 값이면 null. */
function parseOs(value: string | undefined): InstallerOs | null {
  return value === 'mac' || value === 'windows' ? value : null;
}

/** GitHub API를 부른다. 404면 null, 그 밖의 실패는 GitHubUnavailableError. */
async function requestGitHub<T>(source: ReleaseSource, path: string): Promise<T | null> {
  /** 요청 머리글. */
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'stardraft-site',
  };
  if (source.token) headers.Authorization = `Bearer ${source.token}`;

  /** GitHub 응답. */
  let response: Response;
  try {
    response = await source.fetch(`https://api.github.com/repos/${source.owner}/${source.repo}${path}`, { headers });
  } catch (error) {
    throw new GitHubUnavailableError('GitHub에 연결하지 못했습니다.', { cause: error });
  }
  if (response.status === 404) return null;
  if (!response.ok) throw new GitHubUnavailableError(`GitHub가 ${response.status}로 답했습니다.`);
  return (await response.json()) as T;
}

/** 공개 Release인가요? 초안과 사전 릴리스(잘못 나가 멈춘 버전)는 고르지 않는다. */
function isPublished(release: GitHubRelease): boolean {
  return !release.draft && !release.prerelease;
}

/** 공개 Release를 새 것부터. GitHub 목록은 만든 순서의 역순이다. */
async function listPublishedReleases(source: ReleaseSource): Promise<GitHubRelease[]> {
  /** 최근 Release 목록. */
  const releases = await requestGitHub<GitHubRelease[]>(source, `/releases?per_page=${RELEASE_PAGE_SIZE}`);
  return (releases ?? []).filter(isPublished);
}

/** 태그 이름에서 앞의 `v`를 뺀 버전. */
function versionOf(release: GitHubRelease): string {
  return release.tag_name.replace(/^v/, '');
}

/** Release에서 OS의 설치 파일. */
function findInstaller(release: GitHubRelease, os: InstallerOs): GitHubAsset | undefined {
  /** 찾을 파일 이름. */
  const name = installerFileName(versionOf(release), os);
  return release.assets.find((asset) => asset.name === name);
}

/** 설치 파일로 보내는 응답. 사전 릴리스로 멈춘 버전이 바로 빠지도록 CDN에 담아 두지 않는다. */
function redirectTo(url: string): Response {
  return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } });
}

/** 사람이 읽는 오류 응답. 실패를 CDN에 담아 두지 않는다. */
function textError(status: number, message: string): Response {
  return new Response(message, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

/** GitHub 실패를 응답으로 바꾼다. */
async function withGitHubErrors(run: () => Promise<Response>, toResponse: (message: string) => Response): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof GitHubUnavailableError) return toResponse(error.message);
    throw error;
  }
}

/** `/download/<os>`: 가장 최근 공개 Release의 설치 파일로 302 한다. */
export function latestDownloadResponse(source: ReleaseSource, osParam: string | undefined): Promise<Response> {
  /** 받을 OS. */
  const os = parseOs(osParam);
  if (!os) return Promise.resolve(textError(404, '이 OS용 설치 파일은 없습니다.'));

  return withGitHubErrors(
    async () => {
      /** 가장 최근 공개 Release. */
      const [latest] = await listPublishedReleases(source);
      /** 그 Release의 설치 파일. */
      const installer = latest && findInstaller(latest, os);
      if (!installer) return textError(404, '아직 공개된 설치 파일이 없습니다.');
      return redirectTo(installer.browser_download_url);
    },
    (message) => textError(502, `설치 파일을 찾지 못했습니다. 잠시 뒤 다시 시도하세요. (${message})`),
  );
}

/** SemVer 버전 모양(앞의 `v` 없이). 태그 주소에 그대로 넣으므로 다른 문자는 받지 않는다. */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** `/download/<버전>/<os>`: 그 버전의 공개 Release 설치 파일로 302 한다. */
export function versionDownloadResponse(source: ReleaseSource, version: string | undefined, osParam: string | undefined): Promise<Response> {
  /** 받을 OS. */
  const os = parseOs(osParam);
  if (!os) return Promise.resolve(textError(404, '이 OS용 설치 파일은 없습니다.'));
  if (!version || !VERSION_PATTERN.test(version)) return Promise.resolve(textError(404, '버전 모양이 아닙니다. 예: /download/0.1.0/mac'));

  return withGitHubErrors(
    async () => {
      /** 그 버전의 Release. */
      const release = await requestGitHub<GitHubRelease>(source, `/releases/tags/v${version}`);
      /** 그 Release의 설치 파일. 초안과 사전 릴리스는 없는 것으로 본다. */
      const installer = release && isPublished(release) ? findInstaller(release, os) : undefined;
      if (!installer) return textError(404, `v${version}의 공개된 설치 파일이 없습니다.`);
      return redirectTo(installer.browser_download_url);
    },
    (message) => textError(502, `설치 파일을 찾지 못했습니다. 잠시 뒤 다시 시도하세요. (${message})`),
  );
}

/** `/api/releases`가 내주는 Release 수. 변경 내역 섹션이 최근 3개를 보인다. */
const SUMMARY_COUNT = 3;

/** `/api/releases`를 CDN에 담아 두는 머리글. 브라우저는 매번 CDN에 묻고, CDN은 5분 동안 GitHub를 다시 부르지 않는다. */
const RELEASES_CACHE_CONTROL = 'public, max-age=0, s-maxage=300';

/** GitHub의 `sha256:<16진수>` digest에서 16진수만. 다른 알고리즘이거나 없으면 null. */
function sha256Of(asset: GitHubAsset): string | null {
  return asset.digest?.startsWith('sha256:') ? asset.digest.slice('sha256:'.length) : null;
}

/** GitHub Release를 페이지가 쓰는 요약으로 바꾼다. */
function summarize(release: GitHubRelease): ReleaseSummary {
  /** OS마다 올라간 설치 파일. */
  const files = INSTALLER_OSES.flatMap((os): InstallerFile[] => {
    const asset = findInstaller(release, os);
    return asset ? [{ os, name: asset.name, size: asset.size, sha256: sha256Of(asset) }] : [];
  });
  return {
    version: versionOf(release),
    // 공개 Release에는 늘 공개 시각이 있다.
    date: release.published_at ?? '',
    notes: release.body ?? '',
    url: release.html_url,
    files,
  };
}

/** `/api/releases`: 최근 공개 Release의 요약을 CDN에 5분 담아 두게 내준다. */
export function releasesApiResponse(source: ReleaseSource): Promise<Response> {
  return withGitHubErrors(
    async () => {
      /** 응답 본문. */
      const payload: ReleasesPayload = { releases: (await listPublishedReleases(source)).slice(0, SUMMARY_COUNT).map(summarize) };
      return Response.json(payload, { headers: { 'Cache-Control': RELEASES_CACHE_CONTROL } });
    },
    (message) => Response.json({ error: message }, { status: 502, headers: { 'Cache-Control': 'no-store' } }),
  );
}
