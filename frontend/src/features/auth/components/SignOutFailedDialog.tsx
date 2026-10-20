import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { signOut, signOutHere, useSignOutStore } from '../signOut'

/** Shown when the server did not confirm a logout. */
export function SignOutFailedDialog() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const failed = useSignOutStore((s) => s.failed)
  const pending = useSignOutStore((s) => s.pending)
  const dismiss = useSignOutStore((s) => s.dismiss)
  const go = (to: string) => void navigate(to, { replace: true })

  return (
    <Dialog open={failed} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('auth.signOut.failedTitle')}</DialogTitle>
          <DialogDescription>{t('auth.signOut.failedBody')}</DialogDescription>
        </DialogHeader>
        <p role="alert" className="text-sm text-warning-soft-foreground">
          {t('auth.signOut.localWarning')}
        </p>
        <DialogFooter className="flex-wrap">
          <Button variant="ghost" onClick={() => signOutHere(go)} disabled={pending}>
            {t('auth.signOut.local')}
          </Button>
          <Button onClick={() => void signOut(go)} disabled={pending}>
            {t('common.retry')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
