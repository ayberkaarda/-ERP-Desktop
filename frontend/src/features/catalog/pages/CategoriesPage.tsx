import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FolderInput,
  GripVertical,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { platform } from '@/platform'
import { categoriesApi } from '../api/client'
import { catalogKeys } from '../api/keys'
import { TextField } from '../components/fields'
import { CategorySelect } from '../components/pickers'
import { RecordDialog } from '../components/RecordDialog'
import { CATALOG_ACCESS } from '../permissions'
import { useCategories, useIdempotencyKey, useInvalidate } from '../hooks/queries'
import { errorMessage, isVersionConflict } from '../lib/errors'
import {
  buildTree,
  descendantIds,
  flattenTree,
  reparentProblem,
  type CategoryNode,
  type ReparentProblem,
} from '../lib/tree'
import { categorySchema, type CategoryValues } from '../schemas'
import type { ItemCategory } from '../types'

type DialogState =
  | { kind: 'create'; parentId: string | null }
  | { kind: 'edit'; category: ItemCategory }
  | { kind: 'move'; category: ItemCategory }
  | null

export function CategoriesPage() {
  const { t } = useTranslation('catalog')
  const categories = useCategories()
  const invalidate = useInvalidate()
  const data = useMemo(() => categories.data ?? [], [categories.data])
  const tree = useMemo(() => buildTree(data), [data])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [focusId, setFocusId] = useState<string | null>(null)
  const canManage = usePermission(CATALOG_ACCESS.categories.manage)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [deleting, setDeleting] = useState<ItemCategory | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'ok'; text: string } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const treeRef = useRef<HTMLUListElement>(null)

  const visible = useMemo(() => flattenTree(tree, expanded), [tree, expanded])
  const byId = useMemo(() => new Map(data.map((c) => [c.id, c])), [data])
  const current =
    focusId && visible.some((n) => n.category.id === focusId)
      ? focusId
      : (visible[0]?.category.id ?? null)

  const problemText = (problem: ReparentProblem, moving: ItemCategory, parentId: string | null) => {
    const parent = parentId ? byId.get(parentId) : undefined
    if (problem === 'self') return t('categories.cycle.self', { name: moving.name })
    if (problem === 'descendant')
      return t('categories.cycle.descendant', { name: moving.name, parent: parent?.name ?? '' })
    return t('categories.cycle.same', { name: moving.name })
  }

  const move = useMutation({
    mutationFn: ({ category, parentId }: { category: ItemCategory; parentId: string | null }) =>
      categoriesApi.update(category.id, { parent_id: parentId, version: category.version }),
    onSuccess: async (updated) => {
      setMessage({ tone: 'ok', text: t('categories.moved', { name: updated.name }) })
      if (updated.parent_id) setExpanded((prev) => new Set(prev).add(updated.parent_id ?? ''))
      await invalidate(catalogKeys.categories())
    },
    onError: async (e) => {
      setMessage({
        tone: 'error',
        text: isVersionConflict(e) ? t('conflict.body') : errorMessage(e, t('errors.saveFailed')),
      })
      if (isVersionConflict(e)) await invalidate(catalogKeys.categories())
    },
  })

  /** Client-side cycle check first; the API checks again. */
  const requestMove = (category: ItemCategory, parentId: string | null) => {
    const problem = reparentProblem(category.id, parentId, data)
    if (problem) {
      setMessage({ tone: 'error', text: problemText(problem, category, parentId) })
      return false
    }
    move.mutate({ category, parentId })
    return true
  }

  const remove = useMutation({
    mutationFn: (c: ItemCategory) => categoriesApi.remove(c.id),
    onSuccess: async (_r, c) => {
      platform.notify.success(t('categories.deleted', { name: c.name }))
      await invalidate(catalogKeys.categories())
    },
    onError: (e) => platform.notify.error(errorMessage(e, t('errors.deleteFailed'))),
  })

  const toggle = (id: string, open?: boolean) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      const willOpen = open ?? !next.has(id)
      if (willOpen) next.add(id)
      else next.delete(id)
      return next
    })

  const focusRow = (id: string) => {
    setFocusId(id)
    requestAnimationFrame(() =>
      treeRef.current?.querySelector<HTMLElement>(`[data-node="${CSS.escape(id)}"]`)?.focus(),
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, node: CategoryNode) => {
    // Keys inside the row's buttons are theirs.
    if (e.target !== e.currentTarget) return
    const index = visible.findIndex((n) => n.category.id === node.category.id)
    const id = node.category.id
    const hasChildren = node.children.length > 0
    const go = (i: number) => {
      const target = visible[Math.max(0, Math.min(visible.length - 1, i))]
      if (target) focusRow(target.category.id)
    }
    switch (e.key) {
      case 'ArrowDown':
        go(index + 1)
        break
      case 'ArrowUp':
        go(index - 1)
        break
      case 'Home':
        go(0)
        break
      case 'End':
        go(visible.length - 1)
        break
      case 'ArrowRight':
        if (hasChildren && !expanded.has(id)) toggle(id, true)
        else if (hasChildren) go(index + 1)
        break
      case 'ArrowLeft':
        if (hasChildren && expanded.has(id)) toggle(id, false)
        else if (node.category.parent_id && byId.has(node.category.parent_id))
          focusRow(node.category.parent_id)
        break
      case 'Enter':
        if (!canManage) return
        setDialog({ kind: 'edit', category: node.category })
        break
      case 'Delete':
        if (!canManage) return
        setDeleting(node.category)
        break
      case 'Insert':
        if (!canManage) return
        setDialog({ kind: 'create', parentId: id })
        break
      case 'm':
      case 'M':
        if (e.ctrlKey || e.metaKey || e.altKey || !canManage) return
        setDialog({ kind: 'move', category: node.category })
        break
      default:
        return
    }
    e.preventDefault()
  }

  const onDragOver = (e: DragEvent, parentId: string | null) => {
    const moving = dragId ? byId.get(dragId) : undefined
    if (!moving) return
    const problem = reparentProblem(moving.id, parentId, data)
    // A blocked target shows "no drop"; the reason appears on drop.
    e.dataTransfer.dropEffect = problem && problem !== 'same' ? 'none' : 'move'
    e.preventDefault()
    setDropTarget(parentId ?? '__root')
  }

  const onDrop = (e: DragEvent, parentId: string | null) => {
    e.preventDefault()
    const moving = dragId ? byId.get(dragId) : undefined
    setDragId(null)
    setDropTarget(null)
    if (moving) requestMove(moving, parentId)
  }

  const allIds = useMemo(() => data.map((c) => c.id), [data])

  return (
    <div className="mx-auto max-w-4xl px-6 py-6">
      <PageHeader
        title={t('categories.title')}
        description={t('categories.description')}
        breadcrumbs={[{ label: t('nav.catalog') }, { label: t('categories.title') }]}
        actions={
          canManage ? (
            <Button onClick={() => setDialog({ kind: 'create', parentId: null })}>
              <Plus aria-hidden="true" />
              {t('categories.new')}
            </Button>
          ) : undefined
        }
      />
      <div aria-live="polite" className="min-h-0">
        {message && (
          <p
            role={message.tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'mb-3 rounded-md border p-2.5 text-sm',
              message.tone === 'error'
                ? 'border-danger/30 bg-danger-soft text-danger-soft-foreground'
                : 'border-success/30 bg-success-soft text-success-soft-foreground',
            )}
          >
            {message.text}
          </p>
        )}
      </div>
      {categories.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : categories.isError ? (
        <EmptyState
          title={t('errors.loadFailed')}
          action={
            <Button variant="secondary" onClick={() => void categories.refetch()}>
              {t('actions.retry')}
            </Button>
          }
        />
      ) : data.length === 0 ? (
        <EmptyState title={t('categories.empty')} />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
            <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set(allIds))}>
              <ChevronsUpDown aria-hidden="true" />
              {t('categories.expandAll')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(new Set())}>
              <ChevronsDownUp aria-hidden="true" />
              {t('categories.collapseAll')}
            </Button>
            <p id="cat-tree-hint" className="ml-auto text-xs text-muted-foreground">
              {canManage ? t('categories.keyboardHint') : t('categories.keyboardHintReadOnly')}
            </p>
          </div>
          <div
            className={cn(
              'border-b border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground',
              dragId ? 'block' : 'hidden',
              dropTarget === '__root' && 'bg-primary/10',
            )}
            onDragOver={(e) => onDragOver(e, null)}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e) => onDrop(e, null)}
          >
            {t('categories.dropRoot')}
          </div>
          <ul
            ref={treeRef}
            role="tree"
            aria-label={t('categories.title')}
            aria-describedby="cat-tree-hint"
            className="py-1"
          >
            {visible.map((node) => {
              const c = node.category
              const hasChildren = node.children.length > 0
              const open = expanded.has(c.id)
              return (
                <li
                  key={c.id}
                  role="treeitem"
                  data-node={c.id}
                  aria-level={node.depth + 1}
                  aria-posinset={node.pos}
                  aria-setsize={node.size}
                  aria-expanded={hasChildren ? open : undefined}
                  aria-selected={current === c.id}
                  aria-label={`${c.code} ${c.name}`}
                  tabIndex={current === c.id ? 0 : -1}
                  draggable={canManage}
                  onFocus={(e) => {
                    if (e.target === e.currentTarget) setFocusId(c.id)
                  }}
                  onKeyDown={(e) => onKeyDown(e, node)}
                  onDragStart={(e) => {
                    if (!canManage) return
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', c.id)
                    setDragId(c.id)
                  }}
                  onDragEnd={() => {
                    setDragId(null)
                    setDropTarget(null)
                  }}
                  onDragOver={(e) => onDragOver(e, c.id)}
                  onDragLeave={() => setDropTarget(null)}
                  onDrop={(e) => onDrop(e, c.id)}
                  className={cn(
                    'group flex h-row items-center gap-1 pr-2 outline-none focus-visible:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring',
                    dropTarget === c.id && 'bg-primary/10',
                    dragId === c.id && 'opacity-50',
                  )}
                  style={{ paddingLeft: `${node.depth * 1.25 + 0.5}rem` }}
                >
                  <GripVertical
                    className="size-3.5 shrink-0 text-subtle-foreground"
                    aria-hidden="true"
                  />
                  {hasChildren ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-hidden="true"
                      className="grid size-6 place-items-center rounded-sm text-muted-foreground hover:bg-surface-sunken"
                      onClick={() => toggle(c.id)}
                    >
                      {open ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </button>
                  ) : (
                    <span className="size-6" aria-hidden="true" />
                  )}
                  <span className="font-code text-xs text-muted-foreground">{c.code}</span>
                  <span className="min-w-0 truncate text-sm">{c.name}</span>
                  {canManage && (
                    <span className="ml-auto flex items-center gap-0.5 opacity-60 group-focus-within:opacity-100 group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        tabIndex={-1}
                        aria-label={t('categories.addChild', { name: c.name })}
                        onClick={() => setDialog({ kind: 'create', parentId: c.id })}
                      >
                        <Plus aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        tabIndex={-1}
                        aria-label={t('categories.edit', { name: c.name })}
                        onClick={() => setDialog({ kind: 'edit', category: c })}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        tabIndex={-1}
                        aria-label={t('categories.move', { name: c.name })}
                        onClick={() => setDialog({ kind: 'move', category: c })}
                      >
                        <FolderInput aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        tabIndex={-1}
                        aria-label={t('categories.delete', { name: c.name })}
                        onClick={() => setDeleting(c)}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <CategoryDialog
          key={dialog.kind === 'edit' ? dialog.category.id : `new-${dialog.parentId ?? ''}`}
          category={dialog.kind === 'edit' ? dialog.category : null}
          parentId={dialog.kind === 'create' ? dialog.parentId : null}
          categories={data}
          onClose={() => setDialog(null)}
          onCreated={(c) => {
            if (c.parent_id) setExpanded((prev) => new Set(prev).add(c.parent_id ?? ''))
          }}
        />
      )}
      {dialog?.kind === 'move' && (
        <MoveDialog
          category={dialog.category}
          categories={data}
          problemText={problemText}
          busy={move.isPending}
          onClose={() => setDialog(null)}
          onMove={(parentId) => {
            if (requestMove(dialog.category, parentId)) setDialog(null)
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('categories.deleteTitle')}
        description={deleting ? t('categories.deleteBody', { name: deleting.name }) : undefined}
        confirmLabel={t('actions.delete')}
        onConfirm={async () => {
          if (deleting) await remove.mutateAsync(deleting)
        }}
      />
    </div>
  )
}

function CategoryDialog({
  category,
  parentId,
  categories,
  onClose,
  onCreated,
}: {
  category: ItemCategory | null
  parentId: string | null
  categories: ItemCategory[]
  onClose: () => void
  onCreated: (c: ItemCategory) => void
}) {
  const { t } = useTranslation('catalog')
  const invalidate = useInvalidate()
  const idem = useIdempotencyKey()
  const [base, setBase] = useState(category)
  const form = useForm<CategoryValues>({
    resolver: zodResolver(categorySchema),
    defaultValues: {
      code: category?.code ?? '',
      name: category?.name ?? '',
      parent_id: category?.parent_id ?? parentId ?? '',
    },
  })
  const blocked = useMemo(() => {
    if (!base) return undefined
    const set = descendantIds(base.id, categories)
    set.add(base.id)
    return set
  }, [base, categories])

  const save = useMutation({
    mutationFn: (v: CategoryValues) => {
      const input = { code: v.code.trim(), name: v.name.trim(), parent_id: v.parent_id || null }
      return base
        ? categoriesApi.update(base.id, { ...input, version: base.version })
        : categoriesApi.create(input, idem.current(input))
    },
    onSuccess: async (saved) => {
      idem.reset()
      platform.notify.success(t('toast.saved'))
      onCreated(saved)
      await invalidate(catalogKeys.categories())
      onClose()
    },
  })

  const reload = async () => {
    if (!base) return
    const fresh = await categoriesApi.get(base.id)
    save.reset()
    setBase(fresh)
    form.reset({ code: fresh.code, name: fresh.name, parent_id: fresh.parent_id ?? '' })
    await invalidate(catalogKeys.categories())
  }

  const labels = { code: t('fields.code'), name: t('fields.name'), parent_id: t('fields.parent') }
  return (
    <RecordDialog<CategoryValues>
      open
      onOpenChange={(o) => !o && onClose()}
      title={base ? t('categories.editTitle') : t('categories.newTitle')}
      form={form}
      onSubmit={(v) => {
        if (base) {
          const problem = reparentProblem(base.id, v.parent_id || null, categories)
          if (problem === 'self' || problem === 'descendant') {
            form.setError('parent_id', {
              message: t(`categories.cycle.${problem}`, { name: base.name, parent: '' }),
            })
            return
          }
        }
        save.mutate(v)
      }}
      error={save.error}
      busy={save.isPending}
      onReload={isVersionConflict(save.error) ? () => void reload() : undefined}
      fieldLabels={labels}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField<CategoryValues, 'code'>
          name="code"
          label={labels.code}
          required
          input={{ autoComplete: 'off', className: 'font-code', maxLength: 32 }}
        />
        <TextField<CategoryValues, 'name'> name="name" label={labels.name} required />
        <FormField<CategoryValues, 'parent_id'>
          name="parent_id"
          label={labels.parent_id}
          description={t('categories.parentHelp')}
          className="sm:col-span-2"
          render={({ field, control }) => (
            <CategorySelect
              {...control}
              ref={field.ref}
              value={field.value || null}
              onChange={(v) => field.onChange(v ?? '')}
              onBlur={field.onBlur}
              clearable
              placeholder={t('categories.root')}
              disabledIds={blocked}
              disabledReason={t('categories.cycleHint')}
            />
          )}
        />
      </div>
    </RecordDialog>
  )
}

function MoveDialog({
  category,
  categories,
  problemText,
  busy,
  onClose,
  onMove,
}: {
  category: ItemCategory
  categories: ItemCategory[]
  problemText: (p: ReparentProblem, c: ItemCategory, parentId: string | null) => string
  busy: boolean
  onClose: () => void
  onMove: (parentId: string | null) => void
}) {
  const { t } = useTranslation('catalog')
  const form = useForm<{ parent_id: string }>({
    defaultValues: { parent_id: category.parent_id ?? '' },
  })
  const blocked = useMemo(() => {
    const set = descendantIds(category.id, categories)
    set.add(category.id)
    return set
  }, [category, categories])
  return (
    <RecordDialog<{ parent_id: string }>
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('categories.moveTitle', { name: category.name })}
      description={t('categories.moveBody')}
      form={form}
      error={null}
      busy={busy}
      onSubmit={(v) => {
        const parentId = v.parent_id || null
        const problem = reparentProblem(category.id, parentId, categories)
        if (problem) {
          form.setError('parent_id', { message: problemText(problem, category, parentId) })
          return
        }
        onMove(parentId)
      }}
    >
      <FormField<{ parent_id: string }, 'parent_id'>
        name="parent_id"
        label={t('fields.parent')}
        render={({ field, control }) => (
          <CategorySelect
            {...control}
            ref={field.ref}
            value={field.value || null}
            onChange={(v) => field.onChange(v ?? '')}
            onBlur={field.onBlur}
            clearable
            placeholder={t('categories.root')}
            disabledIds={blocked}
            disabledReason={t('categories.cycleHint')}
          />
        )}
      />
    </RecordDialog>
  )
}
