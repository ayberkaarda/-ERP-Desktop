/** Hands a downloaded blob to the browser as a file. */
export function saveBlob(blob: Blob, filename: string): void {
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.append(a)
  a.click()
  a.remove()
  // Some browsers start the download asynchronously; revoke after it had a chance to begin.
  setTimeout(() => URL.revokeObjectURL(href), 0)
}
