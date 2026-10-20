import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useThemeStore } from '@/stores/theme'
import { renderRoutes, setupFea, signIn } from '@/test/handlers/feaRender'
import { CommandPalette } from './CommandPalette'
import { fuzzyScore } from './fuzzy'
import { registerCommands } from './registry'

beforeAll(() => {
  // jsdom has no layout; the palette scrolls the active option into view.
  Element.prototype.scrollIntoView = () => undefined
})

function renderPalette() {
  return renderRoutes(
    [
      { path: '/', element: <CommandPalette /> },
      { path: '/system/health', element: <p>health page</p> },
    ],
    '/',
  )
}

describe('fuzzy search', () => {
  it('matches subsequences, folds Turkish letters and ranks word starts higher', () => {
    expect(fuzzyScore('sirket', 'Şirkete geç')).not.toBeNull()
    expect(fuzzyScore('sdm', 'Sistem durumu')).not.toBeNull()
    expect(fuzzyScore('xyz', 'Panel')).toBeNull()
    const start = fuzzyScore('pa', 'Panel') ?? 0
    const middle = fuzzyScore('pa', 'Kapat') ?? 0
    expect(start).toBeGreaterThan(middle)
  })
})

describe('CommandPalette', () => {
  it('opens with Ctrl+K, filters fuzzily and runs a navigation command with Enter', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    const { router } = renderPalette()

    await user.keyboard('{Control>}k{/Control}')
    const input = await screen.findByRole('combobox', { name: /Sayfa, komut/ })
    await user.type(input, 'sistem drm')
    const option = screen.getByRole('option', { name: 'Sistem durumu' })
    expect(option).toHaveAttribute('aria-selected', 'true')
    expect(input).toHaveAttribute('aria-activedescendant', option.id)

    await user.keyboard('{Enter}')
    await waitFor(() => expect(router.state.location.pathname).toBe('/system/health'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('moves through options with the arrow keys and toggles the theme', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderPalette()

    await user.keyboard('{Meta>}k{/Meta}')
    const input = await screen.findByRole('combobox')
    await user.type(input, 'tema')
    const options = screen.getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['Tema: Açık', 'Tema: Koyu', 'Tema: Sistem'])
    await user.keyboard('{ArrowDown}')
    expect(screen.getByRole('option', { name: 'Tema: Koyu' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await user.keyboard('{Enter}')
    expect(useThemeStore.getState().theme).toBe('dark')
    useThemeStore.getState().setTheme('system')
  })

  it('hides commands the active company does not permit and unregisters cleanly', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderPalette()
    const unregister = registerCommands([
      {
        id: 'users.open',
        group: 'navigation',
        title: () => 'Kullanıcılar',
        permission: 'users.view',
        run: () => undefined,
      },
      {
        id: 'reports.open',
        group: 'navigation',
        title: () => 'Raporlar',
        run: () => undefined,
      },
    ])

    await user.keyboard('{Control>}k{/Control}')
    await screen.findByRole('combobox')
    expect(screen.getByRole('option', { name: 'Raporlar' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Kullanıcılar' })).not.toBeInTheDocument()

    act(() => unregister())
    expect(screen.queryByRole('option', { name: 'Raporlar' })).not.toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderPalette()
    await user.keyboard('{Control>}k{/Control}')
    await user.type(await screen.findByRole('combobox'), 'qqqqqq')
    expect(screen.getByText('Eşleşen komut yok.')).toBeInTheDocument()
  })

  it('returns focus to the element that opened it', async () => {
    const db = setupFea()
    signIn(db)
    const user = userEvent.setup()
    renderRoutes([
      {
        path: '/',
        element: (
          <>
            <button type="button">Opener</button>
            <CommandPalette />
          </>
        ),
      },
    ])
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('combobox')).toHaveFocus()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })
})
