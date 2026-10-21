import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { U_BOX, U_PCS } from '@/test/handlers/catalog'
import { renderCatalog, setupCatalog } from '../testing'
// Loaded up front so the lazy route resolves without a chunk delay.
import './UnitsPage'

describe('UnitsPage', () => {
  it('creates a unit with an Idempotency-Key and shows server field errors', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/units')

    expect(await screen.findByText('Kilogram')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Yeni birim' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Kod/), 'KG')
    await user.type(within(dialog).getByLabelText(/^Ad/), 'Kilo')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(await within(dialog).findAllByText('Bu kod zaten kullanılıyor.')).not.toHaveLength(0)

    const code = within(dialog).getByLabelText(/^Kod/)
    await user.clear(code)
    await user.type(code, 'PKT')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const posts = db.calls.filter((c) => c.method === 'POST' && c.path === '/units')
    expect(posts).toHaveLength(2)
    expect(posts[0]?.headers.get('Idempotency-Key')).toBeTruthy()
    // A changed body is a new logical submit: it must not reuse the key.
    expect(posts[1]?.headers.get('Idempotency-Key')).not.toBe(
      posts[0]?.headers.get('Idempotency-Key'),
    )
    expect(db.units.some((u) => u.code === 'PKT')).toBe(true)
  })

  it('offers a reload on a version conflict', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/units')
    await user.click(await screen.findByRole('button', { name: 'KG birimini düzenle' }))
    const dialog = await screen.findByRole('dialog')
    // Someone else saves first.
    const kg = db.units.find((u) => u.code === 'KG')
    if (kg) {
      kg.version = 5
      kg.name = 'Kilogram (güncel)'
    }
    const name = within(dialog).getByLabelText(/^Ad/)
    await user.clear(name)
    await user.type(name, 'Kg')
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    expect(
      await within(dialog).findByText('Kayıt başka biri tarafından değiştirildi'),
    ).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Kaydet' })).toBeDisabled()
    await user.click(within(dialog).getByRole('button', { name: 'Son hâli yükle' }))
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^Ad/)).toHaveValue('Kilogram (güncel)'),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(kg?.version).toBe(6)
  })

  it('edits the conversion matrix: factor must be above zero, saves new rows', async () => {
    const db = setupCatalog()
    const user = userEvent.setup()
    renderCatalog('/catalog/units?tab=conversions')

    const cell = await screen.findByLabelText('1 KOLI kaç ADET')
    // The stored KG>GR row implies GR>KG.
    expect(screen.getByLabelText('1 GR kaç KG')).toHaveAttribute('placeholder', '≈ 0,001')
    const save = screen.getByRole('button', { name: 'Dönüşümleri kaydet' })
    expect(save).toBeDisabled()

    await user.type(cell, '0')
    expect(await screen.findByText('Çarpan sıfırdan büyük olmalıdır.')).toBeInTheDocument()
    expect(cell).toHaveAttribute('aria-invalid', 'true')
    expect(save).toBeDisabled()

    await user.clear(cell)
    await user.type(cell, '12')
    expect(screen.queryByText('Çarpan sıfırdan büyük olmalıdır.')).not.toBeInTheDocument()
    expect(screen.getByText('1 değişiklik kaydedilmedi')).toBeInTheDocument()
    await user.click(save)

    await waitFor(() =>
      expect(db.conversions.some((c) => c.from_unit_id === U_BOX && c.to_unit_id === U_PCS)).toBe(
        true,
      ),
    )
    const post = db.calls.find((c) => c.method === 'POST' && c.path === '/unit-conversions')
    expect(post?.body).toEqual({ from_unit_id: U_BOX, to_unit_id: U_PCS, factor: '12.000000' })
    expect(post?.headers.get('Idempotency-Key')).toBeTruthy()
    expect(await screen.findByText('Kaydedilmemiş değişiklik yok')).toBeInTheDocument()
  })

  it('is forbidden without units.manage', async () => {
    setupCatalog({ permissions: ['items.view'] })
    renderCatalog('/catalog/units')
    expect(await screen.findByRole('alert')).toHaveTextContent(/yetki|izin/i)
  })
})
