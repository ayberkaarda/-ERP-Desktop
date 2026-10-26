import { ApiError, platform, withIdempotency } from '@/platform'
import type {
  Account,
  Area,
  Envelope,
  MatchSuggestion,
  Movement,
  OpenItem,
  Page,
  Preview,
  Report,
  Statement,
  StatementInput,
  TreasuryRecord,
} from './types'
import { AREA_BASE } from './types'

export type Params = Record<string, string | number | boolean | undefined>
const http = () => platform.http
const seg = encodeURIComponent
export const treasuryApi = {
  list: <T extends TreasuryRecord>(area: Area, params: Params = {}, signal?: AbortSignal) =>
    http().get<Page<T>>(AREA_BASE[area], { params, signal }),
  get: <T extends TreasuryRecord>(area: Area, id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<T>>(`${AREA_BASE[area]}/${seg(id)}`, { signal })
      .then((r) => r.data),
  create: <T extends TreasuryRecord>(area: Area, body: unknown, key: string) =>
    http()
      .post<Envelope<T>>(AREA_BASE[area], body, withIdempotency({}, key))
      .then((r) => r.data),
  update: <T extends TreasuryRecord>(area: Area, id: string, body: unknown) =>
    http()
      .patch<Envelope<T>>(`${AREA_BASE[area]}/${seg(id)}`, body)
      .then((r) => r.data),
  remove: (area: Area, id: string, version: number) =>
    http().delete(`${AREA_BASE[area]}/${seg(id)}`, { params: { version } }),
  action: <T extends TreasuryRecord>(
    area: Area,
    id: string,
    action: string,
    body: unknown,
    key: string,
  ) =>
    http()
      .post<Envelope<T>>(
        `${AREA_BASE[area]}/${seg(id)}/${seg(action)}`,
        body,
        withIdempotency({}, key),
      )
      .then((r) => r.data),
  accounts: async (signal?: AbortSignal): Promise<Page<Account>> => {
    const rows: Account[] = []
    for (let current = 1; current <= 20; current++) {
      const result = await treasuryApi.list<Account>(
        'accounts',
        { page: current, per_page: 100, 'filter[is_active]': 'true' },
        signal,
      )
      rows.push(...result.data)
      if (current >= result.meta.pagination.last_page) return { ...result, data: rows }
    }
    throw new ApiError(422, 'LIMIT_EXCEEDED', 'Account selection exceeds 2,000 records.')
  },
  openItems: (
    partyId: string,
    module: 'sales' | 'purchasing',
    page: number,
    signal?: AbortSignal,
  ) =>
    http().get<Page<OpenItem>>('/treasury-open-items', {
      params: { party_id: partyId, module, page, per_page: 25 },
      signal,
    }),
  previewPayment: (id: string, signal?: AbortSignal) =>
    http()
      .get<Envelope<Preview>>(`/treasury-payments/${seg(id)}/preview`, { signal })
      .then((r) => r.data),
  movements: (id: string, params: Params, signal?: AbortSignal) =>
    http().get<Page<Movement>>(`/treasury-accounts/${seg(id)}/movements`, { params, signal }),
  previewStatement: (body: StatementInput) =>
    http()
      .post<Envelope<Statement>>('/treasury-bank-statements/preview', body)
      .then((r) => r.data),
  suggestions: (id: string, lineId: string, page: number, signal?: AbortSignal) =>
    http().get<Page<MatchSuggestion>>(`/treasury-bank-statements/${seg(id)}/suggestions`, {
      params: { line_id: lineId, page, per_page: 25 },
      signal,
    }),
  report: (slug: string, params: Params, signal?: AbortSignal) =>
    http().get<Report>(`/treasury-reports/${seg(slug)}`, { params, signal }),
  exportReport: (slug: string, format: string, params: Params) =>
    http().download(`/treasury-reports/${seg(slug)}/export`, { params: { ...params, format } }),
}
