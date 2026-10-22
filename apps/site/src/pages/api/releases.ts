import type { APIRoute } from 'astro';
import { releasesApiResponse } from '../../lib/release-endpoints';
import { releaseSource } from '../../lib/release-source';

export const prerender = false;

/** 최근 공개 Release의 요약. CDN에 5분 담아 둔다. */
export const GET: APIRoute = () => releasesApiResponse(releaseSource());
