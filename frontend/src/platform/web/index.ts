import type { Platform } from '../types'
import { createWebConnectivity } from './connectivity'
import { createWebHttp, type WebHttpOptions } from './http'
import { createWebNotify } from './notify'

export function createWebPlatform(options: WebHttpOptions = {}): Platform {
  return {
    kind: 'web',
    http: createWebHttp(options),
    connectivity: createWebConnectivity(),
    notify: createWebNotify(),
  }
}
