import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCheck, Loader2, Save, Trash2 } from 'lucide-react'
import { useMemo, useState, type KeyboardEvent } from 'react'
import { useForm, useFormState, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { formatDate, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { journalApi } from '../api/client'
import { journalKeys } from '../api/keys'
import { balanceOf } from '../lib/balance'
import { errorMessage, isVersionConflict } from '../lib/errors'
import { usePayloadKeys } from '../lib/idempotency'
import {
  emptyEntry,
  serverFieldMapper,
  toEntryInput,
  toEntryValues,
  type EntryValues,
} from '../lib/lines'
import { selectClass } from '../lib/ui'
import { entrySchema, type EntryMessages } from '../schemas'
import { ENTRY_TYPES, MANUAL_ENTRY_TYPES, MAX_LINES, type JournalEntry } from '../types'
import { BalanceBanner } from './BalanceBanner'
import { EntryStatusBadge } from './EntryStatusBadge'
import { JournalLinesGrid } from './JournalLinesGrid'
import { VersionConflictAlert } from './VersionConflictAlert'

interface JournalEntryEditorProps {
  /** null for a new entry. */
  entry: JournalEntry | null
  onReload: () => Promise<JournalEntry | undefined>
  onPosted: (entry: JournalEntry) => void
}

const BASE = '/accounting/journal-entries'

/** Draft editor: save (POST/PATCH with version), post with confirmation, delete draft. */
export function JournalEntryEditor({ entry, onReload, onPosted }: JournalEntryEditorProps) {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const canEdit = usePermission('accounting.entries.create')
  const canPost = usePermission('accounting.entries.post')
  const [conflict, setConflict] = useState(false)
  const [showAllDimensions, setShowAllDimensions] = useState(false)
  const [confirmPost, setConfirmPost] = useState(
    () => (location.state as { confirmPost?: boolean } | null)?.confirmPost === true,
  )
  const [confirmDelete, setConfirmDelete] = useState(false)

  const messages: EntryMessages = useMemo(
    () => ({
      account: t('validation.account'),
      amountRequired: t('validation.amountRequired'),
      bothSides: t('validation.bothSides'),
      party: t('validation.party'),
      costCenter: t('validation.costCenter'),
      project: t('validation.project'),
      fxAmount: t('validation.fxAmount'),
      fxRate: t('validation.fxRate'),
      minLines: t('validation.minLines'),
      maxLines: t('validation.maxLines', { max: MAX_LINES }),
      descriptionTooLong: t('validation.descriptionTooLong'),
    }),
    [t],
  )
  const form = useForm<EntryValues>({
    resolver: zodResolver(entrySchema(messages)),
    defaultValues: entry ? toEntryValues(entry) : emptyEntry(),
  })
  const lines = useWatch({ control: form.control, name: 'lines' })
  const { isDirty } = useFormState({ control: form.control })
  const balance = balanceOf(lines)
  const [lastValues, setLastValues] = useState<EntryValues | null>(null)

  const save = useMutation({
    mutationFn: async (values: EntryValues) => {
      setLastValues(values)
      const input = toEntryInput(values)
      return entry
        ? journalApi.update(entry.id, { ...input, version: entry.version })
        : journalApi.create(input, keyFor(input))
    },
    onSuccess: (saved) => {
      queryClient.setQueryData(journalKeys.entry(saved.id), saved)
      void queryClient.invalidateQueries({ queryKey: journalKeys.entries(), exact: false })
      form.reset(toEntryValues(saved))
    },
    onError: (error) => {
      if (isVersionConflict(error)) setConflict(true)
    },
  })

  const post = useMutation({
    mutationFn: (target: JournalEntry) =>
      journalApi.post(
        target.id,
        target.version,
        keyFor({ post: target.id, version: target.version }),
      ),
    onSuccess: (posted) => {
      queryClient.setQueryData(journalKeys.entry(posted.id), posted)
      void queryClient.invalidateQueries({ queryKey: journalKeys.entries(), exact: false })
      onPosted(posted)
    },
    onError: (error) => {
      if (isVersionConflict(error)) setConflict(true)
    },
  })

  const remove = useMutation({
    mutationFn: (target: JournalEntry) => journalApi.remove(target.id, target.version),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: journalKeys.entries(), exact: false })
      platform.notify.success(t('editor.deleted'))
      void navigate(BASE)
    },
    onError: (error) => {
      if (isVersionConflict(error)) setConflict(true)
      else platform.notify.error(errorMessage(error, t('errors.generic')))
    },
  })

  const submitSave = form.handleSubmit(async (values) => {
    try {
      const saved = await save.mutateAsync(values)
      platform.notify.success(t('editor.saved'))
      if (!entry) void navigate(`${BASE}/${saved.id}`, { replace: true })
    } catch {
      // Shown by the summary / conflict alert.
    }
  })

  /** Unsaved changes are saved first; the confirmation then posts the stored draft. */
  const submitPost = form.handleSubmit(async (values) => {
    if (!balanceOf(values.lines).balanced) return
    try {
      if (!entry) {
        const saved = await save.mutateAsync(values)
        void navigate(`${BASE}/${saved.id}`, { replace: true, state: { confirmPost: true } })
        return
      }
      if (isDirty) await save.mutateAsync(values)
      setConfirmPost(true)
    } catch {
      // Shown by the summary / conflict alert.
    }
  })

  const reload = async () => {
    const fresh = await onReload()
    if (fresh) form.reset(toEntryValues(fresh))
    setConflict(false)
    save.reset()
    post.reset()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault()
      if (canEdit && !save.isPending) void submitSave()
    }
  }

  const disabled = !canEdit || save.isPending || post.isPending
  const busy = save.isPending || post.isPending
  const typeOptions =
    entry && !MANUAL_ENTRY_TYPES.some((x) => x === entry.entry_type)
      ? ENTRY_TYPES
      : MANUAL_ENTRY_TYPES
  const actionError = conflict ? null : (save.error ?? post.error)
  const fmt = (v: { toFixed: (n: number) => string }) =>
    formatDecimalDisplay(v.toFixed(2), { locale })

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6" onKeyDown={onKeyDown}>
      <PageHeader
        title={entry ? t('editor.editTitle') : t('editor.newTitle')}
        description={t('editor.description')}
        breadcrumbs={[
          { label: t('nav.accounting') },
          { label: t('list.title'), to: BASE },
          { label: entry ? t('status.draft') : t('editor.newTitle') },
        ]}
        meta={entry ? <EntryStatusBadge status={entry.status} /> : undefined}
        actions={
          <>
            {entry && canEdit && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy || remove.isPending}
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
                disabled={busy}
                onClick={() => void submitSave()}
              >
                {save.isPending ? (
                  <Loader2 className="animate-spin" aria-hidden="true" />
                ) : (
                  <Save aria-hidden="true" />
                )}
                {t('editor.saveDraft')}
              </Button>
            )}
            {canEdit && canPost && (
              <Button
                type="button"
                disabled={busy || !balance.balanced}
                title={balance.balanced ? undefined : t('editor.postNeedsBalance')}
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
      <Form form={form} onSubmit={() => void submitSave()} className="space-y-4">
        {conflict && <VersionConflictAlert onReload={() => void reload()} />}
        <FormErrorSummary
          error={actionError}
          mapField={serverFieldMapper(lastValues ?? form.getValues())}
          fieldLabels={{
            entryType: t('fields.entryType'),
            entryDate: t('fields.entryDate'),
            description: t('fields.description'),
          }}
        />
        <div className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-[12rem_10rem_1fr]">
          <FormField<EntryValues, 'entryType'>
            name="entryType"
            label={t('fields.entryType')}
            required
            render={({ field, control }) => (
              <select
                {...control}
                ref={field.ref}
                name={field.name}
                value={field.value}
                disabled={disabled}
                className={selectClass}
                onChange={(e) => field.onChange(e.target.value)}
                onBlur={field.onBlur}
              >
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {t(`entryType.${type}`)}
                  </option>
                ))}
              </select>
            )}
          />
          <FormField<EntryValues, 'entryDate'>
            name="entryDate"
            label={t('fields.entryDate')}
            required
            render={({ field, control }) => (
              <DateInput
                {...control}
                ref={field.ref}
                value={field.value}
                disabled={disabled}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <FormField<EntryValues, 'description'>
            name="description"
            label={t('fields.description')}
            render={({ field, control }) => (
              <Input {...control} {...field} disabled={disabled} maxLength={500} />
            )}
          />
        </div>
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 bg-background py-1">
          <BalanceBanner lines={lines} className="flex-1" />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={showAllDimensions}
              onChange={(e) => setShowAllDimensions(e.target.checked)}
            />
            {t('editor.showAllDimensions')}
          </label>
        </div>
        {lines.length >= MAX_LINES && (
          <p role="alert" className="text-sm text-danger">
            {t('validation.maxLines', { max: MAX_LINES })}
          </p>
        )}
        <JournalLinesGrid disabled={disabled} showAllDimensions={showAllDimensions} />
        <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      </Form>
      {entry && (
        <ConfirmDialog
          open={confirmPost}
          onOpenChange={setConfirmPost}
          tone="primary"
          title={t('post.title')}
          description={
            <span className="space-y-1">
              <span className="block">{t('post.body')}</span>
              <span className="block tabular-nums">
                {t('post.summary', {
                  date: formatDate(entry.entry_date, locale),
                  debit: fmt(balanceOf(form.getValues('lines')).debit),
                  credit: fmt(balanceOf(form.getValues('lines')).credit),
                  count: entry.lines.length,
                })}
              </span>
            </span>
          }
          confirmLabel={t('post.confirm')}
          onConfirm={async () => {
            await post.mutateAsync(entry).catch((error: unknown) => {
              setConfirmPost(false)
              throw error
            })
          }}
        />
      )}
      {entry && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={t('editor.deleteTitle')}
          description={t('editor.deleteBody')}
          confirmLabel={t('editor.delete')}
          onConfirm={async () => {
            await remove.mutateAsync(entry)
          }}
        />
      )}
    </div>
  )
}
