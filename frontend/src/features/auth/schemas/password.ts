import { z } from 'zod'
import { PASSWORD_MIN } from './login'

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'auth.validation.currentRequired'),
    password: z.string().min(PASSWORD_MIN, 'auth.validation.passwordMin'),
    password_confirmation: z.string(),
  })
  .refine((v) => v.password === v.password_confirmation, {
    path: ['password_confirmation'],
    message: 'auth.validation.passwordMismatch',
  })
  .refine((v) => v.password !== v.current_password, {
    path: ['password'],
    message: 'auth.validation.passwordSame',
  })

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>
