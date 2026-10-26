import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { ApiError, createIdempotencyKey } from '@/platform'
import type labels from '@/lib/i18n/locales/edocuments/tr.json'
export function useEdocT() {
  const { t } = useTranslation('edocuments')
  return (key: string, options?: Record<string, unknown>): string =>
    t(key as keyof typeof labels, options)
}
export function useEdocScope() {
  const user = useAuthStore((s) => s.user?.id)
  const company = useCompanyStore((s) => s.activeCompanyId)
  const fresh = useAuthStore((s) => s.permissionsState === 'fresh')
  const grants = useAuthStore((s) => (company ? (s.permissions[company] ?? []).join('|') : ''))
  const revoked = useCompanyStore((s) => s.accessRevoked)
  return {
    key: `${user ?? 'none'}:${company ?? 'none'}:${grants}`,
    enabled: !!user && !!company && fresh && !revoked,
  }
}
export function useOperation() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const active = useRef<AbortController | null>(null)
  const keys = useRef(new Map<string, string>())
  useEffect(() => () => active.current?.abort(), [])
  async function run<T>(
    identity: unknown,
    send: (key: string, signal: AbortSignal) => Promise<T>,
    done: (value: T) => void,
  ) {
    if (active.current) return
    const fingerprint = JSON.stringify(identity)
    const key = keys.current.get(fingerprint) ?? createIdempotencyKey()
    keys.current.set(fingerprint, key)
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError(null)
    try {
      const result = await send(key, controller.signal)
      if (!controller.signal.aborted) {
        keys.current.delete(fingerprint)
        done(result)
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (failure instanceof ApiError && failure.status > 0 && failure.status < 500)
          keys.current.delete(fingerprint)
        setError(failure)
      }
    } finally {
      if (active.current === controller) {
        active.current = null
        setBusy(false)
      }
    }
  }
  return { busy, error, run, clear: () => setError(null) }
}
