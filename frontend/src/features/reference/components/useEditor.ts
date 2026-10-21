import { useCallback, useState } from 'react'
import type { FieldValues, UseFormReset } from 'react-hook-form'

/** Which record a dialog edits: nothing, a new record or an existing one. */
export type EditorTarget<T> = { mode: 'closed' } | { mode: 'new' } | { mode: 'edit'; record: T }

export function useEditor<T>() {
  const [target, setTarget] = useState<EditorTarget<T>>({ mode: 'closed' })
  return {
    target,
    openNew: useCallback(() => setTarget({ mode: 'new' }), []),
    openEdit: useCallback((record: T) => setTarget({ mode: 'edit', record }), []),
    close: useCallback(() => setTarget({ mode: 'closed' }), []),
  }
}

/**
 * Keeps the record a dialog edits and re-reads it after a VERSION_CONFLICT, resetting the form
 * to the server state so the user can reapply the change on top of the new version.
 */
export function useReloadableRecord<T, V extends FieldValues>(
  initial: T | null,
  load: (record: T) => Promise<T>,
  reset: UseFormReset<V>,
  toValues: (record: T) => V,
) {
  const [record, setRecord] = useState<T | null>(initial)
  const reload = useCallback(() => {
    if (!record) return
    void load(record).then((fresh) => {
      setRecord(fresh)
      reset(toValues(fresh))
    })
    // load/toValues are module-level functions of the calling dialog.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, reset])
  return { record, reload }
}
