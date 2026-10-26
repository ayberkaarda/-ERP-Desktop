import { Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { usePaletteStore } from './store'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function PaletteTrigger() {
  const { t } = useTranslation()
  const setOpen = usePaletteStore((s) => s.setOpen)
  const shortcut = isMac ? '⌘K' : 'Ctrl K'
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
      aria-label={t('palette.open')}
      className="inline-flex h-control-sm items-center gap-2 rounded-md border border-border bg-surface px-2 text-xs text-muted-foreground shadow-xs hover:bg-surface-sunken"
    >
      <Search className="size-3.5" aria-hidden="true" />
      <span className="hidden md:inline">{t('palette.search')}</span>
      <kbd className="font-code hidden rounded-xs border border-border px-1 text-2xs md:inline">
        {shortcut}
      </kbd>
    </button>
  )
}
