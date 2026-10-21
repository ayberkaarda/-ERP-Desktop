import { Plus } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AsyncCombobox,
  type AsyncComboboxProps,
  type ComboboxOption,
} from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { partiesApi } from '../api/parties'
import type { Party, PartyRole } from '../types'
import { PartyQuickCreate } from './PartyQuickCreate'
import { RoleBadges } from './RoleBadges'

export interface PartyComboboxProps extends Omit<
  AsyncComboboxProps,
  'loadOptions' | 'onChange' | 'initialOption' | 'value'
> {
  value: string | null
  onChange: (id: string | null, party: Party | null) => void
  /** Only parties holding this role (sales: customer, purchasing: supplier). */
  role?: PartyRole
  /** The selected party when editing an existing document. */
  initialParty?: Pick<Party, 'id' | 'code' | 'name' | 'roles'> | null
  /** Offers a quick-create button (needs parties.create). */
  allowCreate?: boolean
  showRoles?: boolean
}

/** Async party picker searching name, code and tax number. */
export function PartyCombobox({
  value,
  onChange,
  role,
  initialParty = null,
  allowCreate = false,
  showRoles = true,
  className,
  ...props
}: PartyComboboxProps) {
  const { t } = useTranslation('parties')
  const canCreate = usePermission('parties.create') && allowCreate
  const loaded = useRef(new Map<string, Party>())
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Pick<Party, 'id' | 'code' | 'name' | 'roles'> | null>(
    initialParty,
  )
  const roleText = (roles: readonly PartyRole[]) => roles.map((r) => t(`roles.${r}`)).join(', ')

  const toOption = (
    p: Pick<Party, 'id' | 'code' | 'name' | 'roles'> & { tax_number?: string | null },
  ) => ({
    value: p.id,
    label: p.name,
    description: [p.code, p.tax_number, roleText(p.roles)].filter(Boolean).join(' · '),
  })

  const loadOptions = async (q: string, signal: AbortSignal): Promise<ComboboxOption[]> => {
    const parties = await partiesApi.search(q, { role, signal })
    for (const p of parties) loaded.current.set(p.id, p)
    return parties.map(toOption)
  }

  const current = selected?.id === value ? selected : null

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center gap-1.5">
        <AsyncCombobox
          {...props}
          className="flex-1"
          placeholder={props.placeholder ?? t('combobox.placeholder')}
          value={value}
          initialOption={current ? toOption(current) : null}
          scopeKey={role ?? ''}
          loadOptions={loadOptions}
          onChange={(id) => {
            const party = id ? (loaded.current.get(id) ?? null) : null
            setSelected(party)
            onChange(id, party)
          }}
        />
        {canCreate && (
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label={t('combobox.create')}
            title={t('combobox.create')}
            onClick={() => setCreating(true)}
          >
            <Plus aria-hidden="true" />
          </Button>
        )}
      </div>
      {showRoles && current && current.roles.length > 0 && <RoleBadges roles={current.roles} />}
      {canCreate && (
        <PartyQuickCreate
          open={creating}
          onOpenChange={setCreating}
          defaultRoles={role ? [role] : undefined}
          onCreated={(party) => {
            loaded.current.set(party.id, party)
            setSelected(party)
            onChange(party.id, party)
          }}
        />
      )}
    </div>
  )
}
