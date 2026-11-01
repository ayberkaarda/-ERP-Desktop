import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
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
  '@tauri-apps/plugin-upload',
  '@tauri-apps/plugin-shell',
]
// Module names inside the esquery regex literal below.
const NET_PATTERN = NET_MODULES.map((m) => m.replace(/[/.]/g, '\\$&')).join('|')
const NET_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']
// Any member access by these names, whatever the object: window.fetch,
// globalThis.fetch, aliases (const w = window; w.fetch), casts
// ((window as X).fetch) and nested hosts (window.navigator.sendBeacon).
// Lint is the second line; CSP connect-src is the real control.
const NET_MEMBERS = `/^(${[...NET_GLOBALS, 'sendBeacon'].join('|')})$/`

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
    {
      // import('ax' + 'ios') or a template literal hides the module name.
      selector: 'ImportExpression:not([source.type="Literal"])',
      message: 'Dynamic import needs a plain string literal.',
    },
    {
      selector: `MemberExpression[computed=false][property.name=${NET_MEMBERS}]`,
      message: NET_MSG,
    },
    {
      selector: `MemberExpression[computed=true][property.value=${NET_MEMBERS}]`,
      message: NET_MSG,
    },
  ],
  'no-restricted-globals': ['error', ...NET_GLOBALS.map((name) => ({ name, message: NET_MSG }))],
}

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'src-tauri', 'crates', 'target', 'src/bridge/generated']),
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
    files: ['src/**/*.{ts,tsx}'],
    rules: networkBan,
  },
  {
    files: ['*.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
])
