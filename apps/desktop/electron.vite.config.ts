import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * 개발 서버에서만 CSP의 `style-src`에 `'unsafe-inline'`을 더한다.
 * Vite 개발 서버는 CSS를 `<style>` 요소로 넣기 때문이다. 빌드한 앱은 CSS를 파일로 내므로 index.html의 엄격한 CSP를 그대로 쓴다.
 */
function relaxCspForDevServer(): Plugin {
  return {
    name: 'stardraft:relax-csp-for-dev-server',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'");
    },
  };
}

export default defineConfig({
  main: {
    build: {
      // better-sqlite3는 .node 파일을 불러오므로 번들에 넣지 않고 node_modules에서 그대로 읽는다.
      externalizeDeps: { include: ['better-sqlite3'] },
    },
  },
  preload: {
    build: {
      // sandbox가 켜진 preload는 CommonJS 파일 하나여야 한다.
      rolldownOptions: { output: { format: 'cjs' } },
    },
  },
  renderer: {
    plugins: [react(), relaxCspForDevServer()],
  },
});
