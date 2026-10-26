import { consumeAssistantStream } from './stream'
import type { StreamEvent } from './types'

function bytes(parts: string[]) {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(controller) {
      parts.forEach((part) => controller.enqueue(encoder.encode(part)))
      controller.close()
    },
  })
}
describe('assistant SSE', () => {
  it('preserves UTF-8 across byte boundaries and multiline JSON CRLF frames', async () => {
    const encoded = new TextEncoder().encode(
      ': heartbeat\r\n\r\nevent: delta\r\ndata: {"text":\r\ndata: "İşlem ✅"}\r\n\r\nevent: done\r\ndata: {}\r\n\r\n',
    )
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of encoded) controller.enqueue(Uint8Array.of(byte))
        controller.close()
      },
    })
    const events: StreamEvent[] = []
    await consumeAssistantStream(stream, new AbortController().signal, (event) =>
      events.push(event),
    )
    expect(events).toEqual([
      { event: 'delta', data: { text: 'İşlem ✅' } },
      { event: 'done', data: {} },
    ])
  })
  it('does not silently accept an incomplete response', async () => {
    await expect(
      consumeAssistantStream(
        bytes(['event: delta\ndata: {"text":"partial"}\n\n']),
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'STREAM_INTERRUPTED' })
  })
  it('rejects malformed JSON and oversized frames', async () => {
    await expect(
      consumeAssistantStream(
        bytes(['event: done\ndata: <html>\n\n']),
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_STREAM' })
    await expect(
      consumeAssistantStream(
        bytes(['x'.repeat(2_097_153)]),
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'STREAM_TOO_LARGE' })
  })
  it('cancels an idle reader when the user aborts', async () => {
    const cancel = vi.fn()
    const signal = new AbortController()
    const receive = vi.fn()
    const stream = new ReadableStream<Uint8Array>({ cancel })
    const result = consumeAssistantStream(stream, signal.signal, receive)
    signal.abort()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(cancel).toHaveBeenCalledOnce()
    expect(receive).not.toHaveBeenCalled()
  })
})
