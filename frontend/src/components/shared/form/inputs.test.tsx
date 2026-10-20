import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { INVALID_DATE, toIsoDate } from '@/lib/datetime'
import { decimalString, MSG } from '@/lib/forms'
import { INVALID_DECIMAL } from '@/lib/money'
import { DateInput } from './DateInput'
import { MoneyInput } from './DecimalInput'

function Money({
  onValue,
  allowNegative,
  external,
}: {
  onValue: (v: string) => void
  allowNegative?: boolean
  external?: string
}) {
  const [value, setValue] = useState('')
  return (
    <>
      <MoneyInput
        aria-label="Tutar"
        value={value}
        allowNegative={allowNegative}
        onChange={(v) => {
          setValue(v)
          onValue(v)
        }}
      />
      {external !== undefined && (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setValue(external)}
        >
          Yükle
        </button>
      )}
    </>
  )
}

describe('DecimalInput rejected drafts', () => {
  it('never emits a rejected draft as a value', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Money onValue={onValue} />)
    const input = screen.getByLabelText('Tutar')

    await user.type(input, '-1')
    expect(onValue).toHaveBeenLastCalledWith(INVALID_DECIMAL)
    expect(onValue).not.toHaveBeenCalledWith('-1')
    expect(input).toHaveAttribute('aria-invalid', 'true')

    // tr-TR: "." groups thousands, so "12.34" is malformed, not twelve point three four.
    await user.clear(input)
    await user.type(input, '12.34')
    expect(onValue).toHaveBeenLastCalledWith(INVALID_DECIMAL)
    expect(onValue).not.toHaveBeenCalledWith('12.34')

    // The draft stays visible after blur so the user can fix it.
    await user.tab()
    expect(input).toHaveValue('12.34')
    expect(decimalString().safeParse(INVALID_DECIMAL).error?.issues[0]?.message).toBe(MSG.number)

    await user.clear(input)
    await user.type(input, '12.345')
    expect(onValue).toHaveBeenLastCalledWith('12345.00')
    expect(input).not.toHaveAttribute('aria-invalid')
  })

  it('accepts negatives only when allowed', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Money onValue={onValue} allowNegative />)
    await user.type(screen.getByLabelText('Tutar'), '-1')
    expect(onValue).toHaveBeenLastCalledWith('-1.00')
  })

  it('follows an outside value change while focused', async () => {
    const user = userEvent.setup()
    render(<Money onValue={() => undefined} external="250.75" />)
    const input = screen.getByLabelText('Tutar')
    await user.type(input, '9')
    expect(input).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Yükle' }))
    expect(input).toHaveFocus()
    expect(input).toHaveValue('250,75')
  })
})

function DateField({
  onValue,
  min,
  max,
}: {
  onValue: (v: string) => void
  min?: string
  max?: string
}) {
  const [value, setValue] = useState('')
  return (
    <DateInput
      aria-label="Tarih"
      value={value}
      min={min}
      max={max}
      onChange={(v) => {
        setValue(v)
        onValue(v)
      }}
    />
  )
}

describe('DateInput range', () => {
  const today = toIsoDate(new Date())
  const year = Number(today.slice(0, 4))

  it('treats typed dates outside min/max as invalid', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<DateField onValue={onValue} min={`${year}-01-01`} max={`${year}-12-31`} />)
    const input = screen.getByLabelText('Tarih')
    await user.type(input, `01.01.${year + 1}`)
    expect(onValue).toHaveBeenLastCalledWith(INVALID_DATE)
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await user.clear(input)
    await user.type(input, `15.06.${year}`)
    expect(onValue).toHaveBeenLastCalledWith(`${year}-06-15`)
  })

  it('disables Today outside the range and focuses the nearest enabled day', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    const min = `${year + 1}-03-10`
    render(<DateField onValue={onValue} min={min} max={`${year + 1}-12-31`} />)
    await user.click(screen.getByRole('button', { name: 'Takvimi aç' }))
    const grid = await screen.findByRole('grid')
    expect(screen.getByRole('button', { name: 'Bugün' })).toBeDisabled()
    const first = within(grid).getByRole('button', { name: `10.03.${year + 1}` })
    expect(first).toHaveFocus()
    // Moving before min stays on min instead of landing on a disabled day.
    await user.keyboard('{ArrowLeft}')
    expect(first).toHaveFocus()
    await act(async () => {
      await user.keyboard('{Enter}')
    })
    expect(onValue).toHaveBeenLastCalledWith(min)
  })
})
