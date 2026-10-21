import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { setupReference, renderReference } from '@/test/handlers/referenceRender'
import { TaxCodesPage } from './TaxCodesPage'

describe('TaxCodesPage', () => {
  it('groups codes by type and shows only codes effective on the chosen date', async () => {
    setupReference()
    const user = userEvent.setup()
    renderReference(<TaxCodesPage />)

    expect(await screen.findByRole('heading', { name: /KDV/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Tevkifat/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Diğer/ })).toBeInTheDocument()
    expect(screen.getByText('KDV20')).toBeInTheDocument()
    expect(screen.getByText('5/10')).toBeInTheDocument()
    // KDV18 ended in 2023.
    expect(screen.queryByText('KDV18')).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: /Yalnızca bu tarihte geçerli/ }))
    const row = (await screen.findByText('KDV18')).closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Süresi doldu')).toBeInTheDocument()
  })

  it('marks global rows read-only with a lock and offers editing for custom rows only', async () => {
    setupReference()
    renderReference(<TaxCodesPage />)

    const global = (await screen.findByText('KDV20')).closest('tr') as HTMLElement
    expect(within(global).getByText('Genel kod (salt okunur)')).toBeInTheDocument()
    expect(within(global).queryByRole('button')).not.toBeInTheDocument()

    const custom = screen.getByText('OZEL1').closest('tr') as HTMLElement
    expect(
      within(custom).getByRole('button', { name: 'OZEL1 kaydını düzenle' }),
    ).toBeInTheDocument()
    expect(within(custom).queryByText('Genel kod (salt okunur)')).not.toBeInTheDocument()
  })

  it('does not offer custom code actions to a read-only user', async () => {
    setupReference({ permissions: ['tax_codes.view'] })
    renderReference(<TaxCodesPage />)
    await screen.findByText('OZEL1')
    expect(screen.queryByRole('button', { name: 'Özel vergi kodu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /düzenle/ })).not.toBeInTheDocument()
  })

  it('creates a custom VAT code and requires the fraction for withholding', async () => {
    const db = setupReference()
    const user = userEvent.setup()
    renderReference(<TaxCodesPage />)

    await user.click(await screen.findByRole('button', { name: 'Özel vergi kodu' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByLabelText(/^Pay\b/)).not.toBeInTheDocument()

    await user.selectOptions(within(dialog).getByLabelText(/^Tür/), 'withholding')
    expect(within(dialog).getByLabelText(/^Pay\b/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/^Kod/), 'tev-2-10')
    await user.type(within(dialog).getByLabelText(/^Ad\b/), 'Özel tevkifat')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect((await within(dialog).findAllByText('Bu alan zorunludur.')).length).toBe(2)

    await user.type(within(dialog).getByLabelText(/^Pay\b/), '2')
    await user.type(within(dialog).getByLabelText(/^Payda\b/), '10')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/tax-codes')
    expect(post?.body).toMatchObject({
      type: 'withholding',
      code: 'TEV-2-10',
      numerator: 2,
      denominator: 10,
      rate: null,
    })
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
  })
})
