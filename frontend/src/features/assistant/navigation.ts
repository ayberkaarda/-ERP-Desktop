/** Only same-origin application paths can be followed from model output. */
export function safeAssistantPath(value: unknown): string | null {
  // eslint-disable-next-line no-control-regex
  const unsafe = /[\\\u0000-\u0020\u007f]/
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    unsafe.test(value)
  )
    return null
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith('//') || unsafe.test(decoded)) return null
  } catch {
    return null
  }
  return value
}
