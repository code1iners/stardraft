import { describe, expect, it } from 'vitest';
import { latestDownloadResponse, releasesApiResponse, versionDownloadResponse, type ReleaseSource } from './release-endpoints';
import type { ReleasesPayload } from './releases';

/** 가짜 GitHub Release 파일 하나. */
type FakeAsset = { name: string; size?: number; digest?: string | null };

/** 가짜 GitHub Release 하나. */
type FakeRelease = { tag: string; draft?: boolean; prerelease?: boolean; publishedAt?: string; body?: string; assets?: FakeAsset[] };

/** 저장소 주인과 이름. 가짜 값이다. */
const OWNER = 'example-owner';
const REPO = 'stardraft';

/** 버전마다 Release에 올라가는 다섯 파일. */
function releaseAssets(version: string): FakeAsset[] {
  return [
    { name: `Stardraft-${version}-arm64.dmg`, size: 121_000_000, digest: `sha256:${'a'.repeat(64)}` },
    { name: `Stardraft-${version}-arm64-mac.zip`, size: 118_000_000, digest: `sha256:${'b'.repeat(64)}` },
    { name: 'latest-mac.yml', size: 500 },
    { name: `Stardraft-Setup-${version}.exe`, size: 98_000_000, digest: `sha256:${'c'.repeat(64)}` },
    { name: 'latest.yml', size: 400 },
  ];
}

/** GitHub API의 Release 응답 모양으로 바꾼 것. */
function toGitHubRelease(release: FakeRelease) {
  return {
    tag_name: release.tag,
    draft: release.draft ?? false,
    prerelease: release.prerelease ?? false,
    published_at: release.draft ? null : (release.publishedAt ?? '2026-11-10T03:00:00Z'),
    body: release.body ?? null,
    html_url: `https://github.com/${OWNER}/${REPO}/releases/tag/${release.tag}`,
    assets: (release.assets ?? releaseAssets(release.tag.replace(/^v/, ''))).map((asset) => ({
      name: asset.name,
      size: asset.size ?? 1,
      digest: asset.digest ?? null,
      browser_download_url: `https://github.com/${OWNER}/${REPO}/releases/download/${release.tag}/${asset.name}`,
    })),
  };
}

/** 받은 요청을 기록하고, 들고 있는 Release 목록으로 GitHub API처럼 답하는 가짜 fetch. */
function fakeGitHub(releases: FakeRelease[], options: { status?: number } = {}) {
  /** 받은 요청. */
  const requests: Request[] = [];
  /** 가짜 fetch. */
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);

    // 대본에 오류 응답이 있나요?
    if (options.status) return new Response('{}', { status: options.status });

    const url = new URL(request.url);
    const base = `/repos/${OWNER}/${REPO}/releases`;
    if (url.pathname === base) return Response.json(releases.map(toGitHubRelease));

    const tag = url.pathname.startsWith(`${base}/tags/`) ? decodeURIComponent(url.pathname.slice(`${base}/tags/`.length)) : null;
    // GitHub은 공개 정보만 읽는 토큰에게 초안을 보여 주지 않는다.
    const found = releases.find((release) => release.tag === tag && !release.draft);
    if (found) return Response.json(toGitHubRelease(found));
    return Response.json({ message: 'Not Found' }, { status: 404 });
  };
  /** 엔드포인트에 넘길 출처. */
  const source: ReleaseSource = { fetch, owner: OWNER, repo: REPO, token: 'fake-read-token' };
  return { source, requests };
}

describe('최신 버전 다운로드 (/download/<os>)', () => {
  it('초안과 사전 릴리스를 건너뛰고 가장 최근 공개 Release의 macOS DMG로 302 한다', async () => {
    const { source } = fakeGitHub([
      { tag: 'v0.4.0', draft: true },
      { tag: 'v0.3.0', prerelease: true },
      { tag: 'v0.2.0' },
      { tag: 'v0.1.0' },
    ]);

    const response = await latestDownloadResponse(source, 'mac');

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`https://github.com/${OWNER}/${REPO}/releases/download/v0.2.0/Stardraft-0.2.0-arm64.dmg`);
  });

  it('Windows 설치 파일로 302 하고, 공개 정보만 읽는 토큰으로 GitHub를 부르며 CDN에 담아 두지 않는다', async () => {
    const { source, requests } = fakeGitHub([{ tag: 'v0.2.0' }]);

    const response = await latestDownloadResponse(source, 'windows');

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`https://github.com/${OWNER}/${REPO}/releases/download/v0.2.0/Stardraft-Setup-0.2.0.exe`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(requests.map((request) => request.headers.get('Authorization'))).toEqual(['Bearer fake-read-token']);
  });

  it('모르는 OS는 GitHub를 부르지 않고 404', async () => {
    const { source, requests } = fakeGitHub([{ tag: 'v0.2.0' }]);

    const response = await latestDownloadResponse(source, 'linux');

    expect(response.status).toBe(404);
    expect(requests).toHaveLength(0);
  });

  it('공개 Release가 없거나 설치 파일이 빠졌으면 404', async () => {
    const onlyDraft = fakeGitHub([{ tag: 'v0.1.0', draft: true }, { tag: 'v0.0.9', prerelease: true }]);
    const noExe = fakeGitHub([{ tag: 'v0.2.0', assets: [{ name: 'Stardraft-0.2.0-arm64.dmg' }] }]);

    expect((await latestDownloadResponse(onlyDraft.source, 'mac')).status).toBe(404);
    expect((await latestDownloadResponse(noExe.source, 'windows')).status).toBe(404);
  });

  it('GitHub가 오류로 답하거나 연결되지 않으면 502이고 CDN에 담아 두지 않는다', async () => {
    const limited = fakeGitHub([{ tag: 'v0.2.0' }], { status: 403 });
    const offline: ReleaseSource = { ...limited.source, fetch: () => Promise.reject(new TypeError('fetch failed')) };

    for (const source of [limited.source, offline]) {
      const response = await latestDownloadResponse(source, 'mac');
      expect(response.status).toBe(502);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});

describe('버전별 다운로드 (/download/<버전>/<os>)', () => {
  it('그 버전의 공개 Release 파일로 302 한다', async () => {
    const { source } = fakeGitHub([{ tag: 'v0.2.0' }, { tag: 'v0.1.0' }]);

    const response = await versionDownloadResponse(source, '0.1.0', 'mac');

    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe(`https://github.com/${OWNER}/${REPO}/releases/download/v0.1.0/Stardraft-0.1.0-arm64.dmg`);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('초안과 사전 릴리스로 멈춘 버전, 없는 버전은 404', async () => {
    const { source } = fakeGitHub([{ tag: 'v0.3.0', draft: true }, { tag: 'v0.2.0', prerelease: true }, { tag: 'v0.1.0' }]);

    for (const version of ['0.3.0', '0.2.0', '0.0.1']) {
      expect((await versionDownloadResponse(source, version, 'windows')).status).toBe(404);
    }
  });

  it('버전 모양이 아니거나 모르는 OS는 GitHub를 부르지 않고 404', async () => {
    const { source, requests } = fakeGitHub([{ tag: 'v0.1.0' }]);

    expect((await versionDownloadResponse(source, 'latest', 'mac')).status).toBe(404);
    expect((await versionDownloadResponse(source, '0.1.0/../../x', 'mac')).status).toBe(404);
    expect((await versionDownloadResponse(source, '0.1.0', 'linux')).status).toBe(404);
    expect(requests).toHaveLength(0);
  });
});

describe('Release 정보 (/api/releases)', () => {
  it('공개 Release의 버전·날짜·사람이 받는 파일의 크기와 sha256·릴리스 노트를 새 것부터 최근 3개 내준다', async () => {
    const { source } = fakeGitHub([
      { tag: 'v0.5.0', draft: true },
      { tag: 'v0.4.0', prerelease: true },
      { tag: 'v0.3.0', publishedAt: '2026-12-02T01:00:00Z', body: '- 게시 확인을 고쳤습니다.' },
      { tag: 'v0.2.1', publishedAt: '2026-11-18T01:00:00Z' },
      { tag: 'v0.2.0', publishedAt: '2026-11-10T01:00:00Z' },
      { tag: 'v0.1.0', publishedAt: '2026-10-30T01:00:00Z' },
    ]);

    const response = await releasesApiResponse(source);
    const payload = (await response.json()) as ReleasesPayload;

    expect(response.status).toBe(200);
    expect(payload.releases.map((release) => release.version)).toEqual(['0.3.0', '0.2.1', '0.2.0']);
    expect(payload.releases[0]).toEqual({
      version: '0.3.0',
      date: '2026-12-02T01:00:00Z',
      notes: '- 게시 확인을 고쳤습니다.',
      url: `https://github.com/${OWNER}/${REPO}/releases/tag/v0.3.0`,
      files: [
        { os: 'mac', name: 'Stardraft-0.3.0-arm64.dmg', size: 121_000_000, sha256: 'a'.repeat(64) },
        { os: 'windows', name: 'Stardraft-Setup-0.3.0.exe', size: 98_000_000, sha256: 'c'.repeat(64) },
      ],
    });
    expect(payload.releases[1]?.notes).toBe('');
  });

  it('CDN에 5분 담아 두는 머리글을 단다', async () => {
    const { source } = fakeGitHub([{ tag: 'v0.1.0' }]);

    const response = await releasesApiResponse(source);

    expect(response.headers.get('Cache-Control')).toBe('public, max-age=0, s-maxage=300');
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('GitHub가 sha256을 주지 않은 파일은 null, 올라가지 않은 OS 파일은 빠진다', async () => {
    const { source } = fakeGitHub([{ tag: 'v0.1.0', assets: [{ name: 'Stardraft-0.1.0-arm64.dmg', size: 10, digest: null }, { name: 'latest-mac.yml' }] }]);

    const payload = (await (await releasesApiResponse(source)).json()) as ReleasesPayload;

    expect(payload.releases[0]?.files).toEqual([{ os: 'mac', name: 'Stardraft-0.1.0-arm64.dmg', size: 10, sha256: null }]);
  });

  it('공개 Release가 없으면 빈 목록', async () => {
    const { source } = fakeGitHub([{ tag: 'v0.1.0', draft: true }]);

    const payload = (await (await releasesApiResponse(source)).json()) as ReleasesPayload;

    expect(payload).toEqual({ releases: [] });
  });

  it('GitHub가 오류로 답하면 502이고 CDN에 담아 두지 않는다', async () => {
    const { source } = fakeGitHub([{ tag: 'v0.1.0' }], { status: 500 });

    const response = await releasesApiResponse(source);

    expect(response.status).toBe(502);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
});
