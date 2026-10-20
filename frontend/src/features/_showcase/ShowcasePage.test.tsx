import { screen } from '@testing-library/react'
import { renderRoute } from '@/test/render'
import { devRoutes } from '@/app/devRoutes'
import { ShowcasePage } from './ShowcasePage'

describe('ShowcasePage', () => {
  it('renders every component section with sample data', async () => {
    renderRoute(<ShowcasePage />, '/showcase')
    expect(screen.getByRole('heading', { level: 1, name: 'Bileşen vitrini' })).toBeInTheDocument()
    expect(await screen.findByText('120.0001', {}, { timeout: 3000 })).toBeInTheDocument()
    for (const name of [
      'Veri tablosu',
      'Form takımı',
      'Belge satırları',
      'Ek paneli',
      'Onay zaman çizelgesi',
    ]) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
    expect(await screen.findByRole('link', { name: 'teklif.pdf' })).toBeInTheDocument()
  })

  it('is registered only in dev builds', () => {
    expect(devRoutes.map((r) => r.path)).toEqual(import.meta.env.DEV ? ['showcase'] : [])
  })
})
