import type { Platform } from '../types'
import { createWebConnectivity } from './connectivity'
import { createWebHttp, type WebHttpOptions } from './http'
import { createWebNotify } from './notify'
import { createWebRealtime, type ReverbConfig } from './realtime'

export interface WebPlatformOptions extends WebHttpOptions {
  reverb?: ReverbConfig | null
}

export function createWebPlatform(options: WebPlatformOptions = {}): Platform {
  const http = createWebHttp(options)
  return {
    kind: 'web',
    http,
    connectivity: createWebConnectivity(),
    notify: createWebNotify(),
    realtime: createWebRealtime({
      config: options.reverb ?? null,
      authorize: (socketId, channelName) =>
        http.post(
          '/broadcasting/auth',
          { socket_id: socketId, channel_name: channelName },
          { skipAuthHandling: true },
        ),
    }),
  }
}
