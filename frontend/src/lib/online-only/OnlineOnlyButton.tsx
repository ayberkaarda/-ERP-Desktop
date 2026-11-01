import type { MouseEvent } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useOnlineOnly } from './useOnlineOnly'

export interface OnlineOnlyButtonProps extends ButtonProps {
  /** Action name from the offline manifest's `online_only` list. */
  action: string
}

function swallow(event: MouseEvent<HTMLButtonElement>) {
  // Also stops a submit button from submitting its form.
  event.preventDefault()
}

/**
 * A Button that the runtime can disable for a server-only action. It is disabled with
 * aria-disabled rather than the native attribute, so it stays focusable and the reason
 * reaches keyboard and screen-reader users as the tooltip / accessible description.
 */
export function OnlineOnlyButton({
  action,
  disabled,
  className,
  onClick,
  ...props
}: OnlineOnlyButtonProps) {
  const state = useOnlineOnly(action)
  if (!state.disabled) {
    return <Button disabled={disabled} className={className} onClick={onClick} {...props} />
  }
  const button = (
    <Button
      {...props}
      aria-disabled
      onClick={swallow}
      className={cn('cursor-not-allowed opacity-50', className)}
    />
  )
  if (!state.reason) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{state.reason}</TooltipContent>
    </Tooltip>
  )
}
