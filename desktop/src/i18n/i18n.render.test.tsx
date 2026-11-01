import { act, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'

import { addDesktopResources, useTd } from '@desktop/i18n'

function Title() {
  const td = useTd()
  return <h1>{td('shell.appName')}</h1>
}

describe('useTd', () => {
  it('renders desktop text and re-renders on a language change', async () => {
    const instance = i18next.createInstance()
    await instance.init({ lng: 'tr', fallbackLng: 'tr', resources: {} })
    addDesktopResources(instance)

    render(
      <I18nextProvider i18n={instance}>
        <Title />
      </I18nextProvider>,
    )
    expect(screen.getByRole('heading')).toHaveTextContent('Keystone Masaüstü')

    await act(() => instance.changeLanguage('en'))
    expect(screen.getByRole('heading')).toHaveTextContent('Keystone Desktop')
  })
})
