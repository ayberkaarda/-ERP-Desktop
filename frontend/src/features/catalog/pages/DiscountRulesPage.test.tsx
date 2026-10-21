import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PARTY_DEALER } from '@/test/handlers/catalog'
import { renderCatalog, setupCatalog } from '../testing'
import './DiscountRulesPage'

describe('DiscountRulesPage', () => {
  it('creates a party rule, validating percent range and scope reference', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/discount-rules')
    expect(await screen.findByText('Bağlantı elemanı indirimi')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Yeni kural' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Kod/), 'BAYI5')
    await user.type(within(dialog).getByLabelText(/^Ad/), 'Bayi indirimi')
    await user.selectOptions(within(dialog).getByLabelText(/^Kapsam/), 'party')
    await user.type(within(dialog).getByLabelText(/^İndirim %/), '150')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(
      await within(dialog).findByText("İndirim oranı 0'dan büyük, en fazla 100 olmalıdır."),
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Kapsam için bir kayıt seçin.')).toBeInTheDocument()

    const percent = within(dialog).getByLabelText(/^İndirim %/)
    await user.clear(percent)
    await user.type(percent, '5')
    const party = within(dialog).getByRole('combobox', { name: /^Cari/ })
    await user.type(party, 'Ege')
    await user.click(await screen.findByRole('option', { name: /Ege Bayi/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))

    await waitFor(() => expect(db.discountRules).toHaveLength(2))
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/discount-rules')
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(post?.body).toMatchObject({
      code: 'BAYI5',
      scope: 'party',
      scope_ref: PARTY_DEALER,
      party_id: null,
      discount_percent: '5.0000',
      priority: 10,
      stackable: false,
    })
  })

  it('edits and deletes a rule', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/discount-rules')
    await user.click(await screen.findByRole('button', { name: 'IND10 kuralını düzenle' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: /^Kategori/ })).toHaveValue(
        'HM.01.01 · Bağlantı',
      ),
    )
    await user.click(within(dialog).getByLabelText('Birleştirilebilir'))
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(db.discountRules[0]?.stackable).toBe(true))
    expect(db.discountRules[0]?.version).toBe(2)

    await user.click(await screen.findByRole('button', { name: 'IND10 kuralını sil' }))
    const confirm = await screen.findByRole('alertdialog')
    await user.click(within(confirm).getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(db.discountRules).toHaveLength(0))
  })
})
