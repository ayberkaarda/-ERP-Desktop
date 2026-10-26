function readBytes(file: Blob): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(reader.result as ArrayBuffer)
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('read failed'))
    }
    reader.readAsArrayBuffer(file)
  })
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** FNV-1a (two seeds) for runtimes without SubtleCrypto; identity only, not security. */
function fallbackHash(bytes: Uint8Array): string {
  let h1 = 0x811c9dc5
  let h2 = 0x01000193 ^ bytes.length
  for (const b of bytes) {
    h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ b, 0x5bd1e995) >>> 0
  }
  return `fnv-${h1.toString(16)}-${h2.toString(16)}-${bytes.length}`
}

/**
 * Content identity of an upload: same bytes -> same id, so idempotency keys and dry-run reports
 * follow the content, not the file name, size or modification time.
 */
export async function hashFile(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await readBytes(file))
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle
  if (subtle) {
    try {
      return `sha256-${hex(new Uint8Array(await subtle.digest('SHA-256', bytes)))}`
    } catch {
      // Some test runtimes reject foreign buffers; fall through to the local hash.
    }
  }
  return fallbackHash(bytes)
}
