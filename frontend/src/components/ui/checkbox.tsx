import { useEffect, useRef, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'

interface CheckboxProps extends Omit<ComponentProps<'input'>, 'type'> {
  indeterminate?: boolean
}

/** Native checkbox: keeps form semantics and Space toggling; `indeterminate` is DOM-only state. */
export function Checkbox({ className, indeterminate = false, ...props }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return (
    <input
      ref={ref}
      type="checkbox"
      className={cn(
        'size-4 shrink-0 cursor-pointer rounded-xs border border-border-strong accent-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
