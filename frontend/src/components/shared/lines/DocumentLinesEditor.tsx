import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type RefCallback } from 'react'
import {
  Controller,
  useFieldArray,
  useFormContext,
  useFormState,
  useWatch,
  type ArrayPath,
  type FieldArray,
  type FieldValues,
  type Path,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { translateMessage } from '@/lib/forms/translate'
import { cn } from '@/lib/utils'

/** Props to spread on the cell's focusable control; they drive keyboard flow and a11y. */
export interface LineCellProps {
  id: string
  'aria-label': string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'data-line-row': number
  'data-line-col': number
}

export interface LineCellContext<TLine> {
  index: number
  line: TLine
  /** Field value as a string (decimal strings, ids, text). */
  value: string
  setValue: (value: string) => void
  onBlur: () => void
  ref: RefCallback<HTMLElement>
  cell: LineCellProps
  error?: string
  disabled: boolean
}

export interface LineColumn<TLine> {
  /** Key of the line field this column edits (or a free id for computed columns). */
  id: string
  header: string
  width?: string
  align?: 'left' | 'right'
  /** Computed cells (line totals) are not form fields and are skipped by Enter/Tab flow. */
  readOnly?: boolean
  render: (ctx: LineCellContext<TLine>) => ReactNode
}

interface DocumentLinesEditorProps<TForm extends FieldValues, TLine> {
  name: ArrayPath<TForm>
  columns: LineColumn<TLine>[]
  newLine: () => FieldArray<TForm, ArrayPath<TForm>>
  /** Totals row content; receives the live line values. */
  footer?: (lines: TLine[]) => ReactNode
  minLines?: number
  label?: string
  disabled?: boolean
  className?: string
}

const CELL = '[data-line-row]'

function cellPosition(el: Element | null): { row: number; col: number } | null {
  const cell = el?.closest<HTMLElement>(CELL)
  if (!cell) return null
  return { row: Number(cell.dataset.lineRow), col: Number(cell.dataset.lineCol) }
}

/**
 * Keyboard-first lines grid bound to a react-hook-form field array. Enter moves to the next
 * cell (Shift+Enter back), the last cell opens a new line, Up/Down keep the column,
 * Ctrl+Enter inserts below and Ctrl+Delete removes the line.
 */
export function DocumentLinesEditor<TForm extends FieldValues, TLine>({
  name,
  columns,
  newLine,
  footer,
  minLines = 0,
  label,
  disabled = false,
  className,
}: DocumentLinesEditorProps<TForm, TLine>) {
  const { t, i18n } = useTranslation('common')
  const { control } = useFormContext<TForm>()
  const { fields, append, insert, remove } = useFieldArray({ control, name })
  const lines = (useWatch({ control, name: name as unknown as Path<TForm> }) ?? []) as TLine[]
  const { errors } = useFormState({ control, name: name as unknown as Path<TForm> })
  const tableRef = useRef<HTMLTableElement>(null)
  const pendingFocus = useRef<{ row: number; col: number } | null>(null)
  const editable = columns.flatMap((c, i) => (c.readOnly ? [] : [i]))
  const title = label ?? t('lines.title')

  const arrayError = (() => {
    let node: unknown = errors
    for (const part of name.split('.')) {
      node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    }
    const n = node as { message?: string; root?: { message?: string } } | undefined
    return translateMessage(i18n, n?.root?.message ?? n?.message)
  })()

  const focusCell = (row: number, col: number) => {
    const el = tableRef.current?.querySelector<HTMLElement>(
      `[data-line-row="${row}"][data-line-col="${col}"]`,
    )
    if (!el) return false
    el.focus()
    if (el instanceof HTMLInputElement) el.select()
    return true
  }

  useEffect(() => {
    const p = pendingFocus.current
    if (p && focusCell(p.row, p.col)) pendingFocus.current = null
  })

  const addLine = (at?: number) => {
    const first = editable[0] ?? 0
    if (at === undefined) {
      pendingFocus.current = { row: fields.length, col: first }
      append(newLine(), { shouldFocus: false })
    } else {
      pendingFocus.current = { row: at, col: first }
      insert(at, newLine(), { shouldFocus: false })
    }
  }

  const removeLine = (row: number, col?: number) => {
    if (fields.length <= minLines) return
    remove(row)
    const target = Math.min(row, fields.length - 2)
    if (target >= 0 && col !== undefined) pendingFocus.current = { row: target, col }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTableElement>) => {
    if (e.defaultPrevented || e.nativeEvent.isComposing || disabled) return
    const pos = cellPosition(e.target as Element)
    if (!pos) return
    const at = editable.indexOf(pos.col)
    const isLastRow = pos.row === fields.length - 1

    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      addLine(pos.row + 1)
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      const prevCol = editable[at - 1]
      if (prevCol !== undefined) focusCell(pos.row, prevCol)
      else if (pos.row > 0) focusCell(pos.row - 1, editable.at(-1) ?? 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const nextCol = editable[at + 1]
      if (nextCol !== undefined) focusCell(pos.row, nextCol)
      else if (!isLastRow) focusCell(pos.row + 1, editable[0] ?? 0)
      else addLine()
    } else if (e.key === 'ArrowDown' && !e.altKey) {
      if (!isLastRow) {
        e.preventDefault()
        focusCell(pos.row + 1, pos.col)
      }
    } else if (e.key === 'ArrowUp' && !e.altKey) {
      if (pos.row > 0) {
        e.preventDefault()
        focusCell(pos.row - 1, pos.col)
      }
    } else if (e.key === 'Delete' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      removeLine(pos.row, pos.col)
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table
          ref={tableRef}
          aria-label={title}
          aria-describedby={`${name}-lines-hint`}
          className="w-full border-separate border-spacing-0 text-table"
          onKeyDown={onKeyDown}
        >
          <thead className="bg-surface-sunken text-xs text-muted-foreground">
            <tr>
              <th
                scope="col"
                className="h-row w-10 border-b border-border px-2 text-right font-medium"
              >
                {t('lines.lineNo')}
              </th>
              {columns.map((col) => (
                <th
                  key={col.id}
                  scope="col"
                  style={col.width ? { width: col.width } : undefined}
                  className={cn(
                    'h-row border-b border-border px-2 font-medium whitespace-nowrap',
                    col.align === 'right' ? 'text-right' : 'text-left',
                  )}
                >
                  {col.header}
                </th>
              ))}
              <th scope="col" className="h-row w-10 border-b border-border px-2">
                <span className="sr-only">{t('lines.actions')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {fields.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length + 2}
                  className="px-3 py-6 text-center text-sm text-muted-foreground"
                >
                  {t('lines.empty')}
                </td>
              </tr>
            )}
            {fields.map((item, row) => {
              // useWatch catches up one render after append/insert; the field item holds the same values.
              const line = (lines[row] ?? (item as unknown)) as TLine
              const rowLabel = t('lines.row', { index: row + 1 })
              return (
                <tr key={item.id} aria-label={rowLabel} className="align-top">
                  <td className="border-b border-border px-2 pt-2.5 text-right text-xs text-muted-foreground">
                    {row + 1}
                  </td>
                  {columns.map((col, colIndex) => {
                    const fieldName = `${name}.${row}.${col.id}` as Path<TForm>
                    const id = `${name}-${row}-${col.id}`
                    const tdClass = cn(
                      'border-b border-border px-1 py-1',
                      col.align === 'right' && 'text-right',
                    )
                    if (col.readOnly) {
                      return (
                        <td key={col.id} className={cn(tdClass, 'px-2 pt-2.5')}>
                          {col.render({
                            index: row,
                            line,
                            value: '',
                            setValue: () => undefined,
                            onBlur: () => undefined,
                            ref: () => undefined,
                            cell: {
                              id,
                              'aria-label': `${col.header}, ${rowLabel}`,
                              'data-line-row': row,
                              'data-line-col': colIndex,
                            },
                            disabled: true,
                          })}
                        </td>
                      )
                    }
                    return (
                      <td key={col.id} className={tdClass}>
                        <Controller
                          control={control}
                          name={fieldName}
                          render={({ field, fieldState }) => {
                            const error = translateMessage(i18n, fieldState.error?.message)
                            const raw: unknown = field.value
                            return (
                              <>
                                {col.render({
                                  index: row,
                                  line,
                                  value:
                                    typeof raw === 'string'
                                      ? raw
                                      : typeof raw === 'number'
                                        ? String(raw)
                                        : '',
                                  setValue: (v) => field.onChange(v),
                                  onBlur: field.onBlur,
                                  ref: field.ref,
                                  error,
                                  disabled: disabled || Boolean(field.disabled),
                                  cell: {
                                    id,
                                    'aria-label': `${col.header}, ${rowLabel}`,
                                    'aria-invalid': error ? true : undefined,
                                    'aria-describedby': error ? `${id}-error` : undefined,
                                    'data-line-row': row,
                                    'data-line-col': colIndex,
                                  },
                                })}
                                {error && (
                                  <p
                                    id={`${id}-error`}
                                    className="px-1 pt-0.5 text-left text-2xs text-danger"
                                  >
                                    {error}
                                  </p>
                                )}
                              </>
                            )
                          }}
                        />
                      </td>
                    )
                  })}
                  <td className="border-b border-border px-1 py-1 text-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      tabIndex={-1}
                      disabled={disabled || fields.length <= minLines}
                      aria-label={t('lines.remove', { index: row + 1 })}
                      onClick={() => removeLine(row)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          {footer && (
            <tfoot>
              <tr>
                <td colSpan={columns.length + 2} className="bg-surface-sunken px-3 py-2">
                  {footer(lines)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {arrayError && (
        <p role="alert" className="text-xs text-danger">
          {arrayError}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => addLine()}
        >
          <Plus aria-hidden="true" />
          {t('lines.add')}
        </Button>
        <p id={`${name}-lines-hint`} className="text-xs text-muted-foreground">
          {t('lines.hint')}
        </p>
      </div>
    </div>
  )
}
