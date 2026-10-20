import { act, screen } from '@testing-library/react'
import { renderRoute } from '@/test/render'
import { useCompanyStore } from '@/stores/company'
import { CompanySwitcher } from './CompanySwitcher'

describe('CompanySwitcher', () => {
  it('names the current company in its accessible name', () => {
    renderRoute(<CompanySwitcher />)
    expect(
      screen.getByRole('button', { name: 'Şirket değiştir, geçerli şirket: Anadolu Makina A.Ş.' }),
    ).toBeInTheDocument()

    const second = useCompanyStore.getState().companies[1]
    if (!second) throw new Error('placeholder company missing')
    act(() => useCompanyStore.getState().setActiveCompany(second.id))
    expect(
      screen.getByRole('button', { name: `Şirket değiştir, geçerli şirket: ${second.name}` }),
    ).toBeInTheDocument()
  })
})
