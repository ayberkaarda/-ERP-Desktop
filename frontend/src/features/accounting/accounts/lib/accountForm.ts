import { z } from 'zod'
import { MSG, requiredString } from '@/lib/forms'
import {
  ACCOUNT_TYPES,
  NORMAL_BALANCES,
  type Account,
  type AccountInput,
  type AccountType,
} from '../../shared/types'
import { CODE_MAX, CODE_PATTERN, defaultNormalBalance, tdhpGroupOf } from './integrity'

export const accountSchema = z.object({
  code: requiredString().max(CODE_MAX, MSG.max).regex(CODE_PATTERN, 'validation.invalid'),
  name: requiredString().max(255, MSG.max),
  parent_id: z.string().nullable(),
  type: z.enum(ACCOUNT_TYPES),
  normal_balance: z.enum(NORMAL_BALANCES),
  is_postable: z.boolean(),
  is_active: z.boolean(),
  tdhp_group: z.string().regex(/^[1-9]?$/, 'validation.invalid'),
  currency_code: z
    .string()
    .trim()
    .regex(/^([A-Za-z]{3})?$/, 'validation.invalid'),
  requires_party: z.boolean(),
  requires_cost_center: z.boolean(),
  requires_project: z.boolean(),
  is_revaluable: z.boolean(),
  notes: z.string().max(2000, MSG.max),
})

export type AccountFormValues = z.infer<typeof accountSchema>

export function toValues(a: Account | null, parent: Account | null = null): AccountFormValues {
  const type: AccountType = a?.type ?? parent?.type ?? 'asset'
  return {
    code: a?.code ?? parent?.code ?? '',
    name: a?.name ?? '',
    parent_id: a ? a.parent_id : (parent?.id ?? null),
    type,
    normal_balance: a?.normal_balance ?? parent?.normal_balance ?? defaultNormalBalance(type),
    is_postable: a?.is_postable ?? true,
    is_active: a?.is_active ?? true,
    tdhp_group: String(a?.tdhp_group ?? parent?.tdhp_group ?? ''),
    currency_code: a?.currency_code ?? '',
    requires_party: a?.requires_party ?? false,
    requires_cost_center: a?.requires_cost_center ?? false,
    requires_project: a?.requires_project ?? false,
    is_revaluable: a?.is_revaluable ?? false,
    notes: a?.notes ?? '',
  }
}

export function toInput(v: AccountFormValues): AccountInput {
  const code = v.code.trim()
  return {
    code,
    name: v.name.trim(),
    parent_id: v.parent_id,
    type: v.type,
    normal_balance: v.normal_balance,
    is_postable: v.is_postable,
    is_active: v.is_active,
    tdhp_group: v.tdhp_group ? Number(v.tdhp_group) : tdhpGroupOf(code),
    currency_code: v.currency_code.trim() ? v.currency_code.trim().toUpperCase() : null,
    requires_party: v.requires_party,
    requires_cost_center: v.requires_cost_center,
    requires_project: v.requires_project,
    is_revaluable: v.currency_code.trim() ? v.is_revaluable : false,
    notes: v.notes.trim() || null,
  }
}

/** Only changed fields go into a PATCH (a smaller payload conflicts less with other edits). */
export function diff(before: AccountInput, after: AccountInput): Partial<AccountInput> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(after) as (keyof AccountInput)[]) {
    if (before[key] !== after[key]) out[key] = after[key]
  }
  return out
}
