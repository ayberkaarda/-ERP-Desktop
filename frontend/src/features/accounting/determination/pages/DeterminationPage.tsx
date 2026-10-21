import { useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, Route, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { FieldShell } from '@/components/shared/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { platform } from '@/platform'
import { rulesApi } from '../../shared/api'
import { AccountingShell, LoadError, NativeSelect } from '../../shared/components'
import { errorMessage, isVersionConflict } from '../../shared/errors'
import { useAccT } from '../../shared/i18n'
import { accKeys } from '../../shared/keys'
import { useDeleteRule, useRules } from '../../shared/queries'
import { SavedViewsMenu } from '../../shared/SavedViewsMenu'
import {
  DETERMINATION_EVENTS,
  type DeterminationRule,
  type DeterminationTestResult,
} from '../../shared/types'
import { RuleDialog } from '../components/RuleDialog'
import { TestPanel } from '../components/TestPanel'
import {
  applyPriorityChanges,
  groupRules,
  isDefaultRule,
  movePriority,
  PriorityMoveError,
  ruleMatches,
} from '../lib/rules'

const VIEW_KEY = 'accounting.determination'

type Editor = { rule: DeterminationRule | null; eventKey: string; priority: number } | null

function Conditions({ rule }: { rule: DeterminationRule }) {
  const t = useAccT()
  if (isDefaultRule(rule)) return <Badge>{t('determination.default')}</Badge>
  return (
    <ul className="flex flex-wrap gap-1">
      {Object.entries(rule.conditions ?? {}).map(([k, v]) => (
        <li key={k}>
          <Badge tone="info">
            {t(`determination.conditionKeys.${k}`, { defaultValue: k })}:{' '}
            {Array.isArray(v) ? v.join(' | ') : v}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

export function DeterminationPage() {
  const t = useAccT()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const rules = useRules()
  const remove = useDeleteRule()
  const [editor, setEditor] = useState<Editor>(null)
  const [deleting, setDeleting] = useState<DeterminationRule | null>(null)
  const [moving, setMoving] = useState<string | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [matched, setMatched] = useState<DeterminationTestResult | null>(null)
  const q = params.get('q') ?? ''
  const group = params.get('group') ?? ''
  const showEmpty = params.get('empty') === '1'

  const setParam = (key: string, value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (value) next.set(key, value)
        else next.delete(key)
        return next
      },
      { replace: true },
    )

  const all = useMemo(() => rules.data ?? [], [rules.data])
  const groups = useMemo(() => groupRules(all, DETERMINATION_EVENTS), [all])
  const events = useMemo(() => groups.flatMap((g) => g.events.map((e) => e.eventKey)), [groups])
  const visible = groups
    .filter((g) => !group || g.group === group)
    .map((g) => ({
      ...g,
      events: g.events
        .map((e) => ({
          ...e,
          rules: e.rules.filter((r) => ruleMatches(r, q) || e.eventKey.includes(q.trim())),
        }))
        .filter((e) => e.rules.length > 0 || (showEmpty && !q.trim())),
    }))
    .filter((g) => g.events.length > 0)

  const move = async (
    ordered: DeterminationRule[],
    rule: DeterminationRule,
    dir: 'up' | 'down',
  ) => {
    const changes = movePriority(ordered, rule.id, dir)
    if (changes.length === 0) return
    setMoving(rule.id)
    setMoveError(null)
    try {
      await applyPriorityChanges(changes, (id, version, priority) =>
        rulesApi.update(id, version, { priority }),
      )
    } catch (error) {
      const cause = error instanceof PriorityMoveError ? error.cause : error
      const reason = isVersionConflict(cause)
        ? t('common.conflictBody')
        : errorMessage(cause, t('common.actionFailed'))
      const rolledBack = error instanceof PriorityMoveError && error.rolledBack
      setMoveError(
        t(rolledBack ? 'determination.moveFailed' : 'determination.moveFailedPartial', {
          event: rule.event_key,
          reason,
        }),
      )
    } finally {
      // Always show the server's order: after a failure it is the truth to work from.
      await qc.invalidateQueries({ queryKey: accKeys.rules() })
      setMoving(null)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    try {
      await remove.mutateAsync({ id: deleting.id, version: deleting.version })
      platform.notify.success(t('determination.toast.deleted'))
    } catch (error) {
      platform.notify.error(errorMessage(error, t('common.actionFailed')))
      throw error
    }
  }

  return (
    <AccountingShell
      wide
      title={t('determination.title')}
      description={t('determination.subtitle')}
      actions={
        <>
          <SavedViewsMenu
            storageKey={VIEW_KEY}
            current={{
              ...(q ? { q } : {}),
              ...(group ? { group } : {}),
              ...(showEmpty ? { empty: '1' } : {}),
            }}
            onApply={(v) =>
              setParams(
                (prev) => {
                  const next = new URLSearchParams(prev)
                  for (const k of ['q', 'group', 'empty']) {
                    const val = v[k]
                    if (val) next.set(k, val)
                    else next.delete(k)
                  }
                  return next
                },
                { replace: true },
              )
            }
          />
          <Button onClick={() => setEditor({ rule: null, eventKey: '', priority: 100 })}>
            <Plus aria-hidden="true" />
            {t('determination.new')}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          {moveError && (
            <div
              role="alert"
              className="flex items-start justify-between gap-3 rounded-md border border-danger/30 bg-danger-soft p-3 text-sm text-danger-soft-foreground"
            >
              <p>{moveError}</p>
              <Button variant="ghost" size="sm" onClick={() => setMoveError(null)}>
                {t('common.dismiss')}
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-3">
            <FieldShell label={t('determination.search')} className="min-w-56 flex-1">
              {(control) => (
                <Input
                  {...control}
                  type="search"
                  value={q}
                  placeholder={t('determination.searchPlaceholder')}
                  onChange={(e) => setParam('q', e.target.value)}
                />
              )}
            </FieldShell>
            <FieldShell label={t('determination.group')} className="w-44">
              {(control) => (
                <NativeSelect
                  {...control}
                  value={group}
                  emptyLabel={t('common.all')}
                  options={groups.map((g) => ({
                    value: g.group,
                    label: t(`determination.groups.${g.group}`, { defaultValue: g.group }),
                  }))}
                  onChange={(e) => setParam('group', e.target.value)}
                />
              )}
            </FieldShell>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={showEmpty}
                onChange={(e) => setParam('empty', e.target.checked ? '1' : '')}
              />
              {t('determination.showEmpty')}
            </label>
          </div>
          {rules.isLoading && <Skeleton className="h-64 w-full" aria-label={t('common.loading')} />}
          {rules.isError && <LoadError error={rules.error} onRetry={() => void rules.refetch()} />}
          {rules.data && visible.length === 0 && (
            <EmptyState
              compact
              icon={<Route className="size-10 text-muted-foreground" aria-hidden="true" />}
              title={t('determination.empty')}
            />
          )}
          {visible.map((g) => (
            <section key={g.group} aria-labelledby={`grp-${g.group}`} className="space-y-3">
              <h2 id={`grp-${g.group}`} className="text-base font-semibold">
                {t(`determination.groups.${g.group}`, { defaultValue: g.group })}
              </h2>
              {g.events.map((e) => (
                <div
                  key={e.eventKey}
                  className="overflow-x-auto rounded-md border border-border bg-surface"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-sunken px-3 py-2">
                    <h3 className="text-sm font-medium">
                      <span className="font-code">{e.eventKey}</span>
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {(DETERMINATION_EVENTS as readonly string[]).includes(e.eventKey)
                          ? t(`determination.events.${e.eventKey.replace(/\./g, '_')}`)
                          : null}
                      </span>
                    </h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t('determination.addFor', { event: e.eventKey })}
                      onClick={() =>
                        setEditor({
                          rule: null,
                          eventKey: e.eventKey,
                          priority: (e.rules[0]?.priority ?? 0) + 10,
                        })
                      }
                    >
                      <Plus aria-hidden="true" />
                      {t('determination.addRule')}
                    </Button>
                  </div>
                  {e.rules.length === 0 ? (
                    <p className="px-3 py-3 text-sm text-muted-foreground">
                      {t('determination.noRules')}
                    </p>
                  ) : (
                    <table className="w-full text-table">
                      <caption className="sr-only">
                        {t('determination.tableCaption', { event: e.eventKey })}
                      </caption>
                      <thead className="text-left text-xs text-muted-foreground">
                        <tr>
                          <th scope="col" className="w-20 px-3 py-1.5">
                            {t('determination.fields.priority')}
                          </th>
                          <th scope="col" className="px-3 py-1.5">
                            {t('determination.fields.conditions')}
                          </th>
                          <th scope="col" className="px-3 py-1.5">
                            {t('determination.fields.account')}
                          </th>
                          <th scope="col" className="w-24 px-3 py-1.5">
                            {t('determination.fields.side')}
                          </th>
                          <th scope="col" className="w-44 px-3 py-1.5 text-right">
                            {t('common.actions')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {e.rules.map((r, i) => {
                          const hit = matched?.rule_id === r.id
                          const busy = moving !== null
                          return (
                            <tr
                              key={r.id}
                              data-matched={hit || undefined}
                              className={cn(
                                'border-t border-border align-top',
                                hit && 'bg-success-soft',
                              )}
                            >
                              <td className="px-3 py-1.5 tabular-nums">{r.priority}</td>
                              <td className="px-3 py-1.5">
                                <Conditions rule={r} />
                                {r.description && (
                                  <p className="mt-0.5 text-xs text-muted-foreground">
                                    {r.description}
                                  </p>
                                )}
                              </td>
                              <td className="px-3 py-1.5">
                                <span className="font-code">{r.account?.code ?? r.account_id}</span>{' '}
                                {r.account?.name}
                                {r.is_system && (
                                  <Badge className="ml-1" tone="neutral">
                                    {t('determination.system')}
                                  </Badge>
                                )}
                                {hit && (
                                  <Badge className="ml-1" tone="success">
                                    {t('determination.test.matched')}
                                  </Badge>
                                )}
                              </td>
                              <td className="px-3 py-1.5">
                                {r.side ? t(`accounts.side.${r.side}`) : '—'}
                              </td>
                              <td className="px-3 py-1.5">
                                <div className="flex justify-end gap-0.5">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={busy || i === 0 || r.is_system}
                                    aria-label={t('determination.moveUp', {
                                      n: i + 1,
                                      event: e.eventKey,
                                    })}
                                    onClick={() => void move(e.rules, r, 'up')}
                                  >
                                    <ArrowUp aria-hidden="true" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    disabled={busy || i === e.rules.length - 1 || r.is_system}
                                    aria-label={t('determination.moveDown', {
                                      n: i + 1,
                                      event: e.eventKey,
                                    })}
                                    onClick={() => void move(e.rules, r, 'down')}
                                  >
                                    <ArrowDown aria-hidden="true" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    aria-label={t('determination.editN', {
                                      n: i + 1,
                                      event: e.eventKey,
                                    })}
                                    onClick={() =>
                                      setEditor({
                                        rule: r,
                                        eventKey: r.event_key,
                                        priority: r.priority,
                                      })
                                    }
                                  >
                                    <Pencil aria-hidden="true" />
                                  </Button>
                                  {!r.is_system && (
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      aria-label={t('determination.deleteN', {
                                        n: i + 1,
                                        event: e.eventKey,
                                      })}
                                      onClick={() => setDeleting(r)}
                                    >
                                      <Trash2 aria-hidden="true" />
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="lg:sticky lg:top-4 lg:self-start">
          <TestPanel events={events} rules={rules.data ?? []} onResult={setMatched} />
        </div>
      </div>
      {editor && (
        <RuleDialog
          rule={editor.rule}
          eventKey={editor.eventKey}
          priority={editor.priority}
          onClose={() => setEditor(null)}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={t('determination.deleteTitle')}
        description={t('determination.deleteBody', { event: deleting?.event_key ?? '' })}
        confirmLabel={t('determination.delete')}
        onConfirm={doDelete}
      />
    </AccountingShell>
  )
}
