import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { useResolvedTheme } from '@/app/theme'

export function Toaster(props: ToasterProps) {
  const theme = useResolvedTheme()
  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast:
            'rounded-lg! border! border-border! bg-surface-raised! text-foreground! shadow-lg! font-sans!',
          description: 'text-muted-foreground!',
        },
      }}
      {...props}
    />
  )
}
