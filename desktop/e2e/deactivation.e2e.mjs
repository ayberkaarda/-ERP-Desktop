// Scenario 6 of desktop/PLAN.md B8: the local data of a user the server
// deactivated is removed. A second app run (own data directory), signed in as
// the user the seed made for this.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { launch, signIn, waitForSeedData } from './support/app.mjs'
import { webApi } from './support/stack.mjs'
import { waitFor } from './support/webdriver.mjs'

describe('desktop e2e: deactivated user', () => {
  let app

  before(async () => {
    app = await launch()
  }, { timeout: 180_000 })

  after(async () => {
    await app?.stop()
  })

  it('6. a deactivated user loses the local data', { timeout: 180_000 }, async () => {
    const { state, session } = app
    await signIn(app, state.leaver.email)
    await waitForSeedData(app)

    const web = webApi(state)
    const deactivated = await web('PATCH', `/users/${state.leaver.id}/status`, { is_active: false })
    assert.equal(deactivated.status, 200, JSON.stringify(deactivated.json))

    await session.invoke('sync_now').catch(() => undefined)
    await waitFor(async () => (await app.status()).state === 'auth_required', {
      timeout: 90_000,
      interval: 1_000,
      message: 'the engine to end the deactivated session',
    })

    // No local copy is served any more.
    let served = false
    let refusal = null
    try {
      const answer = await session.api('GET', '/api/v1/parties')
      served = answer.status === 200 && JSON.stringify(answer.json).includes(state.party.name)
    } catch (error) {
      refusal = error
    }
    if (refusal) {
      assert.match(refusal.code ?? '', /UNAUTHENTICATED|USER_DEACTIVATED|OFFLINE_UNAVAILABLE/, `unexpected refusal: ${refusal.message}`)
    }
    assert.equal(served, false, 'local data is still served')
  })
})
