import { Bookmark, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
import { useAccT } from './i18n'
import { useSavedViews } from './savedViews'

interface SavedViewsMenuProps {
  storageKey: string
  current: Record<string, string>
  onApply: (values: Record<string, string>) => void
}

/** Saved views of a page: apply, save the current parameters under a name, remove. */
export function SavedViewsMenu({ storageKey, current, onApply }: SavedViewsMenuProps) {
  const t = useAccT()
  const { t: tc } = useTranslation('common')
  const { list, save, remove } = useSavedViews(storageKey)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    save({ name: trimmed, values: current })
    setOpen(false)
    setName('')
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm">
            <Bookmark aria-hidden="true" />
            {t('common.savedViews')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>{t('common.savedViews')}</DropdownMenuLabel>
          {list.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('common.noSavedViews')}</p>
          )}
          {list.map((v) => (
            <div key={v.name} className="flex items-center gap-1">
              <DropdownMenuItem className="flex-1" onSelect={() => onApply(v.values)}>
                {v.name}
              </DropdownMenuItem>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.removeView', { name: v.name })}
                onClick={() => remove(v.name)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>{t('common.saveView')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={tc('actions.close')}>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('common.saveView')}</DialogTitle>
              <DialogDescription>{t('common.saveViewBody')}</DialogDescription>
            </DialogHeader>
            <FieldShell label={t('common.viewName')} required>
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
                {tc('actions.cancel')}
              </Button>
              <Button type="submit" disabled={!name.trim()}>
                {tc('actions.save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
