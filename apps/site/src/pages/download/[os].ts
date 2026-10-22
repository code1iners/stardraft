import type { APIRoute } from 'astro';
import { latestDownloadResponse } from '../../lib/release-endpoints';
import { releaseSource } from '../../lib/release-source';

export const prerender = false;

/** 가장 최근 공개 Release의 설치 파일로 보낸다. */
export const GET: APIRoute = ({ params }) => latestDownloadResponse(releaseSource(), params.os);
