// @ts-check
import react from '@astrojs/react';
import vercel from '@astrojs/vercel';
import { defineConfig, envField } from 'astro/config';

// 페이지는 정적으로 내고, `prerender = false`인 다운로드·Release 엔드포인트만 Vercel 함수로 돈다.
export default defineConfig({
  site: 'https://stardraft.squadify.app',
  adapter: vercel(),
  integrations: [react()],
  env: {
    schema: {
      /** Release를 올리는 GitHub 저장소의 주인. Vercel이 Git 연결 프로젝트에 넣어 주는 값이고, 로컬에서는 직접 지정한다. */
      VERCEL_GIT_REPO_OWNER: envField.string({ context: 'server', access: 'public' }),
      /** 공개 정보만 읽는 GitHub 토큰. Vercel 서버는 IP를 나눠 써서 인증 없이 부르면 남이 한도를 소진할 수 있다. */
      GITHUB_RELEASE_TOKEN: envField.string({ context: 'server', access: 'secret', optional: true }),
    },
  },
});
