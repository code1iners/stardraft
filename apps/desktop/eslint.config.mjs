import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/** core가 Electron과 앱의 다른 부분에 기대지 않게 막는 import 규칙. */
const coreRestrictedImports = {
  paths: [
    {
      name: 'electron',
      message: 'core는 Electron을 import하지 않는다. 필요한 기능은 포트로 주입한다.',
    },
  ],
  patterns: [
    {
      group: ['electron/*', '@electron/*'],
      message: 'core는 Electron을 import하지 않는다. 필요한 기능은 포트로 주입한다.',
    },
    {
      group: ['**/main', '**/main/**', '**/preload', '**/preload/**', '**/renderer', '**/renderer/**'],
      message: 'core는 main·preload·renderer를 import하지 않는다.',
    },
  ],
};

/**
 * 생성 대기열이 프로바이더와 무관하게 남도록 Flow 모듈을 막는 import 규칙. 대상마다 다른 일은 대상 어댑터가 맡는다.
 * core 규칙을 함께 담는다. 같은 규칙을 다시 걸면 앞의 설정을 덮어쓰기 때문이다.
 */
const generationRestrictedImports = {
  paths: [...coreRestrictedImports.paths, { name: '../ports/flow-api', message: '생성 대기열은 Flow 타입을 import하지 않는다. Flow 일은 Flow 어댑터가 맡는다.' }],
  patterns: [
    ...coreRestrictedImports.patterns,
    {
      group: ['**/drafts', '**/drafts/**', '**/bundles', '**/bundles/**', '**/flow', '**/flow/**', '**/detection/**', '**/posting/**', '**/manual-check/**', '**/account/**'],
      message: '생성 대기열은 Flow 타입을 import하지 않는다. Flow 일은 Flow 어댑터가 맡는다.',
    },
  ],
};

/** 렌더러가 preload의 IPC 말고 다른 길로 시스템에 닿지 않게 막는 import 규칙. */
const rendererRestrictedImports = {
  paths: [
    {
      name: 'electron',
      message: '렌더러는 preload가 노출한 window.stardraft로만 main과 통신한다.',
    },
  ],
  patterns: [
    {
      group: ['node:*', '**/main', '**/main/**', '**/core', '**/core/**'],
      message: '렌더러는 Node 모듈, main, core를 import하지 않는다.',
    },
  ],
};

/** IPC 계약(shared)이 main·preload·renderer 어디서 import해도 안전하게, 런타임 의존을 막는 import 규칙. */
const sharedRestrictedImports = {
  paths: [
    {
      name: 'electron',
      message: 'IPC 계약은 렌더러도 import하므로 Electron을 import하지 않는다.',
    },
  ],
  patterns: [
    {
      group: ['node:*', '**/main', '**/main/**', '**/preload', '**/preload/**', '**/renderer', '**/renderer/**', '**/core', '**/core/**'],
      message: 'IPC 계약은 Node 모듈과 앱의 다른 부분을 import하지 않는다.',
    },
  ],
};

export default defineConfig(
  { ignores: ['out/**', 'dist/**', 'release/**'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['**/*.{ts,mts,mjs}'],
    ignores: ['src/renderer/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // .mts는 빌드 스크립트도 Node로 직접 불러오는 core 모듈이다.
    files: ['src/core/**/*.{ts,mts}'],
    rules: { 'no-restricted-imports': ['error', coreRestrictedImports] },
  },
  {
    files: ['src/core/generation/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', generationRestrictedImports] },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', sharedRestrictedImports] },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': ['error', rendererRestrictedImports],
    },
  },
);
