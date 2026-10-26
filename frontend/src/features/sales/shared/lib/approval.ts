import type { ApprovalTimelineStep } from '@/components/shared/ApprovalTimeline'
import type { ApprovalRequest } from '../api'

/**
 * Timeline steps of a Workflow approval request: a decided step shows its decision, the
 * current step of a pending request waits for a decision, later ones wait their turn and steps
 * left over after a final decision are skipped.
 */
export function approvalSteps(approval: ApprovalRequest): ApprovalTimelineStep[] {
  const decisions = approval.decisions ?? []
  return (approval.steps ?? []).map((s) => {
    const d = decisions.find((x) => x.step_position === s.position)
    let state: ApprovalTimelineStep['state']
    if (d) state = d.decision === 'approve' ? 'approved' : 'rejected'
    else if (approval.status !== 'pending') state = 'skipped'
    else state = approval.current_step === s.position ? 'pending' : 'waiting'
    return {
      id: `${approval.id}-${s.position}`,
      order: s.position,
      name: s.name ?? undefined,
      state,
      approvers: [],
      threshold: s.min_amount ?? null,
      decision: d
        ? {
            actor: d.actor_name ?? d.actor_id,
            decision: d.decision,
            comment: d.comment,
            decidedAt: d.decided_at,
          }
        : null,
    }
  })
}
