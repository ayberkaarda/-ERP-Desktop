import { ApiError } from '@/platform'
import { importRefusalResult, toAccountBalance, toImportResult, withAccountRef } from './api'
import type { DeterminationRule } from './types'

describe('accounting API adapters', () => {
  it('reads the signed balance and balance_side of GET /accounts/{id}/balance', () => {
    expect(
      toAccountBalance({
        account_id: 'a',
        as_of: null,
        debit: '100.0000',
        credit: '250.5000',
        balance: '-150.5000',
        balance_side: 'credit',
        currency_code: null,
        fx_balance: null,
      }),
    ).toMatchObject({ as_of: '', balance: '150.5000', side: 'credit' })
  })

  it('turns the import error list into failed rows and counts the rest as new', () => {
    const r = toImportResult({
      dry_run: true,
      total: 4,
      created: 0,
      errors: [
        { row: 3, field: 'name', message: 'Ad zorunlu.' },
        { row: 3, field: 'type', message: 'Tür geçersiz.' },
        { row: 5, field: 'code', message: 'Kod kullanılıyor.' },
      ],
    })
    expect(r).toMatchObject({ total: 4, created: 2, updated: 0, skipped: 0, failed: 2 })
    expect(r.rows).toEqual([
      { row: 3, code: null, name: null, status: 'error', errors: ['Ad zorunlu.', 'Tür geçersiz.'] },
      { row: 5, code: null, name: null, status: 'error', errors: ['Kod kullanılıyor.'] },
    ])
  })

  it('reads a refused real import (422 rows.<row>.<field>) as a report', () => {
    const e = new ApiError(422, 'VALIDATION_ERROR', '1 satırda hata var.', {
      'rows.7.code': ['Kilit çakışması.'],
    })
    expect(importRefusalResult(e)).toMatchObject({ dry_run: false, created: 0, failed: 1 })
    const other = new ApiError(422, 'VALIDATION_ERROR', 'x', { file: ['Dosya zorunlu.'] })
    expect(importRefusalResult(other)).toBeNull()
  })

  it('builds rule.account from account_code / account_name', () => {
    const rule = {
      id: 'r',
      account_id: 'a',
      account_code: '600',
      account_name: 'Yurt İçi Satışlar',
    } as DeterminationRule
    expect(withAccountRef(rule).account).toEqual({
      id: 'a',
      code: '600',
      name: 'Yurt İçi Satışlar',
    })
  })
})
