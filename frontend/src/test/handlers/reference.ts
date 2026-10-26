import { http, HttpResponse, type JsonBodyType } from 'msw'
import type {
  CostCenter,
  Currency,
  ExchangeRate,
  PaymentTerm,
  Project,
  RateStatus,
  TaxCode,
  Warehouse,
  WarehouseLocation,
} from '@/features/reference/types'

// In-memory stand-in for the Reference module API (PHASE2 "Reference module endpoints").

export const REF_COMPANY = '0192a000-0000-7000-8000-00000000000a'

export interface ReferenceCall {
  method: string
  path: string
  query: URLSearchParams
  body: unknown
  headers: Headers
}

export interface ReferenceDb {
  currencies: Currency[]
  rates: ExchangeRate[]
  rateStatus: RateStatus
  taxCodes: TaxCode[]
  paymentTerms: PaymentTerm[]
  warehouses: Warehouse[]
  locations: Record<string, WarehouseLocation[]>
  costCenters: CostCenter[]
  projects: Project[]
  /** Settings registry values by key. */
  settings: Record<string, unknown>
  calls: ReferenceCall[]
  /** Next PATCH answers 409 VERSION_CONFLICT once. */
  conflictOnNextPatch: boolean
  nextId: number
}

/** A global currency row as ReferenceResource renders it (company activation + its version). */
export function currency(
  id: string,
  code: string,
  name: string,
  symbol: string,
  companyActive: boolean,
): Currency {
  return {
    id,
    code,
    name,
    symbol,
    decimals: 2,
    is_active: true,
    company_is_active: companyActive,
    company_version: 1,
    version: 1,
  }
}

export function createReferenceDb(overrides: Partial<ReferenceDb> = {}): ReferenceDb {
  return {
    currencies: [
      currency('c-try', 'TRY', 'Türk Lirası', '₺', true),
      currency('c-usd', 'USD', 'ABD Doları', '$', true),
      currency('c-eur', 'EUR', 'Euro', '€', false),
    ],
    rates: [
      {
        id: 'r1',
        currency_code: 'USD',
        rate_date: '2026-10-20',
        forex_buying: '41.250000',
        forex_selling: '41.320000',
        banknote_buying: '41.220000',
        banknote_selling: '41.350000',
        source: 'tcmb',
      },
      {
        id: 'r2',
        currency_code: 'EUR',
        rate_date: '2026-10-20',
        forex_buying: '48.100000',
        forex_selling: '48.190000',
        banknote_buying: null,
        banknote_selling: null,
        source: 'tcmb',
      },
    ],
    rateStatus: { last_fetch_date: '2026-10-20', stale_days: 1, is_stale: false },
    taxCodes: [
      {
        id: 'tx1',
        company_id: null,
        type: 'vat',
        code: 'KDV20',
        name: 'KDV %20',
        rate: '20.0000',
        numerator: null,
        denominator: null,
        effective_from: '2023-07-10',
        effective_to: null,
        is_active: true,
        meta: null,
        version: 1,
      },
      {
        id: 'tx2',
        company_id: null,
        type: 'vat',
        code: 'KDV18',
        name: 'KDV %18',
        rate: '18.0000',
        numerator: null,
        denominator: null,
        effective_from: '2020-01-01',
        effective_to: '2023-07-09',
        is_active: true,
        meta: null,
        version: 1,
      },
      {
        id: 'tx3',
        company_id: null,
        type: 'withholding',
        code: 'TEV-5-10',
        name: 'Tevkifat 5/10',
        rate: null,
        numerator: 5,
        denominator: 10,
        effective_from: '2025-01-01',
        effective_to: null,
        is_active: true,
        meta: null,
        version: 1,
      },
      {
        id: 'tx4',
        company_id: REF_COMPANY,
        type: 'other',
        code: 'OZEL1',
        name: 'Özel kod',
        rate: '3.5000',
        numerator: null,
        denominator: null,
        effective_from: '2026-01-01',
        effective_to: null,
        is_active: true,
        meta: null,
        version: 2,
      },
    ],
    paymentTerms: [
      {
        id: 'pt1',
        code: 'NET30',
        name: '30 gün vade',
        due_days: 30,
        discount_percent: '0.0000',
        discount_days: 0,
        is_active: true,
        version: 1,
      },
    ],
    warehouses: [
      {
        id: 'w1',
        code: 'MERKEZ',
        name: 'Merkez depo',
        branch_id: null,
        address: { city: 'İzmir', country: 'TR' },
        is_active: true,
        negative_stock_policy: 'block',
        is_default: true,
        version: 1,
      },
    ],
    locations: {
      w1: [
        {
          id: 'l1',
          code: 'A',
          name: 'A koridoru',
          parent_id: null,
          type: 'aisle',
          is_active: true,
          barcode: null,
          version: 1,
        },
        {
          id: 'l2',
          code: 'A-01',
          name: 'A-01 rafı',
          parent_id: 'l1',
          type: 'rack',
          is_active: true,
          barcode: 'LOC-A01',
          version: 1,
        },
        {
          id: 'l3',
          code: 'B',
          name: 'B koridoru',
          parent_id: null,
          type: 'aisle',
          is_active: true,
          barcode: null,
          version: 1,
        },
      ],
    },
    costCenters: [
      { id: 'cc1', code: 'ADM', name: 'Yönetim', parent_id: null, is_active: true, version: 1 },
      {
        id: 'cc2',
        code: 'ADM-IT',
        name: 'Bilgi işlem',
        parent_id: 'cc1',
        is_active: true,
        version: 1,
      },
    ],
    projects: [
      {
        id: 'p1',
        code: 'PRJ-1',
        name: 'Depo yenileme',
        status: 'active',
        start_date: '2026-03-01',
        end_date: null,
        party_id: null,
        cost_center_id: null,
        version: 1,
      },
    ],
    settings: { 'company.base_currency': 'TRY' },
    calls: [],
    conflictOnNextPatch: false,
    nextId: 100,
    ...overrides,
  }
}

const json = (data: JsonBodyType, status = 200) => HttpResponse.json(data, { status })

const apiError = (
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string[]>,
) => HttpResponse.json({ errors: { message, code, ...(fields ? { fields } : {}) } }, { status })

type Row = object

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : ''

/** Filters each backend list accepts (ReferenceController: fillable ∩ the filterable columns). */
const FILTERS: Record<string, string[]> = {
  currencies: ['is_active'],
  'exchange-rates': ['source', 'currency_code', 'rate_date'],
  'tax-codes': ['is_active', 'type'],
  'payment-terms': ['is_active'],
  warehouses: ['is_active'],
  locations: ['is_active', 'type', 'parent_id'],
  'cost-centers': ['is_active', 'parent_id'],
  projects: ['status', 'cost_center_id'],
}

/** Sorts each backend list accepts: searchable columns, created_at, rate_date/effective_from. */
const SORTS: Record<string, string[]> = {
  currencies: ['code', 'name', 'created_at'],
  'exchange-rates': ['currency_code', 'created_at', 'rate_date'],
  'tax-codes': ['code', 'name', 'created_at', 'effective_from'],
  'payment-terms': ['code', 'name', 'created_at'],
  warehouses: ['code', 'name', 'created_at'],
  locations: ['code', 'name', 'barcode', 'created_at'],
  'cost-centers': ['code', 'name', 'created_at'],
  projects: ['code', 'name', 'created_at'],
}

function listResponse<T extends Row>(
  rows: T[],
  url: URL,
  searchable: (keyof T)[],
  resource?: string,
) {
  // Like Core ListQuery: an unknown filter is a 422 on filter.<name>.
  const allowed = resource ? FILTERS[resource] : undefined
  for (const key of url.searchParams.keys()) {
    const name = /^filter\[(.+)]$/.exec(key)?.[1]
    if (name && allowed && !allowed.includes(name)) {
      return apiError(422, 'VALIDATION_ERROR', 'Doğrulama hatası', {
        [`filter.${name}`]: ['Geçersiz filtre.'],
      })
    }
  }
  let data = rows.slice()
  const q = url.searchParams.get('q')?.toLowerCase()
  if (q) {
    data = data.filter((r) =>
      searchable.some((k) =>
        text((r as Record<keyof T, unknown>)[k])
          .toLowerCase()
          .includes(q),
      ),
    )
  }
  for (const [key, value] of url.searchParams) {
    const m = /^filter\[(.+)]$/.exec(key)
    const name = m?.[1]
    if (!name) continue
    if (name === 'is_active') {
      data = data.filter((r) => String((r as Record<string, unknown>)[name] ? 1 : 0) === value)
    } else {
      data = data.filter((r) => String((r as Record<string, unknown>)[name]) === value)
    }
  }
  const sort = url.searchParams.get('sort')
  const sortable = resource ? SORTS[resource] : undefined
  if (sort && sortable && sort.split(',').some((s) => !sortable.includes(s.replace(/^-/, '')))) {
    return apiError(422, 'VALIDATION_ERROR', 'Doğrulama hatası', { sort: ['Geçersiz sıralama.'] })
  }
  if (sort) {
    const desc = sort.startsWith('-')
    const field = sort.replace(/^-/, '')
    data.sort((a, b) => {
      const x = text((a as Record<string, unknown>)[field])
      const y = text((b as Record<string, unknown>)[field])
      return desc ? y.localeCompare(x) : x.localeCompare(y)
    })
  }
  const perPage = Math.min(Number(url.searchParams.get('per_page') ?? 25), 100)
  const page = Math.max(Number(url.searchParams.get('page') ?? 1), 1)
  return json({
    data: data.slice((page - 1) * perPage, page * perPage),
    meta: {
      pagination: {
        current_page: page,
        per_page: perPage,
        total: data.length,
        last_page: Math.max(1, Math.ceil(data.length / perPage)),
      },
    },
  })
}

export function referenceHandlers(db: ReferenceDb) {
  const record = async (request: Request): Promise<unknown> => {
    const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.text()
    const body: unknown = text ? JSON.parse(text) : undefined
    const url = new URL(request.url)
    db.calls.push({
      method: request.method,
      path: url.pathname.replace(/^.*\/api\/v1/, ''),
      query: url.searchParams,
      body,
      headers: request.headers,
    })
    return body
  }
  const take = () => {
    const id = db.nextId
    db.nextId += 1
    return `gen-${id}`
  }

  /** CRUD handlers for a versioned collection kept in `get()`. */
  function crud<T extends { id: string; version: number } & Row>(
    path: string,
    get: () => T[],
    searchable: (keyof T)[],
    set?: (rows: T[]) => void,
  ) {
    const base = `*/api/v1${path}`
    const write = (rows: T[]) => (set ? set(rows) : undefined)
    return [
      http.get(base, async ({ request }) => {
        await record(request)
        return listResponse(get(), new URL(request.url), searchable, path.slice(1))
      }),
      http.get(`${base}/:id`, async ({ request, params }) => {
        await record(request)
        const found = get().find((r) => r.id === params.id)
        return found ? json({ data: found }) : apiError(404, 'NOT_FOUND', 'Not found')
      }),
      http.post(base, async ({ request }) => {
        const body = (await record(request)) as Record<string, unknown>
        const rows = get()
        if (rows.some((r) => 'code' in r && (r as Row & { code?: string }).code === body.code)) {
          return apiError(422, 'VALIDATION_ERROR', 'Doğrulama hatası', {
            code: ['Bu kod zaten kullanılıyor.'],
          })
        }
        const created = { ...body, id: take(), version: 1 } as unknown as T
        write([...rows, created])
        return json({ data: created }, 201)
      }),
      http.patch(`${base}/:id`, async ({ request, params }) => {
        const body = (await record(request)) as Record<string, unknown>
        const rows = get()
        const found = rows.find((r) => r.id === params.id)
        if (!found) return apiError(404, 'NOT_FOUND', 'Not found')
        if (db.conflictOnNextPatch) {
          db.conflictOnNextPatch = false
          // Someone else saved first.
          found.version += 1
          return apiError(409, 'VERSION_CONFLICT', 'Kayıt başka biri tarafından değiştirildi.')
        }
        if (body.version !== found.version) {
          return apiError(409, 'VERSION_CONFLICT', 'Kayıt başka biri tarafından değiştirildi.')
        }
        const patch = { ...body }
        delete patch.version
        Object.assign(found, patch, { version: found.version + 1 })
        return json({ data: found })
      }),
      http.delete(`${base}/:id`, async ({ request, params }) => {
        await record(request)
        const found = get().find((r) => r.id === params.id)
        if (!found) return apiError(404, 'NOT_FOUND', 'Not found')
        // ReferenceRequest: DELETE requires an integer version (query or body).
        const version = new URL(request.url).searchParams.get('version')
        if (version === null || !/^\d+$/.test(version)) {
          return apiError(422, 'VALIDATION_ERROR', 'Doğrulama hatası', {
            version: ['Sürüm zorunludur.'],
          })
        }
        if (Number(version) !== found.version) {
          return apiError(409, 'VERSION_CONFLICT', 'Kayıt başka biri tarafından değiştirildi.')
        }
        write(get().filter((r) => r.id !== params.id))
        return new HttpResponse(null, { status: 204 })
      }),
    ]
  }

  return [
    http.get('*/api/v1/currencies', async ({ request }) => {
      await record(request)
      return listResponse(db.currencies, new URL(request.url), ['code', 'name'], 'currencies')
    }),
    // PATCH /currencies/{uuid} {is_active, version}: toggles the company activation row.
    http.patch('*/api/v1/currencies/:id', async ({ request, params }) => {
      const body = (await record(request)) as { is_active: boolean; version?: number }
      const found = db.currencies.find((c) => c.id === params.id)
      if (!found) return apiError(404, 'NOT_FOUND', 'Not found')
      if (body.version !== found.company_version) {
        return apiError(409, 'VERSION_CONFLICT', 'Kayıt başka biri tarafından değiştirildi.')
      }
      found.company_is_active = body.is_active
      found.company_version += 1
      found.version = found.company_version
      return json({ data: found })
    }),

    // One currency per call; manual wins over TCMB on the same day; 404 when there is none.
    http.get('*/api/v1/exchange-rates/latest', async ({ request }) => {
      await record(request)
      const code = new URL(request.url).searchParams.get('currency') ?? ''
      if (!/^[A-Z]{3}$/.test(code)) {
        return apiError(422, 'VALIDATION_ERROR', 'Doğrulama hatası', {
          currency: ['Para birimi zorunludur.'],
        })
      }
      const latest = db.rates
        .filter((r) => r.currency_code === code)
        .sort(
          (a, b) =>
            b.rate_date.localeCompare(a.rate_date) ||
            Number(b.source === 'manual') - Number(a.source === 'manual'),
        )[0]
      return latest ? json({ data: latest }) : apiError(404, 'NOT_FOUND', 'Not found')
    }),
    http.get('*/api/v1/exchange-rates/status', async ({ request }) => {
      await record(request)
      return json({ data: db.rateStatus })
    }),
    http.get('*/api/v1/exchange-rates', async ({ request }) => {
      await record(request)
      return listResponse(db.rates, new URL(request.url), ['currency_code'], 'exchange-rates')
    }),
    http.post('*/api/v1/exchange-rates', async ({ request }) => {
      const body = (await record(request)) as Omit<ExchangeRate, 'id'>
      if (Number(body.forex_buying) > Number(body.forex_selling)) {
        return apiError(422, 'VALIDATION_ERROR', 'Doğrulama hatası', {
          forex_selling: ['Satış kuru alış kurundan küçük olamaz.'],
        })
      }
      const created: ExchangeRate = {
        ...body,
        source: 'manual',
        banknote_buying: body.banknote_buying ?? null,
        banknote_selling: body.banknote_selling ?? null,
        id: take(),
      }
      db.rates.unshift(created)
      return json({ data: created }, 201)
    }),

    ...crud(
      '/tax-codes',
      () => db.taxCodes,
      ['code', 'name'],
      (rows) => (db.taxCodes = rows),
    ),
    ...crud(
      '/payment-terms',
      () => db.paymentTerms,
      ['code', 'name'],
      (rows) => (db.paymentTerms = rows),
    ),
    ...crud(
      '/cost-centers',
      () => db.costCenters,
      ['code', 'name'],
      (rows) => (db.costCenters = rows),
    ),
    ...crud(
      '/projects',
      () => db.projects,
      ['code', 'name'],
      (rows) => (db.projects = rows),
    ),
    ...crud(
      '/warehouses',
      () => db.warehouses,
      ['code', 'name'],
      (rows) => (db.warehouses = rows),
    ),

    http.get('*/api/v1/warehouses/:id/locations', async ({ request, params }) => {
      await record(request)
      return listResponse(
        db.locations[String(params.id)] ?? [],
        new URL(request.url),
        ['code', 'name'],
        'locations',
      )
    }),
    http.post('*/api/v1/warehouses/:id/locations', async ({ request, params }) => {
      const body = (await record(request)) as Record<string, unknown>
      const id = String(params.id)
      const created = {
        is_active: true,
        ...body,
        id: take(),
        version: 1,
      } as unknown as WarehouseLocation
      db.locations[id] = [...(db.locations[id] ?? []), created]
      return json({ data: created }, 201)
    }),
    http.patch('*/api/v1/warehouses/:id/locations/:locationId', async ({ request, params }) => {
      const body = (await record(request)) as Record<string, unknown>
      const found = (db.locations[String(params.id)] ?? []).find((l) => l.id === params.locationId)
      if (!found) return apiError(404, 'NOT_FOUND', 'Not found')
      if (body.version !== found.version) {
        return apiError(409, 'VERSION_CONFLICT', 'Kayıt başka biri tarafından değiştirildi.')
      }
      const patch = { ...body }
      delete patch.version
      Object.assign(found, patch, { version: found.version + 1 })
      return json({ data: found })
    }),

    http.get('*/api/v1/settings', async ({ request }) => {
      await record(request)
      return json({
        data: Object.entries(db.settings).map(([key, value]) => ({
          key,
          group: key.split('.')[0],
          value,
          is_default: false,
        })),
      })
    }),
    http.patch('*/api/v1/settings', async ({ request }) => {
      const body = (await record(request)) as { settings: Record<string, unknown> }
      const code = body.settings['company.base_currency']
      if (typeof code === 'string' && !db.currencies.some((c) => c.code === code && c.is_active)) {
        return apiError(422, 'VALIDATION_ERROR', 'Doğrulama hatası', {
          'settings.company.base_currency': ['Para birimi şirkette etkin değil.'],
        })
      }
      Object.assign(db.settings, body.settings)
      return json({ data: [] })
    }),
  ]
}
