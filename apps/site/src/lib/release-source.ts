import { GITHUB_RELEASE_TOKEN, VERCEL_GIT_REPO_OWNER } from 'astro:env/server';
import type { ReleaseSource } from './release-endpoints';
import { RELEASE_REPO } from './releases';

/** 배포 환경의 GitHub 저장소와 토큰으로 만든 Release 출처. 서버 엔드포인트에서만 부른다. */
export function releaseSource(): ReleaseSource {
  return { fetch: globalThis.fetch, owner: VERCEL_GIT_REPO_OWNER, repo: RELEASE_REPO, token: GITHUB_RELEASE_TOKEN };
}
