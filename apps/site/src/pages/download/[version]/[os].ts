import type { APIRoute } from 'astro';
import { versionDownloadResponse } from '../../../lib/release-endpoints';
import { releaseSource } from '../../../lib/release-source';

export const prerender = false;

/** 정해진 버전의 공개 Release 설치 파일로 보낸다. */
export const GET: APIRoute = ({ params }) => versionDownloadResponse(releaseSource(), params.version, params.os);
