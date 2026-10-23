import { z } from 'zod'
import { ApiError } from '@/platform'
import type { Conversation } from './types'

const call = z.object({
  id: z.string().min(1).max(200),
  tool: z.string().max(200),
  kind: z.enum(['read', 'draft']),
  status: z.enum(['pending', 'completed', 'rejected', 'failed']),
  arguments: z.record(z.string(), z.unknown()),
  result: z.unknown(),
  reason: z.string().max(4000).nullable(),
})
const context = z.object({
  type: z.string().max(100),
  id: z.uuid(),
  label: z.string().max(200).optional(),
})
const conversation = z.object({
  id: z.uuid(),
  title: z.string().max(500),
  version: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
  busy_until: z.string().nullable().optional(),
  has_more_messages: z.boolean().optional(),
  messages: z
    .array(
      z.object({
        id: z.uuid(),
        role: z.enum(['user', 'assistant']),
        content: z.string().max(100_000),
        status: z.enum(['processing', 'completed', 'pending_approval', 'failed']),
        request_id: z.uuid().optional(),
        context: z.array(context).max(10),
        created_at: z.string(),
        tool_calls: z.array(call).max(32),
      }),
    )
    .max(20),
})

export function parseConversation(value: unknown, expectedId: string): Conversation {
  const result = conversation.safeParse(value)
  if (!result.success || result.data.id !== expectedId)
    throw new ApiError(0, 'INVALID_STREAM', 'Invalid conversation response.')
  return result.data
}
