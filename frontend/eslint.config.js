import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Features must reach the network only through src/platform (desktop adapter swaps it out).
const networkBan = {
  'no-restricted-imports': [
    'error',
    {
      paths: [
        { name: 'axios', message: 'Use platform.http from @/platform.' },
        { name: 'ky', message: 'Use platform.http from @/platform.' },
        { name: 'node-fetch', message: 'Use platform.http from @/platform.' },
        { name: 'cross-fetch', message: 'Use platform.http from @/platform.' },
      ],
      patterns: [{ group: ['axios/*'], message: 'Use platform.http from @/platform.' }],
    },
  ],
  'no-restricted-globals': [
    'error',
    { name: 'fetch', message: 'Use platform.http from @/platform.' },
    { name: 'XMLHttpRequest', message: 'Use platform.http from @/platform.' },
  ],
  'no-restricted-properties': [
    'error',
    { object: 'window', property: 'fetch', message: 'Use platform.http from @/platform.' },
    { object: 'globalThis', property: 'fetch', message: 'Use platform.http from @/platform.' },
  ],
}

export default defineConfig([
  globalIgnores([
    'dist',
    'coverage',
    'playwright-report',
    'test-results',
    'src/lib/api/schema.d.ts',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: networkBan,
  },
  {
    files: ['src/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['*.config.{js,ts}', 'scripts/**/*.mjs', 'e2e/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
])
