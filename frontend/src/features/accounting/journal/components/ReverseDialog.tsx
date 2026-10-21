import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { DateInput, Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toIsoDate } from '@/lib/datetime'
import { calendarDate, snakeToCamelPath } from '@/lib/forms'
import { journalApi } from '../api/client'
import { activeCompany, journalKeys } from '../api/keys'
import { usePayloadKeys } from '../lib/idempotency'
import type { JournalEntry } from '../types'

interface ReverseDialogProps {
  entry: JournalEntry
  open: boolean
  onOpenChange: (open: boolean) => void
  onReversed: (reversal: JournalEntry) => void
}

interface ReverseValues {
  date: string
  reason: string
}

/** POST /journal-entries/{id}/reverse {date, reason}: creates the mirrored entry. */
export function ReverseDialog({ entry, open, onOpenChange, onReversed }: ReverseDialogProps) {
  const { t } = useTranslation('accountingJournal')
  const queryClient = useQueryClient()
  const keyFor = usePayloadKeys()
  const schema = z.object({
    date: calendarDate({ min: entry.entry_date }),
    reason: z.string().trim().min(3, t('reverse.reasonRequired')).max(500),
  })
  const form = useForm<ReverseValues>({
    resolver: zodResolver(schema),
    defaultValues: { date: toIsoDate(new Date()), reason: '' },
  })
  const mutation = useMutation({
    mutationFn: ({ v }: { v: ReverseValues; company: string }) => {
      const body = { date: v.date, reason: v.reason.trim() }
      return journalApi.reverse(entry.id, body, keyFor({ id: entry.id, ...body }))
    },
    onSuccess: (reversal, { company }) => {
      void queryClient.invalidateQueries({ queryKey: journalKeys.entries(company) })
      // Started under another company: its cache is refreshed, this screen is left alone.
      if (activeCompany() !== company) return
      onOpenChange(false)
      form.reset()
      onReversed(reversal)
    },
  })

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent closeLabel={t('actions.close')}>
        <Form
          form={form}
          onSubmit={(v) => mutation.mutate({ v, company: activeCompany() })}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t('reverse.title', { number: entry.number ?? '' })}</DialogTitle>
            <DialogDescription>{t('reverse.body')}</DialogDescription>
          </DialogHeader>
          <FormErrorSummary
            error={mutation.error}
            mapField={snakeToCamelPath}
            fieldLabels={{ date: t('reverse.date'), reason: t('reverse.reason') }}
          />
          <FormField<ReverseValues, 'date'>
            name="date"
            label={t('reverse.date')}
            required
            render={({ field, control }) => (
              <DateInput
                {...control}
                ref={field.ref}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
              />
            )}
          />
          <FormField<ReverseValues, 'reason'>
            name="reason"
            label={t('reverse.reason')}
            required
            render={({ field, control }) => (
              <Textarea {...control} {...field} rows={3} maxLength={500} />
            )}
          />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending}
              onClick={() => onOpenChange(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('reverse.confirm')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
