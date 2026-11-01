// A failed shell command as the web `ApiError` the features already handle.

import type { CommandError } from '../../bridge/invoke'
import { ApiError } from '@/platform/types'

/**
 * HTTP status a command failure stands for. A session code gets the status the
 * server would have sent, so `classifyAuthFailure` treats both the same; every
 * other code is a request that got no answer (status 0, like a web network error).
 */
export const COMMAND_STATUS: Readonly<Record<string, number>> = {
  UNAUTHENTICATED: 401,
  NO_ACTIVE_PROFILE: 401,
  USER_DEACTIVATED: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  PAYLOAD_TOO_LARGE: 413,
}

export function commandToApiError(error: CommandError): ApiError {
  const details: Record<string, unknown> =
    error.retryAfter === undefined ? {} : { retry_after: error.retryAfter }
  return new ApiError(COMMAND_STATUS[error.code] ?? 0, error.code, error.message, {}, details)
}
