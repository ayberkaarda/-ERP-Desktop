export interface AssistantStatus {
  enabled: boolean
  configured: boolean
  can_use: boolean
  can_admin: boolean
  provider: string | null
  model: string | null
  limits: { max_input_chars: number; daily_tokens: number }
  usage: { used_tokens: number; reserved_tokens: number; remaining_tokens: number }
}
export interface RecordContext {
  type: string
  id: string
  label?: string
}
export interface ToolCall {
  id: string
  tool: string
  kind: 'read' | 'draft'
  status: 'pending' | 'completed' | 'rejected' | 'failed'
  arguments: Record<string, unknown>
  result: unknown
  reason: string | null
}
export interface AssistantMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'processing' | 'completed' | 'pending_approval' | 'failed'
  request_id?: string
  context: RecordContext[]
  created_at: string
  tool_calls: ToolCall[]
}
export interface Conversation {
  id: string
  title: string
  version: number
  created_at: string
  updated_at: string
  busy_until?: string | null
  messages?: AssistantMessage[]
  has_more_messages?: boolean
}
export interface UsageRow {
  date: string
  user_id: string
  input_tokens: number
  output_tokens: number
  reserved_tokens: number
  requests: number
  failures: number
}
export interface Page<T> {
  data: T[]
  meta?: { pagination?: { current_page: number; last_page: number } }
}
export interface StreamEvent {
  event: string
  data: unknown
}
