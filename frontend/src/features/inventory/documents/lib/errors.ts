import { isApiError } from '@/platform'

export const VERSION_CONFLICT = 'VERSION_CONFLICT'

/** Someone else saved the document first (409 VERSION_CONFLICT from HasVersion). */
export function isVersionConflict(error: unknown): boolean {
  return isApiError(error) && error.code === VERSION_CONFLICT
}

export const DOCUMENT_LOCKED = 'DOCUMENT_LOCKED'

/** The document left draft, so it can no longer be edited or deleted (409 DOCUMENT_LOCKED). */
export function isDocumentLocked(error: unknown): boolean {
  return isApiError(error) && error.code === DOCUMENT_LOCKED
}

/** Server text for toasts; the API localizes messages via Accept-Language. */
export function errorMessage(error: unknown, fallback: string): string {
  if (isApiError(error) && error.message) return error.message
  return fallback
}
