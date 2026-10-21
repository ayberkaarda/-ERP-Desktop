import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, ClipboardCopy, FileUp, Loader2, Save, Search, Trash2 } from 'lucide-react'
import { useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { FieldShell } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { INVALID_DECIMAL, formatDecimalDisplay } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { documentsApi } from '../../documents/api/client'
import { invDocsKeys } from '../../documents/api/keys'
import { DocStatusBadge } from '../../documents/components/DocStatusBadge'
import { VersionConflictAlert } from '../../documents/components/VersionConflictAlert'
import { errorMessage, isVersionConflict } from '../../documents/lib/errors'
import { usePayloadKeys } from '../../documents/lib/idempotency'
import { INV_PERMS } from '../../documents/permissions'
import type { StockDocument } from '../../documents/types'
import {
  changedCounts,
  countSummary,
  filterLines,
  initialCounts,
  type Counts,
} from '../lib/variance'
import { CountGrid } from './CountGrid'
import { ActionError } from '../../documents/components/ActionError'
import { CountImportDialog } from './CountImportDialog'

export const COUNTS_PATH = '/inventory/counts'

interface CountEditorProps {
  document: StockDocument
  onReload: () => Promise<StockDocument | undefined>
  onPosted: (doc: StockDocument) => void
}

/** Count draft: enter counted quantities, review variances, import a CSV, save and post. */
export function CountEditor({ document, onReload, onPosted }: CountEditorProps) {
  const { t } = useTranslation('inventoryDocs')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canEdit = usePermission(INV_PERMS.documents.create)
  const canPost = usePermission(INV_PERMS.documents.post)
  const company = useCompanyStore((s) => s.activeCompanyId)
  const [base, setBase] = useState(document)
  const [counts, setCounts] = useState<Counts>(() => initialCounts(document.lines))
  const [q, setQ] = useState('')
  const [onlyVariance, setOnlyVariance] = useState(false)
  const [onlyUncounted, setOnlyUncounted] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirmPost, setConfirmPost] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [importing, setImporting] = useState(false)
  const [checking, setChecking] = useState(false)

  const changes = changedCounts(base.lines, counts)
  const dirty = changes.length > 0
  const invalid = Object.values(counts).some((v) => v === INVALID_DECIMAL)
  const summary = countSummary(base.lines, counts)
  const rows = filterLines(base.lines, counts, { q, onlyVariance, onlyUncounted })
  const changedElsewhere = document.id === base.id && document.version !== base.version
  const money = (v: string) => formatDecimalDisplay(v, { locale })
  const sameCompany = (started: string | null) =>
    useCompanyStore.getState().activeCompanyId === started

  const adopt = (doc: StockDocument) => {
    setBase(doc)
    setCounts(initialCounts(doc.lines))
  }

  const save = useMutation({
    mutationFn: ({ target }: { target: StockDocument; company: string | null }) =>
      documentsApi.updateCount(target.id, {
        version: target.version,
        lines: changedCounts(target.lines, counts),
      }),
    onSuccess: (saved, { company: started }) => {
      queryClient.setQueryData(invDocsKeys.document(saved.id, started ?? 'none'), saved)
      void queryClient.invalidateQueries({ queryKey: invDocsKeys.documents(started ?? 'none') })
      if (sameCompany(started)) adopt(saved)
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const post = useMutation({
    mutationFn: ({ target }: { target: StockDocument; company: string | null }) =>
      documentsApi.post(
        target.id,
        target.version,
        keyFor({ post: target.id, version: target.version }),
      ),
    onSuccess: (posted, { company: started }) => {
      queryClient.setQueryData(invDocsKeys.document(posted.id, started ?? 'none'), posted)
      void queryClient.invalidateQueries({ queryKey: invDocsKeys.documents(started ?? 'none') })
      if (sameCompany(started)) onPosted(posted)
    },
    onError: (error, { company: started }) => {
      if (sameCompany(started) && isVersionConflict(error)) setConflict(true)
    },
  })

  const remove = useMutation({
    mutationFn: ({ target }: { target: StockDocument; company: string | null }) =>
      documentsApi.remove(target.id, target.version),
    onSuccess: (_, { company: started }) => {
      void queryClient.invalidateQueries({ queryKey: invDocsKeys.documents(started ?? 'none') })
      if (!sameCompany(started)) return
      platform.notify.success(t('editor.deleted'))
      void navigate(COUNTS_PATH)
    },
    onError: (error, { company: started }) => {
      if (!sameCompany(started)) return
      if (isVersionConflict(error)) setConflict(true)
      else platform.notify.error(errorMessage(error, t('errors.generic')))
    },
  })

  const submitSave = async () => {
    if (!canEdit || invalid || !dirty || save.isPending) return
    try {
      await save.mutateAsync({ target: base, company })
      platform.notify.success(t('count.saved'))
    } catch {
      // Shown by the summary / conflict alert.
    }
  }

  /** Saves pending counts first (create permission); an unchanged draft posts with post alone. */
  const submitPost = async () => {
    if (invalid || summary.counted < summary.total) return
    if (dirty && !canEdit) return
    const started = company
    try {
      if (dirty) await save.mutateAsync({ target: base, company: started })
      if (sameCompany(started)) setConfirmPost(true)
    } catch {
      // Shown by the summary / conflict alert.
    }
  }

  const confirmAndPost = async () => {
    const started = company
    setChecking(true)
    try {
      const fresh = await documentsApi.get(base.id)
      if (!sameCompany(started)) return
      if (fresh.version !== base.version || fresh.status !== 'draft') {
        setConflict(true)
        throw new Error('changed')
      }
      await post.mutateAsync({ target: fresh, company: started })
    } catch (error) {
      setConfirmPost(false)
      throw error
    } finally {
      setChecking(false)
    }
  }

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) adopt(fresh)
    setConflict(false)
    save.reset()
    post.reset()
  }

  const fillBlanks = () =>
    setCounts((prev) => {
      const next = { ...prev }
      for (const l of base.lines) {
        if ((next[l.id] ?? '') === '') next[l.id] = l.system_quantity ?? '0'
      }
      return next
    })

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void submitSave()
    }
  }

  const busy = save.isPending || post.isPending || checking
  const disabled = !canEdit || busy
  const actionError = conflict ? null : (save.error ?? post.error)
  const uncounted = summary.total - summary.counted
  const title = t('count.title', { number: base.number ?? t('list.unnumbered') })

  return (
    <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={title}
        description={[
          [base.warehouse_code, base.warehouse_name].filter(Boolean).join(' · '),
          formatDate(base.document_date, locale),
          base.frozen_at
            ? t('count.frozenAt', { date: formatDateTime(base.frozen_at, locale) })
            : '',
        ]
          .filter(Boolean)
          .join(' · ')}
        breadcrumbs={[
          { label: t('nav.inventory') },
          { label: t('count.listTitle'), to: COUNTS_PATH },
          { label: t('status.draft') },
        ]}
        meta={<DocStatusBadge status={base.status} />}
        actions={
          <>
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden="true" />
                {t('editor.delete')}
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy || dirty}
                title={dirty ? t('count.saveBeforeImport') : undefined}
                onClick={() => setImporting(true)}
              >
                <FileUp aria-hidden="true" />
                {t('import.action')}
              </Button>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="secondary"
                disabled={busy || !dirty || invalid}
                onClick={() => void submitSave()}
              >
                {save.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                {t('count.save')}
              </Button>
            )}
            {canPost && (
              <Button
                type="button"
                disabled={busy || invalid || uncounted > 0 || (dirty && !canEdit)}
                title={uncounted > 0 ? t('count.postNeedsCounts') : undefined}
                onClick={() => void submitPost()}
              >
                {post.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <CheckCheck aria-hidden="true" />
                )}
                {t('editor.post')}
              </Button>
            )}
          </>
        }
      />
      {conflict && <VersionConflictAlert onReload={() => void reload()} />}
      {!conflict && changedElsewhere && <VersionConflictAlert onReload={() => void reload()} />}
      <ActionError error={actionError} />
      <section
        aria-label={t('count.summary')}
        className="grid gap-3 rounded-lg border border-border bg-surface p-3 text-sm sm:grid-cols-4"
      >
        <div>
          <p className="text-xs text-muted-foreground">{t('count.counted')}</p>
          <p className="tabular-nums" data-testid="count-progress">
            {t('count.progress', { counted: summary.counted, total: summary.total })}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('count.summaryGain')}</p>
          <p className="tabular-nums text-success" data-testid="count-gain">
            {money(summary.gain)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('count.summaryLoss')}</p>
          <p className="tabular-nums text-danger" data-testid="count-loss">
            {money(summary.loss)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{t('count.summaryNet')}</p>
          <p className="font-semibold tabular-nums" data-testid="count-net">
            {money(summary.net)}
          </p>
        </div>
      </section>
      {uncounted > 0 && summary.counted > 0 && (
        <p role="status" className="text-sm text-warning-soft-foreground">
          {t('count.uncountedWarning', { count: uncounted })}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <FieldShell label={t('count.search')} className="w-64">
          {(control) => (
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                {...control}
                value={q}
                className="pl-8"
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
          )}
        </FieldShell>
        <label className="flex h-control items-center gap-2 text-sm">
          <Checkbox checked={onlyVariance} onChange={(e) => setOnlyVariance(e.target.checked)} />
          {t('count.onlyVariance')}
        </label>
        <label className="flex h-control items-center gap-2 text-sm">
          <Checkbox checked={onlyUncounted} onChange={(e) => setOnlyUncounted(e.target.checked)} />
          {t('count.onlyUncounted')}
        </label>
        {canEdit && uncounted > 0 && (
          <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={fillBlanks}>
            <ClipboardCopy aria-hidden="true" />
            {t('count.copySystem')}
          </Button>
        )}
        <p className="ml-auto text-xs text-muted-foreground">{t('count.keys')}</p>
      </div>
      {base.lines.length === 0 ? (
        <EmptyState description={t('count.empty')} />
      ) : rows.length === 0 ? (
        <EmptyState description={t('count.notFound')} />
      ) : (
        <CountGrid
          lines={rows}
          counts={counts}
          disabled={disabled}
          resetKey={`${q}|${onlyVariance}|${onlyUncounted}`}
          onChange={(id, value) => setCounts((prev) => ({ ...prev, [id]: value }))}
        />
      )}
      <ConfirmDialog
        open={confirmPost}
        onOpenChange={setConfirmPost}
        tone="primary"
        title={t('post.title')}
        description={
          <span className="space-y-1">
            <span className="block">{t('count.postBody')}</span>
            <span className="block tabular-nums">
              {t('count.postSummary', {
                gain: money(summary.gain),
                loss: money(summary.loss),
                net: money(summary.net),
              })}
            </span>
          </span>
        }
        confirmLabel={t('post.confirm')}
        onConfirm={confirmAndPost}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('editor.deleteTitle')}
        description={t('editor.deleteBody')}
        confirmLabel={t('editor.delete')}
        onConfirm={async () => {
          await remove.mutateAsync({ target: base, company })
        }}
      />
      <CountImportDialog
        document={base}
        open={importing}
        onOpenChange={setImporting}
        onApplied={(doc) => {
          if (doc) {
            queryClient.setQueryData(invDocsKeys.document(doc.id), doc)
            adopt(doc)
          } else {
            void reload()
          }
        }}
      />
    </div>
  )
}
