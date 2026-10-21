import { Bookmark, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { setFilter, updateListQuery, type ListQueryState } from '@/components/shared/data-table'
import { FieldShell } from '@/components/shared/form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useSavedFilters } from '../lib/savedFilters'

interface SavedFiltersMenuProps {
  storageKey: string
  query: ListQueryState
  onQueryChange: (next: ListQueryState) => void
}

/** Named search + filter presets for a list page (stored per browser). */
export function SavedFiltersMenu({ storageKey, query, onQueryChange }: SavedFiltersMenuProps) {
  const { t } = useTranslation('catalog')
  const { list, save, remove } = useSavedFilters(storageKey)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const apply = (filters: Record<string, string>, q: string) => {
    let next = updateListQuery(query, { q, filters: {} })
    for (const [k, v] of Object.entries(filters)) next = setFilter(next, k, v)
    onQueryChange(next)
  }

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    save({ name: trimmed, q: query.q, filters: query.filters })
    setOpen(false)
    setName('')
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Bookmark aria-hidden="true" />
            {t('savedFilters.title')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>{t('savedFilters.title')}</DropdownMenuLabel>
          {list.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('savedFilters.empty')}</p>
          )}
          {list.map((f) => (
            <div key={f.name} className="flex items-center gap-1">
              <DropdownMenuItem className="flex-1" onSelect={() => apply(f.filters, f.q)}>
                {f.name}
              </DropdownMenuItem>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('savedFilters.remove', { name: f.name })}
                onClick={() => remove(f.name)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            {t('savedFilters.saveCurrent')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('actions.close')}>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('savedFilters.saveTitle')}</DialogTitle>
              <DialogDescription>{t('savedFilters.saveBody')}</DialogDescription>
            </DialogHeader>
            <FieldShell label={t('savedFilters.name')} required>
              {(control) => (
                <Input
                  {...control}
                  value={name}
                  maxLength={80}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </FieldShell>
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t('actions.cancel')}
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                {t('actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
