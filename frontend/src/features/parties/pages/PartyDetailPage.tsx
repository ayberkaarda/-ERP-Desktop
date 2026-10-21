import { Pencil, Power, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { useIntlLocale } from '@/lib/datetime'
import { readServerError } from '@/lib/forms/serverErrors'
import { formatMoney } from '@/lib/money'
import { Can, usePermission } from '@/lib/permissions'
import { platform } from '@/platform'
import { PartyLoadState } from '../components/PartyLoadState'
import { PartyTabs } from '../components/PartyTabs'
import { PartyStatusBadge, RoleBadges } from '../components/RoleBadges'
import { VersionConflictDialog } from '../components/VersionConflictDialog'
import { isVersionConflict, useDeleteParty, useParty, useUpdateParty } from '../hooks/useParties'
import { countryName } from '../lib/options'
import { taxNumberKind } from '../lib/taxNumber'

export function PartyDetailPage() {
  const { t } = useTranslation('parties')
  const locale = useIntlLocale()
  const { partyId } = useParams()
  const navigate = useNavigate()
  const party = useParty(partyId)
  const update = useUpdateParty()
  const del = useDeleteParty()
  const canUpdate = usePermission('parties.update')
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  if (!party.data) return <PartyLoadState query={party} />
  const p = party.data
  const none = t('detail.none')

  const toggleActive = () =>
    update.mutate(
      { id: p.id, patch: { is_active: !p.is_active, version: p.version } },
      {
        onSuccess: (saved) =>
          platform.notify.success(
            saved.is_active ? t('detail.activated') : t('detail.deactivated'),
          ),
        onError: (error) => {
          if (isVersionConflict(error)) setConflict(true)
          else platform.notify.error(readServerError(error)?.message ?? t('form.saveFailed'))
        },
      },
    )

  const kind = taxNumberKind(p.country, p.type)
  const summary: [string, ReactNode][] = [
    [t('fields.code'), <span className="font-code">{p.code}</span>],
    [t('fields.legal_name'), p.legal_name ?? none],
    [t('fields.type'), t(`types.${p.type}`)],
    [t('fields.roles'), <RoleBadges roles={p.roles} />],
    [
      t('fields.tax_number'),
      p.tax_number ? (
        <span>
          <span className="font-code">{p.tax_number}</span>{' '}
          <span className="text-xs text-muted-foreground">({t(`hints.${kind}`)})</span>
        </span>
      ) : (
        none
      ),
    ],
    [t('fields.tax_office'), p.tax_office ?? none],
    [t('fields.country'), `${countryName(p.country, locale)} (${p.country})`],
    [t('fields.default_currency_code'), p.default_currency_code ?? none],
    [
      t('fields.risk_limit'),
      p.risk_limit
        ? formatMoney(
            p.risk_limit,
            p.risk_currency_code ?? p.default_currency_code ?? 'TRY',
            locale,
          )
        : none,
    ],
    [t('fields.tags'), p.tags.length ? p.tags.join(', ') : none],
    [t('fields.notes'), p.notes ?? none],
  ]

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title={p.name}
        meta={<PartyStatusBadge active={p.is_active} />}
        description={<span className="font-code">{p.code}</span>}
        breadcrumbs={[{ label: t('title'), to: '/parties' }, { label: p.name }]}
        actions={
          <>
            <Can permission="parties.delete">
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash2 aria-hidden="true" />
                {t('detail.delete')}
              </Button>
            </Can>
            <Can permission="parties.update">
              <Button variant="secondary" disabled={update.isPending} onClick={toggleActive}>
                <Power aria-hidden="true" />
                {p.is_active ? t('detail.deactivate') : t('detail.activate')}
              </Button>
              <Button asChild>
                <Link to={`/parties/${encodeURIComponent(p.id)}/edit`}>
                  <Pencil aria-hidden="true" />
                  {t('detail.edit')}
                </Link>
              </Button>
            </Can>
          </>
        }
      />
      <section
        aria-labelledby="party-summary"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="party-summary" className="mb-3 text-sm font-semibold">
          {t('detail.summary')}
        </h2>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {summary.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-sm break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <PartyTabs party={p} canEdit={canUpdate} withRecordTabs />
      <VersionConflictDialog
        open={conflict}
        onOpenChange={setConflict}
        onReload={async () => {
          update.reset()
          await party.refetch()
        }}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('detail.deleteTitle')}
        description={t('detail.deleteBody', { name: p.name })}
        confirmLabel={t('detail.delete')}
        onConfirm={async () => {
          try {
            await del.mutateAsync(p.id)
          } catch (error) {
            platform.notify.error(readServerError(error)?.message ?? t('form.saveFailed'))
            throw error
          }
          platform.notify.success(t('detail.deleted'))
          void navigate('/parties', { replace: true })
        }}
      />
    </div>
  )
}
