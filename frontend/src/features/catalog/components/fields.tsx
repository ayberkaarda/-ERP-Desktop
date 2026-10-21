import type { ComponentProps, ReactNode } from 'react'
import { Controller, useFormContext, type FieldPath, type FieldValues } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { DateInput, DecimalInput, FormField } from '@/components/shared/form'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { selectClass } from '../lib/ui'

interface BaseFieldProps<T extends FieldValues, N extends FieldPath<T>> {
  name: N
  label: string
  required?: boolean
  description?: ReactNode
  className?: string
  disabled?: boolean
}

export function TextField<T extends FieldValues, N extends FieldPath<T>>({
  input,
  disabled,
  ...props
}: BaseFieldProps<T, N> & { input?: Omit<ComponentProps<'input'>, 'name'> }) {
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
          onChange={field.onChange}
          onBlur={field.onBlur}
          disabled={disabled}
        />
      )}
    />
  )
}

export function DecimalField<T extends FieldValues, N extends FieldPath<T>>({
  scale,
  suffix,
  disabled,
  ...props
}: BaseFieldProps<T, N> & { scale: number; suffix?: ReactNode }) {
  return (
    <FormField<T, N>
      {...props}
      render={({ field, control }) => (
        <DecimalInput
          {...control}
          ref={field.ref}
          scale={scale}
          displayMinFraction={0}
          suffix={suffix}
          value={field.value ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          disabled={disabled}
        />
      )}
    />
  )
}

export function DateField<T extends FieldValues, N extends FieldPath<T>>({
  disabled,
  ...props
}: BaseFieldProps<T, N>) {
  return (
    <FormField<T, N>
      {...props}
      render={({ field, control }) => (
        <DateInput
          {...control}
          ref={field.ref}
          value={field.value ?? ''}
          onChange={field.onChange}
          onBlur={field.onBlur}
          disabled={disabled}
        />
      )}
    />
  )
}

/** Native select: fast keyboard use (type-ahead) and no portal, for short fixed lists. */
export function SelectField<T extends FieldValues, N extends FieldPath<T>>({
  options,
  disabled,
  onValueChange,
  ...props
}: BaseFieldProps<T, N> & {
  options: readonly { value: string; label: string }[]
  /** Runs after the form value changed (dependent fields reset here). */
  onValueChange?: (value: string) => void
}) {
  return (
    <FormField<T, N>
      {...props}
      render={({ field, control }) => (
        <select
          {...control}
          name={field.name}
          ref={field.ref}
          className={selectClass}
          value={field.value}
          onChange={(e) => {
            field.onChange(e)
            onValueChange?.(e.target.value)
          }}
          onBlur={field.onBlur}
          disabled={disabled}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    />
  )
}

/** Checkbox with its label to the right (DESIGN.md: toggles read as sentences). */
export function CheckboxField<T extends FieldValues, N extends FieldPath<T>>({
  name,
  label,
  description,
  className,
  disabled,
}: BaseFieldProps<T, N>) {
  const { control } = useFormContext<T>()
  const id = `cb-${name}`
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <div className={cn('flex items-start gap-2', className)}>
          <Checkbox
            id={id}
            name={field.name}
            ref={field.ref}
            className="mt-0.5"
            checked={Boolean(field.value)}
            onChange={(e) => field.onChange(e.target.checked)}
            onBlur={field.onBlur}
            disabled={disabled}
            aria-describedby={description ? `${id}-help` : undefined}
          />
          <div className="space-y-0.5">
            <label htmlFor={id} className="text-sm font-medium">
              {label}
            </label>
            {description && (
              <p id={`${id}-help`} className="text-xs text-muted-foreground">
                {description}
              </p>
            )}
          </div>
        </div>
      )}
    />
  )
}

/** Yes/No cell text for tables. */
export function YesNo({ value }: { value: boolean }) {
  const { t } = useTranslation('catalog')
  return <span>{value ? t('common.yes') : t('common.no')}</span>
}
