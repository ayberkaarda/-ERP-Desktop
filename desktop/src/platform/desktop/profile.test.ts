import { describe, expect, it } from 'vitest'

import { createFakeBridge, deferred, fail, flush } from '../../test/fakeBridge'
import { createActiveProfile } from './profile'

function setup(first: string | null = 'p1') {
  const state = { active: first }
  const bridge = createFakeBridge({
    commands: { profile_list: () => ({ active_id: state.active, profiles: [] }) },
  })
  const profile = createActiveProfile(bridge.invoke)
  const changes: (string | null)[] = []
  profile.subscribe((id) => changes.push(id))
  return { bridge, profile, state, changes }
}

describe('active profile', () => {
  it('is unknown until read, then reports each change once', async () => {
    const s = setup()
    expect(s.profile.current()).toBeUndefined()
    await s.profile.refresh()
    await s.profile.refresh()
    expect(s.profile.current()).toBe('p1')
    s.state.active = null
    await s.profile.refresh()
    expect(s.changes).toEqual(['p1', null])
  })

  it('shares one read between concurrent refreshes', async () => {
    const s = setup()
    await Promise.all([s.profile.refresh(), s.profile.refresh()])
    expect(s.bridge.callsOf('profile_list')).toHaveLength(1)
  })

  it('a failed read means no profile', async () => {
    const s = setup()
    s.bridge.handle({ profile_list: () => fail('PROFILES_FILE_INVALID') })
    await expect(s.profile.refresh()).resolves.toBeNull()
    expect(s.profile.current()).toBeNull()
  })

  it('delivers events of the active profile at once', async () => {
    const s = setup()
    await s.profile.refresh()
    const got: string[] = []
    s.profile.accept('p1', () => got.push('a'))
    expect(got).toEqual(['a'])
    expect(s.bridge.callsOf('profile_list')).toHaveLength(1)
  })

  it('drops events of a profile that is not active, after checking again', async () => {
    const s = setup()
    await s.profile.refresh()
    const got: string[] = []
    s.profile.accept('p0', () => got.push('old'))
    await flush()
    expect(got).toEqual([])
    expect(s.bridge.callsOf('profile_list')).toHaveLength(2)
  })

  it('learns a new active profile from its first event and keeps order', async () => {
    const s = setup()
    await s.profile.refresh()
    s.state.active = 'p2'
    const got: string[] = []
    s.profile.accept('p2', () => got.push('1'))
    s.profile.accept('p2', () => got.push('2'))
    await flush()
    s.profile.accept('p2', () => got.push('3'))
    expect(got).toEqual(['1', '2', '3'])
    expect(s.changes).toEqual(['p1', 'p2'])
  })

  it('holds events that arrive before the first read', async () => {
    const answer = deferred<{ active_id: string; profiles: never[] }>()
    const s = setup()
    s.bridge.handle({ profile_list: () => answer.promise })
    const got: string[] = []
    s.profile.accept('p1', () => got.push('early'))
    s.profile.accept('p9', () => got.push('foreign'))
    answer.resolve({ active_id: 'p1', profiles: [] })
    await flush()
    expect(got).toEqual(['early'])
  })
})
