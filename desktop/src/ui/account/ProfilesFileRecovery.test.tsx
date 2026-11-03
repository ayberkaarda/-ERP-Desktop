import { screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { toCommandError } from '../../bridge/invoke'
import { harness, renderGate, useTurkish } from './testing'

beforeEach(useTurkish)

const FILE = 'C:/Users/ada/AppData/Roaming/com.keystone.desktop/profiles.json'

function fileState(path: unknown, message = 'not valid JSON') {
  return harness({ profile_state: () => ({ phase: 'failed', error: { code: 'PROFILES_FILE_INVALID', message, path } }) })
}

describe('toCommandError keeps only a text path', () => {
  it.each([
    ['a number', 3],
    ['an object', { p: FILE }],
    ['null', null],
    ['an array', [FILE]],
  ])('drops %s', (_name, path) => {
    expect(toCommandError({ code: 'PROFILES_FILE_INVALID', message: 'x', path }).path).toBeUndefined()
  })

  it('never fills the path from other fields', () => {
    expect(toCommandError({ code: 'PROFILES_FILE_INVALID', message: FILE, retry_after: 7 }).path).toBeUndefined()
  })
})

describe('profiles file screen with a path', () => {
  it('keeps the lead line and the shell detail next to the path', async () => {
    renderGate(fileState(FILE))
    await screen.findByTestId('profiles-file-path')
    expect(screen.getByText('Şu profil dosyası okunamadı:')).toBeInTheDocument()
    expect(screen.getByText(/Ayrıntı: not valid JSON/)).toBeInTheDocument()
  })

  it('says what the shell detail means in the user language, keeping the path', async () => {
    renderGate(fileState(FILE, 'the profile file is not valid JSON of this version'))
    expect(await screen.findByTestId('profiles-file-path')).toHaveTextContent(FILE)
    const detail = screen.getByTestId('profiles-file-detail')
    expect(detail).toHaveTextContent('Ayrıntı: Dosya bu sürümün okuyabildiği bir profil dosyası değil')
    expect(detail).not.toHaveTextContent('not valid JSON')
  })

  it.each([
    ['the profile file has an unknown version', 'tanımadığı bir sürümle yazılmış'],
    ['cannot read the profile file: permission denied', 'Dosya okunamadı (erişim izni yok).'],
    ['cannot replace the profile file: storage full', 'Dosya değiştirilemedi (sistem hatası: storage full).'],
    ['cannot create the directory of the profile file: entity not found', 'klasörü oluşturulamadı (bulunamadı)'],
  ])('translates "%s"', async (message, expected) => {
    renderGate(fileState(FILE, message))
    expect(await screen.findByTestId('profiles-file-detail')).toHaveTextContent(expected)
  })

  it('shows the path even when the shell sent no message', async () => {
    renderGate(fileState(FILE, ''))
    expect(await screen.findByTestId('profiles-file-path')).toHaveTextContent(FILE)
  })

  it('shows a path with markup characters as text', async () => {
    const odd = 'C:/Users/<b>ada</b> & "q"/profiles.json'
    renderGate(fileState(odd))
    const code = await screen.findByTestId('profiles-file-path')
    expect(code.textContent).toBe(odd)
    expect(code.querySelector('b')).toBeNull()
  })

  it('shows a long path whole, wrapping and selectable in one go', async () => {
    const long = `C:/Users/${'verylongfolder/'.repeat(20)}profiles.json`
    renderGate(fileState(long))
    const code = await screen.findByTestId('profiles-file-path')
    expect(code.textContent).toBe(long)
    expect(code).toHaveClass('break-all', 'select-all')
  })

  it('an empty path keeps the general text', async () => {
    renderGate(fileState(''))
    expect(await screen.findByText(/Uygulama veri klasöründeki profiles\.json/)).toBeInTheDocument()
    expect(screen.queryByTestId('profiles-file-path')).not.toBeInTheDocument()
  })
})


describe('profile state with a path that is not text', () => {
  it.each([
    ['a number', 5],
    ['an object', { p: FILE }],
    ['null', null],
  ])('ignores %s and shows the general text', async (_name, path) => {
    renderGate(fileState(path))
    expect(await screen.findByText(/Uygulama veri klasöründeki profiles.json/)).toBeInTheDocument()
    expect(screen.queryByTestId('profiles-file-path')).not.toBeInTheDocument()
    expect(screen.getByText(/üzerine yazılmadı/)).toBeInTheDocument()
  })
})
