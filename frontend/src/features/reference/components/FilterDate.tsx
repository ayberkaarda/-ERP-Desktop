import { useEffect, useRef, useState } from 'react'
import { DateInput } from '@/components/shared/form'
import { INVALID_DATE } from '@/lib/datetime'

const COMMIT_DELAY_MS = 350

interface FilterDateProps {
  /** Id of the element that names this field. */
  labelledBy: string
  /** Committed calendar date or ''. */
  value: string
  /** Called with a valid calendar date or '' (cleared); half-typed text is never passed out. */
  onCommit: (value: string) => void
  min?: string
  max?: string
  className?: string
}

/**
 * DateInput for filters. Typing is kept locally (a partial year such as "19.10.20" is already a
 * valid date) and only the settled value is committed: after a short pause or on blur.
 */
export function FilterDate({ labelledBy, value, onCommit, min, max, className }: FilterDateProps) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (value !== seen) {
    setSeen(value)
    // An outside change (cleared filters) wins, but a half-typed draft is not wiped by echoes.
    if (draft !== INVALID_DATE || value !== '') setDraft(value)
  }

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])

  const commit = (next: string) => {
    cancel()
    if (next !== INVALID_DATE && next !== value) onCommit(next)
  }

  return (
    <DateInput
      aria-labelledby={labelledBy}
      className={className}
      value={draft}
      min={min}
      max={max}
      onChange={(next) => {
        setDraft(next)
        cancel()
        if (next !== INVALID_DATE) timer.current = setTimeout(() => commit(next), COMMIT_DELAY_MS)
      }}
      onBlur={() => commit(draft)}
    />
  )
}
