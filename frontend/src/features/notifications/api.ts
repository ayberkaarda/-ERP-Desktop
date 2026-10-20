import { platform } from '@/platform'

// Mirrors svc's /notifications endpoints (PHASE1 "HTTP API"); payload fields are read defensively.
export interface ApiNotification {
  id: string
  type?: string
  title?: string | null
  body?: string | null
  url?: string | null
  data?: { title?: string | null; body?: string | null; url?: string | null } | null
  read_at: string | null
  created_at: string
}

export interface NotificationListResponse {
  data: ApiNotification[]
  meta?: { unread_count?: number; total?: number }
}

export interface AppNotification {
  id: string
  title: string
  body: string | null
  url: string | null
  readAt: string | null
  createdAt: string
}

export interface NotificationFeed {
  items: AppNotification[]
  unread: number
}

const PAGE_SIZE = 20

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

export function normalizeNotification(n: ApiNotification): AppNotification {
  return {
    id: n.id,
    title: text(n.title) ?? text(n.data?.title) ?? text(n.type) ?? '',
    body: text(n.body) ?? text(n.data?.body),
    url: text(n.url) ?? text(n.data?.url),
    readAt: n.read_at,
    createdAt: n.created_at,
  }
}

export function toFeed(r: NotificationListResponse): NotificationFeed {
  const items = r.data.map(normalizeNotification)
  const unread =
    typeof r.meta?.unread_count === 'number'
      ? r.meta.unread_count
      : items.filter((n) => !n.readAt).length
  return { items, unread }
}

export const notificationsApi = {
  list: (signal?: AbortSignal) =>
    platform.http.get<NotificationListResponse>('/notifications', {
      params: { per_page: PAGE_SIZE, sort: '-created_at' },
      signal,
    }),
  markRead: (id: string) =>
    platform.http.patch<unknown>(`/notifications/${encodeURIComponent(id)}/read`),
  markAllRead: () => platform.http.post<unknown>('/notifications/read-all'),
}

export const notificationKeys = {
  feed: (userId: string) => ['notifications', userId] as const,
}

/** Only in-app paths are followed from a notification. */
export function internalPath(url: string | null): string | null {
  // "//host" and "/\host" are protocol-relative to browsers.
  if (!url || !/^\/(?![/\\])/.test(url)) return null
  return url
}
