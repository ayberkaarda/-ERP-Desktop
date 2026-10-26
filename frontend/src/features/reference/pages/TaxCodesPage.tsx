import { useQuery } from '@tanstack/react-query'
import { Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, toIsoDate } from '@/lib/datetime'
import { useIntlLocale } from '@/lib/datetime/locale'
import { Can, usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { taxCodesApi } from '../api/resources'
import { FilterDate } from '../components/FilterDate'
import { LoadError } from '../components/LoadError'
import { PageShell } from '../components/PageShell'
import { TaxCodeDialog } from '../components/TaxCodeDialog'
import { useEditor } from '../components/useEditor'
import { useRemoveTaxCode } from '../hooks/useReference'
import { refKeys } from '../hooks/keys'
import { useRefT } from '../i18n'
import { REF_PERMISSIONS } from '../permissions'
import type { TaxCode } from '../types'
import { groupByType, isGlobalTaxCode, taxRateLabel, taxValidity, type TaxValidity } from '../utils'

const VALIDITY_TONE: Record<TaxValidity, NonNullable<BadgeProps['tone']>> = {
  active: 'success',
  upcoming: 'info',
  expired: 'neutral',
  inactive: 'neutral',
}

function TaxRow({
  code,
  today,
  canUpdate,
  canDelete,
  onEdit,
  onDelete,
}: {
  code: TaxCode
  today: string
  canUpdate: boolean
  canDelete: boolean
  onEdit: (code: TaxCode) => void
  onDelete: (code: TaxCode) => Promise<unknown>
}) {
  const t = useRefT()
  const locale = useIntlLocale()
  const global = isGlobalTaxCode(code)
  const validity = taxValidity(code, today)
  const period =
    code.effective_from || code.effective_to
      ? `${code.effective_from ? formatDate(code.effective_from, locale) : '…'} – ${
          code.effective_to ? formatDate(code.effective_to, locale) : '…'
        }`
      : t('taxCodes.noPeriod')
  return (
    <tr>
      <th scope="row" className="px-3 py-2 text-left font-code font-medium">
        <span className="inline-flex items-center gap-1.5">
          {global && (
            <span title={t('taxCodes.globalHint')}>
              <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{t('taxCodes.global')}</span>
            </span>
          )}
          {code.code}
        </span>
      </th>
      <td className="px-3 py-2">{code.name}</td>
      <td className="px-3 py-2 text-right font-code">{taxRateLabel(code) ?? '—'}</td>
      <td className="px-3 py-2 whitespace-nowrap">{period}</td>
      <td className="px-3 py-2">
        <Badge tone={VALIDITY_TONE[validity]}>{t(`taxCodes.validity.${validity}`)}</Badge>
      </td>
      <td className="px-3 py-2">
        {!global && (canUpdate || canDelete) && (
          <div className="flex justify-end gap-1">
            {canUpdate && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('actions.editNamed', { name: code.code })}
                onClick={() => onEdit(code)}
              >
                <Pencil aria-hidden="true" />
              </Button>
            )}
            {canDelete && (
              <ConfirmDialog
                title={t('actions.deleteTitle')}
                description={t('actions.deleteBody', { name: code.code })}
                confirmLabel={t('actions.delete')}
                trigger={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('actions.deleteNamed', { name: code.code })}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                }
                onConfirm={async () => {
                  try {
                    await onDelete(code)
                  } catch (error) {
                    platform.notify.error(
                      error instanceof Error ? error.message : t('errors.generic'),
                    )
                    throw error
                  }
                }}
              />
            )}
          </div>
        )}
      </td>
    </tr>
  )
}

export function TaxCodesPage() {
  const t = useRefT()
  const canUpdate = usePermission(REF_PERMISSIONS.taxCodes.update)
  const canDelete = usePermission(REF_PERMISSIONS.taxCodes.delete)
  const editor = useEditor<TaxCode>()
  const remove = useRemoveTaxCode()
  const [asOf, setAsOf] = useState(() => toIsoDate(new Date()))
  const [search, setSearch] = useState('')
  const [onlyEffective, setOnlyEffective] = useState(true)

  const all = useQuery({
    queryKey: refKeys.full('tax-codes', 'page'),
    queryFn: ({ signal }) => taxCodesApi.all({}, signal),
  })

  const groups = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase()
    const rows = (all.data ?? []).filter((r) => {
      if (needle && !`${r.code} ${r.name}`.toLocaleLowerCase().includes(needle)) return false
      return !onlyEffective || taxValidity(r, asOf) === 'active'
    })
    return groupByType(rows)
  }, [all.data, search, onlyEffective, asOf])

  return (
    <PageShell
      title={t('taxCodes.title')}
      description={t('taxCodes.subtitle')}
      actions={
        <Can permission={REF_PERMISSIONS.taxCodes.create}>
          <Button onClick={editor.openNew}>
            <Plus aria-hidden="true" />
            {t('taxCodes.new')}
          </Button>
        </Can>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="space-y-1 text-xs text-muted-foreground">
          <span>{t('taxCodes.search')}</span>
          <Input
            className="w-64"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <div className="space-y-1 text-xs text-muted-foreground">
          <span id="tax-asof-label">{t('taxCodes.asOf')}</span>
          <FilterDate
            labelledBy="tax-asof-label"
            className="w-40"
            value={asOf}
            onCommit={(value) => value !== '' && setAsOf(value)}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <Checkbox checked={onlyEffective} onChange={(e) => setOnlyEffective(e.target.checked)} />
          {t('taxCodes.onlyEffective')}
        </label>
      </div>

      {all.isLoading && <Skeleton className="h-48 w-full" aria-label={t('states.loading')} />}
      {all.isError && <LoadError error={all.error} onRetry={() => void all.refetch()} />}
      {all.data && groups.length === 0 && <EmptyState title={t('taxCodes.empty')} compact />}

      <div className="space-y-6">
        {groups.map((group) => (
          <section key={group.type} aria-labelledby={`tax-group-${group.type}`}>
            <h2 id={`tax-group-${group.type}`} className="mb-2 text-sm font-semibold">
              {t(`taxCodes.types.${group.type}`)}{' '}
              <span className="font-normal text-muted-foreground">({group.rows.length})</span>
            </h2>
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">{t(`taxCodes.types.${group.type}`)}</caption>
                <thead className="bg-surface-sunken text-left text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('fields.code')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('fields.name')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">
                      {t('taxCodes.rate')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('taxCodes.period')}
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      {t('fields.status')}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      <span className="sr-only">{t('fields.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {group.rows.map((code) => (
                    <TaxRow
                      key={code.id}
                      code={code}
                      today={asOf}
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      onEdit={editor.openEdit}
                      onDelete={(c) => remove.mutateAsync({ id: c.id, version: c.version })}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {editor.target.mode !== 'closed' && (
        <TaxCodeDialog
          record={editor.target.mode === 'edit' ? editor.target.record : null}
          onClose={editor.close}
        />
      )}
    </PageShell>
  )
}
