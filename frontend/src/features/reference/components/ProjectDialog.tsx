import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { FormField } from '@/components/shared/form'
import { projectsApi } from '../api/resources'
import { useCreateProject, useUpdateProject } from '../hooks/useReference'
import { useRefT } from '../i18n'
import { projectSchema, toProjectInput, type ProjectFormValues } from '../schemas'
import { PROJECT_STATUSES, type Project } from '../types'
import { DateField, SelectField, TextField } from './fields'
import { ResourceDialog } from './ResourceDialog'
import { CostCenterSelect } from './selects'
import { useReloadableRecord } from './useEditor'

const toValues = (p: Project | null): ProjectFormValues => ({
  code: p?.code ?? '',
  name: p?.name ?? '',
  status: p?.status ?? 'planned',
  start_date: p?.start_date ?? '',
  end_date: p?.end_date ?? '',
  cost_center_id: p?.cost_center_id ?? '',
})

interface ProjectDialogProps {
  record: Project | null
  onClose: () => void
}

export function ProjectDialog({ record: initial, onClose }: ProjectDialogProps) {
  const t = useRefT()
  const create = useCreateProject()
  const update = useUpdateProject()
  const form = useForm<ProjectFormValues>({
    resolver: zodResolver(projectSchema),
    defaultValues: toValues(initial),
  })
  const { record, reload } = useReloadableRecord(
    initial,
    (r) => projectsApi.get(r.id),
    form.reset,
    toValues,
  )

  return (
    <ResourceDialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={record ? t('projects.edit') : t('projects.new')}
      form={form}
      onReload={reload}
      fieldLabels={{
        code: t('fields.code'),
        name: t('fields.name'),
        status: t('projects.status'),
        start_date: t('projects.startDate'),
        end_date: t('projects.endDate'),
        cost_center_id: t('projects.costCenter'),
      }}
      onSubmit={async (values, { idempotencyKey }) => {
        const input = toProjectInput(values)
        if (record) {
          await update.mutateAsync({ id: record.id, version: record.version, patch: input })
        } else {
          await create.mutateAsync({ input, key: idempotencyKey })
        }
      }}
    >
      <TextField<ProjectFormValues>
        name="code"
        label={t('fields.code')}
        required
        maxLength={32}
        autoFocus
        uppercase
      />
      <TextField<ProjectFormValues> name="name" label={t('fields.name')} required />
      <SelectField<ProjectFormValues>
        name="status"
        label={t('projects.status')}
        required
        options={PROJECT_STATUSES.map((v) => ({ value: v, label: t(`projects.statuses.${v}`) }))}
      />
      <FormField<ProjectFormValues, 'cost_center_id'>
        name="cost_center_id"
        label={t('projects.costCenter')}
        render={({ field, control }) => (
          <CostCenterSelect
            {...control}
            value={field.value || null}
            onChange={(value) => field.onChange(value ?? '')}
            onBlur={field.onBlur}
          />
        )}
      />
      <DateField<ProjectFormValues> name="start_date" label={t('projects.startDate')} />
      <DateField<ProjectFormValues> name="end_date" label={t('projects.endDate')} />
    </ResourceDialog>
  )
}
