import { toIsoDate } from '@/lib/datetime'
import type {
  AccountRef,
  EntryType,
  JournalEntry,
  JournalEntryInput,
  JournalLineInput,
  NamedRef,
} from '../types'
import { amountOf } from './balance'

/** One editable line; the picked records ride along so flags and labels need no refetch. */
export interface LineValues {
  accountId: string
  account: AccountRef | null
  description: string
  debit: string
  credit: string
  fxAmount: string
  fxRate: string
  partyId: string
  party: NamedRef | null
  costCenterId: string
  costCenter: NamedRef | null
  projectId: string
  project: NamedRef | null
  documentRef: string
}

export interface EntryValues {
  entryType: EntryType
  entryDate: string
  description: string
  lines: LineValues[]
}

export function emptyLine(): LineValues {
  return {
    accountId: '',
    account: null,
    description: '',
    debit: '',
    credit: '',
    fxAmount: '',
    fxRate: '',
    partyId: '',
    party: null,
    costCenterId: '',
    costCenter: null,
    projectId: '',
    project: null,
    documentRef: '',
  }
}

export function emptyEntry(today = toIsoDate(new Date())): EntryValues {
  return {
    entryType: 'general',
    entryDate: today,
    description: '',
    lines: [emptyLine(), emptyLine()],
  }
}

const text = (v: string | null | undefined) => v ?? ''
/** Zero amounts are shown as empty cells, so only the side that carries the amount is filled. */
const amountText = (v: string | null | undefined) => (amountOf(v).isZero() ? '' : (v ?? ''))

export function toEntryValues(entry: JournalEntry): EntryValues {
  return {
    entryType: entry.entry_type,
    entryDate: entry.entry_date,
    description: text(entry.description),
    lines: [...entry.lines]
      .sort((a, b) => a.line_no - b.line_no)
      .map((l) => ({
        accountId: l.account_id,
        account: l.account ?? null,
        description: text(l.description),
        debit: amountText(l.debit),
        credit: amountText(l.credit),
        fxAmount: text(l.fx_amount),
        fxRate: text(l.fx_rate),
        partyId: text(l.party_id),
        party: l.party ?? null,
        costCenterId: text(l.cost_center_id),
        costCenter: l.cost_center ?? null,
        projectId: text(l.project_id),
        project: l.project ?? null,
        documentRef: text(l.document_ref),
      })),
  }
}

const orNull = (v: string) => (v.trim() === '' ? null : v.trim())
const amount = (v: string) => (amountOf(v).isZero() ? '0.00' : v)

/** True when the line has anything typed in it; fully blank lines are dropped on save. */
export function isBlankLine(l: LineValues): boolean {
  return (
    l.accountId === '' &&
    amountOf(l.debit).isZero() &&
    amountOf(l.credit).isZero() &&
    l.description.trim() === '' &&
    l.fxAmount === '' &&
    l.partyId === '' &&
    l.costCenterId === '' &&
    l.projectId === '' &&
    l.documentRef.trim() === ''
  )
}

export function toLineInput(l: LineValues): JournalLineInput {
  const fx = l.account?.currency_code ?? null
  return {
    account_id: l.accountId,
    debit: amount(l.debit),
    credit: amount(l.credit),
    currency_code: fx,
    fx_amount: fx ? orNull(l.fxAmount) : null,
    fx_rate: fx ? orNull(l.fxRate) : null,
    party_id: orNull(l.partyId),
    cost_center_id: orNull(l.costCenterId),
    project_id: orNull(l.projectId),
    description: orNull(l.description),
    document_ref: orNull(l.documentRef),
  }
}

export function toEntryInput(v: EntryValues): JournalEntryInput {
  return {
    entry_type: v.entryType,
    entry_date: v.entryDate,
    description: orNull(v.description),
    lines: v.lines.filter((l) => !isBlankLine(l)).map(toLineInput),
  }
}

/** Which optional columns the grid shows for the current lines. */
export interface LineColumns {
  fx: boolean
  party: boolean
  costCenter: boolean
  project: boolean
}

export function lineColumns(lines: readonly LineValues[], showAllDimensions = false): LineColumns {
  const any = (pick: (a: AccountRef) => boolean) =>
    lines.some((l) => (l.account ? pick(l.account) : false))
  return {
    fx: any((a) => Boolean(a.currency_code)),
    party: showAllDimensions || any((a) => a.requires_party),
    costCenter: showAllDimensions || any((a) => a.requires_cost_center),
    project: showAllDimensions || any((a) => a.requires_project),
  }
}

/** Server field names ("lines.3.cost_center_id") to form paths, accounting for dropped blanks. */
export function serverFieldMapper(values: EntryValues) {
  const kept = values.lines.flatMap((l, i) => (isBlankLine(l) ? [] : [i]))
  return (field: string): string | null => {
    const parts = field.split('.')
    const camel = (s: string) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
    if (parts[0] === 'lines' && parts.length >= 2) {
      const index = kept[Number(parts[1])]
      if (index === undefined) return parts.length === 2 ? null : 'lines'
      const rest = parts.slice(2).map(camel)
      if (rest[0] === 'currencyCode') rest[0] = 'fxAmount'
      return ['lines', String(index), ...rest].join('.')
    }
    return parts.map(camel).join('.')
  }
}
