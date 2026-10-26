import { z } from 'zod'

export const totpSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'auth.validation.codeFormat'),
})

export const recoverySchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'auth.validation.recoveryRequired')
    .max(64, 'auth.validation.recoveryRequired'),
})

export type TwoFactorValues = z.infer<typeof totpSchema>
