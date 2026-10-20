import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderRoute } from '@/test/render'
import { LoginPage } from './LoginPage'

describe('LoginPage', () => {
  it('shows Turkish validation messages', async () => {
    const user = userEvent.setup()
    renderRoute(<LoginPage />, '/login')

    await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

    expect(await screen.findByText('E-posta adresi gerekli.')).toBeInTheDocument()
    expect(screen.getByText('Parola en az 8 karakter olmalı.')).toBeInTheDocument()
    expect(screen.getByLabelText('E-posta')).toHaveAttribute('aria-invalid', 'true')
  })

  it('navigates to the dashboard on valid input', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute(<LoginPage />, '/login')

    await user.type(screen.getByLabelText('E-posta'), 'demo@keystone.test')
    await user.type(screen.getByLabelText('Parola'), 'correct-horse')
    await user.click(screen.getByRole('button', { name: 'Oturum aç' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })
})
