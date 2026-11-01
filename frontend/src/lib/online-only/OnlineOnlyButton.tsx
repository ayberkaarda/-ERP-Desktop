import type { KeyboardEvent, MouseEvent } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useOnlineOnly } from './useOnlineOnly'

export interface OnlineOnlyButtonProps extends ButtonProps {
  /** Action name from the offline manifest's `online_only` list. */
  action: string
}

// A disabled action must not submit its form nor reach outer handlers (clickable rows).
function stopClick(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault()
  event.stopPropagation()
}

function stopActivationKey(event: KeyboardEvent<HTMLButtonElement>) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
  }
}

/**
 * A Button that the runtime can disable for a server-only action. It is disabled with
 * aria-disabled rather than the native attribute, so it stays focusable and the reason
 * reaches keyboard and screen-reader users as the tooltip / accessible description. While
 * disabled, the caller's activation handlers are not called.
 */
export function OnlineOnlyButton({
  action,
  disabled,
  className,
  onClick,
  onDoubleClick,
  onMouseDown,
  onMouseUp,
  onPointerDown,
  onPointerUp,
  onKeyDown,
  onKeyUp,
  ...props
}: OnlineOnlyButtonProps) {
  const state = useOnlineOnly(action)
  if (!state.disabled) {
    return (
      <Button
        disabled={disabled}
        className={className}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        {...props}
      />
    )
  }
  const button = (
    <Button
      {...props}
      aria-disabled
      onClick={stopClick}
      onDoubleClick={stopClick}
      onKeyDown={stopActivationKey}
      onKeyUp={stopActivationKey}
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
