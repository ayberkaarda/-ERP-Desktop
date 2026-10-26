import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/platform'
import { useCompanyStore } from '@/stores/company'
import { useAuthStore } from '@/stores/auth'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { edocumentsApi } from './api'
import { edocumentsRoutes } from './routes'
import { EDocumentSourceLinks } from './SourceLinks'
import type { EDocument, Page, ProviderStatus, Source } from './types'
import labels from '@/lib/i18n/locales/edocuments/tr.json'

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('Missing test fixture')
  return value
}
const docNumber = 'ABC2026000000001'
const id = '01920000-0000-7000-8000-123456789012'
const sourceId = '01920000-0000-7000-8000-123456789013'
const source: Source = {
  id: sourceId,
  number: 'INV2026000000001',
  document_date: '2026-10-23',
  party_name: 'Ada Teknoloji',
  currency_code: 'TRY',
  total: '1200.0000',
  version: 3,
}
const status: ProviderStatus = {
  driver: 'sandbox',
  mode: 'sandbox',
  available: true,
  validation_available: true,
  live_enabled: false,
}
const base: EDocument = {
  id,
  company_id: 'company',
  direction: 'outgoing',
  kind: 'e_invoice',
  profile: 'TEMELFATURA',
  status: 'ready',
  uuid: id,
  number: 'ABC2026000000001',
  series: 'ABC',
  document_date: '2026-10-23',
  currency_code: 'TRY',
  total: '1200.0000',
  party_name: 'Ada Teknoloji',
  source_id: sourceId,
  source_type: 'invoice',
  source_number: source.number,
  purchase_invoice_id: null,
  version: 4,
  sandbox: true,
  validation: { valid: true, available: true, errors: [], warnings: [] },
  snapshot: {
    supplier: {
      name: 'Keystone AŞ',
      tax_number: '1234567890',
      address: { street: 'Ankara Cad.', city: 'Ankara', country_code: 'TR' },
    },
    customer: { name: 'Ada Teknoloji', tax_number: '9876543210' },
    lines: [
      {
        id: '1',
        name: 'Cihaz',
        quantity: '2.000000',
        unit_code: 'C62',
        unit_price: '500.0000',
        net_amount: '1000.0000',
        tax_amount: '200.0000',
        total: '1200.0000',
      },
    ],
  },
  metadata: {},
  events: [],
  created_at: '2026-10-23T12:00:00Z',
  updated_at: '2026-10-23T12:00:00Z',
}
function page<T>(data: T[], current = 1, last = 1): Page<T> {
  return {
    data,
    meta: {
      pagination: { current_page: current, last_page: last, per_page: 25, total: data.length },
    },
  }
}
const full = [
  'edocuments.view',
  'edocuments.create',
  'edocuments.validate',
  'edocuments.send',
  'edocuments.respond',
  'edocuments.import',
  'edocuments.manage',
  'sales.invoices.view',
  'sales.deliveries.view',
  'purchasing.invoices.view',
]
function setup(permissions = full, record: EDocument = base) {
  const db = setupFea()
  for (const company of db.companies) db.permissions[company.id] = permissions
  signIn(db)
  vi.spyOn(edocumentsApi, 'status').mockResolvedValue(status)
  vi.spyOn(edocumentsApi, 'list').mockResolvedValue(page([record]))
  vi.spyOn(edocumentsApi, 'sources').mockResolvedValue(page([source]))
  vi.spyOn(edocumentsApi, 'get').mockResolvedValue(record)
  vi.spyOn(edocumentsApi, 'create').mockResolvedValue(record)
  vi.spyOn(edocumentsApi, 'action').mockResolvedValue({
    ...record,
    status: 'sent',
    version: record.version + 1,
  })
  vi.spyOn(edocumentsApi, 'update').mockResolvedValue({ ...record, version: record.version + 1 })
  vi.spyOn(edocumentsApi, 'purchaseInvoices').mockResolvedValue(
    page([
      {
        id: sourceId,
        number: 'PUR2026000000001',
        party_name: 'Ada Teknoloji',
        total: '1200.0000',
        currency_code: 'TRY',
      },
    ]),
  )
  return db
}
afterEach(() => vi.restoreAllMocks())
const detail = () => renderRoutes(edocumentsRoutes, `/edocuments/documents/${id}`)

it('renders the sandbox warning and server-filtered, paginated outbox', async () => {
  setup()
  vi.mocked(edocumentsApi.list).mockResolvedValue(page([base], 1, 2))
  renderRoutes(edocumentsRoutes, '/edocuments/outbox')
  expect(await screen.findByRole('link', { name: docNumber })).toBeVisible()
  expect(screen.getByText(labels.sandboxDescription)).toBeVisible()
  await userEvent.type(screen.getByLabelText(labels.search), 'Ada')
  await waitFor(() =>
    expect(edocumentsApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: 'Ada', direction: 'outgoing', page: 1 }),
      expect.any(AbortSignal),
    ),
  )
  await userEvent.click(screen.getByRole('button', { name: labels.next }))
  await waitFor(() =>
    expect(edocumentsApi.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
      expect.any(AbortSignal),
    ),
  )
})
it('hides creating and importing actions for a read-only user', async () => {
  setup(['edocuments.view'])
  renderRoutes(edocumentsRoutes, '/edocuments/inbox')
  await screen.findByRole('link', { name: docNumber })
  expect(screen.queryByRole('button', { name: labels.importXml })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: labels.pollInbox })).not.toBeInTheDocument()
})
it('searches all source pages and creates a typed public-sector draft', async () => {
  setup()
  vi.mocked(edocumentsApi.sources).mockImplementation((_kind, _search, current) =>
    Promise.resolve(page(current === 1 ? [] : [source], current, 2)),
  )
  renderRoutes(edocumentsRoutes, '/edocuments/outbox/new')
  await userEvent.selectOptions(await screen.findByLabelText(labels.profile), 'KAMU')
  await userEvent.type(screen.getByLabelText(labels.payment_iban), 'TR330006100519786457841326')
  await waitFor(() => expect(screen.getByRole('button', { name: labels.next })).toBeEnabled())
  await userEvent.click(screen.getByRole('button', { name: labels.next }))
  await waitFor(() => expect(screen.getByLabelText(labels.source)).toBeEnabled())
  await userEvent.selectOptions(screen.getByLabelText(labels.source), source.id)
  await userEvent.click(screen.getByRole('button', { name: labels.create }))
  await waitFor(() =>
    expect(edocumentsApi.create).toHaveBeenCalledWith(
      {
        source_id: sourceId,
        kind: 'e_invoice',
        profile: 'KAMU',
        series: 'ABC',
        metadata: { payment_iban: 'TR330006100519786457841326' },
      },
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
})
it('prefills a source integration link without truncating source selection to its first page', async () => {
  setup()
  vi.mocked(edocumentsApi.sources).mockResolvedValue(page([]))
  renderRoutes(
    edocumentsRoutes,
    `/edocuments/outbox/new?kind=e_archive&source_id=${sourceId}&source_number=INV1`,
  )
  await waitFor(() => expect(screen.getByLabelText(labels.source)).toHaveValue(sourceId))
  expect(screen.getByLabelText(labels.profile)).toHaveValue('EARSIVFATURA')
  expect(screen.getByRole('option', { name: 'INV1' })).toBeInTheDocument()
})
it('does not submit a populated draft when navigating source pages', async () => {
  setup()
  vi.mocked(edocumentsApi.sources).mockResolvedValue(page([source], 1, 2))
  renderRoutes(edocumentsRoutes, '/edocuments/outbox/new')
  await waitFor(() => expect(screen.getByLabelText(labels.source)).toBeEnabled())
  await userEvent.selectOptions(screen.getByLabelText(labels.source), source.id)
  await userEvent.click(screen.getByRole('button', { name: labels.next }))
  await waitFor(() =>
    expect(edocumentsApi.sources).toHaveBeenCalledWith('e_invoice', '', 2, expect.any(AbortSignal)),
  )
  expect(edocumentsApi.create).not.toHaveBeenCalled()
})
it('requires an explicit confirmation before sandbox submission and sends the current version', async () => {
  setup()
  detail()
  await screen.findByRole('heading', { name: docNumber })
  await userEvent.click(screen.getByRole('button', { name: labels.send }))
  expect(edocumentsApi.action).not.toHaveBeenCalled()
  const modal = screen.getByRole('alertdialog')
  expect(within(modal).getByText(labels.sendConfirm)).toBeVisible()
  await userEvent.click(within(modal).getByRole('button', { name: labels.send }))
  await waitFor(() =>
    expect(edocumentsApi.action).toHaveBeenCalledWith(
      id,
      'send',
      { version: 4 },
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
})
it('blocks submission when official validation is unavailable even if a cached document was ready', async () => {
  setup()
  vi.mocked(edocumentsApi.status).mockResolvedValue({ ...status, validation_available: false })
  detail()
  expect(await screen.findByRole('button', { name: labels.send })).toBeDisabled()
  expect(screen.getByText(labels.validatorUnavailable)).toBeVisible()
})
it('offers no sending, responding or metadata edits without their permissions', async () => {
  setup(['edocuments.view', 'sales.invoices.view'])
  detail()
  await screen.findByRole('heading', { name: docNumber })
  expect(screen.queryByRole('button', { name: labels.send })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: labels.validate })).not.toBeInTheDocument()
  expect(screen.queryByText(labels.editMetadata)).not.toBeInTheDocument()
})
it('shows validation failures and edits a draft with a versioned typed address payload', async () => {
  setup(full, {
    ...base,
    number: null,
    status: 'invalid',
    validation: {
      valid: false,
      available: true,
      errors: [
        { code: 'ADDRESS_REQUIRED', message: 'Address is missing', path: 'supplier.address' },
      ],
      warnings: [],
    },
  })
  detail()
  expect(await screen.findByText('Address is missing')).toBeVisible()
  await userEvent.click(screen.getByText(labels.editMetadata))
  await userEvent.click(screen.getByText(labels.additionalDetails))
  const supplier = screen.getByRole('group', { name: labels.supplier_address })
  await userEvent.type(within(supplier).getByLabelText(labels.street), 'Atatürk Cad.')
  await userEvent.click(screen.getByRole('button', { name: labels.save }))
  await waitFor(() =>
    expect(edocumentsApi.update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        version: 4,
        metadata: { supplier_address: { street: 'Atatürk Cad.' } },
      }),
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
})
it('renders hostile snapshot text without executing HTML or using a dynamic XSLT', async () => {
  setup(full, {
    ...base,
    snapshot: {
      supplier: { name: '<img src=x onerror=alert(1)>' },
      lines: [{ id: '1', name: '<script>alert(1)</script>' }],
    },
  })
  detail()
  await screen.findByRole('heading', { name: docNumber })
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument()
  expect(document.querySelector('img')).toBeNull()
  expect(document.querySelector('iframe')).toBeNull()
  expect(document.querySelector('script')).toBeNull()
})
it('accepts or rejects only an incoming delivered commercial invoice with confirmation', async () => {
  setup(full, {
    ...base,
    direction: 'incoming',
    profile: 'TICARIFATURA',
    status: 'delivered',
    source_id: null,
  })
  detail()
  await screen.findByRole('heading', { name: docNumber })
  expect(screen.getByRole('button', { name: labels.reject })).toBeDisabled()
  await userEvent.type(screen.getByLabelText(labels.reason), 'Yanlış alıcı')
  await userEvent.click(screen.getByRole('button', { name: labels.reject }))
  await userEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: labels.reject }),
  )
  await waitFor(() =>
    expect(edocumentsApi.action).toHaveBeenCalledWith(
      id,
      'respond',
      { version: 4, decision: 'reject', reason: 'Yanlış alıcı' },
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
})
it('does not offer commercial response actions for a basic incoming invoice', async () => {
  setup(full, {
    ...base,
    direction: 'incoming',
    profile: 'TEMELFATURA',
    status: 'delivered',
    source_id: null,
  })
  detail()
  await screen.findByRole('heading', { name: docNumber })
  expect(screen.queryByRole('button', { name: labels.accept })).not.toBeInTheDocument()
})
it('links an existing purchase invoice explicitly without creating or posting one', async () => {
  setup(full, { ...base, direction: 'incoming', status: 'delivered', source_id: null })
  detail()
  await screen.findByRole('heading', { name: docNumber })
  await userEvent.click(screen.getByRole('button', { name: labels.linkPurchase }))
  await waitFor(() => expect(screen.getByRole('option', { name: /PUR2026/ })).toBeInTheDocument())
  await userEvent.selectOptions(screen.getByLabelText(labels.purchaseInvoice), sourceId)
  await userEvent.click(
    required(screen.getAllByRole('button', { name: labels.linkPurchase }).at(-1)),
  )
  await waitFor(() =>
    expect(edocumentsApi.action).toHaveBeenCalledWith(
      id,
      'link-purchase',
      { version: 4, purchase_invoice_id: sourceId },
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
})
it('imports XML using a logical idempotency key and shows local-only import semantics', async () => {
  setup()
  vi.spyOn(edocumentsApi, 'importXml').mockResolvedValue({ ...base, direction: 'incoming' })
  renderRoutes(edocumentsRoutes, '/edocuments/inbox')
  await screen.findByRole('heading', { name: labels.inbox })
  await userEvent.click(screen.getByRole('button', { name: labels.importXml }))
  await userEvent.type(screen.getByLabelText(labels.xmlContent), '<Invoice />')
  expect(screen.getByText(labels.importHelp)).toBeVisible()
  await userEvent.click(required(screen.getAllByRole('button', { name: labels.importXml }).at(-1)))
  await waitFor(() =>
    expect(edocumentsApi.importXml).toHaveBeenCalledWith(
      '<Invoice />',
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
})
it('surfaces inbox validation failures instead of treating a zero-import poll as success', async () => {
  setup()
  vi.spyOn(edocumentsApi, 'pollInbox').mockResolvedValue({
    imported: 0,
    documents: [],
    errors: [{ id, message: 'Recipient mismatch' }],
  })
  renderRoutes(edocumentsRoutes, '/edocuments/inbox')
  await screen.findByRole('heading', { name: labels.inbox })
  await userEvent.click(screen.getByRole('button', { name: labels.pollInbox }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Recipient mismatch')
})
it('clears unfinished import data when the company changes', async () => {
  const db = setup()
  renderRoutes(edocumentsRoutes, '/edocuments/inbox')
  await screen.findByRole('heading', { name: labels.inbox })
  await userEvent.click(screen.getByRole('button', { name: labels.importXml }))
  await userEvent.type(screen.getByLabelText(labels.xmlContent), '<Private>old company</Private>')
  void act(() => useCompanyStore.setState({ activeCompanyId: required(db.companies[1]).id }))
  await waitFor(() => expect(screen.queryByLabelText(labels.xmlContent)).not.toBeInTheDocument())
})
it('invalidates the feature cache scope when source permissions are revoked', async () => {
  const db = setup()
  const firstCompany = required(useCompanyStore.getState().activeCompanyId)
  detail()
  await screen.findByRole('heading', { name: docNumber })
  vi.mocked(edocumentsApi.get).mockRejectedValue(
    new ApiError(403, 'FORBIDDEN', 'Source access revoked'),
  )
  act(() =>
    useAuthStore.setState({
      permissions: { ...db.permissions, [firstCompany]: ['edocuments.view'] },
    }),
  )
  expect(await screen.findByText('Source access revoked')).toBeVisible()
  expect(screen.queryByRole('heading', { name: docNumber })).not.toBeInTheDocument()
})
it.each([
  { httpStatus: 0, same: true },
  { httpStatus: 422, same: false },
])(
  'handles retry keys after HTTP $httpStatus without duplicating an ambiguous logical request',
  async ({ httpStatus, same }) => {
    setup()
    vi.mocked(edocumentsApi.action).mockRejectedValue(
      new ApiError(httpStatus, 'TEST_ERROR', 'Retry test'),
    )
    detail()
    await screen.findByRole('heading', { name: docNumber })
    for (let i = 0; i < 2; i++) {
      await userEvent.click(screen.getByRole('button', { name: labels.send }))
      await userEvent.click(
        within(screen.getByRole('alertdialog')).getByRole('button', { name: labels.send }),
      )
      await waitFor(() => expect(edocumentsApi.action).toHaveBeenCalledTimes(i + 1))
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    }
    const calls = vi.mocked(edocumentsApi.action).mock.calls
    expect(required(calls[0])[3] === required(calls[1])[3]).toBe(same)
  },
)
it('does not present placeholder money as an amount on an incoming despatch advice', async () => {
  setup(full, {
    ...base,
    direction: 'incoming',
    kind: 'e_despatch',
    profile: 'TEMELIRSALIYE',
    currency_code: 'XXX',
    total: '0',
    status: 'delivered',
    source_id: null,
  })
  detail()
  await screen.findByRole('heading', { name: docNumber })
  expect(screen.getAllByLabelText(labels.notApplicable)).toHaveLength(2)
  expect(screen.queryByText('XXX')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: labels.linkPurchase })).not.toBeInTheDocument()
  expect(screen.queryByRole('columnheader', { name: labels.unitPrice })).not.toBeInTheDocument()
})
it('provides encoded source links only to users with both source and e-document permissions', () => {
  setup()
  renderRoutes([
    { path: '/', element: <EDocumentSourceLinks id={sourceId} number="INV & 1" kind="invoice" /> },
  ])
  expect(
    screen.getByRole('link', { name: labels.prepare_e_invoice }).getAttribute('href'),
  ).toContain('source_number=INV+%26+1')
  expect(screen.getByRole('link', { name: labels.prepare_e_archive })).toBeVisible()
})

it('requires a reason and confirmation for local-only cancellation', async () => {
  setup(full, { ...base, number: null, status: 'draft' })
  detail()
  await screen.findByRole('heading', { name: labels.unnumbered })
  expect(screen.getByRole('button', { name: labels.cancelLocal })).toBeDisabled()
  await userEvent.type(screen.getByLabelText(labels.cancelReason), 'Yanlış belge türü')
  await userEvent.click(screen.getByRole('button', { name: labels.cancelLocal }))
  const dialog = screen.getByRole('alertdialog')
  expect(within(dialog).getByText(labels.cancelConfirm)).toBeVisible()
  await userEvent.click(within(dialog).getByRole('button', { name: labels.cancelLocal }))
  await waitFor(() =>
    expect(edocumentsApi.action).toHaveBeenCalledWith(
      id,
      'cancel',
      { version: 4, reason: 'Yanlış belge türü' },
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
})
it('simulates a local outcome using the current document version', async () => {
  setup(full, { ...base, status: 'sent' })
  vi.spyOn(edocumentsApi, 'outcome').mockResolvedValue({ ...base, status: 'sent', version: 5 })
  detail()
  await screen.findByRole('heading', { name: docNumber })
  await userEvent.selectOptions(screen.getByLabelText(labels.outcome), 'rejected')
  await userEvent.click(screen.getByRole('button', { name: labels.applyOutcome }))
  await waitFor(() =>
    expect(edocumentsApi.outcome).toHaveBeenCalledWith(
      id,
      'rejected',
      4,
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
})
it('looks up and manages only local sandbox taxpayer aliases', async () => {
  setup()
  vi.spyOn(edocumentsApi, 'taxpayers').mockResolvedValue({
    tax_number: '1234567890',
    registered: false,
    aliases: [],
    sandbox: true,
  })
  vi.spyOn(edocumentsApi, 'directory').mockResolvedValue({
    tax_number: '1234567890',
    registered: true,
    aliases: [{ alias: 'urn:mail:test@example.test', kind: 'e_invoice' }],
    sandbox: true,
  })
  renderRoutes(edocumentsRoutes, '/edocuments/taxpayers')
  await screen.findByRole('heading', { name: labels.taxpayers })
  await userEvent.type(required(screen.getAllByLabelText(labels.taxNumber)[0]), '1234567890')
  await userEvent.click(screen.getByRole('button', { name: labels.lookup }))
  expect(await screen.findByText(labels.notRegistered)).toBeVisible()
  await userEvent.type(screen.getByLabelText(labels.name), 'Deneme Şirketi')
  await userEvent.type(screen.getByLabelText(labels.alias), 'urn:mail:test@example.test')
  await userEvent.click(screen.getByRole('button', { name: labels.saveDirectory }))
  await waitFor(() =>
    expect(edocumentsApi.directory).toHaveBeenCalledWith(
      {
        tax_number: '1234567890',
        name: 'Deneme Şirketi',
        aliases: [{ kind: 'e_invoice', alias: 'urn:mail:test@example.test' }],
      },
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
})
it('aborts an in-flight write and ignores its result when the company changes', async () => {
  const db = setup()
  const firstCompany = useCompanyStore.getState().activeCompanyId
  let finish: (record: EDocument) => void = () => undefined
  vi.mocked(edocumentsApi.action).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  vi.mocked(edocumentsApi.get).mockImplementation(() => {
    if (useCompanyStore.getState().activeCompanyId !== firstCompany)
      throw new ApiError(404, 'NOT_FOUND', 'Other company has no document')
    return Promise.resolve(base)
  })
  detail()
  await screen.findByRole('heading', { name: docNumber })
  await userEvent.click(screen.getByRole('button', { name: labels.send }))
  await userEvent.click(
    within(screen.getByRole('alertdialog')).getByRole('button', { name: labels.send }),
  )
  await waitFor(() => expect(edocumentsApi.action).toHaveBeenCalled())
  const signal = required(required(vi.mocked(edocumentsApi.action).mock.calls[0])[4])
  void act(() => useCompanyStore.setState({ activeCompanyId: required(db.companies[1]).id }))
  expect(signal.aborted).toBe(true)
  act(() => finish({ ...base, status: 'sent' }))
  expect(await screen.findByText('Other company has no document')).toBeVisible()
  expect(screen.queryByRole('heading', { name: docNumber })).not.toBeInTheDocument()
})
