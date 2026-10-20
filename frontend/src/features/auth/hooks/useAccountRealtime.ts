import { useEffect } from 'react'
import { platform } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { handleMembershipRevoked, handleSessionRevoked } from '../session'

export const SESSION_REVOKED_EVENT = '.session.revoked'
export const MEMBERSHIP_REVOKED_EVENT = '.membership.revoked'

function companyIdOf(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null || !('company_id' in payload)) return null
  return typeof payload.company_id === 'string' ? payload.company_id : null
}

/** Reacts to account-level events the server pushes on the user's private channel. */
export function useAccountRealtime() {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  useEffect(() => {
    if (!userId) return
    const channel = `user.${userId}`
    const stopSession = platform.realtime.listenPrivate(channel, SESSION_REVOKED_EVENT, () =>
      handleSessionRevoked(),
    )
    const stopMembership = platform.realtime.listenPrivate(
      channel,
      MEMBERSHIP_REVOKED_EVENT,
      (payload) => {
        const companyId = companyIdOf(payload)
        if (companyId) void handleMembershipRevoked(companyId)
      },
    )
    return () => {
      stopSession()
      stopMembership()
    }
  }, [userId])
}
