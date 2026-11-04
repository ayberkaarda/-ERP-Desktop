// Device sign-in to the active profile (`auth_login`): password, then the
// second factor when the server asks for it, then the company when the user
// has several. The password is kept only while the code step is open.

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthFrame, FormAlert } from '@/features/auth/components/AuthFrame'
import { useCompanyStore } from '@/stores/company'

import type { LoginDto } from '../../bridge/generated/LoginDto'
import { call, toCommandError } from '../../bridge/invoke'
import { useTd } from '../../i18n'
import { errorText } from './errors'
import { KEPT, withPendingWork } from './pending'
import { DesktopOnlyNotice } from './DesktopOnly'
import { useAccount, useOptionalAccount } from './services'
import { useProfiles } from './useProfiles'

type Step = { kind: 'credentials' } | { kind: 'twoFactor' } | { kind: 'company'; login: LoginDto }

const TWO_FACTOR_REQUIRED = 'TWO_FACTOR_REQUIRED'
// The web forced password-change route (features/auth/session PASSWORD_CHANGE_PATH).
const PASSWORD_CHANGE_PATH = '/password/change'

/** Outside the desktop window: a notice instead of a page that cannot work. */
export function DesktopLoginPage() {
  return useOptionalAccount() ? <LoginSteps /> : <DesktopOnlyNotice />
}

function LoginSteps() {
  const td = useTd()
  const account = useAccount()
  const navigate = useNavigate()
  const location = useLocation()
  const profiles = useProfiles(account.invoke)
  const [step, setStep] = useState<Step>({ kind: 'credentials' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The password between the first call and the code: never rendered, and
  // dropped on success, on "back" and when the page goes away.
  const secret = useRef('')
  useEffect(
    () => () => {
      secret.current = ''
    },
    [],
  )

  const from = account.session.safeRedirect((location.state as { from?: unknown } | null)?.from)
  const active = profiles.data?.profiles.find((p) => p.id === profiles.data?.active_id)

  function signIn(withCode?: string): Promise<LoginDto> {
    return call<LoginDto>(account.invoke, 'auth_login', {
      email: email.trim(),
      password: secret.current,
      ...(withCode === undefined ? {} : { twoFactorCode: withCode }),
    })
  }

  async function finish(login: LoginDto) {
    const user = await account.session.load()
    if (!user) {
      setStep({ kind: 'credentials' })
      setError(td('account.login.sessionFailed'))
      return
    }
    const company = login.profile.company_id
    if (company) useCompanyStore.getState().setActiveCompany(company)
    const mustChange = user.mustChangePassword || login.user.must_change_password
    await navigate(mustChange ? PASSWORD_CHANGE_PATH : from, { replace: true })
  }

  async function signedIn(login: LoginDto) {
    secret.current = ''
    if (login.company_required) {
      setStep({ kind: 'company', login })
      return
    }
    await finish(login)
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (reason) {
      setError(errorText(td, reason))
    } finally {
      setBusy(false)
    }
  }

  function submitCredentials() {
    secret.current = password
    setPassword('')
    void run(async () => {
      try {
        await signedIn(await signIn())
      } catch (reason) {
        if (toCommandError(reason).code === TWO_FACTOR_REQUIRED) {
          setStep({ kind: 'twoFactor' })
          return
        }
        secret.current = ''
        throw reason
      }
    })
  }

  function submitCode() {
    const entered = code.trim()
    setCode('')
    void run(async () => {
      await signedIn(await signIn(entered))
    })
  }

  function back() {
    secret.current = ''
    setCode('')
    setError(null)
    setStep({ kind: 'credentials' })
  }

  function chooseCompany(id: string) {
    void run(async () => {
      const login = await withPendingWork(account, 'switchCompany', (force) =>
        call<LoginDto>(account.invoke, 'profile_select_company', { company: id, force }),
      )
      if (login !== KEPT) await finish(login)
    })
  }

  return (
    <AuthFrame>
      <div className="mb-6 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span data-testid="login-profile">
          {profiles.data === null
            ? null
            : active
              ? td('account.login.profile', { name: active.name })
              : td('account.login.noProfile')}
        </span>
        <Link to="/setup" className="text-primary underline-offset-4 hover:underline">
          {td('account.login.change')}
        </Link>
      </div>

      {step.kind === 'credentials' ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitCredentials()
          }}
        >
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.login.title')}</h1>
          <FormAlert message={error} />
          <div className="space-y-1.5">
            <Label htmlFor="login-email">{td('account.login.email')}</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              data-testid="login-email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="login-password">{td('account.login.password')}</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              data-testid="login-password"
            />
          </div>
          <Button type="submit" className="w-full" disabled={busy} data-testid="login-submit">
            {td('account.login.submit')}
          </Button>
        </form>
      ) : null}

      {step.kind === 'twoFactor' ? (
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submitCode()
          }}
        >
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.login.twoFactorTitle')}</h1>
          <p className="text-sm text-muted-foreground">{td('account.login.twoFactorBody')}</p>
          <FormAlert message={error} />
          <div className="space-y-1.5">
            <Label htmlFor="login-code">{td('account.login.code')}</Label>
            <Input
              id="login-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              data-testid="login-code"
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={back} disabled={busy}>
              {td('account.login.back')}
            </Button>
            <Button type="submit" className="flex-1" disabled={busy || code.trim() === ''} data-testid="login-verify">
              {td('account.login.verify')}
            </Button>
          </div>
        </form>
      ) : null}

      {step.kind === 'company' ? (
        <div className="space-y-4">
          <h1 className="text-2xl font-semibold tracking-[-0.015em]">{td('account.login.companyTitle')}</h1>
          <p className="text-sm text-muted-foreground">{td('account.login.companyBody')}</p>
          <FormAlert message={error} />
          <ul className="space-y-2">
            {step.login.companies.map((company) => (
              <li key={company.id}>
                <Button
                  variant="secondary"
                  className="w-full justify-start"
                  disabled={busy}
                  onClick={() => chooseCompany(company.id)}
                  data-testid={`login-company-${company.id}`}
                >
                  {company.name}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </AuthFrame>
  )
}
