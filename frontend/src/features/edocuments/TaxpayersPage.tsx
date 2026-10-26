import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { usePermission } from '@/lib/permissions'
import { edocumentsApi } from './api'
import { useEdocT, useOperation } from './hooks'
import { control, ErrorNotice, Field, Header, Panel } from './ui'
import type { Alias, Taxpayer } from './types'
export function TaxpayersPage() {
  const t = useEdocT()
  const operation = useOperation()
  const canManage = usePermission('edocuments.manage')
  const [taxNumber, setTaxNumber] = useState('')
  const [result, setResult] = useState<Taxpayer | null>(null)
  const [name, setName] = useState('')
  const [aliases, setAliases] = useState<Alias[]>([{ kind: 'e_invoice', alias: '' }])
  const [saved, setSaved] = useState(false)
  return (
    <>
      <Header title={t('taxpayers')} />
      <Panel>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            setSaved(false)
            void operation.run(
              ['lookup', taxNumber],
              (_key, signal) => edocumentsApi.taxpayers(taxNumber, signal),
              setResult,
            )
          }}
        >
          <Field label={t('taxNumber')}>
            <input
              className={control}
              inputMode="numeric"
              value={taxNumber}
              onChange={(event) => {
                setTaxNumber(event.target.value)
                setResult(null)
                setSaved(false)
              }}
              pattern="[0-9]{10,11}"
              maxLength={11}
              required
              disabled={operation.busy}
            />
          </Field>
          <Button type="submit" disabled={operation.busy}>
            {t('lookup')}
          </Button>
        </form>
        <ErrorNotice error={operation.error} />
        {result && (
          <div role="status" className="space-y-2 text-sm">
            <p>{t(result.registered ? 'registered' : 'notRegistered')}</p>
            {result.aliases.length > 0 && (
              <ul className="space-y-1">
                {result.aliases.map((alias) => (
                  <li key={`${alias.kind}:${alias.alias}`}>
                    <span className="font-medium">{t(alias.kind)}</span> ·{' '}
                    <span className="break-all font-mono text-xs">{alias.alias}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>
      {canManage && (
        <Panel>
          <h2 className="text-sm font-semibold">{t('directory')}</h2>
          <p className="text-xs text-muted-foreground">{t('directoryHelp')}</p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault()
              const body = { tax_number: taxNumber, name, aliases }
              void operation.run(
                ['directory', body],
                (key, signal) => edocumentsApi.directory(body, key, signal),
                (value) => {
                  setResult(value)
                  setSaved(true)
                },
              )
            }}
          >
            <Field label={t('taxNumber')}>
              <input
                className={control}
                value={taxNumber}
                inputMode="numeric"
                pattern="[0-9]{10,11}"
                maxLength={11}
                required
                onChange={(event) => setTaxNumber(event.target.value)}
                disabled={operation.busy}
              />
            </Field>
            <Field label={t('name')}>
              <input
                className={control}
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                maxLength={200}
                disabled={operation.busy}
              />
            </Field>
            <fieldset className="space-y-3">
              <legend className="mb-2 text-xs font-medium">{t('aliases')}</legend>
              {aliases.map((alias, index) => (
                <div key={index} className="grid gap-3 sm:grid-cols-[10rem_1fr_auto]">
                  <Field label={t('kind')}>
                    <select
                      className={control}
                      value={alias.kind}
                      disabled={operation.busy}
                      onChange={(event) =>
                        setAliases((items) =>
                          items.map((item, i) =>
                            i === index
                              ? { ...item, kind: event.target.value as Alias['kind'] }
                              : item,
                          ),
                        )
                      }
                    >
                      <option value="e_invoice">{t('e_invoice')}</option>
                      <option value="e_despatch">{t('e_despatch')}</option>
                    </select>
                  </Field>
                  <Field label={t('alias')}>
                    <input
                      className={control}
                      value={alias.alias}
                      required
                      maxLength={200}
                      disabled={operation.busy}
                      onChange={(event) =>
                        setAliases((items) =>
                          items.map((item, i) =>
                            i === index ? { ...item, alias: event.target.value } : item,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Button
                    className="self-end"
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={operation.busy || aliases.length === 1}
                    onClick={() => setAliases((items) => items.filter((_item, i) => i !== index))}
                  >
                    {t('remove')}
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={operation.busy || aliases.length >= 10}
                onClick={() => setAliases((items) => [...items, { kind: 'e_invoice', alias: '' }])}
              >
                {t('addAlias')}
              </Button>
            </fieldset>
            <Button type="submit" disabled={operation.busy}>
              {t('saveDirectory')}
            </Button>
            {saved && (
              <p role="status" className="text-sm">
                {t('saved')}
              </p>
            )}
          </form>
        </Panel>
      )}
    </>
  )
}
