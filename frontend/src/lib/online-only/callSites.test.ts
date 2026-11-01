import manifestJson from '../../../../contracts/offline-manifest.json?raw'

// Every server-only action of the offline manifest is marked at its buttons in feature code, so
// a runtime with an offline mode can disable them. The table below is the expected call-site map;
// a new manifest action, a removed wrapper or a wrapper in an unlisted file fails this test.

interface OnlineOnlyEntry {
  action: string
  i18n_key: string
}

const manifest = JSON.parse(manifestJson) as { online_only: OnlineOnlyEntry[] }
const actions = manifest.online_only.map((entry) => entry.action)

const sources = import.meta.glob<string>(
  ['/src/features/**/*.tsx', '!/src/**/*.test.tsx', '!/src/**/test/**'],
  { query: '?raw', import: 'default', eager: true },
)

/** Action -> feature files whose buttons are wrapped with that action. */
const CALL_SITES: Record<string, string[]> = {
  finalizeSalesQuote: ['/src/features/sales/quotes/components/QuoteActions.tsx'],
  confirmSalesOrder: ['/src/features/sales/orders/components/OrderActions.tsx'],
  postSalesDelivery: ['/src/features/sales/deliveries/components/DeliveryView.tsx'],
  issueSalesInvoice: ['/src/features/sales/invoices/components/InvoiceView.tsx'],
  processSalesReturn: ['/src/features/sales/returns/components/ReturnView.tsx'],
  submitPurchaseRequest: ['/src/features/purchasing/requests/components/RequestActions.tsx'],
  processPurchaseRfq: ['/src/features/purchasing/rfqs/components/RfqActions.tsx'],
  approvePurchaseOrder: ['/src/features/purchasing/orders/components/OrderActions.tsx'],
  postPurchaseReceipt: ['/src/features/purchasing/receipts/components/ReceiptView.tsx'],
  bookPurchaseInvoice: ['/src/features/purchasing/invoices/components/InvoiceView.tsx'],
  processPurchaseReturn: ['/src/features/purchasing/returns/components/ReturnView.tsx'],
  postStockDocument: ['/src/features/inventory/documents/components/DocumentView.tsx'],
  treasuryPayment: ['/src/features/treasury/shared/RecordPage.tsx'],
  sendEDocument: ['/src/features/edocuments/DocumentPage.tsx'],
  postJournalEntry: ['/src/features/accounting/journal/components/JournalEntryView.tsx'],
  closePeriod: [
    '/src/features/accounting/periods/pages/PeriodsBoardPage.tsx',
    '/src/features/accounting/fiscal/pages/FiscalYearsPage.tsx',
  ],
  serverCalculation: ['/src/features/catalog/pages/PricingPlaygroundPage.tsx'],
  liveReports: [
    '/src/features/accounting/reports/pages/TrialBalancePage.tsx',
    '/src/features/accounting/reports/pages/GeneralLedgerPage.tsx',
  ],
}

/** Manifest actions with no button in the web app yet (and why). */
const NO_WEB_CALL_SITE: Record<string, string> = {
  decideApproval: 'no screen posts /approvals/{id}/decisions; approvals are only displayed',
}

// The action is the first prop, so a plain scan finds it without parsing JSX.
const BUTTON = /<OnlineOnlyButton\b/g
const BUTTON_ACTION = /<OnlineOnlyButton\s+action="([^"]+)"/g
const HOOK_ACTION = /useOnlineOnly\(\s*'([^']+)'\s*\)/g

function actionsIn(source: string): Set<string> {
  const found = new Set<string>()
  for (const match of source.matchAll(BUTTON_ACTION)) found.add(match[1] ?? '')
  for (const match of source.matchAll(HOOK_ACTION)) found.add(match[1] ?? '')
  return found
}

function filesUsing(action: string): string[] {
  return Object.entries(sources)
    .filter(([, source]) => actionsIn(source).has(action))
    .map(([file]) => file)
    .sort()
}

describe('online-only call sites', () => {
  it('reads the manifest and the feature sources', () => {
    expect(actions.length).toBeGreaterThan(0)
    expect(Object.keys(sources)).toContain('/src/features/sales/quotes/components/QuoteActions.tsx')
    expect(actionsIn('<OnlineOnlyButton action="a" x={1}>')).toEqual(new Set(['a']))
    expect(actionsIn("const s = useOnlineOnly('b')")).toEqual(new Set(['b']))
  })

  it('every manifest action has a call site or a stated reason', () => {
    const missing = actions.filter((a) => !(a in CALL_SITES) && !(a in NO_WEB_CALL_SITE))
    expect(missing).toEqual([])
  })

  it('the tables name only manifest actions, each once', () => {
    const listed = [...Object.keys(CALL_SITES), ...Object.keys(NO_WEB_CALL_SITE)]
    expect(listed.filter((a) => !actions.includes(a))).toEqual([])
    expect(new Set(listed).size).toBe(listed.length)
  })

  it.each(Object.entries(CALL_SITES))(
    '%s is wrapped exactly in its listed files',
    (action, files) => {
      for (const file of files) expect(Object.keys(sources)).toContain(file)
      expect(filesUsing(action)).toEqual([...files].sort())
    },
  )

  it.each(Object.keys(NO_WEB_CALL_SITE))('%s has no call site yet', (action) => {
    expect(filesUsing(action)).toEqual([])
  })

  it('feature code uses only manifest action names', () => {
    const unknown = Object.entries(sources).flatMap(([file, source]) =>
      [...actionsIn(source)].filter((a) => !actions.includes(a)).map((a) => `${file}: ${a}`),
    )
    expect(unknown).toEqual([])
  })

  it('every OnlineOnlyButton names its action as the first prop', () => {
    const loose = Object.entries(sources)
      .filter(
        ([, source]) =>
          (source.match(BUTTON) ?? []).length !== [...source.matchAll(BUTTON_ACTION)].length,
      )
      .map(([file]) => file)
    expect(loose).toEqual([])
  })

  it('every manifest action keeps its desktop translation key', () => {
    for (const entry of manifest.online_only)
      expect(entry.i18n_key).toBe(`desktop.onlineOnly.${entry.action}`)
  })
})
