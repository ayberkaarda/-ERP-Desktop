import { CheckCircle2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { JournalEntryEditor } from '../components/JournalEntryEditor'
import { JournalEntryView } from '../components/JournalEntryView'
import { LoadError } from '../components/LoadError'
import { useEntry } from '../hooks/queries'
import type { JournalEntry } from '../types'

/** /accounting/journal-entries/new and /:id — drafts open in the editor, the rest read-only. */
export function JournalEntryPage() {
  const { id } = useParams()
  const { t } = useTranslation('accountingJournal')
  const entry = useEntry(id)
  const [posted, setPosted] = useState<JournalEntry | null>(null)
  // The draft being edited stays in the editor even if a refetch reports it posted elsewhere:
  // unmounting would drop unsaved edits. The editor shows the change and offers a reload.
  const [editing, setEditing] = useState<string | null>(null)
  const data = entry.data
  if (data?.status === 'draft' && editing !== data.id) setEditing(data.id)
  const inEditor = data !== undefined && (data.status === 'draft' || editing === data.id)
  const refreshFailed = entry.isError && data !== undefined

  let body
  if (!id) {
    body = (
      <JournalEntryEditor
        entry={null}
        onReload={() => Promise.resolve(undefined)}
        onPosted={setPosted}
      />
    )
  } else if (data && inEditor) {
    body = (
      <JournalEntryEditor
        key={data.id}
        entry={data}
        onReload={async () => {
          const fresh = (await entry.refetch()).data
          if (fresh && fresh.status !== 'draft') setEditing(null)
          return fresh
        }}
        onPosted={(p) => {
          setEditing(null)
          setPosted(p)
        }}
      />
    )
  } else if (data) {
    body = <JournalEntryView entry={data} />
  } else if (entry.isPending) {
    body = (
      <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  } else {
    body = (
      <div className="mx-auto max-w-[1440px] px-6 py-6">
        <LoadError error={entry.error} onRetry={() => void entry.refetch()} />
      </div>
    )
  }

  return (
    <>
      {refreshFailed && (
        <div className="mx-auto max-w-[1440px] px-6 pt-4">
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground"
          >
            <span>{t('errors.refreshFailed')}</span>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void entry.refetch()}
            >
              {t('actions.retry')}
            </Button>
          </div>
        </div>
      )}
      {body}
      <Dialog open={posted !== null} onOpenChange={(open) => !open && setPosted(null)}>
        <DialogContent closeLabel={t('actions.close')}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="size-5 text-success" aria-hidden="true" />
              {t('post.doneTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('post.doneBody', { number: posted?.number ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <p className="text-center font-code text-2xl font-semibold" data-testid="posted-number">
            {posted?.number}
          </p>
          <DialogFooter>
            <Button type="button" onClick={() => setPosted(null)}>
              {t('actions.ok')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
