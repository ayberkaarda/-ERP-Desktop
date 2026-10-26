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
import { usePresets } from '../presets'

interface PresetsMenuProps {
  storageKey: string
  /** Keys a preset may carry; anything else in stored data is ignored. */
  allowed?: readonly string[]
  current: Record<string, string>
  onApply: (params: Record<string, string>) => void
  /** "Kayıtlı görünümler" for lists, "Kayıtlı parametreler" for reports. */
  title: string
}

/** Named parameter sets (list filters or report parameters) stored per browser. */
export function PresetsMenu({ storageKey, allowed, current, onApply, title }: PresetsMenuProps) {
  const { t } = useTranslation('sales-docs')
  const { list, save, remove } = usePresets(storageKey, allowed)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')

  const submit = (e: { preventDefault: () => void }) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    const params = Object.fromEntries(
      Object.entries(current).filter(([k, v]) => v !== '' && (!allowed || allowed.includes(k))),
    )
    save({ name: trimmed, params })
    setOpen(false)
    setName('')
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="sm" className="print:hidden">
            <Bookmark aria-hidden="true" />
            {title}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>{title}</DropdownMenuLabel>
          {list.length === 0 && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">{t('presets.empty')}</p>
          )}
          {list.map((p) => (
            <div key={p.name} className="flex items-center gap-1">
              <DropdownMenuItem className="flex-1" onSelect={() => onApply(p.params)}>
                {p.name}
              </DropdownMenuItem>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('presets.remove', { name: p.name })}
                onClick={() => remove(p.name)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setOpen(true)}>
            {t('presets.saveCurrent')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t('actions.close')}>
          <form onSubmit={submit} className="grid gap-4">
            <DialogHeader>
              <DialogTitle>{t('presets.saveTitle')}</DialogTitle>
              <DialogDescription>{t('presets.saveBody')}</DialogDescription>
            </DialogHeader>
            <FieldShell label={t('presets.name')} required>
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
