import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { platform } from '@/platform'
import { useCreateParty } from '../hooks/useParties'
import { usePayloadKeys } from '../lib/idempotency'
import { emptyPartyValues, formValuesToInput } from '../schemas/party'
import type { Party, PartyRole } from '../types'
import { PartyForm } from './PartyForm'

export interface PartyQuickCreateProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Text the user already typed in a picker. */
  defaultName?: string
  defaultRoles?: PartyRole[]
  onCreated?: (party: Party) => void
}

/** Minimal party creation from inside other documents (invoice, order). */
export function PartyQuickCreate({ open, onOpenChange, ...rest }: PartyQuickCreateProps) {
  const { t } = useTranslation('parties')
  const { t: tc } = useTranslation('common')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" closeLabel={tc('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('quickCreate.title')}</DialogTitle>
          <DialogDescription>{t('quickCreate.description')}</DialogDescription>
        </DialogHeader>
        {/* Content unmounts on close, so each opening starts with a fresh form and key. */}
        <QuickCreateBody {...rest} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function QuickCreateBody({
  defaultName = '',
  defaultRoles = ['customer'],
  onCreated,
  onDone,
}: Omit<PartyQuickCreateProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const { t } = useTranslation('parties')
  const keyFor = usePayloadKeys()
  const create = useCreateParty()
  return (
    <PartyForm
      variant="quick"
      defaultValues={emptyPartyValues({ name: defaultName, roles: defaultRoles })}
      submitLabel={t('quickCreate.submit')}
      submitting={create.isPending}
      serverError={create.error}
      onCancel={onDone}
      onSubmit={(values) => {
        const input = formValuesToInput(values)
        create.mutate(
          { input, key: keyFor(input) },
          {
            onSuccess: (party) => {
              platform.notify.success(t('form.created', { code: party.code }))
              onCreated?.(party)
              onDone()
            },
          },
        )
      }}
    />
  )
}
