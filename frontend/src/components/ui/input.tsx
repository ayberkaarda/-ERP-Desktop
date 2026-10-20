import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-control w-full min-w-0 rounded-md border border-input bg-surface px-3 text-sm shadow-xs',
        'placeholder:text-subtle-foreground transition-[border-color,box-shadow] duration-150',
        'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20',
        'aria-invalid:border-danger aria-invalid:ring-danger/15 aria-invalid:focus-visible:ring-3',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
