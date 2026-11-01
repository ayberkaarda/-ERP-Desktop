import i18next, { type i18n as I18n } from 'i18next'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  addDesktopResources,
  createTd,
  DESKTOP_LANGUAGES,
  DESKTOP_NS,
  DESKTOP_SECTIONS,
  desktopResources,
  td,
} from '@desktop/i18n'

// Every key path of a nested resource object, e.g. "shell.appName".
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix === '' ? key : `${prefix}.${key}`),
  )
}

async function freshInstance(): Promise<I18n> {
  const instance = i18next.createInstance()
  await instance.init({
    lng: 'tr',
    fallbackLng: 'tr',
    resources: { tr: { translation: { web: 'web metni' } } },
    interpolation: { escapeValue: false },
  })
  return instance
}

describe('desktop resources', () => {
  it('ships the same five sections in all four languages', () => {
    expect(DESKTOP_LANGUAGES).toEqual(['tr', 'en', 'de', 'fr'])
    expect(DESKTOP_SECTIONS).toEqual(['shell', 'sync', 'account', 'errors', 'onlineOnly'])
    for (const lang of DESKTOP_LANGUAGES) {
      expect(Object.keys(desktopResources[lang])).toEqual([...DESKTOP_SECTIONS])
    }
  })

  it('has the Turkish key set in every other language', () => {
    const source = keyPaths(desktopResources.tr).sort()
    expect(source).toContain('shell.appName')
    for (const lang of DESKTOP_LANGUAGES) {
      expect(keyPaths(desktopResources[lang]).sort()).toEqual(source)
    }
  })
})

describe('addDesktopResources', () => {
  let instance: I18n

  beforeEach(async () => {
    instance = await freshInstance()
  })

  it('adds one desktop namespace per language with the sections nested under it', () => {
    addDesktopResources(instance)
    for (const lang of DESKTOP_LANGUAGES) {
      const bundle: unknown = instance.getResourceBundle(lang, DESKTOP_NS)
      expect(bundle).toEqual(desktopResources[lang])
    }
    expect(createTd(instance)('shell.appName')).toBe('Keystone Masaüstü')
  })

  it('leaves the web namespaces alone', () => {
    addDesktopResources(instance)
    expect(instance.getResource('tr', 'translation', 'web')).toBe('web metni')
    expect(instance.getResourceBundle('tr', DESKTOP_NS)).toEqual(desktopResources.tr)
  })

  it('can run twice without losing keys', () => {
    addDesktopResources(instance)
    addDesktopResources(instance)
    expect(instance.getResourceBundle('en', DESKTOP_NS)).toEqual(desktopResources.en)
  })
})

describe('td', () => {
  it('translates desktop keys in the active language', async () => {
    const instance = await freshInstance()
    addDesktopResources(instance)
    const td = createTd(instance)
    expect(td('shell.starting')).toBe('Başlatılıyor…')
    await instance.changeLanguage('de')
    expect(td('shell.starting')).toBe('Wird gestartet…')
    await instance.changeLanguage('fr')
    expect(td('shell.starting')).toBe('Démarrage…')
  })

  it('uses the shared i18next instance by default', async () => {
    await i18next.init({ lng: 'en', fallbackLng: 'tr', resources: {} })
    addDesktopResources()
    expect(td('shell.appName')).toBe('Keystone Desktop')
  })

  it('accepts only keys from the Turkish source files', async () => {
    const td = createTd(await freshInstance())
    // @ts-expect-error unknown desktop key
    td('shell.missing')
    // @ts-expect-error a section is not a leaf key
    td('shell')
    expect(td('shell.appName')).toBe('shell.appName')
  })
})
