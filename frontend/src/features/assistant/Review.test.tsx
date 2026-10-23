import { parseConversation } from './validation'
import { assistantErrorKey } from './errors'
import { ApiError } from '@/platform'

it('accepts persisted processing turns with a recoverable request identity', () => {
  const id = '019b1234-1234-7123-8123-123456789012'
  const request = '019b1234-1234-7123-8123-123456789014'
  const value = {
    id,
    title: 'In progress',
    version: 1,
    created_at: '2026-10-23T12:00:00Z',
    updated_at: '2026-10-23T12:00:00Z',
    busy_until: '2026-10-23T12:30:00Z',
    messages: [
      {
        id: '019b1234-1234-7123-8123-123456789013',
        request_id: request,
        role: 'assistant',
        status: 'processing',
        content: '',
        context: [],
        created_at: '2026-10-23T12:00:00Z',
        tool_calls: [],
      },
    ],
  }
  expect(parseConversation(value, id).messages?.[0]?.request_id).toBe(request)
})

it('maps stream-level budget and permission failures without relying on an HTTP error status', () => {
  expect(assistantErrorKey(new ApiError(0, 'ASSISTANT_TURN_LIMIT', 'Limit'))).toBe('budgetError')
  expect(assistantErrorKey(new ApiError(0, 'FORBIDDEN', 'Denied'))).toBe('accessError')
})
