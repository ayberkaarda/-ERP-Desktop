import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'

/** Anything carrying the API error envelope: ApiError instances or a raw `{errors:{...}}` body. */
export interface ServerErrorShape {
  message: string
  code?: string
  fields: Record<string, string[]>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readFields(value: unknown): Record<string, string[]> {
  if (!isRecord(value)) return {}
  const out: [string, string[]][] = []
  for (const [key, messages] of Object.entries(value)) {
    if (Array.isArray(messages))
      out.push([key, messages.filter((m): m is string => typeof m === 'string')])
    else if (typeof messages === 'string') out.push([key, [messages]])
  }
  // fromEntries defines own properties, so a "__proto__" key cannot reach the prototype.
  return Object.fromEntries(out)
}

/** Normalizes ApiError (platform) or a response body into one shape; null when not an API error. */
export function readServerError(error: unknown): ServerErrorShape | null {
  if (!isRecord(error)) return null
  const source = isRecord(error.errors) ? error.errors : error
  if (typeof source.message !== 'string') return null
  return {
    message: source.message,
    code: typeof source.code === 'string' ? source.code : undefined,
    fields: readFields(source.fields),
  }
}

export interface ApplyServerErrorsOptions {
  /** Maps an API field ("lines.0.unit_price") to a form path; return null to leave it unmapped. */
  mapField?: (serverField: string) => string | null
  /** Only these form paths receive errors; others are reported back as unmapped. */
  knownFields?: readonly string[]
  /**
   * Whether the form actually has this path registered. Descendants of a known field
   * ("lines.7.price") are only mapped when it says yes, so the summary never links to a field
   * that does not exist.
   */
  isRegistered?: (path: string) => boolean
}

const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

/** Dotted form path without empty or prototype-polluting segments. */
export function isSafeFieldPath(path: string): boolean {
  const parts = path.split('.')
  return parts.every((p) => p !== '' && !UNSAFE_SEGMENTS.has(p))
}

function isMappable(field: string, options: ApplyServerErrorsOptions): boolean {
  if (!isSafeFieldPath(field)) return false
  const { knownFields, isRegistered } = options
  if (knownFields) {
    if (knownFields.includes(field)) return isRegistered ? isRegistered(field) : true
    const descendant = knownFields.some((k) => field.startsWith(`${k}.`))
    // Without a registration check a descendant path cannot be trusted to exist.
    return descendant && isRegistered?.(field) === true
  }
  return isRegistered ? isRegistered(field) : true
}

export interface AppliedServerErrors {
  mapped: { field: string; message: string }[]
  unmapped: { field: string; message: string }[]
}

/** Splits field errors into ones the form can show and ones it cannot; pure, safe in render. */
export function partitionServerErrors(
  error: ServerErrorShape,
  options: ApplyServerErrorsOptions = {},
): AppliedServerErrors {
  const result: AppliedServerErrors = { mapped: [], unmapped: [] }
  for (const [serverField, messages] of Object.entries(error.fields)) {
    const message = messages[0]
    if (!message) continue
    const field = options.mapField ? options.mapField(serverField) : serverField
    if (field !== null && isMappable(field, options)) result.mapped.push({ field, message })
    else result.unmapped.push({ field: serverField, message })
  }
  return result
}

/** Pushes `errors.fields` into react-hook-form; returns what could and could not be attached. */
export function applyServerErrors<T extends FieldValues>(
  error: ServerErrorShape,
  setError: UseFormSetError<T>,
  options: ApplyServerErrorsOptions = {},
): AppliedServerErrors {
  const result = partitionServerErrors(error, options)
  for (const { field, message } of result.mapped) {
    setError(field as Path<T>, { type: 'server', message })
  }
  return result
}

/** snake_case API keys to camelCase form keys, segment by segment ("unit_price" -> "unitPrice"). */
export function snakeToCamelPath(path: string): string {
  return path
    .split('.')
    .map((s) => s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase()))
    .join('.')
}
