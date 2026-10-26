import { cn } from '@/lib/utils'

/** Native <select> styled like Input (same height, focus ring and invalid state). */
export const selectClass = cn(
  'h-control w-full min-w-0 rounded-md border border-input bg-surface px-2.5 text-sm shadow-xs',
  'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20',
  'aria-invalid:border-danger disabled:cursor-not-allowed disabled:opacity-50',
)
