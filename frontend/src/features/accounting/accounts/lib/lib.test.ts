import { account } from '@/test/handlers/accounting1'
import { csvCell, errorReportCsv } from './csv'
import { checkIntegrity, defaultNormalBalance, tdhpGroupOf } from './integrity'
import { ancestors, branchIds, buildTree, normalizeTree, subtreeIds, visibleRows } from './tree'

const chart = [
  account({ id: 'a1', code: '1', name: 'Dönen Varlıklar', is_postable: false }),
  account({ id: 'a10', code: '10', name: 'Hazır Değerler', parent_id: 'a1', is_postable: false }),
  account({ id: 'a100', code: '100', name: 'Kasa', parent_id: 'a10', is_postable: false }),
  account({ id: 'a10002', code: '100.10', name: 'Döviz Kasası', parent_id: 'a100' }),
  account({ id: 'a10001', code: '100.2', name: 'TL Kasa', parent_id: 'a100', has_postings: true }),
  account({ id: 'a102', code: '102', name: 'Bankalar', parent_id: 'a10' }),
  account({ id: 'a6', code: '6', name: 'Gelir Tablosu', type: 'revenue', is_postable: false }),
]

describe('account tree', () => {
  it('flattens nested tree responses and keeps parent links', () => {
    const flat = normalizeTree([
      {
        ...account({ id: 'p', code: '1', name: 'P' }),
        children: [
          { ...account({ id: 'c', code: '10', name: 'C', parent_id: null }), children: [] },
        ],
      },
    ])
    expect(flat.map((a) => [a.id, a.parent_id])).toEqual([
      ['p', null],
      ['c', 'p'],
    ])
  })

  it('sorts siblings by code with numeric collation', () => {
    const roots = buildTree(chart)
    const kasa = roots[0]?.children[0]?.children[0]
    expect(kasa?.children.map((n) => n.account.code)).toEqual(['100.2', '100.10'])
  })

  it('shows only expanded branches, then matches with their ancestors while filtering', () => {
    const roots = buildTree(chart)
    expect(visibleRows(roots, new Set(), { q: '' }).map((r) => r.account.code)).toEqual(['1', '6'])
    const all = visibleRows(roots, new Set(branchIds(roots)), { q: '' })
    expect(all).toHaveLength(7)
    expect(all.find((r) => r.account.code === '100.2')).toMatchObject({
      depth: 4,
      posinset: 1,
      setsize: 2,
    })

    const hits = visibleRows(roots, new Set(), { q: 'döviz' })
    expect(hits.map((r) => [r.account.code, r.context])).toEqual([
      ['1', true],
      ['10', true],
      ['100', true],
      ['100.10', false],
    ])
    expect(
      visibleRows(roots, new Set(), { q: '', type: 'revenue' }).map((r) => r.account.code),
    ).toEqual(['6'])
    expect(
      visibleRows(roots, new Set(), { q: '10', postable: 'true' }).map((r) => r.account.code),
    ).toEqual(['1', '10', '100', '100.2', '100.10', '102'])
  })

  it('finds subtrees and ancestor chains', () => {
    expect([...subtreeIds(chart, 'a10')].sort()).toEqual([
      'a10',
      'a100',
      'a10001',
      'a10002',
      'a102',
    ])
    const byId = new Map(chart.map((a) => [a.id, a]))
    const leaf = byId.get('a10002')
    expect(leaf && ancestors(byId, leaf).map((a) => a.code)).toEqual(['1', '10', '100'])
  })
})

describe('integrity rules', () => {
  const base = {
    code: '',
    parentId: null,
    isPostable: true,
    isActive: true,
    type: 'asset' as const,
    normalBalance: 'debit' as const,
  }

  it('flags duplicate codes, cycles, postable headers and postings', () => {
    const kasa = chart.find((a) => a.id === 'a100') ?? null
    const tl = chart.find((a) => a.id === 'a10001') ?? null
    expect(
      checkIntegrity({ ...base, code: '102' }, { accounts: chart, editing: null }).errors.code?.key,
    ).toBe('accounts.integrity.codeTaken')
    expect(
      checkIntegrity(
        { ...base, code: '100', parentId: 'a10002' },
        { accounts: chart, editing: kasa },
      ).errors.parentId?.key,
    ).toBe('accounts.integrity.cycle')
    expect(
      checkIntegrity({ ...base, code: '100' }, { accounts: chart, editing: kasa }).errors
        .isPostable,
    ).toEqual({ key: 'accounts.integrity.nonLeafPostable', params: { count: 2 } })
    expect(
      checkIntegrity(
        { ...base, code: '100.2', isPostable: false },
        { accounts: chart, editing: tl },
      ).errors.isPostable?.key,
    ).toBe('accounts.integrity.hasPostings')
  })

  it('warns about parent postability, code prefix, type and balance', () => {
    const r = checkIntegrity(
      { ...base, code: '200', parentId: 'a102', type: 'liability' },
      { accounts: chart, editing: null },
    )
    expect(r.errors).toEqual({})
    expect(r.warnings.map((w) => w.key)).toEqual([
      'accounts.integrity.parentBecomesHeader',
      'accounts.integrity.prefix',
      'accounts.integrity.typeDiffers',
      'accounts.integrity.unusualBalance',
    ])
  })

  it('derives defaults from type and code', () => {
    expect(defaultNormalBalance('revenue')).toBe('credit')
    expect(defaultNormalBalance('cost')).toBe('debit')
    expect(tdhpGroupOf('391.01')).toBe(3)
    expect(tdhpGroupOf('A1')).toBeNull()
  })
})

describe('import error report', () => {
  it('guards formulas and quotes separators', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)")
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "x"')).toBe('"say ""x"""')
  })

  it('lists only failed rows', () => {
    const csv = errorReportCsv(
      [
        { row: 1, code: '100', name: 'Kasa', status: 'create', errors: [] },
        {
          row: 2,
          code: null,
          name: '@cmd',
          status: 'error',
          errors: ['Kod zorunlu', 'Tür geçersiz'],
        },
      ],
      { row: 'Satır', code: 'Kod', name: 'Ad', errors: 'Hatalar' },
    )
    expect(csv.split('\r\n').slice(0, 2)).toEqual([
      `${String.fromCharCode(0xfeff)}Satır,Kod,Ad,Hatalar`,
      "2,,'@cmd,Kod zorunlu | Tür geçersiz",
    ])
  })
})
