import { platform } from '@/platform'
import { edocumentsApi } from './api'

afterEach(() => vi.restoreAllMocks())
it('omits empty search filters accepted as null by Laravel middleware', async () => {
  const get = vi.spyOn(platform.http, 'get').mockResolvedValue({ data: [], meta: {} })
  await edocumentsApi.list({ direction: 'outgoing', search: '', page: 1 })
  expect(get).toHaveBeenLastCalledWith('/e-documents/documents', {
    params: { direction: 'outgoing', search: undefined, page: 1 },
    signal: undefined,
  })
  await edocumentsApi.sources('e_invoice', '   ', 1)
  expect(get).toHaveBeenLastCalledWith('/e-documents/sources', {
    params: { kind: 'e_invoice', search: undefined, page: 1 },
    signal: undefined,
  })
})
it('sends server-side source search and paging with cancellation signals', async () => {
  const get = vi.spyOn(platform.http, 'get').mockResolvedValue({ data: [], meta: {} })
  const signal = new AbortController().signal
  await edocumentsApi.sources('e_archive', 'INV %', 8, signal)
  expect(get).toHaveBeenCalledWith('/e-documents/sources', {
    params: { kind: 'e_archive', search: 'INV %', page: 8 },
    signal,
  })
  await edocumentsApi.purchaseInvoices('supplier', 3, signal)
  expect(get).toHaveBeenLastCalledWith('/purchase-invoices', {
    params: { q: 'supplier', page: 3, per_page: 25 },
    signal,
  })
})
it('keeps version and idempotency metadata on draft edits and actions and escapes IDs', async () => {
  const post = vi.spyOn(platform.http, 'post').mockResolvedValue({ data: { id: 'one' } })
  const patch = vi.spyOn(platform.http, 'patch').mockResolvedValue({ data: { id: 'one' } })
  const signal = new AbortController().signal
  await edocumentsApi.update(
    'a/b',
    {
      version: 4,
      profile: 'KAMU',
      series: 'ABC',
      metadata: { payment_iban: 'TR330006100519786457841326' },
    },
    'logical-key',
    signal,
  )
  expect(patch).toHaveBeenCalledWith(
    '/e-documents/documents/a%2Fb',
    expect.objectContaining({ version: 4 }),
    { signal, idempotencyKey: 'logical-key' },
  )
  await edocumentsApi.action(
    'a/b',
    'respond',
    { version: 4, decision: 'reject', reason: 'wrong party' },
    'response-key',
    signal,
  )
  expect(post).toHaveBeenCalledWith(
    '/e-documents/documents/a%2Fb/respond',
    { version: 4, decision: 'reject', reason: 'wrong party' },
    { signal, idempotencyKey: 'response-key' },
  )
  await edocumentsApi.outcome('a/b', 'accepted', 5, 'outcome-key', signal)
  expect(post).toHaveBeenLastCalledWith(
    '/e-documents/sandbox/documents/a%2Fb/outcome',
    { outcome: 'accepted', version: 5 },
    { signal, idempotencyKey: 'outcome-key' },
  )
})
it('imports and stages only XML text using local document endpoints', async () => {
  const post = vi.spyOn(platform.http, 'post').mockResolvedValue({ data: { id: 'one' } })
  const signal = new AbortController().signal
  await edocumentsApi.importXml('<Invoice />', 'key', signal)
  expect(post).toHaveBeenCalledWith(
    '/e-documents/inbox/import',
    { xml: '<Invoice />' },
    { signal, idempotencyKey: 'key' },
  )
  await edocumentsApi.stage('<Invoice />', 'stage', signal)
  expect(post).toHaveBeenLastCalledWith(
    '/e-documents/sandbox/inbox',
    { xml: '<Invoice />' },
    { signal, idempotencyKey: 'stage' },
  )
  await edocumentsApi.pollInbox('poll', signal)
  expect(post).toHaveBeenLastCalledWith(
    '/e-documents/inbox/poll',
    {},
    { signal, idempotencyKey: 'poll' },
  )
})
it('keeps taxpayer identifiers in bounded query parameters and returns lookup data', async () => {
  const value = {
    tax_number: '1234567890',
    registered: true,
    aliases: [{ kind: 'e_invoice', alias: 'urn:mail:one' }],
    sandbox: true,
  }
  const get = vi.spyOn(platform.http, 'get').mockResolvedValue({ data: value })
  expect(await edocumentsApi.taxpayers(value.tax_number)).toEqual(value)
  expect(get).toHaveBeenCalledWith('/e-documents/taxpayers', {
    params: { tax_number: value.tax_number },
    signal: undefined,
  })
})
it('downloads raw XML without rendering remote HTML or requesting a supplied URL', async () => {
  const result = {
    blob: new Blob(['<Invoice/>'], { type: 'application/xml' }),
    filename: 'ABC.xml',
  }
  const download = vi.spyOn(platform.http, 'download').mockResolvedValue(result)
  expect(await edocumentsApi.xml('unsafe/id')).toBe(result)
  expect(download).toHaveBeenCalledWith('/e-documents/documents/unsafe%2Fid/xml', {
    signal: undefined,
  })
})
