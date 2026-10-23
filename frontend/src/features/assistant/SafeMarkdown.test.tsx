import { render, screen } from '@testing-library/react'
import { SafeMarkdown } from './SafeMarkdown'
import { safeAssistantPath } from './navigation'
import { contextFromPath } from './context'

it('renders HTML as text, strips unsafe links and never renders remote images', () => {
  const { container } = render(
    <SafeMarkdown
      text={
        '<img src=x onerror=alert(1)> **Safe** [Run](javascript:alert) [External](https://evil.example) ![tracker](https://evil.example/a.png) [Draft](/sales/quotes/123)'
      }
    />,
  )
  expect(container.querySelector('img')).toBeNull()
  expect(container.querySelector('strong')).toHaveTextContent('Safe')
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(screen.getByRole('link', { name: 'Draft' })).toHaveAttribute('href', '/sales/quotes/123')
  expect(container).toHaveTextContent('<img src=x onerror=alert(1)>')
})
it.each([
  'javascript:alert(1)',
  'https://evil.example',
  '//evil.example',
  '/%2fevil.example',
  '/\\evil.example',
  '/%5cevil.example',
  '/line\nbreak',
  '/%00null',
  '/%',
])('rejects unsafe path %s', (path) => {
  expect(safeAssistantPath(path)).toBeNull()
})
it('only includes explicit record routes and never query contents in context', () => {
  const id = '019b1234-1234-7123-8123-123456789012'
  expect(contextFromPath(`/sales/quotes/${id}`)).toEqual({ type: 'sales_quote', id })
  expect(contextFromPath('/sales/quotes/new')).toBeNull()
  expect(contextFromPath(`/sales/quotes/${id}?private=secret`)).toBeNull()
  expect(contextFromPath(`/unknown/${id}`)).toBeNull()
})
