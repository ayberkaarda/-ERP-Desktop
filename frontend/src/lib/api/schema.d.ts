/**
 * Placeholder until backend/storage/api-docs/openapi.json exists.
 * Regenerate with `npm run gen:api`; do not edit by hand afterwards.
 */

export interface paths {
  '/health': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get: operations['health.show']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
}
export type webhooks = Record<string, never>
export interface components {
  schemas: {
    HealthStatus: {
      /** @enum {string} */
      status: 'ok'
    }
    ErrorEnvelope: {
      errors: {
        message: string
        code: string
        fields?: {
          [key: string]: string[]
        }
      }
    }
  }
  responses: never
  parameters: never
  requestBodies: never
  headers: never
  pathItems: never
}
export type $defs = Record<string, never>
export interface operations {
  'health.show': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': {
            data: components['schemas']['HealthStatus']
          }
        }
      }
    }
  }
}
