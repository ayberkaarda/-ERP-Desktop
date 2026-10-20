import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { loadSession } from '../session'

/** Probes /auth/me once while the session state is unknown; exposes a retry for failures. */
export function useSessionProbe() {
  const status = useAuthStore((s) => s.status)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (status !== 'unknown') return
    let live = true
    loadSession().catch(() => {
      if (live) setFailed(true)
    })
    return () => {
      live = false
    }
  }, [status, attempt])

  const retry = useCallback(() => {
    setFailed(false)
    setAttempt((n) => n + 1)
  }, [])

  return { status, failed, retry }
}
