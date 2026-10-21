import type { Account, AccountType, NormalBalance } from '../../shared/types'
import { subtreeIds } from './tree'

/** Normal balance a type usually has (TDHP): assets/expenses/costs debit, the rest credit. */
export function defaultNormalBalance(type: AccountType): NormalBalance {
  return type === 'liability' || type === 'equity' || type === 'revenue' ? 'credit' : 'debit'
}

/** TDHP group = first digit of the code (1..9), when it is one. */
export function tdhpGroupOf(code: string): number | null {
  const d = Number(code.trim().charAt(0))
  return Number.isInteger(d) && d >= 1 && d <= 9 ? d : null
}

export const CODE_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.-]*$/
export const CODE_MAX = 32

export interface IntegrityInput {
  code: string
  parentId: string | null
  isPostable: boolean
  isActive: boolean
  type: AccountType
  normalBalance: NormalBalance
}

export interface IntegrityContext {
  /** Every account of the chart (tree data); may be empty while it loads. */
  accounts: readonly Account[]
  /** The record being edited (null for create). */
  editing: Account | null
}

export interface IntegrityIssue {
  key: string
  params?: Record<string, string | number>
}

export interface IntegrityReport {
  /** Blocking: mirror server rules so the user sees them before submitting. */
  errors: Partial<Record<'code' | 'parentId' | 'isPostable' | 'isActive', IntegrityIssue>>
  /** Informative: the server decides (company settings, postings it knows about). */
  warnings: IntegrityIssue[]
}

/**
 * Client-side mirror of the chart integrity rules (PHASE3 accounts): unique code, no cycles,
 * postable only for leaves, accounts with postings stay postable, optional code prefix rule.
 * The server stays the authority; its field errors are shown on the same fields.
 */
export function checkIntegrity(input: IntegrityInput, ctx: IntegrityContext): IntegrityReport {
  const report: IntegrityReport = { errors: {}, warnings: [] }
  const byId = new Map(ctx.accounts.map((a) => [a.id, a]))
  const code = input.code.trim()
  const editing = ctx.editing

  const clash = ctx.accounts.find(
    (a) => a.id !== editing?.id && a.code.toLocaleLowerCase('tr') === code.toLocaleLowerCase('tr'),
  )
  if (code && clash)
    report.errors.code = { key: 'accounts.integrity.codeTaken', params: { name: clash.name } }

  const parent = input.parentId ? byId.get(input.parentId) : undefined
  if (editing && input.parentId) {
    if (subtreeIds(ctx.accounts, editing.id).has(input.parentId)) {
      report.errors.parentId = { key: 'accounts.integrity.cycle' }
    }
  }

  const childCount = editing
    ? (editing.children_count ?? ctx.accounts.filter((a) => a.parent_id === editing.id).length)
    : 0
  if (input.isPostable && childCount > 0) {
    report.errors.isPostable = {
      key: 'accounts.integrity.nonLeafPostable',
      params: { count: childCount },
    }
  }
  if (!input.isPostable && editing?.is_postable && editing.has_postings) {
    report.errors.isPostable = { key: 'accounts.integrity.hasPostings' }
  }

  if (parent) {
    if (!parent.is_active && input.isActive) {
      report.warnings.push({
        key: 'accounts.integrity.parentInactive',
        params: { code: parent.code },
      })
    }
    if (parent.is_postable) {
      report.warnings.push({
        key: parent.has_postings
          ? 'accounts.integrity.parentHasPostings'
          : 'accounts.integrity.parentBecomesHeader',
        params: { code: parent.code },
      })
    }
    if (code && !code.startsWith(parent.code)) {
      report.warnings.push({ key: 'accounts.integrity.prefix', params: { code: parent.code } })
    }
    if (parent.type !== input.type) {
      report.warnings.push({ key: 'accounts.integrity.typeDiffers', params: { code: parent.code } })
    }
  }
  if (input.normalBalance !== defaultNormalBalance(input.type) && input.type !== 'memo') {
    report.warnings.push({ key: 'accounts.integrity.unusualBalance' })
  }
  return report
}
