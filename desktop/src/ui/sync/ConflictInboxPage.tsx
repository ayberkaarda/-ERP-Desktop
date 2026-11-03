// /sync/conflicts: offline drafts the server did not take. The wire choice
// model (`conflictModel`) decides what a record shows: a version conflict
// compares the conflicting fields and can merge them field by field, a locked
// document can become a new draft, a duplicate can be linked to an existing
// record. A record the model refuses is listed with the reason, and offers a
// discard when the engine takes one, else a new sync.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import type { ConflictDto } from '../../bridge/generated/ConflictDto'
import type { ConflictResolveDto } from '../../bridge/generated/ConflictResolveDto'
import type { ResolutionDto } from '../../bridge/generated/ResolutionDto'
import { call, toCommandError } from '../../bridge/invoke'
import {
  invalidateChanged,
  mergedPayload,
  syncStoreFor,
  useDesktopText,
  type DesktopText,
  type FieldPick,
  type SyncBridge,
  type SyncStore,
} from '../../sync'
import { conflictModel, RESOLUTION_TABLE, type ConflictChoice, type ConflictModel } from '../../wire'
import { useSyncDeps } from './context'
import { differingFields, fieldName, recordLabel, resourceName, shortId } from './labels'
import { CONFLICTS_KEY, OUTBOX_KEY } from './paths'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
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

function show(text: DesktopText, field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  if (field === 'lines' && Array.isArray(value)) return text.td('sync.conflict.linesCount', { count: value.length })
  if (typeof value === 'boolean') return text.td(value ? 'sync.conflict.yes' : 'sync.conflict.no')
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value.join(', ')
  return typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)
}

/** "Sales quote · QUO-1 · Acme", from the server row first, then the draft. */
function cardTitle(text: DesktopText, conflict: ConflictDto): string {
  const unnumbered = text.td('sync.outbox.unnumbered')
  const label =
    recordLabel(conflict.resource, conflict.server_data, unnumbered) ??
    recordLabel(conflict.resource, conflict.local_payload, unnumbered) ??
    shortId(conflict.id)
  return text.td('sync.conflict.record', { resource: resourceName(text, conflict.resource), label })
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
  fields,
  shown,
  server,
  picks,
  onPick,
  canMerge,
}: {
  conflict: ConflictDto
  fields: readonly string[]
  shown: readonly string[]
  server: Record<string, unknown>
  picks: Record<string, FieldPick>
  onPick: (field: string, pick: FieldPick) => void
  canMerge: boolean
}) {
  const text = useDesktopText()
  if (fields.length === 0) return <p>{text.td('sync.conflict.noFields')}</p>
  if (shown.length === 0) return <p data-testid="conflict-no-differences">{text.td('sync.conflict.noDifferences')}</p>
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
        {shown.map((field) => (
          <tr key={field} data-testid={`conflict-field-${field}`}>
            <td className="font-medium">
              {field === 'lines' ? text.td('sync.conflict.linesChanged') : fieldName(text, field)}
            </td>
            <td>{show(text, field, conflict.local_payload[field])}</td>
            <td>{show(text, field, server[field])}</td>
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

function CardHeader({ conflict }: { conflict: ConflictDto }) {
  const text = useDesktopText()
  const locale = useIntlLocale()
  return (
    <header className="space-y-0.5">
      <h2 className="font-medium">{cardTitle(text, conflict)}</h2>
      {/* A version conflict's server message is written for an online form
          ("refresh and try again"): the inbox explains it in its own words. */}
      {conflict.code === 'VERSION_CONFLICT' ? (
        <p className="text-sm">{text.td('sync.conflict.explain.VERSION_CONFLICT')}</p>
      ) : (
        <>
          <p className="text-sm">
            {isOneOf(CODES, conflict.code) ? text.td(`sync.conflict.code.${conflict.code}`) : conflict.code}
          </p>
          {conflict.message ? <p className="text-sm text-muted-foreground">{conflict.message}</p> : null}
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {text.td('sync.conflict.detectedAt', { time: formatDateTime(conflict.detected_at, locale) })}
      </p>
    </header>
  )
}

// A discard deletes the outbox entry and the conflict, and for a create the
// local draft too, with nothing to undo it: it is confirmed first.
function DiscardButton({
  conflict,
  disabled,
  onDiscard,
}: {
  conflict: ConflictDto
  disabled: boolean
  onDiscard: () => Promise<void>
}) {
  const text = useDesktopText()
  const label = text.td('sync.conflict.choice.discard')
  const description = text.td('sync.conflict.discardDescription')
  return (
    <ConfirmDialog
      trigger={
        <Button size="sm" variant="ghost" data-testid="conflict-choice-discard" disabled={disabled}>
          {label}
        </Button>
      }
      title={text.td('sync.conflict.discardTitle')}
      description={
        conflict.local_op === 'create' ? `${description} ${text.td('sync.conflict.discardDraft')}` : description
      }
      confirmLabel={label}
      cancelLabel={text.td('sync.conflict.keepChange')}
      onConfirm={onDiscard}
    />
  )
}

function ChoiceButtons({
  conflict,
  choices,
  disabled,
  onChoose,
}: {
  conflict: ConflictDto
  choices: readonly ConflictChoice[]
  disabled: (choice: ConflictChoice) => boolean
  onChoose: (choice: ConflictChoice) => Promise<void>
}) {
  const text = useDesktopText()
  return (
    <div className="flex flex-wrap gap-2">
      {choices.map((choice) =>
        choice === 'discard' ? (
          <DiscardButton
            key={choice}
            conflict={conflict}
            disabled={disabled(choice)}
            onDiscard={() => onChoose(choice)}
          />
        ) : (
          <Button
            key={choice}
            size="sm"
            variant="secondary"
            data-testid={`conflict-choice-${choice}`}
            disabled={disabled(choice)}
            onClick={() => {
              void onChoose(choice)
            }}
          >
            {text.td(`sync.conflict.choice.${choice}`)}
          </Button>
        ),
      )}
    </div>
  )
}

function ModelBody({
  conflict,
  model,
  resolver,
  http,
}: {
  conflict: ConflictDto
  model: ConflictModel
  resolver: Resolver
  http: HttpClient
}) {
  const text = useDesktopText()
  const canMerge = model.choices.includes('merge')
  const [picks, setPicks] = useState<Record<string, FieldPick>>({})
  const candidates = model.code === 'DUPLICATE_RECORD' ? model.candidates : []
  const [candidate, setCandidate] = useState<string | undefined>(candidates[0])
  const [busy, setBusy] = useState(false)
  // Only what the draft changed and the server has otherwise is asked about:
  // equal values, server-computed fields and fields the draft never sent are
  // no choice. A conflicting field the user does not see keeps the server's
  // value, so a merge never sends a draft value nobody looked at.
  const fields = model.code === 'VERSION_CONFLICT' ? model.fields : []
  const server = model.code === 'VERSION_CONFLICT' ? model.server : {}
  const shown = differingFields(fields, conflict.local_payload, server)
  const hidden = Object.fromEntries(
    fields.filter((field) => !shown.includes(field)).map((field): [string, FieldPick] => [field, 'server']),
  )
  const merged = mergedPayload(conflict, { ...hidden, ...picks })
  const mergeOff = shown.length === 0 || Object.keys(merged).length === 0

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

  return (
    <>
      {model.code === 'VERSION_CONFLICT' ? (
        <FieldCompare
          conflict={conflict}
          fields={fields}
          shown={shown}
          server={server}
          picks={picks}
          canMerge={canMerge}
          onPick={(field, pick) => {
            setPicks((current) => ({ ...current, [field]: pick }))
          }}
        />
      ) : null}
      {canMerge && shown.length > 0 && Object.keys(merged).length === 0 ? (
        <p className="text-sm text-muted-foreground">{text.td('sync.conflict.mergeEmpty')}</p>
      ) : null}

      {model.choices.includes('use_existing') ? (
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

      <ChoiceButtons
        conflict={conflict}
        choices={model.choices}
        disabled={(choice) =>
          busy ||
          (choice === 'merge' && mergeOff) ||
          (choice === 'use_existing' && candidate === undefined)
        }
        onChoose={decide}
      />
    </>
  )
}

// The engine resolves a discard only when the record offers it and the code's
// table has it (keystone-sync `decide`).
function engineDiscards(conflict: ConflictDto): boolean {
  if (!conflict.choices.includes('discard')) return false
  const table: Readonly<Record<string, readonly string[]>> = RESOLUTION_TABLE
  return Object.hasOwn(table, conflict.code) && (table[conflict.code] ?? []).includes('discard')
}

// A record the choice model refuses (server and client disagree on the
// protocol, or the server row is missing): explained, never hidden.
function RefusedBody({
  conflict,
  detail,
  resolver,
  onResync,
}: {
  conflict: ConflictDto
  detail: string
  resolver: Resolver
  onResync: () => void
}) {
  const text = useDesktopText()
  const [busy, setBusy] = useState(false)
  const discard = engineDiscards(conflict)
  return (
    <>
      <p role="note" data-testid="conflict-refused" className="text-sm">
        {text.td('sync.conflict.refused', { detail })}{' '}
        {discard ? text.td('sync.conflict.refusedDiscard') : text.td('sync.conflict.refusedHint')}
      </p>
      {discard ? (
        <ChoiceButtons
          conflict={conflict}
          choices={['discard']}
          disabled={() => busy}
          onChoose={async (choice) => {
            setBusy(true)
            try {
              await resolver.resolve(conflict, { choice })
            } finally {
              setBusy(false)
            }
          }}
        />
      ) : (
        <Button size="sm" variant="secondary" onClick={onResync}>
          {text.td('sync.conflict.resync')}
        </Button>
      )}
    </>
  )
}

function ConflictCard({
  conflict,
  resolver,
  http,
  onResync,
}: {
  conflict: ConflictDto
  resolver: Resolver
  http: HttpClient
  onResync: () => void
}) {
  const text = useDesktopText()
  const result = conflictModel(conflict)
  return (
    <article
      className="space-y-3 rounded-md border border-border p-4"
      data-testid={`conflict-${conflict.idempotency_key}`}
      aria-label={cardTitle(text, conflict)}
    >
      <CardHeader conflict={conflict} />
      {result.ok ? (
        <ModelBody conflict={conflict} model={result.model} resolver={resolver} http={http} />
      ) : (
        <RefusedBody
          conflict={conflict}
          detail={`${result.reason}: ${result.detail}`}
          resolver={resolver}
          onResync={onResync}
        />
      )}
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

  const resync = () => {
    store.syncNow().catch((reason: unknown) => {
      notify.error(text.td('sync.badge.syncNowFailed', { error: text.error(toCommandError(reason).code) }))
    })
  }

  if (list.isError) {
    return <p role="alert">{text.td('sync.conflict.loadFailed', { error: text.error(toCommandError(list.error).code) })}</p>
  }
  if (!list.data) return null
  if (list.data.length === 0) return <EmptyState title={text.td('sync.conflict.empty')} />
  return (
    <div className="space-y-4">
      {list.data.map((conflict) => (
        <ConflictCard
          key={conflict.idempotency_key}
          conflict={conflict}
          resolver={resolver}
          http={http}
          onResync={resync}
        />
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
      {deps.bridge ? <Inbox bridge={deps.bridge} http={deps.http} notify={deps.notify} /> : null}
    </div>
  )
}
