import type { AccountRef, NamedRef } from '../types'

export const accountLabel = (a: Pick<AccountRef, 'code' | 'name'>) => `${a.code} · ${a.name}`
export const refLabel = (r: NamedRef) => (r.code ? `${r.code} · ${r.name}` : r.name)
