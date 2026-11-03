// HeaderExtras of the desktop app: the sync state badge (with the last error,
// the Retry-After countdown and "sync now"), pending / conflict / rejected
// badges, the manifest mismatch warning, the reactive online-only toast and
// the freshness strip under the header.

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'

import type { RealtimeStateDto } from '../../bridge/generated/RealtimeStateDto'
import { toCommandError } from '../../bridge/invoke'
import {
  createDesktopText,
  invalidateChanged,
  refusalMessage,
  syncStoreFor,
  useDesktopText,
  watchOfflineRefusals,
  type ChannelState,
  type DesktopText,
  type SyncBridge,
  type SyncStore,
} from '../../sync'
import { useSyncDeps } from './context'
import { FreshnessStrip } from './FreshnessStrip'
import { CONFLICTS_PATH, OUTBOX_PATH } from './paths'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { Notify } from '@/platform/types'
import { useCompanyStore } from '@/stores/company'

const STATES = ['idle', 'syncing', 'offline', 'auth_required', 'failed'] as const
type KnownState = (typeof STATES)[number]

const DOT: Record<KnownState | 'unknown', string> = {
  idle: 'bg-success',
  syncing: 'bg-info animate-pulse',
  offline: 'bg-muted-foreground',
  auth_required: 'bg-warning',
  failed: 'bg-danger',
  unknown: 'bg-muted-foreground',
}

function knownState(state: string): KnownState | 'unknown' {
  return (STATES as readonly string[]).includes(state) ? (state as KnownState) : 'unknown'
}

/** Whole seconds left of `retryAfter`, counted from `since`; ticks every second. */
function useRemaining(retryAfter: number | null | undefined, since: number): number {
  const [now, setNow] = useState(() => Date.now())
  const remaining =
    typeof retryAfter === 'number' && retryAfter > 0
      ? Math.max(0, Math.ceil(retryAfter - Math.max(0, now - since) / 1000))
      : 0
  const counting = remaining > 0
  // A new status starts its own count: until the first tick, `now` is older
  // than `since` and the elapsed time reads as zero.
  useEffect(() => {
    if (!counting) return
    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [counting, since])
  return remaining
}

/**
 * A connected socket is live only once the server accepted the user channel;
 * until then (or when it refused it) notifications come by polling.
 */
function realtimeText(text: DesktopText, realtime: RealtimeStateDto, channel: ChannelState | null): string {
  if (realtime === 'connected' && channel === 'denied') return text.td('sync.realtime.channelDenied')
  if (realtime === 'connected' && channel === 'waiting') return text.td('sync.realtime.channelWaiting')
  return text.td(`sync.realtime.${realtime}`)
}

function useSnapshot(store: SyncStore) {
  return useSyncExternalStore(store.subscribe, store.getState)
}

// `resources_changed` → invalidate the changed resources of the active company.
function useInvalidation(store: SyncStore) {
  const client = useQueryClient()
  useEffect(
    () =>
      store.onResourcesChanged((change) => {
        void invalidateChanged(client, change, useCompanyStore.getState().activeCompanyId)
      }),
    [store, client],
  )
}

function SyncBadges({ bridge, notify }: { bridge: SyncBridge; notify: Notify }) {
  const store = useMemo(() => syncStoreFor(bridge), [bridge])
  const snapshot = useSnapshot(store)
  useInvalidation(store)
  const text = useDesktopText()
  const navigate = useNavigate()
  const { status } = snapshot
  const remaining = useRemaining(status?.retry_after, snapshot.statusAt)
  const [busy, setBusy] = useState(false)
  if (!status) return null

  const state = knownState(status.state)
  const label = text.td(`sync.state.${state}`)
  const problems = status.rejected + status.quarantined

  const syncNow = async () => {
    setBusy(true)
    try {
      await store.syncNow()
    } catch (error) {
      notify.error(text.td('sync.badge.syncNowFailed', { error: text.error(toCommandError(error).code) }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            data-testid="sync-status"
            data-state-name={status.state}
            aria-label={text.td('sync.badge.status', { state: label })}
          >
            <span className={cn('size-1.5 rounded-full', DOT[state])} />
            <span>{label}</span>
            {remaining > 0 ? (
              <span data-testid="sync-retry" className="text-muted-foreground">
                {text.td('sync.badge.retryIn', { seconds: remaining })}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 space-y-2 p-3 text-sm" data-testid="sync-status-details">
          <p className="font-medium">{text.td('sync.badge.status', { state: label })}</p>
          {status.error_code ? (
            <p data-testid="sync-last-error">{text.td('sync.badge.lastError', { error: text.error(status.error_code) })}</p>
          ) : null}
          {snapshot.realtime ? (
            <p className="text-muted-foreground" data-testid="sync-realtime">
              {realtimeText(text, snapshot.realtime, snapshot.channel)}
            </p>
          ) : null}
          <Button size="sm" variant="secondary" disabled={busy} data-testid="sync-now" onClick={() => void syncNow()}>
            {text.td('sync.badge.syncNow')}
          </Button>
        </PopoverContent>
      </Popover>
      {status.pending > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          data-testid="sync-pending"
          title={text.td('sync.badge.pendingHint')}
          onClick={() => void navigate(OUTBOX_PATH)}
        >
          <Badge tone="info">{text.td('sync.badge.pending', { count: status.pending })}</Badge>
        </Button>
      ) : null}
      {status.conflicts > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          data-testid="sync-conflicts"
          title={text.td('sync.badge.conflictsHint')}
          onClick={() => void navigate(CONFLICTS_PATH)}
        >
          <Badge tone="warning">{text.td('sync.badge.conflicts', { count: status.conflicts })}</Badge>
        </Button>
      ) : null}
      {problems > 0 ? (
        <Button variant="ghost" size="sm" data-testid="sync-problems" onClick={() => void navigate(OUTBOX_PATH)}>
          <Badge tone="danger">
            {text.td('sync.badge.problems', { rejected: status.rejected, quarantined: status.quarantined })}
          </Badge>
        </Button>
      ) : null}
      {status.manifest_mismatch ? (
        <Badge tone="danger" role="alert" data-testid="sync-manifest-mismatch" className="h-auto whitespace-normal">
          {text.td('sync.badge.manifestMismatch')}
        </Badge>
      ) : null}
    </>
  )
}

// A refused server-only action gets a translated reason (the feature's own
// error toast carries the shell's English message).
function RefusalToasts({ notify }: { notify: Notify }) {
  const client = useQueryClient()
  const { i18n } = useTranslation()
  useEffect(
    () =>
      watchOfflineRefusals(client, (refusal) => {
        notify.warning(refusalMessage(createDesktopText(i18n), refusal))
      }),
    [client, i18n, notify],
  )
  return null
}

export function SyncHeader() {
  const deps = useSyncDeps()
  return (
    <>
      {deps.bridge ? <SyncBadges bridge={deps.bridge} notify={deps.notify} /> : null}
      <RefusalToasts notify={deps.notify} />
      {deps.offlineMeta ? <FreshnessStrip source={deps.offlineMeta} /> : null}
    </>
  )
}
