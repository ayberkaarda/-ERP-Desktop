import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

// Same network ban as frontend/eslint.config.js: the webview reaches the
// network only through Tauri commands (@tauri-apps/api stays allowed).
const NET_MSG = 'Use a Tauri command through @tauri-apps/api.'
const NET_MODULES = [
  'axios',
  'ky',
  'node-fetch',
  'cross-fetch',
  'socket.io-client',
  // Tauri plugins that would open a network path around the shell commands.
  '@tauri-apps/plugin-http',
  '@tauri-apps/plugin-websocket',
]
// Module names inside the esquery regex literal below.
const NET_PATTERN = NET_MODULES.map((m) => m.replace(/[/.]/g, '\\$&')).join('|')
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
      selector: `ImportExpression[source.value=/^(${NET_PATTERN})(\\/|$)/]`,
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
  globalIgnores(['dist', 'coverage', 'src-tauri', 'crates', 'target']),
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
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
    files: ['src/**/*.ts'],
    rules: networkBan,
  },
  {
    files: ['*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
])
