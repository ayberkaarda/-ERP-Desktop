import { Loader2 } from 'lucide-react'
import { useId, type ComponentProps, type ReactNode } from 'react'
import {
  Controller,
  useFormContext,
  type FieldPath,
  type FieldValues,
  type SubmitHandler,
  type UseFormReturn,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Form, FormErrorSummary, FormField } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { translateMessage } from '@/lib/forms'
import { cn } from '@/lib/utils'
import { NativeSelect, VersionConflictAlert, type NativeSelectOption } from './components'
import { isUncertain, isVersionConflict } from './errors'
import { useAccT } from './i18n'

interface RecordDialogProps<T extends FieldValues> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: ReactNode
  form: UseFormReturn<T>
  onSubmit: SubmitHandler<T>
  /** The failed save: field errors land on inputs, a version conflict offers a reload. */
  error: unknown
  onReload?: () => void
  reloading?: boolean
  busy?: boolean
  fieldLabels?: Record<string, string>
  className?: string
  children: ReactNode
}

/** Create/edit dialog: server field errors, VERSION_CONFLICT reload, uncertain-outcome note. */
export function RecordDialog<T extends FieldValues>({
  open,
  onOpenChange,
  title,
  description,
  form,
  onSubmit,
  error,
  onReload,
  reloading = false,
  busy = false,
  fieldLabels,
  className,
  children,
}: RecordDialogProps<T>) {
  const t = useAccT()
  const { t: tc } = useTranslation('common')
  const conflict = isVersionConflict(error)
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        closeLabel={tc('actions.close')}
        className={cn('max-h-[90dvh] overflow-y-auto', className)}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : 'sr-only'}>
            {description ?? title}
          </DialogDescription>
        </DialogHeader>
        <Form form={form} onSubmit={onSubmit} className="grid gap-4" aria-label={title}>
          {conflict ? (
            <VersionConflictAlert onReload={onReload} busy={reloading} />
          ) : error && isUncertain(error) ? (
            <p role="alert" className="text-sm text-warning-soft-foreground">
              {t('common.uncertain')}
            </p>
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
              {tc('actions.cancel')}
            </Button>
            <Button type="submit" disabled={busy || conflict}>
              {busy && <Loader2 className="animate-spin" aria-hidden="true" />}
              {tc('actions.save')}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

interface BaseFieldProps<T extends FieldValues, N extends FieldPath<T>> {
  name: N
  label: string
  required?: boolean
  description?: ReactNode
  className?: string
}

export function TextField<T extends FieldValues, N extends FieldPath<T>>({
  input,
  ...props
}: BaseFieldProps<T, N> & { input?: ComponentProps<typeof Input> }) {
  return (
    <FormField<T, N>
      {...props}
      render={({ field, control }) => (
        <Input
          {...control}
          {...input}
          name={field.name}
          ref={field.ref}
          value={field.value ?? ''}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
        />
      )}
    />
  )
}

export function TextAreaField<T extends FieldValues, N extends FieldPath<T>>(
  props: BaseFieldProps<T, N> & { maxLength?: number },
) {
  const { maxLength, ...rest } = props
  return (
    <FormField<T, N>
      {...rest}
      render={({ field, control }) => (
        <Textarea
          {...control}
          name={field.name}
          ref={field.ref}
          maxLength={maxLength}
          value={field.value ?? ''}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
        />
      )}
    />
  )
}

export function SelectField<T extends FieldValues, N extends FieldPath<T>>({
  options,
  emptyLabel,
  disabled,
  ...props
}: BaseFieldProps<T, N> & {
  options: readonly NativeSelectOption[]
  emptyLabel?: string
  disabled?: boolean
}) {
  return (
    <FormField<T, N>
      {...props}
      render={({ field, control }) => (
        <NativeSelect
          {...control}
          name={field.name}
          ref={field.ref}
          options={options}
          emptyLabel={emptyLabel}
          disabled={disabled}
          value={field.value ?? ''}
          onChange={(e) => field.onChange(e.target.value)}
          onBlur={field.onBlur}
        />
      )}
    />
  )
}

export function CheckboxField<T extends FieldValues>({
  name,
  label,
  description,
  disabled,
  error,
  className,
}: {
  name: FieldPath<T>
  label: string
  description?: ReactNode
  disabled?: boolean
  /** Extra (already translated) message, e.g. an integrity rule; server errors show too. */
  error?: string
  className?: string
}) {
  const { control } = useFormContext<T>()
  const { i18n } = useTranslation('common')
  const id = useId()
  const errorId = `${id}-error`
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const message = error ?? translateMessage(i18n, fieldState.error?.message)
        return (
          <div className={cn('space-y-1', className)}>
            <label htmlFor={id} className="flex items-start gap-2 text-sm">
              <Checkbox
                id={id}
                name={field.name}
                ref={field.ref}
                disabled={disabled}
                aria-invalid={message ? true : undefined}
                aria-describedby={message ? errorId : undefined}
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{label}</span>
                {description && (
                  <span className="block text-xs text-muted-foreground">{description}</span>
                )}
              </span>
            </label>
            {message && (
              <p id={errorId} className="text-xs text-danger">
                {message}
              </p>
            )}
          </div>
        )
      }}
    />
  )
}
