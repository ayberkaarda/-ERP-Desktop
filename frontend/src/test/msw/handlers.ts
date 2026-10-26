import { http, HttpResponse } from 'msw'

export const handlers = [
  http.get('*/api/v1/assistant/status', () =>
    HttpResponse.json({
      data: {
        enabled: false,
        configured: false,
        can_use: false,
        can_admin: false,
        provider: null,
        model: null,
        limits: { max_input_chars: 4000, daily_tokens: 0 },
        usage: { used_tokens: 0, reserved_tokens: 0, remaining_tokens: 0 },
      },
    }),
  ),
  http.get('*/api/v1/health', () => HttpResponse.json({ data: { status: 'ok' } })),
]
