import { ApiError } from '@/platform'
export function assistantErrorKey(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'ASSISTANT_DISABLED') return 'disabled'
    if (error.code === 'ASSISTANT_NOT_CONFIGURED') return 'notConfigured'
    if (
      error.status === 429 ||
      error.code === 'ASSISTANT_BUDGET_EXCEEDED' ||
      error.code === 'ASSISTANT_TURN_LIMIT'
    )
      return 'budgetError'
    if (
      error.status === 403 ||
      error.status === 401 ||
      error.code === 'FORBIDDEN' ||
      error.code === 'ASSISTANT_TOOL_UNAVAILABLE'
    )
      return 'accessError'
    if (
      error.status === 409 ||
      error.code === 'ASSISTANT_BUSY' ||
      error.code === 'ASSISTANT_APPROVAL_PENDING'
    )
      return 'conflictError'
  }
  return 'requestError'
}
