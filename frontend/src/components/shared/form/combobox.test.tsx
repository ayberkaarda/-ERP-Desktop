import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { AsyncCombobox } from './AsyncCombobox'
import { Combobox, type ComboboxOption } from './Combobox'

beforeAll(() => {
  // jsdom has no layout APIs.
  Element.prototype.scrollIntoView = () => undefined
})

const CITIES = [
  { value: 'ist', label: 'İstanbul' },
  { value: 'izm', label: 'İzmir' },
]

function Harness({ onPick }: { onPick: (v: string | null) => void }) {
  const [value, setValue] = useState<string | null>('izm')
  return (
    <>
      <Combobox
        aria-label="Şehir"
        value={value}
        options={CITIES}
        clearable
        onChange={(v) => {
          setValue(v)
          onPick(v)
        }}
      />
      <button type="button">sonraki</button>
    </>
  )
}

describe('Combobox clearing', () => {
  it('reaches the clear button with Tab and clears from the keyboard', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    await user.click(screen.getByRole('combobox', { name: 'Şehir' }))
    await user.keyboard('{Escape}')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Seçimi temizle' })).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('combobox', { name: 'Şehir' })).toHaveFocus()
  })

  it('clears the selected id when the text is emptied', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<Harness onPick={onPick} />)
    const input = screen.getByRole('combobox', { name: 'Şehir' })
    expect(input).toHaveValue('İzmir')
    await user.clear(input)
    expect(onPick).toHaveBeenLastCalledWith(null)
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })
})

function AsyncHarness({
  load,
  scope,
  onPick,
}: {
  load: (q: string, signal: AbortSignal) => Promise<ComboboxOption[]>
  scope: string
  onPick: (v: string | null) => void
}) {
  const [value, setValue] = useState<string | null>(null)
  return (
    <AsyncCombobox
      aria-label="Cari"
      value={value}
      scopeKey={scope}
      debounceMs={60}
      loadOptions={(q, signal) => load(`${scope}:${q}`, signal)}
      onChange={(v) => {
        setValue(v)
        onPick(v)
      }}
    />
  )
}

const optionsFor = (q: string): ComboboxOption[] => [{ value: q, label: `Sonuç ${q}` }]

describe('AsyncCombobox', () => {
  it('never lets Enter pick results of an older text', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    const load = vi.fn((q: string) => Promise.resolve(optionsFor(q)))
    render(<AsyncHarness load={load} scope="customer" onPick={onPick} />)
    const input = screen.getByRole('combobox', { name: 'Cari' })

    await user.type(input, 'a')
    expect(await screen.findByRole('option', { name: 'Sonuç customer:a' })).toBeInTheDocument()
    // Typing more hides the old hits at once; Enter before the new search settles picks nothing.
    await user.keyboard('b')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    await user.keyboard('{Enter}')
    expect(onPick).not.toHaveBeenCalled()

    await screen.findByRole('option', { name: 'Sonuç customer:ab' }, { timeout: 3000 })
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenLastCalledWith('customer:ab')
  })

  it('searches again when the scope changes for the same text', async () => {
    const user = userEvent.setup()
    const load = vi.fn((q: string) => Promise.resolve(optionsFor(q)))
    const { rerender } = render(<AsyncHarness load={load} scope="customer" onPick={vi.fn()} />)
    await user.type(screen.getByRole('combobox', { name: 'Cari' }), 'x')
    await screen.findByRole('option', { name: 'Sonuç customer:x' })

    rerender(<AsyncHarness load={load} scope="supplier" onPick={vi.fn()} />)
    expect(await screen.findByRole('option', { name: 'Sonuç supplier:x' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Sonuç customer:x')).not.toBeInTheDocument())
  })
})
