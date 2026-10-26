import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Dialog } from 'radix-ui'
import { Plus, Square, X } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router'
import { Button } from '@/components/ui/button'
import { ApiError, createIdempotencyKey, platform } from '@/platform'
import { useAuthStore } from '@/stores/auth'
import { useCompanyStore } from '@/stores/company'
import { assistantApi } from './api'
import { ApprovalCard } from './ApprovalCard'
import { contextFromPath, CONTEXT_LABELS } from './context'
import { assistantErrorKey } from './errors'
import { SafeMarkdown } from './SafeMarkdown'
import { useAssistantStatus } from './useAssistantStatus'
import { parseConversation } from './validation'
import type { Conversation, ToolCall } from './types'

const onlineSubscribe = (callback: () => void) => platform.connectivity.subscribe(callback)
const onlineSnapshot = () => platform.connectivity.isOnline()
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
export function AssistantPanel({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('assistant')
  const userId = useAuthStore((s) => s.user?.id)
  const companyId = useCompanyStore((s) => s.activeCompanyId)
  const companyName = useCompanyStore(
    (s) => s.companies.find((c) => c.id === s.activeCompanyId)?.name,
  )
  const scope = ['assistant', userId, companyId]
  const queryClient = useQueryClient()
  const [id, setId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [text, setText] = useState('')
  const [partial, setPartial] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ReturnType<typeof assistantErrorKey> | null>(null)
  const [includeContext, setIncludeContext] = useState(true)
  const active = useRef<AbortController | null>(null)
  const retry = useRef<{ message: string; id: string; conversation: string } | null>(null)
  const decisions = useRef(new Map<string, string>())
  const end = useRef<HTMLDivElement>(null)
  const online = useSyncExternalStore(onlineSubscribe, onlineSnapshot)
  const context = contextFromPath(useLocation().pathname)
  const status = useAssistantStatus()
  const conversations = useQuery({
    queryKey: [...scope, 'conversations', page],
    queryFn: ({ signal }) => assistantApi.conversations(page, signal),
    enabled: open,
    retry: false,
  })
  const conversation = useQuery({
    queryKey: [...scope, 'conversation', id],
    queryFn: async ({ signal }) => {
      const value = await assistantApi.conversation(id ?? '', signal)
      const attempt = retry.current
      if (!signal.aborted && attempt?.conversation === value.id) {
        const turn = value.messages?.find(
          (message) => message.role === 'assistant' && message.request_id === attempt.id,
        )
        if (turn && turn.status !== 'processing') {
          retry.current = null
          if (turn.status !== 'failed') {
            setText((current) => (current.trim() === attempt.message ? '' : current))
          }
        }
      }
      return value
    },
    enabled: open && !!id && !busy,
    retry: false,
  })
  const pending =
    conversation.data?.messages?.some((message) =>
      message.tool_calls.some((call) => call.status === 'pending'),
    ) ?? false
  const processing =
    conversation.data?.messages?.some((message) => message.status === 'processing') ?? false
  const refetchConversation = conversation.refetch
  useEffect(() => {
    if (!open || !id || busy || !online || !processing) return
    // A disconnected client does not cancel the server turn. Recover its durable state,
    // with a finite polling window; the refresh control remains available afterwards.
    const deadline = Date.now() + 10 * 60_000
    const timer = window.setInterval(() => {
      if (Date.now() >= deadline) {
        window.clearInterval(timer)
        return
      }
      void refetchConversation()
    }, 2000)
    return () => window.clearInterval(timer)
  }, [open, id, busy, online, processing, refetchConversation])
  useEffect(
    () => () => {
      active.current?.abort()
    },
    [],
  )
  useEffect(() => {
    if (!open) active.current?.abort()
  }, [open])
  useEffect(() => {
    if (!online) active.current?.abort()
  }, [online])
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [partial, conversation.data])

  function canonical(value: Conversation) {
    queryClient.setQueryData([...scope, 'conversation', value.id], value)
    setId(value.id)
    void queryClient.invalidateQueries({ queryKey: [...scope, 'conversations'] })
    void queryClient.invalidateQueries({ queryKey: [...scope, 'status'] })
  }
  async function send() {
    if (busy || !text.trim() || !online || pending || processing || (id && !conversation.data))
      return
    const message = text.trim()
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setError(null)
    setPartial('')
    try {
      const conversationId =
        id ?? (await assistantApi.create(createIdempotencyKey(), controller.signal)).id
      if (controller.signal.aborted) return
      setId(conversationId)
      const requestId =
        retry.current?.message === message && retry.current.conversation === conversationId
          ? retry.current.id
          : createIdempotencyKey()
      retry.current = { message, id: requestId, conversation: conversationId }
      await assistantApi.send(
        conversationId,
        message,
        requestId,
        includeContext && context ? [context] : [],
        controller.signal,
        ({ event, data }) => {
          if (controller.signal.aborted) return
          if (!object(data)) throw new ApiError(0, 'INVALID_STREAM', 'Invalid event payload.')
          if (event === 'delta' && typeof data.text === 'string') {
            const delta = data.text
            setPartial((value) => (value + delta).slice(0, 100_000))
          }
          if (event === 'done') {
            const value = parseConversation(data.conversation, conversationId)
            canonical(value)
            retry.current = null
            const failed = value.messages?.some(
              (message) =>
                message.role === 'assistant' &&
                message.request_id === requestId &&
                message.status === 'failed',
            )
            if (failed) setError('requestError')
            else setText('')
            setPartial('')
          }
          if (event === 'error') {
            // The server has durably failed this attempt. A retry is a new turn;
            // transport interruptions without a terminal event retain the logical ID.
            retry.current = null
            throw new ApiError(
              0,
              typeof data.code === 'string' ? data.code : 'STREAM_ERROR',
              'Assistant failed.',
            )
          }
        },
      )
    } catch (failure) {
      if (!controller.signal.aborted) setError(assistantErrorKey(failure))
    } finally {
      if (active.current === controller) {
        active.current = null
        setBusy(false)
        setPartial('')
        void queryClient.invalidateQueries({ queryKey: [...scope, 'conversation'] })
      }
    }
  }
  async function decision(call: ToolCall, choice: 'approve' | 'reject') {
    if (!id || busy || !online || processing) return
    const controller = new AbortController()
    active.current = controller
    const keyName = `${call.id}:${choice}`
    const key = decisions.current.get(keyName) ?? createIdempotencyKey()
    decisions.current.set(keyName, key)
    setBusy(true)
    setError(null)
    try {
      const value = await assistantApi.approve(id, call.id, choice, key, controller.signal)
      if (!controller.signal.aborted) canonical(value)
    } catch (failure) {
      if (!controller.signal.aborted) setError(assistantErrorKey(failure))
    } finally {
      if (active.current === controller) {
        active.current = null
        setBusy(false)
      }
    }
  }
  const max = status.data?.limits.max_input_chars ?? 4000
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-overlay" />
        <Dialog.Content
          aria-describedby="assistant-description"
          className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col border-l border-border bg-surface text-foreground shadow-lg outline-none"
        >
          <header className="flex items-start justify-between gap-3 border-b border-border p-4">
            <div>
              <Dialog.Title className="text-base font-semibold">{t('title')}</Dialog.Title>
              <Dialog.Description
                id="assistant-description"
                className="mt-1 text-xs text-muted-foreground"
              >
                {t('description')}
              </Dialog.Description>
              <p className="mt-2 text-xs font-medium">{companyName}</p>
            </div>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('close')}>
                <X />
              </Button>
            </Dialog.Close>
          </header>
          <div className="space-y-2 border-b border-border p-3">
            <div className="flex gap-2">
              <label className="sr-only" htmlFor="assistant-history">
                {t('history')}
              </label>
              <select
                id="assistant-history"
                className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-sm"
                value={id ?? ''}
                disabled={busy}
                onChange={(event) => {
                  setId(event.target.value || null)
                  setError(null)
                  setText('')
                  retry.current = null
                }}
              >
                <option value="">{t('newConversation')}</option>
                {conversations.data?.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title || t('newConversation')}
                  </option>
                ))}
              </select>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setId(null)
                  setText('')
                  setError(null)
                  retry.current = null
                }}
              >
                <Plus />
                {t('new')}
              </Button>
            </div>
            {conversations.data?.meta?.pagination &&
              conversations.data.meta.pagination.last_page > 1 && (
                <div className="flex items-center justify-between text-xs">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page === 1 || busy}
                    onClick={() => setPage((value) => value - 1)}
                  >
                    {t('previous')}
                  </Button>
                  <span>
                    {page} / {conversations.data.meta.pagination.last_page}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={page >= conversations.data.meta.pagination.last_page || busy}
                    onClick={() => setPage((value) => value + 1)}
                  >
                    {t('next')}
                  </Button>
                </div>
              )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-busy={busy || processing}>
            {processing && !busy && (
              <p role="status" className="mb-3 text-sm text-muted-foreground">
                {t('answering')}{' '}
                <button
                  type="button"
                  className="underline"
                  disabled={!online || conversation.isFetching}
                  onClick={() => void refetchConversation()}
                >
                  {t('retry')}
                </button>
              </p>
            )}
            {conversation.data?.has_more_messages && (
              <p className="mb-3 text-xs text-muted-foreground">{t('recentHistory')}</p>
            )}
            {conversations.isError && (
              <p role="alert" className="mb-3 text-sm text-danger">
                {t('historyError')}{' '}
                <button className="underline" onClick={() => void conversations.refetch()}>
                  {t('retry')}
                </button>
              </p>
            )}
            {conversation.isError && (
              <p role="alert" className="text-sm text-danger">
                {t('historyError')}{' '}
                <button className="underline" onClick={() => void conversation.refetch()}>
                  {t('retry')}
                </button>
              </p>
            )}
            {id && conversation.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                {t('loading')}
              </p>
            )}
            {!id && (
              <div className="space-y-2 py-8">
                <h3 className="text-sm font-medium">{t('welcome')}</h3>
                <p className="text-sm text-muted-foreground">{t('welcomeDetail')}</p>
              </div>
            )}
            <div className="space-y-5">
              {conversation.data?.messages?.map((message) => (
                <article key={message.id} className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {message.role === 'user' ? t('you') : t('title')}
                  </p>
                  <SafeMarkdown text={message.content} />
                  {message.status === 'failed' && (
                    <p className="text-xs text-danger">{t('failedMessage')}</p>
                  )}
                  {message.tool_calls
                    .filter((call) => call.kind === 'draft')
                    .map((call) => (
                      <ApprovalCard
                        key={call.id}
                        call={call}
                        busy={busy}
                        disabled={!online || processing}
                        onDecision={(item, choice) => void decision(item, choice)}
                      />
                    ))}
                </article>
              ))}
              {partial && (
                <article aria-label={t('answering')}>
                  <SafeMarkdown text={partial} />
                </article>
              )}
            </div>
            <div ref={end} />
          </div>
          <form
            className="space-y-2 border-t border-border p-3"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            {!online && (
              <p role="status" className="text-xs text-warning">
                {t('offline')}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {t(error)}
              </p>
            )}
            {pending && <p className="text-xs text-muted-foreground">{t('resolveApproval')}</p>}
            {context && (
              <label className="inline-flex max-w-full items-center gap-2 rounded border border-border px-2 py-1 text-xs">
                <input
                  type="checkbox"
                  checked={includeContext}
                  disabled={busy}
                  onChange={(event) => setIncludeContext(event.target.checked)}
                />
                <span className="truncate">
                  {t('context')}: {t(CONTEXT_LABELS[context.type as keyof typeof CONTEXT_LABELS])} ·{' '}
                  {context.id.slice(0, 8)}
                </span>
              </label>
            )}
            <label className="sr-only" htmlFor="assistant-message">
              {t('message')}
            </label>
            <textarea
              id="assistant-message"
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={max}
              rows={3}
              disabled={busy || !online || pending || processing || (!!id && !conversation.data)}
              placeholder={t('placeholder')}
              className="w-full resize-none rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t('remaining', { count: status.data?.usage.remaining_tokens ?? 0 })}
              </p>
              {busy ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => active.current?.abort()}
                >
                  <Square />
                  {t('stop')}
                </Button>
              ) : (
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !text.trim() ||
                    !online ||
                    pending ||
                    processing ||
                    (!!id && !conversation.data) ||
                    text.length > max ||
                    (status.data?.usage.remaining_tokens ?? 0) <= 0
                  }
                >
                  {t('send')}
                </Button>
              )}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
