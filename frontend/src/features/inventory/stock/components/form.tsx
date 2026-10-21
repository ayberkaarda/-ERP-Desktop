import { useId, type ComponentProps, type ReactNode } from 'react'
import { Controller, useFormContext, type FieldPath, type FieldValues } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { FormField } from '@/components/shared/form'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { translateMessage } from '@/lib/forms'
import { cn } from '@/lib/utils'
import { NativeSelect, type NativeSelectOption } from './common'

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

export function TextAreaField<T extends FieldValues, N extends FieldPath<T>>({
  maxLength,
  disabled,
  ...props
}: BaseFieldProps<T, N> & { maxLength?: number; disabled?: boolean }) {
  return (
    <FormField<T, N>
      {...props}
      render={({ field, control }) => (
        <Textarea
          {...control}
          name={field.name}
          ref={field.ref}
          maxLength={maxLength}
          disabled={disabled}
          rows={2}
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
  disabled,
  ...props
}: BaseFieldProps<T, N> & { options: readonly NativeSelectOption[]; disabled?: boolean }) {
  return (
    <FormField<T, N>
      {...props}
      render={({ field, control }) => (
        <NativeSelect
          {...control}
          name={field.name}
          ref={field.ref}
          options={options}
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
  className,
}: {
  name: FieldPath<T>
  label: string
  description?: ReactNode
  disabled?: boolean
  className?: string
}) {
  const { control } = useFormContext<T>()
  const { i18n } = useTranslation('common')
  const id = useId()
  const errorId = `${id}-error`
  const helpId = `${id}-help`
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const message = translateMessage(i18n, fieldState.error?.message)
        return (
          <div className={cn('space-y-1', className)}>
            <div className="flex items-start gap-2 text-sm">
              <Checkbox
                id={id}
                name={field.name}
                ref={field.ref}
                disabled={disabled}
                aria-invalid={message ? true : undefined}
                aria-describedby={
                  [description ? helpId : null, message ? errorId : null]
                    .filter(Boolean)
                    .join(' ') || undefined
                }
                checked={Boolean(field.value)}
                onChange={(e) => field.onChange(e.target.checked)}
                onBlur={field.onBlur}
                className="mt-0.5"
              />
              <div>
                <label htmlFor={id} className="font-medium">
                  {label}
                </label>
                {description && (
                  <p id={helpId} className="text-xs text-muted-foreground">
                    {description}
                  </p>
                )}
              </div>
            </div>
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
