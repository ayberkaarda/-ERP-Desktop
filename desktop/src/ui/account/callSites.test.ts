import { describe, expect, it } from 'vitest'

// Commands that lose unsent work or bypass the adaptor are not called from
// the account screens directly: sign-out goes through the platform session,
// a company choice through the pending-work dialog, API calls through the
// web platform.
const sources = import.meta.glob<string>(['./*.{ts,tsx}', '!./*.test.{ts,tsx}', '!./testing.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const NEVER = ['api_request', 'auth_sign_out']
const ONLY_WITH_DIALOG = ['profile_select_company', 'profile_remove']

/** Where the command name appears as a string literal (any quote). */
function literalsOf(text: string, command: string): number[] {
  return [...text.matchAll(new RegExp(`['"\`]${command}['"\`]`, 'g'))].map((m) => m.index)
}

/** Problems found in the given sources. */
export function callSiteProblems(files: Record<string, string>): string[] {
  const problems: string[] = []
  for (const [file, text] of Object.entries(files)) {
    for (const command of NEVER) {
      if (literalsOf(text, command).length > 0) problems.push(`${file} calls ${command}`)
    }
    for (const command of ONLY_WITH_DIALOG) {
      for (const at of literalsOf(text, command)) {
        const before = text.slice(Math.max(0, at - 240), at)
        if (!before.includes('withPendingWork(')) problems.push(`${file} calls ${command} without the dialog`)
      }
    }
  }
  return problems
}

describe('account command call sites', () => {
  it('hold for the account sources', () => {
    expect(Object.keys(sources)).toContain('./DesktopLoginPage.tsx')
    expect(callSiteProblems(sources)).toEqual([])
  })

  it('flag each kind of break', () => {
    expect(
      callSiteProblems({
        'a.tsx': "call(invoke, 'api_request', { req })",
        'b.tsx': "call(invoke, 'auth_sign_out', { force: true })",
        'c.tsx': "call(invoke, 'profile_select_company', { company, force: true })",
        'd.tsx': "withPendingWork(account, 'switchCompany', (force) => call(invoke, 'profile_select_company', { company, force }))",
        'e.tsx': 'call(invoke, "profile_remove", { id, force: true })',
        'f.tsx': 'call(invoke, `auth_sign_out`, { force: true })',
      }),
    ).toEqual([
      'a.tsx calls api_request',
      'b.tsx calls auth_sign_out',
      'c.tsx calls profile_select_company without the dialog',
      'e.tsx calls profile_remove without the dialog',
      'f.tsx calls auth_sign_out',
    ])
  })
})
