// Sync wire contract types and the tables derived from contracts/: the
// online-only route table, the Conflict Inbox choice model, the error codes
// with a text, and the fixture set for tests. The package's only public surface.

export {
  ONLINE_ONLY_ACTIONS,
  isRouterUuid,
  onlineOnlyAction,
  onlineOnlyKey,
  type OnlineOnlyAction,
  type OnlineOnlyCategory,
  type OnlineOnlyEntry,
  type OnlineOnlyKey,
  type OnlineOnlyMatch,
} from './onlineOnly'
export { ONLINE_ONLY, API_PREFIX } from './generated/onlineOnly'

export {
  RESOLUTION_TABLE,
  conflictDtoFromWire,
  conflictModel,
  isConflictResult,
  type ConflictChoice,
  type ConflictCode,
  type ConflictInput,
  type ConflictModel,
  type ConflictModelResult,
  type ConflictRefusal,
  type ConflictResult,
  type LocalDraft,
  type MutationOp,
} from './conflicts'

export {
  ADAPTER_ERROR_CODES,
  errorKey,
  type AdapterErrorCode,
  type DesktopErrorCode,
  type ErrorKey,
  type TranslatedErrorCode,
} from './errorCodes'

export {
  wireFixtures,
  conflictDtoFixtures,
  conflictFixtures,
  validFixture,
  wireFixture,
  type ConflictFixture,
  type ValidFixtureName,
  type ValidFixtures,
  type WireFixture,
} from './fixtures'

export type { CommonSamples } from './generated/common'
export type { DeviceLoginRequest } from './generated/device-login.request'
export type { DeviceRefreshRequest } from './generated/device-refresh.request'
export type { DeviceTokenResponse } from './generated/device-token.response'
export type { ErrorCode } from './generated/error-codes'
export type { ErrorResponse } from './generated/error.response'
export type { ManifestResponse } from './generated/manifest.response'
export type { PullRequest } from './generated/pull.request'
export type { PullResponse } from './generated/pull.response'
export type { Mutation, PushRequest, Resolution } from './generated/push.request'
export type { Conflict, PushResponse, Result as PushResult } from './generated/push.response'
export type { Tombstone } from './generated/tombstone'
