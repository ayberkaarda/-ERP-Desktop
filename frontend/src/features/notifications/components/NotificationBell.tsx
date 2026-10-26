import { Bell, CheckCheck } from 'lucide-react'
import { Popover as PopoverPrimitive } from 'radix-ui'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { internalPath, type AppNotification } from '../api'
import { useNotifications } from '../useNotifications'

export function NotificationBell() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { feed, live, markRead, markAllRead } = useNotifications()
  const unread = feed.data?.unread ?? 0
  const badge = unread > 99 ? '99+' : String(unread)
  const fmt = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? 'tr', {
    dateStyle: 'short',
    timeStyle: 'short',
  })

  function openItem(n: AppNotification) {
    if (!n.readAt) markRead.mutate(n.id)
    const path = internalPath(n.url)
    if (path) {
      setOpen(false)
      void navigate(path)
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unread > 0
              ? t('notifications.labelUnread', { count: unread })
              : t('notifications.label')
          }
        >
          <Bell className="text-muted-foreground" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[0.625rem] leading-none font-semibold text-danger-foreground tabular-nums"
            >
              {badge}
            </span>
          )}
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          aria-label={t('notifications.title')}
          className="z-50 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-md border border-border bg-surface-raised text-foreground shadow-md data-[state=open]:animate-pop-in"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <h2 className="text-sm font-semibold">{t('notifications.title')}</h2>
            <Button
              variant="ghost"
              size="sm"
              disabled={unread === 0 || markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck />
              {t('notifications.markAll')}
            </Button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {feed.isPending ? (
              <div className="space-y-2 p-3" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : feed.isError ? (
              <div role="alert" className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="text-danger">{t('notifications.error')}</span>
                <Button variant="secondary" size="sm" onClick={() => void feed.refetch()}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : feed.data.items.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {t('notifications.empty')}
              </p>
            ) : (
              <ul aria-label={t('notifications.title')} className="divide-y divide-border">
                {feed.data.items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-surface-sunken focus-visible:bg-surface-sunken focus-visible:outline-none"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-1.5 size-2 shrink-0 rounded-full',
                          n.readAt ? 'bg-transparent' : 'bg-primary',
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn('block text-sm', n.readAt ? 'font-normal' : 'font-medium')}
                        >
                          {n.title || t('notifications.untitled')}
                          {!n.readAt && (
                            <span className="sr-only">{t('notifications.unread')}</span>
                          )}
                        </span>
                        {n.body && (
                          <span className="line-clamp-2 block text-xs text-muted-foreground">
                            {n.body}
                          </span>
                        )}
                        <span className="block text-2xs text-subtle-foreground">
                          {formatInstant(fmt, n.createdAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!live && (
            <p className="border-t border-border px-3 py-1.5 text-2xs text-muted-foreground">
              {t('notifications.offlineHint')}
            </p>
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

function formatInstant(fmt: Intl.DateTimeFormat, value: string): string {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : fmt.format(d)
}
