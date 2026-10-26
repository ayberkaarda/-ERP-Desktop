import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export interface NativeSelectOption {
  value: string
  label: string
}

interface NativeSelectProps extends Omit<ComponentProps<'select'>, 'children'> {
  options: readonly NativeSelectOption[]
  /** Leading empty choice (e.g. "no parent"). */
  emptyLabel?: string
}

/** Styled native select: keyboard and screen reader behaviour comes from the platform. */
export function NativeSelect({ options, emptyLabel, className, ...props }: NativeSelectProps) {
  return (
    <select
      className={cn(
        'h-control w-full min-w-0 rounded-md border border-input bg-surface px-3 text-sm shadow-xs',
        'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 focus-visible:outline-none',
        'aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
