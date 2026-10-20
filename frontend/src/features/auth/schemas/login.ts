import { z } from 'zod'

export const PASSWORD_MIN = 8

// Messages are i18n keys so the schema stays language-agnostic.
export const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'auth.validation.emailRequired')
    .pipe(z.email('auth.validation.emailInvalid')),
  password: z.string().min(PASSWORD_MIN, 'auth.validation.passwordMin'),
  remember: z.boolean(),
})

export type LoginValues = z.infer<typeof loginSchema>
