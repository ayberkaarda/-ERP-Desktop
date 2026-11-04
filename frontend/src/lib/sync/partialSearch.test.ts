import { isPartialSearch } from './partialSearch'

describe('isPartialSearch', () => {
  it('is true only for an explicit search_partial marker', () => {
    expect(
      isPartialSearch({
        data: [],
        meta: { offline: { partial: false, stale: false, search_partial: true } },
      }),
    ).toBe(true)
  })

  it('is false for a server answer and for any other offline meta', () => {
    const pagination = { current_page: 1, per_page: 25, total: 0, last_page: 1 }
    for (const answer of [
      { data: [], meta: { pagination } },
      { data: [] },
      // A copy that is still downloading is another matter (meta.offline.partial).
      { data: [], meta: { offline: { partial: true, stale: false } } },
      { data: [], meta: { offline: { partial: false, stale: false, search_partial: 'true' } } },
      { data: [], meta: { offline: null } },
      { data: [], meta: null },
      null,
      undefined,
      [],
      'x',
    ]) {
      expect(isPartialSearch(answer)).toBe(false)
    }
  })
})
