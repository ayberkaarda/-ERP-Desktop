import { create } from 'zustand'

interface PaletteState {
  open: boolean
  /** Element focused when the palette opened; focus returns there on close. */
  opener: HTMLElement | null
  setOpen: (open: boolean) => void
  toggle: () => void
}

function activeElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null
}

export const usePaletteStore = create<PaletteState>()((set, get) => ({
  open: false,
  opener: null,
  setOpen: (open) => {
    if (open === get().open) return
    set(open ? { open, opener: activeElement() } : { open })
  },
  toggle: () => get().setOpen(!get().open),
}))
