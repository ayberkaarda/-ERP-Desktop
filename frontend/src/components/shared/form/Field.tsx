import { useId, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import {
  Controller,
  FormProvider,
  useFormContext,
  type ControllerFieldState,
  type ControllerRenderProps,
  type FieldPath,
  type FieldValues,
  type SubmitHandler,
  type UseFormReturn,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { translateMessage } from '@/lib/forms/translate'
import { cn } from '@/lib/utils'

/** Props every control receives so label, help and error are wired for assistive tech. */
export interface FieldControlProps {
  id: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'aria-required'?: boolean
}

interface FieldShellProps {
  label: string
  error?: string
  description?: ReactNode
  required?: boolean
  hideLabel?: boolean
  className?: string
  /** Fixed id (otherwise generated). */
  id?: string
  children: (control: FieldControlProps) => ReactNode
}

/** Label above, help and error below (DESIGN.md form rules); usable without react-hook-form. */
export function FieldShell({
  label,
  error,
  description,
  required = false,
  hideLabel = false,
  className,
  id: fixedId,
  children,
}: FieldShellProps) {
  const { t } = useTranslation('common')
  const generated = useId()
  const id = fixedId ?? `f${generated}`
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [description ? helpId : null, error ? errorId : null]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className={cn(hideLabel && 'sr-only')}>
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
        {required && <span className="sr-only"> ({t('form.required')})</span>}
      </Label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': describedBy || undefined,
        'aria-required': required || undefined,
      })}
      {description && !error && (
        <p id={helpId} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {description && error && (
        <p id={helpId} className="sr-only">
          {description}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export interface FormFieldRenderArgs<T extends FieldValues, N extends FieldPath<T>> {
  field: ControllerRenderProps<T, N>
  fieldState: ControllerFieldState
  control: FieldControlProps
}

interface FormFieldProps<T extends FieldValues, N extends FieldPath<T>> {
  name: N
  label: string
  description?: ReactNode
  required?: boolean
  hideLabel?: boolean
  className?: string
  render: (args: FormFieldRenderArgs<T, N>) => ReactElement
}

/** react-hook-form field: errors from zod (i18n keys) or the server (localized text). */
export function FormField<T extends FieldValues, N extends FieldPath<T>>({
  name,
  label,
  description,
  required,
  hideLabel,
  className,
  render,
}: FormFieldProps<T, N>) {
  const { control } = useFormContext<T>()
  const { i18n } = useTranslation('common')
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FieldShell
          label={label}
          description={description}
          required={required}
          hideLabel={hideLabel}
          className={className}
          error={translateMessage(i18n, fieldState.error?.message)}
        >
          {(controlProps) => render({ field, fieldState, control: controlProps })}
        </FieldShell>
      )}
    />
  )
}

interface FormProps<T extends FieldValues> extends Omit<ComponentProps<'form'>, 'onSubmit'> {
  form: UseFormReturn<T>
  onSubmit: SubmitHandler<T>
}

/** <form> bound to a react-hook-form instance; browser validation is off, zod decides. */
export function Form<T extends FieldValues>({ form, onSubmit, children, ...props }: FormProps<T>) {
  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={(e) => void form.handleSubmit(onSubmit)(e)} {...props}>
        {children}
      </form>
    </FormProvider>
  )
}
