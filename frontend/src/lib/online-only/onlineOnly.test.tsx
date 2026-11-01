import { cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Providers } from '@/app/providers'
import type { AppExtensions } from '@/app/extensions'
import { createQueryClient } from '@/lib/queryClient'
import { OnlineOnlyButton, useOnlineOnly } from '.'

const ext = vi.hoisted((): { value: AppExtensions } => ({
  value: { routes: [], publicRoutes: [] },
}))
vi.mock('@/app/extensions', () => ({
  get appExtensions() {
    return ext.value
  },
}))

afterEach(() => {
  ext.value = { routes: [], publicRoutes: [] }
})

function renderButton(onClick = vi.fn()) {
  render(
    <Providers queryClient={createQueryClient()}>
      <OnlineOnlyButton action="sales-invoices.finalize" onClick={onClick}>
        Kesinleştir
      </OnlineOnlyButton>
    </Providers>,
  )
  return onClick
}

describe('online-only primitive', () => {
  it('is always available on web', () => {
    const { result } = renderHook(() => useOnlineOnly('sales-invoices.finalize'))
    expect(result.current).toEqual({ disabled: false })
  })

  it('asks the runtime extension with the action name', () => {
    const hook = vi.fn(() => ({ disabled: true, reason: 'Çevrimdışı' }))
    ext.value = { routes: [], publicRoutes: [], useOnlineOnly: hook }
    const { result } = renderHook(() => useOnlineOnly('stock-documents.post'))
    expect(hook).toHaveBeenCalledWith('stock-documents.post')
    expect(result.current).toEqual({ disabled: true, reason: 'Çevrimdışı' })
  })

  it('renders a plain working button when available', async () => {
    const onClick = renderButton()
    const button = screen.getByRole('button', { name: 'Kesinleştir' })
    expect(button).toBeEnabled()
    await userEvent.setup().click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('disables the button and explains why when the runtime says so', async () => {
    ext.value = {
      routes: [],
      publicRoutes: [],
      useOnlineOnly: () => ({ disabled: true, reason: 'Bu işlem için bağlantı gerekir.' }),
    }
    const onClick = renderButton()
    const button = screen.getByRole('button', { name: 'Kesinleştir' })
    // aria-disabled keeps the button itself focusable, so the reason reaches screen readers.
    expect(button).toHaveAttribute('aria-disabled', 'true')
    const user = userEvent.setup()
    await user.tab()
    expect(button).toHaveFocus()
    const tooltip = await screen.findByRole('tooltip')
    expect(tooltip).toHaveTextContent('Bu işlem için bağlantı gerekir.')
    expect(button).toHaveAccessibleDescription('Bu işlem için bağlantı gerekir.')
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    await user.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('stays disabled without a reason', async () => {
    ext.value = { routes: [], publicRoutes: [], useOnlineOnly: () => ({ disabled: true }) }
    const onClick = renderButton()
    const button = screen.getByRole('button', { name: 'Kesinleştir' })
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await userEvent.setup().click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  function renderInContext(disabled: boolean) {
    ext.value = {
      routes: [],
      publicRoutes: [],
      useOnlineOnly: () => ({ disabled, reason: disabled ? 'Bağlantı gerekir.' : undefined }),
    }
    const spies = {
      submit: vi.fn((e: { preventDefault: () => void }) => e.preventDefault()),
      rowClick: vi.fn(),
      rowDoubleClick: vi.fn(),
      rowKeyDown: vi.fn(),
      rowKeyUp: vi.fn(),
      onClick: vi.fn(),
      onDoubleClick: vi.fn(),
      onMouseDown: vi.fn(),
      onMouseUp: vi.fn(),
      onPointerDown: vi.fn(),
      onPointerUp: vi.fn(),
      onKeyDown: vi.fn(),
      onKeyUp: vi.fn(),
      onFocus: vi.fn(),
      onMouseEnter: vi.fn(),
    }
    render(
      <Providers queryClient={createQueryClient()}>
        {/* A clickable row around a submit button, as in list rows with inline actions. */}
        <div
          role="row"
          tabIndex={-1}
          onClick={spies.rowClick}
          onDoubleClick={spies.rowDoubleClick}
          onKeyDown={spies.rowKeyDown}
          onKeyUp={spies.rowKeyUp}
        >
          <form onSubmit={spies.submit}>
            <OnlineOnlyButton
              action="sales-invoices.finalize"
              type="submit"
              onClick={spies.onClick}
              onDoubleClick={spies.onDoubleClick}
              onMouseDown={spies.onMouseDown}
              onMouseUp={spies.onMouseUp}
              onPointerDown={spies.onPointerDown}
              onPointerUp={spies.onPointerUp}
              onKeyDown={spies.onKeyDown}
              onKeyUp={spies.onKeyUp}
              onFocus={spies.onFocus}
              onMouseEnter={spies.onMouseEnter}
            >
              Kesinleştir
            </OnlineOnlyButton>
          </form>
        </div>
      </Providers>,
    )
    return { spies, button: screen.getByRole('button', { name: 'Kesinleştir' }) }
  }

  it('a disabled submit button neither submits its form nor reaches outer handlers', async () => {
    const { spies, button } = renderInContext(true)
    const user = userEvent.setup()
    await user.click(button)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(spies.submit).not.toHaveBeenCalled()
    expect(spies.rowClick).not.toHaveBeenCalled()
    expect(spies.rowKeyDown).not.toHaveBeenCalled()
    expect(spies.onClick).not.toHaveBeenCalled()
    expect(spies.onMouseDown).not.toHaveBeenCalled()
    expect(spies.onKeyDown).not.toHaveBeenCalled()
  })

  it('an available button submits, bubbles and calls its handlers as before', async () => {
    const { spies, button } = renderInContext(false)
    await userEvent.setup().click(button)
    expect(spies.submit).toHaveBeenCalledTimes(1)
    expect(spies.rowClick).toHaveBeenCalledTimes(1)
    expect(spies.onClick).toHaveBeenCalledTimes(1)
    expect(spies.onMouseDown).toHaveBeenCalledTimes(1)
    expect(button).not.toHaveAttribute('aria-disabled')
  })

  it('an available button passes its pointer, double-click and key handlers through', async () => {
    const { spies, button } = renderInContext(false)
    const user = userEvent.setup()
    await user.dblClick(button)
    expect(spies.onDoubleClick).toHaveBeenCalledTimes(1)
    expect(spies.rowDoubleClick).toHaveBeenCalledTimes(1)
    expect(spies.onMouseUp).toHaveBeenCalledTimes(2)
    expect(spies.onPointerDown).toHaveBeenCalledTimes(2)
    expect(spies.onPointerUp).toHaveBeenCalledTimes(2)
    await user.keyboard('{Escape}')
    expect(spies.onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }))
    expect(spies.onKeyUp).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }))
  })

  it('a disabled button still passes focus and hover through, so its tooltip works', async () => {
    const { spies, button } = renderInContext(true)
    const user = userEvent.setup()
    await user.hover(button)
    expect(spies.onMouseEnter).toHaveBeenCalledTimes(1)
    await user.unhover(button)
    await user.tab()
    expect(button).toHaveFocus()
    expect(spies.onFocus).toHaveBeenCalledTimes(1)
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Bağlantı gerekir.')
  })

  it('a disabled button blocks double click, pointer and key-up activation', async () => {
    const { spies, button } = renderInContext(true)
    const user = userEvent.setup()
    await user.dblClick(button)
    button.focus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(spies.onDoubleClick).not.toHaveBeenCalled()
    expect(spies.onMouseUp).not.toHaveBeenCalled()
    expect(spies.onPointerDown).not.toHaveBeenCalled()
    expect(spies.onPointerUp).not.toHaveBeenCalled()
    expect(spies.onKeyUp).not.toHaveBeenCalled()
    expect(spies.rowDoubleClick).not.toHaveBeenCalled()
    expect(spies.rowClick).not.toHaveBeenCalled()
    expect(spies.submit).not.toHaveBeenCalled()
  })

  it('a disabled button stops the Space key-up from reaching the row', async () => {
    const { spies, button } = renderInContext(true)
    button.focus()
    await userEvent.setup().keyboard(' ')
    expect(spies.rowKeyUp).not.toHaveBeenCalled()
    expect(spies.rowClick).not.toHaveBeenCalled()
  })

  it('a disabled button does not swallow keys other than Enter and Space', async () => {
    const { spies, button } = renderInContext(true)
    const user = userEvent.setup()
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(spies.rowKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }))
    expect(spies.rowKeyUp).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }))
    await user.tab()
    expect(button).not.toHaveFocus()
    expect(spies.rowKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Tab' }))
  })

  it('looks disabled only while disabled', () => {
    const { button } = renderInContext(true)
    expect(button).toHaveClass('opacity-50', 'cursor-not-allowed')
    cleanup()
    const { button: enabled } = renderInContext(false)
    expect(enabled).not.toHaveClass('opacity-50')
    expect(enabled).not.toHaveClass('cursor-not-allowed')
  })

  it('respects the caller disabling an available button', () => {
    render(
      <Providers queryClient={createQueryClient()}>
        <OnlineOnlyButton action="x" disabled>
          Kaydet
        </OnlineOnlyButton>
      </Providers>,
    )
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled()
  })
})
