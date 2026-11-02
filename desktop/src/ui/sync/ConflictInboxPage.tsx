// /sync/conflicts: offline drafts the server did not take. Each record shows
// only the choices its own `choices` list offers (narrowed by the protocol
// table): a version conflict compares the conflicting fields and can merge
// them field by field, a locked document can become a new draft, a duplicate
// can be linked to an existing record.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import type { ConflictDto } from '../../bridge/generated/ConflictDto'
import type { ConflictResolveDto } from '../../bridge/generated/ConflictResolveDto'
import type { ResolutionDto } from '../../bridge/generated/ResolutionDto'
import { call, toCommandError } from '../../bridge/invoke'
import {
  conflictChoices,
  invalidateChanged,
  mergedPayload,
  serverValue,
  syncStoreFor,
  useDesktopText,
  type ConflictChoice,
  type FieldPick,
  type SyncBridge,
  type SyncStore,
} from '../../sync'
import { useSyncDeps } from './context'
import { CONFLICTS_KEY, OUTBOX_KEY } from './paths'
import { EmptyState } from '@/components/shared/EmptyState'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { formatDateTime, useIntlLocale } from '@/lib/datetime'
import type { HttpClient, Notify } from '@/platform/types'
import { useCompanyStore } from '@/stores/company'

const CODES = ['VERSION_CONFLICT', 'DOCUMENT_LOCKED', 'DUPLICATE_RECORD'] as const
const ACTIONS = ['queued', 'take_server', 'use_existing', 'discard'] as const

function isOneOf<T extends string>(list: readonly T[], value: string): value is T {
  return (list as readonly string[]).includes(value)
}

function show(value: unknown): string {
  if (value === undefined || value === null) return '—'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

interface Resolver {
  resolve(conflict: ConflictDto, decision: Omit<ConflictResolveDto, 'idempotency_key'>): Promise<void>
}

function useResolver(bridge: SyncBridge, store: SyncStore, notify: Notify): Resolver {
  const client = useQueryClient()
  const text = useDesktopText()
  return {
    resolve: async (conflict, decision) => {
      let result: ResolutionDto
      try {
        result = await call<ResolutionDto>(bridge.invoke, 'conflicts_resolve', {
          decision: { idempotency_key: conflict.idempotency_key, ...decision },
        })
      } catch (reason) {
        notify.error(text.td('sync.conflict.failed', { error: text.error(toCommandError(reason).code) }))
        return
      }
      if (isOneOf(ACTIONS, result.action)) notify.success(text.td(`sync.conflict.resolved.${result.action}`))
      await Promise.all([
        invalidateChanged(
          client,
          { resources: [conflict.resource], all: false },
          useCompanyStore.getState().activeCompanyId,
        ),
        client.invalidateQueries({ queryKey: CONFLICTS_KEY }),
        client.invalidateQueries({ queryKey: OUTBOX_KEY }),
        store.refreshStatus(),
      ])
    },
  }
}

function FieldCompare({
  conflict,
  picks,
  onPick,
  canMerge,
}: {
  conflict: ConflictDto
  picks: Record<string, FieldPick>
  onPick: (field: string, pick: FieldPick) => void
  canMerge: boolean
}) {
  const text = useDesktopText()
  if (conflict.server_data === null) return <p>{text.td('sync.conflict.deletedOnServer')}</p>
  if (conflict.conflicting_fields.length === 0) return <p>{text.td('sync.conflict.noFields')}</p>
  return (
    <table className="w-full text-sm" data-testid="conflict-fields">
      <thead className="text-left text-muted-foreground">
        <tr>
          <th>{text.td('sync.conflict.field')}</th>
          <th>{text.td('sync.conflict.mine')}</th>
          <th>{text.td('sync.conflict.server')}</th>
          {canMerge ? <th /> : null}
        </tr>
      </thead>
      <tbody>
        {conflict.conflicting_fields.map((field) => (
          <tr key={field} data-testid={`conflict-field-${field}`}>
            <td className="font-mono text-xs">{field}</td>
            <td>{show(conflict.local_payload[field])}</td>
            <td>{show(serverValue(conflict, field))}</td>
            {canMerge ? (
              <td className="space-x-2 whitespace-nowrap">
                {(['mine', 'server'] as const).map((pick) => (
                  <label key={pick} className="inline-flex items-center gap-1">
                    <input
                      type="radio"
                      name={`${conflict.idempotency_key}-${field}`}
                      checked={(picks[field] ?? 'mine') === pick}
                      onChange={() => {
                        onPick(field, pick)
                      }}
                    />
                    {text.td(pick === 'mine' ? 'sync.conflict.useMine' : 'sync.conflict.useServer')}
                  </label>
                ))}
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function CandidateName({ http, resource, id }: { http: HttpClient; resource: string; id: string }) {
  const text = useDesktopText()
  const found = useQuery({
    queryKey: ['desktop-sync', 'candidate', resource, id],
    queryFn: ({ signal }) => http.get<{ data?: { name?: unknown; number?: unknown } }>(`/${resource}/${id}`, { signal }),
    retry: false,
  })
  const row = found.data?.data
  if (found.isPending) return <span className="text-muted-foreground">{text.td('sync.conflict.candidateLoading')}</span>
  const name = row?.name ?? row?.number
  return <span>{typeof name === 'string' ? name : id}</span>
}

function ConflictCard({
  conflict,
  resolver,
  http,
}: {
  conflict: ConflictDto
  resolver: Resolver
  http: HttpClient
}) {
  const text = useDesktopText()
  const locale = useIntlLocale()
  const choices = conflictChoices(conflict)
  const canMerge = choices.includes('merge')
  const [picks, setPicks] = useState<Record<string, FieldPick>>({})
  const candidates = conflict.candidates ?? []
  const [candidate, setCandidate] = useState<string | undefined>(candidates[0])
  const [busy, setBusy] = useState(false)
  const merged = mergedPayload(conflict, picks)

  const decide = async (choice: ConflictChoice) => {
    setBusy(true)
    try {
      if (choice === 'merge') await resolver.resolve(conflict, { choice, merged })
      else if (choice === 'use_existing') await resolver.resolve(conflict, { choice, candidate })
      else await resolver.resolve(conflict, { choice })
    } finally {
      setBusy(false)
    }
  }

  const disabled = (choice: ConflictChoice) =>
    busy ||
    (choice === 'merge' && Object.keys(merged).length === 0) ||
    (choice === 'use_existing' && candidate === undefined)

  return (
    <article
      className="space-y-3 rounded-md border border-border p-4"
      data-testid={`conflict-${conflict.idempotency_key}`}
      aria-label={text.td('sync.conflict.record', { resource: conflict.resource, id: conflict.id })}
    >
      <header className="space-y-0.5">
        <h2 className="font-medium">{text.td('sync.conflict.record', { resource: conflict.resource, id: conflict.id })}</h2>
        <p className="text-sm">
          {isOneOf(CODES, conflict.code) ? text.td(`sync.conflict.code.${conflict.code}`) : conflict.code}
        </p>
        {conflict.message ? <p className="text-sm text-muted-foreground">{conflict.message}</p> : null}
        <p className="text-xs text-muted-foreground">
          {text.td('sync.conflict.detectedAt', { time: formatDateTime(conflict.detected_at, locale) })}
        </p>
      </header>

      {conflict.code === 'VERSION_CONFLICT' ? (
        <FieldCompare
          conflict={conflict}
          picks={picks}
          canMerge={canMerge}
          onPick={(field, pick) => {
            setPicks((current) => ({ ...current, [field]: pick }))
          }}
        />
      ) : null}
      {canMerge && Object.keys(merged).length === 0 ? (
        <p className="text-sm text-muted-foreground">{text.td('sync.conflict.mergeEmpty')}</p>
      ) : null}

      {choices.includes('use_existing') && candidates.length > 0 ? (
        <fieldset className="space-y-1" data-testid="conflict-candidates">
          <legend className="text-sm font-medium">{text.td('sync.conflict.candidates')}</legend>
          {candidates.map((id) => (
            <label key={id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name={`${conflict.idempotency_key}-candidate`}
                value={id}
                checked={candidate === id}
                onChange={() => {
                  setCandidate(id)
                }}
              />
              <CandidateName http={http} resource={conflict.resource} id={id} />
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {choices.map((choice) => (
          <Button
            key={choice}
            size="sm"
            variant={choice === 'discard' ? 'ghost' : 'secondary'}
            data-testid={`conflict-choice-${choice}`}
            disabled={disabled(choice)}
            onClick={() => void decide(choice)}
          >
            {text.td(`sync.conflict.choice.${choice}`)}
          </Button>
        ))}
      </div>
    </article>
  )
}

function Inbox({ bridge, http, notify }: { bridge: SyncBridge; http: HttpClient; notify: Notify }) {
  const text = useDesktopText()
  const client = useQueryClient()
  const store = useMemo(() => syncStoreFor(bridge), [bridge])
  const resolver = useResolver(bridge, store, notify)
  const list = useQuery({
    queryKey: CONFLICTS_KEY,
    queryFn: () => call<ConflictDto[]>(bridge.invoke, 'conflicts_list'),
    retry: false,
  })

  useEffect(
    () =>
      store.subscribe(() => {
        void client.invalidateQueries({ queryKey: CONFLICTS_KEY })
      }),
    [store, client],
  )

  if (list.isError) {
    return <p role="alert">{text.td('sync.conflict.loadFailed', { error: text.error(toCommandError(list.error).code) })}</p>
  }
  if (!list.data) return null
  if (list.data.length === 0) return <EmptyState title={text.td('sync.conflict.empty')} />
  return (
    <div className="space-y-4">
      {list.data.map((conflict) => (
        <ConflictCard key={conflict.idempotency_key} conflict={conflict} resolver={resolver} http={http} />
      ))}
    </div>
  )
}

export function ConflictInboxPage() {
  const deps = useSyncDeps()
  const text = useDesktopText()
  return (
    <div className="space-y-4 p-6" data-testid="sync-conflicts-page">
      <PageHeader title={text.td('sync.conflict.title')} description={text.td('sync.conflict.description')} />
      {deps?.bridge ? <Inbox bridge={deps.bridge} http={deps.http} notify={deps.notify} /> : null}
    </div>
  )
}
