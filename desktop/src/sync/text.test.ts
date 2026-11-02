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

  it('a code with a text reads errors.<code>, one without falls back to the code', async () => {
    const text = createDesktopText(await instance())
    expect(text.error('NETWORK_ERROR')).toBe('Sunucuya ulaşılamıyor.')
    expect(text.error('SOMETHING_NEW')).toBe('SOMETHING_NEW')
  })

  it('only codes of the error table are looked up', async () => {
    const i18n = await instance()
    i18n.addResourceBundle('tr', DESKTOP_NS, { errors: { NOT_A_CODE: 'bir metin' } }, true, true)
    expect(createDesktopText(i18n).error('NOT_A_CODE')).toBe('NOT_A_CODE')
  })

  it('a manifest online-only action reads its text, any other name the general one', async () => {
    const text = createDesktopText(await instance())
    expect(text.onlineOnly('closePeriod')).toBe('Dönem ve mali yıl kapanışı çevrimiçi yapılır.')
    expect(text.onlineOnly('notAnAction')).toBe('Bu işlem yalnız çevrimiçiyken yapılabilir.')
  })
})
