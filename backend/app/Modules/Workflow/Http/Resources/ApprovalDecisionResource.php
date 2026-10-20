<?php

declare(strict_types=1);

namespace App\Modules\Workflow\Http\Resources;

use App\Modules\Workflow\Models\ApprovalDecision;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin ApprovalDecision */
final class ApprovalDecisionResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id, 'step_position' => $this->step_position,
            'actor_id' => $this->actor_id, 'decision' => $this->decision,
            'comment' => $this->comment, 'decided_at' => $this->decided_at->toIso8601String(),
        ];
    }
}
