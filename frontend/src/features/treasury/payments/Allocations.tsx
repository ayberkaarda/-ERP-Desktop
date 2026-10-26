import { compatibleInvoice, compatibleInstrumentInvoice } from './lib'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { usePermission } from '@/lib/permissions'
import { treasuryApi } from '../shared/api'
import { treasuryKey } from '../shared/keys'
import type { Page, OpenItem, Allocation, Direction } from '../shared/types'
import { Amount, EnumField, ErrorNotice, MoneyField, Panel } from '../shared/ui'
import { useTreasuryCompany, useTreasuryT } from '../shared/hooks'
export function Allocations({
  partyId,
  direction,
  value,
  onChange,
  currency,
  fxRate,
  showRate = true,
}: {
  partyId: string
  direction: Direction
  value: Allocation[]
  onChange: (value: Allocation[]) => void
  currency?: string
  fxRate?: string
  showRate?: boolean
}) {
  const t = useTreasuryT()
  const company = useTreasuryCompany()
  const [module, setModule] = useState<'sales' | 'purchasing'>(
    direction === 'receipt' ? 'sales' : 'purchasing',
  )
  const allowed = usePermission([
    'treasury.open_items.view',
    module === 'sales' ? 'sales.invoices.view' : 'purchasing.invoices.view',
  ])
  const items = useInfiniteQuery({
    queryKey: treasuryKey(company, 'open-items', partyId, module),
    initialPageParam: 1,
    getNextPageParam: (last: Page<OpenItem>) =>
      last.meta.pagination.current_page < last.meta.pagination.last_page
        ? last.meta.pagination.current_page + 1
        : undefined,
    queryFn: ({ signal, pageParam }) => treasuryApi.openItems(partyId, module, pageParam, signal),
    enabled: Boolean(partyId) && allowed,
    retry: false,
  })
  const rows =
    items.data?.pages
      .flatMap((page) => page.data)
      .filter((item) =>
        showRate
          ? compatibleInvoice(item, direction)
          : compatibleInstrumentInvoice(item, direction, currency),
      ) ?? []
  const update = (id: string, changes: Partial<Allocation>) =>
    onChange(value.map((line) => (line.invoice_id === id ? { ...line, ...changes } : line)))
  return (
    <Panel title={t('allocations')}>
      <p className="mb-4 text-sm text-muted-foreground">
        {t(showRate ? 'allocationHelp' : 'instrumentAllocationHelp')}
      </p>
      {!partyId ? (
        <p className="text-sm text-muted-foreground">{t('chooseParty')}</p>
      ) : (
        <>
          <div className="mb-4 max-w-xs">
            <EnumField
              name="invoice"
              value={module}
              onChange={(v) => setModule(v as 'sales' | 'purchasing')}
              options={['sales', 'purchasing']}
            />
          </div>
          {!allowed ? (
            <p role="status">{t('noAccess')}</p>
          ) : (
            <>
              <ErrorNotice error={items.error} reload={() => void items.refetch()} />
              {items.isPending ? (
                <p role="status">{t('loading')}</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('noInvoices')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="p-2">
                          <span className="sr-only">{t('select')}</span>
                        </th>
                        <th className="p-2">{t('invoice')}</th>
                        <th className="p-2">{t('due_date')}</th>
                        <th className="p-2">{t('balance_due')}</th>
                        <th className="p-2">{t('allocation_amount')}</th>
                        {showRate && <th className="p-2">{t('allocation_rate')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((item) => {
                        const line = value.find(
                          (a) => a.invoice_id === item.id && a.invoice_module === item.module,
                        )
                        return (
                          <tr key={item.id} className="border-b border-border/60">
                            <td className="p-2">
                              <Checkbox
                                aria-label={`${t('select')} ${item.number ?? item.id}`}
                                checked={Boolean(line)}
                                onChange={(e) =>
                                  onChange(
                                    e.target.checked
                                      ? [
                                          ...value,
                                          {
                                            invoice_module: item.module,
                                            invoice_id: item.id,
                                            amount: item.balance_due,
                                            fx_rate:
                                              item.currency_code === currency ? (fxRate ?? '') : '',
                                            currency_code: item.currency_code,
                                          },
                                        ]
                                      : value.filter((a) => a.invoice_id !== item.id),
                                  )
                                }
                              />
                            </td>
                            <td className="p-2 font-code">
                              {item.number ?? t('unnumbered')}
                              <span className="block text-xs text-muted-foreground">
                                {item.currency_code} · {item.invoice_type}
                              </span>
                            </td>
                            <td className="p-2">{item.due_date ?? '—'}</td>
                            <td className="p-2">
                              <Amount value={item.balance_due} currency={item.currency_code} />
                            </td>
                            <td className="min-w-36 p-2">
                              {line && (
                                <MoneyField
                                  name="allocation_amount"
                                  value={line.amount}
                                  onChange={(amount) => update(item.id, { amount })}
                                />
                              )}
                            </td>
                            {showRate && (
                              <td className="min-w-36 p-2">
                                {line && (
                                  <MoneyField
                                    name="allocation_rate"
                                    value={line.fx_rate}
                                    onChange={(fx_rate) => update(item.id, { fx_rate })}
                                    scale={6}
                                  />
                                )}
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
          {items.hasNextPage && (
            <Button
              type="button"
              variant="secondary"
              disabled={items.isFetchingNextPage}
              onClick={() => void items.fetchNextPage()}
            >
              {t('next')}
            </Button>
          )}
          {value
            .filter((line) => !rows.some((item) => item.id === line.invoice_id))
            .map((line) => (
              <div
                key={line.invoice_id}
                className="mt-3 flex items-center gap-3 rounded border border-border p-3 text-sm"
              >
                <span className="font-code">{line.invoice_id}</span>
                <span>{line.amount}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onChange(value.filter((a) => a !== line))}
                >
                  {t('remove')}
                </Button>
              </div>
            ))}
        </>
      )}
    </Panel>
  )
}
