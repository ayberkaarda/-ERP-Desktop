import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { assistantApi } from './api'
import { AssistantHost } from './AssistantHost'
import { AssistantSetupCard } from './AssistantSetupCard'
import { AssistantAdminPage } from './AssistantAdminPage'
import type { AssistantStatus, Conversation, ToolCall } from './types'

const id = '019b1234-1234-7123-8123-123456789012'
Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
  configurable: true,
  value: vi.fn(),
})
const messageId = '019b1234-1234-7123-8123-123456789013'
const status: AssistantStatus = {
  enabled: true,
  configured: true,
  can_use: true,
  can_admin: true,
  provider: 'ollama',
  model: 'local',
  limits: { max_input_chars: 4000, daily_tokens: 10000 },
  usage: { used_tokens: 0, reserved_tokens: 0, remaining_tokens: 10000 },
}
const empty: Conversation = {
  id,
  title: 'Stock questions',
  version: 1,
  created_at: '2026-10-23T12:00:00Z',
  updated_at: '2026-10-23T12:00:00Z',
  messages: [],
}
const call: ToolCall = {
  id: 'call_1',
  tool: 'draft_purchase_request',
  kind: 'draft',
  status: 'pending',
  arguments: { description: 'Paper' },
  result: null,
  reason: 'Review',
}
const pending: Conversation = {
  ...empty,
  messages: [
    {
      id: messageId,
      role: 'assistant',
      status: 'pending_approval',
      content: 'Review this request.',
      created_at: empty.created_at,
      context: [],
      tool_calls: [call],
    },
  ],
}

function setup(permissions = ['assistant.use', 'assistant.usage.view']) {
  const db = setupFea()
  for (const company of db.companies) db.permissions[company.id] = permissions
  signIn(db)
  vi.spyOn(assistantApi, 'status').mockResolvedValue({ ...status })
  vi.spyOn(assistantApi, 'conversations').mockResolvedValue({ data: [empty] })
  vi.spyOn(assistantApi, 'conversation').mockResolvedValue(empty)
  vi.spyOn(assistantApi, 'create').mockResolvedValue(empty)
  return db
}
function renderHost() {
  return renderRoutes(
    [
      {
        path: '*',
        element: (
          <>
            <AssistantHost />
            <AssistantSetupCard />
          </>
        ),
      },
    ],
    '/',
  )
}
afterEach(() => {
  vi.restoreAllMocks()
})

it('hides the launcher off, shows setup only to authorized administrators and makes no conversation calls', async () => {
  setup()
  vi.mocked(assistantApi.status).mockResolvedValue({ ...status, enabled: false })
  renderHost()
  expect(await screen.findByRole('link', { name: 'Kurulumu görüntüle' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Asistanı aç' })).not.toBeInTheDocument()
  expect(assistantApi.conversations).not.toHaveBeenCalled()
  await userEvent.keyboard('{Control>}j{/Control}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
it('does not expose setup or launcher to users without the matching permission', async () => {
  setup([])
  renderHost()
  await waitFor(() => expect(assistantApi.status).toHaveBeenCalled())
  expect(screen.queryByRole('button', { name: 'Asistanı aç' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Kurulumu görüntüle' })).not.toBeInTheDocument()
})
it('opens with Ctrl+J and restores server history including draft approval after reload', async () => {
  setup()
  vi.mocked(assistantApi.conversation).mockResolvedValue(pending)
  renderHost()
  await screen.findByRole('button', { name: 'Asistanı aç' })
  await userEvent.keyboard('{Control>}j{/Control}')
  const dialog = await screen.findByRole('dialog')
  await userEvent.selectOptions(
    within(dialog).getByRole('combobox', { name: 'Konuşma geçmişi' }),
    id,
  )
  expect(await screen.findByRole('button', { name: 'Taslağı oluştur' })).toBeInTheDocument()
  expect(screen.getByLabelText('Mesaj')).toBeDisabled()
  const previousMessage = pending.messages?.[0]
  if (!previousMessage) throw new Error('Missing pending message')
  const reject = vi.spyOn(assistantApi, 'approve').mockResolvedValue({
    ...pending,
    messages: [
      {
        ...previousMessage,
        status: 'completed',
        tool_calls: [{ ...call, status: 'rejected' }],
      },
    ],
  })
  await userEvent.click(screen.getByRole('button', { name: 'Reddet' }))
  await waitFor(() =>
    expect(reject).toHaveBeenCalledWith(
      id,
      call.id,
      'reject',
      expect.any(String),
      expect.any(AbortSignal),
    ),
  )
  expect(await screen.findByText('Reddedildi')).toBeInTheDocument()
})
it('shows canonical masked response instead of provisional stream text', async () => {
  setup()
  vi.spyOn(assistantApi, 'send').mockImplementation(
    async (_id, _text, _key, _context, _signal, receive) => {
      await Promise.resolve()
      vi.mocked(assistantApi.conversation).mockResolvedValue({
        ...empty,
        messages: [
          {
            id: messageId,
            role: 'assistant',
            content: 'Canonical masked response',
            status: 'completed',
            context: [],
            created_at: empty.created_at,
            tool_calls: [],
          },
        ],
      })
      receive({ event: 'delta', data: { text: 'Provisional text' } })
      receive({
        event: 'done',
        data: {
          conversation: {
            ...empty,
            messages: [
              {
                id: messageId,
                role: 'assistant',
                content: 'Canonical masked response',
                status: 'completed',
                context: [],
                created_at: empty.created_at,
                tool_calls: [],
              },
            ],
          },
        },
      })
    },
  )
  renderHost()
  await userEvent.click(await screen.findByRole('button', { name: 'Asistanı aç' }))
  await userEvent.type(screen.getByLabelText('Mesaj'), 'Stock availability')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  expect(await screen.findByText('Canonical masked response')).toBeInTheDocument()
  expect(screen.queryByText('Provisional text')).not.toBeInTheDocument()
  expect(screen.getByLabelText('Mesaj')).toHaveValue('')
})
it('aborts and removes the old company conversation on company switch', async () => {
  const db = setup()
  let signal: AbortSignal | undefined
  vi.spyOn(assistantApi, 'send').mockImplementation((_id, _text, _key, _context, sentSignal) => {
    signal = sentSignal
    return new Promise((_resolve, reject) =>
      sentSignal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))),
    )
  })
  renderHost()
  await userEvent.click(await screen.findByRole('button', { name: 'Asistanı aç' }))
  await userEvent.type(screen.getByLabelText('Mesaj'), 'Private question')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await waitFor(() => expect(signal).toBeDefined())
  const next = { id: '019b1234-1234-7123-8123-123456789099', name: 'Other company', roleNames: [] }
  act(() => {
    useCompanyStore.getState().setCompanies([...useCompanyStore.getState().companies, next])
    useAuthStore.setState({ permissions: { ...db.permissions, [next.id]: ['assistant.use'] } })
    useCompanyStore.getState().setActiveCompany(next.id)
  })
  await waitFor(() => expect(signal?.aborted).toBe(true))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('Private question')).not.toBeInTheDocument()
})
it('reuses the same logical request id when retrying a failed message', async () => {
  setup()
  const send = vi
    .spyOn(assistantApi, 'send')
    .mockRejectedValue(new ApiError(0, 'STREAM_INTERRUPTED', 'Disconnected'))
  renderHost()
  await userEvent.click(await screen.findByRole('button', { name: 'Asistanı aç' }))
  await userEvent.type(screen.getByLabelText('Mesaj'), 'Question')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await screen.findByRole('alert')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(send.mock.calls[0]?.[2]).toBe(send.mock.calls[1]?.[2])
})
it('shows budget failures and rejects malformed canonical done payloads safely', async () => {
  setup()
  const send = vi
    .spyOn(assistantApi, 'send')
    .mockRejectedValue(new ApiError(429, 'ASSISTANT_BUDGET_EXCEEDED', 'Budget exceeded'))
  renderHost()
  await userEvent.click(await screen.findByRole('button', { name: 'Asistanı aç' }))
  await userEvent.type(screen.getByLabelText('Mesaj'), 'Question')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Günlük token bütçesi')
  send.mockImplementation(async (_id, _message, _key, _context, _signal, receive) => {
    await Promise.resolve()
    receive({ event: 'done', data: { conversation: { id, messages: [{}] } } })
  })
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('İşlem tamamlanamadı'))
})
it('does not request usage while disabled', async () => {
  setup()
  vi.mocked(assistantApi.status).mockResolvedValue({ ...status, enabled: false })
  const usage = vi.spyOn(assistantApi, 'usage').mockResolvedValue({ data: [] })
  renderRoutes([{ path: '/', element: <AssistantAdminPage /> }], '/')
  expect(await screen.findByText(/Asistan bu ortamda kapalı/)).toBeInTheDocument()
  expect(usage).not.toHaveBeenCalled()
})

it('starts a new logical attempt after a definitive server stream failure', async () => {
  setup()
  const send = vi
    .spyOn(assistantApi, 'send')
    .mockImplementation(async (_id, _message, _key, _context, _signal, receive) => {
      await Promise.resolve()
      receive({ event: 'error', data: { code: 'ASSISTANT_PROVIDER_ERROR', message: 'Failed' } })
    })
  renderHost()
  await userEvent.click(await screen.findByRole('button', { name: 'Asistanı aç' }))
  await userEvent.type(screen.getByLabelText('Mesaj'), 'Question')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await screen.findByRole('alert')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(send.mock.calls[0]?.[2]).not.toBe(send.mock.calls[1]?.[2])
})

it('keeps a processing conversation readable, blocks new work and polls its final state', async () => {
  setup()
  const running: Conversation = {
    ...empty,
    messages: [
      {
        id: messageId,
        role: 'assistant',
        status: 'processing',
        content: '',
        context: [],
        created_at: empty.created_at,
        tool_calls: [],
      },
    ],
  }
  const processingMessage = running.messages?.[0]
  if (!processingMessage) throw new Error('Missing processing fixture')
  vi.mocked(assistantApi.conversation)
    .mockResolvedValueOnce(running)
    .mockResolvedValue({
      ...running,
      messages: [{ ...processingMessage, status: 'completed', content: 'Recovered answer' }],
    })
  renderHost()
  await userEvent.click(await screen.findByRole('button', { name: 'Asistanı aç' }))
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Konuşma geçmişi' }), id)
  await waitFor(() => expect(screen.getByLabelText('Mesaj')).toBeDisabled())
  expect(await screen.findByRole('status')).toHaveTextContent('Yanıt hazırlanıyor')
  expect(await screen.findByText('Recovered answer', {}, { timeout: 5000 })).toBeInTheDocument()
  expect(screen.getByLabelText('Mesaj')).toBeEnabled()
})

it('clears the preserved logical id when canonical recovery confirms that attempt failed', async () => {
  setup()
  const send = vi
    .spyOn(assistantApi, 'send')
    .mockImplementation(async (_id, _message, requestId) => {
      vi.mocked(assistantApi.conversation).mockResolvedValue({
        ...empty,
        messages: [
          {
            id: messageId,
            request_id: requestId,
            role: 'assistant',
            status: 'failed',
            content: '',
            context: [],
            created_at: empty.created_at,
            tool_calls: [],
          },
        ],
      })
      await Promise.resolve()
      throw new ApiError(0, 'STREAM_INTERRUPTED', 'Disconnected')
    })
  renderHost()
  await userEvent.click(await screen.findByRole('button', { name: 'Asistanı aç' }))
  await userEvent.type(screen.getByLabelText('Mesaj'), 'Question')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await screen.findByText('Yanıt tamamlanamadı. Saklanan geçmişten devam edebilirsiniz.')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(send.mock.calls[0]?.[2]).not.toBe(send.mock.calls[1]?.[2])
})

it('recovers a completed server turn after stopping only its client stream', async () => {
  setup()
  const send = vi
    .spyOn(assistantApi, 'send')
    .mockImplementation((_id, _message, requestId, _context, signal) => {
      vi.mocked(assistantApi.conversation).mockResolvedValue({
        ...empty,
        messages: [
          {
            id: messageId,
            request_id: requestId,
            role: 'assistant',
            status: 'completed',
            content: 'Saved after disconnect',
            context: [],
            created_at: empty.created_at,
            tool_calls: [],
          },
        ],
      })
      return new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
          once: true,
        }),
      )
    })
  renderHost()
  await userEvent.click(await screen.findByRole('button', { name: 'Asistanı aç' }))
  await userEvent.type(screen.getByLabelText('Mesaj'), 'Question')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await userEvent.click(await screen.findByRole('button', { name: 'Durdur' }))
  expect(await screen.findByText('Saved after disconnect')).toBeInTheDocument()
  expect(screen.getByLabelText('Mesaj')).toHaveValue('')
  expect(send).toHaveBeenCalledTimes(1)
})

it('keeps the user text when an ambiguous retry recovers a canonical failed turn', async () => {
  setup()
  const send = vi
    .spyOn(assistantApi, 'send')
    .mockRejectedValueOnce(new ApiError(0, 'STREAM_INTERRUPTED', 'Disconnected'))
    .mockImplementation(async (_id, _message, requestId, _context, _signal, receive) => {
      await Promise.resolve()
      receive({
        event: 'done',
        data: {
          conversation: {
            ...empty,
            messages: [
              {
                id: messageId,
                request_id: requestId,
                role: 'assistant',
                status: 'failed',
                content: '',
                context: [],
                created_at: empty.created_at,
                tool_calls: [],
              },
            ],
          },
        },
      })
    })
  renderHost()
  await userEvent.click(await screen.findByRole('button', { name: 'Asistanı aç' }))
  await userEvent.type(screen.getByLabelText('Mesaj'), 'Question')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await screen.findByRole('alert')
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  expect(screen.getByLabelText('Mesaj')).toHaveValue('Question')
  expect(send.mock.calls[0]?.[2]).toBe(send.mock.calls[1]?.[2])
  await userEvent.click(screen.getByRole('button', { name: 'Gönder' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(3))
  expect(send.mock.calls[2]?.[2]).not.toBe(send.mock.calls[1]?.[2])
})
