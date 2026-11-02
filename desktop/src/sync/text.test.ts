import i18next from 'i18next'
import { describe, expect, it } from 'vitest'

import { addDesktopResources, DESKTOP_NS } from '../i18n'
import { createDesktopText } from './text'

async function instance() {
  const i18n = i18next.createInstance()
  await i18n.init({ lng: 'tr', fallbackLng: 'tr', resources: {} })
  addDesktopResources(i18n)
  return i18n
}

describe('desktop text', () => {
  it('translates a desktop key', async () => {
    const text = createDesktopText(await instance())
    expect(text.td('sync.state.offline')).toBe('Çevrimdışı')
  })

  it('a code with a translation reads it, one without falls back to the code', async () => {
    const i18n = await instance()
    i18n.addResourceBundle('tr', DESKTOP_NS, { errors: { NETWORK_ERROR: 'Sunucuya ulaşılamadı' } }, true, true)
    const text = createDesktopText(i18n)
    expect(text.error('NETWORK_ERROR')).toBe('Sunucuya ulaşılamadı')
    expect(text.error('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })

  it('an online-only action reads its text, or the general one', async () => {
    const i18n = await instance()
    i18n.addResourceBundle('tr', DESKTOP_NS, { onlineOnly: { closePeriod: 'Dönem kapanışı çevrimiçi yapılır' } }, true, true)
    const text = createDesktopText(i18n)
    expect(text.onlineOnly('closePeriod')).toBe('Dönem kapanışı çevrimiçi yapılır')
    expect(text.onlineOnly('finalizeSalesQuote')).toBe('Bu işlem yalnız çevrimiçiyken yapılabilir.')
  })
})
