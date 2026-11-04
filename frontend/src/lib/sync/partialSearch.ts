/**
 * Whether a list answer is a partial search: a runtime with an offline mode (the desktop app)
 * searched `q` in its local copy of a resource the server also searches in data the copy does not
 * hold (item barcodes and variant SKUs), so matches may be missing. It says so with
 * `meta.offline.search_partial: true` (docs/SYNC-PROTOCOL.md, "Çevrimdışı liste sorguları"). The
 * server never sends `meta.offline`: on the web this is always false.
 */
export function isPartialSearch(response: unknown): boolean {
  const meta = field(response, 'meta')
  return field(field(meta, 'offline'), 'search_partial') === true
}

function field(value: unknown, name: string): unknown {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)[name]
    : undefined
}
