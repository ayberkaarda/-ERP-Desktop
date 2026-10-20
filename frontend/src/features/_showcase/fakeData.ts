import Decimal from 'decimal.js'
import type { ApprovalTimelineStep } from '@/components/shared/ApprovalTimeline'
import type { AttachmentApi, FileMeta } from '@/components/shared/attachments'
import type { AuditEntry } from '@/components/shared/AuditTrail'
import type { ListQueryState } from '@/components/shared/data-table'
import type { ComboboxOption } from '@/components/shared/form'

// Sample records for the dev-only showcase; nothing here reaches the API.

export interface Account {
  id: string
  code: string
  name: string
  status: 'active' | 'inactive' | 'draft'
  balance: string
  created_at: string
}

const NAMES = [
  'Anadolu Gıda A.Ş.',
  'Boğaziçi Lojistik Ltd.',
  'Çukurova Tekstil',
  'Doğu Enerji',
  'Ege Zeytincilik',
  'Fırat Yapı',
  'Göksu Makine',
  'Hisar Otomotiv',
  'İzmir Kimya',
  'Karadeniz Fındık',
]
const STATUSES: Account['status'][] = ['active', 'active', 'inactive', 'draft']

export const ACCOUNTS: Account[] = Array.from({ length: 240 }, (_, i) => ({
  id: `acc-${i + 1}`,
  code: `120.${String(i + 1).padStart(4, '0')}`,
  name: `${NAMES[i % NAMES.length] ?? ''} ${Math.floor(i / NAMES.length) + 1}`,
  status: STATUSES[i % STATUSES.length] ?? 'active',
  balance: new Decimal(((i * 7919) % 100000) - 25000).div(100).mul(37).toFixed(2),
  created_at: new Date(Date.UTC(2026, 0, 1 + i, 9, 30)).toISOString(),
}))

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Mimics ListQuery on the server: q, filter[status], sort, page/per_page. */
export async function fetchAccounts(query: ListQueryState, rows: Account[]) {
  await delay(250)
  const q = query.q.toLocaleLowerCase('tr-TR')
  let result = rows.filter(
    (a) =>
      (!q || a.name.toLocaleLowerCase('tr-TR').includes(q) || a.code.includes(q)) &&
      (!query.filters.status || a.status === query.filters.status),
  )
  for (const s of [...query.sort].reverse()) {
    result = [...result].sort((a, b) => {
      const key = s.id as keyof Account
      const cmp =
        key === 'balance'
          ? new Decimal(a.balance).comparedTo(b.balance)
          : a[key].localeCompare(b[key], 'tr-TR')
      return s.desc ? -cmp : cmp
    })
  }
  const start = (query.page - 1) * query.perPage
  return { data: result.slice(start, start + query.perPage), total: result.length }
}

export const ACCOUNT_OPTIONS: ComboboxOption[] = ACCOUNTS.slice(0, 30).map((a) => ({
  value: a.id,
  label: a.name,
  description: a.code,
}))

export async function searchCustomers(
  query: string,
  signal: AbortSignal,
): Promise<ComboboxOption[]> {
  await delay(300)
  if (signal.aborted) return []
  const q = query.toLocaleLowerCase('tr-TR')
  return ACCOUNTS.filter((a) => a.name.toLocaleLowerCase('tr-TR').includes(q))
    .slice(0, 20)
    .map((a) => ({ value: a.id, label: a.name, description: a.code }))
}

export const PRODUCTS: ComboboxOption[] = [
  { value: 'p-1', label: 'Zeytinyağı 1 L', description: 'ZY-001' },
  { value: 'p-2', label: 'Fındık İçi 500 g', description: 'FN-500' },
  { value: 'p-3', label: 'Pamuklu Kumaş (m)', description: 'KM-110' },
  { value: 'p-4', label: 'Rulman 6204', description: 'RL-6204' },
  { value: 'p-5', label: 'Nakliye Hizmeti', description: 'HZ-NAK' },
]

export const APPROVAL_STEPS: ApprovalTimelineStep[] = [
  {
    id: 's1',
    order: 1,
    name: 'Bölüm yöneticisi',
    state: 'approved',
    approvers: ['Ayşe Demir'],
    decision: {
      actor: 'Ayşe Demir',
      decision: 'approve',
      comment: 'Bütçe dahilinde.',
      decidedAt: '2026-10-20T07:45:00Z',
    },
  },
  {
    id: 's2',
    order: 2,
    name: 'Finans',
    state: 'pending',
    approvers: ['Finans Müdürü', 'CFO'],
    threshold: '50000.00',
  },
  {
    id: 's3',
    order: 3,
    name: 'Genel müdür',
    state: 'waiting',
    approvers: ['Genel Müdür'],
    threshold: '250000.00',
  },
]

export const AUDIT_ENTRIES: AuditEntry[] = [
  {
    id: 'a3',
    event: 'updated',
    causer: { id: 'u1', name: 'Mehmet Kaya' },
    created_at: '2026-10-20T11:12:00Z',
    properties: {
      attributes: { status: 'approved', total: '12500.00' },
      old: { status: 'pending_approval', total: '12000.00' },
    },
  },
  {
    id: 'a2',
    event: 'updated',
    causer: null,
    description: 'Numara atandı',
    created_at: '2026-10-19T08:00:00Z',
    properties: { attributes: { number: 'SF2026000000042' }, old: { number: null } },
  },
  {
    id: 'a1',
    event: 'created',
    causer: { id: 'u2', name: 'Ayşe Demir' },
    created_at: '2026-10-18T15:30:00Z',
    properties: { attributes: { status: 'draft', total: '12000.00' } },
  },
]

/** In-memory AttachmentApi with the same contract as createFilesApi. */
export function createFakeAttachmentApi(): AttachmentApi {
  let files: FileMeta[] = [
    {
      id: 'f-1',
      original_name: 'teklif.pdf',
      mime_type: 'application/pdf',
      size: 182_344,
      created_at: '2026-10-18T15:31:00Z',
      uploaded_by: { id: 'u2', name: 'Ayşe Demir' },
    },
  ]
  return {
    list: async () => {
      await delay(200)
      return files
    },
    upload: async (file) => {
      await delay(600)
      const meta: FileMeta = {
        id: `f-${files.length + 1}-${file.name}`,
        original_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
        created_at: new Date().toISOString(),
        uploaded_by: { id: 'u0', name: 'Showcase' },
      }
      files = [...files, meta]
      return meta
    },
    remove: async (id) => {
      await delay(200)
      files = files.filter((f) => f.id !== id)
    },
    downloadUrl: (id) => `#download-${id}`,
  }
}
