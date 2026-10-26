import { zodResolver } from '@hookform/resolvers/zod'
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Decimal from 'decimal.js'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { decimalString, MSG } from '@/lib/forms'
import { Form } from '../form/Field'
import { MoneyInput, QuantityInput } from '../form/DecimalInput'
import { DocumentLinesEditor, type LineColumn } from './DocumentLinesEditor'

const schema = z.object({
  lines: z
    .array(
      z.object({
        description: z.string().min(1, MSG.required),
        quantity: decimalString({ positive: true, scale: 3 }),
        price: decimalString({ nonNegative: true, scale: 2 }),
      }),
    )
    .min(1, MSG.required),
})
type Values = z.infer<typeof schema>
type Line = Values['lines'][number]

const columns: LineColumn<Line>[] = [
  {
    id: 'description',
    header: 'Açıklama',
    render: (c) => (
      <input
        {...c.cell}
        ref={c.ref}
        value={c.value}
        onChange={(e) => c.setValue(e.target.value)}
        onBlur={c.onBlur}
      />
    ),
  },
  {
    id: 'quantity',
    header: 'Miktar',
    render: (c) => (
      <QuantityInput
        {...c.cell}
        ref={c.ref}
        value={c.value}
        onChange={c.setValue}
        onBlur={c.onBlur}
      />
    ),
  },
  {
    id: 'price',
    header: 'Fiyat',
    render: (c) => (
      <MoneyInput {...c.cell} ref={c.ref} value={c.value} onChange={c.setValue} onBlur={c.onBlur} />
    ),
  },
  {
    id: 'total',
    header: 'Tutar',
    readOnly: true,
    render: (c) => <span data-testid={`total-${c.index}`}>{lineTotal(c.line).toFixed(2)}</span>,
  },
]

const CANONICAL = /^-?\d+(?:\.\d+)?$/
// Cells hold raw text while it is invalid; only canonical values take part in totals.
function lineTotal(line: Line): Decimal {
  if (!CANONICAL.test(line.quantity) || !CANONICAL.test(line.price)) return new Decimal(0)
  return new Decimal(line.quantity).mul(line.price)
}

function Editor({ onSubmit, lines }: { onSubmit: (v: Values) => void; lines?: Line[] }) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { lines: lines ?? [{ description: '', quantity: '1.000', price: '' }] },
  })
  return (
    <Form form={form} onSubmit={onSubmit}>
      <DocumentLinesEditor<Values, Line>
        name="lines"
        columns={columns}
        newLine={() => ({ description: '', quantity: '1.000', price: '' })}
        footer={(all) => (
          <span data-testid="sum">
            {all.reduce((s, l) => s.plus(lineTotal(l)), new Decimal(0)).toFixed(2)}
          </span>
        )}
      />
      <button type="submit">Kaydet</button>
    </Form>
  )
}

const cell = (name: string, row: number) =>
  screen.getByRole('textbox', { name: `${name}, ${row}. satır` })

describe('DocumentLinesEditor', () => {
  it('flows with Enter across cells and opens a new line from the last one', async () => {
    const user = userEvent.setup()
    render(<Editor onSubmit={() => undefined} />)
    act(() => cell('Açıklama', 1).focus())
    await user.keyboard('Zeytinyağı{Enter}')
    expect(cell('Miktar', 1)).toHaveFocus()
    await user.keyboard('2{Enter}')
    expect(cell('Fiyat', 1)).toHaveFocus()
    await user.keyboard('12,5{Enter}')
    // Last editable cell: a new line appears and receives focus; the computed column is skipped.
    expect(cell('Açıklama', 2)).toHaveFocus()
    expect(screen.getByTestId('total-0')).toHaveTextContent('25.00')
    expect(screen.getByTestId('sum')).toHaveTextContent('25.00')

    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(cell('Fiyat', 1)).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(cell('Fiyat', 2)).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(cell('Fiyat', 1)).toHaveFocus()
  })

  it('adds and removes lines with buttons and shortcuts', async () => {
    const user = userEvent.setup()
    render(
      <Editor
        onSubmit={() => undefined}
        lines={[
          { description: 'A', quantity: '1.000', price: '1.00' },
          { description: 'B', quantity: '1.000', price: '2.00' },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Satır ekle' }))
    expect(cell('Açıklama', 3)).toHaveFocus()

    await user.keyboard('{Control>}{Delete}{/Control}')
    expect(screen.queryByRole('textbox', { name: 'Açıklama, 3. satır' })).not.toBeInTheDocument()
    expect(cell('Açıklama', 2)).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '1. satırı sil' }))
    expect(cell('Açıklama', 1)).toHaveValue('B')
    expect(screen.getByTestId('sum')).toHaveTextContent('2.00')

    act(() => cell('Açıklama', 1).focus())
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(cell('Açıklama', 2)).toHaveFocus()
    expect(cell('Açıklama', 1)).toHaveValue('B')
  })

  it('validates each line and shows errors in the failing cells', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <Editor
        onSubmit={onSubmit}
        lines={[
          { description: 'Tamam', quantity: '1.000', price: '5.00' },
          { description: '', quantity: '0.000', price: '5.00' },
        ]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(onSubmit).not.toHaveBeenCalled()
    const row2 = screen.getByRole('row', { name: '2. satır' })
    expect(within(row2).getByText('Bu alan zorunludur.')).toBeInTheDocument()
    expect(within(row2).getByText('Değer sıfırdan büyük olmalıdır.')).toBeInTheDocument()
    expect(cell('Açıklama', 2)).toHaveAttribute('aria-invalid', 'true')
    expect(cell('Açıklama', 1)).not.toHaveAttribute('aria-invalid')

    await user.type(cell('Açıklama', 2), 'Düzeltildi')
    await user.clear(cell('Miktar', 2))
    await user.type(cell('Miktar', 2), '3')
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(onSubmit).toHaveBeenCalledWith(
      {
        lines: [
          { description: 'Tamam', quantity: '1.000', price: '5.00' },
          { description: 'Düzeltildi', quantity: '3.000', price: '5.00' },
        ],
      },
      expect.anything(),
    )
  })

  it('reports an empty line list', async () => {
    const user = userEvent.setup()
    render(<Editor onSubmit={() => undefined} lines={[]} />)
    expect(screen.getByText(/Henüz satır yok/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Bu alan zorunludur.')
  })
})
