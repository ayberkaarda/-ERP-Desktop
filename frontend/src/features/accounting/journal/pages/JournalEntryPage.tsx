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

  let body
  if (!id) {
    body = (
      <JournalEntryEditor
        entry={null}
        onReload={() => Promise.resolve(undefined)}
        onPosted={setPosted}
      />
    )
  } else if (entry.isPending) {
    body = (
      <div className="mx-auto max-w-[1440px] space-y-4 px-6 py-6" aria-busy="true">
        <Skeleton className="h-10 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  } else if (entry.isError) {
    body = (
      <div className="mx-auto max-w-[1440px] px-6 py-6">
        <LoadError error={entry.error} onRetry={() => void entry.refetch()} />
      </div>
    )
  } else if (entry.data.status === 'draft') {
    body = (
      <JournalEntryEditor
        key={entry.data.id}
        entry={entry.data}
        onReload={async () => (await entry.refetch()).data}
        onPosted={setPosted}
      />
    )
  } else {
    body = <JournalEntryView entry={entry.data} />
  }

  return (
    <>
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
