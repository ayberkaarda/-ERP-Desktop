import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useSyncExternalStore } from 'react'
import { platform, type RealtimeState } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import {
  normalizeNotification,
  notificationKeys,
  notificationsApi,
  toFeed,
  type ApiNotification,
  type NotificationFeed,
} from './api'

export const NOTIFICATION_EVENT = '.notification.created'
// Without a live socket the feed falls back to polling.
const POLL_MS = 60_000

const subscribe = (cb: () => void) => platform.realtime.subscribe(cb)
const snapshot = (): RealtimeState => platform.realtime.state()

export function useRealtimeState(): RealtimeState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

type BroadcastNotification = Partial<ApiNotification> & { id: string }

function isNotification(value: unknown): value is BroadcastNotification {
  return (
    typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string'
  )
}

export function useNotifications() {
  const userId = useAuthStore((s) => s.user?.id ?? null)
  const queryClient = useQueryClient()
  const realtime = useRealtimeState()
  const key = notificationKeys.feed(userId ?? 'anonymous')

  const feed = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) => toFeed(await notificationsApi.list(signal)),
    enabled: userId !== null,
    refetchInterval: realtime === 'connected' ? false : POLL_MS,
  })

  useEffect(() => {
    if (!userId) return
    return platform.realtime.listenPrivate(`user.${userId}`, NOTIFICATION_EVENT, (payload) => {
      const k = notificationKeys.feed(userId)
      if (isNotification(payload)) {
        const item = normalizeNotification({
          ...payload,
          read_at: payload.read_at ?? null,
          created_at: payload.created_at ?? new Date().toISOString(),
        })
        queryClient.setQueryData<NotificationFeed>(k, (old) =>
          old && !old.items.some((n) => n.id === item.id)
            ? { items: [item, ...old.items], unread: old.unread + 1 }
            : old,
        )
        if (item.title)
          platform.notify.info(item.title, item.body ? { description: item.body } : {})
      }
      void queryClient.invalidateQueries({ queryKey: k })
    })
  }, [userId, queryClient])

  const markRead = useMutation({
    mutationFn: notificationsApi.markRead,
    onMutate: (id) => {
      queryClient.setQueryData<NotificationFeed>(key, (old) => {
        if (!old) return old
        const target = old.items.find((n) => n.id === id)
        if (!target || target.readAt) return old
        const now = new Date().toISOString()
        return {
          items: old.items.map((n) => (n.id === id ? { ...n, readAt: now } : n)),
          unread: Math.max(0, old.unread - 1),
        }
      })
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  const markAllRead = useMutation({
    mutationFn: notificationsApi.markAllRead,
    onMutate: () => {
      const now = new Date().toISOString()
      queryClient.setQueryData<NotificationFeed>(key, (old) =>
        old ? { items: old.items.map((n) => ({ ...n, readAt: n.readAt ?? now })), unread: 0 } : old,
      )
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })

  return { feed, realtime, markRead, markAllRead }
}
