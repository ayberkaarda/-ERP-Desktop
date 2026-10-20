import { CornerDownLeft, Search } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { cn } from '@/lib/utils'
import { coreCommands } from './coreCommands'
import { bestScore } from './fuzzy'
import { registerCommands, useAvailableCommands, type Command, type CommandGroup } from './registry'
import { usePaletteStore } from './store'

const GROUP_ORDER: CommandGroup[] = ['navigation', 'actions', 'company', 'preferences']

interface Ranked {
  command: Command
  title: string
  score: number
}

/** Mount once inside the authenticated shell: owns the Ctrl/Cmd+K hotkey and core commands. */
export function CommandPalette() {
  const open = usePaletteStore((s) => s.open)
  const setOpen = usePaletteStore((s) => s.setOpen)

  useEffect(() => registerCommands(coreCommands()), [])

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        usePaletteStore.getState().toggle()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onCloseAutoFocus={(e) => {
            const opener = usePaletteStore.getState().opener
            if (opener?.isConnected) {
              e.preventDefault()
              opener.focus()
            }
          }}
          className="fixed top-[12vh] left-1/2 z-50 w-[min(36rem,calc(100vw-2rem))] -translate-x-1/2 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-lg outline-none data-[state=open]:animate-pop-in"
        >
          {open && <PaletteBody onDone={() => setOpen(false)} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function PaletteBody({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const available = useAvailableCommands()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const listId = useId()
  const listRef = useRef<HTMLDivElement>(null)

  const ranked = useMemo<Ranked[]>(() => {
    const out: Ranked[] = []
    for (const command of available) {
      const title = command.title(t)
      const score = bestScore(query, [title, ...(command.keywords?.(t) ?? [])])
      if (score !== null) out.push({ command, title, score })
    }
    if (query.trim()) return out.sort((a, b) => b.score - a.score)
    // Without a query, keep groups in a stable order.
    return out.sort(
      (a, b) => GROUP_ORDER.indexOf(a.command.group) - GROUP_ORDER.indexOf(b.command.group),
    )
  }, [available, query, t])

  const sections = useMemo(() => {
    if (query.trim()) return [{ group: null, items: ranked }]
    return GROUP_ORDER.map((group) => ({
      group,
      items: ranked.filter((r) => r.command.group === group),
    })).filter((s) => s.items.length > 0)
  }, [ranked, query])

  const flat = sections.flatMap((s) => s.items)
  const current = Math.min(active, Math.max(flat.length - 1, 0))
  const optionId = (i: number) => `${listId}-opt-${i}`

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [current])

  function run(item: Ranked | undefined) {
    if (!item) return
    onDone()
    void item.command.run({ navigate: (to) => void navigate(to) })
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive(flat.length ? (current + 1) % flat.length : 0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(flat.length ? (current - 1 + flat.length) % flat.length : 0)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(Math.max(flat.length - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(flat[current])
    }
  }

  let index = -1
  return (
    <>
      <DialogPrimitive.Title className="sr-only">{t('palette.title')}</DialogPrimitive.Title>
      <div className="flex items-center gap-2 border-b border-border px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          autoFocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={flat.length ? optionId(current) : undefined}
          aria-label={t('palette.placeholder')}
          placeholder={t('palette.placeholder')}
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-subtle-foreground"
        />
        <kbd className="font-code rounded-sm border border-border px-1.5 text-2xs text-muted-foreground">
          Esc
        </kbd>
      </div>
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={t('palette.results')}
        className="max-h-[min(24rem,60vh)] overflow-y-auto p-1.5"
      >
        {flat.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">
            {t('palette.empty')}
          </p>
        ) : (
          sections.map((section) => (
            <div
              key={section.group ?? 'results'}
              role="group"
              aria-label={
                section.group ? t(`palette.group.${section.group}`) : t('palette.results')
              }
            >
              {section.group && (
                <p
                  aria-hidden="true"
                  className="px-2 pt-2 pb-1 text-2xs font-medium tracking-wide text-muted-foreground uppercase"
                >
                  {t(`palette.group.${section.group}`)}
                </p>
              )}
              {section.items.map((item) => {
                index += 1
                const i = index
                const selected = i === current
                const Icon = item.command.icon
                return (
                  <div
                    key={item.command.id}
                    id={optionId(i)}
                    data-index={i}
                    role="option"
                    aria-selected={selected}
                    onMouseMove={() => {
                      if (!selected) setActive(i)
                    }}
                    onClick={() => run(item)}
                    className={cn(
                      'flex h-9 cursor-default items-center gap-2.5 rounded-sm px-2 text-sm select-none',
                      selected && 'bg-surface-sunken',
                    )}
                  >
                    {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    {selected && (
                      <CornerDownLeft
                        className="size-3.5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ))
        )}
      </div>
    </>
  )
}
