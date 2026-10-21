import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import {
  Controller,
  useForm,
  type DefaultValues,
  type FieldValues,
  type Path,
  type Resolver,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import type { z } from 'zod'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Combobox, type ComboboxOption } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { applyServerErrors, readServerError } from '@/lib/forms/serverErrors'
import { translateMessage } from '@/lib/forms/translate'
import { createIdempotencyKey, platform } from '@/platform'
import { cn } from '@/lib/utils'
import type { SubresourceKind } from '../api/parties'
import { isVersionConflict } from '../hooks/useParties'
import { useSubresource, type DefaultRule, type SubRow } from '../hooks/useSubresource'

export interface EditorColumn<V> {
  name: keyof V & string
  label: string
  kind?: 'text' | 'email' | 'tel' | 'code' | 'options'
  options?: ComboboxOption[]
  required?: boolean
  /** Display-mode cell; defaults to the value or the option label. */
  display?: (value: unknown) => ReactNode
  /** Kept out of the table header on narrow screens. */
  className?: string
}

export interface SubresourceEditorProps<T extends SubRow, V extends FieldValues> {
  partyId: string
  kind: SubresourceKind
  title: string
  columns: EditorColumn<V>[]
  schema: z.ZodType<V>
  emptyValues: V
  toValues: (row: T) => V
  toInput: (values: V) => Record<string, unknown>
  /** The single-default flag (is_default / is_primary) and its scope. */
  rule: DefaultRule<T>
  flagLabel: string
  makeFlagLabel: string
  emptyText: string
  canEdit: boolean
}

type Editing = { mode: 'new' } | { mode: 'edit'; id: string } | null

export function SubresourceEditor<T extends SubRow, V extends FieldValues>(
  props: SubresourceEditorProps<T, V>,
) {
  const { partyId, kind, title, columns, rule, flagLabel, makeFlagLabel, emptyText, canEdit } =
    props
  const { t } = useTranslation('parties')
  const { t: tc } = useTranslation('common')
  const { query, create, update, remove, refresh } = useSubresource<T>(partyId, kind, rule)
  const [editing, setEditing] = useState<Editing>(null)
  const [pendingDelete, setPendingDelete] = useState<T | null>(null)
  const addRef = useRef<HTMLButtonElement>(null)
  const rows = query.data ?? []
  const flag = rule.flag

  const close = () => {
    setEditing(null)
    requestAnimationFrame(() => addRef.current?.focus())
  }

  const onConflict = () => {
    platform.notify.warning(t('sub.conflict'))
    void refresh()
    close()
  }

  const makeDefault = async (row: T) => {
    try {
      await update.mutateAsync({
        id: row.id,
        input: { ...props.toInput(props.toValues(row)), [flag]: true, version: row.version },
      })
    } catch (error) {
      if (isVersionConflict(error)) onConflict()
      else platform.notify.error(readServerError(error)?.message ?? t('sub.failed'))
    }
  }

  const headerCells = (
    <tr>
      {columns.map((c) => (
        <th
          key={c.name}
          scope="col"
          className={cn(
            'h-row border-b border-border px-3 text-left text-xs font-medium',
            c.className,
          )}
        >
          {c.label}
        </th>
      ))}
      <th scope="col" className="h-row border-b border-border px-3 text-left text-xs font-medium">
        {flagLabel}
      </th>
      {canEdit && (
        <th
          scope="col"
          className="h-row border-b border-border px-3 text-right text-xs font-medium"
        >
          <span className="sr-only">{t('sub.actions')}</span>
        </th>
      )}
    </tr>
  )

  let body: ReactNode
  if (query.isPending) {
    body = (
      <tr aria-hidden="true">
        <td colSpan={columns.length + 2} className="px-3 py-3">
          <Skeleton className="h-4 w-2/3" />
        </td>
      </tr>
    )
  } else if (query.isError) {
    body = (
      <tr>
        <td colSpan={columns.length + 2} className="px-3 py-6 text-center">
          <div role="alert" className="space-y-2">
            <p className="text-sm text-muted-foreground">{t('sub.loadFailed')}</p>
            <Button size="sm" variant="secondary" onClick={() => void query.refetch()}>
              {tc('actions.retry')}
            </Button>
          </div>
        </td>
      </tr>
    )
  } else {
    body = (
      <>
        {rows.length === 0 && editing?.mode !== 'new' && (
          <tr>
            <td
              colSpan={columns.length + 2}
              className="px-3 py-6 text-center text-sm text-muted-foreground"
            >
              {emptyText}
            </td>
          </tr>
        )}
        {rows.map((row, index) =>
          editing?.mode === 'edit' && editing.id === row.id ? (
            <RowEditor<T, V>
              key={row.id}
              {...props}
              label={t('sub.rowLabel', { index: index + 1 })}
              initial={props.toValues(row)}
              busy={update.isPending}
              onCancel={close}
              onSave={async (values) => {
                await update.mutateAsync({
                  id: row.id,
                  input: { ...props.toInput(values), version: row.version },
                })
                platform.notify.success(t('sub.saved'))
                close()
              }}
              onConflict={onConflict}
            />
          ) : (
            <tr key={row.id} className="hover:bg-surface-sunken" data-row-id={row.id}>
              {columns.map((c) => (
                <td key={c.name} className={cn('border-b border-border px-3 py-2', c.className)}>
                  {displayValue(c, (row as Record<string, unknown>)[c.name])}
                </td>
              ))}
              <td className="border-b border-border px-3 py-2">
                {(row as Record<string, unknown>)[flag] === true ? (
                  <Badge tone="success">{flagLabel}</Badge>
                ) : canEdit ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() => void makeDefault(row)}
                  >
                    <Star aria-hidden="true" />
                    {makeFlagLabel}
                  </Button>
                ) : null}
              </td>
              {canEdit && (
                <td className="border-b border-border px-3 py-2 text-right whitespace-nowrap">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t('sub.edit')}: ${t('sub.rowLabel', { index: index + 1 })}`}
                    disabled={editing !== null}
                    onClick={() => setEditing({ mode: 'edit', id: row.id })}
                  >
                    <Pencil aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`${t('sub.delete')}: ${t('sub.rowLabel', { index: index + 1 })}`}
                    disabled={editing !== null}
                    onClick={() => setPendingDelete(row)}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </td>
              )}
            </tr>
          ),
        )}
        {editing?.mode === 'new' && (
          <RowEditor<T, V>
            {...props}
            label={t('sub.newRow')}
            initial={{ ...props.emptyValues, [flag]: rows.length === 0 }}
            busy={create.isPending}
            onCancel={close}
            onSave={async (values, idemKey) => {
              await create.mutateAsync({ input: props.toInput(values), idemKey })
              platform.notify.success(t('sub.saved'))
              close()
            }}
            onConflict={onConflict}
          />
        )}
      </>
    )
  }

  return (
    <section aria-label={title} className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full border-separate border-spacing-0 text-table" aria-label={title}>
          <thead className="bg-surface-sunken text-muted-foreground">{headerCells}</thead>
          <tbody>{body}</tbody>
        </table>
      </div>
      {canEdit && (
        <div className="flex items-center gap-3">
          <Button
            ref={addRef}
            size="sm"
            variant="secondary"
            disabled={editing !== null || query.isPending}
            onClick={() => setEditing({ mode: 'new' })}
          >
            <Plus aria-hidden="true" />
            {t('sub.add')}
          </Button>
          {editing && <p className="text-xs text-muted-foreground">{t('sub.keyboardHint')}</p>}
        </div>
      )}
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('sub.deleteTitle')}
        description={t('sub.deleteBody')}
        confirmLabel={t('sub.delete')}
        onConfirm={async () => {
          if (!pendingDelete) return
          try {
            await remove.mutateAsync(pendingDelete.id)
            platform.notify.success(t('sub.deleted'))
            setPendingDelete(null)
          } catch (error) {
            platform.notify.error(readServerError(error)?.message ?? t('sub.failed'))
            throw error
          }
        }}
      />
    </section>
  )
}

function displayValue<V>(column: EditorColumn<V>, value: unknown): ReactNode {
  if (column.display) return column.display(value)
  if (value === null || value === undefined || value === '') return '—'
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  if (column.options) return column.options.find((o) => o.value === value)?.label ?? text
  return column.kind === 'code' ? <span className="font-code">{text}</span> : text
}

interface RowEditorProps<T extends SubRow, V extends FieldValues> extends SubresourceEditorProps<
  T,
  V
> {
  label: string
  initial: V
  busy: boolean
  onSave: (values: V, idemKey: string) => Promise<void>
  onCancel: () => void
  onConflict: () => void
}

function RowEditor<T extends SubRow, V extends FieldValues>({
  columns,
  schema,
  rule,
  flagLabel,
  label,
  initial,
  busy,
  onSave,
  onCancel,
  onConflict,
}: RowEditorProps<T, V>) {
  const { t, i18n } = useTranslation('parties')
  // One key per opened editor: a retried save of the same row replays instead of duplicating.
  const [idemKey] = useState(createIdempotencyKey)
  const form = useForm<V>({
    resolver: zodResolver(schema as never) as unknown as Resolver<V>,
    defaultValues: initial as DefaultValues<V>,
  })
  const flag = rule.flag as Path<V>

  const submit = form.handleSubmit(async (values) => {
    try {
      await onSave(values, idemKey)
    } catch (error) {
      if (isVersionConflict(error)) {
        onConflict()
        return
      }
      const server = readServerError(error)
      const known = columns.map((c) => c.name)
      const result = server
        ? applyServerErrors(server, form.setError, { knownFields: [...known, rule.flag] })
        : null
      if (!result || result.mapped.length === 0) {
        platform.notify.error(server?.message ?? t('sub.failed'))
      }
    }
  })

  const onKeyDown = (e: KeyboardEvent<HTMLTableRowElement>) => {
    if (e.defaultPrevented) return
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    } else if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault()
      void submit()
    }
  }

  return (
    <tr aria-label={label} onKeyDown={onKeyDown} className="bg-primary-soft/30 align-top">
      {columns.map((c, i) => (
        <td key={c.name} className={cn('border-b border-border px-2 py-2', c.className)}>
          <Controller
            control={form.control}
            name={c.name as Path<V>}
            render={({ field, fieldState }) => {
              const errorId = `${label}-${c.name}-error`.replace(/\s+/g, '-')
              const error = translateMessage(i18n, fieldState.error?.message)
              const common = {
                'aria-label': c.label,
                'aria-invalid': error ? true : undefined,
                'aria-describedby': error ? errorId : undefined,
                'aria-required': c.required ? true : undefined,
              }
              return (
                <div className="min-w-28 space-y-1">
                  {c.options ? (
                    <Combobox
                      {...common}
                      ref={field.ref}
                      autoFocus={i === 0}
                      value={
                        typeof field.value === 'string' && field.value !== '' ? field.value : null
                      }
                      onChange={(v) => field.onChange(v ?? '')}
                      onBlur={field.onBlur}
                      options={c.options}
                      className="h-control-sm"
                    />
                  ) : (
                    <Input
                      {...common}
                      ref={field.ref}
                      name={field.name}
                      autoFocus={i === 0}
                      type={c.kind === 'email' ? 'email' : c.kind === 'tel' ? 'tel' : 'text'}
                      value={typeof field.value === 'string' ? field.value : ''}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      className={cn('h-control-sm text-xs', c.kind === 'code' && 'font-code')}
                    />
                  )}
                  {error && (
                    <p id={errorId} className="text-2xs text-danger">
                      {error}
                    </p>
                  )}
                </div>
              )
            }}
          />
        </td>
      ))}
      <td className="border-b border-border px-3 py-2">
        <Controller
          control={form.control}
          name={flag}
          render={({ field }) => (
            <label className="inline-flex items-center gap-2 pt-1.5 text-xs">
              <Checkbox
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
              />
              {flagLabel}
            </label>
          )}
        />
      </td>
      <td className="border-b border-border px-3 py-2 text-right whitespace-nowrap">
        <Button size="sm" disabled={busy} onClick={() => void submit()}>
          {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
          {t('sub.save')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('sub.cancel')}
        </Button>
      </td>
    </tr>
  )
}
