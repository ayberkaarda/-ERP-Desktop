import { zodResolver } from '@hookform/resolvers/zod'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { ApiError } from '@/platform/types'
import { decimalString, MSG, snakeToCamelPath } from '@/lib/forms'
import { Combobox } from './Combobox'
import { DateInput } from './DateInput'
import { MoneyInput, QuantityInput } from './DecimalInput'
import { Form, FormField } from './Field'
import { FormErrorSummary } from './FormErrorSummary'

const schema = z.object({
  unitPrice: decimalString({ positive: true, scale: 2 }),
  note: z.string(),
})
type Values = z.infer<typeof schema>

function ServerForm({ error, onSubmit }: { error: unknown; onSubmit?: (v: Values) => void }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { unitPrice: '', note: '' },
  })
  return (
    <Form form={form} onSubmit={(v) => onSubmit?.(v)}>
      <FormErrorSummary
        error={error}
        mapField={snakeToCamelPath}
        knownFields={['unitPrice', 'note']}
        fieldLabels={{ unitPrice: 'Birim fiyat' }}
      />
      <FormField<Values, 'unitPrice'>
        name="unitPrice"
        label="Birim fiyat"
        required
        render={({ field, control }) => (
          <MoneyInput
            {...control}
            ref={field.ref}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
          />
        )}
      />
      <FormField<Values, 'note'>
        name="note"
        label="Not"
        render={({ field, control }) => <input {...control} {...field} />}
      />
      <button type="submit">Kaydet</button>
    </Form>
  )
}

describe('FormErrorSummary', () => {
  it('maps server errors.fields onto form fields and lists the rest', async () => {
    const user = userEvent.setup()
    const error = new ApiError(422, 'VALIDATION_FAILED', 'Kayıt doğrulanamadı.', {
      unit_price: ['Fiyat limitin üstünde.'],
      currency_rate: ['Kur alınamadı.'],
    })
    render(<ServerForm error={error} />)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Kayıt tamamlanamadı')
    expect(alert).toHaveTextContent('Kayıt doğrulanamadı.')
    expect(alert).toHaveTextContent('Kur alınamadı.')
    await waitFor(() => expect(alert).toHaveFocus())

    const input = screen.getByLabelText(/Birim fiyat/)
    await waitFor(() => expect(input).toHaveAttribute('aria-invalid', 'true'))
    expect(input).toHaveAccessibleDescription('Fiyat limitin üstünde.')
    expect(screen.getByLabelText('Not')).not.toHaveAttribute('aria-invalid')

    await user.click(within(alert).getByRole('button', { name: 'Birim fiyat' }))
    expect(input).toHaveFocus()
  })

  it('renders nothing without an error and translates zod keys', async () => {
    const user = userEvent.setup()
    render(<ServerForm error={null} />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByText('Bu alan zorunludur.')).toBeInTheDocument()
    expect(MSG.required).toBe('validation.required')
  })
})

function MoneyHarness({ onValue }: { onValue: (v: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <>
      <label htmlFor="m">Tutar</label>
      <MoneyInput
        id="m"
        value={value}
        onChange={(v) => {
          setValue(v)
          onValue(v)
        }}
      />
      <QuantityInput aria-label="Miktar" value="2.500" onChange={() => undefined} unit="kg" />
    </>
  )
}

describe('MoneyInput / QuantityInput', () => {
  it('emits canonical strings and shows tr-TR formatting when not editing', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<MoneyHarness onValue={onValue} />)
    const input = screen.getByLabelText('Tutar')
    await user.type(input, '1.234,5')
    expect(onValue).toHaveBeenLastCalledWith('1234.50')
    expect(input).toHaveValue('1.234,5')
    await user.tab()
    expect(input).toHaveValue('1.234,50')
    await user.click(input)
    expect(input).toHaveValue('1234,5')

    await user.clear(input)
    await user.type(input, '12,3,4')
    expect(onValue).toHaveBeenLastCalledWith('12,3,4')
    expect(screen.getByLabelText('Miktar')).toHaveValue('2,5')
  })
})

describe('Combobox', () => {
  beforeAll(() => {
    // jsdom has no layout APIs.
    Element.prototype.scrollIntoView = () => undefined
  })

  const options = [
    { value: 'ist', label: 'İstanbul' },
    { value: 'izm', label: 'İzmir' },
    { value: 'ank', label: 'Ankara', disabled: true },
    { value: 'bur', label: 'Bursa' },
  ]

  function ComboHarness({ onPick }: { onPick: (v: string | null) => void }) {
    const [value, setValue] = useState<string | null>(null)
    return (
      <Combobox
        aria-label="Şehir"
        value={value}
        options={options}
        clearable
        onChange={(v) => {
          setValue(v)
          onPick(v)
        }}
      />
    )
  }

  it('filters with Turkish casing and picks with the keyboard', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(<ComboHarness onPick={onPick} />)
    const input = screen.getByRole('combobox', { name: 'Şehir' })
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await user.type(input, 'iz')
    expect(input).toHaveAttribute('aria-expanded', 'true')
    const list = screen.getByRole('listbox')
    expect(
      within(list)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['İzmir'])
    await user.keyboard('{Enter}')
    expect(onPick).toHaveBeenLastCalledWith('izm')
    expect(input).toHaveValue('İzmir')
    expect(input).toHaveAttribute('aria-expanded', 'false')

    await user.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')).toHaveLength(4)
    // Opens on the current value (İzmir); the next one, Ankara, is disabled and skipped.
    await user.keyboard('{ArrowDown}')
    expect(input.getAttribute('aria-activedescendant')).toBe(
      screen.getByRole('option', { name: 'Bursa' }).id,
    )
    await user.keyboard('{Escape}')
    expect(input).toHaveAttribute('aria-expanded', 'false')
    expect(onPick).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Seçimi temizle' }))
    expect(onPick).toHaveBeenLastCalledWith(null)
  })
})

describe('DateInput', () => {
  function DateHarness({ onValue }: { onValue: (v: string) => void }) {
    const [value, setValue] = useState('2026-10-21')
    return (
      <DateInput
        aria-label="Tarih"
        value={value}
        onChange={(v) => {
          setValue(v)
          onValue(v)
        }}
      />
    )
  }

  it('shows the calendar date in tr-TR and stores YYYY-MM-DD', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<DateHarness onValue={onValue} />)
    const input = screen.getByLabelText('Tarih')
    expect(input).toHaveValue('21.10.2026')
    await user.clear(input)
    await user.type(input, '01022027')
    expect(onValue).toHaveBeenLastCalledWith('2027-02-01')
    await user.tab()
    expect(input).toHaveValue('01.02.2027')

    await user.clear(input)
    await user.type(input, '31.02.2027')
    expect(onValue).toHaveBeenLastCalledWith('31.02.2027')
  })

  it('picks a day from the calendar', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<DateHarness onValue={onValue} />)
    await user.click(screen.getByRole('button', { name: 'Takvimi aç' }))
    const grid = await screen.findByRole('grid')
    expect(within(grid).getByRole('button', { name: '21.10.2026' })).toHaveFocus()
    await user.keyboard('{ArrowRight}{Enter}')
    expect(onValue).toHaveBeenLastCalledWith('2026-10-22')
    expect(screen.getByLabelText('Tarih')).toHaveValue('22.10.2026')
  })
})
