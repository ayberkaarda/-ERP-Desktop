// Desktop part of the security page: device sign-ins of the user, the web
// page for password/2FA/browser sessions, and facts about the app.

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import type { DeviceDto } from '../../bridge/generated/DeviceDto'
import type { ExternalTarget } from '../../bridge/generated/ExternalTarget'
import { call } from '../../bridge/invoke'
import { useTd } from '../../i18n'
import { errorText } from './errors'
import { ErrorLine } from './GateFrame'
import { useAccount } from './services'
import { useAppInfo } from './useProfiles'

const TARGET: ExternalTarget = 'security'

function formatDate(value: string, language: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(language)
}

export function DesktopSecurityExtras() {
  const td = useTd()
  const { i18n } = useTranslation()
  const account = useAccount()
  const info = useAppInfo(account.invoke)
  const [devices, setDevices] = useState<DeviceDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<DeviceDto | null>(null)

  const load = useCallback(async () => {
    try {
      setDevices(await call<DeviceDto[]>(account.invoke, 'auth_devices_list'))
    } catch (reason) {
      setError(errorText(td, reason))
    }
  }, [account.invoke, td])

  useEffect(() => {
    let live = true
    call<DeviceDto[]>(account.invoke, 'auth_devices_list').then(
      (list) => {
        if (live) setDevices(list)
      },
      (reason: unknown) => {
        if (live) setError(errorText(td, reason))
      },
    )
    return () => {
      live = false
    }
  }, [account.invoke, td])

  async function revoke(device: DeviceDto) {
    setError(null)
    setNotice(null)
    try {
      await call(account.invoke, 'auth_devices_revoke', { id: device.id })
      setNotice(td('account.security.revoked'))
      await load()
    } catch (reason) {
      setError(errorText(td, reason))
    }
  }

  async function openWeb() {
    setError(null)
    try {
      await call(account.invoke, 'open_external', { target: TARGET })
    } catch (reason) {
      setError(errorText(td, reason))
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
          <ErrorLine message={error} />
          {notice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {notice}
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
                  <p className="font-medium">{device.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {device.last_used_at
                      ? td('account.security.lastUsed', { date: formatDate(device.last_used_at, i18n.language) })
                      : td('account.security.never')}
                    {device.ip_address ? ` · ${device.ip_address}` : ''}
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setRevoking(device)}>
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
