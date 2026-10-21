import { zodResolver } from '@hookform/resolvers/zod'
import { Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import { Controller, useFieldArray, useForm, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MSG, requiredString, translateMessage } from '@/lib/forms'
import { platform } from '@/platform'
import { AccountCombobox } from '../../shared/AccountCombobox'
import { rulesApi } from '../../shared/api'
import { RecordDialog, SelectField, TextField } from '../../shared/form'
import { usePayloadKeys } from '../../shared/idempotency'
import { useAccT } from '../../shared/i18n'
import { useSaveRule } from '../../shared/queries'
import {
  CONDITION_KEYS,
  DETERMINATION_EVENTS,
  type DeterminationRule,
  type DeterminationRuleInput,
} from '../../shared/types'
import { conditionsToRows, rowsToConditions } from '../lib/rules'

const schema = z.object({
  event_key: requiredString()
    .max(100, MSG.max)
    .regex(/^[a-z0-9_]+(\.[a-z0-9_*]+)*$/, 'validation.invalid'),
  priority: z
    .string()
    .trim()
    .regex(/^-?\d{1,6}$/, 'validation.number'),
  account_id: z
    .string()
    .nullable()
    .refine((v) => Boolean(v), MSG.required),
  side: z.enum(['', 'debit', 'credit']),
  description: z.string().max(500, MSG.max),
  conditions: z.array(z.object({ key: z.string(), value: z.string() })),
})

type Values = z.infer<typeof schema>

const toValues = (r: DeterminationRule | null, eventKey: string, priority: number): Values => ({
  event_key: r?.event_key ?? eventKey,
  priority: String(r?.priority ?? priority),
  account_id: r?.account_id ?? null,
  side: r?.side ?? '',
  description: r?.description ?? '',
  conditions: conditionsToRows(r?.conditions),
})

function toInput(v: Values): DeterminationRuleInput {
  return {
    event_key: v.event_key.trim(),
    priority: Number(v.priority),
    conditions: rowsToConditions(v.conditions),
    account_id: v.account_id ?? '',
    side: v.side === '' ? null : v.side,
    description: v.description.trim() || null,
  }
}

/** Key/value rows; values may list several alternatives separated by commas. */
function ConditionsEditor({ disabled }: { disabled?: boolean }) {
  const t = useAccT()
  const listId = useId()
  const { control, register } = useFormContext<Values>()
  const { fields, append, remove } = useFieldArray({ control, name: 'conditions' })
  return (
    <fieldset className="space-y-2 sm:col-span-2" disabled={disabled}>
      <legend className="text-sm font-medium">{t('determination.conditions.title')}</legend>
      <p className="text-xs text-muted-foreground">{t('determination.conditions.help')}</p>
      <datalist id={listId}>
        {CONDITION_KEYS.map((k) => (
          <option key={k} value={k}>
            {t(`determination.conditionKeys.${k}`)}
          </option>
        ))}
      </datalist>
      {fields.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('determination.conditions.none')}</p>
      )}
      {fields.map((f, i) => (
        <div key={f.id} className="flex items-end gap-2">
          <FieldShell label={t('determination.conditions.key')} className="w-48" hideLabel={i > 0}>
            {(c) => (
              <Input
                {...c}
                {...register(`conditions.${i}.key`)}
                list={listId}
                autoComplete="off"
                className="font-code"
                aria-label={t('determination.conditions.keyN', { n: i + 1 })}
              />
            )}
          </FieldShell>
          <FieldShell
            label={t('determination.conditions.value')}
            className="flex-1"
            hideLabel={i > 0}
          >
            {(c) => (
              <Input
                {...c}
                {...register(`conditions.${i}.value`)}
                autoComplete="off"
                aria-label={t('determination.conditions.valueN', { n: i + 1 })}
              />
            )}
          </FieldShell>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('determination.conditions.remove', { n: i + 1 })}
            onClick={() => remove(i)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => append({ key: '', value: '' })}
      >
        <Plus aria-hidden="true" />
        {t('determination.conditions.add')}
      </Button>
    </fieldset>
  )
}

export function RuleDialog({
  rule: initial,
  eventKey,
  priority,
  onClose,
}: {
  rule: DeterminationRule | null
  eventKey: string
  priority: number
  onClose: () => void
}) {
  const t = useAccT()
  const { i18n } = useTranslation('common')
  const [rule, setRule] = useState(initial)
  const [reloading, setReloading] = useState(false)
  const keyFor = usePayloadKeys()
  const save = useSaveRule()
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: toValues(initial, eventKey, priority),
  })
  const eventsId = useId()
  const locked = Boolean(rule?.is_system)

  const submit = (v: Values) => {
    const input = toInput(v)
    const done = () => {
      platform.notify.success(
        t(rule ? 'determination.toast.updated' : 'determination.toast.created'),
      )
      onClose()
    }
    if (rule) {
      const patch: Partial<DeterminationRuleInput> = locked
        ? { account_id: input.account_id, side: input.side, description: input.description }
        : input
      save.mutate(
        { mode: 'update', id: rule.id, version: rule.version, patch },
        { onSuccess: done },
      )
    } else {
      save.mutate({ mode: 'create', input, key: keyFor(input) }, { onSuccess: done })
    }
  }

  const reload = async () => {
    if (!rule) return
    setReloading(true)
    try {
      const fresh = (await rulesApi.all()).find((r) => r.id === rule.id)
      if (fresh) {
        setRule(fresh)
        save.reset()
        form.reset(toValues(fresh, eventKey, priority))
      }
    } finally {
      setReloading(false)
    }
  }

  const labels = {
    event_key: t('determination.fields.event'),
    priority: t('determination.fields.priority'),
    account_id: t('determination.fields.account'),
    side: t('determination.fields.side'),
    description: t('determination.fields.description'),
  }

  return (
    <RecordDialog<Values>
      open
      onOpenChange={(o) => !o && onClose()}
      title={rule ? t('determination.editTitle') : t('determination.newTitle')}
      description={locked ? t('determination.systemNote') : t('determination.dialogBody')}
      form={form}
      onSubmit={submit}
      error={save.error}
      onReload={rule ? () => void reload() : undefined}
      reloading={reloading}
      busy={save.isPending}
      fieldLabels={labels}
      className="max-w-2xl"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <datalist id={eventsId}>
          {DETERMINATION_EVENTS.map((e) => (
            <option key={e} value={e} />
          ))}
        </datalist>
        <TextField<Values, 'event_key'>
          name="event_key"
          label={labels.event_key}
          required
          input={{ list: eventsId, className: 'font-code', autoComplete: 'off', disabled: locked }}
        />
        <TextField<Values, 'priority'>
          name="priority"
          label={labels.priority}
          required
          description={t('determination.hints.priority')}
          input={{ inputMode: 'numeric', disabled: locked }}
        />
        <Controller
          control={form.control}
          name="account_id"
          render={({ field, fieldState }) => (
            <FieldShell
              label={labels.account_id}
              required
              className="sm:col-span-2"
              error={translateMessage(i18n, fieldState.error?.message)}
            >
              {(control) => (
                <AccountCombobox
                  {...control}
                  ref={field.ref}
                  value={field.value}
                  onBlur={field.onBlur}
                  onChange={(id) => field.onChange(id)}
                />
              )}
            </FieldShell>
          )}
        />
        <SelectField<Values, 'side'>
          name="side"
          label={labels.side}
          options={[
            { value: '', label: t('determination.sideAny') },
            { value: 'debit', label: t('accounts.side.debit') },
            { value: 'credit', label: t('accounts.side.credit') },
          ]}
        />
        <TextField<Values, 'description'>
          name="description"
          label={labels.description}
          input={{ maxLength: 500 }}
        />
        <ConditionsEditor disabled={locked} />
      </div>
    </RecordDialog>
  )
}
