import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { PageHeader } from '@/components/shared/PageHeader'
import { Button } from '@/components/ui/button'
import { platform } from '@/platform'
import { PartyLoadState } from '../components/PartyLoadState'
import { PartyForm } from '../components/PartyForm'
import { PartyTabs } from '../components/PartyTabs'
import { VersionConflictDialog } from '../components/VersionConflictDialog'
import { isVersionConflict, useParty, useUpdateParty } from '../hooks/useParties'
import { formValuesToInput, partyToFormValues } from '../schemas/party'
import type { Party } from '../types'

export function PartyEditPage() {
  const { t } = useTranslation('parties')
  const { partyId } = useParams()
  const navigate = useNavigate()
  const party = useParty(partyId)
  const update = useUpdateParty()
  const [conflict, setConflict] = useState(false)
  // Bumped on reload so the form remounts with the server's values.
  const [formKey, setFormKey] = useState(0)
  // The edit session: the copy the form was opened from. Saves send its version, never the one
  // a background refetch brought in, so concurrent changes surface as a conflict.
  const [session, setSession] = useState<Party | null>(null)
  if (party.data && session?.id !== party.data.id) setSession(party.data)

  if (!party.data || !session) return <PartyLoadState query={party} />
  const p = session
  const changedElsewhere = party.data.version !== session.version
  const reload = async () => {
    const fresh = await party.refetch()
    if (fresh.data) setSession(fresh.data)
    update.reset()
    setFormKey((k) => k + 1)
  }
  const detailPath = `/parties/${encodeURIComponent(p.id)}`

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <PageHeader
        title={t('form.editTitle')}
        description={
          <>
            <span className="font-code">{p.code}</span> · {p.name}
          </>
        }
        breadcrumbs={[
          { label: t('title'), to: '/parties' },
          { label: p.name, to: detailPath },
          { label: t('form.editTitle') },
        ]}
      />
      <div className="max-w-3xl space-y-4">
        <div role="status">
          {changedElsewhere && (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm text-warning-soft-foreground">
              <p className="flex-1">{t('form.changedElsewhere')}</p>
              <Button size="sm" variant="secondary" onClick={() => void reload()}>
                {t('conflict.reload')}
              </Button>
            </div>
          )}
        </div>
        <PartyForm
          key={`${p.id}:${formKey}`}
          defaultValues={partyToFormValues(p)}
          excludeId={p.id}
          submitLabel={t('form.save')}
          submitting={update.isPending}
          serverError={isVersionConflict(update.error) ? null : update.error}
          onCancel={() => void navigate(detailPath)}
          onSubmit={(values) =>
            update.mutate(
              { id: p.id, patch: { ...formValuesToInput(values, p), version: p.version } },
              {
                onSuccess: (saved) => {
                  setSession(saved)
                  platform.notify.success(t('form.saved'))
                },
                onError: (error) => {
                  if (isVersionConflict(error)) setConflict(true)
                },
              },
            )
          }
        />
      </div>
      <PartyTabs party={party.data} canEdit />
      <VersionConflictDialog open={conflict} onOpenChange={setConflict} onReload={reload} />
    </div>
  )
}
