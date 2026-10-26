import { http, HttpResponse } from 'msw'
import { setupCatalog } from '../testing'
import { server } from '@/test/msw/server'
import { fetchAll, INCOMPLETE_LOAD, LIMIT_EXCEEDED } from './client'

const rows = (n: number, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${offset + i}` }))

describe('fetchAll', () => {
  it('collects every page', async () => {
    setupCatalog()
    server.use(
      http.get('*/api/v1/things', ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get('page'))
        const data = page < 3 ? rows(100, (page - 1) * 100) : rows(50, 200)
        return HttpResponse.json({
          data,
          meta: { pagination: { total: 250, last_page: 3, current_page: 1, per_page: 100 } },
        })
      }),
    )
    await expect(fetchAll('/things')).resolves.toHaveLength(250)
  })

  it('refuses lists beyond the page cap instead of truncating', async () => {
    setupCatalog()
    server.use(
      http.get('*/api/v1/things', () =>
        HttpResponse.json({
          data: rows(100),
          meta: { pagination: { total: 300, last_page: 3, current_page: 1, per_page: 100 } },
        }),
      ),
    )
    await expect(fetchAll('/things', {}, undefined, 2)).rejects.toMatchObject({
      code: LIMIT_EXCEEDED,
    })
  })

  it('refuses a load that came back short of the total', async () => {
    setupCatalog()
    server.use(
      http.get('*/api/v1/things', () =>
        HttpResponse.json({
          data: rows(2),
          meta: { pagination: { total: 5, last_page: 1, current_page: 1, per_page: 100 } },
        }),
      ),
    )
    await expect(fetchAll('/things')).rejects.toMatchObject({ code: INCOMPLETE_LOAD })
  })
})
