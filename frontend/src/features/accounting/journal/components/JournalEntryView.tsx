import { ArrowLeftRight, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { AuditTrail, type AuditEntry } from '@/components/shared/AuditTrail'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { formatDate, formatDateTime, useIntlLocale } from '@/lib/datetime'
import { formatDecimalDisplay } from '@/lib/money'
import { usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { amountOf, balanceOf } from '../lib/balance'
import type { JournalEntry, JournalLine } from '../types'
import { EntryStatusBadge } from './EntryStatusBadge'
import { accountLabel, refLabel } from '../lib/labels'
import { ReverseDialog } from './ReverseDialog'

const BASE = '/accounting/journal-entries'

/**
 * The activity log the API sends (it names the causer by id only, shown as `userLabel`), or the
 * entry's own create/post stamps when there is none.
 */
function auditEntries(entry: JournalEntry, userLabel: string): AuditEntry[] {
  const named = (id: string | null | undefined) => (id ? { id, name: userLabel } : null)
  if (entry.audit?.length)
    return entry.audit.map((a) =>
      a.causer && !a.causer.name ? { ...a, causer: { ...a.causer, name: userLabel } } : a,
    )
  const out: AuditEntry[] = []
  if (entry.posted_at) {
    out.push({
      id: `${entry.id}-posted`,
      event: 'updated',
      description: 'posted',
      causer: named(entry.posted_by),
      created_at: entry.posted_at,
      properties: {
        attributes: { status: 'posted', number: entry.number },
        old: { status: 'draft' },
      },
    })
  }
  if (entry.created_at) {
    out.push({
      id: `${entry.id}-created`,
      event: 'created',
      causer: named(entry.created_by),
      created_at: entry.created_at,
      properties: null,
    })
  }
  return out
}

/** Read-only posted (or reversed) entry with its links, totals and audit trail. */
export function JournalEntryView({ entry }: { entry: JournalEntry }) {
  const { t } = useTranslation('accountingJournal')
  const locale = useIntlLocale()
  const navigate = useNavigate()
  const canReverse = usePermission('accounting.entries.reverse')
  const [reverseOpen, setReverseOpen] = useState(false)
  const lines = [...entry.lines].sort((a, b) => a.line_no - b.line_no)
  const totals = balanceOf(lines)
  const money = (v: string | null) =>
    v && !amountOf(v).isZero() ? formatDecimalDisplay(v, { locale }) : ''
  const hasFx = lines.some((l) => l.currency_code)
  const dimension = (l: JournalLine) =>
    [l.party, l.cost_center, l.project].filter((r) => r).map((r) => (r ? refLabel(r) : ''))

  const reversesLink =
    entry.reverses ?? (entry.reverses_id ? { id: entry.reverses_id, number: null } : null)
  const reversedByLink =
    entry.reversed_by ?? (entry.reversed_by_id ? { id: entry.reversed_by_id, number: null } : null)

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-6">
      <PageHeader
        title={t('view.title', { number: entry.number ?? t('view.noNumber') })}
        description={entry.description ?? undefined}
        breadcrumbs={[
          { label: t('nav.accounting') },
          { label: t('list.title'), to: BASE },
          { label: entry.number ?? t('view.noNumber') },
        ]}
        meta={<EntryStatusBadge status={entry.status} />}
        actions={
          entry.status === 'posted' && canReverse ? (
            <Button type="button" variant="secondary" onClick={() => setReverseOpen(true)}>
              <Undo2 aria-hidden="true" />
              {t('reverse.action')}
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <dl className="grid gap-3 rounded-lg border border-border bg-surface p-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t('fields.entryDate')}</dt>
              <dd>{formatDate(entry.entry_date, locale)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('fields.entryType')}</dt>
              <dd>{t(`entryType.${entry.entry_type}`)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('view.postedAt')}</dt>
              <dd>{entry.posted_at ? formatDateTime(entry.posted_at, locale) : '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t('fields.source')}</dt>
              <dd>{entry.source_type ?? t('view.manual')}</dd>
            </div>
          </dl>
          {(reversesLink ?? reversedByLink) && (
            <div
              role="note"
              className="flex flex-wrap items-center gap-2 rounded-md border border-info/40 bg-info-soft px-3 py-2 text-sm text-info-soft-foreground"
            >
              <ArrowLeftRight className="size-4" aria-hidden="true" />
              {reversesLink && (
                <span>
                  {t('view.reverses')}{' '}
                  <Link className="font-medium underline" to={`${BASE}/${reversesLink.id}`}>
                    {reversesLink.number ?? t('view.openEntry')}
                  </Link>
                </span>
              )}
              {reversedByLink && (
                <span>
                  {t('view.reversedBy')}{' '}
                  <Link className="font-medium underline" to={`${BASE}/${reversedByLink.id}`}>
                    {reversedByLink.number ?? t('view.openEntry')}
                  </Link>
                </span>
              )}
              {entry.reversal_reason && (
                <span className="text-muted-foreground">
                  · {t('view.reason')}: {entry.reversal_reason}
                </span>
              )}
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full text-table" aria-label={t('lines.title')}>
              <thead className="bg-surface-sunken text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="h-row px-2 text-right font-medium">
                    #
                  </th>
                  <th scope="col" className="px-2 text-left font-medium">
                    {t('lines.account')}
                  </th>
                  <th scope="col" className="px-2 text-left font-medium">
                    {t('lines.description')}
                  </th>
                  <th scope="col" className="px-2 text-left font-medium">
                    {t('lines.dimensions')}
                  </th>
                  {hasFx && (
                    <th scope="col" className="px-2 text-right font-medium">
                      {t('lines.fxAmount')}
                    </th>
                  )}
                  <th scope="col" className="px-2 text-right font-medium">
                    {t('lines.debit')}
                  </th>
                  <th scope="col" className="px-2 text-right font-medium">
                    {t('lines.credit')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t border-border align-top">
                    <td className="px-2 py-1.5 text-right text-xs text-muted-foreground">
                      {l.line_no}
                    </td>
                    <td className="px-2 py-1.5">
                      {l.account ? accountLabel(l.account) : l.account_id}
                    </td>
                    <td className="px-2 py-1.5">{l.description}</td>
                    <td className="px-2 py-1.5 text-xs text-muted-foreground">
                      {dimension(l).join(' · ')}
                    </td>
                    {hasFx && (
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {l.currency_code && l.fx_amount
                          ? `${formatDecimalDisplay(l.fx_amount, { locale })} ${l.currency_code} × ${formatDecimalDisplay(l.fx_rate ?? '', { locale, minFraction: 4, maxFraction: 6 })}`
                          : ''}
                      </td>
                    )}
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(l.debit)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{money(l.credit)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-surface-sunken font-semibold">
                <tr>
                  <th scope="row" colSpan={hasFx ? 5 : 4} className="px-2 py-2 text-right">
                    {t('balance.totals')}
                  </th>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatDecimalDisplay(totals.debit.toFixed(2), { locale })}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {formatDecimalDisplay(totals.credit.toFixed(2), { locale })}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        <aside className="space-y-2">
          <h2 className="text-sm font-semibold">{t('view.audit')}</h2>
          <AuditTrail
            entries={auditEntries(entry, t('view.user'))}
            fieldLabels={{ status: t('fields.status'), number: t('fields.number') }}
            formatValue={(field, value) =>
              field === 'status' &&
              typeof value === 'string' &&
              ['draft', 'posted', 'reversed'].includes(value)
                ? t(`status.${value as 'draft'}`)
                : typeof value === 'string'
                  ? value
                  : value === null || value === undefined
                    ? ''
                    : JSON.stringify(value)
            }
          />
        </aside>
      </div>
      <ReverseDialog
        entry={entry}
        open={reverseOpen}
        onOpenChange={setReverseOpen}
        onReversed={(reversal) => {
          platform.notify.success(t('reverse.done', { number: reversal.number ?? '' }))
          void navigate(`${BASE}/${reversal.id}`)
        }}
      />
    </div>
  )
}
