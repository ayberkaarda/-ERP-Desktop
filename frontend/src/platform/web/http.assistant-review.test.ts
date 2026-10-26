import { waitFor } from '@testing-library/react'
import { createWebHttp } from './http'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['company', 'session'])(
  'does not apply an old auth error when %s changes while its body is being read',
  async (scope) => {
    let company = 'company-1'
    let generation = 1
    let finish: ((value: unknown) => void) | undefined
    const body = new Promise<unknown>((resolve) => {
      finish = resolve
    })
    const response = new Response('', { status: 401 })
    const read = vi.spyOn(response, 'json').mockImplementation(() => body)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
    const failure = vi.fn()
    const client = createWebHttp({
      getCompanyId: () => company,
      getSessionGeneration: () => generation,
      onAuthFailure: failure,
    })
    if (!client.streamPost) throw new Error('Missing stream adapter')
    const request = client.streamPost('/assistant/send', {})
    await waitFor(() => expect(read).toHaveBeenCalledOnce())
    if (scope === 'company') company = 'company-2'
    else generation = 2
    const rejected = expect(request).rejects.toMatchObject({ code: 'REQUEST_STALE' })
    if (!finish) throw new Error('Missing response resolver')
    finish({ errors: { code: 'UNAUTHENTICATED', message: 'Old session' } })
    await rejected
    expect(failure).not.toHaveBeenCalled()
  },
)
