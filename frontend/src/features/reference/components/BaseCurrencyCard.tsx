import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { usePermission } from '@/lib/permissions'
import { isApiError, platform } from '@/platform'
import { useBaseCurrency, useSetBaseCurrency } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import { LoadError } from './LoadError'
import { CurrencySelect } from './selects'

/** Reads and writes `company.base_currency` through the Settings API. */
export function BaseCurrencyCard() {
  const t = useRefT()
  const canEdit = usePermission(REF_PERMISSIONS.settings.manage)
  const current = useBaseCurrency()
  const save = useSetBaseCurrency()
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const value = draft ?? current.data ?? null
  const dirty = draft !== null && draft !== current.data

  const submit = () => {
    if (!value) return
    setError(null)
    save.mutate(value, {
      onSuccess: () => {
        setDraft(null)
        platform.notify.success(t('settings.saved'))
      },
      onError: (e) => setError(isApiError(e) ? e.message : t('errors.generic')),
    })
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t('settings.baseCurrency.title')}</CardTitle>
          <CardDescription>{t('settings.baseCurrency.description')}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="max-w-sm space-y-3">
        {current.isLoading && <Skeleton className="h-9 w-full" aria-label={t('states.loading')} />}
        {current.isError && <LoadError onRetry={() => void current.refetch()} />}
        {current.isSuccess && (
          <form
            noValidate
            className="space-y-3"
            aria-label={t('settings.baseCurrency.title')}
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <FieldShell
              label={t('settings.baseCurrency.label')}
              description={t('settings.baseCurrency.hint')}
              error={error ?? undefined}
            >
              {(control) => (
                <CurrencySelect
                  {...control}
                  value={value}
                  disabled={!canEdit}
                  onChange={(code) => setDraft(code)}
                />
              )}
            </FieldShell>
            {canEdit ? (
              <Button type="submit" disabled={!dirty || !value || save.isPending}>
                {save.isPending && <Loader2 className="animate-spin" aria-hidden="true" />}
                {t('actions.save')}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">{t('settings.readOnly')}</p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
