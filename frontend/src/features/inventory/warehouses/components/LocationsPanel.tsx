import { zodResolver } from '@hookform/resolvers/zod'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CornerDownRight,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Form, FormErrorSummary } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { MSG } from '@/lib/forms'
import { cn } from '@/lib/utils'
import { platform } from '@/platform'
import { LoadError } from '../../stock/components/common'
import { CheckboxField, TextField } from '../../stock/components/form'
import { errorMessage, isUncertain } from '../../stock/lib/errors'
import { useInvT } from '../../stock/lib/i18n'
import { usePayloadKeys } from '../../stock/lib/idempotency'
import { useDeleteLocation, useLocations, useSaveLocation } from '../../stock/lib/queries'
import type { LocationInput, Warehouse, WarehouseLocation } from '../../stock/lib/types'
import { branchIds, buildLocationTree, visibleNodes, type LocationNode } from '../lib/locationTree'

const schema = z.object({
  code: z.string().trim().min(1, MSG.required).max(30, MSG.max),
  name: z.string().trim().min(1, MSG.required).max(120, MSG.max),
  is_active: z.boolean(),
})
type Values = z.infer<typeof schema>

type Editing = { mode: 'create'; code: string } | { mode: 'edit'; location: WarehouseLocation }

function LocationEditor({
  warehouseId,
  editing,
  onDone,
}: {
  warehouseId: string
  editing: Editing
  onDone: (saved: WarehouseLocation | null) => void
}) {
  const t = useInvT()
  const { t: tc } = useTranslation('common')
  const save = useSaveLocation(warehouseId)
  const keyFor = usePayloadKeys()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues:
      editing.mode === 'edit'
        ? {
            code: editing.location.code,
            name: editing.location.name,
            is_active: editing.location.is_active,
          }
        : { code: editing.code, name: '', is_active: true },
  })
  const title =
    editing.mode === 'edit'
      ? t('locations.editTitle', { code: editing.location.code })
      : t('locations.newTitle')

  const submit = async (values: Values) => {
    const input: LocationInput = {
      code: values.code.trim(),
      name: values.name.trim(),
      is_active: values.is_active,
    }
    try {
      const saved =
        editing.mode === 'edit'
          ? await save.mutateAsync({
              mode: 'update',
              id: editing.location.id,
              patch: input,
              version: editing.location.version,
            })
          : await save.mutateAsync({ mode: 'create', input, key: keyFor(input) })
      platform.notify.success(t('locations.saved', { code: saved.code }))
      onDone(saved)
    } catch {
      // Shown by the error summary.
    }
  }

  return (
    <Form
      form={form}
      onSubmit={submit}
      aria-label={title}
      className="grid gap-3 rounded-md border border-border bg-surface-sunken/50 p-3"
    >
      <p className="text-sm font-semibold">{title}</p>
      {save.error && isUncertain(save.error) ? (
        <p role="alert" className="text-sm text-warning-soft-foreground">
          {t('common.uncertain')}
        </p>
      ) : (
        <FormErrorSummary
          error={save.error}
          fieldLabels={{ code: t('locations.fields.code'), name: t('locations.fields.name') }}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <TextField<Values, 'code'>
          name="code"
          label={t('locations.fields.code')}
          required
          description={t('locations.codeHelp')}
          input={{ maxLength: 30, autoComplete: 'off', autoFocus: true, className: 'font-code' }}
        />
        <TextField<Values, 'name'>
          name="name"
          label={t('locations.fields.name')}
          required
          input={{ maxLength: 120 }}
        />
      </div>
      <CheckboxField<Values> name="is_active" label={t('locations.fields.isActive')} />
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={save.isPending}
          onClick={() => onDone(null)}
        >
          {tc('actions.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={save.isPending}>
          {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
          {tc('actions.save')}
        </Button>
      </div>
    </Form>
  )
}

interface LocationsPanelProps {
  warehouse: Warehouse
  canManage: boolean
}

/** Bins of one warehouse as a keyboard-navigable tree (hierarchy from bin codes). */
export function LocationsPanel({ warehouse, canManage }: LocationsPanelProps) {
  const t = useInvT()
  const locations = useLocations(warehouse.id)
  const remove = useDeleteLocation(warehouse.id)
  const tree = useMemo(() => buildLocationTree(locations.data ?? []), [locations.data])
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deleting, setDeleting] = useState<WarehouseLocation | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)

  const branches = useMemo(() => branchIds(tree), [tree])
  const expanded = useMemo(
    () => new Set(branches.filter((id) => !collapsed.has(id))),
    [branches, collapsed],
  )
  const rows = visibleNodes(tree, expanded)
  const active = rows.find((r) => r.location.id === activeId) ?? rows[0]

  const toggle = (id: string, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      const isOpen = !prev.has(id)
      if (open ?? !isOpen) next.delete(id)
      else next.add(id)
      return next
    })

  const focusRow = (id: string) => {
    setActiveId(id)
    requestAnimationFrame(() =>
      treeRef.current
        ?.querySelector<HTMLElement>(`[data-location-id="${CSS.escape(id)}"]`)
        ?.focus(),
    )
  }

  const parentOfNode = (node: LocationNode): LocationNode | undefined => {
    const index = rows.indexOf(node)
    for (let i = index - 1; i >= 0; i -= 1) {
      const candidate = rows[i]
      if (candidate && candidate.depth < node.depth) return candidate
    }
    return undefined
  }

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, node: LocationNode) => {
    if (e.target !== e.currentTarget) return
    const index = rows.indexOf(node)
    const id = node.location.id
    const hasChildren = node.children.length > 0
    const go = (i: number) => {
      const target = rows[Math.min(Math.max(i, 0), rows.length - 1)]
      if (target) focusRow(target.location.id)
    }
    const handlers: Record<string, () => void> = {
      ArrowDown: () => go(index + 1),
      ArrowUp: () => go(index - 1),
      Home: () => go(0),
      End: () => go(rows.length - 1),
      ArrowRight: () => {
        if (hasChildren && !expanded.has(id)) toggle(id, true)
        else if (hasChildren) go(index + 1)
      },
      ArrowLeft: () => {
        if (hasChildren && expanded.has(id)) toggle(id, false)
        else {
          const parent = parentOfNode(node)
          if (parent) focusRow(parent.location.id)
        }
      },
    }
    if (canManage) handlers.Enter = () => setEditing({ mode: 'edit', location: node.location })
    const handler = handlers[e.key]
    if (handler) {
      e.preventDefault()
      handler()
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try {
      await remove.mutateAsync(deleting.id)
      platform.notify.success(t('locations.deleted', { code: deleting.code }))
      setDeleting(null)
    } catch (error) {
      platform.notify.error(errorMessage(error, t('locations.deleteFailed')))
      throw error
    }
  }

  const total = locations.data?.length ?? 0

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-muted-foreground">
          {t('locations.count', { count: total })}
        </p>
        {branches.length > 0 && (
          <>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set())}>
              <ChevronsUpDown aria-hidden="true" />
              {t('locations.expandAll')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCollapsed(new Set(branches))}>
              <ChevronsDownUp aria-hidden="true" />
              {t('locations.collapseAll')}
            </Button>
          </>
        )}
        {canManage && (
          <Button size="sm" onClick={() => setEditing({ mode: 'create', code: '' })}>
            <Plus aria-hidden="true" />
            {t('locations.add')}
          </Button>
        )}
      </div>

      {editing && (
        <LocationEditor
          key={editing.mode === 'edit' ? editing.location.id : `new:${editing.code}`}
          warehouseId={warehouse.id}
          editing={editing}
          onDone={(saved) => {
            setEditing(null)
            if (saved) setActiveId(saved.id)
          }}
        />
      )}

      {locations.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : locations.isError ? (
        <LoadError error={locations.error} onRetry={() => void locations.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          compact
          icon={<MapPin className="size-8 text-muted-foreground" aria-hidden="true" />}
          title={t('locations.emptyTitle')}
          description={t('locations.emptyBody')}
        />
      ) : (
        <ul
          ref={treeRef}
          role="tree"
          aria-label={t('locations.treeLabel', { code: warehouse.code })}
          className="max-h-[50vh] overflow-y-auto rounded-md border border-border bg-surface py-1"
        >
          {rows.map((node) => {
            const l = node.location
            const hasChildren = node.children.length > 0
            const isOpen = expanded.has(l.id)
            const siblings = parentOfNode(node)?.children ?? tree
            return (
              <li
                key={l.id}
                role="treeitem"
                aria-label={`${l.code} ${l.name}${l.is_active ? '' : ` (${t('common.inactive')})`}`}
                data-location-id={l.id}
                aria-level={node.depth + 1}
                aria-setsize={siblings.length}
                aria-posinset={siblings.indexOf(node) + 1}
                aria-expanded={hasChildren ? isOpen : undefined}
                aria-selected={active?.location.id === l.id}
                tabIndex={active?.location.id === l.id ? 0 : -1}
                onFocus={(e) => {
                  if (e.target === e.currentTarget) setActiveId(l.id)
                }}
                onKeyDown={(e) => onKeyDown(e, node)}
                className={cn(
                  'group flex h-9 items-center gap-2 pr-2 text-sm outline-none',
                  'hover:bg-surface-sunken focus-visible:bg-primary-soft/40 focus-visible:shadow-[inset_2px_0_0_var(--color-ring)]',
                )}
                style={{ paddingLeft: `${0.5 + node.depth * 1.25}rem` }}
              >
                <span className="inline-flex size-5 items-center justify-center">
                  {hasChildren && (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label={
                        isOpen
                          ? t('locations.collapse', { code: l.code })
                          : t('locations.expand', { code: l.code })
                      }
                      className="rounded-sm text-muted-foreground hover:text-foreground"
                      onClick={() => toggle(l.id)}
                    >
                      {isOpen ? (
                        <ChevronDown className="size-4" aria-hidden="true" />
                      ) : (
                        <ChevronRight className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  )}
                </span>
                <span className="font-code font-medium">{l.code}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{l.name}</span>
                {!l.is_active && <Badge tone="neutral">{t('common.inactive')}</Badge>}
                {canManage && (
                  <span className="flex items-center gap-0.5 opacity-70 group-focus-within:opacity-100 group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('locations.addChild', { code: l.code })}
                      onClick={() => setEditing({ mode: 'create', code: `${l.code}-` })}
                    >
                      <CornerDownRight aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('locations.edit', { code: l.code })}
                      onClick={() => setEditing({ mode: 'edit', location: l })}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('locations.delete', { code: l.code })}
                      onClick={() => setDeleting(l)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {canManage && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">{t('locations.keyboardHint')}</p>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('locations.deleteTitle', { code: deleting?.code ?? '' })}
        description={t('locations.deleteBody')}
        confirmLabel={t('locations.deleteConfirm')}
        onConfirm={confirmDelete}
      />
    </div>
  )
}
