import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// .astro 파일은 `astro check`가 타입을 본다.
export default defineConfig(
  { ignores: ['dist/**', '.vercel/**', '.astro/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mts,mjs}'],
    ignores: ['src/components/**'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/lib/**/*.ts'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
);
