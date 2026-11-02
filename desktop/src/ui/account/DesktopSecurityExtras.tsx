// Desktop part of the security page: device sign-ins of the user, the web
// page for password/2FA/browser sessions, and facts about the app.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import type { DeviceDto } from '../../bridge/generated/DeviceDto'
import type { ExternalTarget } from '../../bridge/generated/ExternalTarget'
import { call } from '../../bridge/invoke'
import { useTd } from '../../i18n'
import { errorText } from './errors'
import { ErrorLine } from './GateFrame'
import { useOptionalAccount, type AccountContextValue } from './services'
import { useAppInfo } from './useProfiles'

const TARGET: ExternalTarget = 'security'

function formatDate(value: string, language: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(language)
}

/** Nothing outside the desktop window (no shell to ask). */
export function DesktopSecurityExtras() {
  const account = useOptionalAccount()
  return account ? <SecurityExtras account={account} /> : null
}

function SecurityExtras({ account }: { account: AccountContextValue }) {
  const td = useTd()
  const { i18n } = useTranslation()
  const { invoke } = account
  const info = useAppInfo(invoke)
  const [devices, setDevices] = useState<DeviceDto[] | null>(null)
  // The failure itself, translated while rendering: effects must not depend
  // on td, which is a new function on every render.
  const [failure, setFailure] = useState<{ reason: unknown } | null>(null)
  const [revoked, setRevoked] = useState(false)
  const [revoking, setRevoking] = useState<DeviceDto | null>(null)

  const load = useCallback(async () => {
    try {
      setDevices(await call<DeviceDto[]>(invoke, 'auth_devices_list'))
    } catch (reason) {
      setFailure({ reason })
    }
  }, [invoke])

  useEffect(() => {
    let live = true
    call<DeviceDto[]>(invoke, 'auth_devices_list').then(
      (list) => {
        if (live) setDevices(list)
      },
      (reason: unknown) => {
        if (live) setFailure({ reason })
      },
    )
    return () => {
      live = false
    }
  }, [invoke])

  async function revoke(device: DeviceDto) {
    setFailure(null)
    setRevoked(false)
    try {
      await call(invoke, 'auth_devices_revoke', { id: device.id })
      setRevoked(true)
      await load()
    } catch (reason) {
      setFailure({ reason })
    }
  }

  async function openWeb() {
    setFailure(null)
    try {
      await call(invoke, 'open_external', { target: TARGET })
    } catch (reason) {
      setFailure({ reason })
    }
  }

  return (
    <div className="space-y-4" data-testid="desktop-security-extras">
      <Card>
        <CardHeader className="flex-col gap-1">
          <CardTitle>{td('account.security.devicesTitle')}</CardTitle>
          <CardDescription>{td('account.security.devicesBody')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ErrorLine message={failure ? errorText(td, failure.reason) : null} />
          {revoked ? (
            <p role="status" className="text-sm text-muted-foreground">
              {td('account.security.revoked')}
            </p>
          ) : null}
          {devices?.length === 0 ? (
            <p className="text-sm text-muted-foreground">{td('account.security.empty')}</p>
          ) : null}
          <ul className="divide-y divide-border">
            {(devices ?? []).map((device) => (
              <li
                key={device.id}
                aria-label={device.name}
                className="flex items-center justify-between gap-3 py-2"
                data-testid={`device-${device.id}`}
              >
                <div className="min-w-0 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    {device.name}
                    {device.is_current ? <Badge tone="primary">{td('account.security.thisDevice')}</Badge> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {device.last_used_at
                      ? td('account.security.lastUsed', { date: formatDate(device.last_used_at, i18n.language) })
                      : td('account.security.never')}
                    {device.ip_address ? ` · ${device.ip_address}` : ''}
                  </p>
                  {device.is_current ? (
                    <p className="text-xs text-muted-foreground">{td('account.security.signOutFirst')}</p>
                  ) : null}
                </div>
                {/* Revoking this device's own sign-in would skip the sign-out's pending-work check. */}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={device.is_current}
                  onClick={() => {
                    if (!device.is_current) setRevoking(device)
                  }}
                >
                  {td('account.security.revoke')}
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-col gap-1">
          <CardTitle>{td('account.security.webTitle')}</CardTitle>
          <CardDescription>{td('account.security.webBody')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void openWeb()} data-testid="security-open-web">
            {td('account.security.openWeb')}
          </Button>
          <Button variant="ghost" asChild>
            <Link to="/setup">{td('account.security.profiles')}</Link>
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="desktop-about-title">
        <Card>
          <CardHeader>
            <CardTitle id="desktop-about-title">{td('account.security.aboutTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            {info ? (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{td('account.security.version')}</dt>
                <dd>{`${info.name} ${info.version}`}</dd>
                <dt className="text-muted-foreground">{td('account.security.schema')}</dt>
                <dd>{info.sync_schema_version}</dd>
                <dt className="text-muted-foreground">{td('account.security.os')}</dt>
                <dd>{info.os}</dd>
                <dt className="text-muted-foreground">{td('account.security.build')}</dt>
                <dd>{info.debug ? td('account.security.debug') : td('account.security.release')}</dd>
              </dl>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => {
          if (!open) setRevoking(null)
        }}
        title={td('account.security.revokeTitle')}
        description={revoking ? td('account.security.revokeBody', { name: revoking.name }) : undefined}
        confirmLabel={td('account.security.revoke')}
        onConfirm={() => {
          const target = revoking
          setRevoking(null)
          if (target) void revoke(target)
        }}
      />
    </div>
  )
}
