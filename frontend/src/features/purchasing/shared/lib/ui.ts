import type { LineCellContext } from '@/components/shared/lines/DocumentLinesEditor'
import type { CellBinding } from '../components/LineCells'

/** Table cell classes shared by the read-only line tables. */
export const TABLE = {
  th: 'h-row border-b border-border px-2 text-left text-xs font-medium whitespace-nowrap',
  thr: 'h-row border-b border-border px-2 text-right text-xs font-medium whitespace-nowrap',
  td: 'border-b border-border px-2 py-1.5 align-top text-sm',
  tdr: 'border-b border-border px-2 py-1.5 align-top text-right text-sm tabular-nums',
}

/** The plain values of a lines-editor cell (the ref goes to the cell as `inputRef`). */
export function bind<L>(ctx: LineCellContext<L>): CellBinding {
  return {
    cell: ctx.cell,
    value: ctx.value,
    setValue: ctx.setValue,
    onBlur: ctx.onBlur,
    disabled: ctx.disabled,
    index: ctx.index,
  }
}
