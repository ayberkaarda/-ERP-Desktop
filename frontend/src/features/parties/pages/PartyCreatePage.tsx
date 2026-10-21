import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { PageHeader } from '@/components/shared/PageHeader'
import { createIdempotencyKey, platform } from '@/platform'
import { PartyForm } from '../components/PartyForm'
import { useCreateParty } from '../hooks/useParties'
import { emptyPartyValues, formValuesToInput } from '../schemas/party'

export function PartyCreatePage() {
  const { t } = useTranslation('parties')
  const navigate = useNavigate()
  const create = useCreateParty()
  // Same key for every retry of this page's submit; the API replays instead of duplicating.
  const [key] = useState(createIdempotencyKey)

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={t('form.createTitle')}
        breadcrumbs={[{ label: t('title'), to: '/parties' }, { label: t('form.createTitle') }]}
      />
      <PartyForm
        defaultValues={emptyPartyValues()}
        submitLabel={t('form.create')}
        submitting={create.isPending}
        serverError={create.error}
        onCancel={() => void navigate('/parties')}
        onSubmit={(values) =>
          create.mutate(
            { input: formValuesToInput(values), key },
            {
              onSuccess: (party) => {
                platform.notify.success(t('form.created', { code: party.code }))
                void navigate(`/parties/${encodeURIComponent(party.id)}/edit`, { replace: true })
              },
            },
          )
        }
        footer={
          <p className="text-xs text-muted-foreground">{t('form.subresourcesAfterCreate')}</p>
        }
      />
    </div>
  )
}
