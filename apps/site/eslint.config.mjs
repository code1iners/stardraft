import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** 브라우저에서 도는 코드(React 섬과 섬이 쓰는 lib)가 Node 모듈에 기대지 않게 막는 import 규칙. */
const browserRestrictedImports = {
  patterns: [
    {
      group: ['node:*', '**/release-endpoints', '**/release-source', 'astro:env/*'],
      message: '브라우저 코드는 Node 모듈과 서버 엔드포인트 코드를 import하지 않는다.',
    },
  ],
};

/** 브라우저에서 도는 파일. 테스트는 Node에서 돈다. */
const browserFiles = [
  'src/components/**/*.{ts,tsx}',
  'src/lib/releases.ts',
  'src/lib/visitor.ts',
  'src/lib/format.ts',
  'src/lib/example-scenes.ts',
  'src/lib/motion.ts',
  'src/lib/install-os.ts',
  'src/lib/screenshots.ts',
];

// .astro 파일은 `astro check`가 타입을 본다.
export default defineConfig(
  { ignores: ['dist/**', '.vercel/**', '.astro/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,mts,mjs}'],
    ignores: browserFiles,
    languageOptions: { globals: globals.node },
  },
  {
    files: browserFiles,
    ignores: ['**/*.test.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': ['error', browserRestrictedImports],
    },
  },
);
