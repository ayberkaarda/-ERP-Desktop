import { toCommandError } from '../../bridge/invoke'
import { parsePendingWork } from './errors'
import type { AccountContextValue, PendingAction } from './services'

export const PENDING_WORK_CODE = 'PROFILE_HAS_PENDING_WORK'

/** The user kept the unsent work; the action did not happen. */
export const KEPT = Symbol('kept')

/**
 * Runs a shell command that refuses with `PROFILE_HAS_PENDING_WORK` unless
 * forced: asks the user, repeats it with `force` on discard. Any other
 * failure is thrown as a `CommandError`.
 */
export async function withPendingWork<T>(
  account: Pick<AccountContextValue, 'askPendingWork'>,
  action: PendingAction,
  run: (force: boolean) => Promise<T>,
): Promise<T | typeof KEPT> {
  try {
    return await run(false)
  } catch (reason) {
    const failure = toCommandError(reason)
    if (failure.code !== PENDING_WORK_CODE) throw failure
    const answer = await account.askPendingWork({ action, ...parsePendingWork(failure.message) })
    if (answer !== 'discard') return KEPT
    try {
      return await run(true)
    } catch (again) {
      throw toCommandError(again)
    }
  }
}
