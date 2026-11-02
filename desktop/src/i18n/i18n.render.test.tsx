import { act, render, renderHook, screen } from '@testing-library/react'
import i18next, { type i18n as I18n } from 'i18next'
import { type ReactNode, useEffect, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'

import { addDesktopResources, type Td, useTd } from '@desktop/i18n'

function Title() {
  const td = useTd()
  return <h1>{td('shell.appName')}</h1>
}

async function makeInstance(): Promise<I18n> {
  const instance = i18next.createInstance()
  await instance.init({ lng: 'tr', fallbackLng: 'tr', resources: {} })
  addDesktopResources(instance)
  return instance
}

function withInstance(instance: I18n) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <I18nextProvider i18n={instance}>{children}</I18nextProvider>
  }
}

describe('useTd', () => {
  it('renders desktop text and re-renders on a language change', async () => {
    const instance = await makeInstance()

    render(
      <I18nextProvider i18n={instance}>
        <Title />
      </I18nextProvider>,
    )
    expect(screen.getByRole('heading')).toHaveTextContent('Keystone Masaüstü')

    await act(() => instance.changeLanguage('en'))
    expect(screen.getByRole('heading')).toHaveTextContent('Keystone Desktop')
  })

  it('returns the same function across re-renders', async () => {
    const instance = await makeInstance()
    const { result, rerender } = renderHook(() => useTd(), { wrapper: withInstance(instance) })
    const first = result.current

    rerender()
    rerender()
    expect(result.current).toBe(first)
  })

  it('returns the same function to two calls in one render', async () => {
    const instance = await makeInstance()
    const report = vi.fn<(a: Td, b: Td) => void>()
    function Twice({ onRender }: { onRender: (a: Td, b: Td) => void }) {
      onRender(useTd(), useTd())
      return null
    }
    render(
      <I18nextProvider i18n={instance}>
        <Twice onRender={report} />
      </I18nextProvider>,
    )
    const [a, b] = report.mock.calls[0] ?? []
    expect(a).toBeDefined()
    expect(a).toBe(b)
  })

  it('returns a new function after a language change, which speaks the new language', async () => {
    const instance = await makeInstance()
    const { result } = renderHook(() => useTd(), { wrapper: withInstance(instance) })
    const before = result.current

    await act(() => instance.changeLanguage('en'))
    expect(result.current).not.toBe(before)
    expect(result.current('shell.appName')).toBe('Keystone Desktop')

    const after = result.current
    await act(() => instance.changeLanguage('en'))
    expect(result.current).toBe(after)
  })

  it('does not loop when an effect depends on td', async () => {
    const instance = await makeInstance()
    let runs = 0
    const count = vi.fn(() => (runs += 1))
    // Like a page that loads data in an effect and stores the result: each
    // result re-renders, and an unstable td would start the effect again.
    function Labelled({ onRun }: { onRun: () => number }) {
      const td = useTd()
      const [label, setLabel] = useState('')
      useEffect(() => {
        const run = onRun()
        void Promise.resolve().then(() => {
          // The cap keeps a broken hook from hanging the suite.
          if (run < 50) setLabel(`${td('shell.appName')} #${String(run)}`)
        })
      }, [td, onRun])
      return <p>{label}</p>
    }
    const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    render(
      <I18nextProvider i18n={instance}>
        <Labelled onRun={count} />
      </I18nextProvider>,
    )
    await settle()
    expect(screen.getByText('Keystone Masaüstü #1')).toBeInTheDocument()
    expect(count).toHaveBeenCalledTimes(1)

    await act(() => instance.changeLanguage('en'))
    await settle()
    expect(screen.getByText('Keystone Desktop #2')).toBeInTheDocument()
    expect(count).toHaveBeenCalledTimes(2)
  })
})
