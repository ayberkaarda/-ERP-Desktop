import { ApiError, platform, withIdempotency } from '@/platform'
import { consumeAssistantStream } from './stream'
import { parseConversation } from './validation'
import type {
  AssistantStatus,
  Conversation,
  Page,
  RecordContext,
  StreamEvent,
  UsageRow,
} from './types'

interface Envelope<T> {
  data: T
}
const path = (id: string) => `/assistant/conversations/${encodeURIComponent(id)}`
export const assistantApi = {
  status: (signal?: AbortSignal) =>
    platform.http
      .get<Envelope<AssistantStatus>>('/assistant/status', { signal })
      .then((r) => r.data),
  conversations: (page = 1, signal?: AbortSignal) =>
    platform.http.get<Page<Conversation>>('/assistant/conversations', { params: { page }, signal }),
  conversation: (id: string, signal?: AbortSignal) =>
    platform.http
      .get<Envelope<unknown>>(path(id), { signal })
      .then((r) => parseConversation(r.data, id)),
  create: (key: string, signal?: AbortSignal) =>
    platform.http
      .post<Envelope<Conversation>>(
        '/assistant/conversations',
        {},
        withIdempotency({ signal }, key),
      )
      .then((r) => r.data),
  approve: (
    id: string,
    call: string,
    decision: 'approve' | 'reject',
    key: string,
    signal?: AbortSignal,
  ) =>
    platform.http
      .post<Envelope<unknown>>(
        `${path(id)}/approvals/${encodeURIComponent(call)}`,
        { decision },
        withIdempotency({ signal }, key),
      )
      .then((r) => parseConversation(r.data, id)),
  usage: (from: string, to: string, page = 1, signal?: AbortSignal) =>
    platform.http.get<Page<UsageRow>>('/assistant/usage', {
      params: { date_from: from, date_to: to, page },
      signal,
    }),
  send: async (
    id: string,
    message: string,
    requestId: string,
    context: RecordContext[],
    signal: AbortSignal,
    receive: (event: StreamEvent) => void,
  ) => {
    if (!platform.http.streamPost)
      throw new ApiError(0, 'STREAM_UNAVAILABLE', 'Streaming is unavailable in this runtime.')
    const stream = await platform.http.streamPost(
      `${path(id)}/messages`,
      { message, request_id: requestId, context },
      { signal },
    )
    await consumeAssistantStream(stream, signal, receive)
  },
}
