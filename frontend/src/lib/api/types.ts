import type { components, paths } from './schema'

export type Schemas = components['schemas']

/** JSON body of a 200 response for a GET path, straight from the generated OpenAPI types. */
export type GetResponse<P extends keyof paths> = paths[P] extends {
  get: { responses: { 200: { content: { 'application/json': infer B } } } }
}
  ? B
  : never
