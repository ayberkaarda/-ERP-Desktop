import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { invalidatePurchEffects } from './keys'

describe('purchasing mutation cache effects', () => {
  it('refreshes supplier exposure in both purchasing areas without invalidating another company', () => {
    const client = new QueryClient()
    const orderExposure = ['purchasing', 'company-a', 'exposure', 'supplier']
    const invoiceExposure = ['purchasing', 'company-a', 'suppliers', 'supplier', 'exposure']
    const otherCompany = ['purchasing', 'company-b', 'exposure', 'supplier']
    for (const key of [orderExposure, invoiceExposure, otherCompany]) {
      client.setQueryData(key, { open_payables: '100.00' })
    }

    invalidatePurchEffects(client, 'company-a')

    expect(client.getQueryState(orderExposure)?.isInvalidated).toBe(true)
    expect(client.getQueryState(invoiceExposure)?.isInvalidated).toBe(true)
    expect(client.getQueryState(otherCompany)?.isInvalidated).toBe(false)
    client.clear()
  })
})
