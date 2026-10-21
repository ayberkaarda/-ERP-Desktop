import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { makeParty } from '@/test/handlers/parties'
import { must, renderParties, setupParties } from '../testUtils'

// The required marker is part of the accessible name ("Ad (zorunlu)").
const isName = (n: string) => n.startsWith('Ad(') || n.startsWith('Ad (')
const findName = () => screen.findByRole('textbox', { name: isName })
const getName = () => screen.getByRole('textbox', { name: isName })

describe('party create form', () => {
  it('hints the tax number rule, warns about duplicates and creates with an idempotency key', async () => {
    const existing = makeParty({
      code: 'P000007',
      name: 'Anadolu Makina',
      tax_number: '1234567890',
    })
    const db = setupParties({ parties: [existing] })
    const user = userEvent.setup()
    const { router } = renderParties('/parties/new')

    const name = await findName()
    expect(name).toHaveFocus()
    const tax = screen.getByLabelText('Vergi / kimlik no')
    expect(screen.getByText('10 haneli vergi kimlik numarası')).toBeInTheDocument()

    await user.type(tax, '1234567891')
    await user.tab()
    expect(
      await screen.findByText('Vergi kimlik numarası geçersiz (kontrol hanesi tutmuyor).'),
    ).toBeInTheDocument()
    expect(tax).toHaveAttribute('aria-invalid', 'true')

    // Switching to a person changes the rule and re-checks what is typed.
    await user.click(screen.getByRole('radio', { name: 'Gerçek kişi' }))
    expect(await screen.findByText('T.C. kimlik numarası 11 haneli olmalı.')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: 'Tüzel kişi' }))

    await user.clear(tax)
    await user.type(tax, '1234567890')
    const warning = await screen.findByText('Benzer cari kayıtları var', {}, { timeout: 2000 })
    const box = must(warning.closest<HTMLElement>('[role="status"]'))
    expect(within(box).getByRole('link', { name: /Anadolu Makina/ })).toBeInTheDocument()
    expect(within(box).getByText('(aynı vergi no)')).toBeInTheDocument()

    // The warning does not block: the server still refuses the duplicate and the error lands on the field.
    await user.type(name, 'Yeni Firma')
    await user.click(screen.getByRole('button', { name: 'Oluştur' }))
    expect(
      await screen.findAllByText('Bu vergi numarasıyla kayıtlı aktif bir cari var.'),
    ).not.toHaveLength(0)
    const firstKey = db.calls.find((c) => c.method === 'POST')?.headers.get('Idempotency-Key')
    expect(firstKey).toBeTruthy()

    await user.clear(tax)
    await user.click(screen.getByRole('button', { name: 'Oluştur' }))
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/parties\/.+\/edit$/))
    const posts = db.calls.filter((c) => c.method === 'POST')
    // Retrying the same logical submit reuses the key.
    expect(posts.at(-1)?.headers.get('Idempotency-Key')).toBe(firstKey)
    expect(db.parties.find((p) => p.name === 'Yeni Firma')).toMatchObject({
      roles: ['customer'],
      country: 'TR',
      tax_number: null,
    })
  })

  it('requires a role', async () => {
    setupParties()
    const user = userEvent.setup()
    renderParties('/parties/new')
    await user.type(await findName(), 'X')
    await user.click(screen.getByRole('checkbox', { name: 'Müşteri' }))
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(await screen.findByText('En az bir rol seçin.')).toBeInTheDocument()
  })
})

describe('party edit form', () => {
  it('surfaces a version conflict and reloads the latest copy', async () => {
    const party = makeParty({ name: 'Ege Tekstil', version: 3 })
    const db = setupParties({ parties: [party] })
    const user = userEvent.setup()
    renderParties(`/parties/${party.id}/edit`)

    const name = await findName()
    expect(name).toHaveValue('Ege Tekstil')
    // Someone else saves in the meantime.
    Object.assign(db.parties[0] as object, { name: 'Ege Tekstil San.', version: 4 })

    await user.clear(name)
    await user.type(name, 'Ege Tekstil A.Ş.')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Kayıt başka biri tarafından değiştirildi')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Son hâli yükle' }))
    await waitFor(() => expect(getName()).toHaveValue('Ege Tekstil San.'))

    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByText('Değişiklikler kaydedildi.')).toBeInTheDocument()
    const patches = db.calls.filter((c) => c.method === 'PATCH')
    expect((patches.at(-1)?.body as { version: number }).version).toBe(4)
  })
})
