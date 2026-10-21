import { Plus, Trash2 } from 'lucide-react'
import { useId } from 'react'
import {
  useFieldArray,
  useFormContext,
  useFormState,
  type ArrayPath,
  type FieldValues,
  type Path,
} from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translateMessage } from '@/lib/forms'

function readError(errors: unknown, path: string): string | undefined {
  let node: unknown = errors
  for (const part of path.split('.')) {
    node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
  }
  return (node as { message?: string } | undefined)?.message
}

interface AttributeEditorProps<T extends FieldValues> {
  name: ArrayPath<T>
  label: string
  disabled?: boolean
}

/** Key/value attribute list (colour = red) bound to a react-hook-form field array. */
export function AttributeEditor<T extends FieldValues>({
  name,
  label,
  disabled = false,
}: AttributeEditorProps<T>) {
  const { t, i18n } = useTranslation('catalog')
  const { control, register } = useFormContext<T>()
  const { fields, append, remove } = useFieldArray({ control, name })
  const { errors } = useFormState({ control, name: name as unknown as Path<T> })
  const headingId = useId()
  const listError = translateMessage(
    i18n,
    readError(errors, `${name}.root`) ?? readError(errors, name),
  )

  return (
    <fieldset className="space-y-2" aria-labelledby={headingId} disabled={disabled}>
      <legend id={headingId} className="text-sm font-medium">
        {label}
      </legend>
      {fields.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('attributes.empty')}</p>
      )}
      <ul className="space-y-2">
        {fields.map((f, i) => {
          const keyError = translateMessage(i18n, readError(errors, `${name}.${i}.key`))
          const keyId = `${headingId}-${i}-key`
          return (
            <li key={f.id} className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1 space-y-1">
                <Input
                  id={keyId}
                  aria-label={t('attributes.key', { index: i + 1 })}
                  placeholder={t('attributes.keyPlaceholder')}
                  aria-invalid={keyError ? true : undefined}
                  aria-describedby={keyError ? `${keyId}-error` : undefined}
                  {...register(`${name}.${i}.key` as Path<T>)}
                />
                {keyError && (
                  <p id={`${keyId}-error`} className="text-xs text-danger">
                    {keyError}
                  </p>
                )}
              </div>
              <Input
                className="min-w-0 flex-1"
                aria-label={t('attributes.value', { index: i + 1 })}
                placeholder={t('attributes.valuePlaceholder')}
                {...register(`${name}.${i}.value` as Path<T>)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('attributes.remove', { index: i + 1 })}
                onClick={() => remove(i)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          )
        })}
      </ul>
      {listError && <p className="text-xs text-danger">{listError}</p>}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => append({ key: '', value: '' } as never)}
      >
        <Plus aria-hidden="true" />
        {t('attributes.add')}
      </Button>
    </fieldset>
  )
}
