import { ApiError } from '@/platform'
import type { StreamEvent } from './types'

const MAX_FRAME = 2_097_152
const MAX_TOTAL = 4_194_304

/** Parses UTF-8 SSE across arbitrary byte/frame boundaries. */
export async function consumeAssistantStream(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let total = 0
  let doneEvent = false
  const abort = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    for (;;) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      if (value) total += value.length
      if (total > MAX_TOTAL) throw new ApiError(0, 'STREAM_TOO_LARGE', 'Stream limit exceeded.')
      buffer += decoder.decode(value, { stream: !done })
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary[0].length)
        if (frame.length > MAX_FRAME)
          throw new ApiError(0, 'STREAM_TOO_LARGE', 'Event limit exceeded.')
        let event = 'message'
        const lines: string[] = []
        for (const line of frame.split(/\r?\n/)) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''))
        }
        if (!lines.length) continue
        let data: unknown
        try {
          data = JSON.parse(lines.join('\n')) as unknown
        } catch {
          throw new ApiError(0, 'INVALID_STREAM', 'Invalid event data.')
        }
        onEvent({ event, data })
        if (event === 'done') {
          doneEvent = true
          break
        }
      }
      if (buffer.length > MAX_FRAME)
        throw new ApiError(0, 'STREAM_TOO_LARGE', 'Event limit exceeded.')
      if (done || doneEvent) break
    }
    signal.throwIfAborted()
    if (!doneEvent) throw new ApiError(0, 'STREAM_INTERRUPTED', 'The response was interrupted.')
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
