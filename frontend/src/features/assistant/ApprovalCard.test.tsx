import { screen } from '@testing-library/react'
import { renderRoute } from '@/test/render'
import { ApprovalCard } from './ApprovalCard'
import type { ToolCall } from './types'
const call: ToolCall = {
  id: 'call1',
  tool: 'draft_purchase_request',
  kind: 'draft',
  status: 'completed',
  arguments: {},
  result: { untrusted_data: { id: 'r1', url: '/purchasing/requests/r1', status: 'draft' } },
  reason: null,
}
it('opens the draft from a wrapped tool result and displays a readable tool name', () => {
  renderRoute(
    <ApprovalCard call={call} busy={false} disabled={false} onDecision={() => undefined} />,
  )
  expect(screen.getByRole('link', { name: 'Taslağı aç' })).toHaveAttribute(
    'href',
    '/purchasing/requests/r1',
  )
  expect(screen.getByText('Satın alma talebi taslağı')).toBeInTheDocument()
})
it('does not follow an unsafe draft result URL', () => {
  renderRoute(
    <ApprovalCard
      call={{ ...call, result: { untrusted_data: { url: '//evil.example' } } }}
      busy={false}
      disabled={false}
      onDecision={() => undefined}
    />,
  )
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
it('shows failed draft attempts without offering approval or a result link', () => {
  renderRoute(
    <ApprovalCard
      call={{ ...call, status: 'failed' }}
      busy={false}
      disabled={false}
      onDecision={() => undefined}
    />,
  )
  expect(screen.getByText('İşlem başarısız')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
  expect(screen.queryByRole('link')).not.toBeInTheDocument()
})
