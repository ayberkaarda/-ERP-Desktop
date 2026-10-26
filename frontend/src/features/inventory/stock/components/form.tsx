import type { ReactNode } from 'react'
import type { FieldPath, FieldValues } from 'react-hook-form'
import { FormField } from '@/components/shared/form'
import { NativeSelect, type NativeSelectOption } from './common'

interface SelectFieldProps<T extends FieldValues, N extends FieldPath<T>> {
  name: N
  label: string
  required?: boolean
  description?: ReactNode
  className?: string
  options: readonly NativeSelectOption[]
  disabled?: boolean
}

/** Native select bound to a react-hook-form field (label, help text and error from FormField). */
export function SelectField<T extends FieldValues, N extends FieldPath<T>>({
  options,
  disabled,
  ...props
}: SelectFieldProps<T, N>) {
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
