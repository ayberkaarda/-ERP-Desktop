import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Features must reach the network only through src/platform (desktop adapter swaps it out).
const NET_MSG = 'Use platform.http from @/platform.'
const NET_MODULES = ['axios', 'ky', 'node-fetch', 'cross-fetch', 'socket.io-client']
const NET_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']
const NET_HOSTS = ['window', 'globalThis', 'self']

const networkBan = {
  'no-restricted-imports': [
    'error',
    {
      paths: NET_MODULES.map((name) => ({ name, message: NET_MSG })),
      patterns: [{ group: NET_MODULES.map((m) => `${m}/*`), message: NET_MSG }],
    },
  ],
  'no-restricted-syntax': [
    'error',
    {
      // Dynamic import('axios') is not covered by no-restricted-imports.
      selector: `ImportExpression[source.value=/^(${NET_MODULES.join('|')})(\\/|$)/]`,
      message: NET_MSG,
    },
  ],
  'no-restricted-globals': ['error', ...NET_GLOBALS.map((name) => ({ name, message: NET_MSG }))],
  'no-restricted-properties': [
    'error',
    ...NET_HOSTS.flatMap((object) =>
      NET_GLOBALS.map((property) => ({ object, property, message: NET_MSG })),
    ),
    { object: 'navigator', property: 'sendBeacon', message: NET_MSG },
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
