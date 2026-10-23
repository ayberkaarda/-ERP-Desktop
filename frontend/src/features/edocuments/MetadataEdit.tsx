import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { edocumentsApi } from './api'
import { useEdocT, useOperation } from './hooks'
import { MetadataFields } from './MetadataFields'
import { buildMetadata, metadataValues } from './metadata'
import { PROFILES, type EDocument } from './types'
import { control, ErrorNotice, Field } from './ui'
export function MetadataEdit({
  record,
  onSaved,
}: {
  record: EDocument
  onSaved: (value: EDocument) => void
}) {
  const t = useEdocT()
  const operation = useOperation()
  const [profile, setProfile] = useState(record.profile)
  const [series, setSeries] = useState(record.series)
  const [values, setValues] = useState(() => metadataValues(record.metadata))
  const lines = Array.isArray(record.snapshot?.lines)
    ? record.snapshot.lines
        .filter((line): line is Record<string, unknown> => !!line && typeof line === 'object')
        .map((line) => ({
          id: String(line.id),
          name: typeof line.name === 'string' ? line.name : '',
        }))
    : []
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        const body = { version: record.version, profile, series, metadata: buildMetadata(values) }
        void operation.run(
          [record.id, 'metadata', body],
          (key, signal) => edocumentsApi.update(record.id, body, key, signal),
          onSaved,
        )
      }}
    >
      <ErrorNotice error={operation.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('profile')}>
          <select
            className={control}
            value={profile}
            disabled={operation.busy}
            onChange={(event) => setProfile(event.target.value)}
          >
            {PROFILES[record.kind].map((value) => (
              <option key={value} value={value}>
                {t(`profile_${value}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('series')}>
          <input
            className={control}
            value={series}
            pattern="[A-Z]{3}"
            maxLength={3}
            required
            disabled={operation.busy}
            onChange={(event) => setSeries(event.target.value.toUpperCase())}
          />
        </Field>
      </div>
      <MetadataFields
        kind={record.kind}
        profile={profile}
        values={values}
        onChange={setValues}
        lines={lines}
        disabled={operation.busy}
      />
      <Button disabled={operation.busy} type="submit">
        {t('save')}
      </Button>
    </form>
  )
}
