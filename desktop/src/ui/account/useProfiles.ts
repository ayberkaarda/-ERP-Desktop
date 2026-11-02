import { useCallback, useEffect, useState } from 'react'

import type { AppInfo } from '../../bridge/generated/AppInfo'
import type { ProfilesDto } from '../../bridge/generated/ProfilesDto'
import { call, type Invoke } from '../../bridge/invoke'

export interface ProfilesView {
  data: ProfilesDto | null
  error: unknown
  reload(): Promise<void>
}

/** `profile_list`, read on mount and on `reload()`. */
export function useProfiles(invoke: Invoke): ProfilesView {
  const [data, setData] = useState<ProfilesDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  const reload = useCallback(async () => {
    try {
      setData(await call<ProfilesDto>(invoke, 'profile_list'))
      setError(null)
    } catch (reason) {
      setError(reason)
    }
  }, [invoke])
  useEffect(() => {
    let live = true
    call<ProfilesDto>(invoke, 'profile_list').then(
      (value) => {
        if (live) setData(value)
      },
      (reason: unknown) => {
        if (live) setError(reason)
      },
    )
    return () => {
      live = false
    }
  }, [invoke])
  return { data, error, reload }
}

/** `app_info`, or null until read (or when it failed). */
export function useAppInfo(invoke: Invoke): AppInfo | null {
  const [info, setInfo] = useState<AppInfo | null>(null)
  useEffect(() => {
    let live = true
    call<AppInfo>(invoke, 'app_info').then(
      (value) => {
        if (live) setInfo(value)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [invoke])
  return info
}
