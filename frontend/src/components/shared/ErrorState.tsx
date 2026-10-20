import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorStateProps {
  variant?: 'error' | 'notFound'
  fullScreen?: boolean
  detail?: string
}

/** Fallen-keystone illustration: the arch without its crown. */
function BrokenArch() {
  return (
    <svg viewBox="0 0 120 80" className="h-20 w-auto" aria-hidden="true">
      <path
        className="fill-border-strong"
        d="M14 76V50a36 36 0 0 1 23.6-33.8l5.9 15.9A19 19 0 0 0 31 50v26ZM106 76V50a36 36 0 0 0-23.6-33.8l-5.9 15.9A19 19 0 0 1 89 50v26Z"
      />
      <path className="fill-brand-accent" d="m50 66 4-12h14l4 12Z" transform="rotate(-14 61 66)" />
      <path className="stroke-border-strong" strokeWidth="2" strokeLinecap="round" d="M4 77h112" />
    </svg>
  )
}

export function ErrorState({ variant = 'error', fullScreen = false, detail }: ErrorStateProps) {
  const { t } = useTranslation()
  const notFound = variant === 'notFound'
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-4 px-6 py-16 text-center',
        fullScreen && 'min-h-dvh',
      )}
    >
      <BrokenArch />
      <div className="max-w-md space-y-1.5">
        <h1 className="text-lg font-semibold">
          {notFound ? t('errors.notFoundTitle') : t('errors.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {notFound ? t('errors.notFoundBody') : t('errors.body')}
        </p>
        {detail && <p className="font-code text-xs text-subtle-foreground">{detail}</p>}
      </div>
      <div className="flex gap-2">
        {!notFound && (
          <Button variant="secondary" onClick={() => window.location.reload()}>
            {t('errors.reload')}
          </Button>
        )}
        <Button asChild>
          <a href="/">{t('common.backHome')}</a>
        </Button>
      </div>
    </div>
  )
}
