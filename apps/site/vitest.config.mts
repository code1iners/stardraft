/// <reference types="vitest/config" />
import { getViteConfig } from 'astro/config';

// 페이지가 빌드할 때 읽는 저장소 주인. 테스트에서는 가짜 값을 쓴다.
process.env.VERCEL_GIT_REPO_OWNER = 'example-owner';

// Astro의 Vite 설정 위에서 돌려 .astro 페이지도 container API로 그려 본다.
export default getViteConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
