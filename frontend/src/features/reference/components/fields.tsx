import type { ReactNode } from 'react'
import type { FieldPath, FieldValues } from 'react-hook-form'
import { DateInput, DecimalInput, FormField } from '@/components/shared/form'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { NativeSelect, type NativeSelectOption } from './NativeSelect'

// Thin react-hook-form bindings so the dialogs stay declarative. Every control keeps its value
// as a string; the schemas module turns form values into API payloads.

interface BaseFieldProps<T extends FieldValues> {
  name: FieldPath<T>
  label: string
  required?: boolean
  description?: ReactNode
  className?: string
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

export function TextField<T extends FieldValues>({
  maxLength,
  autoFocus,
  uppercase,
  ...base
}: BaseFieldProps<T> & { maxLength?: number; autoFocus?: boolean; uppercase?: boolean }) {
  return (
    <FormField<T, FieldPath<T>>
      {...base}
      render={({ field, control }) => (
        <Input
          {...control}
          name={field.name}
          ref={field.ref}
          onBlur={field.onBlur}
          value={text(field.value)}
          maxLength={maxLength}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(e) =>
            field.onChange(uppercase ? e.target.value.toUpperCase() : e.target.value)
          }
        />
      )}
    />
  )
}

export function CheckField<T extends FieldValues>(props: BaseFieldProps<T>) {
  return (
    <FormField<T, FieldPath<T>>
      {...props}
      render={({ field, control }) => (
        <Checkbox
          {...control}
          name={field.name}
          ref={field.ref}
          onBlur={field.onBlur}
          checked={field.value === true}
          onChange={(e) => field.onChange(e.target.checked)}
        />
      )}
    />
  )
}

export function SelectField<T extends FieldValues>({
  options,
  emptyLabel,
  ...base
}: BaseFieldProps<T> & { options: readonly NativeSelectOption[]; emptyLabel?: string }) {
  return (
    <FormField<T, FieldPath<T>>
      {...base}
      render={({ field, control }) => (
        <NativeSelect
          {...control}
          name={field.name}
          ref={field.ref}
          onBlur={field.onBlur}
          value={text(field.value)}
          options={options}
          emptyLabel={emptyLabel}
          onChange={(e) => field.onChange(e.target.value)}
        />
      )}
    />
  )
}

export function DecimalField<T extends FieldValues>({
  scale,
  displayMinFraction,
  suffix,
  ...base
}: BaseFieldProps<T> & { scale: number; displayMinFraction?: number; suffix?: ReactNode }) {
  return (
    <FormField<T, FieldPath<T>>
      {...base}
      render={({ field, control }) => (
        <DecimalInput
          {...control}
          name={field.name}
          ref={field.ref}
          onBlur={field.onBlur}
          value={text(field.value)}
          scale={scale}
          displayMinFraction={displayMinFraction ?? Math.min(scale, 2)}
          suffix={suffix}
          onChange={field.onChange}
        />
      )}
    />
  )
}

export function DateField<T extends FieldValues>(base: BaseFieldProps<T>) {
  return (
    <FormField<T, FieldPath<T>>
      {...base}
      render={({ field, control }) => (
        <DateInput
          {...control}
          name={field.name}
          ref={field.ref}
          onBlur={field.onBlur}
          value={text(field.value)}
          onChange={field.onChange}
        />
      )}
    />
  )
}
