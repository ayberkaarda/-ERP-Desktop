import { useCompanyStore } from './company'

const a = { id: 'a', name: 'A', roleNames: [] }
const b = { id: 'b', name: 'B', roleNames: [] }

describe('company store', () => {
  beforeEach(() => useCompanyStore.setState({ companies: [], activeCompanyId: null }))

  it('keeps a remembered company only while it is still a membership', () => {
    useCompanyStore.setState({ activeCompanyId: 'b' })
    useCompanyStore.getState().setCompanies([a, b])
    expect(useCompanyStore.getState().activeCompanyId).toBe('b')

    useCompanyStore.getState().setCompanies([a])
    expect(useCompanyStore.getState().activeCompanyId).toBe('a')

    useCompanyStore.getState().setCompanies([])
    expect(useCompanyStore.getState().activeCompanyId).toBeNull()
  })

  it('refuses to activate a company the user does not belong to', () => {
    useCompanyStore.getState().setCompanies([a])
    useCompanyStore.getState().setActiveCompany('zzz')
    expect(useCompanyStore.getState().activeCompanyId).toBe('a')
  })
})
