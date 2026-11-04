// Scenarios 1 to 5 of desktop/PLAN.md B8, one app run in order: sign-in and
// first pull, offline drafts (order, stock count; the manifest has no expense draft), push, a conflict with a web change, and the
// online-only button while offline. The network cut is a TCP proxy between the
// app and the Laravel server; the web side is the REST API of the same server.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'

import { launch, signIn, waitForSeedData } from './support/app.mjs'
import { webApi } from './support/stack.mjs'
import { waitFor } from './support/webdriver.mjs'

const TODAY = new Date().toISOString().slice(0, 10)
const STEP = { timeout: 180_000 }

describe('desktop e2e: sign-in, offline drafts, sync', () => {
  let app
  let web
  // Two draft orders created on the server before the app first pulls: one for
  // the conflict (4), one for the button check (5).
  const orders = {}
  const drafts = {}

  before(async () => {
    app = await launch()
    web = webApi(app.state)
    const { state } = app
    for (const name of ['conflict', 'button']) {
      const created = await web('POST', '/sales-orders', {
        party_id: state.party.id,
        document_date: TODAY,
        notes: `${name} base`,
        lines: [{ item_id: state.item_id, quantity: '1', unit_price: '10.00' }],
      })
      assert.equal(created.status, 201, `server order: ${JSON.stringify(created.json)}`)
      orders[name] = created.json.data.id
    }
  })

  after(async () => {
    await app?.stop()
  })

  it('1. sign-in brings the bootstrap data', STEP, async () => {
    await signIn(app, app.state.operator.email)
    await waitForSeedData(app)
    const status = await app.status()
    assert.notEqual(status.state, 'auth_required')
    const phase = await app.session.invoke('profile_state')
    assert.equal(phase.phase, 'ready')
    // The order the later scenarios work on arrived in the local copy too.
    await waitFor(async () => (await app.session.api('GET', `/api/v1/sales-orders/${orders.conflict}`)).status === 200, {
      timeout: 60_000,
      message: 'the server orders in the local copy',
    })
    await waitFor(async () => (await app.session.api('GET', `/api/v1/sales-orders/${orders.button}`)).status === 200, {
      timeout: 60_000,
      message: 'the second server order in the local copy',
    })
  })

  it('2. a cut network: order and stock count are drafted offline', STEP, async () => {
    await app.proxy.cut()
    await app.waitForState('offline')
    const { state, session } = app

    const order = await session.api('POST', '/api/v1/sales-orders', {
      headers: [['Idempotency-Key', crypto.randomUUID()]],
      body: {
        party_id: state.party.id,
        document_date: TODAY,
        notes: 'offline order',
        lines: [{ item_id: state.item_id, quantity: '2', unit_price: '15.00' }],
      },
    })
    assert.equal(order.source, 'local')
    assert.ok([201, 202].includes(order.status), `order draft: ${order.status} ${JSON.stringify(order.json)}`)
    drafts.order = order.json.data.id

    const count = await session.api('POST', '/api/v1/stock-documents', {
      headers: [['Idempotency-Key', crypto.randomUUID()]],
      body: {
        doc_type: 'count',
        document_date: TODAY,
        warehouse_id: state.warehouse_id,
        notes: 'offline count',
      },
    })
    assert.equal(count.source, 'local')
    assert.ok([201, 202].includes(count.status), `count draft: ${count.status} ${JSON.stringify(count.json)}`)
    drafts.count = count.json.data.id

    const outbox = await session.invoke('outbox_list')
    const queued = outbox.map((entry) => entry.id)
    for (const id of Object.values(drafts)) assert.ok(queued.includes(id), `outbox holds ${id}`)
    assert.ok((await app.status()).pending >= 2)
  })

  it('3. the network is back: the drafts are pushed and the server has them', STEP, async () => {
    await app.proxy.restore()
    await app.waitForState('idle')
    const report = async () =>
      JSON.stringify({
        status: await app.status(),
        outbox: (await app.session.invoke('outbox_list')).map(({ resource, op, state, attempts, last_error, rejected_fields }) => ({
          resource,
          op,
          state,
          attempts,
          last_error,
          rejected_fields,
        })),
      })
    const settled = await waitFor(
      async () => {
        const entries = await app.session.invoke('outbox_list')
        return entries.every((entry) => entry.state !== 'pending' && entry.state !== 'in_flight')
      },
      { timeout: 90_000, interval: 1_000, message: 'the outbox to be pushed' },
    ).catch(async (error) => {
      error.message += `
${await report()}`
      throw error
    })
    assert.ok(settled)
    assert.deepEqual((await app.session.invoke('outbox_list')).length, 0, await report())
    const order = await web('GET', `/sales-orders/${drafts.order}`)
    assert.equal(order.status, 200, JSON.stringify(order.json))
    assert.equal(order.json.data.notes, 'offline order')
    const count = await web('GET', `/stock-documents/${drafts.count}`)
    assert.equal(count.status, 200, JSON.stringify(count.json))
    assert.equal((await app.status()).conflicts, 0)
  })

  it('4. a draft changed on the web lands in the Conflict Inbox', STEP, async () => {
    const { session } = app
    const local = await session.api('GET', `/api/v1/sales-orders/${orders.conflict}`)
    const version = local.json.data.version
    await app.proxy.cut()
    await app.waitForState('offline')

    const edited = await session.api('PATCH', `/api/v1/sales-orders/${orders.conflict}`, {
      body: { notes: 'desktop edit', version },
    })
    assert.equal(edited.source, 'local')
    assert.ok([200, 202].includes(edited.status), `desktop edit: ${edited.status} ${JSON.stringify(edited.json)}`)

    const changed = await web('PATCH', `/sales-orders/${orders.conflict}`, { notes: 'web edit', version })
    assert.equal(changed.status, 200, JSON.stringify(changed.json))

    await app.proxy.restore()
    await app.waitForState('idle')
    const conflict = await waitFor(
      async () => (await session.invoke('conflicts_list')).find((entry) => entry.id === orders.conflict),
      { timeout: 90_000, interval: 1_000, message: 'the order in the Conflict Inbox' },
    )
    assert.equal(conflict.code, 'VERSION_CONFLICT')
    assert.ok(conflict.conflicting_fields.includes('notes'), conflict.conflicting_fields.join(','))

    // The inbox screen shows the field comparison for it.
    await session.navigate('/sync/conflicts')
    try {
      await session.waitForElement('[data-testid="conflict-fields"]', { timeout: 30_000 })
    } catch (error) {
      error.message += `\n--- page ---\n${await session.describe()}`
      throw error
    }
  })

  it('5. finalizing is disabled offline', STEP, async () => {
    const { session } = app
    const buttons = () =>
      session.execute(
        `return [...document.querySelectorAll('button')]
           .filter((b) => b.querySelector('svg[class*="check-check"]'))
           .map((b) => ({ ariaDisabled: b.getAttribute('aria-disabled'), disabled: b.disabled, text: b.textContent }))`,
      )
    await session.navigate(`/sales/orders/${orders.button}`)
    // Online first: the same button is usable.
    const online = await waitFor(async () => (await buttons()).length > 0 && (await buttons()), {
      timeout: 45_000,
      message: 'the confirm button of the order page',
    }).catch(async (error) => {
      error.message += `\n--- page ---\n${await session.describe()}`
      throw error
    })
    assert.notEqual(online[0].ariaDisabled, 'true', JSON.stringify(online))

    await app.proxy.cut()
    await app.waitForState('offline')
    const offline = await waitFor(
      async () => {
        const now = await buttons()
        return now.length > 0 && now.every((b) => b.ariaDisabled === 'true') && now
      },
      { timeout: 30_000, message: 'the confirm button to be disabled offline' },
    ).catch(async (error) => {
      error.message += `\nbuttons: ${JSON.stringify(await buttons())}\n--- page ---\n${await session.describe()}`
      throw error
    })
    assert.ok(offline.length > 0)
  })
})
