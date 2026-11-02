// /sync/outbox: local writes not yet on the server. Rejected and quarantined
// entries can be retried or (after confirmation) discarded; an entry in
// conflict is resolved in the Conflict Inbox.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router'

import type { OutboxEntryDto } from '../../bridge/generated/OutboxEntryDto'
import { call, toCommandError } from '../../bridge/invoke'
import { syncStoreFor, useDesktopText, type SyncBridge } from '../../sync'
import { useSyncDeps } from './context'
import { CONFLICTS_PATH, OUTBOX_KEY } from './paths'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDateTime, useIntlLocale } from '@/lib/datetime'
import type { Notify } from '@/platform/types'

const STATES = ['pending', 'in_flight', 'conflict', 'rejected', 'quarantined'] as const
const OPS = ['create', 'update', 'delete', 'action'] as const
const TONE = {
  pending: 'neutral',
  in_flight: 'info',
  conflict: 'warning',
  rejected: 'danger',
  quarantined: 'danger',
} as const

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

function Outbox({ bridge, notify }: { bridge: SyncBridge; notify: Notify }) {
  const text = useDesktopText()
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const client = useQueryClient()
  const store = useMemo(() => syncStoreFor(bridge), [bridge])
  const list = useQuery({
    queryKey: OUTBOX_KEY,
    queryFn: () => call<OutboxEntryDto[]>(bridge.invoke, 'outbox_list'),
    retry: false,
  })

  // Every engine status change may have moved entries.
  useEffect(
    () =>
      store.subscribe(() => {
        void client.invalidateQueries({ queryKey: OUTBOX_KEY })
      }),
    [store, client],
  )

  const run = async (command: 'outbox_retry' | 'outbox_discard', key: string) => {
    try {
      await call(bridge.invoke, command, { key })
    } catch (reason) {
      notify.error(text.td('sync.outbox.failed', { error: text.error(toCommandError(reason).code) }))
      throw reason
    }
    notify.success(text.td(command === 'outbox_retry' ? 'sync.outbox.retried' : 'sync.outbox.discarded'))
    await Promise.all([store.refreshStatus(), client.invalidateQueries({ queryKey: OUTBOX_KEY })])
  }

  if (list.isError) {
    return <p role="alert">{text.td('sync.outbox.loadFailed', { error: text.error(toCommandError(list.error).code) })}</p>
  }
  if (!list.data) return null
  if (list.data.length === 0) return <EmptyState title={text.td('sync.outbox.empty')} />

  return (
    <table className="w-full text-sm" data-testid="outbox-table">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th className="py-2">{text.td('sync.outbox.resource')}</th>
          <th>{text.td('sync.outbox.operation')}</th>
          <th>{text.td('sync.outbox.status')}</th>
          <th>{text.td('sync.outbox.attempts')}</th>
          <th>{text.td('sync.outbox.lastError')}</th>
          <th>{text.td('sync.outbox.occurredAt')}</th>
          <th>{text.td('sync.outbox.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {list.data.map((entry) => {
          const key = entry.idempotency_key
          const state = isOneOf(STATES, entry.state) ? entry.state : null
          const op = isOneOf(OPS, entry.op) ? text.td(`sync.outbox.op.${entry.op}`) : entry.op
          const fixable = entry.state === 'rejected' || entry.state === 'quarantined'
          return (
            <tr key={key} data-testid={`outbox-row-${key}`} className="border-t border-border">
              <td className="py-2">
                <span className="font-medium">{entry.resource}</span>{' '}
                <span className="font-mono text-xs text-muted-foreground">{entry.id}</span>
              </td>
              <td>{entry.action ? `${op} · ${entry.action}` : op}</td>
              <td>
                <Badge tone={state ? TONE[state] : 'neutral'}>
                  {state ? text.td(`sync.outbox.state.${state}`) : entry.state}
                </Badge>
              </td>
              <td>{entry.attempts}</td>
              <td>{entry.last_error ? text.error(entry.last_error) : ''}</td>
              <td>{formatDateTime(entry.occurred_at, locale)}</td>
              <td className="space-x-1 whitespace-nowrap">
                {fixable ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => void run('outbox_retry', key).catch(() => undefined)}>
                      {text.td('sync.outbox.retry')}
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button size="sm" variant="ghost">
                          {text.td('sync.outbox.discard')}
                        </Button>
                      }
                      title={text.td('sync.outbox.discardTitle')}
                      description={text.td('sync.outbox.discardDescription')}
                      confirmLabel={text.td('sync.outbox.discard')}
                      onConfirm={() => run('outbox_discard', key)}
                    />
                  </>
                ) : null}
                {entry.state === 'conflict' ? (
                  <Button size="sm" variant="link" onClick={() => void navigate(CONFLICTS_PATH)}>
                    {text.td('sync.outbox.openConflicts')}
                  </Button>
                ) : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export function OutboxPage() {
  const deps = useSyncDeps()
  const text = useDesktopText()
  return (
    <div className="space-y-4 p-6" data-testid="sync-outbox-page">
      <PageHeader title={text.td('sync.outbox.title')} description={text.td('sync.outbox.description')} />
      <p className="text-sm text-muted-foreground">{text.td('sync.outbox.numberNote')}</p>
      {deps.bridge ? <Outbox bridge={deps.bridge} notify={deps.notify} /> : null}
    </div>
  )
}
