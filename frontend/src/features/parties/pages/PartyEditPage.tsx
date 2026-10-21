import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { PageHeader } from '@/components/shared/PageHeader'
import { platform } from '@/platform'
import { PartyLoadState } from '../components/PartyLoadState'
import { PartyForm } from '../components/PartyForm'
import { PartyTabs } from '../components/PartyTabs'
import { VersionConflictDialog } from '../components/VersionConflictDialog'
import { isVersionConflict, useParty, useUpdateParty } from '../hooks/useParties'
import { formValuesToInput, partyToFormValues } from '../schemas/party'

export function PartyEditPage() {
  const { t } = useTranslation('parties')
  const { partyId } = useParams()
  const navigate = useNavigate()
  const party = useParty(partyId)
  const update = useUpdateParty()
  const [conflict, setConflict] = useState(false)
  // Bumped on reload so the form remounts with the server's values.
  const [formKey, setFormKey] = useState(0)

  if (!party.data) return <PartyLoadState query={party} />
  const p = party.data
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
      <div className="max-w-3xl">
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
                onSuccess: () => platform.notify.success(t('form.saved')),
                onError: (error) => {
                  if (isVersionConflict(error)) setConflict(true)
                },
              },
            )
          }
        />
      </div>
      <PartyTabs party={p} canEdit />
      <VersionConflictDialog
        open={conflict}
        onOpenChange={setConflict}
        onReload={async () => {
          await party.refetch()
          update.reset()
          setFormKey((k) => k + 1)
        }}
      />
    </div>
  )
}
