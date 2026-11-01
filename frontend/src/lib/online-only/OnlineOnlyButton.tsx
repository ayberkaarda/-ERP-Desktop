import { Button, type ButtonProps } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useOnlineOnly } from './useOnlineOnly'

export interface OnlineOnlyButtonProps extends ButtonProps {
  /** Action name from the offline manifest's `online_only` list. */
  action: string
}

/** A Button that the runtime can disable for a server-only action, with the reason on hover. */
export function OnlineOnlyButton({ action, disabled, ...props }: OnlineOnlyButtonProps) {
  const state = useOnlineOnly(action)
  if (!state.disabled) return <Button disabled={disabled} {...props} />
  const button = <Button {...props} disabled />
  if (!state.reason) return button
  return (
    <Tooltip>
      {/* A disabled button gets no pointer or focus events; the wrapper carries the tooltip. */}
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {button}
        </span>
      </TooltipTrigger>
      <TooltipContent>{state.reason}</TooltipContent>
    </Tooltip>
  )
}
