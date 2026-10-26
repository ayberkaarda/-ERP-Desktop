import { cn } from '@/lib/utils'

// Geometry shared with src/assets/brand/*.svg and public/favicon.svg; change all together.
const ARCH =
  'M5 44V30A19 19 0 0 1 16.14 12.7L18.77 20.33A11 11 0 0 0 13 30V44ZM43 44V30A19 19 0 0 0 31.86 12.7L29.23 20.33A11 11 0 0 1 35 30V44Z'
const KEY = 'M20.26 19.13L16.25 7.5H31.75L27.74 19.13Z'
const WORD =
  'M1.6 2V25M12.5 9L3.2 17.2M6.6 14.4L13 25M18.5 17H31.5A6.5 6.5 0 1 0 29.6 21.6M36.5 9L43.7 25M50.9 9L41 31M65.7 12.4C64.8 11.2 63.2 10.6 61 10.6C58.1 10.6 56.1 11.9 56.1 13.8C56.1 18.6 66.1 15.6 66.1 20.4C66.1 22.3 64.1 23.4 61 23.4C58.5 23.4 56.5 22.6 55.3 21.2M74.3 3.5V19.8C74.3 22.6 75.7 23.4 78.1 23.4H80.3M70.1 10.6H80.1M97.1 17A6.5 6.5 0 1 1 84.1 17A6.5 6.5 0 1 1 97.1 17ZM102.9 9V25M102.9 16.2C102.9 12.6 105.7 10.6 109 10.6C112.5 10.6 114.9 12.6 114.9 16.2V25M120.7 17H133.7A6.5 6.5 0 1 0 131.8 21.6'

interface BrandProps {
  className?: string
  /** Arch color; defaults to the primary token so it follows the theme. */
  archClassName?: string
}

export function KeystoneMark({ className, archClassName = 'fill-primary' }: BrandProps) {
  return (
    <svg viewBox="0 2 48 48" className={cn('shrink-0', className)} aria-hidden="true">
      <path className={archClassName} d={ARCH} />
      <path className="fill-brand-accent" d={KEY} />
    </svg>
  )
}

export function KeystoneLogo({ className, archClassName = 'fill-primary' }: BrandProps) {
  return (
    <svg
      viewBox="0 2 196 48"
      className={cn('shrink-0', className)}
      role="img"
      aria-label="Keystone"
    >
      <path className={archClassName} d={ARCH} />
      <path className="fill-brand-accent" d={KEY} />
      <path
        d={WORD}
        transform="translate(56 7.5) scale(0.98)"
        fill="none"
        stroke="currentColor"
        strokeWidth={3.2}
        strokeLinejoin="round"
      />
    </svg>
  )
}
