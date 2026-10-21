import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'
import type { FieldValues, SubmitHandler, UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Form, FormErrorSummary } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { isVersionConflict } from '../lib/errors'
import { VersionConflictAlert } from './VersionConflictAlert'

interface RecordDialogProps<T extends FieldValues> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  form: UseFormReturn<T>
  onSubmit: SubmitHandler<T>
  /** The failed save; field errors land on inputs, a version conflict offers a reload. */
  error: unknown
  onReload?: () => void
  busy?: boolean
  fieldLabels?: Record<string, string>
  className?: string
  children: ReactNode
}

/** Create/edit dialog for small master-data records (units, categories, rules). */
export function RecordDialog<T extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  error,
  onReload,
  busy = false,
  fieldLabels,
  className,
  children,
}: RecordDialogProps<T>) {
  const { t } = useTranslation('catalog')
  const conflict = isVersionConflict(error)
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        closeLabel={t('actions.close')}
        className={cn('max-h-[90dvh] overflow-y-auto', className)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="grid gap-4" aria-busy={busy}>
          {conflict && onReload ? (
            <VersionConflictAlert onReload={onReload} />
          ) : (
            <FormErrorSummary error={error} fieldLabels={fieldLabels} />
          )}
          {children}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button type="submit" disabled={busy || conflict}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {t('actions.save')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
